'use strict';
/*
	Inventories every Cyrillic name shared between the script, the markup and the stylesheets.

	These are the names the JavaScript pass deliberately spared. They cannot move one side at a
	time: `player.js` looks elements up by id, the stylesheets select the same elements by id and
	class, and the settings schema is keyed by element id — `m_Settings.Get(nodeButton.id)` reads
	the storage key straight off the button. Three files have to agree letter for letter.

	Some of those keys are also persisted in chrome.storage. Renaming one without a migration
	silently resets that setting for the user, which is why they are counted separately here.

	Usage: node domscan.js
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const ROOT = path.resolve(__dirname, '..', '..');
const CYR = /[Ѐ-ӿ]/;
const WORD = /[Ѐ-ӿ][Ѐ-ӿA-Za-z0-9_$-]*/g;

const JS = ['common.js', 'content.js', 'player.js', 'worker.js', 'sidebar.js',
	'channelbar.js', 'background.js', 'autoclaim.js', 'gqltoken.js', 'content_injection.js'];
const HTML = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f));
const CSS = fs.readdirSync(ROOT).filter((f) => /\.css$/i.test(f));

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Where each name appears, and in what role.
const names = new Map();
const note = (name, role, file) => {
	if (!CYR.test(name)) return;
	if (!names.has(name)) names.set(name, { roles: new Set(), files: new Set() });
	const e = names.get(name);
	e.roles.add(role);
	e.files.add(file);
};

for (const f of HTML) {
	const text = read(f);
	for (const m of text.matchAll(/\b(id|class|for|name|data-[a-z-]+)\s*=\s*"?([^">\s]+)"?/g)) {
		for (const tok of m[2].split(/\s+/)) note(tok, m[1] === 'class' ? 'classe' : m[1], f);
	}
}
for (const f of CSS) {
	const text = read(f);
	// Selecteurs seulement : le corps d'une regle ne nomme pas d'element.
	for (const m of text.matchAll(/([^{}]+)\{/g)) {
		for (const tok of m[1].match(WORD) || []) note(tok, 'selecteur', f);
	}
}
/*
	Les chaines JavaScript se lisent avec l'analyseur, jamais a l'expression reguliere.

	Un premier jet cherchait les chaines au motif « guillemet, contenu, guillemet ». Il se
	desynchronise a la premiere apostrophe d'un commentaire -- et ce depot en est plein, en russe
	comme en francais : l'apostrophe ouvre une fausse chaine qui avale tout jusqu'a la suivante.
	Resultat, l'identifiant du lecteur lui-meme, cite quatre fois par GetNode("проигрывательичат"),
	etait classe « sans reference JavaScript ». La tranche dite sure ne l'etait pas.
*/
for (const f of JS) {
	const ast = parser.parse(read(f), {
		sourceType: 'script',
		allowReturnOutsideFunction: true,
		errorRecovery: true,
	});
	traverse(ast, {
		StringLiteral(p) {
			const v = p.node.value;
			if (!CYR.test(v)) return;
			// Un mot seul est un candidat ; une phrase ne nomme pas un element.
			if (/^[Ѐ-ӿA-Za-z0-9_$-]+$/.test(v)) note(v, 'chaine-js', f);
		},
	});
}

// Les cles persistees, relevees a leur source : le schema de common.js.
const persisted = new Set();
{
	const text = read('common.js');
	const start = text.indexOf('const _oSettings = {');
	if (start !== -1) {
		let depth = 0, i = text.indexOf('{', start);
		const from = i;
		for (; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}' && --depth === 0) break;
		}
		const block = text.slice(from, i);
		for (const m of block.matchAll(/(?:^|[\s{,])([Ѐ-ӿ][Ѐ-ӿA-Za-z0-9_$]*)\s*:/gm)) {
			persisted.add(m[1]);
		}
	}
}

const lignes = [];
const par = (role) => [...names].filter(([, e]) => e.roles.has(role));

lignes.push('noms cyrilliques partages entre script, balisage et feuilles de style');
lignes.push('');
for (const role of ['id', 'classe', 'selecteur', 'for', 'name', 'chaine-js']) {
	lignes.push('  ' + role.padEnd(12) + par(role).length);
}
lignes.push('');
lignes.push('TOTAL distinct : ' + names.size);
lignes.push('dont persistes dans chrome.storage : ' + persisted.size
	+ '   (renommer sans migration = reglages perdus)');
lignes.push('');
lignes.push('--- CLES PERSISTEES ---');
for (const k of [...persisted].sort()) lignes.push('  ' + k);
lignes.push('');
lignes.push('--- TOUS LES NOMS, role et fichiers ---');
for (const [name, e] of [...names].sort()) {
	lignes.push('  ' + name.padEnd(38) + [...e.roles].join('+').padEnd(26)
		+ [...e.files].join(' '));
}

const dest = path.join(__dirname, 'domscan-report.txt');
fs.writeFileSync(dest, lignes.join('\n'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'domscan.json'), JSON.stringify({
	names: [...names].map(([n, e]) => [n, [...e.roles], [...e.files]]),
	persisted: [...persisted],
}, null, 1), 'utf8');
console.log('rapport ecrit : ' + dest + '   (' + names.size + ' noms, '
	+ persisted.size + ' persistes)');
