'use strict';
/*
	Moves one module out of its file into a file of its own, and loads that file where it must load.

	REPARTITION.md, section 3: one module, one file. This is step 1 of the four for each module —
	extract without touching the code — so the tool changes no token of the module and no token of
	anything else. It only cuts, pastes, and adds one loading entry per context.

	What it does, in order, and it stops at the first thing it cannot prove:

	  1. Finds the declaration `const m_X = ...` among the scripts the extension loads. A name
	     declared in two worlds (m_Debug exists in player.js and in content.js) needs --from.
	  2. Refuses a source file that is also loaded some other way than a <script> tag or a manifest
	     content script: a getURL('common.js'), a web-accessible resource, a Worker. The new file would
	     be missing there, and nothing here could see it.
	  3. Refuses a module that calls into another module than m_Log or m_Events while it is being
	     built (graph.js, with its named exceptions).
	  4. Cuts the declaration with the comment block directly above it, and writes it to
	     modules/<name>.js under the same strictness as the file it came from.
	  5. Chooses where the file loads, in every context that loads the source: right before the
	     source if that breaks no construction order, else right after, else the nearest place that
	     works. Everything the module needs while it is built comes before; everything that needs the
	     module while it is built comes after. If no place satisfies both, it says which names pull
	     each way.
	  6. Runs extractcheck.js on the result, in memory, against the tree as it was. Only then writes.

	common.js is loaded both by player.html and by the content scripts on twitch.tv. A module taken
	from it goes into both, each at its own valid place.

	The same applies to any other top-level declaration, a function or a class, by name. And to one
	statement with no name at all, by its first line: the start-up call at the end of player.js is
	one. It matters, because it schedules the start (a then chain) that reaches most modules: as long
	as it sits in player.js, a module that needs player.js's helpers to be built can go neither
	before player.js nor after it. Moved to a file loaded last, it frees them.

	Usage: node extract.js <m_Module | Name> [--from <file.js>] [--into <dir>] [--as <file.js>] [--dry]
	       node extract.js --line <n> --from <file.js> --as <file.js> [--into <dir>] [--dry]
	  --into  destination directory (default: modules)
	  --as    file name (default: the name without m_, in kebab-case)
	  --dry   show the plan, write nothing
*/
const fs = require('fs');
const path = require('path');
const G = require('./graph.js');
const { compareTrees } = require('./extractcheck.js');

const arg = (flag) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const ROOT = path.resolve(arg('--root') || path.join(__dirname, '..', '..'));
const LINE = arg('--line') ? Number(arg('--line')) : null;
const MODULE = LINE ? null : process.argv[2];
const DRY = process.argv.includes('--dry');
const INTO = (arg('--into') || 'modules').replace(/\\/g, '/').replace(/\/+$/, '');

const fail = (msg) => {
	console.log('REFUS : ' + msg);
	process.exit(1);
};
if (LINE === null && (!MODULE || MODULE.startsWith('--'))) fail('usage : node extract.js <m_Module | Nom> [--from f.js] [--into dir] [--as f.js] [--dry]\n        node extract.js --line <n> --from f.js --as f.js [--dry]');
if (LINE !== null && (!Number.isInteger(LINE) || !arg('--from') || !arg('--as'))) fail('--line exige un numero de ligne, --from et --as');

const kebab = (name) => name.replace(/^m_/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
const TARGET = INTO + '/' + (arg('--as') || kebab(MODULE) + '.js');

const disk = G.tree(ROOT);
const contexts = G.contextsOf(disk);

// ---------------------------------------------------------------------------------------------
// 1. La declaration

const loaded = [...new Set(contexts.flatMap((c) => c.files))].filter((f) => disk.exists(f));
const found = [];
for (const f of loaded) {
	if (arg('--from') && disk.rel(arg('--from')) !== f) continue;
	const info = G.fileInfo(disk, f);
	info.statements.forEach((s, index) => {
		const hit = LINE !== null ? s.node.loc.start.line === LINE
			: s.isVariableDeclaration() ? s.node.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === MODULE)
				: (s.isFunctionDeclaration() || s.isClassDeclaration()) && s.node.id && s.node.id.name === MODULE;
		if (hit) found.push({ file: f, info, s, index });
	});
}
const WHAT = LINE !== null ? 'l\'instruction de la ligne ' + LINE : MODULE;
if (!found.length) fail(WHAT + ' : introuvable au premier niveau des scripts charges' + (arg('--from') ? ' (--from ' + arg('--from') + ')' : ''));
if (found.length > 1) fail(WHAT + ' est declare plusieurs fois : ' + found.map((x) => x.file + ':' + x.s.node.loc.start.line).join(', ') + '. Preciser --from.');
const { file: SOURCE, info, s: decl, index: declIndex } = found[0];
if (MODULE && decl.isVariableDeclaration() && decl.node.declarations.length !== 1) fail(MODULE + ' doit etre seul dans sa declaration (' + SOURCE + ':' + decl.node.loc.start.line + ')');
if (disk.exists(TARGET)) fail(TARGET + ' existe deja');

