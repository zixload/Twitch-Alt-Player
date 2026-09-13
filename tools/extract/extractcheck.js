'use strict';
/*
	Proves that an extraction moved code and changed nothing else.

	An extraction commit is supposed to be a pure move: a module leaves player.js or common.js for its
	own file, and a <script> tag or a manifest entry loads that file. If anything else moved with it —
	a token edited on the way, a statement lost at the seam, 'use strict' dropped, a script tag
	reordered — the commit is no longer a move, and the rewrite that follows would start from a
	module that already behaves differently.

	So this compares two trees, the one before and the one after, and requires all of this:

	  1. The same load contexts, each loading the same files in the same relative order, plus new files.
	  2. The same top-level statements per context, compared as syntax trees: positions and comments
	     ignored, everything else identical, down to how a literal is written.
	  3. Every file that lost statements kept the others in their order; every new file holds
	     statements from a single old file, in their old order, under the same strictness.
	  4. The markup and the manifest identical once the added script entries are taken out.
	  5. No construction-order violation and no forbidden construction call that was not there before
	     (graph.js).

	Nothing is inferred from the extraction tool's own report: this reads both trees from scratch, so
	it checks extract.js as much as it checks a hand-made move.

	Usage:
	  node extractcheck.js                         HEAD against the working tree
	  node extractcheck.js --base <rev> --head <rev>
	  node extractcheck.js --base-dir <dir> [--head-dir <dir>]
	  exit 0 when the change is a pure extraction, 1 otherwise.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const G = require('./graph.js');

// ---------------------------------------------------------------------------------------------
// Arbres : un dossier, ou une revision git

const gitTree = (root, rev) => {
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	const all = new Set(git('ls-tree', '-r', '--name-only', rev).split('\n').filter(Boolean));
	const cache = new Map();
	const rel = (f) => f.replace(/\\/g, '/').replace(/^\.?\//, '');
	return {
		root: rev,
		rel,
		exists: (f) => all.has(rel(f)),
		read: (f) => {
			const k = rel(f);
			if (!cache.has(k)) cache.set(k, git('show', rev + ':' + k));
			return cache.get(k);
		},
		list: () => [...all].filter((f) => !f.includes('/')).sort(),
	};
};

// ---------------------------------------------------------------------------------------------
// Instructions normalisees

const DROP = new Set(['start', 'end', 'loc', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'parenStart', 'trailingComma', 'comments', 'tokens']);
const normalize = (node) => JSON.stringify(node, (k, v) => (DROP.has(k) ? undefined : v));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

const statementsOf = (t, f) => {
	const info = G.fileInfo(t, f);
	return info.statements.map((s) => ({
		file: f,
		line: s.node.loc.start.line,
		key: hash(normalize(s.node)) + (info.strict ? ':strict' : ':sloppy'),
		label: s.isVariableDeclaration() ? s.node.declarations.map((d) => (d.id.name || '?')).join(',')
			: s.node.id ? s.node.id.name : s.type,
		strict: info.strict,
	}));
};

const htmlWithoutScripts = (text, files) => {
	let out = text;
	for (const f of files) {
		const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		out = out.replace(new RegExp('^[ \\t]*<script\\b[^>]*\\bsrc\\s*=\\s*["\']?' + esc + '["\']?[^>]*>\\s*</script>[ \\t]*\\r?\\n', 'gm'), '');
	}
	return out;
};

const manifestWithout = (manifest, files) => {
	const m = JSON.parse(JSON.stringify(manifest));
	for (const cs of m.content_scripts || []) if (cs.js) cs.js = cs.js.filter((f) => !files.includes(f));
	return m;
};

// ---------------------------------------------------------------------------------------------
// La comparaison

const compareTrees = (base, head) => {
	const problems = [];
	const moves = [];
	const added = new Set();

	const ctxBase = G.contextsOf(base);
	const ctxHead = G.contextsOf(head);
	const names = (list) => list.map((c) => c.name).sort().join(' | ');
	if (names(ctxBase) !== names(ctxHead)) {
		problems.push('contextes de chargement differents : avant [' + names(ctxBase) + '], apres [' + names(ctxHead) + ']');
		return { ok: false, problems, moves, added: [] };
	}

	for (const cb of ctxBase) {
		const ch = ctxHead.find((c) => c.name === cb.name);
		// 1. Memes fichiers, meme ordre relatif, plus des fichiers nouveaux.
		const kept = ch.files.filter((f) => cb.files.includes(f));
		if (kept.join(' ') !== cb.files.join(' ')) {
			problems.push(cb.name + ' : fichiers retires ou reordonnes. Avant : ' + cb.files.join(' ') + ' ; apres : ' + ch.files.join(' '));
			continue;
		}
		const newFiles = ch.files.filter((f) => !cb.files.includes(f));
		for (const f of newFiles) {
			if (base.exists(f)) problems.push(cb.name + ' : ' + f + ' existait deja et se met a etre charge — ce n\'est pas une extraction');
			added.add(f);
		}

		// 2. Memes instructions, comparees comme arbres.
		const sb = cb.files.flatMap((f) => (base.exists(f) ? statementsOf(base, f) : []));
		const sh = ch.files.flatMap((f) => (head.exists(f) ? statementsOf(head, f) : []));
		const count = (list) => {
			const m = new Map();
			for (const s of list) m.set(s.key, (m.get(s.key) || []).concat(s));
			return m;
		};
		const mb = count(sb);
		const mh = count(sh);
		for (const [k, list] of mb) {
			const other = mh.get(k) || [];
			for (const s of list.slice(other.length)) problems.push(cb.name + ' : instruction disparue ou modifiee — ' + s.label + ' (' + s.file + ':' + s.line + ', avant)');
		}
		for (const [k, list] of mh) {
			const other = mb.get(k) || [];
			for (const s of list.slice(other.length)) {
				const sameLabel = sb.find((x) => x.label === s.label);
				const why = sameLabel && sameLabel.strict !== s.strict ? ' — mode strict perdu ou gagne' : '';
				problems.push(cb.name + ' : instruction apparue ou modifiee — ' + s.label + ' (' + s.file + ':' + s.line + ', apres)' + why);
			}
		}

		// 3. Les deplacements : un seul fichier d'origine, l'ordre conserve des deux cotes.
		for (const f of newFiles) {
			const inNew = sh.filter((s) => s.file === f);
			if (!inNew.length) { problems.push(cb.name + ' : ' + f + ' est charge mais ne contient rien'); continue; }
			const origins = new Set();
			for (const s of inNew) {
				const from = sb.filter((x) => x.key === s.key).map((x) => x.file);
				for (const o of new Set(from)) origins.add(o);
			}
			if (origins.size !== 1) {
				problems.push(cb.name + ' : ' + f + ' rassemble des instructions de ' + (origins.size ? [...origins].join(', ') : 'nulle part'));
				continue;
			}
			const origin = [...origins][0];
			const baseSeq = sb.filter((x) => x.file === origin).map((x) => x.key);
			const movedKeys = inNew.map((s) => s.key);
			// L'ordre relatif des instructions deplacees est celui qu'elles avaient.
			let cursor = 0;
			for (const k of movedKeys) {
				const i = baseSeq.indexOf(k, cursor);
				if (i === -1) { problems.push(cb.name + ' : ' + f + ' ne garde pas l\'ordre des instructions de ' + origin); break; }
				cursor = i + 1;
			}
			moves.push({ context: cb.name, from: origin, to: f, what: inNew.map((s) => s.label) });
		}
		for (const f of cb.files) {
			if (!base.exists(f) || !head.exists(f)) continue;
			const before = sb.filter((x) => x.file === f).map((x) => x.key);
			const after = sh.filter((x) => x.file === f).map((x) => x.key);
			const movedOut = new Map();
			for (const mv of moves.filter((m) => m.context === cb.name && m.from === f)) {
				for (const s of sh.filter((x) => x.file === mv.to)) movedOut.set(s.key, (movedOut.get(s.key) || 0) + 1);
			}
			const remaining = before.filter((k) => {
				if (movedOut.get(k)) { movedOut.set(k, movedOut.get(k) - 1); return false; }
				return true;
			});
			if (remaining.join(' ') !== after.join(' ')) problems.push(cb.name + ' : ' + f + ' ne garde pas ses autres instructions dans leur ordre');
		}
	}

	// 4. Balisage et manifeste identiques, entrees ajoutees mises a part.
	const addedList = [...added];
	const pages = new Set([...base.list(), ...head.list()].filter((f) => /\.html$/i.test(f)));
	for (const p of pages) {
		if (!base.exists(p) || !head.exists(p)) { problems.push(p + ' : page ajoutee ou retiree'); continue; }
		// core.autocrlf : git show rend du LF, l'arbre de travail peut etre en CRLF. Seules les fins de ligne sont pardonnees.
		const lf = (t) => t.replace(/\r\n/g, '\n');
		if (lf(htmlWithoutScripts(head.read(p), addedList)) !== lf(base.read(p))) problems.push(p + ' : le balisage a change ailleurs que par l\'ajout d\'un <script>');
	}
	const mb = JSON.parse(base.read('manifest.json'));
	const mh = manifestWithout(JSON.parse(head.read('manifest.json')), addedList);
	if (JSON.stringify(mb) !== JSON.stringify(mh)) problems.push('manifest.json : a change ailleurs que par l\'ajout d\'un script de contenu');

	// 5. L'ordre de construction : rien de nouveau.
	const keyV = (v) => v.name + ' <- ' + v.usedBy.replace(/:\d+/, '');
	const keyF = (x) => x.module + ' -> ' + x.calls;
	for (const cb of ctxBase) {
		const ch = ctxHead.find((c) => c.name === cb.name);
		const ab = G.analyseContext(base, cb);
		const ah = G.analyseContext(head, ch);
		const vb = new Set(G.checkOrder(ab).map(keyV));
		for (const v of G.checkOrder(ah)) {
			if (!vb.has(keyV(v))) problems.push(cb.name + ' : ORDRE DE CONSTRUCTION — ' + v.name + ' utilise par ' + v.usedBy + ' avant d\'etre defini (' + v.definedIn + ')');
		}
		const fb = new Set(G.checkConstructionRule(ab).forbidden.map(keyF));
		for (const x of G.checkConstructionRule(ah).forbidden) {
			if (!fb.has(keyF(x))) problems.push(cb.name + ' : appel de construction interdit — ' + keyF(x) + ' a ' + x.at);
		}
	}

	return { ok: problems.length === 0 && moves.length > 0, problems, moves, added: addedList, nothingMoved: moves.length === 0 };
};

module.exports = { compareTrees, gitTree };

// ---------------------------------------------------------------------------------------------

if (require.main === module) {
	const arg = (flag) => {
		const i = process.argv.indexOf(flag);
		return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
	};
	const ROOT = path.resolve(path.join(__dirname, '..', '..'));
	const base = arg('--base-dir') ? G.tree(path.resolve(arg('--base-dir'))) : gitTree(ROOT, arg('--base') || 'HEAD');
	const head = arg('--head-dir') ? G.tree(path.resolve(arg('--head-dir')))
		: arg('--head') ? gitTree(ROOT, arg('--head')) : G.tree(ROOT);
	const r = compareTrees(base, head);
	console.log('avant : ' + base.root);
	console.log('apres : ' + head.root);
	for (const m of r.moves) console.log('deplace  ' + m.what.join(', ') + ' : ' + m.from + ' -> ' + m.to + '   [' + m.context + ']');
	for (const p of r.problems) console.log('ECHEC    ' + p);
	if (r.nothingMoved && !r.problems.length) console.log('ECHEC    aucun deplacement : il n\'y a rien a prouver');
	console.log(r.ok ? 'OK : extraction pure.' : 'PAS UNE EXTRACTION PURE.');
	process.exit(r.ok ? 0 : 1);
}
