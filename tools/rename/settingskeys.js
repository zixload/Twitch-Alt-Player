'use strict';
/*
	Lists the settings keys that are actually persisted, read from the schema itself.

	A first attempt matched `word:` inside the _oSettings block with a regular expression and
	returned four keys that are not keys at all — «настроек», «файла», «хранилища», «хранилище» —
	ordinary Russian words caught inside comments and nested literals. Renaming one of those as
	though it were a storage key would have been a rename with no twin on the other side.

	So the schema is parsed, and only the keys at its top level count. These are the names written
	into chrome.storage: renaming one without a migration wipes that setting for the user.

	Usage: node settingskeys.js
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'common.js'), 'utf8');
const ast = parser.parse(src, {
	sourceType: 'script',
	allowReturnOutsideFunction: true,
	errorRecovery: true,
});

const cles = [];
traverse(ast, {
	VariableDeclarator(p) {
		if (!p.node.id || p.node.id.name !== '_oSettings') return;
		const init = p.node.init;
		if (!init || init.type !== 'ObjectExpression') return;
		for (const prop of init.properties) {
			const k = prop.key;
			if (!k) continue;
			const nom = k.type === 'Identifier' ? k.name
				: (k.type === 'StringLiteral' ? k.value : null);
			if (nom) cles.push(nom);
		}
		p.stop();
	},
});

const cyr = cles.filter((c) => /[Ѐ-ӿ]/.test(c));
const l = [];
l.push('cles du schema _oSettings : ' + cles.length);
l.push('dont encore en cyrillique : ' + cyr.length);
l.push('');
for (const c of cyr.sort()) l.push('  ' + c);
fs.writeFileSync(path.join(__dirname, 'settingskeys-report.txt'), l.join('\n'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'settingskeys.json'), JSON.stringify(cyr.sort(), null, 1), 'utf8');
console.log(cles.length + ' cles au schema, ' + cyr.length + ' encore en cyrillique');
