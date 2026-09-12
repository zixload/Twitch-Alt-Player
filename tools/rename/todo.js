'use strict';
/*
	Lists the Cyrillic identifiers still waiting for a name, with enough context to name them.

	Translating an identifier without seeing how it is used is inventing, not translating. So each
	entry carries its kind, how often it appears, and the first line that mentions it.

	Names already spared on purpose — written as a string somewhere, or present in the markup and
	the stylesheets — are listed apart: they are not waiting for a translation here, they are
	waiting for the coordinated pass that moves both sides at once.

	Usage: node todo.js <file.js> [...]
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const CYR = /[Ѐ-ӿ]/;
const MAP = new Map(Object.entries(
	JSON.parse(fs.readFileSync(path.join(__dirname, 'map-clean.json'), 'utf8'))));

function parse(src) {
	return parser.parse(src, {
		sourceType: 'script',
		allowReturnOutsideFunction: true,
		ranges: true,
		errorRecovery: true,
	});
}

function collectSpared(dir, files) {
	const spared = new Set();
	for (const file of files) {
		const ast = parse(fs.readFileSync(file, 'utf8'));
		traverse(ast, {
			StringLiteral(p) { if (CYR.test(p.node.value)) spared.add(p.node.value); },
			TemplateElement(p) {
				const v = p.node.value && p.node.value.cooked;
				if (v && CYR.test(v)) spared.add(v);
			},
		});
	}
	for (const f of fs.readdirSync(dir).filter((n) => /\.(html|css)$/i.test(n))) {
		const text = fs.readFileSync(path.join(dir, f), 'utf8');
		for (const w of text.match(/[Ѐ-ӿ][Ѐ-ӿA-Za-z0-9_$-]*/g) || []) {
			spared.add(w);
		}
	}
	return spared;
}

const FILES = process.argv.slice(2);
if (!FILES.length) {
	console.error('usage: node todo.js <file.js> [...]');
	process.exit(2);
}
const dir = path.dirname(path.resolve(FILES[0]));
const spared = collectSpared(dir, FILES);

const out = [];
for (const file of FILES) {
	const src = fs.readFileSync(file, 'utf8');
	const lines = src.split('\n');
	const ast = parse(src);
	const info = new Map(); // name -> {kind, count, line}

	const note = (name, kind, node) => {
		if (!CYR.test(name)) return;
		const cur = info.get(name) || { kind, count: 0, line: 0 };
		cur.count += 1;
		if (!cur.line) cur.line = src.slice(0, node.start).split('\n').length;
		if (kind === 'liaison') cur.kind = 'liaison';
		info.set(name, cur);
	};

	traverse(ast, {
		Scope(p) {
			for (const name of Object.keys(p.scope.bindings)) {
				note(name, 'liaison', p.scope.bindings[name].identifier);
			}
		},
		Identifier(p) {
			const parent = p.parent;
			const isProp = parent && !parent.computed
				&& ((parent.type === 'MemberExpression' && parent.property === p.node)
					|| (/^(ObjectProperty|ObjectMethod|ClassMethod|ClassProperty)$/.test(parent.type)
						&& parent.key === p.node));
			if (isProp) note(p.node.name, 'propriete', p.node);
		},
	});

	const waiting = [];
	const held = [];
	for (const [name, d] of info) {
		if (MAP.has(name)) continue;                  // deja traduit
		(spared.has(name) ? held : waiting).push([name, d]);
	}
	waiting.sort((a, b) => b[1].count - a[1].count);

	out.push('');
	out.push('='.repeat(78));
	out.push(path.basename(file) + ' — ' + waiting.length + ' noms a traduire, '
		+ held.length + ' epargnes (passe coordonnee)');
	out.push('='.repeat(78));
	for (const [name, d] of waiting) {
		out.push('');
		out.push('  ' + name + '   [' + d.kind + ', ' + d.count + 'x, L' + d.line + ']');
		out.push('      ' + (lines[d.line - 1] || '').trim().slice(0, 110));
	}
	if (held.length) {
		out.push('');
		out.push('  --- epargnes, en attente de la passe coordonnee ---');
		out.push('  ' + held.map(([n]) => n).sort().join(', '));
	}
}

const dest = path.join(__dirname, 'todo-report.txt');
fs.writeFileSync(dest, out.join('\n'), 'utf8');
console.log('rapport ecrit : ' + dest);
