'use strict';
/*
	What runs while the scripts load, and in what order it has to.

	The extension's scripts are classic scripts, not ES modules: every top-level declaration lands in
	one global scope shared by all the scripts of a page, and each script runs top to bottom as soon
	as it is loaded. A module is an IIFE, `const m_X = (() => { ... })()`, so its body runs at that
	moment. Everything it touches *then* must already exist. Everything it only touches inside a
	function that runs later — an event handler, a timer, a method called after start-up — does not.

	So splitting player.js into files is an ordering problem, and only an ordering problem. This file
	answers it from the code:

	  - the load contexts: each extension page and what its <script src> tags load, and the world the
	    content scripts share on twitch.tv, in the order the manifest injects them;
	  - for every top-level statement, the global names it references *while it is being evaluated*.

	The second is not a text search. Evaluating a statement runs its IIFE bodies, the functions it
	calls right away — local or global — and, through a module's returned object, the methods it
	calls on another module: m_Events.AddHandler(...) during construction runs AddHandler's body,
	which references Check. Function values handed to something that calls them later are not
	followed: addEventListener, setTimeout, then, m_Events.AddHandler... A function handed to a callee
	this file does not know is followed anyway, and the report says so: an unknown callee may call it
	on the spot (forEach does), and a false alarm costs a look where a missed one costs a dead page.

	Two checks come out of it:
	  - ORDER: nothing is referenced during evaluation before it is defined. Violations are dead pages.
	  - CONSTRUCTION RULE (REPARTITION.md, section 3): while a module is being built, it may call
	    into m_Log and m_Events and no other module. That is what lets every other module load in any
	    order, and what a rewrite can silently break.

	A third kind sits between the two: a microtask scheduled while a script loads (a then on a promise)
	runs as soon as that script ends, before the next deferred script. What it references must be
	defined in the same file or an earlier one. See MICROTASK.

	Usage: node graph.js [--root <dir>] [--json <fichier>]     (exit 1 on any violation)
	As a library: see module.exports at the end.
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

// Les deux seuls modules qu'un autre module peut appeler pendant sa construction.
const CONSTRUCTION_ALLOWED = new Set(['m_Log', 'm_Events']);
/*
	Exceptions mesurees, chacune nommee, jamais une regle elargie en silence.

	m_FullscreenMode appelle Update() a la fin de sa construction ; Update appelle ChangeButton, qui
	appelle GetText des que le bouton porte une infobulle, et GetText appelle m_i18n.GetMessage. Le
	releve de REPARTITION.md (« onze appels, tous vers m_Log ou m_Events ») ne suivait que les appels
	directs et ne l'a pas vu. m_i18n est dans common.js, charge avant tout le reste : rien ne casse
	aujourd'hui. A retirer quand m_FullscreenMode sera reecrit (agent B).
*/
const CONSTRUCTION_EXCEPTIONS = new Map([['m_FullscreenMode', new Set(['m_i18n'])]]);
const isModuleName = (n) => /^m_[A-Za-z0-9]+$/.test(n);

// Rend la fonction qu'on lui passe, enveloppee : son resultat vaut la fonction.
const WRAPPERS = new Set(['AddExceptionHandler']);

/*
	Recoivent une fonction pour l'appeler plus tard, jamais sur-le-champ.

	Plus tard n'a pas toujours le meme sens. Une microtache — then, catch, finally, queueMicrotask —
	s'execute des que le script en cours se termine, AVANT le script defer suivant : la spec HTML fait
	un point de controle des microtaches apres chaque script. Ce qu'elle reference doit donc etre
	defini dans le meme fichier ou avant. Une tache — evenement, minuterie, rappel chrome.* — ne
	s'intercale pas entre des scripts defer deja prets : ils s'executent a la suite. C'est
	l'hypothese de ce fichier, et la raison pour laquelle les taches ne contraignent pas l'ordre.
*/
const MICROTASK = new Set(['then', 'catch', 'finally', 'queueMicrotask']);
const DEFERRED = new Set([
	'addEventListener', 'AddHandler', 'addListener', 'setTimeout', 'setInterval', 'requestAnimationFrame',
	'requestIdleCallback', 'queueMicrotask', 'then', 'catch', 'finally',
	'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
]);
// Appellent la fonction sur-le-champ : suivies sans note.
const SYNC = new Set([
	'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast',
	'findLastIndex', 'flatMap', 'sort', 'from', 'replace', 'replaceAll', 'Promise',
]);

