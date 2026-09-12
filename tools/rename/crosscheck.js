'use strict';
/*
	Checks that the script, the markup and the stylesheets still agree on every name.

	The harness proves the stream plays. It does not prove that every button still responds or
	that every rule still matches: a stylesheet selecting an id nobody carries any more looks
	exactly like a stylesheet that works, and a getElementById on a name the markup lost returns
	null quietly until something dereferences it.

	So this is a static invariant, meant to be run before a rename and again after. The numbers
	must be identical. If a dangling reference appears that was not there before, the rename lost
	a side.

	Usage: node crosscheck.js [--json <fichier>]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const list = (re) => fs.readdirSync(ROOT).filter((f) => re.test(f));

const HTML = list(/\.html$/i);
const CSS = list(/\.css$/i);
const JS = ['common.js', 'content.js', 'player.js', 'worker.js', 'sidebar.js',
	'channelbar.js', 'background.js', 'autoclaim.js', 'gqltoken.js', 'content_injection.js']
	.filter((f) => fs.existsSync(path.join(ROOT, f)));

// Ce que le balisage porte reellement.
const htmlIds = new Set();
const htmlClasses = new Set();
const htmlNames = new Set();
for (const f of HTML) {
	const text = read(f);
	// Le balisage commente ne compte pas : il n'est pas dans le document.
	const vivant = text.replace(/<!--[\s\S]*?-->/g, '');
	for (const m of vivant.matchAll(/\bid\s*=\s*"?([^"'>\s]+)"?/g)) htmlIds.add(m[1]);
	for (const m of vivant.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
		for (const c of m[1].split(/\s+/)) if (c) htmlClasses.add(c);
	}
	for (const m of vivant.matchAll(/\bclass\s*=\s*([^"'>\s]+)/g)) htmlClasses.add(m[1]);
	for (const m of vivant.matchAll(/\bname\s*=\s*"?([^"'>\s]+)"?/g)) htmlNames.add(m[1]);
}

// Ce que le script demande au balisage.
const jsIds = new Map();      // nom -> fichiers
const jsClasses = new Map();
const ajoute = (map, k, f) => {
	if (!map.has(k)) map.set(k, new Set());
	map.get(k).add(f);
};
for (const f of JS) {
	const text = read(f);
	for (const m of text.matchAll(/(?:getElementById|GetNode)\(\s*(['"])([^'"]+)\1/g)) {
		ajoute(jsIds, m[2], f);
	}
	for (const m of text.matchAll(/classList\.(?:add|remove|toggle|contains|replace)\(\s*(['"])([^'"]+)\1/g)) {
		ajoute(jsClasses, m[2], f);
	}
	for (const m of text.matchAll(/querySelector(?:All)?\(\s*(['"])([^'"]+)\1/g)) {
		for (const mm of m[2].matchAll(/#([A-Za-z0-9_Ѐ-ӿ-]+)/g)) ajoute(jsIds, mm[1], f);
		for (const mm of m[2].matchAll(/\.([A-Za-z0-9_Ѐ-ӿ-]+)/g)) ajoute(jsClasses, mm[1], f);
	}
}

// Ce que les feuilles de style selectionnent.
const cssIds = new Map();
const cssClasses = new Map();
for (const f of CSS) {
	const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of text.matchAll(/([^{}]+)\{/g)) {
		const sel = m[1];
		if (/^\s*@/.test(sel)) continue;  // at-rules : pas des selecteurs d'element
		for (const mm of sel.matchAll(/#([A-Za-z0-9_Ѐ-ӿ-]+)/g)) ajoute(cssIds, mm[1], f);
		for (const mm of sel.matchAll(/\.([A-Za-z0-9_Ѐ-ӿ-]+)/g)) ajoute(cssClasses, mm[1], f);
	}
}

const pendant = (map, present) =>
	[...map].filter(([k]) => !present.has(k)).map(([k, fs2]) => [k, [...fs2].join(' ')]);

const jsIdsOrphelins = pendant(jsIds, htmlIds);
const jsClassesOrphelines = pendant(jsClasses, htmlClasses);
const cssIdsOrphelins = pendant(cssIds, htmlIds);
const cssClassesOrphelines = pendant(cssClasses, htmlClasses);

const l = [];
l.push('ACCORD ENTRE SCRIPT, BALISAGE ET FEUILLES DE STYLE');
l.push('');
l.push('  identifiants portes par le balisage   : ' + htmlIds.size);
l.push('  classes portees par le balisage       : ' + htmlClasses.size);
l.push('  identifiants demandes par le script   : ' + jsIds.size);
l.push('  classes manipulees par le script      : ' + jsClasses.size);
l.push('  identifiants selectionnes par le CSS  : ' + cssIds.size);
l.push('  classes selectionnees par le CSS      : ' + cssClasses.size);
l.push('');
l.push('REFERENCES PENDANTES — le nom est demande, le balisage ne le porte pas');
l.push('');
const bloc = (titre, arr) => {
	l.push('  ' + titre + ' : ' + arr.length);
	for (const [k, f] of arr.sort()) l.push('      ' + k.padEnd(40) + f);
};
bloc('identifiants, cote script', jsIdsOrphelins);
bloc('classes, cote script', jsClassesOrphelines);
bloc('identifiants, cote CSS', cssIdsOrphelins);
bloc('classes, cote CSS', cssClassesOrphelines);

const total = jsIdsOrphelins.length + jsClassesOrphelines.length
	+ cssIdsOrphelins.length + cssClassesOrphelines.length;
l.push('');
l.push('TOTAL PENDANTES : ' + total);

const texte = l.join('\n');
fs.writeFileSync(path.join(__dirname, 'crosscheck-report.txt'), texte, 'utf8');
console.log(texte.split('\n').slice(0, 10).join('\n'));
console.log('...');
console.log('TOTAL PENDANTES : ' + total);

const ji = process.argv.indexOf('--json');
if (ji !== -1 && process.argv[ji + 1]) {
	fs.writeFileSync(process.argv[ji + 1], JSON.stringify({
		total,
		jsIds: jsIdsOrphelins.map((x) => x[0]).sort(),
		jsClasses: jsClassesOrphelines.map((x) => x[0]).sort(),
		cssIds: cssIdsOrphelins.map((x) => x[0]).sort(),
		cssClasses: cssClassesOrphelines.map((x) => x[0]).sort(),
	}, null, 1), 'utf8');
}
