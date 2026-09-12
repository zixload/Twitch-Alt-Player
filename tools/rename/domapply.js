'use strict';
/*
	Renames element names across the markup and the stylesheets together.

	Only ever run with a map whose every name is absent from every JavaScript file — domslice.js
	establishes that. Within those limits a whole-word textual replacement is sound: the names are
	Cyrillic, and no HTML attribute, CSS property or web font ever uses a Cyrillic identifier, so
	there is nothing to collide with.

	Two guards before writing. The word boundary is built by hand, because \b does not work against
	Cyrillic in JavaScript regular expressions: the characters around a match must not be able to
	continue an identifier. And every name in the map must actually be found somewhere, or the map
	has drifted from the files.

	Usage: node domapply.js <map.json> [--dry]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const MAP_PATH = process.argv[2];
if (!MAP_PATH) {
	console.error('usage: node domapply.js <map.json> [--dry]');
	process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
const MAP = new Map(Object.entries(raw).filter(([k]) => !k.startsWith('//')));

const FILES = fs.readdirSync(ROOT).filter((f) => /\.(html|css)$/i.test(f));

// Un caractere qui peut continuer un nom d'element : lettre, chiffre, tiret, souligne.
const SUITE = '[Ѐ-ӿA-Za-z0-9_-]';
const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Les noms les plus longs d'abord : « статистика-сервер » doit passer avant « статистика ».
const noms = [...MAP.keys()].sort((a, b) => b.length - a.length);

const trouves = new Map();
const parFichier = [];

for (const f of FILES) {
	const p = path.join(ROOT, f);
	const avant = fs.readFileSync(p, 'utf8');
	let texte = avant;
	let n = 0;
	for (const nom of noms) {
		const re = new RegExp('(?<!' + SUITE + ')' + echappe(nom) + '(?!' + SUITE + ')', 'g');
		texte = texte.replace(re, () => {
			n++;
			trouves.set(nom, (trouves.get(nom) || 0) + 1);
			return MAP.get(nom);
		});
	}
	if (n && !DRY) fs.writeFileSync(p, texte, 'utf8');
	if (n) parFichier.push([f, n]);
}

const jamaisVus = noms.filter((n) => !trouves.has(n));

const l = [];
l.push((DRY ? 'ESSAI A BLANC — ' : '') + 'renommage du balisage et des feuilles de style');
l.push('');
for (const [f, n] of parFichier) l.push('  ' + f.padEnd(20) + n + ' remplacements');
l.push('');
l.push('  noms de la carte      : ' + noms.length);
l.push('  noms effectivement vus: ' + trouves.size);
l.push('  remplacements totaux  : ' + [...trouves.values()].reduce((a, b) => a + b, 0));
if (jamaisVus.length) {
	l.push('');
	l.push('  ECHEC : ' + jamaisVus.length + ' nom(s) de la carte ne figurent nulle part.');
	l.push('  La carte a derive des fichiers ; verifier avant d\'ecrire.');
	for (const n of jamaisVus) l.push('      ' + n);
}
const texte = l.join('\n');
fs.writeFileSync(path.join(__dirname, 'domapply-report.txt'), texte, 'utf8');
console.log(texte);
process.exit(jamaisVus.length ? 1 : 0);