const RUN_AT = { document_start: 0, document_end: 1, document_idle: 2 };

// ---------------------------------------------------------------------------------------------
// Arbre de fichiers : le disque, ou le disque recouvert de textes en memoire (une extraction simulee)

const tree = (root, overlay = new Map()) => {
	const rel = (f) => f.replace(/\\/g, '/').replace(/^\.?\//, '');
	return {
		root,
		rel,
		exists: (f) => (overlay.has(rel(f)) ? overlay.get(rel(f)) !== null : fs.existsSync(path.join(root, rel(f)))),
		read: (f) => (overlay.has(rel(f)) ? overlay.get(rel(f)) : fs.readFileSync(path.join(root, rel(f)), 'utf8')),
		list: () => {
			const out = new Set(fs.readdirSync(root).filter((f) => fs.statSync(path.join(root, f)).isFile()));
			for (const [f, t] of overlay) { if (!f.includes('/')) { if (t === null) out.delete(f); else out.add(f); } }
			return [...out].sort();
		},
	};
};

const stripHtmlComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const scriptTags = (html) => [...stripHtmlComments(html).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);

/*
	Les contextes : une page de l'extension est un monde a elle ; les scripts de contenu d'une meme
	extension partagent un monde par cadre, injectes par moment (document_start, puis end, puis idle)
	et, a moment egal, dans l'ordre du manifeste. Les motifs d'adresse ne sont pas departages : le
	monde de contenu est leur reunion, ce qui ne peut que signaler trop, jamais trop peu.
*/
const contextsOf = (t) => {
	const out = [];
	for (const html of t.list().filter((f) => /\.html$/i.test(f))) {
		const files = scriptTags(t.read(html)).map(t.rel);
		if (files.length) out.push({ name: html, kind: 'page', files });
	}
	const manifest = JSON.parse(t.read('manifest.json'));
	const entries = (manifest.content_scripts || []).map((cs, i) => ({ cs, i }))
		.sort((a, b) => (RUN_AT[a.cs.run_at || 'document_idle'] - RUN_AT[b.cs.run_at || 'document_idle']) || a.i - b.i);
	const files = [];
	for (const { cs } of entries) for (const f of cs.js || []) if (!files.includes(t.rel(f))) files.push(t.rel(f));
	if (files.length) out.push({ name: 'manifest.json (scripts de contenu)', kind: 'content', files });
	return out;
};

// ---------------------------------------------------------------------------------------------
// Fichiers analyses

const parseCache = new Map();  // texte -> ast (le meme texte n'est jamais relu deux fois)
const parse = (src) => {
	if (!parseCache.has(src)) {
		parseCache.set(src, parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true, errorRecovery: true }));
	}
	return parseCache.get(src);
};

const bindingNames = (pattern, out = []) => {
	if (!pattern) return out;
	switch (pattern.type) {
	case 'Identifier': out.push(pattern.name); break;
	case 'ObjectPattern': for (const p of pattern.properties) bindingNames(p.type === 'RestElement' ? p.argument : p.value, out); break;
	case 'ArrayPattern': for (const e of pattern.elements) bindingNames(e, out); break;
	case 'AssignmentPattern': bindingNames(pattern.left, out); break;
	case 'RestElement': bindingNames(pattern.argument, out); break;
	default: break;
	}
	return out;
};

// Les instructions de premier niveau d'un fichier, avec leur chemin babel.
const fileInfo = (t, f) => {
	const src = t.read(f);
	const ast = parse(src);
	let programPath = null;
	traverse(ast, { Program(p) { programPath = p; p.stop(); } });
	const statements = programPath.get('body');
	return { file: f, src, ast, programPath, statements, strict: ast.program.directives.some((d) => d.value.value === 'use strict') };
};

// ---------------------------------------------------------------------------------------------
// Analyse d'un contexte

