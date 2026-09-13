'use strict';
/*
	Writes translated prose back into the exact source ranges textscan.js recorded.

	Translations are keyed by the index of the distinct text in textscan-todo.txt and give only the
	core of the sentence. The leading and trailing whitespace of the original is put back by this
	script, never by the translator: a template fragment such as " КодКанала=" is glued to a ${...}
	on either side, and a translation that lost its leading space would run two log fields together.

	Guards before writing anything:
	  - every translation must itself be free of Cyrillic, or it is not a translation;
	  - a string literal must not gain the quote character that delimits it;
	  - a template fragment must not gain a backtick or a "${", which would change the code;
	  - after rewriting, every JavaScript file must still parse.

	Usage: node textapply.js <translations.json> [--dry]
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const TR_PATH = process.argv[2];
if (!TR_PATH) {
	console.error('usage: node textapply.js <translations.json> [--dry]');
	process.exit(2);
}

const scan = JSON.parse(fs.readFileSync(path.join(__dirname, 'textscan.json'), 'utf8'));
const tr = JSON.parse(fs.readFileSync(TR_PATH, 'utf8'));

// Meme ordre que textscan-todo.txt : premiere apparition de chaque texte distinct.
const ordre = [];
const vu = new Set();
for (const x of scan) {
	if (!vu.has(x.text)) {
		vu.add(x.text);
		ordre.push(x.text);
	}
}

const CYR = /[Ѐ-ӿ]/;
const erreurs = [];
const parTexte = new Map();
for (const [cle, valeur] of Object.entries(tr)) {
	if (cle.startsWith('//')) continue;
	const i = Number(cle);
	if (!Number.isInteger(i) || i < 0 || i >= ordre.length) {
		erreurs.push(`index ${cle} hors de la liste`);
		continue;
	}
	if (CYR.test(valeur)) {
		erreurs.push(`#${i} : la traduction contient encore du cyrillique -> ${valeur}`);
		continue;
	}
	const original = ordre[i];
	const tete = original.match(/^\s*/)[0];
	const queue = original.match(/\s*$/)[0];
	parTexte.set(original, tete + valeur.trim() + queue);
}

// Quel delimiteur entoure chaque fragment de chaine ?
const sources = new Map();
const lire = (f) => {
	if (!sources.has(f)) sources.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
	return sources.get(f);
};
for (const x of scan) {
	const neuf = parTexte.get(x.text);
	if (neuf === undefined) continue;
	if (x.kind === 'chaine') {
		const q = lire(x.file)[x.start - 1];
		if (neuf.includes(q)) erreurs.push(`${x.file} : la traduction de « ${x.text.trim()} » contient son delimiteur ${q}`);
	}
	if (x.kind === 'gabarit' && (neuf.includes('`') || neuf.includes('${'))) {
		erreurs.push(`${x.file} : la traduction de « ${x.text.trim()} » changerait le gabarit`);
	}
}
if (erreurs.length) {
	console.error('REFUS, rien n\'a ete ecrit :');
	for (const e of erreurs) console.error('  ' + e);
	process.exit(1);
}

// Ecriture, fichier par fichier, de la fin vers le debut pour garder les positions justes.
const parFichier = new Map();
for (const x of scan) {
	const neuf = parTexte.get(x.text);
	if (neuf === undefined) continue;
	if (!parFichier.has(x.file)) parFichier.set(x.file, []);
	parFichier.get(x.file).push({ start: x.start, end: x.end, neuf });
}

let total = 0;
const bilan = [];
for (const [f, edits] of parFichier) {
	let out = lire(f);
	for (const e of edits.sort((a, b) => b.start - a.start)) {
		out = out.slice(0, e.start) + e.neuf + out.slice(e.end);
	}
	if (/\.js$/.test(f)) {
		try {
			parser.parse(out, { sourceType: 'script', allowReturnOutsideFunction: true });
		} catch (err) {
			console.error(`REFUS : ${f} ne se lit plus apres traduction (${err.message}). Rien n'a ete ecrit.`);
			process.exit(1);
		}
	}
	bilan.push([f, edits.length]);
	total += edits.length;
	if (!DRY) fs.writeFileSync(path.join(ROOT, f), out, 'utf8');
}

console.log((DRY ? 'ESSAI A BLANC — ' : '') + `${parTexte.size} textes traduits, ${total} fragments reecrits`);
for (const [f, n] of bilan) console.log(`  ${f.padEnd(22)} ${n}`);
console.log(`  restant non traduit : ${ordre.length - parTexte.size} texte(s)`);
