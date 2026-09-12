'use strict';
/*
	Renames element names on all three sides at once: markup, stylesheets, and the strings the
	script uses to reach them.

	The two sides are not treated alike, on purpose.

	In HTML and CSS a whole-word textual replacement is sound, because the names are Cyrillic and
	no attribute, property or font ever carries a Cyrillic identifier.

	In JavaScript it is not. A textual pass would also rewrite comments and log messages, and any
	Cyrillic identifier still standing. So the scripts go through the parser and only string
	literals are touched — the exact places where the script names an element.

	Word boundaries are built by hand: \b does not recognise Cyrillic in JavaScript regular
	expressions, so the neighbours of a match must simply be unable to continue a name.

	Usage: node domapply3.js <map.json> [--dry]
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const MAP_PATH = process.argv[2];
if (!MAP_PATH) {
	console.error('usage: node domapply3.js <map.json> [--dry]');
	process.exit(2);
}
const MAP = new Map(Object.entries(JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')))
	.filter(([k]) => !k.startsWith('//')));

const SUITE = '[Ѐ-ӿA-Za-z0-9_-]';
const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Les noms longs d'abord : « статистика-сервер » avant « статистика ».
const noms = [...MAP.keys()].sort((a, b) => b.length - a.length);
const motifs = noms.map((n) => [n, new RegExp('(?<!' + SUITE + ')' + echappe(n) + '(?!' + SUITE + ')', 'g')]);

const remplacer = (texte, compte) => {
	let out = texte;
	for (const [nom, re] of motifs) {
		out = out.replace(re, () => {
			compte.set(nom, (compte.get(nom) || 0) + 1);
			return MAP.get(nom);
		});
	}
	return out;
};

const compte = new Map();
const parFichier = [];

// Balisage et feuilles de style : remplacement textuel.
for (const f of fs.readdirSync(ROOT).filter((x) => /\.(html|css)$/i.test(x))) {
	const p = path.join(ROOT, f);
	const avant = fs.readFileSync(p, 'utf8');
	const c = new Map();
	const apres = remplacer(avant, c);
	for (const [k, v] of c) compte.set(k, (compte.get(k) || 0) + v);
	const n = [...c.values()].reduce((a, b) => a + b, 0);
	if (n) {
		parFichier.push([f, n, 'texte']);
		if (!DRY) fs.writeFileSync(p, apres, 'utf8');
	}
}

// Scripts : uniquement les chaines litterales, reperees par l'analyseur.
const JS = ['common.js', 'content.js', 'player.js', 'worker.js', 'sidebar.js',
	'channelbar.js', 'background.js', 'autoclaim.js', 'gqltoken.js', 'content_injection.js']
	.filter((f) => fs.existsSync(path.join(ROOT, f)));

for (const f of JS) {
	const p = path.join(ROOT, f);
	const src = fs.readFileSync(p, 'utf8');
	const ast = parser.parse(src, {
		sourceType: 'script', allowReturnOutsideFunction: true, ranges: true, errorRecovery: true,
	});
	const edits = [];
	const c = new Map();
	traverse(ast, {
		StringLiteral(p2) {
			const v = p2.node.value;
			if (!/[Ѐ-ӿ]/.test(v)) return;
			const avant = new Map(c);
			const neuf = remplacer(v, c);
			if (neuf === v) return;
			void avant;
			// Reecrire la chaine en conservant son delimiteur d'origine.
			const brut = src.slice(p2.node.start, p2.node.end);
			const q = brut[0];
			edits.push({ start: p2.node.start, end: p2.node.end, texte: q + neuf.split(q).join('\\' + q) + q });
		},
		/*
			**Les gabarits comptent autant que les chaines.**

			Une premiere version ne traitait que StringLiteral. Or le lecteur interroge ses
			controles ainsi :

			    document.querySelector(`input[name="одновременныхзагрузок"][value="${...}"]`)

			Le nom vit dans un morceau de gabarit, pas dans une chaine litterale. Le balisage a
			donc ete renomme et la requete non, querySelector a rendu null, et le lecteur est mort
			au demarrage sur « Cannot set properties of null » — sans que le controle croise voie
			quoi que ce soit, puisqu'il ne lit pas les gabarits non plus.

			Un morceau de gabarit se reecrit tel quel : son texte brut est deja echappe.
		*/
		TemplateElement(p2) {
			const brut = p2.node.value && p2.node.value.raw;
			if (!brut || !/[Ѐ-ӿ]/.test(brut)) return;
			const neuf = remplacer(brut, c);
			if (neuf === brut) return;
			edits.push({ start: p2.node.start, end: p2.node.end, texte: neuf });
		},
	});
	if (!edits.length) continue;
	let out = src;
	for (const e of edits.sort((a, b) => b.start - a.start)) {
		out = out.slice(0, e.start) + e.texte + out.slice(e.end);
	}
	// Le fichier doit encore se lire, et avoir la meme forme.
	let ok = true, pourquoi = '';
	try {
		parser.parse(out, { sourceType: 'script', allowReturnOutsideFunction: true, errorRecovery: true });
	} catch (err) { ok = false; pourquoi = err.message; }
	if (!ok) {
		console.error('ECHEC sur ' + f + ' : ' + pourquoi);
		process.exit(1);
	}
	for (const [k, v] of c) compte.set(k, (compte.get(k) || 0) + v);
	parFichier.push([f, edits.length, 'chaines']);
	if (!DRY) fs.writeFileSync(p, out, 'utf8');
}

const jamais = noms.filter((n) => !compte.has(n));
const l = [];
l.push((DRY ? 'ESSAI A BLANC — ' : '') + 'renommage a trois cotes');
l.push('');
for (const [f, n, quoi] of parFichier) l.push('  ' + f.padEnd(22) + String(n).padStart(4) + '  ' + quoi);
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
fs.writeFileSync(path.join(__dirname, 'domapply3-report.txt'), texte, 'utf8');
console.log(texte);
process.exit(jamais.length ? 1 : 0);
