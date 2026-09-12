'use strict';
/*
	Refuses a mapping before it can be applied.

	The map is mined from translations a human wrote in comments, so it carries whatever those
	comments carried. Some entries are not identifiers at all: the miner aligns tokens, and a
	translated log message ("на" -> "for") aligns just as neatly as a variable name. Renaming
	something to `for` is a syntax error, and renaming two different names to the same target
	silently merges two variables.

	Both are caught here rather than after the fact.
*/
const fs = require('fs');
const path = require('path');

const RESERVED = new Set(('break case catch class const continue debugger default delete do else '
	+ 'export extends finally for function if import in instanceof new return super switch this '
	+ 'throw try typeof var void while with yield let static enum await implements package '
	+ 'protected interface private public null true false arguments eval').split(' '));

/*
	Names the browser already owns.

	The repo glossary maps Узел to `Node`, and applying that shadowed the DOM's own Node interface
	inside every module that used the helper. `Node.ELEMENT_NODE` became undefined, so
	`if (oEvent.target.nodeType === Node.ELEMENT_NODE)` was never true and every click handler in
	the player stopped firing — no exception, no console error, just buttons that did nothing.

	Scope analysis cannot catch this: Babel knows the bindings in the file, not what the browser
	puts on window. So the list is explicit.
*/
const BROWSER_GLOBALS = new Set(('Node Element Document Window Event Text Range Image Option Screen '
	+ 'History Location Storage Worker Request Response Headers Blob File FileReader URL URLSearchParams '
	+ 'FormData Notification Selection Attr Comment Audio Video Navigator Performance Console Crypto '
	+ 'AbortController AbortSignal MediaSource SourceBuffer WebSocket XMLHttpRequest MutationObserver '
	+ 'ResizeObserver IntersectionObserver CustomEvent MessageChannel MessagePort Path2D DOMParser '
	+ 'CanvasRenderingContext2D TextDecoder TextEncoder ReadableStream WritableStream Intl Reflect Proxy '
	+ 'Promise Symbol Map Set WeakMap WeakSet Array Object String Number Boolean Date RegExp Error Math '
	+ 'JSON Function BigInt ArrayBuffer DataView Uint8Array Int8Array Float32Array Float64Array').split(' '));

const VALID = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const src = process.argv[2];
if (!src) {
	console.error('usage: node validate.js <map.json> [--write <clean.json>]');
	process.exit(2);
}
const map = JSON.parse(fs.readFileSync(src, 'utf8'));

const bad = [];
const clean = {};
for (const [from, to] of Object.entries(map)) {
	if (typeof to !== 'string' || !VALID.test(to)) { bad.push([from, to, 'pas un identifiant']); continue; }
	if (RESERVED.has(to)) { bad.push([from, to, 'mot reserve du langage']); continue; }
	if (BROWSER_GLOBALS.has(to)) { bad.push([from, to, 'nom deja pris par le navigateur']); continue; }
	if (!/[Ѐ-ӿ]/.test(from)) { bad.push([from, to, 'la source n’est pas cyrillique']); continue; }
	clean[from] = to;
}

// Two sources aiming at one target would fuse two distinct variables into one.
const byTarget = new Map();
for (const [from, to] of Object.entries(clean)) {
	if (!byTarget.has(to)) byTarget.set(to, []);
	byTarget.get(to).push(from);
}
for (const [to, froms] of byTarget) {
	if (froms.length > 1) {
		bad.push([froms.join(' + '), to, 'plusieurs sources vers la meme cible']);
		for (const f of froms) delete clean[f];
	}
}

const lines = [];
lines.push('entrees lues     : ' + Object.keys(map).length);
lines.push('entrees retenues : ' + Object.keys(clean).length);
lines.push('entrees refusees : ' + bad.length);
for (const [from, to, why] of bad) {
	lines.push('   ' + JSON.stringify(from) + ' -> ' + JSON.stringify(to) + '   (' + why + ')');
}
const text = lines.join('\n');
console.log(text);
fs.writeFileSync(path.join(__dirname, 'validate-report.txt'), text, 'utf8');

const wi = process.argv.indexOf('--write');
if (wi !== -1 && process.argv[wi + 1]) {
	fs.writeFileSync(process.argv[wi + 1], JSON.stringify(clean, null, 1), 'utf8');
	console.log('\ncarte nettoyee ecrite : ' + process.argv[wi + 1]);
}
