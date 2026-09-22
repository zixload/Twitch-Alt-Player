'use strict';
/*
	Un nom appele existe-t-il quelque part ?

	Les scripts de l'extension sont classiques : toutes les declarations de premier niveau partagent
	une seule portee, et un fichier peut appeler ce qu'un autre declare. C'est ce qui rend le
	decoupage en modules possible -- et c'est aussi ce qui fait qu'une fonction supprimee d'un cote
	ne casse rien de visible tant que personne ne l'appelle.

	PANNE REELLE, celle qui a fait ecrire cet outil. En sortant le code qui referme une liste de
	lecture vers player.js, une edition a emporte trois fonctions d'un bloc et n'en a remis que deux.
	ReleaseClosedPlaylists a disparu, son seul appelant est reste. La syntaxe etait valide : node
	--check passait, les neuf etapes de verification passaient, les tests unitaires ne chargent pas
	ce module. Le lecteur s'arretait des qu'on jouait une video, et le rapport disait
	« ReferenceError: ReleaseClosedPlaylists is not defined ».

	Cet outil relit chaque monde -- une page et ses scripts, chaque groupe de scripts de contenu, le
	fil de conversion -- rassemble ce que ses fichiers declarent au premier niveau, et signale ce
	qu'ils appellent sans que personne ne le declare ni que le navigateur ne le fournisse.

	Ce qu'il ne pretend pas faire : il ne suit pas les proprietes (m_Videos.Foo), ne connait pas les
	noms construits, et ne dit rien de l'ordre. Il repond a une seule question, celle qui manquait.

	Usage: node refcheck.js [--root <dir>] [--out <rapport.txt>] [--json <fichier>]
	  sortie 0 quand tout nom appele est declare quelque part.
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const arg = (flag) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const ROOT = path.resolve(arg('--root') || path.join(__dirname, '..', '..'));

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

/*
	Ce que le navigateur fournit sans que personne ne le declare. Une liste tenue a la main : un nom
	qui manque ici sort en faux positif, ce qui se voit et se corrige, alors qu'une liste trop large
	laisserait passer de vraies pannes.
*/
const COMMON = ('globalThis undefined NaN Infinity arguments console JSON Math Date Promise Symbol Proxy Reflect Intl '
	+ 'Object Array String Number Boolean Function RegExp Error TypeError RangeError SyntaxError BigInt '
	+ 'Map Set WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView Uint8Array Uint16Array Uint32Array '
	+ 'Int8Array Int16Array Int32Array Float32Array Float64Array Uint8ClampedArray WebAssembly '
	+ 'parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI '
	+ 'setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone '
	+ 'fetch Request Response Headers Blob File FileReader FormData URL URLSearchParams AbortController '
	+ 'AbortSignal TextDecoder TextEncoder ReadableStream WritableStream TransformStream atob btoa '
	+ 'performance crypto indexedDB caches Event CustomEvent MessageChannel MessagePort MessageEvent '
	+ 'ErrorEvent CloseEvent ProgressEvent EventTarget Worker').split(' ');

const WINDOW = ('window document navigator location history screen localStorage sessionStorage '
	+ 'requestAnimationFrame cancelAnimationFrame requestIdleCallback getComputedStyle matchMedia '
	+ 'Node Element HTMLElement HTMLVideoElement HTMLMediaElement HTMLCanvasElement HTMLInputElement '
	+ 'HTMLIFrameElement HTMLSelectElement HTMLOptionElement Document DocumentFragment Window Text Range '
	+ 'Image Option Audio Video Selection Attr Comment NodeList HTMLCollection DOMParser XMLHttpRequest '
	+ 'MutationObserver ResizeObserver IntersectionObserver MediaSource SourceBuffer MediaError '
	+ 'CanvasRenderingContext2D ImageData OffscreenCanvas Path2D WebSocket Notification Storage '
	+ 'PointerEvent MouseEvent KeyboardEvent WheelEvent InputEvent FocusEvent DragEvent TouchEvent '
	+ 'alert confirm prompt open close scrollTo getSelection devicePixelRatio innerWidth innerHeight '
	+ 'chrome').split(' ');

const WORKER = ('self postMessage importScripts close onmessage onerror addEventListener '
	+ 'removeEventListener navigator performance location WebAssembly OffscreenCanvas chrome').split(' ');

const GLOBALS_OF = {
	page: new Set([...COMMON, ...WINDOW]),
	worker: new Set([...COMMON, ...WORKER]),
};

// ---------------------------------------------------------------------------------------------
// Les mondes : un groupe de scripts qui partagent une portee

function mondes() {
	const aoMondes = [];
	for (const sHtml of fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort()) {
		const sText = read(sHtml).replace(/<!--[\s\S]*?-->/g, '');
		const asScripts = [...sText.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)]
			.map((m) => m[1]).filter(exists);
		if (asScripts.length !== 0) {
			aoMondes.push({ sNom: sHtml, sSorte: 'page', asScripts });
		}
	}
	if (exists('manifest.json')) {
		const oManifest = JSON.parse(read('manifest.json'));
		(oManifest.content_scripts || []).forEach((oGroup, kIndex) => {
			const asScripts = (oGroup.js || []).filter(exists);
			if (asScripts.length !== 0) {
				aoMondes.push({ sNom: `content_scripts[${kIndex}]`, sSorte: 'page', asScripts });
			}
		});
		const sWorker = oManifest.background && oManifest.background.service_worker;
		if (sWorker && exists(sWorker)) {
			aoMondes.push({ sNom: 'service worker', sSorte: 'worker', asScripts: [sWorker] });
		}
	}
	// Le fil de conversion n'est cite par aucune page : il est ouvert par new Worker().
	if (exists('worker.js')) {
		aoMondes.push({ sNom: 'worker.js', sSorte: 'worker', asScripts: ['worker.js'] });
	}
	// Un monde peut s'agrandir tout seul : importScripts ajoute ses fichiers a la meme portee.
	for (const oMonde of aoMondes) {
		for (const sFile of [...oMonde.asScripts]) {
			for (const oMatch of read(sFile).matchAll(/importScripts\(\s*['"]([^'"]+)['"]/g)) {
				if (exists(oMatch[1]) && !oMonde.asScripts.includes(oMatch[1])) {
					oMonde.asScripts.push(oMatch[1]);
				}
			}
		}
	}
	return aoMondes;
}

