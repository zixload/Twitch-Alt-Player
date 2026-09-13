'use strict';
/*
	Proves that extract.js extracts, refuses, and that extractcheck.js catches what is not a move.

	**Most cases run on a fixture, not on the extension.** The first version used the real tree and
	m_Notification as its guinea pig; it broke the day m_Notification was really extracted. The
	fixture (fixture.js) holds the same traps in forty lines and never moves, so this suite stays
	valid however far the phase has got.

	Two things a fixture cannot prove are kept on the real extension: that a real module extracts,
	and that every other check — construction order, internal events, DOM names — reports afterwards
	exactly what it reported before. Its guinea pig is chosen at run time: the first module the tool
	still accepts.

	Usage: node extract-selftest.js      (exit 0 when every case behaves)
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const fixture = require('./fixture.js');

const REPO = path.resolve(__dirname, '..', '..');
const EXTRACT = path.join(__dirname, 'extract.js');
const CHECK = path.join(__dirname, 'extractcheck.js');
const GRAPH = path.join(__dirname, 'graph.js');
const EVENTS = path.join(REPO, 'tools', 'rename', 'eventcheck.js');
const CROSS = path.join(REPO, 'tools', 'rename', 'crosscheck.js');
const COPY = /\.(html|css|js|json)$/i;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-selftest-'));
let nth = 0;
const fx = () => fixture.write(path.join(work, 'fx' + (++nth)));

const copyDir = (from, to) => {
	fs.mkdirSync(to, { recursive: true });
	for (const e of fs.readdirSync(from, { withFileTypes: true })) {
		if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
		else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
	}
};
const clone = (dir) => {
	const to = dir + '-copie';
	copyDir(dir, to);
	return to;
};
const realTree = (name) => {
	const dir = path.join(work, name);
	fs.mkdirSync(dir);
	for (const f of fs.readdirSync(REPO)) {
		if (COPY.test(f) && fs.statSync(path.join(REPO, f)).isFile()) fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
	}
	if (fs.existsSync(path.join(REPO, 'modules'))) copyDir(path.join(REPO, 'modules'), path.join(dir, 'modules'));
	return dir;
};

const run = (script, args) => {
	const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
	return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const extract = (dir, args) => run(EXTRACT, [...args, '--root', dir]);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const edit = (dir, file, re, to) => {
	const p = path.join(dir, file);
	const before = fs.readFileSync(p, 'utf8');
	const after = before.replace(re, to);
	if (after === before) throw new Error('mutation sans effet : ' + file + ' ne contient pas ' + re);
	fs.writeFileSync(p, after, 'utf8');
};
const scripts = (dir, page) => [...read(dir, page).replace(/<!--[\s\S]*?-->/g, '')
	.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]).join(' ');
const contentScripts = (dir) => JSON.parse(read(dir, 'manifest.json')).content_scripts.flatMap((cs) => cs.js).join(' ');
const graphTotal = (dir) => {
	const out = run(GRAPH, ['--root', dir]).out;
	const m = out.match(/TOTAL : (\d+)/);
	return m ? Number(m[1]) : 'illisible : ' + out.slice(-200);
};
const lineOf = (dir, file, re) => {
	const lines = read(dir, file).split('\n');
	const i = lines.findIndex((l) => re.test(l));
	if (i === -1) throw new Error(re + ' introuvable dans ' + file);
	return i + 1;
};

// ---------------------------------------------------------------------------------------------

const CASES = [
	['fixture : un module qui ne touche rien se place avant son fichier', () => {
		const base = fx();
		const dir = clone(base);
		const avant = graphTotal(base);
		const r = extract(dir, ['m_Leaf']);
		const why = r.code ? ['extract : ' + r.out.trim()] : [];
		if (scripts(dir, 'page.html') !== 'shared.js modules/leaf.js core.js extra.js') why.push('page.html : ' + scripts(dir, 'page.html'));
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		if (c.code !== 0) why.push('extractcheck : ' + c.out.trim());
		if (graphTotal(dir) !== avant) why.push('graph : ' + avant + ' -> ' + graphTotal(dir));
		return why;
	}],
	['fixture : un module partage sort dans les deux contextes', () => {
		const base = fx();
		const dir = clone(base);
		const r = extract(dir, ['m_Log']);
		const why = r.code ? ['extract : ' + r.out.trim()] : [];
		if (scripts(dir, 'page.html') !== 'shared.js modules/log.js core.js extra.js') why.push('page.html : ' + scripts(dir, 'page.html'));
		if (contentScripts(dir) !== 'shared.js modules/log.js content.js') why.push('manifeste : ' + contentScripts(dir));
		if (!/^"use strict";/.test(read(dir, 'modules/log.js'))) why.push('le mode strict de la source n a pas suivi');
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		if (c.code !== 0) why.push('extractcheck : ' + c.out.trim());
		return why;
	}],
	['fixture : refuse tant que le demarrage le reclame en microtache, accepte apres', () => {
		const base = fx();
		const dir = clone(base);
		const why = [];
		const refus = extract(dir, ['m_NeedsPrelude']);
		if (refus.code !== 1 || !/aucune place de chargement/.test(refus.out) || !/microtache/.test(refus.out)) {
			why.push('refus attendu : ' + refus.out.trim().slice(0, 200));
		}
		if (fs.existsSync(path.join(dir, 'modules'))) why.push('un fichier a ete ecrit malgre le refus');
		const startup = extract(dir, ['--line', String(lineOf(dir, 'core.js', /^Promise\.resolve\(\)\.then\(Start\);/)), '--from', 'core.js', '--as', 'startup.js']);
		if (startup.code) return why.concat(['demarrage : ' + startup.out.trim()]);
		const apres = extract(dir, ['m_NeedsPrelude']);
		if (apres.code) return why.concat(['apres le demarrage : ' + apres.out.trim()]);
		if (scripts(dir, 'page.html') !== 'shared.js core.js modules/needs-prelude.js modules/startup.js extra.js') {
			why.push('page.html : ' + scripts(dir, 'page.html'));
		}
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		if (c.code !== 0) why.push('extractcheck : ' + c.out.trim());
		return why;
	}],
	['fixture : refuse un module qui en appelle un autre pendant sa construction', () => {
		const dir = fx();
		const r = extract(dir, ['m_Forbidden']);
		return r.code === 1 && /appelle d'autres modules/.test(r.out) && /m_Leaf/.test(r.out) ? [] : ['sortie : ' + r.out.trim().slice(0, 200)];
	}],
	['fixture : refuse un nom declare dans deux mondes, accepte avec --from', () => {
		const dir = fx();
		const sans = extract(dir, ['m_Dup']);
		const why = sans.code === 1 && /plusieurs fois/.test(sans.out) ? [] : ['sans --from : ' + sans.out.trim().slice(0, 200)];
		const avec = extract(dir, ['m_Dup', '--from', 'extra.js']);
		if (avec.code) why.push('avec --from : ' + avec.out.trim().slice(0, 200));
		return why;
	}],
	['fixture : refuse une source aussi chargee par getURL', () => {
		const dir = fx();
		edit(dir, 'content.js', /^/, 'chrome.runtime.getURL("shared.js");\n');
		const r = extract(dir, ['m_Log']);
		return r.code === 1 && /aussi charge ou nomme ailleurs/.test(r.out) ? [] : ['sortie : ' + r.out.trim().slice(0, 200)];
	}],

	// ---- Ce qui ne doit pas passer pour une extraction pure
	...[
		['jeton modifie dans le module deplace', (d) => edit(d, 'modules/leaf.js', /_nCount \+= 1;/, '_nCount += 2;'), /instruction (disparue|apparue)/],
		["'use strict' perdu par le nouveau fichier", (d) => edit(d, 'modules/leaf.js', /^"use strict";\r?\n/, ''), /mode strict/],
		['balises de script reordonnees', (d) => {
			edit(d, 'page.html', /<script src=extra\.js defer><\/script>\r?\n/, '');
			edit(d, 'page.html', /<script src=shared\.js defer><\/script>/, '$&\n<script src=extra.js defer></script>');
		}, /reordonnes/],
		['instruction perdue dans le reste du fichier', (d) => edit(d, 'core.js', /^const PRELUDE_VALUE = 3;\r?\n/m, ''), /disparue/],
		['balisage change ailleurs', (d) => edit(d, 'page.html', /<div id=widget><\/div>/, '<div id=widget data-x=1></div>'), /balisage a change/],
		/*
			m_Forbidden appelle m_Leaf pendant sa construction : charger leaf.js apres core.js le prive
			de ce qu'il utilise. Rien d'autre ne change — la seule difference est la balise deplacee.
		*/
		['module charge trop tard pour ses utilisateurs', (d) => {
			edit(d, 'page.html', /<script src=modules\/leaf\.js defer><\/script>\r?\n/, '');
			edit(d, 'page.html', /<script src=extra\.js defer><\/script>/, '$&\n<script src=modules/leaf.js defer></script>');
		}, /ORDRE DE CONSTRUCTION/],
	].map(([label, mutate, expected]) => ['fixture, doit echouer : ' + label, () => {
		const base = fx();
		const dir = clone(base);
		const r = extract(dir, ['m_Leaf']);
		if (r.code) return ['extraction de depart : ' + r.out.trim()];
		mutate(dir);
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		if (c.code !== 1) return ['extractcheck a accepte : ' + c.out.trim().split('\n').slice(-2).join(' | ')];
		if (!expected.test(c.out)) return ['echec, mais pas pour cette raison : ' + c.out.trim().slice(0, 300)];
		return [];
	}]),
	['fixture, doit passer : un commentaire modifie dans le module deplace', () => {
		const base = fx();
		const dir = clone(base);
		const r = extract(dir, ['m_Leaf']);
		if (r.code) return ['extraction : ' + r.out.trim()];
		edit(dir, 'modules/leaf.js', /const m_Leaf = \(\(\) => \{/, '// Un commentaire ajoute ne change aucun comportement.\n$&');
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		return c.code === 0 ? [] : ['extractcheck a refuse : ' + c.out.trim().slice(0, 300)];
	}],

	// ---- L'extension elle-meme
	['extension : un vrai module sort, et aucun autre controle ne bouge', () => {
		const base = realTree('vrai');
		const dir = clone(base);
		// Le cobaye : le premier module que l'outil accepte aujourd'hui, quel que soit l'avancement.
		const candidats = [];
		for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
			for (const m of read(dir, f).matchAll(/^const (m_[A-Za-z0-9]+) = \(\(\) => \{/gm)) candidats.push(m[1]);
		}
		if (!candidats.length) return ['aucun module ne reste dans un fichier partage : ce cas n a plus d objet'];
		let pig = null;
		for (const m of candidats) {
			if (extract(dir, [m, '--dry']).code === 0) { pig = m; break; }
		}
		if (!pig) return ['aucun des ' + candidats.length + ' modules ne s extrait ; premier refus : ' + extract(dir, [candidats[0], '--dry']).out.trim().slice(0, 200)];
		const avantGraph = graphTotal(base);
		const avantEvents = run(EVENTS, ['--root', base, '--out', path.join(work, 'ev-base.txt')]).code;
		const ccBase = path.join(work, 'cc-base.json');
		run(CROSS, ['--root', base, '--out', ccBase + '.txt', '--json', ccBase]);
		const r = extract(dir, [pig]);
		const why = r.code ? [pig + ' : ' + r.out.trim()] : [];
		const c = run(CHECK, ['--base-dir', base, '--head-dir', dir]);
		if (c.code !== 0) why.push('extractcheck : ' + c.out.trim().split('\n').slice(-3).join(' | '));
		if (graphTotal(dir) !== avantGraph) why.push('graph : ' + avantGraph + ' -> ' + graphTotal(dir));
		const ev = run(EVENTS, ['--root', dir, '--out', path.join(work, 'ev-head.txt')]);
		if (ev.code !== avantEvents) why.push('eventcheck : sortie ' + avantEvents + ' -> ' + ev.code);
		const ccHead = path.join(work, 'cc-head.json');
		run(CROSS, ['--root', dir, '--out', ccHead + '.txt', '--json', ccHead]);
		if (fs.readFileSync(ccBase, 'utf8') !== fs.readFileSync(ccHead, 'utf8')) why.push('crosscheck : les pendantes ont change');
		if (!why.length) console.log('              cobaye du jour : ' + pig);
		return why;
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