const analyseContext = (t, ctx) => {
	const infos = ctx.files.filter((f) => t.exists(f)).map((f) => fileInfo(t, f));
	const missing = ctx.files.filter((f) => !t.exists(f));

	// Definitions globales : nom -> { file, index, kind, path }. Une fonction declaree est hissee.
	const globals = new Map();
	const redefinitions = [];
	infos.forEach((info) => {
		info.statements.forEach((s, index) => {
			const define = (name, kind, p) => {
				if (globals.has(name)) {
					const prev = globals.get(name);
					// Deux « var » ou deux fonctions se remplacent ; const, let et class levent.
					if (kind !== 'var' && kind !== 'function' || prev.kind !== kind) {
						redefinitions.push({ name, first: prev.file + ':' + prev.path.node.loc.start.line, again: info.file + ':' + s.node.loc.start.line });
					}
					return;
				}
				globals.set(name, { file: info.file, index: kind === 'function' ? -1 : index, kind, path: p, info });
			};
			if (s.isVariableDeclaration()) {
				s.get('declarations').forEach((d) => bindingNames(d.node.id).forEach((n) => define(n, s.node.kind, d)));
			} else if (s.isFunctionDeclaration() && s.node.id) {
				define(s.node.id.name, 'function', s);
			} else if (s.isClassDeclaration() && s.node.id) {
				define(s.node.id.name, 'class', s);
			}
		});
	});

	const isGlobalBinding = (b) => b && b.scope.block.type === 'Program';

	// L'objet rendu par un module IIFE : nom exporte -> chemin de la fonction.
	const exportsCache = new Map();
	const exportsOf = (name) => {
		if (exportsCache.has(name)) return exportsCache.get(name);
		const out = new Map();
		exportsCache.set(name, out);
		const def = globals.get(name);
		if (!def || !def.path.isVariableDeclarator()) return out;
		const init = def.path.get('init');
		if (!init.node || !init.isCallExpression()) return out;
		const callee = init.get('callee');
		if (!callee.isFunction() || !callee.get('body').isBlockStatement()) return out;
		for (const st of callee.get('body').get('body')) {
			if (!st.isReturnStatement() || !st.get('argument').isObjectExpression()) continue;
			for (const prop of st.get('argument').get('properties')) {
				const key = prop.node.key;
				const k = key && (key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : null);
				if (!k || prop.node.computed) continue;
				if (prop.isObjectMethod()) { out.set(k, prop); continue; }
				if (!prop.isObjectProperty()) continue;
				const fn = functionOfValue(prop.get('value'));
				if (fn) out.set(k, fn);
			}
		}
		return out;
	};

	// Une valeur qui designe une fonction : la fonction, un identifiant lie a une fonction, une enveloppe.
	const functionOfValue = (v, depth = 0) => {
		if (!v || !v.node || depth > 4) return null;
		if (v.isFunction()) return v;
		if (v.isCallExpression() && calleeName(v) && WRAPPERS.has(calleeName(v))) {
			const arg = v.get('arguments')[0];
			return functionOfValue(arg, depth + 1);
		}
		if (v.isIdentifier()) {
			const b = v.scope.getBinding(v.node.name);
			if (b) return functionOfBinding(b, depth + 1);
			const def = globals.get(v.node.name);
			return def ? functionOfDef(def, depth + 1) : null;
		}
		return null;
	};
	const functionOfBinding = (b, depth) => {
		const p = b.path;
		if (p.isFunctionDeclaration()) return p;
		if (p.isClassDeclaration()) return p;
		if (p.isVariableDeclarator() && p.node.id.type === 'Identifier' && b.constant) return functionOfValue(p.get('init'), depth);
		return null;
	};
	const functionOfDef = (def, depth) => {
		if (def.path.isFunctionDeclaration() || def.path.isClassDeclaration()) return def.path;
		if (def.path.isVariableDeclarator() && def.kind === 'const') return functionOfValue(def.path.get('init'), depth);
		return null;
	};

	const calleeName = (call) => {
		const c = call.node.callee;
		if (c.type === 'Identifier') return c.name;
		if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
		return null;
	};
	const calleeRoot = (call) => {
		let c = call.node.callee;
		while (c && c.type === 'MemberExpression') c = c.object;
		return c && c.type === 'Identifier' ? c.name : null;
	};

	/*
		Une valeur fonction est-elle executee pendant l'evaluation ? Oui si elle est appelee sur place,
		ou passee a un appelant qui l'appelle sur place. Rend { eager, note }.
	*/
	const eagerness = (fnPath) => {
		let v = fnPath;
		for (;;) {
			const parent = v.parentPath;
			if (!parent) return { eager: false };
			if ((parent.isCallExpression() || parent.isNewExpression()) && parent.node.callee === v.node) return { eager: true };
			if (parent.isMemberExpression() && parent.node.object === v.node && !parent.node.computed
				&& ['call', 'apply'].includes(parent.node.property.name)
				&& parent.parentPath.isCallExpression() && parent.parent.callee === parent.node) return { eager: true };
			if ((parent.isCallExpression() || parent.isNewExpression()) && parent.node.arguments.includes(v.node)) {
				const name = parent.isNewExpression() && parent.node.callee.type === 'Identifier' ? parent.node.callee.name : calleeName(parent);
				if (name && WRAPPERS.has(name)) { v = parent; continue; }
				if (name && DEFERRED.has(name)) return { eager: false };
				if (calleeRoot(parent) === 'chrome') return { eager: false };   // les API chrome.* rappellent plus tard
				if (name && SYNC.has(name)) return { eager: true };
				// Un appelant du depot se lit : appelle-t-il ce parametre pendant sa propre execution ?
				const callee = resolveCallee(parent);
				if (callee && callee.isFunction()) {
					return { eager: paramCalledEagerly(callee, parent.node.arguments.indexOf(v.node)) };
				}
				return { eager: true, note: 'fonction passee a ' + (name || 'un appelant inconnu') + ', supposee appelee sur-le-champ' };
			}
			return { eager: false };
		}
	};

	// La fonction qu'un appel invoque, quand elle se lit dans le depot : F(), m_X.Methode(), new C().
	const resolveCallee = (call) => {
		const c = call.get('callee');
		if (c.isIdentifier()) {
			const b = c.scope.getBinding(c.node.name);
			if (b && !isGlobalBinding(b)) return functionOfBinding(b, 0);
			const def = globals.get(c.node.name);
			return def ? functionOfDef(def, 0) : null;
		}
		if (c.isMemberExpression() && !c.node.computed && c.node.object.type === 'Identifier' && c.node.property.type === 'Identifier') {
			const b = c.scope.getBinding(c.node.object.name);
			if (b && !isGlobalBinding(b)) return null;
			if (globals.has(c.node.object.name)) return exportsOf(c.node.object.name).get(c.node.property.name) || null;
		}
		return null;
	};

	/*
		createElementEventHandler(fCall) rend un gestionnaire qui appellera fCall plus tard ;
		SniffProcessorAndRAM(fCall) l'appelle peut-etre tout de suite. Le corps de l'appele le dit :
		le parametre est-il appele hors de toute fonction differee, directement ou en le passant a un
		autre appele qui l'appelle ? Un parametre qui n'est pas un simple identifiant est suppose appele.
	*/
	const paramMemo = new Map();
	const paramCalledEagerly = (fn, index) => {
		const key = fn.node;
		if (!paramMemo.has(key)) paramMemo.set(key, new Map());
		const m = paramMemo.get(key);
		if (m.has(index)) return m.get(index);
		m.set(index, false);                       // garde de recursion
		const params = fn.node.params;
		if (index < 0 || index >= params.length) { m.set(index, false); return false; }
		if (params[index].type !== 'Identifier') { m.set(index, true); return true; }
		const binding = fn.scope.getBinding(params[index].name);
		let called = false;
		const body = fn.get('body');
		const visit = (p) => {
			if (called) { p.stop(); return; }
			const ids = binding ? binding.referencePaths : [];
			for (const r of ids) {
				if (called) break;
				if (!r.findParent((x) => x === p || x.node === p.node)) continue;
				// Chaque fonction entre la reference et le corps doit etre executee sur place.
				let eager = true;
				for (let f = r.getFunctionParent(); f && f.node !== fn.node; f = f.parentPath.getFunctionParent()) {
					if (!eagerness(f).eager) { eager = false; break; }
				}
				if (!eager) continue;
				const parent = r.parentPath;
				if ((parent.isCallExpression() || parent.isNewExpression()) && parent.node.callee === r.node) called = true;
				else if ((parent.isCallExpression() || parent.isNewExpression()) && parent.node.arguments.includes(r.node)) {
					const inner = resolveCallee(parent);
					const name = calleeName(parent);
					if (inner && inner.isFunction()) called = paramCalledEagerly(inner, parent.node.arguments.indexOf(r.node));
					else if (!(name && (DEFERRED.has(name) || WRAPPERS.has(name))) && calleeRoot(parent) !== 'chrome') called = true;
				}
			}
		};
		visit(body);
		m.set(index, called);
		return called;
	};

	/*
		Le parcours : references globales atteintes pendant l'evaluation d'un chemin.
		Rend Map(nom -> { at: 'fichier:ligne', via: [...] }) et accumule des notes.
	*/
	const infoOfNode = new Map();
	for (const info of infos) infoOfNode.set(info.ast.program, info);
	const fileOfPath = (p) => infoOfNode.get(p.findParent((x) => x.isProgram()) ? p.findParent((x) => x.isProgram()).node : p.node).file;

	const memo = new Map();
	const inProgress = new Set();
	const notes = [];

	const walkFunction = (fnPath, label) => {
		const key = fnPath.node;
		if (memo.has(key)) return memo.get(key);
		if (inProgress.has(key)) return new Map();
		inProgress.add(key);
		const refs = new Map();
		if (fnPath.isClassDeclaration() || fnPath.isClassExpression()) {
			// new Classe() : le constructeur et les initialisations de champs d'instance.
			for (const m of fnPath.get('body').get('body')) {
				if (m.isClassMethod() && m.node.kind === 'constructor') merge(refs, walkRegion([m.get('body'), ...m.get('params')], label));
				else if (m.isClassProperty() && !m.node.static && m.node.value) merge(refs, walkRegion([m.get('value')], label));
			}
			if (fnPath.node.superClass) merge(refs, walkRegion([fnPath.get('superClass')], label));
		} else {
			merge(refs, walkRegion([fnPath.get('body'), ...fnPath.get('params')], label));
		}
		inProgress.delete(key);
		memo.set(key, refs);
		return refs;
	};

	/*
		Premier chemin garde pour le rapport ; tous les sites comptes.
		micro : le nom n'est atteint qu'a travers une microtache. Un seul chemin direct suffit a le
		rendre immediat.
	*/
	const merge = (into, from, via, asMicro = false) => {
		for (const [n, r] of from) {
			const micro = asMicro || r.micro;
			if (!into.has(n)) { into.set(n, { at: r.at, via: via ? [via, ...r.via] : r.via, sites: new Set(r.sites), micro }); continue; }
			const e = into.get(n);
			for (const x of r.sites) e.sites.add(x);
			if (e.micro && !micro) Object.assign(e, { at: r.at, via: via ? [via, ...r.via] : r.via, micro: false });
		}
	};

	// Une valeur passee a then, catch, finally ou queueMicrotask, enveloppes comprises.
	const isMicrotaskArgument = (v) => {
		for (;;) {
			const parent = v.parentPath;
			if (!parent || !(parent.isCallExpression() || parent.isNewExpression()) || !parent.node.arguments.includes(v.node)) return false;
			const name = calleeName(parent);
			if (name && WRAPPERS.has(name)) { v = parent; continue; }
			return !!name && MICROTASK.has(name) && calleeRoot(parent) !== 'chrome';
		}
	};

	const walkRegion = (paths, label) => {
		const refs = new Map();
		const record = (name, p) => {
			const at = fileOfPath(p) + ':' + p.node.loc.start.line;
			if (!refs.has(name)) refs.set(name, { at, via: [], sites: new Set(), micro: false });
			const e = refs.get(name);
			e.sites.add(at);
			if (e.micro) Object.assign(e, { at, via: [], micro: false });
		};
		const follow = (fn, p, via, asMicro = false) => {
			if (!fn) return;
			merge(refs, walkFunction(fn, via), (asMicro ? 'microtache ' : '') + via + ' (' + fileOfPath(p) + ':' + p.node.loc.start.line + ')', asMicro);
		};
		// Fonctions nommees : babel reecrit l'objet visiteur au premier parcours.
		const onFunction = (p) => {
				const e = eagerness(p);
				if (e.eager) {
					if (e.note) notes.push({ at: fileOfPath(p) + ':' + p.node.loc.start.line, note: e.note, label });
					merge(refs, walkFunction(p, label));
				} else if (isMicrotaskArgument(p)) {
					follow(p, p, 'callback', true);
				}
				p.skip();
		};
		const onIdentifier = (p) => {
				if (!p.isReferencedIdentifier()) return;
				const name = p.node.name;
				const b = p.scope.getBinding(name);
				const parent = p.parentPath;
				const isCallee = (parent.isCallExpression() || parent.isNewExpression()) && parent.node.callee === p.node;
				if (b && !isGlobalBinding(b)) {
					if (isCallee) follow(functionOfBinding(b, 0), p, name);
					else if (isMicrotaskArgument(p)) follow(functionOfBinding(b, 0), p, name, true);
					return;
				}
				if (!globals.has(name)) return;           // globale du navigateur
				record(name, p);
				const def = globals.get(name);
				if (isCallee) { follow(functionOfDef(def, 0), p, name); return; }
				if (isMicrotaskArgument(p)) { follow(functionOfDef(def, 0), p, name, true); return; }
				// .catch(m_Debug.CaughtException) : la methode exportee, en microtache.
				if (parent.isMemberExpression() && parent.node.object === p.node && !parent.node.computed
					&& parent.node.property.type === 'Identifier' && isMicrotaskArgument(parent)) {
					const fn = exportsOf(name).get(parent.node.property.name);
					if (fn) follow(fn, p, name + '.' + parent.node.property.name, true);
				}
				// m_X.Methode(...) : le corps de la methode exportee.
				if (parent.isMemberExpression() && parent.node.object === p.node && !parent.node.computed
					&& parent.node.property.type === 'Identifier'
					&& parent.parentPath.isCallExpression() && parent.parent.callee === parent.node) {
					const fn = exportsOf(name).get(parent.node.property.name);
					if (fn) follow(fn, p, name + '.' + parent.node.property.name);
				}
		};
		for (const p of paths) {
			if (!p || !p.node) continue;
			// traverse ne visite pas la racine elle-meme.
			if (p.isIdentifier()) { onIdentifier(p); continue; }
			if (p.isFunction()) { onFunction(p); continue; }
			p.traverse({
				Function: onFunction,
				ClassProperty(q) { if (!q.node.static) q.skip(); },
				Identifier: onIdentifier,
			});
		}
		return refs;
	};

	// Ce qu'evalue une instruction de premier niveau.
	const statementRefs = (s) => {
		if (s.isFunctionDeclaration()) return new Map();
		if (s.isClassDeclaration()) {
			const parts = [];
			if (s.node.superClass) parts.push(s.get('superClass'));
			for (const m of s.get('body').get('body')) {
				if (m.node.computed) parts.push(m.get('key'));
				if ((m.isClassProperty() && m.node.static && m.node.value)) parts.push(m.get('value'));
				if (m.isStaticBlock()) parts.push(m);
			}
			return walkRegion(parts, s.node.id.name);
		}
		const label = s.isVariableDeclaration() ? s.node.declarations.map((d) => bindingNames(d.id).join(',')).join(',') : null;
		// Une instruction « racine » est elle-meme a parcourir : on l'enveloppe dans une region.
		return walkRegion([s], label);
	};

	const statements = [];
	infos.forEach((info, fileIndex) => {
		info.statements.forEach((s, index) => {
			const defines = s.isVariableDeclaration() ? s.node.declarations.flatMap((d) => bindingNames(d.id))
				: (s.isFunctionDeclaration() || s.isClassDeclaration()) && s.node.id ? [s.node.id.name] : [];
			statements.push({
				file: info.file, index, line: s.node.loc.start.line, path: s, defines,
				refs: statementRefs(s),
			});
		});
	});

	return { ctx, infos, missing, globals, redefinitions, statements, notes, exportsOf };
};

