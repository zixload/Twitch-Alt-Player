# -*- coding: utf-8 -*-
"""Loads the extension and reads the statistics tooltips out of the live DOM."""
import asyncio
import json
import os
import shutil
import subprocess
import time
import urllib.request

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
# **Derive du chemin du script, jamais code en dur.** Le harnais doit eprouver la copie dans
# laquelle il vit : pointer sur un dossier fixe reviendrait a tester l'extension chargee dans
# le navigateur de l'utilisateur pendant qu'il s'en sert, et a la casser sous lui.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9501
PROFILE = os.path.join(HERE, 'tip-profile')
CHANNEL = os.environ.get('CHANNEL', 'fps_shaka')

PROBE = r'''
(() => {
  const stats = document.getElementById('\u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430');
  const tips = [...document.querySelectorAll('[title]')]
    .map(e => e.getAttribute('title'))
    .filter(t => t && t.length > 40);
  const cyr = tips.filter(t => /[\u0410-\u044f\u0401\u0451]/.test(t));
  const arrow = tips.filter(t => t.indexOf('-->') !== -1);
  const rows = stats ? stats.querySelectorAll('tr').length : 0;
  const v = document.querySelector('video');
  return JSON.stringify({
    statsPanelPresent: !!stats,
    statsRows: rows,
    tooltipsOver40Chars: tips.length,
    tooltipsWithRussian: cyr.length,
    tooltipsWithArrow: arrow.length,
    sample: (tips.find(t => t.indexOf('Video duration') === 0) || '').slice(0, 150),
    playing: v ? v.readyState : null
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
         '--window-position=-2400,-2400', '--window-size=1200,800',
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
            ext_id = r['result']['id']
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

        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None,
                                      ping_interval=None) as pws:
            await rpc(pws, 1, 'Page.navigate', {'url': url})
            await asyncio.sleep(18)
            got = await rpc(pws, 2, 'Runtime.evaluate',
                            {'expression': PROBE, 'returnByValue': True})
            val = got.get('result', {}).get('result', {}).get('value')
            try:
                for k, v in json.loads(val).items():
                    print('  %-20s %s' % (k, str(v)[:110]))
            except Exception:
                print('  raw:', str(val)[:300])
    finally:
        stop(proc)


asyncio.run(main())
