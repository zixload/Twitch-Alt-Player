'use strict';
/*
	Isolates the names that can be renamed in the markup and the stylesheets alone.

	A name qualifies only if it appears in no JavaScript file at all — not as a string, not as an
	identifier, not as a fragment of a compound selector, not anywhere. That is stricter than
	"the inventory found no JS string for it", and deliberately so: the inventory reads string
	literals, while JavaScript can also reach an element through a querySelector fragment, a
	data-attribute name, or a class built by concatenation. A plain substring search over the
	scripts cannot miss any of those.

	Everything it rejects is not lost, only deferred: those names move later, in one pass that
	rewrites all three sides together.

	Usage: node domslice.js
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'domscan.json'), 'utf8'));

const JS = ['common.js', 'content.js', 'player.js', 'worker.js', 'sidebar.js',
	'channelbar.js', 'background.js', 'autoclaim.js', 'gqltoken.js', 'content_injection.js']
	.filter((f) => fs.existsSync(path.join(ROOT, f)));
const sources = JS.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));

const persisted = new Set(d.persisted);

const sur = [];
const differe = [];
for (const [name, roles, files] of d.names) {
	const vuEnJs = sources.some((s) => s.includes(name));
	if (!vuEnJs && !persisted.has(name) && !roles.includes('chaine-js')) {
		sur.push([name, roles, files]);
	} else {
		differe.push([name, roles, vuEnJs ? 'cite en JS' : (persisted.has(name) ? 'persiste' : 'chaine JS')]);
	}
}

const l = [];
l.push('TRANCHE SURE — renommable dans le balisage et les feuilles de style seuls');
l.push('  ' + sur.length + ' noms, aucun n\'apparait dans un fichier JavaScript');
l.push('');
for (const [name, roles, files] of sur.sort()) {
	l.push('  ' + name.padEnd(40) + roles.join('+').padEnd(24) + files.join(' '));
}
l.push('');
l.push('DIFFERE — exige la passe a trois cotes : ' + differe.length);

fs.writeFileSync(path.join(__dirname, 'domslice-report.txt'), l.join('\n'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'domslice.json'),
	JSON.stringify(sur.map((x) => x[0]), null, 1), 'utf8');
console.log('tranche sure : ' + sur.length + ' noms   differe : ' + differe.length);
