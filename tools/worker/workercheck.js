#!/usr/bin/env node
'use strict';
/*
	Rejoue une sequence de messages captures dans deux versions de worker.js, et compare ce qui ressort
	octet par octet.

	worker.js remultiplexe du MPEG-TS en fMP4. Une erreur d'un octet dans une boite MP4 corrompt l'image
	sans rien lever, et aucune sonde d'interface ne la verrait. Ici, chaque message que le fil renvoie
	est reduit a une empreinte : les champs tels quels, et chaque tampon d'octets remplace par sa
	longueur et son SHA-256. Deux versions sont equivalentes si leurs suites d'empreintes sont
	identiques, message par message.

	Le fil tourne dans un contexte vm de Node, avec ce qu'il attend d'un navigateur : self, navigator,
	fetch pour wasm.wasm, importScripts pour asmjs.js, performance, postMessage. L'horloge est figee a
	zero : les durees mesurees (nConvertedIn, « Compilation ended: 0ms ») ne varient donc pas d'un
	passage a l'autre, et deux versions qui mesurent le temps a des endroits differents ne different
	pas pour autant.

	Usage :
	  node tools/worker/workercheck.js --fixtures <dossier> [--base <rev|fichier>] [--head <fichier>]
	    --fixtures  dossier contenant sequence.json et les segments (voir tscapture.py) ; plusieurs
	                dossiers separes par des virgules
	    --base      version de reference : une revision git (defaut HEAD) ou un chemin de fichier
	    --head      version a eprouver (defaut : worker.js de l'arbre)
	    --asmjs     force le repli asm.js au lieu de WebAssembly
	  Sort 0 si tout est identique, 1 a la premiere difference (qui est affichee), 2 sur erreur d'usage.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function option(sNom, pDefaut) {
	const i = process.argv.indexOf(sNom);
	return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : pDefaut;
}

function lireVersion(sVersion) {
	if (fs.existsSync(sVersion)) {
		return fs.readFileSync(sVersion, 'utf8');
	}
	return execFileSync('git', ['show', `${sVersion}:worker.js`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
}

function empreinte(pValeur) {
	if (pValeur instanceof ArrayBuffer) {
		pValeur = new Uint8Array(pValeur);
	}
	if (ArrayBuffer.isView(pValeur)) {
		const mb = new Uint8Array(pValeur.buffer, pValeur.byteOffset, pValeur.byteLength);
		return `octets:${mb.length}:${crypto.createHash('sha256').update(mb).digest('hex').slice(0, 16)}`;
	}
	if (Array.isArray(pValeur)) {
		return pValeur.map(empreinte);
	}
	if (pValeur !== null && typeof pValeur == 'object') {
		const o = {};
		for (const k of Object.keys(pValeur).sort()) {
			o[k] = empreinte(pValeur[k]);
		}
		return o;
	}
	if (typeof pValeur == 'number' && !Number.isFinite(pValeur)) {
		return String(pValeur);
	}
	return pValeur;
}

/*
	Fait tourner une version du fil sur une sequence et rend la suite de ses empreintes. Les messages
	sont empreints au moment meme de postMessage : le fil reutilise sa memoire pour le segment
	suivant, et un tampon relu plus tard aurait deja change.
*/
async function executer(sSource, aSequence, sDossier, bAsmjs) {
	const aSorties = [];
	const oContexte = {
		navigator: { userAgentData: { brands: [{ brand: 'Chromium', version: '152' }], mobile: false }, userAgent: 'Chrome/152' },
		performance: { now: () => 0 },
		TextDecoder,
		console,
		WebAssembly: bAsmjs ? undefined : WebAssembly,
		fetch: (sUrl) => {
			const mb = fs.readFileSync(path.join(ROOT, sUrl));
			return Promise.resolve({ arrayBuffer: () => Promise.resolve(mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.length)) });
		},
		postMessage: (mData) => {
			aSorties.push(JSON.stringify(empreinte(mData)));
		},
	};
	oContexte.self = oContexte;
	oContexte.importScripts = (sFichier) => {
		vm.runInContext(fs.readFileSync(path.join(ROOT, sFichier), 'utf8'), oContexte, { filename: sFichier });
	};
	vm.createContext(oContexte);
	vm.runInContext(sSource, oContexte, { filename: 'worker.js' });

	for (const oMessage of aSequence) {
		const o = Object.assign({}, oMessage);
		if (typeof o.pData != 'number') {
			const mb = fs.readFileSync(path.join(sDossier, o.pData.fichier));
			o.pData = mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.length);
		}
		if (typeof oContexte.onmessage != 'function') {
			aSorties.push('le fil ne recoit plus de messages');
			break;
		}
		oContexte.onmessage({ data: o });
		// Laisse la compilation finir et les messages en attente passer.
		for (let i = 0; i < 20; ++i) {
			await new Promise((f) => setImmediate(f));
		}
	}
	return aSorties;
}

async function main() {
	const sFixtures = option('--fixtures', null);
	if (!sFixtures) {
		console.log('Usage : node tools/worker/workercheck.js --fixtures <dossier> [--base <rev|fichier>] [--head <fichier>] [--asmjs]');
		return 2;
	}
	const sBase = option('--base', 'HEAD');
	const sHead = option('--head', path.join(ROOT, 'worker.js'));
	const bAsmjs = process.argv.includes('--asmjs');
	const sourceBase = lireVersion(sBase);
	const sourceHead = lireVersion(sHead);
	let kMessages = 0;
	for (const sDossier of sFixtures.split(',')) {
		const aSequence = JSON.parse(fs.readFileSync(path.join(sDossier, 'sequence.json'), 'utf8'));
		const aBase = await executer(sourceBase, aSequence, sDossier, bAsmjs);
		const aHead = await executer(sourceHead, aSequence, sDossier, bAsmjs);
		const kSegments = aBase.filter((s) => s.startsWith('[1,')).length;
		const kOctets = aBase.filter((s) => s.startsWith('[1,') && s.includes('mbMediaSegment')).length;
		console.log(`${path.basename(sDossier)} : ${aSequence.length} message(s) envoye(s), ${aBase.length} rendu(s) dont ${kSegments} segment(s) et ${kOctets} avec des images`);
		if (kOctets === 0) {
			console.log('ECHEC : la reference n\'a converti aucun segment -- la comparaison ne prouverait rien.');
			return 1;
		}
		const n = Math.max(aBase.length, aHead.length);
		for (let i = 0; i < n; ++i) {
			if (aBase[i] !== aHead[i]) {
				console.log(`DIFFERENCE au message rendu ${i} :`);
				console.log(`  base : ${(aBase[i] || '(absent)').slice(0, 600)}`);
				console.log(`  head : ${(aHead[i] || '(absent)').slice(0, 600)}`);
				return 1;
			}
		}
		kMessages += n;
	}
	console.log(`OK : ${kMessages} message(s) rendu(s), identiques octet par octet${bAsmjs ? ' (asm.js)' : ''}.`);
	return 0;
}

main().then((n) => process.exit(n), (e) => { console.error(e); process.exit(2); });
