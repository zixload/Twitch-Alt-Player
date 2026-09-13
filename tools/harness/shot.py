# -*- coding: utf-8 -*-
"""Loads the extension, opens a channel and screenshots the player.

Usage: shot.py <channel> <seconds> <out.png>
"""
import asyncio
import base64
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
EXT = os.environ.get('EXT_PATH') or os.path.abspath(os.path.join(HERE, '..', '..'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9497
PROFILE = os.path.join(HERE, 'shot-profile')

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else 'samueletienne'
WAIT = int(sys.argv[2]) if len(sys.argv) > 2 else 25
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, 'shot.png')


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


PROBE = r'''
(() => {
  const bar = document.getElementById('alt-channelbar');
  const v = document.querySelector('video');
  const cs = bar ? getComputedStyle(bar) : null;
  const top = document.getElementById('toppanel');
  return JSON.stringify({
    barPresent: !!bar,
    topTitle: (document.getElementById('broadcasttitle')||{}).textContent,
    topViewers: (document.getElementById('viewercount')||{}).textContent,
    barHidden: bar ? bar.hidden : null,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    name: (document.getElementById('alt-cb-name') || {}).textContent,
    title: (document.getElementById('alt-cb-title') || {}).textContent,
    viewers: (document.getElementById('alt-cb-viewers') || {}).textContent,
    followHidden: (document.getElementById('alt-cb-follow') || {}).hidden,
    followText: (document.getElementById('alt-cb-follow') || {}).textContent,
    leaveText: (document.getElementById('alt-cb-leave') || {}).innerText,
    leaveHref: (document.getElementById('broadcasttitle') || {}).href,
    islive: bar ? bar.classList.contains('alt-cb-islive') : null,
    topPanelBg: top ? getComputedStyle(top).backgroundColor : null,
    videoBottom: v ? Math.round(v.getBoundingClientRect().bottom) : null,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    windowH: window.innerHeight
  });
})()
'''


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + PROFILE,
         '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % PORT,
         '--remote-allow-origins=*',
         '--window-position=-2400,-2400', '--window-size=1400,860',
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
                with urllib.request.urlopen(
                        'http://127.0.0.1:%d/json/version' % PORT, timeout=5) as r:
                    ver = json.load(r)
                break
            except Exception:
                pass
        if not ver:
            print('no DevTools endpoint')
            return 1

        async with websockets.connect(ver['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as bws:
            ext_id = (await rpc(bws, 1, 'Extensions.loadUnpacked',
                                {'path': EXT}))['result']['id']
        url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)

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

        async with websockets.connect(page['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as pws:
            await rpc(pws, 1, 'Page.navigate', {'url': url})
            await asyncio.sleep(WAIT)

            got = await rpc(pws, 2, 'Runtime.evaluate',
                            {'expression': PROBE, 'returnByValue': True})
            val = got.get('result', {}).get('result', {}).get('value')
            try:
                for k, v in json.loads(val).items():
                    print('  %-14s %s' % (k, str(v)[:90]))
            except Exception:
                print('  probe raw:', str(val)[:300])

            shot = await rpc(pws, 3, 'Page.captureScreenshot', {'format': 'png'})
            data = shot.get('result', {}).get('data')
            if data:
                open(OUT, 'wb').write(base64.b64decode(data))
                print('screenshot ->', OUT)
    finally:
        stop(proc)


asyncio.run(main())
