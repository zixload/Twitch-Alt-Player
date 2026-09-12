# -*- coding: utf-8 -*-
"""Mesure la geometrie de la barre laterale en fenetre puis en plein ecran.

Le commentaire de sidebar.css affirme que « la barre est soeur de l'element plein ecran, donc le
navigateur la masque automatiquement ». Une capture d'ecran de l'utilisateur montre le contraire.
Ce script tranche : il demande le plein ecran par le vrai chemin du lecteur, puis interroge
elementFromPoint, qui dit ce qui est reellement peint a un endroit — pas ce que le CSS pretend.

Tourne sans affichage : rien n'apparait sur l'ecran de l'utilisateur pendant qu'il regarde.

Usage: fscheck.py <chrome|vivaldi> [chaine]
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
# **Derive du chemin du script, jamais code en dur.** Voir probe2.py.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
LOCALAPPDATA = os.environ.get('LOCALAPPDATA', '')

VOIR = '--voir' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
WHICH = ARGS[0] if ARGS else 'chrome'
CHANNEL = ARGS[1] if len(ARGS) > 1 else 'caedrel'

BIN = {
    'chrome': r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'vivaldi': os.path.join(LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe'),
}[WHICH]
PORT = {'chrome': 9493, 'vivaldi': 9494}[WHICH]
PROFILE = os.path.join(HERE, 'fscheck-' + WHICH)
OUT = os.path.join(HERE, 'fscheck-out.txt')

# **Sur le deuxieme ecran, pas sur celui ou travaille l'utilisateur.**
# Releve de la disposition reelle : DISPLAY1 principal en 0,0 (1920x1080) et DISPLAY2 en
# 1920,0 (1680x1050). La fenetre se pose donc a 1960,40, soit 40 px a l'interieur du second.
ECRAN2 = ['--window-position=1960,40', '--window-size=1600,950']


# **Deux noms par element : celui d'avant le renommage, celui d'apres.** Le renommage avance lot
# par lot, et des noms figes ici ont fait echouer l'essai sur un arbre sain ("bouton absent",
# "lecteur : None") des qu'un lot a traduit ces trois noms. Le premier nom present gagne ;
# aucun present fait echouer l'essai, jamais passer.
PLAYER_IDS = [u'\u043f\u0440\u043e\u0438\u0433\u0440\u044b\u0432\u0430\u0442\u0435\u043b\u044c\u0438\u0447\u0430\u0442',
              u'playerandchat']
CHAT_TOGGLE_IDS = [u'\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0447\u0430\u0442', u'togglechat']
CHAT_HIDDEN_CLASSES = [u'\u0441\u043a\u0440\u044b\u0442\u044c\u0447\u0430\u0442', u'hidechat']

NAMES_JS = u"""
  const byId = (ids) => ids.map((i) => document.getElementById(i)).find(Boolean) || null;
  const PLAYER_IDS = %s, CHAT_TOGGLE_IDS = %s, CHAT_HIDDEN = %s;
  const chatHidden = () => CHAT_HIDDEN.some((c) => document.body.classList.contains(c));
