# -*- coding: utf-8 -*-
"""Eprouve la reprise des reglages ecrits sous les anciens noms russes.

Le renommage des cles de chrome.storage est le seul changement de tout ce chantier qui touche aux
donnees de l'utilisateur. S'il rate, rien ne le signale : le schema ne trouve simplement aucune
valeur pour chaque nom, retombe sur ses valeurs par defaut, et l'utilisateur decouvre au lancement
suivant que sa taille de tampon, la position de son chat et ses couleurs sont revenues d'usine.
Aucune erreur, aucune ligne en console. Un renommage verifie seulement par « ca joue toujours »
laisserait passer exactement ca.

L'essai fabrique donc un profil d'avant le renommage : il ecrit les anciennes cles dans le
stockage, recharge le lecteur, et verifie que les valeurs sont arrivees jusqu'aux controles.

Trois cas, parce que la migration a trois comportements a tenir :
  1. reprise      une ancienne cle seule -> sa valeur doit survivre.
  2. preseance    ancienne ET nouvelle cle -> la nouvelle gagne, toujours. Sans quoi relancer la
                  migration effacerait un reglage change depuis.
  3. profil neuf  aucune ancienne cle -> les valeurs par defaut, et rien qui casse.

Usage: migrationcheck.py <chrome|vivaldi>   (--voir pour suivre a l'ecran)
"""
import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
LOCALAPPDATA = os.environ.get('LOCALAPPDATA', '')

VOIR = '--voir' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
WHICH = ARGS[0] if ARGS else 'chrome'

BIN = {
    'chrome': r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'vivaldi': os.path.join(LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe'),
}[WHICH]
PORT = {'chrome': 9498, 'vivaldi': 9499}[WHICH]
PROFILE = os.path.join(HERE, 'migrationcheck-' + WHICH)
CHANNEL = ARGS[1] if len(ARGS) > 1 else 'zerator'
OUT = os.path.join(HERE, 'migrationcheck-out.txt')
ECRAN2 = ['--window-position=1960,40', '--window-size=1600,950']

# **Lire le reglage, pas le controle.** Un premier essai lisait la valeur affichee par le
# panneau : elle passe par un systeme de prereglages qui ecrase la valeur stockee, si bien que
# les trois cas rendaient la meme valeur par defaut et que l'essai accusait la migration d'un
# defaut qui n'etait pas le sien. m_Settings est une constante de haut niveau, donc accessible
# depuis la page : on l'interroge directement.
#
# bMute est un booleen simple, absent des prereglages, dont le defaut est false : une valeur
# true ne peut venir que du stockage.
ANCIEN = u'лПриглушить'  # лПриглушить
NOUVEAU = 'bMute'

LIRE = u"""
(() => {
  try {
    return JSON.stringify({ ok: true, valeur: m_Settings.Get('%s') });
  } catch (e) {
    return JSON.stringify({ ok: false, erreur: String(e) });
  }
})()
""" % NOUVEAU


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
            got = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.time()))
        except asyncio.TimeoutError:
            return {'__timeout__': method}
        if got.get('id') == n:
            return got
    return {'__timeout__': method}


class Counter(object):
    def __init__(self):
        self.n = 100

    def next(self):
        self.n += 1
        return self.n


async def evaluer(ws, c, expr, attendre=False):
    got = await rpc(ws, c.next(), 'Runtime.evaluate',
                    {'expression': expr, 'returnByValue': True, 'awaitPromise': attendre})
    r = got.get('result', {})
    if r.get('exceptionDetails'):
        d = r['exceptionDetails']
        return {'__erreur__': (d.get('exception') or {}).get('description') or d.get('text')}
    return r.get('result', {}).get('value')


async def un_cas(pws, c, out, titre, ecrire, attendu):
    """Vide le stockage, y ecrit ce que decrit `ecrire`, recharge, et lit le controle."""
    vide = await evaluer(pws, c, "new Promise(r => chrome.storage.local.clear(() => r('ok')))", True)
    if vide != 'ok':
        out.write(u"  %s : stockage non vide (%s)\n" % (titre, vide))
        return False
    if ecrire:
        pose = await evaluer(
            pws, c,
            "new Promise(r => chrome.storage.local.set(%s, () => r('ok')))" % json.dumps(ecrire),
            True)
        if pose != 'ok':
            out.write(u"  %s : ecriture refusee (%s)\n" % (titre, pose))
            return False
    await rpc(pws, c.next(), 'Page.reload', {'ignoreCache': True})
    await asyncio.sleep(9)
    brut = await evaluer(pws, c, LIRE)
    try:
        d = json.loads(brut)
    except Exception:
        out.write(u"  %s : lecture illisible (%s)\n" % (titre, str(brut)[:200]))
        return False
    if not d['ok']:
        out.write(u"  %s : reglage illisible (%s)\n" % (titre, d.get('erreur')))
        return False
    lu = d['valeur']
    ok = lu == attendu
    out.write(u"  %-46s attendu %-7s lu %-9s %s\n"
              % (titre, attendu, lu, 'ok' if ok else 'ECHEC'))
    return ok


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    cmd = [BIN, '--no-first-run', '--no-default-browser-check',
           '--user-data-dir=' + PROFILE,
           '--enable-unsafe-extension-debugging',
           '--remote-debugging-port=%d' % PORT,
           '--remote-allow-origins=*',
           '--autoplay-policy=no-user-gesture-required']
    cmd += ECRAN2 if VOIR else ['--headless=new', '--window-size=1280,800']
    cmd.append('about:blank')
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = io.open(OUT, 'w', encoding='utf-8')
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
            out.write(u"aucun point d'entree DevTools\n")
            return 1

        async with websockets.connect(ver['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                out.write(u"loadUnpacked -> %s\n" % str(r)[:300])
                return 1
            ext_id = r['result']['id']
        # **Avec une chaine.** Sans parametre le lecteur ne monte pas son panneau de
        # reglages, et l'essai croit a tort que le controle a disparu.
        url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)

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
            out.write(u"aucune cible de page\n")
            return 1

        c = Counter()
        async with websockets.connect(page['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as pws:
            await rpc(pws, c.next(), 'Page.enable')
            await rpc(pws, c.next(), 'Runtime.enable')
            await rpc(pws, c.next(), 'Page.navigate', {'url': url})
            await asyncio.sleep(10)

            out.write(u"REPRISE DES REGLAGES ECRITS SOUS LES ANCIENS NOMS\n\n")
            # Le schema exige une version valide, sinon il efface tout et l'essai ne prouve rien.
            version = {'nSettingsVersion': 1}
            cas = [
                (u"1. ancienne cle seule -> valeur reprise",
                 dict(version, **{ANCIEN: True}), True),
                (u"2. ancienne et nouvelle -> la nouvelle gagne",
                 dict(version, **{ANCIEN: True, NOUVEAU: False}), False),
                (u"3. nouvelle seule -> inchangee",
                 dict(version, **{NOUVEAU: True}), True),
                (u"4. profil neuf -> valeur par defaut", dict(version), False),
            ]
            bons = 0
            for titre, ecrire, attendu in cas:
                if await un_cas(pws, c, out, titre, ecrire, attendu):
                    bons += 1

        out.write(u"\n" + u"=" * 60 + u"\n")
        if bons == len(cas):
            out.write(u"OK : les %d cas passent, les reglages survivent au renommage.\n" % len(cas))
            return 0
        out.write(u"ECHEC : %d cas sur %d.\n" % (len(cas) - bons, len(cas)))
        return 1
    finally:
        out.close()
        stop(proc)


sys.exit(asyncio.run(main()) or 0)
