'use strict';
/*
	Extracts every piece of Russian text still in the extension, with its exact source span.

	What remains after the identifier passes is prose: log messages, error messages, status lines
	shown to the user, and comments. Prose does not translate word by word, so each fragment is
	collected whole, translated whole, and written back to the exact range it came from.

	Deliberately left out, because their Cyrillic is load-bearing:
	  - the keys of _moOldSettingNames in common.js. They name what is really stored in profiles
	    written before the rename; translating them would make the migration match nothing, and the
	    user's settings would silently reset — exactly what the migration exists to prevent.
	  - the language names shown in the language picker (Русский, Українська, Български).
	  - _locales/ru, which is the Russian translation of the interface and meant to be Russian.
	  - the two non-loaded copies of player.js.

	Output: textscan.json, a list of { file, start, end, kind, text } in source order.

	Usage: node textscan.js
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const ROOT = path.resolve(__dirname, '..', '..');
const CYR = /[Ѐ-ӿ]/;
const LANGUES = new Set(['Русский', 'Українська', 'Български']);

const JS = ['common.js', 'content.js', 'player.js', 'worker.js', 'sidebar.js', 'channelbar.js',
	'background.js', 'autoclaim.js', 'gqltoken.js', 'content_injection.js', 'pointerevent.js', 'asmjs.js']
	.filter((f) => fs.existsSync(path.join(ROOT, f)));
const AUTRES = fs.readdirSync(ROOT).filter((f) => /\.(html|css)$/i.test(f));

const out = [];

for (const f of JS) {
	const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
	const ast = parser.parse(src, {
		sourceType: 'script', allowReturnOutsideFunction: true, errorRecovery: true, attachComment: true,
	});

	// Plage a exclure : la table de migration, reperee par son nom.
	const exclues = [];
	traverse(ast, {
		VariableDeclarator(p) {
			if (p.node.id && p.node.id.name === '_moOldSettingNames') {
				exclues.push([p.node.start, p.node.end]);
			}
		},
	});
	const exclu = (a) => exclues.some(([s, e]) => a >= s && a < e);

	traverse(ast, {
		StringLiteral(p) {
			const v = p.node.value;
			if (!CYR.test(v) || LANGUES.has(v) || exclu(p.node.start)) return;
			// On garde la chaine SANS ses guillemets : on reecrit l'interieur seulement.
			out.push({ file: f, start: p.node.start + 1, end: p.node.end - 1, kind: 'chaine', text: src.slice(p.node.start + 1, p.node.end - 1) });
		},
		TemplateElement(p) {
			const raw = p.node.value.raw;
			if (!CYR.test(raw) || exclu(p.node.start)) return;
			out.push({ file: f, start: p.node.start, end: p.node.end, kind: 'gabarit', text: raw });
		},
	});
	for (const c of ast.comments || []) {
		if (!CYR.test(c.value) || exclu(c.start)) continue;
		// Le corps du commentaire, sans // ni /* */.
		const debut = c.start + 2;
		const fin = c.type === 'CommentBlock' ? c.end - 2 : c.end;
		out.push({ file: f, start: debut, end: fin, kind: 'commentaire', text: src.slice(debut, fin) });
	}
}

for (const f of AUTRES) {
	const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
	const motif = /\.css$/i.test(f) ? /\/\*([\s\S]*?)\*\//g : /<!--([\s\S]*?)-->/g;
	const ouvre = /\.css$/i.test(f) ? 2 : 4;
	for (const m of src.matchAll(motif)) {
		if (!CYR.test(m[1])) continue;
		const debut = m.index + ouvre;
		out.push({ file: f, start: debut, end: debut + m[1].length, kind: 'commentaire', text: m[1] });
	}
	// Texte visible hors commentaires et attributs title/placeholder/aria-label.
	if (/\.html$/i.test(f)) {
		const vivant = src.replace(/<!--[\s\S]*?-->/g, (x) => ' '.repeat(x.length));
		for (const m of vivant.matchAll(/\b(title|placeholder|aria-label|alt)="([^"]*)"/g)) {
			if (!CYR.test(m[2])) continue;
			const debut = m.index + m[0].indexOf('"') + 1;
			out.push({ file: f, start: debut, end: debut + m[2].length, kind: 'attribut', text: m[2] });
		}
	}
}

out.sort((a, b) => (a.file === b.file ? a.start - b.start : a.file.localeCompare(b.file)));
fs.writeFileSync(path.join(__dirname, 'textscan.json'), JSON.stringify(out, null, 1), 'utf8');

const parType = {};
const parFichier = {};
for (const x of out) {
	parType[x.kind] = (parType[x.kind] || 0) + 1;
	parFichier[x.file] = (parFichier[x.file] || 0) + 1;
}
const distincts = new Set(out.map((x) => x.text)).size;
console.log(`${out.length} fragments, ${distincts} textes distincts`);
console.log('  par nature  : ' + Object.entries(parType).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  par fichier : ' + Object.entries(parFichier).map(([k, v]) => `${k} ${v}`).join(', '));