""" % (json.dumps(PLAYER_IDS), json.dumps(CHAT_TOGGLE_IDS), json.dumps(CHAT_HIDDEN_CLASSES))

# Clique le bouton du chat par le vrai chemin du lecteur.
CLICK_CHAT = (u"(() => {" + NAMES_JS
              + u" const b = byId(CHAT_TOGGLE_IDS); if (!b) return 'bouton absent'; b.click();"
              u" return chatHidden() ? 'encore masque' : 'chat affiche'; })()")

# Le plein ecran exige un geste utilisateur, que CDP simule (userGesture).
FULLSCREEN = (u"(() => {" + NAMES_JS
              + u" const p = byId(PLAYER_IDS); if (!p) return Promise.resolve('lecteur absent');"
              u" return p.requestFullscreen().then(() => 'ok', (e) => 'refus: ' + e.name); })()")

# Ce qu'on mesure. elementFromPoint est l'arbitre : il rend ce qui est peint et testable au
# point donne, donc il distingue "la barre existe dans le DOM" de "la barre couvre la video".
MEASURE = u'''
(() => {''' + NAMES_JS + u'''
  const sb = document.getElementById('alt-sidebar');
  const pc = byId(PLAYER_IDS);
  const v  = document.querySelector('video');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height)};
  };
  const cs = sb ? getComputedStyle(sb) : null;
  let hit = null;
  if (sb) {
    const r = sb.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(40, r.height / 2));
      hit = el ? (el.id || el.className || el.tagName) : null;
      hit = String(hit).slice(0, 60);
    }
  }
  return JSON.stringify({
    fsElement: document.fullscreenElement ? (document.fullscreenElement.id || 'sans-id') : null,
    innerW: window.innerWidth, innerH: window.innerHeight,
    sidebarHidden: sb ? sb.hasAttribute('hidden') : 'absente',
    sidebarDisplay: cs ? cs.display : null,
    sidebarZ: cs ? cs.zIndex : null,
    sidebar: box(sb), playerchat: box(pc), video: box(v),
    hitAtSidebarCentre: hit,
    chatHidden: chatHidden()
  });
})()
'''


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


async def measure(ws, c, out, label):
    got = await rpc(ws, c.next(), 'Runtime.evaluate',
                    {'expression': MEASURE, 'returnByValue': True})
    val = got.get('result', {}).get('result', {}).get('value')
    try:
        d = json.loads(val)
    except Exception:
        out.write(u"\n--- %s ---\n  illisible : %s\n" % (label, str(val)[:300]))
        return None
    out.write(u"\n--- %s ---\n" % label)
    out.write(u"  element plein ecran : %s\n" % d['fsElement'])
    out.write(u"  fenetre             : %dx%d\n" % (d['innerW'], d['innerH']))
    out.write(u"  chat masque         : %s\n" % d['chatHidden'])
    out.write(u"  barre hidden=       : %s   display=%s   z-index=%s\n"
              % (d['sidebarHidden'], d['sidebarDisplay'], d['sidebarZ']))
    out.write(u"  barre   : %s\n" % d['sidebar'])
    out.write(u"  lecteur : %s\n" % d['playerchat'])
    out.write(u"  video   : %s\n" % d['video'])
    out.write(u"  peint au centre de la barre : %s\n" % d['hitAtSidebarCentre'])
    return d


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [BIN, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + PROFILE,
         # Sans affichage par defaut pour ne rien faire surgir pendant qu'il regarde ;
         # passer --voir en argument pour suivre l'essai a l'ecran.
         ] + (ECRAN2 if VOIR else ['--headless=new']) + [
         '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % PORT,
         '--remote-allow-origins=*',
         '--window-size=1600,900',
         # Sans ca l'ecran virtuel reste en 800x600 et le plein ecran sort plus PETIT
         # que la fenetre, ce qui declenche des media queries que l'utilisateur ne voit
         # jamais et rend la mesure trompeuse.
         '--screen-info={1920x1080}',
         '--autoplay-policy=no-user-gesture-required',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        out.write(u"%s %s\n" % (WHICH, ver.get('Browser')))

        async with websockets.connect(ver['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                out.write(u"loadUnpacked -> %s\n" % str(r)[:400])
                return 1
            ext_id = r['result']['id']
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
            await asyncio.sleep(12)

            await measure(pws, c, out, u"1. FENETRE, chat masque")

            # Afficher le chat par le vrai chemin : le bouton de la barre de controle. Il fait
            # tourner trois etats (decharge, masque, panneau), d'ou la boucle.
            for essai in range(4):
                got = await rpc(pws, c.next(), 'Runtime.evaluate',
                                {'expression': CLICK_CHAT,
                                 'returnByValue': True, 'userGesture': True})
                etat = got.get('result', {}).get('result', {}).get('value')
                out.write(u"  clic sur le bouton chat (%d) -> %s\n" % (essai + 1, etat))
                if etat in ('chat affiche', 'bouton absent'):
                    break
                await asyncio.sleep(1)
            await asyncio.sleep(2)
            await measure(pws, c, out, u"2. FENETRE, chat affiche")

            # Le plein ecran exige un geste utilisateur : CDP sait en simuler un.
            got = await rpc(pws, c.next(), 'Runtime.evaluate',
                            {'expression': FULLSCREEN,
                             'awaitPromise': True, 'returnByValue': True,
                             'userGesture': True})
            verdict = got.get('result', {}).get('result', {}).get('value')
            out.write(u"\n  demande de plein ecran -> %s\n" % verdict)
            await asyncio.sleep(3)

            await measure(pws, c, out, u"3. PLEIN ECRAN, juste apres la bascule")

            # **L'ordre de l'utilisateur, qui est l'inverse du mien.** Il passe en plein ecran
            # d'abord, puis affiche le chat. Et la bascule vient justement de remasquer le chat,
            # donc c'est ce second clic, fait pendant le plein ecran, qui est le vrai cas.
            for essai in range(4):
                got = await rpc(pws, c.next(), 'Runtime.evaluate',
                                {'expression': CLICK_CHAT,
                                 'returnByValue': True, 'userGesture': True})
                etat = got.get('result', {}).get('result', {}).get('value')
                out.write(u"  clic sur le bouton chat EN PLEIN ECRAN (%d) -> %s\n"
                          % (essai + 1, etat))
                if etat in ('chat affiche', 'bouton absent'):
                    break
                await asyncio.sleep(1)
            await asyncio.sleep(2)
            d = await measure(pws, c, out, u"4. PLEIN ECRAN, chat affiche — LE CAS SIGNALE")

        # Le verdict. **La barre ne doit avoir aucune boite en plein ecran.** Compter sur le
        # navigateur pour ne pas la peindre ne suffit pas : son backdrop-filter la promeut en
        # couche de composition, et cette couche a survecu par-dessus la video chez l'utilisateur.
        # Sans boite, il n'y a plus de couche a laisser trainer.
        out.write(u"\n" + u"=" * 64 + u"\n")
        if d is None:
            out.write(u"ECHEC : mesure impossible, rien n'a ete eprouve.\n")
            return 1
        if d['fsElement'] is None:
            out.write(u"ECHEC : le plein ecran n'a pas ete accorde, rien n'est prouve.\n")
            return 1
        if d['chatHidden']:
            out.write(u"ECHEC : le chat n'a pas pu etre affiche, le cas signale n'est pas couvert.\n")
            return 1
        sb = d['sidebar'] or {}
        if sb.get('w', 0) > 0 or sb.get('h', 0) > 0:
            out.write(u"ECHEC : en plein ecran la barre occupe encore %dx%d a (%d,%d),\n"
                      u"donc sa couche peut se retrouver par-dessus la video.\n"
                      % (sb['w'], sb['h'], sb['x'], sb['y']))
            return 1
        out.write(u"OK : en plein ecran, chat affiche, la barre n'a plus aucune boite\n"
                  u"(display=%s) et rien n'est peint a sa place.\n" % d['sidebarDisplay'])
        return 0
    finally:
        out.close()
        stop(proc)


sys.exit(asyncio.run(main()) or 0)
