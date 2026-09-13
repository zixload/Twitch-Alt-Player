# -*- coding: utf-8 -*-
"""Turns an admeasure capture into a readable timeline of stalls and ad periods."""
import json
import sys

# La console de Windows n'est pas en UTF-8 : sans cela, un titre de chaine en chinois tue le script.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

STATE_NAMES = {
    '1': 'start', '2': 'stream-begin', '3': 'OFFLINE', '4': 'loading',
    '5': 'playback-begin', '6': 'playing', '7': 'stopped', '8': 'replay',
    '9': 'variant-change',
}

path = sys.argv[1]
data = json.load(open(path, encoding='utf-8'))
samples = data.get('samples', [])
log = data.get('log', [])

if not samples:
    print('no samples')
    raise SystemExit(1)

t0 = samples[0]['t']
print('samples: %d over %.1f s' % (len(samples), (samples[-1]['t'] - t0) / 1000.0))

# --- state and ad transitions -------------------------------------------------
print('\n--- timeline (state / ad changes) ---')
prev_state, prev_ad = None, None
for s in samples:
    if s['state'] != prev_state or s['ad'] != prev_ad:
        print('%7.1fs  state=%-14s ad=%-5s ct=%9.1f rs=%s ahead=%s frames=%s'
              % ((s['t'] - t0) / 1000.0,
                 STATE_NAMES.get(str(s['state']), str(s['state'])),
                 s['ad'], s['ct'], s['rs'], s['ahead'], s['frames']))
        prev_state, prev_ad = s['state'], s['ad']

# --- stalls: currentTime not advancing ---------------------------------------
print('\n--- stalls (currentTime flat for >1.5 s) ---')
run_start = None
for i in range(1, len(samples)):
    a, b = samples[i - 1], samples[i]
    flat = abs(b['ct'] - a['ct']) < 0.01
    if flat and run_start is None:
        run_start = a
    elif not flat and run_start is not None:
        dur = (a['t'] - run_start['t']) / 1000.0
        if dur >= 1.5:
            print('%7.1fs  frozen %.1fs at ct=%.1f  state=%s ad=%s rs=%s'
                  % ((run_start['t'] - t0) / 1000.0, dur, run_start['ct'],
                     STATE_NAMES.get(str(run_start['state']), run_start['state']),
                     run_start['ad'], run_start['rs']))
        run_start = None

# --- frozen picture: clock runs but no new frames decoded --------------------
print('\n--- frozen picture (clock runs, frame counter flat >1.5 s) ---')
run_start = None
for i in range(1, len(samples)):
    a, b = samples[i - 1], samples[i]
    if a['frames'] is None or b['frames'] is None:
        continue
    stuck = b['frames'] == a['frames'] and abs(b['ct'] - a['ct']) > 0.01
    if stuck and run_start is None:
        run_start = a
    elif not stuck and run_start is not None:
        dur = (a['t'] - run_start['t']) / 1000.0
        if dur >= 1.5:
            print('%7.1fs  no new frames for %.1fs  state=%s ad=%s'
                  % ((run_start['t'] - t0) / 1000.0, dur,
                     STATE_NAMES.get(str(run_start['state']), run_start['state']),
                     run_start['ad']))
        run_start = None

ad_samples = sum(1 for s in samples if s['ad'])
print('\nad-mode: %d/%d samples (%.0f%%)' % (ad_samples, len(samples),
                                             100.0 * ad_samples / len(samples)))
print('offline: %d samples' % sum(1 for s in samples if str(s['state']) == '3'))

print('\n--- log tail ---')
for line in log[-60:]:
    print(line[:190].encode('ascii', 'replace').decode())
