# -*- coding: utf-8 -*-
"""Drives a Chromium browser through each page target's own WebSocket rather than a
flattened session, which is what Vivaldi accepts. Reports what the player is doing.

Usage: probe2.py <chrome|vivaldi> [channel] [seconds]
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
# **Derive du chemin du script, jamais code en dur.** Le harnais doit eprouver la copie dans
# laquelle il vit : pointer sur un dossier fixe reviendrait a tester l'extension chargee dans
# le navigateur de l'utilisateur pendant qu'il s'en sert, et a la casser sous lui.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
LOCALAPPDATA = os.environ.get('LOCALAPPDATA', '')

WHICH = sys.argv[1] if len(sys.argv) > 1 else 'vivaldi'
CHANNEL = sys.argv[2] if len(sys.argv) > 2 else 'samueletienne'
SECONDS = int(sys.argv[3]) if len(sys.argv) > 3 else 40

BIN = {
    'chrome': r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'vivaldi': os.path.join(LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe'),
}[WHICH]
PORT = {'chrome': 9491, 'vivaldi': 9492}[WHICH]
PROFILE = os.path.join(HERE, 'probe2-' + WHICH)

# **Sur le deuxieme ecran, pas sur celui ou Luca travaille.**
# Releve de la disposition reelle : DISPLAY1 principal en 0,0 (1920x1080) et DISPLAY2 en
# 1920,0 (1680x1050). La fenetre se pose donc a 1960,40, soit 40 px a l'interieur du second.
ECRAN2 = ['--window-position=1960,40', '--window-size=1600,950']



def stop(proc):
    if proc and proc.poll() is None:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def http(path):
    with urllib.request.urlopen('http://127.0.0.1:%d%s' % (PORT, path), timeout=6) as r:
        return json.load(r)


async def rpc(ws, n, method, params=None, timeout=25):
    await ws.send(json.dumps({'id': n, 'method': method, 'params': params or {}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            got = json.loads(await asyncio.wait_for(ws.recv(),
                                                    timeout=deadline - time.time()))
        except asyncio.TimeoutError:
            return {'__timeout__': method}
        if got.get('id') == n:
            return got
    return {'__timeout__': method}


PROBE = r'''
(() => {
  const v = document.querySelector('video');
  let q = null;
  try { q = v && v.getVideoPlaybackQuality(); } catch (e) {}
  return JSON.stringify({
    title: document.title,
    state: document.body.getAttribute('data-\u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435'),
    ad: document.body.classList.contains('\u0440\u0435\u043a\u043b\u0430\u043c\u0430'),
    hasVideo: !!v,
    ct: v ? +v.currentTime.toFixed(2) : null,
    rs: v ? v.readyState : null,
    ahead: v && v.buffered.length
      ? +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(2) : null,
    frames: q ? q.totalVideoFrames : null,
    body: document.body.innerText.slice(0, 160)
  });
})()
'''


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [BIN, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + PROFILE,
         '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % PORT,
         '--remote-allow-origins=*',
         ] + ECRAN2 + [
         '--disable-backgrounding-occluded-windows',
         '--disable-renderer-backgrounding',
         '--disable-background-timer-throttling',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ver = None
        for _ in range(30):
            time.sleep(1)
            try:
                ver = http('/json/version')
                break
            except Exception:
                pass
        if not ver:
            print('no DevTools endpoint')
            return
        print('%s: %s / UA %s' % (WHICH, ver.get('Browser'),
                                  ver.get('User-Agent', '').split('Chrome/')[-1][:12]))

        async with websockets.connect(ver['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                print('loadUnpacked ->', str(r)[:400])
                return
            ext_id = r['result']['id']
        url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)

        # Reuse the about:blank tab and navigate it through its own socket.
        page = None
        for _ in range(15):
            for t in http('/json/list'):
                if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                    page = t
                    break
            if page:
                break
            time.sleep(1)
        if not page:
            print('no page target')
            return

        async with websockets.connect(page['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as pws:
            nav = await rpc(pws, 1, 'Page.navigate', {'url': url})
            print('navigate:', 'TIMEOUT' if '__timeout__' in nav else 'ok')
            n = 1
            samples = []
            for i in range(SECONDS // 10):
                await asyncio.sleep(10)
                n += 1
                got = await rpc(pws, n, 'Runtime.evaluate',
                                {'expression': PROBE, 'returnByValue': True})
                if '__timeout__' in got:
                    print('  t+%02ds  evaluate TIMEOUT' % ((i + 1) * 10))
                    continue
                val = got.get('result', {}).get('result', {}).get('value')
                try:
                    d = json.loads(val)
                    samples.append(d)
                    print('  t+%02ds  state=%s ad=%s ct=%s rs=%s ahead=%s frames=%s'
                          % ((i + 1) * 10, d['state'], d['ad'], d['ct'], d['rs'],
                             d['ahead'], d['frames']))
                    if not d['hasVideo']:
                        print('         no video; body=%r' % d['body'][:120])
                except Exception:
                    print('  t+%02ds  raw=%s' % ((i + 1) * 10, str(val)[:200]))
            return verdict(samples)
    finally:
        stop(proc)


def verdict(samples):
    """Rend 0 si la lecture a vraiment eu lieu, 1 sinon.

    **Un harnais qui ne sait pas dire « rien n'a ete teste » est pire qu'aucun harnais.** Un premier
    essai sur une chaine hors ligne a rendu frames=0 sur toute la duree et ressemblait a un succes :
    aucune erreur, aucune ligne rouge, juste des zeros. Une comparaison avant/apres fondee la-dessus
    aurait valide n'importe quelle regression.
    """
    print()
    if len(samples) < 2:
        print('ECHEC : moins de deux releves, rien de mesurable')
        return 1

    frames = [s.get('frames') or 0 for s in samples]
    times = [float(s.get('ct') or 0) for s in samples]
    gained = frames[-1] - frames[0]
    advanced = times[-1] - times[0]

    print('images decodees  : %d' % gained)
    print('lecture avancee  : %.1f s' % advanced)
    print('tampon final     : %s s' % samples[-1].get('ahead'))
    print('publicite vue    : %s' % any(s.get('ad') for s in samples))

    # La lecture doit avoir avance d'au moins la moitie du temps ecoule et decode de vraies images.
    # En dessous, c'est un gel ou une chaine hors ligne, pas une lecture.
    elapsed = 10.0 * (len(samples) - 1)
    if gained < 60 or advanced < elapsed * 0.5:
        print('ECHEC : la lecture n\'a pas eu lieu (chaine hors ligne, ou lecteur bloque)')
        return 1

    print('OK : la lecture a eu lieu')
    return 0


sys.exit(asyncio.run(main()) or 0)
