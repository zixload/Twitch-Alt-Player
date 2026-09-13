# -*- coding: utf-8 -*-
"""Checks the follow button against every subscription state, and the sidebar titles.

The follow control only appears for a signed-in viewer, so the four SUBSCRIPTION_* states
are driven directly on the node the player writes to, and the button's reaction is
observed — including which of the player's own buttons the click is forwarded to.
"""
import asyncio
import json
import os
import shutil
import subprocess
import time
import urllib.request

import websockets
import sys

# La console de Windows n'est pas en UTF-8 : sans cela, un titre de chaine en chinois tue le script.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
# **Derive du chemin du script, jamais code en dur.** Le harnais doit eprouver la copie dans
# laquelle il vit : pointer sur un dossier fixe reviendrait a tester l'extension chargee dans
# le navigateur de l'utilisateur pendant qu'il s'en sert, et a la casser sous lui.
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9503
PROFILE = os.path.join(HERE, 'follow-profile')
CHANNEL = os.environ.get('CHANNEL', 'fps_shaka')

SIDEBAR = r'''
(() => {
  const rows = [...document.querySelectorAll('#alt-sidebar .alt-sb-row')];
  return JSON.stringify({
    rows: rows.length,
    withStreamTitle: rows.filter(r => r.querySelector('.alt-sb-stream-title')).length,
    sample: rows.slice(0, 3).map(r => ({
      name: (r.querySelector('.alt-sb-name') || {}).textContent,
      title: (r.querySelector('.alt-sb-stream-title') || {}).textContent,
      game: (r.querySelector('.alt-sb-game') || {}).textContent
    }))
  });
})()
'''

FOLLOW = r'''
(() => {
  const state = document.getElementById('viewer-subscription');
  const sub = document.getElementById('viewer-follow');
  const unsub = document.getElementById('viewer-unfollow');
  const btn = document.getElementById('alt-cb-follow');
  if (!state || !sub || !unsub || !btn) { return JSON.stringify({ error: 'missing nodes' }); }

  // Give the player's own buttons recognisable labels and watch which one is clicked.
  sub.textContent = 'Follow';
  unsub.textContent = 'Unfollow';
  let clicked = null;
  sub.addEventListener('click', () => { clicked = 'viewer-follow'; }, true);
  unsub.addEventListener('click', () => { clicked = 'viewer-unfollow'; }, true);

  const out = [];
  for (const s of ['0', '1', '2', '3']) {
    state.setAttribute('data-subscription', s);
    m_ChannelBar.paint();
    clicked = null;
    if (!btn.hidden) { btn.click(); }
    out.push({
      state: s,
      buttonHidden: btn.hidden,
      label: btn.textContent,
      following: btn.classList.contains('alt-cb-following'),
      forwardedTo: clicked
    });
  }
  return JSON.stringify(out);
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
         '--window-position=-2400,-2400', '--window-size=1300,850',
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
            await asyncio.sleep(22)

            got = await rpc(pws, 2, 'Runtime.evaluate',
                            {'expression': SIDEBAR, 'returnByValue': True})
            val = got.get('result', {}).get('result', {}).get('value')
            print('--- sidebar ---')
            try:
                d = json.loads(val)
                print('  rows=%s  avec titre de stream=%s' % (d['rows'], d['withStreamTitle']))
                for s in d['sample']:
                    print('   %-22s | %-38s | %s'
                          % (str(s['name'])[:22], str(s['title'])[:38], s['game']))
            except Exception:
                print('  raw:', str(val)[:200])

            got = await rpc(pws, 3, 'Runtime.evaluate',
                            {'expression': FOLLOW, 'returnByValue': True})
            val = got.get('result', {}).get('result', {}).get('value')
            print('--- bouton suivre, par etat ---')
            try:
                for row in json.loads(val):
                    print('  etat=%s  cache=%-5s  libelle=%-9s  suivi=%-5s  clic vers=%s'
                          % (row['state'], row['buttonHidden'], row['label'],
                             row['following'], row['forwardedTo']))
            except Exception:
                print('  raw:', str(val)[:300])
    finally:
        stop(proc)


asyncio.run(main())
