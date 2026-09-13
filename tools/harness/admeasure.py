# -*- coding: utf-8 -*-
"""Mesure ce que fait le lecteur sur la duree : demarrage, images, gels, tampon, publicites.

Charge l'extension par CDP, reste sur une chaine, et releve l'element video deux fois par seconde
depuis la page. C'est la reference de performance : **on mesure avant d'optimiser**, sans quoi
aucune optimisation ne peut prouver qu'elle ameliore quelque chose.

Ce que la premiere version faisait mal, et qui fausse une reference :
  - elle tuait TOUS les chrome.exe (taskkill /IM), navigateurs de l'utilisateur compris ;
  - elle posait l'enregistreur 8 s apres l'ouverture, donc ne voyait jamais le demarrage ;
  - elle chargeait le dossier de travail, que l'autre agent modifie pendant la mesure ;
  - elle ne disait pas si la machine etait occupee ailleurs, alors que deux navigateurs qui
    decodent de la video en meme temps font perdre des images a l'un comme a l'autre.

Maintenant : arret par PID ; enregistreur installe avant tout script de la page ; --ext pour
mesurer une copie figee ; charge processeur et navigateurs d'essai concurrents releves pendant
toute la mesure, et un verdict « mesure propre » ou non.

Usage: py -3.14 admeasure.py <chaine> <minutes> [etiquette] [--ext <dossier>] [--commit <sha>] [--enregistrer]
  --ext          extension a charger (defaut : la copie dans laquelle vit le script)
  --commit       consigne le commit dont la copie est tiree, pour que la reference soit retracable
  --enregistrer  ecrit perf-reference.json (resume et contexte, sans journal ni releves),
                 SEULEMENT si la mesure est propre
Sortie : admeasure-<etiquette>.json (releves, journal, resume) ; analyse.py lit le meme fichier.
"""
import asyncio
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request

import psutil
import websockets

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))


def option(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


EXT_OPT = option('--ext')
COMMIT = option('--commit')
# **Derive du chemin du script, jamais code en dur.** Voir probe2.py.
EXT = os.path.abspath(EXT_OPT or os.environ.get('EXT_PATH') or os.path.join(HERE, '..', '..'))
ARGS = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (EXT_OPT, COMMIT)]
CHANNEL = ARGS[0] if ARGS else 'zerator'
MINUTES = float(ARGS[1]) if len(ARGS) > 1 else 3.0
TAG = ARGS[2] if len(ARGS) > 2 else CHANNEL

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PROFILE = os.path.join(HERE, 'ad-profile')
PORT = 9466
# **Sur le deuxieme ecran, pas sur celui ou travaille l'utilisateur.** Voir fscheck.py.
ECRAN2 = ['--window-position=1960,40', '--window-size=1600,950']

SAMPLE_MS = 500
STALL_S = 1.5

# Installe avant tout script de la page (Page.addScriptToEvaluateOnNewDocument) : le premier
# releve part du chargement, donc le temps jusqu'a la premiere image est mesurable.
# **Deux noms par element** : le renommage avance lot par lot, voir fscheck.py.
RECORDER = r'''
(() => {
  if (window.__adRec) { return; }
  window.__adRec = [];
  const AD_CLASSES = ['advert'];
  const STATE_ATTRS = ['data-state'];
  setInterval(() => {
    const v = document.querySelector('video');
    if (!v || !document.body) { return; }
    let q = null;
    try { q = v.getVideoPlaybackQuality(); } catch (e) {}
    let state = null;
    for (const a of STATE_ATTRS) { if (document.body.hasAttribute(a)) { state = document.body.getAttribute(a); break; } }
    window.__adRec.push({
      t: Math.round(performance.now()),
      ct: +v.currentTime.toFixed(3),
      rs: v.readyState,
      paused: v.paused,
      end: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(3) : null,
      ahead: v.buffered.length
        ? +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(2) : null,
      frames: q ? q.totalVideoFrames : null,
      dropped: q ? q.droppedVideoFrames : null,
      ad: AD_CLASSES.some((c) => document.body.classList.contains(c)),
      state
    });
  }, %d);
})();
''' % SAMPLE_MS

READ_BACK = r'''
JSON.stringify({
  samples: window.__adRec || [],
  log: (() => {
    try {
      const d = m_Log.GetDataForReport();
      const text = typeof d === "string" ? d : JSON.stringify(d);
      return text.split(String.fromCharCode(10)).slice(-800);
    } catch (e) { return ["journal illisible : " + e]; }
  })()
})
'''