// ---------------------------------------------------------------------------------------------
// Les deux controles, pour un ordre de fichiers donne

const checkOrder = (analysis, order = analysis.ctx.files) => {
	const rank = new Map(order.map((f, i) => [f, i]));
	const violations = [];
	for (const st of analysis.statements) {
		for (const [name, r] of st.refs) {
			const def = analysis.globals.get(name);
			const a = [rank.get(def.file), def.index];
			const b = [rank.get(st.file), st.index];
			// Immediat : defini avant l'instruction. Microtache : defini au plus tard dans le meme fichier.
			const ok = r.micro ? a[0] <= b[0] : a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
			if (!ok) {
				violations.push({
					name, usedBy: st.file + ':' + st.line + (st.defines.length ? ' (' + st.defines.join(',') + ')' : ''),
					definedIn: def.file + ':' + def.path.node.loc.start.line, at: r.at, via: r.via, micro: r.micro,
				});
			}
		}
	}
	return violations;
};

const checkConstructionRule = (analysis) => {
	const forbidden = [];
	const allowed = [];
	for (const st of analysis.statements) {
		const own = st.defines.filter(isModuleName);
		if (!own.length) continue;
		for (const [name, r] of st.refs) {
			if (r.micro || !isModuleName(name) || own.includes(name)) continue;
			const entry = { module: own.join(','), calls: name, at: r.at, via: r.via, sites: [...r.sites] };
			const excepted = own.some((m) => CONSTRUCTION_EXCEPTIONS.has(m) && CONSTRUCTION_EXCEPTIONS.get(m).has(name));
			if (excepted) entry.exception = true;
			(CONSTRUCTION_ALLOWED.has(name) || excepted ? allowed : forbidden).push(entry);
		}
	}
	return { forbidden, allowed };
};