// ---------------------------------------------------------------------------------------------
// 2. Le fichier source n'est-il charge que par des voies que l'outil sait mettre a jour ?

const otherLoads = [];
const base = path.posix.basename(SOURCE);
// Le nom seul : pas modules/player.js quand la source est player.js.
const tokenRe = new RegExp('(^|[^\\w./-])' + SOURCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])');
const walkDir = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
	const rel = dir ? dir + '/' + e.name : e.name;
	if (e.isDirectory()) return ['.git', 'node_modules', 'tools', 'tests', 'Documentation', 'CLAUDE', '.agent', '_metadata', 'sources', '_locales'].includes(e.name) ? [] : walkDir(rel);
	return /\.(js|html|json|css)$/i.test(e.name) ? [rel] : [];
});
for (const f of walkDir('')) {
	if (f === 'player-english-translating-test.js') continue;   // jamais charge, son en-tete le dit
	const text = disk.read(f);
	if (!text.includes(base)) continue;
	if (/\.html$/i.test(f)) {
		const tags = G.scriptTags(text).filter((x) => disk.rel(x) === SOURCE).length;
		const all = (G.stripHtmlComments(text).match(new RegExp(tokenRe.source, 'g')) || []).length;
		if (all > tags) otherLoads.push(f + ' : ' + (all - tags) + ' mention(s) hors d\'une balise <script src>');
	} else if (f === 'manifest.json') {
		const m = JSON.parse(text);
		const walk = (v, where) => {
			if (typeof v === 'string') { if (disk.rel(v) === SOURCE && !/^content_scripts\[\d+\]\.js\[\d+\]$/.test(where)) otherLoads.push('manifest.json : ' + where); }
			else if (Array.isArray(v)) v.forEach((x, i) => walk(x, where + '[' + i + ']'));
			else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], where ? where + '.' + k : k);
		};
		walk(m, '');
	} else if (/\.js$/i.test(f)) {
		const ast = G.parse(text);
		const check = (value, line) => { if (typeof value === 'string' && tokenRe.test(value)) otherLoads.push(f + ':' + line + ' : « ' + value.slice(0, 60) + ' »'); };
		const stack = [ast.program];
		while (stack.length) {
			const n = stack.pop();
			if (!n || typeof n.type !== 'string') continue;
			if (n.type === 'StringLiteral') check(n.value, n.loc.start.line);
			if (n.type === 'TemplateElement') check(n.value.cooked, n.loc.start.line);
			for (const k of Object.keys(n)) {
				if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
				const v = n[k];
				if (Array.isArray(v)) stack.push(...v); else if (v && typeof v.type === 'string') stack.push(v);
			}
		}
	}
}
if (otherLoads.length) fail(SOURCE + ' est aussi charge ou nomme ailleurs, et le nouveau fichier y manquerait :\n   ' + otherLoads.join('\n   '));

// ---------------------------------------------------------------------------------------------
// 3. La regle de construction

const sourceContexts = contexts.filter((c) => c.files.includes(SOURCE));
for (const c of sourceContexts) {
	const a = G.analyseContext(disk, c);
	const forbidden = MODULE ? G.checkConstructionRule(a).forbidden.filter((x) => x.module.split(',').includes(MODULE)) : [];
	if (forbidden.length) {
		fail(MODULE + ' appelle d\'autres modules pendant sa construction [' + c.name + '] :\n' + forbidden.map((x) =>
			'   -> ' + x.calls + ' a ' + x.sites.join(' ') + (x.via.length ? '  via ' + x.via.join(' > ') : '')).join('\n')
			+ '\n   Seuls ' + [...G.CONSTRUCTION_ALLOWED].join(' et ') + ' sont permis (REPARTITION.md, section 3).');
	}
}

// ---------------------------------------------------------------------------------------------
// 4. Couper, coller

const src = info.src;
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const lineStart = (pos) => src.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (pos) => { const i = src.indexOf('\n', pos); return i === -1 ? src.length : i + 1; };

