# -*- coding: utf-8 -*-
"""Measures what the player does across ad breaks.

Loads the extension over CDP, parks on a channel, and samples the video element
twice a second from inside the page. The symptom being hunted is the documented
"black screen": the ad-bypass switches streams and playback either stalls
(currentTime stops) or keeps its clock running while decoding no new frames.

Usage: admeasure.py <channel> <minutes>
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

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
# **Derive du chemin du script, jamais code en dur.** Le harnais doit eprouver la copie dans
# laquelle il vit : pointer sur un dossier fixe reviendrait a tester l'extension chargee dans
# le navigateur de l'utilisateur pendant qu'il s'en sert, et a la casser sous lui.
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.environ.get('EXT_PATH') or os.path.abspath(os.path.join(HERE, '..', '..'))
PROFILE = os.path.join(HERE, 'ad-profile')
PORT = 9466

CHANNEL = sys.argv[1] if len(sys.argv) > 1 else 'fps_shaka'
MINUTES = float(sys.argv[2]) if len(sys.argv) > 2 else 3.0
TAG = sys.argv[3] if len(sys.argv) > 3 else CHANNEL

# Installed in the page: samples twice a second into a ring the driver reads at the end.
RECORDER = r'''
(() => {
  if (window.__adRec) { return 'already'; }
  window.__adRec = [];
  const AD_CLASS = '\u0440\u0435\u043a\u043b\u0430\u043c\u0430';          // "реклама"
  const STATE_ATTR = 'data-\u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435'; // "data-состояние"
  setInterval(() => {
    const v = document.querySelector('video');
    if (!v) { return; }
    let q = null;
    try { q = v.getVideoPlaybackQuality(); } catch (e) {}
    window.__adRec.push({
      t: Math.round(performance.now()),
      ct: +v.currentTime.toFixed(3),
      rs: v.readyState,
      paused: v.paused,
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
      return text.split(String.fromCharCode(10)).slice(-800);
    } catch (e) { return ["log unavailable: " + e]; }
  })()
})
'''


def kill():
    subprocess.run(['taskkill', '/F', '/IM', 'chrome.exe'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, params=None, session=None, timeout=30):
        self.n += 1
        mid = self.n
        msg = {'id': mid, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        await self.ws.send(json.dumps(msg))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=deadline - time.time())
            got = json.loads(raw)
            if got.get('id') == mid:
                if 'error' in got:
                    raise RuntimeError('%s -> %s' % (method, got['error']))
                return got.get('result', {})
        raise TimeoutError(method)


async def run():
    kill()
    shutil.rmtree(PROFILE, ignore_errors=True)
    subprocess.Popen([CHROME, '--no-first-run', '--no-default-browser-check',
                      '--user-data-dir=' + PROFILE,
                      '--enable-unsafe-extension-debugging',
                      '--remote-debugging-port=%d' % PORT,
                      '--remote-allow-origins=*',
                      # Keep the window out of the way but fully alive: an occluded or
                      # backgrounded renderer is throttled, which would fake a stall.
                      '--window-position=-2400,-2400',
                      '--window-size=1000,700',
                      '--disable-backgrounding-occluded-windows',
                      '--disable-renderer-backgrounding',
                      '--disable-background-timer-throttling',
                      'about:blank'],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ver = None
    for _ in range(25):
        time.sleep(1)
        try:
            with urllib.request.urlopen(
                    'http://127.0.0.1:%d/json/version' % PORT, timeout=5) as r:
                ver = json.load(r)
            break
        except Exception:
            pass
    if not ver:
        print('FAILED: no DevTools endpoint')
        return 1

    async with websockets.connect(ver['webSocketDebuggerUrl'],
                                  max_size=None, ping_interval=None) as ws:
        cdp = Cdp(ws)
        ext_id = (await cdp.call('Extensions.loadUnpacked', {'path': EXT}))['id']
        url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)
        tgt = await cdp.call('Target.createTarget', {'url': url})
        sid = (await cdp.call('Target.attachToTarget',
                              {'targetId': tgt['targetId'], 'flatten': True}))['sessionId']
        await cdp.call('Runtime.enable', {}, session=sid)

        # Let the player get to playback before the recorder starts.
        time.sleep(8)
        res = await cdp.call('Runtime.evaluate',
                             {'expression': RECORDER, 'returnByValue': True}, session=sid)
        print('recorder:', res.get('result', {}).get('value'))

        total = MINUTES * 60
        t0 = time.time()
        while time.time() - t0 < total:
            await asyncio.sleep(min(30, total - (time.time() - t0)))
            probe = await cdp.call(
                'Runtime.evaluate',
                {'expression': '(window.__adRec||[]).length + "/" + '
                               '((window.__adRec||[]).filter(s=>s.ad).length)',
                 'returnByValue': True}, session=sid)
            print('  %5.1f min  samples/ad-samples = %s'
                  % ((time.time() - t0) / 60, probe.get('result', {}).get('value')))

        out = await cdp.call('Runtime.evaluate',
                             {'expression': READ_BACK, 'returnByValue': True,
                              'awaitPromise': False}, session=sid, timeout=60)
        payload = out.get('result', {}).get('value')

    kill()
    path = os.path.join(HERE, 'admeasure-%s.json' % TAG)
    if isinstance(payload, str):
        payload = json.loads(payload)
    json.dump(payload, open(path, 'w', encoding='utf-8'))
    print('%d samples -> %s' % (len(payload.get('samples', [])), path))
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(run()))