// ---------------------------------------------------------------------------------------------
// Ce qu'un fichier declare au premier niveau, et ce qu'il appelle sans l'avoir

function lire(sFile) {
	const oAst = parser.parse(read(sFile), { sourceType: 'script', errorRecovery: true });
	const asDeclared = new Set();
	const moFree = new Map();
	traverse(oAst, {
		Program(oPath) {
			for (const sName of Object.keys(oPath.scope.bindings)) {
				asDeclared.add(sName);
			}
			for (const [sName, aoPaths] of Object.entries(oPath.scope.globals)) {
				const oNode = Array.isArray(aoPaths) ? aoPaths[0] : aoPaths;
				moFree.set(sName, (oNode && oNode.loc && oNode.loc.start.line) || 0);
			}
			oPath.stop();
		},
	});
	return { asDeclared, moFree };
}

/*
	Ce qui manque, et qu'on accepte de laisser manquer.

	m_Settings vit dans common.js, charge a la fois par la page du lecteur et par les scripts de
	contenu de twitch.tv. Quatre de ses membres -- exporter, importer, construire les listes de
	predefinies -- s'appuient sur des noms que seule la page du lecteur declare. Dans un script de
	contenu ils leveraient, mais rien ne les y appelle : ces trois fonctions ne servent qu'au menu
	des reglages.

	La liste reste visible au rapport plutot qu'ecartee en silence : le jour ou un script de contenu
	appellera l'un d'eux, c'est ici qu'on lira pourquoi ca ne pouvait pas marcher.
*/
const ACCEPTES = new Map([
	['content_scripts[2] common.js WriteTextToLocalFile', 'm_Settings.Export, appele depuis le menu seulement'],
	['content_scripts[2] common.js GetText', 'm_Settings.Export et les listes de predefinies'],
	['content_scripts[2] common.js m_Notification', 'm_Settings.Import, appele depuis le menu seulement'],
	['content_scripts[2] common.js m_Events', 'm_Settings.ConfigurePresetLists, page du lecteur seulement'],
]);

const aoMondes = mondes();
const aoProblemes = [];
const aoAcceptes = [];
const aoLignes = [];

for (const oMonde of aoMondes) {
	const aoFichiers = oMonde.asScripts.map((f) => ({ sFile: f, ...lire(f) }));
	const asDeclared = new Set();
	for (const oFichier of aoFichiers) {
		for (const sName of oFichier.asDeclared) {
			asDeclared.add(sName);
		}
	}
	const asKnown = GLOBALS_OF[oMonde.sSorte];
	let kManquants = 0;
	for (const oFichier of aoFichiers) {
		for (const [sName, kLine] of oFichier.moFree) {
			if (asDeclared.has(sName) || asKnown.has(sName)) {
				continue;
			}
			const sCle = `${oMonde.sNom} ${oFichier.sFile} ${sName}`;
			if (ACCEPTES.has(sCle)) {
				aoAcceptes.push({ sCle, sRaison: ACCEPTES.get(sCle), kLine });
				continue;
			}
			kManquants++;
			aoProblemes.push({ sMonde: oMonde.sNom, sFile: oFichier.sFile, sName, kLine });
		}
	}
	aoLignes.push(`${oMonde.sNom.padEnd(24)} ${String(oMonde.asScripts.length).padStart(2)} scripts, `
		+ `${String(asDeclared.size).padStart(4)} noms declares, ${kManquants} appele(s) sans declaration`);
}

for (const oProbleme of aoProblemes) {
	aoLignes.push(`   MANQUE  ${oProbleme.sFile}:${oProbleme.kLine}  ${oProbleme.sName}`
		+ `   (monde : ${oProbleme.sMonde})`);
}
if (aoAcceptes.length !== 0) {
	aoLignes.push('');
	aoLignes.push('   Acceptes, et pourquoi :');
	for (const oAccepte of aoAcceptes) {
		aoLignes.push(`   ${oAccepte.sCle}:${oAccepte.kLine}`);
		aoLignes.push(`      ${oAccepte.sRaison}`);
	}
}
aoLignes.push('');
aoLignes.push(`TOTAL NOMS SANS DECLARATION : ${aoProblemes.length}`);

const sRapport = aoLignes.join('\n');
console.log(sRapport);
const sOut = arg('--out');
if (sOut) {
	fs.writeFileSync(sOut, sRapport + '\n', 'utf8');
}
const sJson = arg('--json');
if (sJson) {
	fs.writeFileSync(sJson, JSON.stringify({ total: aoProblemes.length, manquants: aoProblemes }, null, 1), 'utf8');
}
process.exit(aoProblemes.length === 0 ? 0 : 1);