def stop(proc):
    # **Jamais taskkill /IM chrome.exe** : cela tue les navigateurs de l'utilisateur et les essais
    # de l'autre agent. Seulement l'arbre du processus lance ici.
    if proc and proc.poll() is None:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def autres_navigateurs_essai(own_pid):
    """Chrome lances par un harnais (port de debogage), hors le notre."""
    n = 0
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if (p.info['name'] or '').lower() != 'chrome.exe' or p.info['pid'] == own_pid:
                continue
            cmd = ' '.join(p.info['cmdline'] or [])
            if '--remote-debugging-port' in cmd and '--type=' not in cmd:
                n += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return n


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, params=None, session=None, timeout=30):
        self.n += 1
        mid = self.n
        msg = {'id': mid, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        await self.ws.send(json.dumps(msg))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=deadline - time.time())
            got = json.loads(raw)
            if got.get('id') == mid:
                if 'error' in got:
                    raise RuntimeError('%s -> %s' % (method, got['error']))
                return got.get('result', {})
        raise TimeoutError(method)


def runs(samples, pred):
    """Suites d'au moins STALL_S secondes ou pred(a, b) est vrai. Rend [(debut_ms, duree_s, releve)]."""
    out, start = [], None
    for i in range(1, len(samples)):
        a, b = samples[i - 1], samples[i]
        if pred(a, b):
            if start is None:
                start = a
        elif start is not None:
            d = (a['t'] - start['t']) / 1000.0
            if d >= STALL_S:
                out.append((start['t'], d, start))
            start = None
    return out


