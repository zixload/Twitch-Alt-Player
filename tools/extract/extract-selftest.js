'use strict';
/*
	Proves that extract.js extracts, refuses, and that extractcheck.js catches what is not a move.

	Every case works on a copy of the extension in a temporary directory. Nothing in the repository
	is modified.

	Three families:
	  - extractions that must succeed, and leave every other check where it was: construction order,
	    internal events, DOM names;
	  - extractions that must be refused, each for its own stated reason;
	  - trees that must NOT pass as a pure extraction — one alteration each, made after a good
	    extraction — and one that must pass: a comment edited is not behaviour.

	Usage: node extract-selftest.js      (exit 0 when every case behaves)
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const EXTRACT = path.join(__dirname, 'extract.js');
const CHECK = path.join(__dirname, 'extractcheck.js');
const GRAPH = path.join(__dirname, 'graph.js');
const EVENTS = path.join(REPO, 'tools', 'rename', 'eventcheck.js');
const CROSS = path.join(REPO, 'tools', 'rename', 'crosscheck.js');
const COPY = /\.(html|css|js|json)$/i;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-selftest-'));

const copyDir = (from, to) => {
	fs.mkdirSync(to, { recursive: true });
	for (const e of fs.readdirSync(from, { withFileTypes: true })) {
		if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
		else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
	}
};
const snapshot = (name, from = REPO) => {
	const dir = path.join(work, name);
	fs.mkdirSync(dir);
	for (const f of fs.readdirSync(from)) {
		if (COPY.test(f) && fs.statSync(path.join(from, f)).isFile()) fs.copyFileSync(path.join(from, f), path.join(dir, f));
	}
	if (fs.existsSync(path.join(from, 'modules'))) copyDir(path.join(from, 'modules'), path.join(dir, 'modules'));
	return dir;
};
const run = (script, args) => {
	const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
	return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const edit = (dir, file, re, to) => {
	const p = path.join(dir, file);
	const before = fs.readFileSync(p, 'utf8');
	const after = before.replace(re, to);
	if (after === before) throw new Error('mutation sans effet : ' + file + ' ne contient pas ' + re);
	fs.writeFileSync(p, after, 'utf8');
};
const scripts = (dir) => [...fs.readFileSync(path.join(dir, 'player.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
	.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]).join(' ');
const contentScripts = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
	.content_scripts.flatMap((cs) => cs.js).join(' ');
const startupLine = (dir) => {
	const lines = fs.readFileSync(path.join(dir, 'player.js'), 'utf8').split('\n');
	let n = 0;
	lines.forEach((l, i) => { if (/^AddExceptionHandler\(\(\) => \{/.test(l)) n = i + 1; });
	if (!n) throw new Error('instruction de demarrage introuvable dans player.js');
	return n;
};
const crossLists = (dir) => {
	const json = path.join(dir, '..', path.basename(dir) + '-cc.json');
	run(CROSS, ['--root', dir, '--out', json + '.txt', '--json', json]);
	return JSON.stringify(JSON.parse(fs.readFileSync(json, 'utf8')).extension);
};

// Une extraction reussie ne deplace aucun autre controle.
const unchangedElsewhere = (base, dir) => {
	const why = [];
	const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
	if (c.code !== 0) why.push('extractcheck : ' + c.out.trim().split('\n').slice(-3).join(' | '));
	const g = run(GRAPH, ['--root', dir]);
	if (g.code !== 0) why.push('graph : ' + g.out.split('\n').filter((l) => /viole : [1-9]|INTERDIT|TOTAL/.test(l)).join(' | '));
	const e = run(EVENTS, ['--root', dir, '--out', path.join(work, 'ev.txt')]);
	if (e.code !== 0) why.push('eventcheck : ' + e.out.trim().split('\n').slice(-1)[0]);
	if (crossLists(base) !== crossLists(dir)) why.push('crosscheck : les pendantes ont change');
	return why;
};

const CASES = [
	// ---- Doivent reussir
	['m_Log sort de common.js, dans les deux contextes a sa place', () => {
		const base = snapshot('ok-log-base');
		const dir = snapshot('ok-log', base);
		const r = run(EXTRACT, ['m_Log', '--root', dir]);
		const why = r.code ? ['extract : ' + r.out.trim()] : [];
		if (!/common\.js modules\/log\.js player\.js/.test(scripts(dir))) why.push('player.html : ' + scripts(dir));
		if (!/common\.js modules\/log\.js content\.js/.test(contentScripts(dir))) why.push('manifeste : ' + contentScripts(dir));
		return why.concat(r.code ? [] : unchangedElsewhere(base, dir));
	}],
	['le demarrage sort en dernier, puis m_Controls se place avant lui', () => {
		const base = snapshot('ok-ctl-base');
		const dir = snapshot('ok-ctl', base);
		const a = run(EXTRACT, ['--line', String(startupLine(dir)), '--from', 'player.js', '--as', 'startup.js', '--root', dir]);
		if (a.code) return ['demarrage : ' + a.out.trim()];
		const b = run(EXTRACT, ['m_Controls', '--root', dir]);
		if (b.code) return ['m_Controls : ' + b.out.trim()];
		const why = [];
		if (!/player\.js modules\/controls\.js modules\/startup\.js/.test(scripts(dir))) why.push('player.html : ' + scripts(dir));
		// Deux deplacements depuis la base : extractcheck les voit l'un et l'autre.
		return why.concat(unchangedElsewhere(base, dir));
	}],

	// ---- Doivent etre refusees
	['refus : m_Controls tant que le demarrage le reclame en microtache', () => {
		const dir = snapshot('no-ctl');
		const r = run(EXTRACT, ['m_Controls', '--root', dir]);
		const why = [];
		if (r.code !== 1 || !/aucune place de chargement/.test(r.out) || !/microtache/.test(r.out)) why.push('sortie : ' + r.out.trim().slice(0, 300));
		if (fs.existsSync(path.join(dir, 'modules'))) why.push('un fichier a ete ecrit malgre le refus');
		return why;
	}],
	['refus : appel a m_Settings pendant la construction', () => {
		const dir = snapshot('no-rule');
		edit(dir, 'player.js', /const m_Notification = \(\(\) => \{/, 'const m_Notification = (() => {\n  m_Settings.Get("bMute");');
		const r = run(EXTRACT, ['m_Notification', '--root', dir]);
		return r.code === 1 && /appelle d'autres modules/.test(r.out) && /m_Settings/.test(r.out) ? [] : ['sortie : ' + r.out.trim().slice(0, 300)];
	}],
	['refus : nom declare dans deux mondes sans --from', () => {
		const dir = snapshot('no-twice');
		const r = run(EXTRACT, ['m_Debug', '--root', dir]);
		return r.code === 1 && /plusieurs fois/.test(r.out) ? [] : ['sortie : ' + r.out.trim().slice(0, 300)];
	}],
	['refus : source aussi chargee par getURL', () => {
		const dir = snapshot('no-geturl');
		edit(dir, 'content.js', /^/, "chrome.runtime.getURL('common.js');\n");
		const r = run(EXTRACT, ['m_Log', '--root', dir]);
		return r.code === 1 && /aussi charge ou nomme ailleurs/.test(r.out) ? [] : ['sortie : ' + r.out.trim().slice(0, 300)];
	}],

	// ---- Ne doivent pas passer pour une extraction pure
	...[
		['jeton modifie dans le module deplace', (d) => edit(d, 'modules/notification.js', /(\d+)/, (m) => String(Number(m) + 1)), /instruction (disparue|apparue)/],
		["'use strict' perdu par le nouveau fichier", (d) => edit(d, 'modules/notification.js', /^["']use strict["'];\r?\n/, ''), /mode strict/],
		['balises de script reordonnees', (d) => {
			edit(d, 'player.html', /<script src=sidebar\.js defer><\/script>\r?\n/, '');
			edit(d, 'player.html', /<script src=common\.js defer><\/script>/, '$&\n<script src=sidebar.js defer></script>');
		}, /reordonnes/],
		['instruction perdue dans le reste du fichier', (d) => edit(d, 'player.js', /^const LOAD_METADATA_NO_LONGER_THAN = .*\r?\n/m, ''), /disparue/],
		['balisage change ailleurs', (d) => edit(d, 'player.html', /\bid=mainmenu\b/, 'id=mainmenu data-x=1'), /balisage a change/],
		/*
			La base elle-meme fait utiliser m_Notification par m_Scale pendant sa construction : sans
			cela, rien n'exigerait que m_Notification vienne avant, et deplacer sa balise serait
			legitime. La seule difference entre les deux arbres est alors la balise deplacee.
		*/
		['module charge trop tard pour ses utilisateurs', (d) => {
			edit(d, 'player.html', /<script src=modules\/notification\.js defer><\/script>\r?\n/, '');
			edit(d, 'player.html', /<script src=channelbar\.js defer><\/script>/, '$&\n<script src=modules/notification.js defer></script>');
		}, /ORDRE DE CONSTRUCTION/, (b) => edit(b, 'player.js', /const m_Scale = \(\(\) => \{/, 'const m_Scale = (() => {\n  m_Notification.Show;')],
	].map(([label, mutate, expected, prepare]) => ['doit echouer : ' + label, () => {
		const base = snapshot('bad-base-' + label.length);
		if (prepare) prepare(base);
		const dir = snapshot('bad-' + label.length, base);
		const r = run(EXTRACT, ['m_Notification', '--root', dir]);
		if (r.code) return ['extraction de depart : ' + r.out.trim()];
		mutate(dir);
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		if (c.code !== 1) return ['extractcheck a accepte : ' + c.out.trim().split('\n').slice(-2).join(' | ')];
		if (expected && !expected.test(c.out)) return ['extractcheck a echoue, mais pas pour cette raison : ' + c.out.trim().slice(0, 300)];
		return [];
	}]),

	// ---- Doit passer
	['doit passer : un commentaire modifie dans le module deplace', () => {
		const base = snapshot('cmt-base');
		const dir = snapshot('cmt', base);
		const r = run(EXTRACT, ['m_Notification', '--root', dir]);
		if (r.code) return ['extraction : ' + r.out.trim()];
		edit(dir, 'modules/notification.js', /const m_Notification = \(\(\) => \{/, '// Un commentaire ajoute ne change aucun comportement.\n$&');
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		return c.code === 0 ? [] : ['extractcheck a refuse : ' + c.out.trim().slice(0, 300)];
	}],
];

let failures = 0;
try {
	CASES.forEach(([label, fn], i) => {
		let why;
		try { why = fn(); } catch (e) { why = ['exception : ' + e.message]; }
		if (why.length) failures++;
		console.log('  ' + (why.length ? 'RATE    ' : 'OK      ') + String(i + 1).padStart(2) + '. ' + label
			+ (why.length ? '\n              ' + why.join('\n              ') : ''));
	});
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
console.log('');
console.log(failures ? failures + ' cas en defaut.' : 'Tous les cas se comportent comme attendu.');
process.exit(failures ? 1 : 0);
