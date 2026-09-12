'use strict';
/*
	Renames a name everywhere it appears, in every file of the extension.

	The other appliers each cover one facet: domapply.js the markup and the stylesheets,
	domapply3.js those plus the string literals of the scripts. Both leave object keys and property
	accesses alone, and that gap has cost two outages — a segment field created as a key and checked
	as a string, a lookup table whose keys stayed behind while its producer moved on.

	Settings keys have every facet at once. A single name is the key in the schema (an identifier),
	the string passed to Get and Change, the id of the colour button the user clicks, and a CSS
	custom property. There is no side to leave out, so this applier makes no distinction: a whole
	word is a whole word.

	That is only defensible because the names are Cyrillic. Nothing in a stylesheet, an HTML
	attribute or a browser API can collide with them. It would be reckless on Latin names.

	Word boundaries are built by hand — \b does not know Cyrillic. A custom property keeps its
	leading dashes in the map, so `--сЦветФона` is one name and matches before the bare one.

	The non-loaded copies of player.js are left alone: CLAUDE.md forbids deleting them, and
	renaming a file nobody loads only invites confusion.

	Usage: node wordapply.js <map.json> [--dry]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const MAP_PATH = process.argv[2];
if (!MAP_PATH) {
	console.error('usage: node wordapply.js <map.json> [--dry]');
	process.exit(2);
}
const MAP = new Map(Object.entries(JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')))
	.filter(([k]) => !k.startsWith('//')));

const IGNORE = /^(player-english-translating-test|player-GabePc)\.js$/;
const FILES = fs.readdirSync(ROOT)
	.filter((f) => /\.(js|html|css)$/i.test(f) && !IGNORE.test(f));

const SUITE = '[Ѐ-ӿA-Za-z0-9_$-]';
const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const noms = [...MAP.keys()].sort((a, b) => b.length - a.length);
const motifs = noms.map((n) => [n, new RegExp('(?<!' + SUITE + ')' + echappe(n) + '(?!' + SUITE + ')', 'g')]);

const compte = new Map();
const parFichier = [];
for (const f of FILES) {
	const p = path.join(ROOT, f);
	const avant = fs.readFileSync(p, 'utf8');
	let texte = avant;
	let n = 0;
	for (const [nom, re] of motifs) {
		texte = texte.replace(re, () => {
			n++;
			compte.set(nom, (compte.get(nom) || 0) + 1);
			return MAP.get(nom);
		});
	}
	if (!n) continue;
	parFichier.push([f, n]);
	if (!DRY) fs.writeFileSync(p, texte, 'utf8');
}

const jamais = noms.filter((n) => !compte.has(n));
const l = [];
l.push((DRY ? 'ESSAI A BLANC — ' : '') + 'renommage mot entier, tous fichiers');
l.push('');
for (const [f, n] of parFichier) l.push('  ' + f.padEnd(24) + String(n).padStart(5));
l.push('');
l.push('  noms de la carte       : ' + noms.length);
l.push('  noms effectivement vus : ' + compte.size);
l.push('  remplacements totaux   : ' + [...compte.values()].reduce((a, b) => a + b, 0));
if (jamais.length) {
	l.push('');
	l.push('  ECHEC : ' + jamais.length + ' nom(s) introuvables — la carte a derive des fichiers.');
	for (const n of jamais) l.push('      ' + n);
}
const texte = l.join('\n');
fs.writeFileSync(path.join(__dirname, 'wordapply-report.txt'), texte, 'utf8');
console.log(texte);
process.exit(jamais.length ? 1 : 0);
