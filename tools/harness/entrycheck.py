# -*- coding: utf-8 -*-
"""Opens a real twitch.tv channel with the extension loaded and reports how the
alternate player can be reached: whether the page auto-redirects, and whether the
extension's button actually anchors into Twitch's current DOM.
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

# La console de Windows n'est pas en UTF-8 : sans cela, un titre de chaine en chinois tue le script.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
# **Derive du chemin du script, jamais code en dur.** Le harnais doit eprouver la copie dans
# laquelle il vit : pointer sur un dossier fixe reviendrait a tester l'extension chargee dans
# le navigateur de l'utilisateur pendant qu'il s'en sert, et a la casser sous lui.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9505
PROFILE = os.path.join(HERE, 'entry-profile')
CHANNEL = sys.argv[1] if len(sys.argv) > 1 else 'fps_shaka'

# **Deux noms, et un compte.** L'identifiant du bouton a ete traduit, d'ou l'ancien et le nouveau.
# Le compte vient d'un defaut d'amont : le HTML injecte contenait des lignes « // <button
# id=...> » heritees de la convention des commentaires jumeaux. Dans un gabarit, ce ne sont pas
# des commentaires, et le navigateur construisait un second bouton imbrique dans le premier, avec
# le meme identifiant. Un seul bouton doit exister.
PROBE = r'''
(() => {
  const ids = ['tw5-autoredirect'];
  const btn = ids.map((i) => document.getElementById(i)).find(Boolean) || null;
  const buttonCount = ids.reduce((n, i) => n + document.querySelectorAll('[id="' + i + '"]').length, 0);
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const names = ['--button-size-default','--border-radius-medium',
                 '--color-background-button-text-default','--color-fill-button-icon',
                 '--color-background-tooltip','--font-size-6'];
  const tokens = {};
  for (const n of names) {
    tokens[n] = (root.getPropertyValue(n) || body.getPropertyValue(n) || '').trim() || 'UNDEFINED';
  }
  const cs = btn ? getComputedStyle(btn) : null;
  return JSON.stringify({
    buttonInserted: !!btn,
    buttonCount: buttonCount,
    computedWidth: cs ? cs.width : null,
    computedHeight: cs ? cs.height : null,
    tokens: tokens
  });
})()
'''


def stop(proc):
    if proc and proc.poll() is None:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def rpc(ws, n, method, params=None, timeout=40):
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


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + PROFILE, '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % PORT, '--remote-allow-origins=*',
         '--window-position=-2400,-2400', '--window-size=1400,900',
         '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ver = None
        for _ in range(30):
            time.sleep(1)
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % PORT,
                                            timeout=5) as r:
                    ver = json.load(r)
                break
            except Exception:
                pass
        async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=None,
                                      ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                print('loadUnpacked ->', str(r)[:300])
                return

        page = None
        for _ in range(15):
            with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT,
                                        timeout=6) as r:
                for t in json.load(r):
                    if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                        page = t
                        break
            if page:
                break
            time.sleep(1)

        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None,
                                      ping_interval=None) as pws:
            await rpc(pws, 1, 'Page.navigate',
                      {'url': 'https://www.twitch.tv/' + CHANNEL + '?twitch5=0'})
            for wait in (15, 15):
                await asyncio.sleep(wait)
                got = await rpc(pws, 2, 'Runtime.evaluate',
                                {'expression': PROBE, 'returnByValue': True})
                val = got.get('result', {}).get('result', {}).get('value')
                try:
                    for k, v in json.loads(val).items():
                        print('  %-16s %s' % (k, str(v)[:100]))
                except Exception:
                    print('  raw:', str(val)[:200])
                print('  ---')
            import base64
            shot = await rpc(pws, 9, 'Page.captureScreenshot', {'format': 'png'})
            d = shot.get('result', {}).get('data')
            if d:
                open(os.path.join(HERE, 'entry.png'), 'wb').write(base64.b64decode(d))
                print('  screenshot -> entry.png')
    finally:
        stop(proc)


asyncio.run(main())