module.exports = {
	tree, contextsOf, analyseContext, checkOrder, checkConstructionRule, fileInfo, parse, scriptTags,
	stripHtmlComments, isModuleName, CONSTRUCTION_ALLOWED, CONSTRUCTION_EXCEPTIONS,
};

// ---------------------------------------------------------------------------------------------
// Ligne de commande

if (require.main === module) {
	const arg = (flag) => {
		const i = process.argv.indexOf(flag);
		return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
	};
	const ROOT = path.resolve(arg('--root') || path.join(__dirname, '..', '..'));
	const t = tree(ROOT);
	const out = [];
	const json = { contexts: {}, violations: 0, forbidden: 0 };
	let bad = 0;
	for (const ctx of contextsOf(t)) {
		const a = analyseContext(t, ctx);
		const v = checkOrder(a);
		const rule = checkConstructionRule(a);
		out.push('== ' + ctx.name + ' ==');
		out.push('   ordre : ' + ctx.files.join(' '));
		for (const m of a.missing) out.push('   FICHIER ABSENT : ' + m);
		for (const r of a.redefinitions) out.push('   REDEFINITION : ' + r.name + ' ' + r.first + ' puis ' + r.again);
		out.push('   references pendant la construction, ordre viole : ' + v.length);
		for (const x of v) out.push('      ' + x.name.padEnd(24) + (x.micro ? '(microtache) ' : '') + 'utilise par ' + x.usedBy + ' a ' + x.at + (x.via.length ? ' via ' + x.via.join(' > ') : '') + ', defini ' + x.definedIn);
		const micro = a.statements.reduce((n, st) => n + [...st.refs.values()].filter((r) => r.micro).length, 0);
		out.push('   references en microtache programmees au chargement : ' + micro);
		const nSites = (list) => list.reduce((n, x) => n + x.sites.length, 0);
		out.push('   appels de construction entre modules : ' + nSites(rule.allowed) + ' autorises, ' + nSites(rule.forbidden) + ' interdits');
		const line = (x) => x.module.padEnd(22) + '-> ' + x.calls.padEnd(14) + x.sites.join(' ') + (x.via.length ? '   premier via ' + x.via.join(' > ') : '')
			+ (x.exception ? '   [EXCEPTION CONNUE, voir CONSTRUCTION_EXCEPTIONS]' : '');
		for (const x of rule.allowed) out.push('      ' + line(x));
		for (const x of rule.forbidden) out.push('   INTERDIT ' + line(x));
		if (a.notes.length) {
			out.push('   fonctions supposees appelees sur-le-champ (appelant inconnu) : ' + a.notes.length);
			for (const n of a.notes) out.push('      ' + n.at.padEnd(20) + n.note);
		}
		out.push('');
		bad += v.length + rule.forbidden.length + a.missing.length + a.redefinitions.length;
		json.contexts[ctx.name] = {
			files: ctx.files,
			violations: v.map((x) => x.name + ' <- ' + x.usedBy),
			forbidden: rule.forbidden.map((x) => x.module + ' -> ' + x.calls),
			allowed: rule.allowed.length,
		};
		json.violations += v.length;
		json.forbidden += rule.forbidden.length;
	}
	out.push('TOTAL : ' + bad);
	fs.writeFileSync(path.join(__dirname, 'graph-report.txt'), out.join('\n') + '\n', 'utf8');
	if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(json, null, 1), 'utf8');
	console.log(out.join('\n'));
	process.exit(bad ? 1 : 0);
}