const prev = declIndex > 0 ? info.statements[declIndex - 1].node : null;
const next = declIndex + 1 < info.statements.length ? info.statements[declIndex + 1].node : null;
// Le bloc de commentaire juste au-dessus : sur ses propres lignes, apres l'instruction precedente.
const floor = prev ? lineEnd(prev.end - 1) : (info.ast.program.directives.length ? lineEnd(info.ast.program.directives.at(-1).end - 1) : 0);
const comments = (decl.node.leadingComments || []).filter((c) => c.start >= floor);
let blockStart = lineStart(comments.length ? comments[0].start : decl.node.start);
if (src.slice(blockStart, comments.length ? comments[0].start : decl.node.start).trim()) fail('du code precede ' + WHAT + ' sur sa premiere ligne');
const blockEnd = lineEnd(decl.node.end - 1);
const tail = src.slice(decl.node.end, blockEnd).trim();
if (tail && !tail.startsWith('//')) fail('du code suit ' + WHAT + ' sur sa derniere ligne : « ' + tail.slice(0, 40) + ' »');
if (next && next.start < blockEnd) fail('une autre instruction commence sur la derniere ligne de ' + WHAT);
if (blockStart < floor) blockStart = floor;

let block = src.slice(blockStart, blockEnd);
if (!block.endsWith('\n')) block += EOL;
// La source perd le bloc ; les lignes vides autour ne s'additionnent pas.
let before = src.slice(0, blockStart);
let after = src.slice(blockEnd);
const blank = new RegExp('(' + EOL.replace('\r', '\\r').replace('\n', '\\n') + '){2,}$');
if (blank.test(before) && /^(\r?\n)+/.test(after)) after = after.replace(/^(\r?\n)+/, '');
const newSource = before + after;

const directive = info.ast.program.directives.find((d) => d.value.value === 'use strict');
const header = directive ? src.slice(directive.start, directive.end) + EOL + EOL : '';
const newFile = header + block;

// ---------------------------------------------------------------------------------------------
// 5. Ou le charger

const overlay = new Map([[SOURCE, newSource], [TARGET, newFile]]);
const moved = G.tree(ROOT, overlay);
const violationKey = (v) => v.name + ' <- ' + v.usedBy.replace(/:\d+/, '');

const placements = new Map();   // nom de contexte -> index d'insertion dans c.files
for (const c of sourceContexts) {
	const baseline = new Set(G.checkOrder(G.analyseContext(disk, c)).map(violationKey));
	const probe = G.analyseContext(moved, { ...c, files: [...c.files, TARGET] });
	const at = c.files.indexOf(SOURCE);
	const candidates = [at, at + 1];
	for (let d = 1; d <= c.files.length; d++) { candidates.push(at - d, at + 1 + d); }
	let chosen = null;
	const tried = [];
	for (const i of candidates) {
		if (i < 0 || i > c.files.length || tried.some((x) => x.i === i)) continue;
		// Dans le monde des scripts de contenu, seul un voisin immediat de la source est dans la meme entree du manifeste.
		if (c.kind === 'content' && i !== at && i !== at + 1) continue;
		const order = [...c.files.slice(0, i), TARGET, ...c.files.slice(i)];
		const fresh = G.checkOrder(probe, order).filter((v) => !baseline.has(violationKey(v)));
		tried.push({ i, fresh });
		if (!fresh.length) { chosen = i; break; }
	}
	if (chosen === null) {
		const show = (x) => '   si charge en position ' + x.i + ' :\n' + x.fresh.slice(0, 6).map((v) =>
			'      ' + v.name + ' utilise par ' + v.usedBy + ' a ' + v.at + (v.via.length ? ' via ' + v.via.join(' > ') : '') + ', defini ' + v.definedIn).join('\n');
		fail('aucune place de chargement ne respecte l\'ordre de construction [' + c.name + '] :\n' + tried.slice(0, 2).map(show).join('\n')
			+ '\n   Ce qui tire avant et ce qui tire apres doit etre separe d\'abord — souvent en extrayant la dependance.');
	}
	placements.set(c.name, chosen);
}

