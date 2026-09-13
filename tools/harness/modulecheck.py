# -*- coding: utf-8 -*-
"""Fait tourner un module reecrit dans le vrai lecteur, et juge sur ce que le DOM montre.

Les controles statiques -- syntaxe, controle croise, appariement des evenements, ordre de
construction -- prouvent qu'une reecriture n'a rien perdu de ce qui se lit dans le code. Aucun ne
prouve que la pastille s'affiche encore, ni qu'elle disparait au bout de deux secondes. Le harnais
complet, lui, prouve que le flux joue : il ne touche pas un module de peripherie.

Ce script comble l'intervalle. Il charge l'extension, ouvre le lecteur, puis evalue dans la page la
sonde du module -- tools/harness/probes/<module>.js -- qui exerce le module comme le ferait un
utilisateur et rend une liste de verdicts. Chaque sonde est ecrite depuis la description du module,
avant sa reecriture, et ne lit jamais l'interieur du module : seulement le DOM et son interface.

Une sonde qui ne rend rien, ou qui rend zero verification, est un echec : un banc muet ressemble
trop a un banc qui passe.

Usage: py -3.14 tools/harness/modulecheck.py <module> [--chaine <chaine>] [--cache]
  <module>   nom du fichier de sonde, sans .js (notification, window, menu...)
  --chaine   chaine a ouvrir (defaut : zerator)
  --cache    ouvre la fenetre hors ecran au lieu du deuxieme ecran
"""
import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
# Derive du chemin du script, jamais code en dur : le harnais eprouve la copie dans laquelle il vit.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
PROBES = os.path.join(HERE, 'probes')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9505
PROFILE = os.path.join(HERE, 'module-profile')


def option(flag, default):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


MODULE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else None
CHAINE = option('--chaine', 'zerator')
# Par defaut la fenetre s'ouvre sur le deuxieme ecran, pour que Luca regarde tourner l'essai.
POSITION = '-2400,-2400' if '--cache' in sys.argv else '1960,40'


def en_direct(chaine):
    """L'apercu public d'une chaine hors ligne redirige ; en direct, il est servi."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    url = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_%s-80x45.jpg' % chaine
    try:
        return opener.open(url, timeout=10).status == 200
    except urllib.error.HTTPError:
        return False
    except Exception:
        return None


def stop(proc):
    if proc and proc.poll() is None:
        # Jamais taskkill /IM chrome.exe : ca tuerait les navigateurs de l'utilisateur.
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def rpc(ws, n, method, params=None, timeout=60):
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


async def main():
    if not MODULE:
        print(__doc__)
        return 2
    sonde = os.path.join(PROBES, MODULE + '.js')
    if not os.path.exists(sonde):
        print(u'ECHEC : aucune sonde %s' % os.path.relpath(sonde, EXT))
        return 2
    with io.open(sonde, encoding='utf-8') as fh:
        source = fh.read()

    # Sur une chaine hors ligne, la video n'a ni metadonnees ni images, et une sonde qui en depend
    # echoue pour une raison qui n'est pas la sienne. Dit avant l'essai, pas apres.
    vivante = en_direct(CHAINE)
    if vivante is False:
        print(u'ATTENTION : %s n\'est pas en direct. Les sondes qui demandent la video echoueront.'
              % CHAINE)
    elif vivante is None:
        print(u'ATTENTION : impossible de savoir si %s est en direct.' % CHAINE)
    else:
        print(u'chaine en direct : %s' % CHAINE)

    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + PROFILE, '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % PORT, '--remote-allow-origins=*',
         '--window-position=' + POSITION, '--window-size=1200,800',
         '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ver = None
        for _ in range(30):
            time.sleep(1)
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % PORT, timeout=5) as r:
                    ver = json.load(r)
                break
            except Exception:
                pass
        if not ver:
            print(u'ECHEC : Chrome n\'a pas ouvert son port de debogage')
            return 1
        async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                print(u'ECHEC : chargement de l\'extension -> %s' % str(r)[:300])
                return 1
            ext_id = r['result']['id']
        url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHAINE)

        page = None
        for _ in range(15):
            with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=6) as r:
                for t in json.load(r):
                    if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                        page = t
                        break
            if page:
                break
            time.sleep(1)
        if not page:
            print(u'ECHEC : aucune page a piloter')
            return 1

        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as pws:
            await rpc(pws, 1, 'Page.navigate', {'url': url})
            # Le lecteur se construit, se branche au flux, et pose son interface.
            await asyncio.sleep(14)
            # userGesture : le plein ecran et l'image dans l'image exigent un geste de
            # l'utilisateur. L'activation est transitoire -- quelques secondes -- donc une sonde
            # qui en a besoin s'en sert au debut, avant ses attentes.
            got = await rpc(pws, 2, 'Runtime.evaluate',
                            {'expression': source, 'returnByValue': True, 'awaitPromise': True,
                             'userGesture': True},
                            timeout=120)
            if '__timeout__' in got:
                print(u'ECHEC : la sonde n\'a pas rendu la main')
                return 1
            if 'exceptionDetails' in got.get('result', {}):
                detail = got['result']['exceptionDetails']
                print(u'ECHEC : la sonde a leve -- %s' % str(detail.get('exception', detail))[:300])
                return 1
            val = got.get('result', {}).get('result', {}).get('value')
            try:
                verdicts = json.loads(val)
            except Exception:
                print(u'ECHEC : la sonde n\'a pas rendu de verdicts lisibles : %s' % str(val)[:300])
                return 1
            if not verdicts:
                print(u'ECHEC : la sonde n\'a rendu aucune verification')
                return 1
            rates = 0
            for nom, ok, *reste in verdicts:
                detail = (u'   ' + unicode_str(reste[0])) if reste and reste[0] not in (None, '') else u''
                print(u'  %-8s %s%s' % (u'ok' if ok else u'RATE', nom, detail))
                if not ok:
                    rates += 1
            print(u'')
            print(u'%d verification(s), %d en defaut.' % (len(verdicts), rates))
            return 1 if rates else 0
    finally:
        stop(proc)


def unicode_str(x):
    return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)


sys.exit(asyncio.run(main()))
