# -*- coding: utf-8 -*-
"""Capture ce que le lecteur envoie reellement a worker.js, pour le rejouer hors navigateur.

worker.js demultiplexe du MPEG-TS et remultiplexe du fMP4 octet par octet. Une erreur d'un octet y
corrompt l'image sans rien lever : aucune sonde d'interface ne la verrait. La seule preuve qui vaille
pour une reecriture est donc de lui donner exactement les memes messages qu'au worker d'origine et de
comparer ce qui ressort, octet par octet -- c'est workercheck.js. Ce script fournit les messages.

Il charge l'extension, ouvre une chaine, pose une ecoute sur Worker.prototype.postMessage, relance le
direct pour que la capture commence au premier segment d'un fil tout neuf, laisse passer quelques
segments dans une qualite, change de qualite -- ce qui envoie au fil un marqueur de changement puis
une discontinuite avec une autre resolution --, et en laisse passer quelques autres.

Les segments captures sont le flux d'un streameur : ils restent sur la machine (le dossier est
ignore par git) et se recapturent quand il le faut.

Usage: py -3.14 tools/worker/tscapture.py [--chaine gaules] [--de 160p30] [--vers 360p30]
                                          [--avant 6] [--apres 4] [--sortie tools/worker/fixtures]
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

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PORT = 9507
PROFILE = os.path.join(HERE, 'capture-profile')


def option(flag, default):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


CHAINE = option('--chaine', 'gaules')
DE = option('--de', '160p30')
VERS = option('--vers', '360p30')
AVANT = int(option('--avant', '6'))
APRES = int(option('--apres', '4'))
SORTIE = os.path.abspath(option('--sortie', os.path.join(HERE, 'fixtures')))

CAPTURE = r'''
(async () => {
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const attendre = async (f, ms) => { const t = performance.now() + ms; while (!f() && performance.now() < t) await dormir(100); return f(); };
	const medias = () => window.__capture.filter((o) => typeof o.pData != 'number').length;
	window.__capture = [];
	const fVrai = Worker.prototype.postMessage;
	Worker.prototype.postMessage = function (m) {
		if (m && typeof m == 'object' && 'nNumber' in m) {
			const o = {};
			for (const k of Object.keys(m)) o[k] = m[k];
			// Copie avant le transfert, qui detache le tampon d'origine.
			if (typeof m.pData != 'number') o.pData = new Uint8Array(m.pData.slice(0));
			window.__capture.push(o);
		}
		return fVrai.apply(this, arguments);
	};
	if (!await attendre(() => m_Controls.GetState() === STATE_PLAYING, 30000)) return JSON.stringify({ erreur: 'la lecture n a pas demarre' });

	// La qualite de depart : son nom, et un debit plancher au cas ou le nom n'existerait pas.
	m_Settings.Change('sVariantLabel', '%(de)s');
	m_Settings.Change('nVariantBitrate', 300000);
	m_Controls.StopWatchingBroadcast();
	await attendre(() => [STATE_STOP, STATE_REPEAT].includes(m_Controls.GetState()), 5000);
	document.dispatchEvent(Object.defineProperty(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }), 'keyCode', { get: () => 32 }));
	if (!await attendre(() => medias() >= %(avant)d, 60000)) return JSON.stringify({ erreur: 'pas assez de segments avant le changement : ' + medias() });

	const elMenu = document.getElementById('broadcastvariant');
	const nVers = [...elMenu.options].findIndex((o) => o.text.startsWith('%(vers)s'.replace(/p\d+$/, 'p')));
	if (nVers < 0 || nVers === elMenu.selectedIndex) return JSON.stringify({ erreur: 'qualite cible introuvable', options: [...elMenu.options].map((o) => o.text) });
	const kAvantChangement = window.__capture.length;
	elMenu.selectedIndex = nVers;
	elMenu.dispatchEvent(new Event('change'));
	if (!await attendre(() => window.__capture.slice(kAvantChangement).filter((o) => typeof o.pData != 'number').length >= %(apres)d, 60000))
		return JSON.stringify({ erreur: 'pas assez de segments apres le changement' });
	Worker.prototype.postMessage = fVrai;
	return JSON.stringify({ messages: window.__capture.map((o) => {
		const c = Object.assign({}, o);
		if (typeof o.pData != 'number') c.pData = { octets: o.pData.length };
		return c;
	}) });
})()
'''

OCTETS = r'''
(() => {
	const u = window.__capture[%d].pData;
	let s = '';
	for (let j = 0; j < u.length; j += 0x8000) s += String.fromCharCode.apply(null, u.subarray(j, j + 0x8000));
	return btoa(s);
})()
'''


def stop(proc):
    if proc and proc.poll() is None:
        # Jamais taskkill /IM chrome.exe : ca tuerait les navigateurs de l'utilisateur.
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def rpc(ws, n, method, params=None, timeout=60):
    await ws.send(json.dumps({'id': n, 'method': method, 'params': params or {}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            got = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.time()))
        except asyncio.TimeoutError:
            break
        if got.get('id') == n:
            return got
    return {'__timeout__': method}


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + PROFILE,
         '--enable-unsafe-extension-debugging', '--remote-debugging-port=%d' % PORT,
         '--remote-allow-origins=*', '--window-position=-2400,-2400', '--window-size=1200,800',
         '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ver = None
        for _ in range(30):
            time.sleep(1)
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % PORT, timeout=5) as r:
                    ver = json.load(r)
                break
            except Exception:
                pass
        if not ver:
            print('ECHEC : Chrome n\'a pas ouvert son port de debogage')
            return 1
        async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as bws:
            r = await rpc(bws, 1, 'Extensions.loadUnpacked', {'path': EXT})
            if 'result' not in r:
                print('ECHEC : chargement de l\'extension -> %s' % str(r)[:300])
                return 1
            ext_id = r['result']['id']
        page = None
        for _ in range(15):
            with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=6) as r:
                page = next((t for t in json.load(r) if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')), None)
            if page:
                break
            time.sleep(1)
        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as pws:
            await rpc(pws, 1, 'Page.navigate', {'url': 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHAINE)})
            await asyncio.sleep(10)
            source = CAPTURE % {'de': DE, 'vers': VERS, 'avant': AVANT, 'apres': APRES}
            got = await rpc(pws, 2, 'Runtime.evaluate', {'expression': source, 'returnByValue': True, 'awaitPromise': True}, timeout=200)
            val = got.get('result', {}).get('result', {}).get('value')
            if not val:
                print('ECHEC : la capture n\'a rien rendu -- %s' % str(got)[:400])
                return 1
            res = json.loads(val)
            if 'erreur' in res:
                print('ECHEC : %s' % json.dumps(res, ensure_ascii=False))
                return 1
            dossier = os.path.join(SORTIE, CHAINE)
            shutil.rmtree(dossier, ignore_errors=True)
            os.makedirs(dossier)
            sequence = []
            for i, m in enumerate(res['messages']):
                if isinstance(m['pData'], dict):
                    b64 = await rpc(pws, 10 + i, 'Runtime.evaluate', {'expression': OCTETS % i, 'returnByValue': True}, timeout=60)
                    octets = base64.b64decode(b64['result']['result']['value'])
                    assert len(octets) == m['pData']['octets']
                    nom = '%03d.ts' % i
                    with open(os.path.join(dossier, nom), 'wb') as fh:
                        fh.write(octets)
                    m['pData'] = {'fichier': nom}
                sequence.append(m)
            with open(os.path.join(dossier, 'sequence.json'), 'w', encoding='utf-8') as fh:
                json.dump(sequence, fh, ensure_ascii=False, indent=1)
            medias = [m for m in sequence if isinstance(m['pData'], dict)]
            marqueurs = [m['pData'] for m in sequence if not isinstance(m['pData'], dict)]
            print('%d message(s) : %d segment(s), marqueur(s) %s, discontinuite(s) aux messages %s'
                  % (len(sequence), len(medias), marqueurs,
                     [i for i, m in enumerate(sequence) if m.get('bDiscontinuity')]))
            print('ecrit dans %s' % os.path.relpath(dossier, EXT))
            return 0
    finally:
        stop(proc)
        shutil.rmtree(PROFILE, ignore_errors=True)


sys.exit(asyncio.run(main()))
