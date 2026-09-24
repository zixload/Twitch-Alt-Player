# -*- coding: utf-8 -*-
"""Mesure ce que le plein ecran donne depuis la vue des videos.

PANNE REELLE. Le plein ecran enveloppe la scene des videos, pas la seule image, pour que la barre
de lecture vienne avec elle. La feuille de style en fait alors une rangee centree -- et le titre
pose sous la video est un frere de l'image : il y prenait sa part de largeur. Mesure a l'appui,
l'image commencait 223 pixels a gauche du bord, et le titre pendait a droite, coupe par l'ecran.
Une capture de l'utilisateur l'a montre avant tout controle.

Aucun controle statique ne pouvait le voir : la regle etait ecrite, valide, et ne s'applique qu'en
plein ecran. Les sondes de module ne le voient pas non plus -- le plein ecran demande un geste de
l'utilisateur, qui a expire bien avant qu'une sonde longue n'y arrive. D'ou ce script, qui demande
le plein ecran sur une evaluation fraiche et juge sur la geometrie, puis sur ce qui est reellement
peint a droite de l'image : elementFromPoint dit ce qui est la, pas ce que le CSS pretend.

Le titre, lui, a quitte la scene : il vit desormais sous elle, en frere de la scene et non de
l'image. C'est ce qui le met hors du plein ecran, et ce que ce controle verifie -- car la meme
erreur, refaite, rendrait les 223 pixels.

Tourne sans affichage : rien n'apparait sur l'ecran de l'utilisateur pendant qu'il regarde.

Usage: py -3.14 tools/harness/vodfscheck.py [chaine] [--voir]
  sortie 0 quand l'image couvre l'ecran et que rien ne la pousse sur le cote.
"""
import asyncio
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
# Derive du chemin du script, jamais code en dur : le harnais eprouve la copie dans laquelle il vit.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9512
PROFILE = os.path.join(HERE, 'vodfs-profile')
OUT = os.path.join(HERE, 'vodfscheck-out.txt')
SHOT = os.path.join(HERE, 'vodfscheck.png')

VOIR = '--voir' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
CHANNEL = ARGS[0] if ARGS else 'zerator'

OUVRIR = u"(() => { m_Videos.Open(); return 'ouverte'; })()"

# Une carte de la liste, cliquee comme le ferait un spectateur.
JOUER = (u"(() => { const a = [...document.querySelectorAll('#videos *')].filter((e) => e.offsetWidth"
         u" && /card|item/i.test(e.className || '')); if (!a.length) return 'aucune carte';"
         u" a[0].click(); return 'lance'; })()")

JOUE = (u"(() => { const v = document.getElementById('videos-video');"
        u" return JSON.stringify({ position: v ? v.currentTime : -1,"
        u" scene: !document.getElementById('videos-stage').hidden }); })()")

# Par le vrai chemin : le bouton de la barre, pas un appel direct a requestFullscreen.
PLEIN = (u"(() => { const e = document.getElementById('videos-fullscreen');"
         u" if (!e) return 'bouton absent'; e.click(); return 'clique'; })()")

SORTIR = u"(() => { if (document.fullscreenElement) { document.exitFullscreen(); } return 'sorti'; })()"

# La barre ne se montre qu'au mouvement : la reveiller pour qu'elle figure sur la capture.
MONTRER = (u"(() => { const e = document.getElementById('videos-stage');"
           u" e.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); return 'montree'; })()")

MESURE = u'''
(() => {
  const boite = (sId) => {
    const el = document.getElementById(sId);
    if (!el) { return null; }
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), l: Math.round(r.width), h: Math.round(r.height),
      position: getComputedStyle(el).position, opacite: getComputedStyle(el).opacity };
  };
  const nom = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.id || el.className || el.tagName) + '' : 'rien';
  };
  const W = window.innerWidth, H = window.innerHeight;
  const elVideo = document.getElementById('videos-video');
  return JSON.stringify({
    fenetre: [W, H],
    pleinEcran: document.fullscreenElement
      ? (document.fullscreenElement.id || document.fullscreenElement.tagName) : 'aucun',
    scene: boite('videos-stage'),
    image: boite('videos-video'),
    barre: boite('videos-controls'),
    titre: boite('videos-nowplaying'),
    titreTexte: (document.getElementById('videos-nowplaying') || {}).textContent || '',
    titreDansLaScene: (() => {
      const el = document.getElementById('videos-nowplaying');
      const elPlein = document.fullscreenElement;
      return !!(el && elPlein && elPlein.contains(el));
    })(),
    peintA: {
      centre: nom(Math.round(W / 2), Math.round(H / 2)),
      droite: nom(W - 20, Math.round(H / 2)),
      gauche: nom(20, Math.round(H / 2))
    },
    imageEstLa: elVideo === document.elementFromPoint(W - 20, Math.round(H / 2))
  }, null, 1);
})()
'''


