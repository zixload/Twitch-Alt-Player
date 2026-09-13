'use strict';
/*
	Unit test for m_Log, run without a browser.

	The harness plays a stream for thirty seconds: it never writes 1500 log records, so it never
	crosses the point where the ring wraps. That crossing is exactly where an off-by-one hides —
	the oldest record lost one step too early, or the order scrambled at the seam — and nothing
	would show it until someone read a bug report and found it garbled.

	So the module is loaded alone, in an isolated context, with the four helpers it borrows from
	common.js stubbed, and pushed through several full turns of the ring.

	Two of the expectations below were wrong on the first run, not the module: the record count
	before the fill loop, and which line becomes the head after two overwrites. Kept as written
	now, because the reasoning that corrected them is the reasoning the module depends on.

	Usage: node tests/log.test.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'common.js'), 'utf8');
const debut = src.indexOf('const m_Log = (() => {');
if (debut === -1) {
	console.error('m_Log introuvable dans common.js');
	process.exit(2);
}
const corps = src.slice(debut, src.indexOf('})();', debut) + 5);

function charger(bContentScript) {
	let t = 0;
	const ctx = {
		THIS_IS_CONTENT_SCRIPT: bContentScript,
		performance: { now: () => (t += 10) },
		Check: (c) => { if (!c) throw new Error('Check'); },
		LimitStringLength: (s, n) => (s.length <= n ? s : `${s.slice(0, n)}---8<---${s.length - n}`),
		Type: (v) => (v === null ? 'null' : typeof v),
		JSON,
		String,
	};
	vm.createContext(ctx);
	vm.runInContext(`${corps};this.m_Log = m_Log;`, ctx);
	return ctx.m_Log;
}

let echecs = 0;
const ok = (cond, msg) => {
	console.log(`${cond ? '  ok    ' : '  ECHEC '}${msg}`);
	if (!cond) echecs++;
};

const L = charger(false);
ok(L.GetDataForReport().length === 1, 'le demarrage laisse une ligne');
ok(/^ {2}\d+\.\d{3} \[Log\] Started/.test(L.GetDataForReport()[0]),
	'format : marque, secondes a trois decimales, texte');
L.Oops('x');
ok(L.GetDataForReport()[1].startsWith('@ '), 'Oops porte la marque @');
L.Wow('y');
ok(L.GetDataForReport()[2].startsWith('~ '), 'Wow porte la marque ~');

// Trois lignes deja ecrites : 1497 de plus pour atteindre exactement 1500.
for (let i = 0; i < 1497; i++) L.Here(`n${i}`);
let d = L.GetDataForReport();
ok(d.length === 1500, 'exactement a capacite : 1500 lignes');
ok(d[0].includes('Started'), 'a capacite, la plus ancienne est en tete');
ok(d[1499].endsWith('n1496'), 'a capacite, la plus recente est en fin');

// Deux ecritures de plus ecrasent les deux plus anciennes : Started, puis Oops.
L.Here('apres-1');
L.Here('apres-2');
d = L.GetDataForReport();
ok(d.length === 1500, 'au-dela : toujours 1500, rien ne grossit');
ok(!d.some((l) => l.includes('Started')), 'au-dela : la plus ancienne a ete ecrasee');
ok(d[1499].endsWith('apres-2') && d[1498].endsWith('apres-1'),
	'au-dela : ordre chronologique tenu au passage du tour');
ok(d[0].startsWith('~ ') && d[0].endsWith(' y'), 'au-dela de deux : la tete est Wow');

for (let i = 0; i < 4000; i++) L.Here(`tour${i}`);
d = L.GetDataForReport();
ok(d.length === 1500 && d[1499].endsWith('tour3999') && d[0].endsWith('tour2500'),
	'plusieurs tours complets : fenetre glissante exacte');

const copie = L.GetDataForReport();
copie.length = 0;
ok(L.GetDataForReport().length === 1500, 'le rapport rend une copie, l anneau reste intact');

let leve = false;
try { L.Here('a', 'b'); } catch (e) { leve = true; }
ok(leve, 'deux arguments sont refuses');

ok(L.F2(3.14159) === '3.14' && L.F0('x') === 'NaN', 'formateurs de nombres');
ok(L.O({ a: 1 }) === '{"a":1}' && L.O(Symbol()) === '[symbol]' && L.O(null) === 'null',
	'rendu de valeurs');

const C = charger(true);
C.Here('ignore');
ok(C.GetDataForReport() === null, 'script de contenu : journal inerte');

console.log(echecs ? `\nECHEC : ${echecs}` : '\nOK : tous les cas');
process.exit(echecs ? 1 : 0);
