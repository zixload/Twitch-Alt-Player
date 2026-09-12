# -*- coding: utf-8 -*-
"""Runs the same playback measurement on two Chromium browsers and compares them.

Unlike the earlier harness this never kills browsers by image name: it terminates
only the process tree it started, so a browser the user already has open is left
alone.

Usage: compare.py <channel> <minutes>
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

HERE = os.path.dirname(os.path.abspath(__file__))
# **Derive du chemin du script, jamais code en dur.** Le harnais doit eprouver la copie dans
# laquelle il vit : pointer sur un dossier fixe reviendrait a tester l'extension chargee dans
# le navigateur de l'utilisateur pendant qu'il s'en sert, et a la casser sous lui.
EXT = os.environ.get('EXT_PATH') or os.path.abspath(os.path.join(HERE, '..', '..'))
LOCALAPPDATA = os.environ.get('LOCALAPPDATA', '')

BROWSERS = [
    ('chrome', r'C:\Program Files\Google\Chrome\Application\chrome.exe', 9481),
    ('vivaldi', os.path.join(LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe'), 9482),
]

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else 'samueletienne'
MINUTES = float(sys.argv[2]) if len(sys.argv) > 2 else 3.0

RECORDER = r'''
(() => {
  if (window.__adRec) { return 'already'; }
  window.__adRec = [];
  const AD_CLASS = '\u0440\u0435\u043a\u043b\u0430\u043c\u0430';
  const STATE_ATTR = 'data-\u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435';
  setInterval(() => {
    const v = document.querySelector('video');
    if (!v) { return; }
    let q = null;
    try { q = v.getVideoPlaybackQuality(); } catch (e) {}
    window.__adRec.push({
      t: Math.round(performance.now()),
      ct: +v.currentTime.toFixed(3),
      rs: v.readyState,
      end: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(3) : null,
      ahead: v.buffered.length
        ? +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(2) : null,
      frames: q ? q.totalVideoFrames : null,
      dropped: q ? q.droppedVideoFrames : null,
      ad: document.body.classList.contains(AD_CLASS),
      state: document.body.getAttribute(STATE_ATTR)
    });
  }, 500);
  return 'installed';
})()
'''

READ_BACK = r'''
JSON.stringify({
  samples: window.__adRec || [],
  log: (() => {
    try {
      const d = м_Журнал.ПолучитьДанныеДляОтчета();
      const text = typeof d === "string" ? d : JSON.stringify(d);
      return text.split(String.fromCharCode(10)).slice(-1200);
    } catch (e) { return ["log unavailable: " + e]; }
  })()
})
'''


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, params=None, session=None, timeout=40):
        self.n += 1
        mid = self.n
        msg = {'id': mid, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        await self.ws.send(json.dumps(msg))
        deadline = time.time() + timeout
        while time.time() < deadline:
            got = json.loads(await asyncio.wait_for(self.ws.recv(),
                                                    timeout=deadline - time.time()))
            if got.get('id') == mid:
                if 'error' in got:
                    raise RuntimeError('%s -> %s' % (method, got['error']))
                return got.get('result', {})
        raise TimeoutError(method)


def stop(proc):
    """Kills only the tree we started. Never touches the user's own windows."""
    if proc and proc.poll() is None:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def measure(name, binary, port):
    if not os.path.exists(binary):
        return {'error': 'not installed: %s' % binary}

    profile = os.path.join(HERE, 'cmp-profile-' + name)
    shutil.rmtree(profile, ignore_errors=True)
    proc = subprocess.Popen(
        [binary, '--no-first-run', '--no-default-browser-check',
         '--user-data-dir=' + profile,
         '--enable-unsafe-extension-debugging',
         '--remote-debugging-port=%d' % port,
         '--remote-allow-origins=*',
         '--window-position=-2400,-2400', '--window-size=1000,700',
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
                        'http://127.0.0.1:%d/json/version' % port, timeout=5) as r:
                    ver = json.load(r)
                break
            except Exception:
                pass
        if not ver:
            return {'error': 'no DevTools endpoint'}

        result = {'browser': ver.get('Browser'), 'ua': ver.get('User-Agent', '')[:160]}
        print('  %s: %s' % (name, result['browser']))

        async with websockets.connect(ver['webSocketDebuggerUrl'],
                                      max_size=None, ping_interval=None) as ws:
            cdp = Cdp(ws)
            try:
                ext_id = (await cdp.call('Extensions.loadUnpacked', {'path': EXT}))['id']
            except Exception as exc:
                result['error'] = 'loadUnpacked unsupported: %s' % str(exc)[:200]
                return result

            url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)
            tgt = await cdp.call('Target.createTarget', {'url': url})
            sid = (await cdp.call('Target.attachToTarget',
                                  {'targetId': tgt['targetId'],
                                   'flatten': True}))['sessionId']
            await cdp.call('Runtime.enable', {}, session=sid)
            time.sleep(8)
            await cdp.call('Runtime.evaluate',
                           {'expression': RECORDER, 'returnByValue': True}, session=sid)
            await asyncio.sleep(MINUTES * 60)
            out = await cdp.call('Runtime.evaluate',
                                 {'expression': READ_BACK, 'returnByValue': True},
                                 session=sid, timeout=90)
            payload = out.get('result', {}).get('value')
            if isinstance(payload, str):
                payload = json.loads(payload)
            result.update(payload)
        return result
    finally:
        stop(proc)


def summarise(name, r):
    if 'error' in r and 'samples' not in r:
        print('%-8s ERROR %s' % (name, r['error']))
        return
    s = r.get('samples', [])
    if not s:
        print('%-8s no samples' % name)
        return
    offline = sum(1 for x in s if str(x['state']) == '3')
    loading = sum(1 for x in s if str(x['state']) == '4')
    ad = sum(1 for x in s if x['ad'])
    stalls = frozen = 0
    for i in range(1, len(s)):
        a, b = s[i - 1], s[i]
        if abs(b['ct'] - a['ct']) < 0.01:
            stalls += 1
        if (a['frames'] is not None and b['frames'] is not None
                and b['frames'] == a['frames'] and abs(b['ct'] - a['ct']) > 0.01):
            frozen += 1
    drops = (s[-1]['dropped'] or 0) - (s[0]['dropped'] or 0)
    print('%-8s samples=%d  offline=%d  loading=%d  ad=%d  flat-clock=%d  '
          'frozen-picture=%d  dropped-frames=%d'
          % (name, len(s), offline, loading, ad, stalls, frozen, drops))


async def main():
    results = {}
    for name, binary, port in BROWSERS:
        print('--- %s ---' % name)
        try:
            results[name] = await measure(name, binary, port)
        except Exception as exc:
            results[name] = {'error': '%s: %s' % (type(exc).__name__, str(exc)[:200])}
        json.dump(results[name],
                  open(os.path.join(HERE, 'compare-%s.json' % name), 'w',
                       encoding='utf-8'))

    print('\n=== comparison (%s, %.0f min each) ===' % (CHANNEL, MINUTES))
    for name in results:
        summarise(name, results[name])


if __name__ == '__main__':
    asyncio.run(main())
