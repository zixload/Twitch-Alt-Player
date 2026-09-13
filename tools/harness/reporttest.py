# -*- coding: utf-8 -*-
"""Exercises the feedback form end to end and checks what the report would contain.

Stubs the file writer so nothing is actually downloaded, opens the feedback form the
way the menu item does, submits it, and reports whether the playback tokens were
redacted and whether any upload was attempted.
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
PORT = 9499
PROFILE = os.path.join(HERE, 'report-profile')
CHANNEL = os.environ.get('CHANNEL', 'fps_shaka')


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


# Replace the downloader and watch for any network call the report path might make.
ARM = r'''
(() => {
  window.__saved = null;
  window.__xhrOpens = [];
  window.WriteTextToLocalFile = function (text, type, name) {
    window.__saved = { text: text, type: type, name: name };
  };
  const open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    window.__xhrOpens.push(m + ' ' + u);
    return open0.apply(this, arguments);
  };
  const fetch0 = window.fetch;
  window.fetch = function (u) {
    window.__xhrOpens.push('fetch ' + u);
    return fetch0.apply(this, arguments);
  };
  return 'armed';
})()
'''

TRIGGER = 'm_Debug.TerminateAndSendFeedback(), "triggered"'

SUBMIT = r'''
(() => {
  const fr = document.querySelector('iframe');
  if (!fr || !fr.contentDocument) { return 'no iframe'; }
  const d = fr.contentDocument;
  const form = d.getElementById('debug-feedback');
  if (!form) { return 'no form'; }
  const msg = form.elements['debug-message'];
  if (msg) { msg.value = 'test run'; }
  const btn = form.querySelector('button[type=submit]');
  return JSON.stringify({
    formVisible: !form.hidden,
    submitLabel: btn ? btn.textContent : null,
    heading: (d.querySelector('#debug-feedback h3') || {}).textContent,
    notice: (d.querySelector('#debug-feedback p:last-of-type') || {}).textContent
  });
})()
'''

DO_SUBMIT = r'''
(() => {
  const d = document.querySelector('iframe').contentDocument;
  const form = d.getElementById('debug-feedback');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return 'submitted';
})()
'''

CHECK = r'''
(() => {
  const s = window.__saved;
  if (!s) { return JSON.stringify({ saved: false, xhr: window.__xhrOpens }); }
  let o = null;
  try { o = JSON.parse(s.text); } catch (e) {}
  return JSON.stringify({
    saved: true,
    name: s.name,
    type: s.type,
    bytes: s.text.length,
    token: o ? String(o['BroadcastToken']).slice(0, 60) : null,
    tokenNoAds: o ? String(o['BroadcastTokenWithoutAds']).slice(0, 60) : null,
    hasMessage: o ? !!o['Message'] : null,
    keys: o ? Object.keys(o).length : null,
    /*
      Quatre nombres separes par des points, ce n'est pas toujours une adresse : le champ
      Browser porte « Chrome/152.0.0.0 », et l'alarme se declenchait a chaque passage. Une
      alarme qui se declenche toujours ne se lit plus. Les numeros de version d'un agent
      utilisateur -- precedes d'une barre oblique -- sont donc ecartes, et comptes a part.
    */
    ...(() => {
      const RE_QUATRE_NOMBRES = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
      const suspects = [];
      const versions = [];
      let m;
      while ((m = RE_QUATRE_NOMBRES.exec(s.text)) !== null) {
        const avant = s.text.slice(Math.max(0, m.index - 40), m.index);
        (/\/$|\/\s*$/.test(avant) ? versions : suspects).push({ valeur: m[0], index: m.index });
      }
      const premier = suspects[0] || null;
      return {
        leaksIp: suspects.length > 0,
        ipSample: premier ? premier.valeur : null,
        ipWhere: premier ? s.text.slice(Math.max(0, premier.index - 260), premier.index + 60) : null,
        ipField: !o || !premier ? null
          : Object.keys(o).filter(k => String(JSON.stringify(o[k])).includes(premier.valeur)),
        versionsIgnorees: versions.map(v => v.valeur),
      };
    })(),
    leaksUserId: /"user_id"/.test(s.text),
    xhr: window.__xhrOpens
  });
})()
'''


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

        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None,
                                      ping_interval=None) as pws:
            await rpc(pws, 1, 'Page.navigate', {'url': url})
            await asyncio.sleep(20)

            for n, expr, label in ((2, ARM, 'arm'), (3, TRIGGER, 'trigger')):
                got = await rpc(pws, n, 'Runtime.evaluate',
                                {'expression': expr, 'returnByValue': True})
                print('%-8s %s' % (label, got.get('result', {})
                                   .get('result', {}).get('value')))
            await asyncio.sleep(6)

            for n, expr, label in ((4, SUBMIT, 'form'), (5, DO_SUBMIT, 'submit')):
                got = await rpc(pws, n, 'Runtime.evaluate',
                                {'expression': expr, 'returnByValue': True})
                print('%-8s %s' % (label, got.get('result', {})
                                   .get('result', {}).get('value')))
            await asyncio.sleep(2)

            got = await rpc(pws, 6, 'Runtime.evaluate',
                            {'expression': CHECK, 'returnByValue': True})
            val = got.get('result', {}).get('result', {}).get('value')
            try:
                for k, v in json.loads(val).items():
                    print('  %-13s %s' % (k, str(v)[:80]))
            except Exception:
                print('  raw:', str(val)[:300])
    finally:
        stop(proc)


asyncio.run(main())