def http(path):
    with urllib.request.urlopen('http://127.0.0.1:%d%s' % (PORT, path), timeout=6) as r:
        return json.load(r)


async def rpc(ws, n, method, params=None, timeout=40):
    await ws.send(json.dumps({'id': n, 'method': method, 'params': params or {}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        got = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.time())))
        if got.get('id') == n:
            return got
    return {'__timeout__': method}


class Compteur(object):
    def __init__(self):
        self.n = 0

    def suivant(self):
        self.n += 1
        return self.n


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + PROFILE,
         ] + ([] if VOIR else ['--headless=new']) + [
         '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % PORT,
         '--remote-allow-origins=*',
         '--window-size=1600,900',
         # Sans ca l'ecran virtuel reste en 800x600 et le plein ecran sort plus PETIT que la
         # fenetre : la mesure serait trompeuse. Meme raison que dans fscheck.py.
         '--screen-info={1920x1080}',
         '--autoplay-policy=no-user-gesture-required',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = io.open(OUT, 'w', encoding='utf-8')
    defauts = []
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
        out.write(u"%s\n" % ver.get('Browser'))

        async with websockets.connect(ver['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                out.write(u"loadUnpacked -> %s\n" % str(r)[:400])
                return 1
            ext_id = r['result']['id']

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

        c = Compteur()
        async with websockets.connect(page['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as pws:
            await rpc(pws, c.suivant(), 'Page.enable')
            await rpc(pws, c.suivant(), 'Runtime.enable')
            await rpc(pws, c.suivant(), 'Page.navigate',
                      {'url': 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)})
            await asyncio.sleep(20)

            async def dire(expr, geste=False):
                got = await rpc(pws, c.suivant(), 'Runtime.evaluate',
                                {'expression': expr, 'returnByValue': True, 'userGesture': geste})
                return got.get('result', {}).get('result', {}).get('value')

            out.write(u"  ouvrir la vue -> %s\n" % await dire(OUVRIR, True))
            await asyncio.sleep(5)
            out.write(u"  jouer une video -> %s\n" % await dire(JOUER, True))

            # Attendre que l'image avance : mesurer une video qui n'a pas demarre ne prouve rien.
            for _ in range(20):
                await asyncio.sleep(1)
                etat = json.loads(await dire(JOUE))
                if etat['scene'] and etat['position'] > 1:
                    break
            out.write(u"  lecture -> %s\n" % json.dumps(etat))
            if not (etat['scene'] and etat['position'] > 1):
                out.write(u"\naucune video ne joue : rien a mesurer.\n")
                return 1

            # Le plein ecran exige un geste de l'utilisateur, et il expire : le demander sur une
            # evaluation fraiche, jamais au bout d'une longue.
            out.write(u"\n  demande de plein ecran -> %s\n" % await dire(PLEIN, True))
            await asyncio.sleep(3)
            await dire(MONTRER)
            await asyncio.sleep(1)
            mesure = json.loads(await dire(MESURE))
            out.write(json.dumps(mesure, indent=1, ensure_ascii=False) + u"\n")

            got = await rpc(pws, c.suivant(), 'Page.captureScreenshot', {'format': 'png'})
            if 'result' in got:
                with open(SHOT, 'wb') as f:
                    f.write(base64.b64decode(got['result']['data']))
                out.write(u"\n  capture : %s\n" % SHOT)
            await dire(SORTIR, True)

        W, H = mesure['fenetre']
        image = mesure['image'] or {}
        titre = mesure['titre'] or {}
        if mesure['pleinEcran'] != 'videos-stage':
            defauts.append(u"le plein ecran ne s'est pas ouvert (%s)" % mesure['pleinEcran'])
        if abs(image.get('x', 999)) > 2:
            defauts.append(u"l'image ne commence pas au bord gauche : x=%s" % image.get('x'))
        if abs(image.get('l', 0) - W) > 2:
            defauts.append(u"l'image ne fait pas la largeur de l'ecran : %s pour %s"
                           % (image.get('l'), W))
        if abs(image.get('h', 0) - H) > 2:
            defauts.append(u"l'image ne fait pas la hauteur de l'ecran : %s pour %s"
                           % (image.get('h'), H))
        if not mesure['imageEstLa']:
            defauts.append(u"a droite de l'ecran, c'est %s qui est peint, pas l'image"
                           % mesure['peintA']['droite'])
        # Le titre est hors de la scene : rien ne peut lui reprendre de la largeur.
        if mesure['titreDansLaScene']:
            defauts.append(u"le titre est revenu dans la scene, ou il prend sa part de largeur")

        out.write(u"\n")
        if defauts:
            for d in defauts:
                out.write(u"  DEFAUT : %s\n" % d)
            out.write(u"\n%d defaut(s).\n" % len(defauts))
            return 1
        out.write(u"OK : l'image couvre l'ecran, rien a cote.\n")
        return 0
    finally:
        out.close()
        print(io.open(OUT, encoding='utf-8').read())
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


sys.exit(asyncio.run(main()))
