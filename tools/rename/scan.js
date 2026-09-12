'use strict';
/*
	Classifies every Cyrillic occurrence in a JavaScript file.

	Renaming this codebase fails the moment everything Cyrillic is treated alike. The same word
	can be a local binding (safe to rename inside its scope), a property on a module object (must
	change at the definition and at every call site, in every file), a DOM id inside a string (must
	change in player.html and player.css in the same breath), a settings key persisted in
	chrome.storage (renaming it silently resets the user's settings), or text a human reads.

	So this tool changes nothing. It sorts. Nothing gets renamed until we know which pile it is in.

	Usage: node scan.js <file.js> [more.js ...]
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const CYR = /[Ѐ-ӿ]/;

function parse(src) {
	return parser.parse(src, {
		sourceType: 'script',
		allowReturnOutsideFunction: true,
		ranges: true,
		errorRecovery: true,
	});
}

function scan(file) {
	const src = fs.readFileSync(file, 'utf8');
	let ast;
	try {
		ast = parse(src);
	} catch (e) {
		return { file, error: e.message };
	}

	const bindings = new Map();   // name -> { refs, scopes }
	const properties = new Map(); // name -> count
	const strings = new Map();    // value -> { count, kinds:Set }
	const labels = new Map();

	// Walks every scope and records declared bindings. These are the ones a scope-aware rename
	// can move safely, because the parser knows exactly which references belong to which one.
	traverse(ast, {
		Scope(p) {
			for (const name of Object.keys(p.scope.bindings)) {
				if (!CYR.test(name)) continue;
				const b = p.scope.bindings[name];
				const cur = bindings.get(name) || { refs: 0, decls: 0 };
				cur.refs += b.references;
				cur.decls += 1;
				bindings.set(name, cur);
			}
		},
		// Property names are not bindings. Babel cannot link `o.Получить` to the object that
		// defines it, so these need a coordinated pass across every file at once.
		MemberExpression(p) {
			const prop = p.node.property;
			if (!p.node.computed && prop && prop.type === 'Identifier' && CYR.test(prop.name)) {
				properties.set(prop.name, (properties.get(prop.name) || 0) + 1);
			}
		},
		ObjectProperty(p) {
			const key = p.node.key;
			if (!p.node.computed && key && key.type === 'Identifier' && CYR.test(key.name)) {
				properties.set(key.name, (properties.get(key.name) || 0) + 1);
			}
		},
		ObjectMethod(p) {
			const key = p.node.key;
			if (!p.node.computed && key && key.type === 'Identifier' && CYR.test(key.name)) {
				properties.set(key.name, (properties.get(key.name) || 0) + 1);
			}
		},
		ClassMethod(p) {
			const key = p.node.key;
			if (!p.node.computed && key && key.type === 'Identifier' && CYR.test(key.name)) {
				properties.set(key.name, (properties.get(key.name) || 0) + 1);
			}
		},
		ClassProperty(p) {
			const key = p.node.key;
			if (!p.node.computed && key && key.type === 'Identifier' && CYR.test(key.name)) {
				properties.set(key.name, (properties.get(key.name) || 0) + 1);
			}
		},
		LabeledStatement(p) {
			if (CYR.test(p.node.label.name)) {
				labels.set(p.node.label.name, (labels.get(p.node.label.name) || 0) + 1);
			}
		},
		// Strings are where the real danger lives, so each one is tagged by what its surrounding
		// call says it is used for, not by what it looks like.
		StringLiteral(p) {
			const v = p.node.value;
			if (!CYR.test(v)) return;
			const cur = strings.get(v) || { count: 0, kinds: new Set() };
			cur.count += 1;
			cur.kinds.add(classifyString(p));
			strings.set(v, cur);
		},
	});

	return { file, src, bindings, properties, strings, labels };
}

// What is this string actually used for? The answer decides whether it may be renamed, must be
// renamed in lockstep with another file, or must never be touched.
function classifyString(p) {
	const parent = p.parent;

	if (parent.type === 'CallExpression' && parent.arguments[0] === p.node) {
		const callee = parent.callee;
		const name = callee.type === 'Identifier' ? callee.name
			: (callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
				? callee.property.name : '');
		// DOM lookups: the twin lives in player.html / player.css.
		if (/^(Узел|getElementById|querySelector|querySelectorAll|closest|matches)$/.test(name)) {
			return 'dom-lookup';
		}
		// Settings: persisted in chrome.storage. Renaming resets the user's settings.
		if (/^(Получить|Установить|Get|Set)$/.test(name)
			&& callee.type === 'MemberExpression'
			&& callee.object.type === 'Identifier'
			&& /Настройки|Settings/.test(callee.object.name)) {
			return 'settings-key';
		}
		if (/^(add|remove|toggle|contains|replace)$/.test(name)) return 'css-class';
		if (/^(getAttribute|setAttribute|removeAttribute|hasAttribute)$/.test(name)) return 'attribute';
		if (/^(addEventListener|removeEventListener|dispatchEvent)$/.test(name)) return 'event-name';
		if (/^(Вот|Ой|Окак|Ага)$/.test(name)) return 'log-text';
		return 'call-arg:' + (name || '?');
	}
	if (parent.type === 'MemberExpression' && parent.computed && parent.property === p.node) {
		return 'computed-property';
	}
	if (parent.type === 'ObjectProperty' && parent.key === p.node) return 'object-key';
	if (parent.type === 'BinaryExpression') return 'comparison';
	return 'other';
}

function report(results) {
	const lines = [];
	const allBindings = new Map();
	const allProps = new Map();
	const allStrings = new Map();

	for (const r of results) {
		if (r.error) {
			lines.push('ERREUR  ' + r.file + ' : ' + r.error);
			continue;
		}
		lines.push('');
		lines.push('=== ' + path.basename(r.file) + ' ===');
		lines.push('  liaisons declarees (renommage sur : analyse de portee) : ' + r.bindings.size);
		lines.push('  noms de propriete (renommage coordonne tous fichiers)  : ' + r.properties.size);
		lines.push('  etiquettes de boucle                                   : ' + r.labels.size);
		lines.push('  chaines cyrilliques distinctes                         : ' + r.strings.size);

		const byKind = new Map();
		for (const [v, info] of r.strings) {
			for (const k of info.kinds) {
				if (!byKind.has(k)) byKind.set(k, []);
				byKind.get(k).push(v);
			}
		}
		for (const [k, vs] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
			lines.push('      ' + k.padEnd(24) + vs.length);
		}
		for (const [k, v] of r.bindings) allBindings.set(k, (allBindings.get(k) || 0) + v.refs);
		for (const [k, v] of r.properties) allProps.set(k, (allProps.get(k) || 0) + v);
		for (const [k, info] of r.strings) {
			const cur = allStrings.get(k) || { count: 0, kinds: new Set() };
			cur.count += info.count;
			for (const x of info.kinds) cur.kinds.add(x);
			allStrings.set(k, cur);
		}
	}

	lines.push('');
	lines.push('='.repeat(70));
	lines.push('TOTAL, tous fichiers confondus');
	lines.push('  liaisons distinctes   : ' + allBindings.size);
	lines.push('  proprietes distinctes : ' + allProps.size);
	lines.push('  chaines distinctes    : ' + allStrings.size);
	lines.push('');
	lines.push('CE QUI NE DOIT PAS BOUGER SANS PRECAUTION');
	const dom = [...allStrings].filter(([, i]) => i.kinds.has('dom-lookup'));
	const set = [...allStrings].filter(([, i]) => i.kinds.has('settings-key'));
	const css = [...allStrings].filter(([, i]) => i.kinds.has('css-class'));
	lines.push('  recherches DOM  : ' + dom.length + '  (jumeau dans player.html / player.css)');
	lines.push('  cles de reglages: ' + set.length + '  (persistees : renommer = reinitialiser)');
	lines.push('  classes CSS     : ' + css.length + '  (jumeau dans les feuilles de style)');
	lines.push('');
	lines.push('  cles de reglages, la liste complete :');
	for (const [v] of set.sort()) lines.push('    ' + v);

	return { text: lines.join('\n'), allBindings, allProps, allStrings };
}

const files = process.argv.slice(2);
if (!files.length) {
	console.error('usage: node scan.js <file.js> [...]');
	process.exit(2);
}
const results = files.map(scan);
const out = report(results);
const dest = path.join(__dirname, 'scan-report.txt');
fs.writeFileSync(dest, out.text, 'utf8');
fs.writeFileSync(path.join(__dirname, 'scan-report.json'), JSON.stringify({
	bindings: [...out.allBindings].sort((a, b) => b[1] - a[1]),
	properties: [...out.allProps].sort((a, b) => b[1] - a[1]),
	strings: [...out.allStrings].map(([v, i]) => [v, i.count, [...i.kinds]]),
}, null, 1), 'utf8');
console.log('rapport ecrit : ' + dest);