// ---------------------------------------------------------------------------------------------
// Mise a jour du balisage et du manifeste, par le texte, puis relue pour s'assurer du resultat

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const c of sourceContexts) {
	const i = placements.get(c.name);
	const expected = [...c.files.slice(0, i), TARGET, ...c.files.slice(i)];
	if (c.kind === 'page') {
		const text = overlay.has(c.name) ? overlay.get(c.name) : disk.read(c.name);
		const neighbour = i < c.files.length ? c.files[i] : c.files[i - 1];
		const re = new RegExp('^([ \\t]*)(<script\\b[^>]*\\bsrc\\s*=\\s*["\']?)' + escapeRe(neighbour) + '(["\']?[^>]*>\\s*</script>)[ \\t]*(\\r?\\n)', 'gm');
		const matches = [...text.matchAll(re)];
		if (matches.length !== 1) fail(c.name + ' : la balise de ' + neighbour + ' doit etre seule sur sa ligne, une fois (' + matches.length + ' trouvee(s))');
		const m = matches[0];
		const tag = m[1] + m[2] + TARGET + m[3] + m[4];
		const updated = i < c.files.length
			? text.slice(0, m.index) + tag + text.slice(m.index)
			: text.slice(0, m.index + m[0].length) + tag + text.slice(m.index + m[0].length);
		const got = G.scriptTags(updated).map(disk.rel);
		if (got.join(' ') !== expected.join(' ')) fail(c.name + ' : la mise a jour du balisage ne donne pas l\'ordre voulu (' + got.join(' ') + ')');
		overlay.set(c.name, updated);
	} else {
		const text = overlay.has('manifest.json') ? overlay.get('manifest.json') : disk.read('manifest.json');
		const insertBefore = i === c.files.indexOf(SOURCE);
		const re = new RegExp('^([ \\t]*)"' + escapeRe(SOURCE) + '"(,?)([ \\t]*)(\\r?\\n)', 'gm');
		let updated = text;
		const matches = [...text.matchAll(re)].reverse();
		if (!matches.length) fail('manifest.json : "' + SOURCE + '" doit etre seul sur sa ligne dans un tableau js');
		for (const m of matches) {
			const [whole, indent, comma, , nl] = m;
			const piece = insertBefore
				? indent + '"' + TARGET + '",' + nl + whole
				: comma ? whole + indent + '"' + TARGET + '",' + nl : indent + '"' + SOURCE + '",' + nl + indent + '"' + TARGET + '"' + nl;
			updated = updated.slice(0, m.index) + piece + updated.slice(m.index + whole.length);
		}
		// Relu : le manifeste doit etre l'ancien, a l'entree ajoutee pres.
		const oldM = JSON.parse(text);
		const newM = JSON.parse(updated);
		for (const cs of oldM.content_scripts) {
			if (!cs.js) continue;
			const k = cs.js.indexOf(SOURCE);
			if (k !== -1) cs.js.splice(insertBefore ? k : k + 1, 0, TARGET);
		}
		if (JSON.stringify(oldM) !== JSON.stringify(newM)) fail('manifest.json : la mise a jour textuelle ne donne pas le manifeste voulu');
		overlay.set('manifest.json', updated);
	}
}

// ---------------------------------------------------------------------------------------------
// 6. Preuve avant ecriture

const result = compareTrees(disk, G.tree(ROOT, overlay));
console.log(WHAT + ' : ' + SOURCE + ':' + decl.node.loc.start.line + ' -> ' + TARGET + ' (' + block.split('\n').length + ' lignes' + (comments.length ? ', commentaire compris' : '') + ')');
for (const c of sourceContexts) {
	const i = placements.get(c.name);
	const order = [...c.files.slice(0, i), TARGET, ...c.files.slice(i)];
	console.log('   ' + c.name + ' : ' + order.join(' '));
}
for (const p of result.problems) console.log('   ECHEC DE LA VERIFICATION : ' + p);
if (!result.ok) fail('la verification de l\'extraction a echoue, rien n\'est ecrit');
console.log('   verification : extraction pure (' + result.moves.map((m) => m.what.join(',') + ' ' + m.from + ' -> ' + m.to).join(' ; ') + ')');

// Ce qui lit encore le module dans son ancien fichier, hors de l'extension : a mettre a jour a la main.
const readers = [];
// Les tests et le harnais lisent les fichiers de l'extension ; les outils de renommage, eux, sont de l'histoire.
for (const dir of ['tests', 'tools/harness']) {
	if (!fs.existsSync(path.join(ROOT, dir))) continue;
	const scan = (d) => {
		for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
			const rel = d + '/' + e.name;
			if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.endsWith('-chrome') && e.name !== 'ad-profile') scan(rel); continue; }
			if (!/\.(js|py)$/.test(e.name)) continue;
			const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
			if (t.includes(base) && MODULE && t.includes(MODULE)) readers.push(rel);
		}
	};
	scan(dir);
}
if (readers.length) console.log('   A VERIFIER : ces fichiers nomment a la fois ' + base + ' et ' + MODULE + ' : ' + readers.join(' '));

if (DRY) {
	console.log('   --dry : rien n\'est ecrit');
	process.exit(0);
}
fs.mkdirSync(path.join(ROOT, INTO), { recursive: true });
for (const [f, text] of overlay) fs.writeFileSync(path.join(ROOT, f), text, 'utf8');
console.log('   ecrit : ' + [...overlay.keys()].join(' '));
console.log('   ensuite : node tools/extract/extractcheck.js, puis py -3.14 tools/harness/verify.py --statique');
