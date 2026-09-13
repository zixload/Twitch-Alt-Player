'use strict';
/*
	Proves that crosscheck.js can fail.

	A check that prints the same number before and after a rename proves nothing unless it is
	known to print a different one when a side is lost. So each case below copies the extension
	into a temporary directory, renames ONE side of one name, and requires crosscheck to report
	that exact name as a new dangling reference. Nothing in the repository is modified.

	Case 1 reproduces the outage the first version missed: the markup renamed, the template
	literal querying it not.

	**Compare the lists, never the totals.** Case 8 repairs a reference that is dangling today and
	breaks a prefix lookup in the same pass: the total stays equal while a lookup has just broken.
	The case requires both — the broken name reported, and the total unchanged — so the lesson it
	demonstrates cannot quietly stop being demonstrated. The rename procedure must diff the --json
	lists, which is what this test and verify.py do.

	Usage: node crosscheck-selftest.js      (exit 0 when every case is caught)
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = path.join(__dirname, 'crosscheck.js');
const COPY = /\.(html|css|js|json)$/i;

const CASES = [
	['panne documentee : name= lu dans un gabarit', 'concurrentdownloads',
		[['player.html', /name=concurrentdownloads\b/g, 'name=parallelloads']]],
	['classe lue dans un gabarit (script seul)', 'numberinput-cell',
		[['player.js', /> \.numberinput-number`/, '> .numberinput-cell`']]],
	['selecteur tenu dans une constante', 'topbar',
		[['channelbar.js', /'#toppanel \[/, "'#topbar ["]]],
	['attribut data-* renomme au balisage seul', 'data-window-toggle',
		[['player.html', /data-window-toggle/g, 'data-window-switch']]],
	['classe renommee au CSS seul', 'windowopened',
		[['player.css', /\.windowopen\b/g, '.windowopened']]],
	['classe posee via un alias de classList', 'chatleft',
		[['player.js', /"chatleft"/g, '"panelleft"']]],
	['id demande par GetNode nu', 'opennews',
		[['player.html', /id=opennews\b/g, 'id=newsbutton']]],
	/*
		Ce cas vient d'une vraie panne. Le lot de 64 noms avait renomme l'identifiant complet dans
		le balisage sans voir que player.js le construit par prefixe, GetNode(`scrollindicator-${elScroll.id}`) :
		GetNode rendait null et le bouton de verification des couleurs ne repondait plus.

		**La meme passe repare une autre pendante.** Tant que l'arbre portait le prefixe casse, le
		cas le reparait d'un cote et le cassait de l'autre, et le total ne bougeait pas. La
		reparation passee dans la source, le cas ne faisait plus que casser : le total montait, et la
		demonstration du masquage avait disparu sans que rien ne le signale. Le cas choisit donc
		lui-meme une pendante du moment et la repare, pour que le total reste egal par construction.
	*/
	["prefixe d'id casse, masque par une reparation (total inchange)", 'scrollindicator-',
		(base) => {
			const edits = [['player.html', /id=scrollindicator-newstext\b/g, 'id=scrollhint-newstext']];
			const cls = (base.extension.class || [])[0];
			if (cls) edits.push(['player.html', /$/, '\n<i class=' + cls + '></i>\n']);
			return edits;
		}, { totalInchange: true }],
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crosscheck-selftest-'));

const snapshot = (name) => {
	const dir = path.join(work, name);
	fs.mkdirSync(dir);
	for (const f of fs.readdirSync(ROOT)) {
		if (COPY.test(f) && fs.statSync(path.join(ROOT, f)).isFile()) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
	}
	// Les modules extraits vivent dans modules/ : sans eux, la copie ne chargerait pas les memes scripts.
	if (fs.existsSync(path.join(ROOT, 'modules'))) fs.cpSync(path.join(ROOT, 'modules'), path.join(dir, 'modules'), { recursive: true });
	return dir;
};

// Pendantes du perimetre de l'extension, prefixes compris, sous forme d'ensemble.
const dangling = (dir) => {
	const json = path.join(dir, 'cc.json');
	execFileSync(process.execPath, [CHECK, '--root', dir, '--out', path.join(dir, 'cc.txt'), '--json', json], { stdio: 'ignore' });
	const r = JSON.parse(fs.readFileSync(json, 'utf8'));
	return { total: r.total, extension: r.extension, names: new Set(Object.values(r.extension).flat()) };
};

let failures = 0;
try {
	const base = dangling(snapshot('base'));
	console.log('reference : ' + base.total + ' pendante(s)');
	console.log('');
	CASES.forEach(([label, expected, editsOrFn, opts = {}], i) => {
		const dir = snapshot('case' + (i + 1));
		const edits = typeof editsOrFn === 'function' ? editsOrFn(base) : editsOrFn;
		if (opts.totalInchange && edits.length < 2) {
			// Plus aucune pendante a reparer : le masquage ne peut pas etre montre, et on le dit.
			console.log('  INVALIDE  ' + label + ' — aucune pendante a reparer dans l\'arbre, le total ne peut pas rester egal');
			failures++;
			return;
		}
		for (const [file, re, to] of edits) {
			const p = path.join(dir, file);
			const before = fs.readFileSync(p, 'utf8');
			const after = before.replace(re, to);
			if (after === before) {
				// La mutation doit mordre : sinon le cas ne prouve rien, et le fichier a derive.
				console.log('  INVALIDE  ' + label + ' — ' + file + ' ne contient plus ' + re);
				failures++;
				return;
			}
			fs.writeFileSync(p, after, 'utf8');
		}
		const res = dangling(dir);
		const appeared = [...res.names].filter((n) => !base.names.has(n));
		// Le cas du masquage exige les deux : le nom casse vu, ET le total inchange.
		const ok = appeared.includes(expected) && (!opts.totalInchange || res.total === base.total);
		if (!ok) failures++;
		console.log('  ' + (ok ? 'VU      ' : 'RATE    ') + '  ' + String(i + 1) + '. ' + label.padEnd(52)
			+ base.total + ' -> ' + res.total + (ok ? '' : '   attendu : ' + expected + ', apparu : ' + (appeared.join(' ') || 'rien')));
	});
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
console.log('');
console.log(failures ? failures + ' cas non detecte(s) : crosscheck.js ne garde plus les renommages.' : 'Tous les cas sont detectes.');
process.exit(failures ? 1 : 0);