def resume(samples, contention):
    if len(samples) < 4:
        return {'erreur': 'moins de quatre releves'}
    first = next((s for s in samples if (s['frames'] or 0) > 0), None)
    last = samples[-1]
    duree = (last['t'] - samples[0]['t']) / 1000.0
    playing = [s for s in samples if not s['paused']]
    frames = (last['frames'] or 0) - ((first['frames'] or 0) if first else 0)
    dropped = (last['dropped'] or 0) - ((first['dropped'] or 0) if first else 0)
    lecture = (last['ct'] - first['ct']) if first else 0.0
    gels = runs(samples, lambda a, b: not b['paused'] and abs(b['ct'] - a['ct']) < 0.01)
    figee = runs(samples, lambda a, b: a['frames'] is not None and b['frames'] is not None
                 and b['frames'] == a['frames'] and abs(b['ct'] - a['ct']) > 0.01)
    ahead = sorted(s['ahead'] for s in playing if s['ahead'] is not None)
    ad_s = sum(1 for s in samples if s['ad']) * SAMPLE_MS / 1000.0
    passages = sum(1 for i in range(1, len(samples)) if samples[i]['ad'] and not samples[i - 1]['ad'])
    cpu = [c['cpu'] for c in contention]
    return {
        'duree_s': round(duree, 1),
        'premiere_image_ms': first['t'] if first else None,
        'images_decodees': frames,
        'images_perdues': dropped,
        'perte_pour_mille': round(1000.0 * dropped / frames, 2) if frames else None,
        'cadence_ips': round(frames / lecture, 1) if lecture > 0 else None,
        'lecture_sur_horloge': round(lecture / duree, 3) if duree else None,
        'gels': len(gels), 'gels_s': round(sum(d for _, d, _ in gels), 1),
        'image_figee': len(figee), 'image_figee_s': round(sum(d for _, d, _ in figee), 1),
        'tampon_median_s': ahead[len(ahead) // 2] if ahead else None,
        'tampon_p10_s': ahead[len(ahead) // 10] if ahead else None,
        'tampon_min_s': ahead[0] if ahead else None,
        'publicite_s': ad_s, 'passages_publicite': passages,
        'cpu_median_pct': round(statistics.median(cpu), 1) if cpu else None,
        'cpu_max_pct': round(max(cpu), 1) if cpu else None,
        'autres_navigateurs_essai_max': max((c['autres'] for c in contention), default=0),
    }


async def run():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen([CHROME, '--no-first-run', '--no-default-browser-check',
                             '--user-data-dir=' + PROFILE,
                             '--enable-unsafe-extension-debugging',
                             '--remote-debugging-port=%d' % PORT,
                             '--remote-allow-origins=*',
                             '--autoplay-policy=no-user-gesture-required',
                             # Une fenetre masquee ou en arriere-plan est bridee : cela simulerait un gel.
                             '--disable-backgrounding-occluded-windows',
                             '--disable-renderer-backgrounding',
                             '--disable-background-timer-throttling'] + ECRAN2 + ['about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    contention = []
    try:
        ver = None
        for _ in range(25):
            time.sleep(1)
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % PORT, timeout=5) as r:
                    ver = json.load(r)
                break
            except Exception:
                pass
        if not ver:
            print('ECHEC : aucun point d\'entree DevTools')
            return 1

        psutil.cpu_percent(interval=None)  # amorce la mesure de charge
        async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as ws:
            cdp = Cdp(ws)
            ext_id = (await cdp.call('Extensions.loadUnpacked', {'path': EXT}))['id']
            url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)
            tgt = await cdp.call('Target.createTarget', {'url': 'about:blank'})
            sid = (await cdp.call('Target.attachToTarget',
                                  {'targetId': tgt['targetId'], 'flatten': True}))['sessionId']
            await cdp.call('Page.enable', {}, session=sid)
            await cdp.call('Runtime.enable', {}, session=sid)
            await cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': RECORDER}, session=sid)
            await cdp.call('Page.navigate', {'url': url}, session=sid)
            debut = time.strftime('%Y-%m-%d %H:%M:%S')
            print('mesure : %s, %.1f min, extension %s%s' % (CHANNEL, MINUTES, EXT,
                                                              ' (commit %s)' % COMMIT if COMMIT else ''))

            total = MINUTES * 60
            t0 = time.time()
            while time.time() - t0 < total:
                await asyncio.sleep(min(30, max(0.1, total - (time.time() - t0))))
                c = {'t': round(time.time() - t0), 'cpu': psutil.cpu_percent(interval=None),
                     'autres': autres_navigateurs_essai(proc.pid)}
                contention.append(c)
                probe = await cdp.call('Runtime.evaluate',
                                       {'expression': '(window.__adRec||[]).length + "/" + '
                                                      '((window.__adRec||[]).filter(s=>s.ad).length)',
                                        'returnByValue': True}, session=sid)
                print('  %5.1f min  releves/pub = %s   cpu %.0f%%   autres essais %d'
                      % ((time.time() - t0) / 60, probe.get('result', {}).get('value'), c['cpu'], c['autres']))

            out = await cdp.call('Runtime.evaluate', {'expression': READ_BACK, 'returnByValue': True},
                                 session=sid, timeout=60)
            payload = json.loads(out.get('result', {}).get('value') or '{}')
    finally:
        stop(proc)

    samples = payload.get('samples', [])
    payload['meta'] = {'chaine': CHANNEL, 'minutes': MINUTES, 'debut': debut, 'extension': EXT,
                       'commit': COMMIT, 'releve_ms': SAMPLE_MS, 'navigateur': ver.get('Browser')}
    payload['contention'] = contention
    payload['resume'] = r = resume(samples, contention)
    path = os.path.join(HERE, 'admeasure-%s.json' % TAG)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False)

    print('\n%d releves -> %s' % (len(samples), path))
    for k, v in r.items():
        print('  %-30s %s' % (k, v))
    if 'erreur' in r or not r.get('images_decodees'):
        print('ECHEC : aucune lecture mesuree (chaine hors ligne ?). Ce fichier n\'est pas une reference.')
        return 1
    # **Une reference prise sur une machine occupee ment.** On le dit, sans jeter la mesure.
    if r['autres_navigateurs_essai_max'] or (r['cpu_median_pct'] or 0) > 50:
        print('MESURE NON PROPRE : %d autre(s) navigateur(s) d\'essai, cpu median %s%%. '
              'A refaire machine calme avant d\'en faire une reference.'
              % (r['autres_navigateurs_essai_max'], r['cpu_median_pct']))
        return 2
    print('OK : mesure propre (aucun autre essai, cpu median %s%%).' % r['cpu_median_pct'])
    if '--enregistrer' in sys.argv:
        # Le resume et son contexte seulement : le journal contient des jetons publicitaires.
        ref = os.path.join(HERE, 'perf-reference.json')
        with open(ref, 'w', encoding='utf-8') as fh:
            json.dump({'meta': payload['meta'], 'resume': r}, fh, ensure_ascii=False, indent=1)
        print('reference enregistree : %s' % ref)
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(run()))
