# -*- coding: utf-8 -*-
"""Ouvre le lecteur et rapporte ce que la console dit : erreurs, exceptions non rattrapees.

probe2.py dit *que* la lecture n'a pas eu lieu. Il ne dit pas pourquoi, et deviner la cause a
partir d'un state=None coute plus cher que de la lire. Ce script ecoute Runtime.consoleAPICalled
et Runtime.exceptionThrown des le debut du chargement, donc il attrape aussi ce qui casse avant
que la page soit prete.

Usage: errors.py <chrome|vivaldi> [chaine] [secondes]   (--voir pour suivre a l'ecran)
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
CHANNEL = ARGS[1] if len(ARGS) > 1 else 'caedrel'
SECONDS = int(ARGS[2]) if len(ARGS) > 2 else 20

BIN = {
    'chrome': r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'vivaldi': os.path.join(LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe'),
}[WHICH]
PORT = {'chrome': 9495, 'vivaldi': 9496}[WHICH]
PROFILE = os.path.join(HERE, 'errors-' + WHICH)
OUT = os.path.join(HERE, 'errors-out.txt')

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


async def send(ws, n, method, params=None):
    await ws.send(json.dumps({'id': n, 'method': method, 'params': params or {}}))


def texte(arg):
    if 'value' in arg:
        return unicode_safe(arg['value'])
    if arg.get('description'):
        return unicode_safe(arg['description'])
    return unicode_safe(arg.get('type', '?'))


def unicode_safe(v):
    try:
        return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    except Exception:
        return repr(v)


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    cmd = [BIN, '--no-first-run', '--no-default-browser-check',
           '--user-data-dir=' + PROFILE,
           '--enable-unsafe-extension-debugging',
           '--remote-debugging-port=%d' % PORT,
           '--remote-allow-origins=*',
           '--autoplay-policy=no-user-gesture-required']
    if VOIR:
        cmd += ECRAN2
    else:
        cmd += ['--headless=new', '--window-size=1280,800']
    cmd.append('about:blank')
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    out = io.open(OUT, 'w', encoding='utf-8')
    erreurs = 0
    # **worker.js n'est pas toujours sollicite** : voir le bilan en fin de fichier.
    vu_worker = []
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
            await send(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            ext_id = None
            deadline = time.time() + 25
            while time.time() < deadline:
                got = json.loads(await asyncio.wait_for(bws.recv(), timeout=25))
                if got.get('id') == 1:
                    if 'result' not in got:
                        out.write(u"loadUnpacked -> %s\n" % str(got)[:400])
                        return 1
                    ext_id = got['result']['id']
                    break
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

        async with websockets.connect(page['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as pws:
            # Ecouter AVANT de naviguer : l'erreur qui compte arrive souvent au chargement.
            await send(pws, 10, 'Runtime.enable')
            await send(pws, 11, 'Log.enable')
            await send(pws, 12, 'Page.enable')
            await send(pws, 13, 'Page.navigate', {'url': url})

            fin = time.time() + SECONDS
            prochain_guet = 0.0
            while time.time() < fin:
                # **Guetter le fil de transcodage pendant l'essai, pas apres.** Le lecteur le cree
                # et le termine au fil des segments : chercher une seule fois a la fin revient a
                # tirer a pile ou face, ce qui a d'abord donne « oui » puis « non » sur la meme
                # chaine. Des qu'il parait, on note son adresse.
                if time.time() > prochain_guet:
                    prochain_guet = time.time() + 2
                    try:
                        for t in http('/json/list'):
                            u = t.get('url') or ''
                            if u.endswith('/worker.js') and t.get('webSocketDebuggerUrl'):
                                vu_worker.append(t)
                                break
                    except Exception:
                        pass
                try:
                    raw = await asyncio.wait_for(pws.recv(), timeout=max(0.5, fin - time.time()))
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                method = msg.get('method')
                if method == 'Runtime.exceptionThrown':
                    d = msg['params']['exceptionDetails']
                    desc = (d.get('exception') or {}).get('description') or d.get('text')
                    out.write(u"\nEXCEPTION NON RATTRAPEE\n  %s\n" % unicode_safe(desc))
                    for f in (d.get('stackTrace') or {}).get('callFrames', [])[:6]:
                        out.write(u"    %s  %s:%s\n" % (f.get('functionName') or '(anonyme)',
                                                        (f.get('url') or '').split('/')[-1],
                                                        f.get('lineNumber')))
                    erreurs += 1
                elif method == 'Runtime.consoleAPICalled':
                    p = msg['params']
                    if p['type'] in ('error', 'warning'):
                        args = u' '.join(texte(a) for a in p.get('args', []))
                        out.write(u"\n%s CONSOLE : %s\n" % (p['type'].upper(), args[:600]))
                        if p['type'] == 'error':
                            erreurs += 1
                elif method == 'Log.entryAdded':
                    e = msg['params']['entry']
                    if e.get('level') in ('error', 'warning'):
                        out.write(u"\n%s %s : %s\n" % (e['level'].upper(), e.get('source'),
                                                        unicode_safe(e.get('text'))[:400]))
                        if e['level'] == 'error':
                            erreurs += 1

        out.write(u"\n" + u"=" * 60 + u"\n")
        # Les lignes de journal du transcodeur ne remontent pas a la console : leur niveau est
        # filtre. La cible « worker » du navigateur, elle, existe des que le fil est cree, et
        # le lecteur ne le cree que pour transcoder du MPEG-TS. C'est donc elle qu'on regarde.
        # **Ce signal ne vaut que dans un sens.** Le fil est cree et termine au fil des segments,
        # et Chrome ne liste pas les fils dedies de facon fiable : le meme essai sur la meme
        # chaine a rendu « oui » puis « non ». Un oui prouve que worker.js a tourne ; un non ne
        # prouve rien, ni dans un sens ni dans l'autre.
        fils = vu_worker or [t for t in http('/json/list')
                             if (t.get('url') or '').endswith('/worker.js')]
        if fils:
            out.write(u"worker.js exerce : OUI, fil de transcodage vu tourner\n")
        else:
            out.write(u"worker.js exerce : INDETERMINE — fil non apercu, ce qui ne veut pas dire\n"
                      u"  qu'il n'a pas tourne. Soit la chaine diffuse du fMP4 et emprunte le\n"
                      u"  passe-plat, soit le fil a simplement echappe au releve.\n")
        if fils:
            # Le fil existe, mais travaille-t-il ? On le lui demande. Interroger ses variables
            # par leur nouveau nom prouve deux choses d'un coup : que le renommage est bien en
            # vigueur dans le code qui tourne, et que le transcodeur a recu de la matiere.
            try:
                async with websockets.connect(fils[0]['webSocketDebuggerUrl'],
                                              max_size=None, ping_interval=None) as wws:
                    await send(wws, 90, 'Runtime.enable')
                    await send(wws, 91, 'Runtime.evaluate', {
                        'expression': "JSON.stringify({assembleur: typeof _oAssembler,"
                                      " tas: _mbHeap ? _mbHeap.length : 0,"
                                      " pisteVideo: typeof _trVideo,"
                                      " semplesVideo: _trVideo ? _trVideo.GetSampleCount() : -1})",
                        'returnByValue': True})
                    fin2 = time.time() + 10
                    while time.time() < fin2:
                        got = json.loads(await asyncio.wait_for(wws.recv(),
                                                                timeout=max(0.5, fin2 - time.time())))
                        if got.get('id') == 91:
                            v = got.get('result', {}).get('result', {}).get('value')
                            out.write(u"  etat interne du transcodeur : %s\n" % unicode_safe(v))
                            break
            except Exception as e:
                out.write(u"  etat interne illisible : %s\n" % e)
        out.write(u"erreurs relevees : %d\n" % erreurs)
        return 0
    finally:
        out.close()
        stop(proc)


sys.exit(asyncio.run(main()) or 0)
