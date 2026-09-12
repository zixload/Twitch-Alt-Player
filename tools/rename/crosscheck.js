'use strict';
/*
	Checks that the script, the markup and the stylesheets still agree on every name.

	The harness proves the stream plays. It does not prove that every button still responds or
	that every rule still matches: a stylesheet selecting an id nobody carries any more looks
	exactly like a stylesheet that works, and a getElementById on a name the markup lost returns
	null quietly until something dereferences it.

	So this is a static invariant, meant to be run before a rename and again after. The numbers
	must be identical. If a dangling reference appears that was not there before, the rename lost
	a side.

	**The scripts are read with the parser, never with regular expressions.** The first version
	matched quote-content-quote on raw text. It could not see template literals, and the player
	queries its controls like this:

	    document.querySelector(`input[name="одновременныхзагрузок"][value="${...}"]`)

	The markup was renamed, the query was not, querySelector returned null and the player died at
	start-up on "Cannot set properties of null" while this check reported nothing. It also never
	compared name= attributes, never looked at data-* attributes, and ignored selectors held in
	constants such as COLOUR_BUTTON_SELECTOR.

	Four kinds of name are checked: id, class, name= value, data-* attribute.

	A name is *provided* by the markup, or by a script that writes it (.id =, .className =,
	classList.add, setAttribute, an HTML fragment inside a string). A name is *requested* by a
	script that looks it up (getElementById, querySelector, matches, closest, classList.contains,
	getAttribute...) or by a stylesheet selector. A request nobody provides is dangling.

	Two scopes, taken from manifest.json and from the <script>/<link> tags, never mixed:
	  - the extension pages (player.html, report.html) and what they load — a closed world, every
	    name must be provided there. This is the invariant.
	  - the twitch.tv page (content scripts, content.css) — the page's own DOM is unknown, so the
	    names found there are listed for information and kept out of the total.

	What cannot be resolved statically (a function parameter, a name built around ${...}) is
	listed as such rather than silently ignored: that list is the check's remaining blind spot.

	Usage: node crosscheck.js [--root <dir>] [--out <rapport.txt>] [--json <fichier>]
	  --root  directory holding the extension (default: the repository root)
	  --out   report path (default: crosscheck-report.txt next to this script)
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const arg = (flag) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const ROOT = path.resolve(arg('--root') || path.join(__dirname, '..', '..'));
const OUT = arg('--out') || path.join(__dirname, 'crosscheck-report.txt');
const JSON_OUT = arg('--json');

const exists = (f) => fs.existsSync(path.join(ROOT, f));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Un morceau dynamique (expression de gabarit, parametre...) : aucun caractere de nom ne l'est.
const HOLE = '\u0001';
const KINDS = ['id', 'class', 'name', 'attr'];
/*
	Un nom construit par prefixe, GetNode(`индикаторпрокрутки-${elScroll.id}`), ne se resout pas.
	Mais son prefixe se verifie : au moins un nom fourni doit commencer par lui. Sans cela,
	renommer ces identifiants dans le balisage casse la recherche sans que rien ne le signale.
*/
const PREFIX_KINDS = ['id*', 'class*', 'name*'];
const ALL_KINDS = [...KINDS, ...PREFIX_KINDS];
const KIND_LABEL = {
	id: 'identifiants', class: 'classes', name: 'noms de controle (name=)', attr: 'attributs data-*',
	'id*': "prefixes d'identifiant", 'class*': 'prefixes de classe', 'name*': 'prefixes de name=',
};

// Grammaire CSS d'un identifiant : ne commence pas par un chiffre.
const NAME = '-?[_A-Za-z\\u00A0-\\uFFFF][-_A-Za-z0-9\\u00A0-\\uFFFF]*';
const RE_NAME_WHOLE = new RegExp('^' + NAME + '$');

// ---------------------------------------------------------------------------------------------
// Perimetres

const manifest = JSON.parse(read('manifest.json'));
const pageHtml = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f));
const htmlLoads = (re) => {
	const out = new Set();
	for (const f of pageHtml) {
		for (const m of read(f).replace(/<!--[\s\S]*?-->/g, '').matchAll(re)) out.add(m[1]);
	}
	return [...out].filter(exists);
};
const extensionScope = {
	title: "PAGES DE L'EXTENSION",
	closed: true,
	html: pageHtml,
	js: htmlLoads(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi),
	css: htmlLoads(/<link\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+\.css)/gi),
};
const contentJs = new Set();
for (const cs of manifest.content_scripts || []) for (const f of cs.js || []) contentJs.add(f);
const contentCss = new Set();
for (const cs of manifest.content_scripts || []) for (const f of cs.css || []) contentCss.add(f);
for (const war of manifest.web_accessible_resources || []) {
	for (const f of war.resources || []) {
		if (/\.js$/i.test(f)) contentJs.add(f);
		if (/\.css$/i.test(f)) contentCss.add(f);
	}
}
const pageScope = {
	title: 'PAGE TWITCH.TV',
	closed: false,
	html: [],
	js: [...contentJs].filter(exists),
	css: [...contentCss].filter(exists),
};

// ---------------------------------------------------------------------------------------------
// Registre d'un perimetre

const newRegistry = () => {
	const r = { provided: {}, requested: {} };
	for (const k of ALL_KINDS) {
		r.provided[k] = new Map();   // nom -> Set(fichiers)
		r.requested[k] = new Map();
	}
	return r;
};

// « prefixe<trou>... » : le prefixe s'il est un debut de nom valable.
const prefixOf = (s) => {
	const m = typeof s === 'string' && s.match(new RegExp('^(' + NAME + ')' + HOLE));
	return m ? m[1] : null;
};
const put = (map, name, file) => {
	if (!map.has(name)) map.set(name, new Set());
	map.get(name).add(file);
};

// Un nom entier, ou rien : un nom colle a un trou n'est qu'un morceau.
const wholeName = (s) => (typeof s === 'string' && !s.includes(HOLE) && RE_NAME_WHOLE.test(s) ? s : null);

// Lit un selecteur : #id, .classe, [data-x], [name="v"], [id="v"], [class~="v"].
const scanSelector = (sel, add) => {
	let partial = false;
	const rest = sel.replace(
		/\[\s*([^\]\s=~|^$*]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*(?:[iIsS]\s*)?\]/g,
		(m, attr, op, v1, v2, v3) => {
			if (attr.includes(HOLE)) { partial = true; return ' '; }
			const v = v1 !== undefined ? v1 : v2 !== undefined ? v2 : v3;
			if (/^data-/i.test(attr)) add('attr', attr.toLowerCase());
			if (op === '=' || (attr === 'class' && op === '~=')) {
				const kind = attr === 'id' ? 'id' : attr === 'name' ? 'name' : attr === 'class' ? 'class' : null;
				if (kind) {
					if (wholeName(v)) add(kind, v);
					else if (v && v.includes(HOLE)) {
						partial = true;
						if (prefixOf(v)) add(kind + '*', prefixOf(v));
					}
				}
			}
			return ' ';
		});
	const re = new RegExp('([#.])(' + NAME + ')(' + HOLE + ')?', 'g');
	for (const m of rest.matchAll(re)) {
		if (m[3]) {
			partial = true;
			add((m[1] === '#' ? 'id' : 'class') + '*', m[2]);
			continue;
		}
		add(m[1] === '#' ? 'id' : 'class', m[2]);
	}
	if (new RegExp('[#.]' + HOLE).test(rest)) partial = true;
	return partial;
};

// Lit un fragment de balisage : chaque attribut id, class, name, data-*.
const scanMarkup = (text, add) => {
	for (const tag of text.matchAll(/<[A-Za-z][^<>]*>/g)) {
		const attrs = tag[0].replace(/^<[A-Za-z][-\w]*/, '');
		for (const m of attrs.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
			const a = m[1].toLowerCase();
			const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
			if (a === 'id' && wholeName(v)) add('id', v);
			else if (a === 'name' && wholeName(v)) add('name', v);
			else if (a === 'class' && v) for (const c of v.split(/\s+/)) { if (wholeName(c)) add('class', c); }
			else if (a.startsWith('data-')) add('attr', a);
		}
	}
};

// ---------------------------------------------------------------------------------------------
// Resolution statique d'une expression en texte(s)

const MAX_ALTERNATIVES = 32;

// Constantes a valeur statique, sur tous les scripts du perimetre (scripts classiques : tout est
// global). Un nom declare deux fois avec des valeurs differentes est ambigu, donc non resolu.
const collectConstants = (asts) => {
	const inits = new Map();
	for (const { ast } of asts) {
		traverse(ast, {
			VariableDeclarator(p) {
				if (p.parent.kind !== 'const' || p.node.id.type !== 'Identifier' || !p.node.init) return;
				const n = p.node.id.name;
				if (!inits.has(n)) inits.set(n, []);
				inits.get(n).push(p.node.init);
			},
		});
	}
	return inits;
};

const makeResolver = (inits) => {
	const cache = new Map();
	const resolving = new Set();
	const resolve = (node) => {
		if (!node) return [HOLE];
		switch (node.type) {
		case 'StringLiteral':
			return [node.value];
		case 'NumericLiteral':
			return [String(node.value)];
		case 'TemplateLiteral': {
			let acc = [''];
			node.quasis.forEach((q, i) => {
				acc = acc.map((s) => s + (q.value.cooked !== null && q.value.cooked !== undefined ? q.value.cooked : q.value.raw));
				if (i < node.expressions.length) acc = combine(acc, resolve(node.expressions[i]));
			});
			return acc;
		}
		case 'BinaryExpression':
			if (node.operator !== '+') return [HOLE];
			return combine(resolve(node.left), resolve(node.right));
		case 'ConditionalExpression':
			return [...resolve(node.consequent), ...resolve(node.alternate)].slice(0, MAX_ALTERNATIVES);
		case 'LogicalExpression':
			if (node.operator === '&&') return resolve(node.right);  // la valeur utile est a droite
			return [...resolve(node.left), ...resolve(node.right)].slice(0, MAX_ALTERNATIVES);
		case 'Identifier': {
			const n = node.name;
			if (cache.has(n)) return cache.get(n);
			const list = inits.get(n);
			if (!list || resolving.has(n)) return [HOLE];
			resolving.add(n);
			const values = list.map((init) => resolve(init));
			resolving.delete(n);
			const flat = values.map((v) => JSON.stringify(v));
			const out = flat.every((v) => v === flat[0]) ? values[0] : [HOLE];
			cache.set(n, out);
			return out;
		}
		default:
			return [HOLE];
		}
	};
	const combine = (a, b) => {
		const out = [];
		for (const x of a) for (const y of b) {
			out.push(x + y);
			if (out.length >= MAX_ALTERNATIVES) return out;
		}
		return out;
	};
	return resolve;
};

// ---------------------------------------------------------------------------------------------
// Analyse d'un perimetre

const CLASSLIST_REQUEST = new Set(['contains', 'remove']);
const CLASSLIST_PROVIDE = new Set(['add', 'toggle']);
const ATTR_READ = new Set(['getAttribute', 'hasAttribute', 'removeAttribute', 'getAttributeNode']);
const SELECTOR_METHODS = new Set(['querySelector', 'querySelectorAll', 'matches', 'closest', 'webkitMatchesSelector']);

const analyse = (scope) => {
	const reg = newRegistry();
	const unresolved = [];
	// Un prefixe se demande, il ne se fournit pas : ce sont les noms entiers qui le satisfont.
	const provide = (file) => (kind, name) => { if (!kind.endsWith('*')) put(reg.provided[kind], name, file); };
	const request = (file) => (kind, name) => put(reg.requested[kind], name, file);

	for (const f of scope.html) scanMarkup(read(f).replace(/<!--[\s\S]*?-->/g, ''), provide(f));

	for (const f of scope.css) {
		const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
		for (const m of text.matchAll(/([^{}]+)\{/g)) {
			const sel = m[1];
			if (/^\s*@/.test(sel)) continue;          // at-rules : pas des selecteurs d'element
			if (/^\s*(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*\s*$/i.test(sel)) continue;  // @keyframes
			scanSelector(sel, request(f));
		}
	}

	const asts = scope.js.map((f) => {
		const src = read(f);
		return { f, src, ast: parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true, errorRecovery: true }) };
	});
	const resolve = makeResolver(collectConstants(asts));
	const srcOf = new Map(asts.map((a) => [a.f, a.src]));

	const blindAt = (file, node, how) => unresolved.push({
		file, line: node.loc.start.line, how,
		code: srcOf.get(file).slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 100),
	});

	/*
		Un parametre de fonction se suit sur un niveau.

		ShowForm(oDocument, sFormId) fait classList.add(sFormId) : le nom n'est connu qu'aux
		appels, ShowForm(oDocument, "debug-message"). L'operation est donc differee, puis
		rejouee sur l'argument de chaque appel. Un seul niveau : un argument lui-meme parametre
		reste non resolu, au lieu d'ouvrir une analyse de flux complete.

		Les appels se reconnaissent par le nom : F(...) ou objet.F(...). Pour la forme membre, seuls
		les noms a majuscule initiale sont suivis — la convention des fonctions de ce depot — afin
		qu'un « add » ou un « get » quelconque ne soit jamais pris pour elle.
	*/
	const deferred = [];
	const DIRECT = new Set(['GetNode']);  // deja traitee comme une demande a chaque appel

	const paramTarget = (scopeRef, node) => {
		if (!scopeRef || node.type !== 'Identifier') return null;
		const b = scopeRef.getBinding(node.name);
		if (!b || b.kind !== 'param') return null;
		const fn = b.path.parentPath;
		if (!fn || !fn.isFunction()) return null;
		const index = fn.node.params.indexOf(b.path.node);
		if (index === -1) return null;
		let name = null;
		if (fn.node.id) name = fn.node.id.name;
		else if (fn.parentPath.isVariableDeclarator() && fn.parent.id.type === 'Identifier') name = fn.parent.id.name;
		else if (fn.parentPath.isObjectProperty() && fn.parent.key.type === 'Identifier') name = fn.parent.key.name;
		else if (fn.parentPath.isAssignmentExpression() && fn.parent.left.type === 'MemberExpression'
			&& fn.parent.left.property.type === 'Identifier') name = fn.parent.left.property.name;
		return name ? { name, index } : null;
	};

	// Applique un lecteur a chaque alternative ; signale ce qui reste dynamique.
	const each = (file, node, how, onText, scopeRef) => {
		const target = paramTarget(scopeRef, node);
		if (target) {
			if (!DIRECT.has(target.name)) deferred.push({ file, node, how, onText, ...target });
			return;
		}
		let hole = false;
		for (const t of resolve(node)) {
			if (t === HOLE) { hole = true; continue; }
			if (onText(t) === true) hole = true;
		}
		if (hole) blindAt(file, node, how);
	};

	const callsByName = new Map();

	for (const { f, ast } of asts) {
		const P = provide(f);
		const R = request(f);
		const blind = (node, how) => blindAt(f, node, how);

		// const oClasses = document.body.classList : l'alias vaut classList.
		const classListAliases = new Set();
		const isClassList = (n) => n && n.type === 'MemberExpression' && !n.computed
			&& n.property.type === 'Identifier' && n.property.name === 'classList';
		traverse(ast, {
			VariableDeclarator(p) {
				if (p.node.id.type === 'Identifier' && isClassList(p.node.init)) classListAliases.add(p.node.id.name);
			},
			AssignmentExpression(p) {
				if (p.node.left.type === 'Identifier' && isClassList(p.node.right)) classListAliases.add(p.node.left.name);
			},
		});

		const asName = (kind, add) => (t) => {
			if (wholeName(t)) { add(kind, t); return false; }
			if (prefixOf(t)) add(kind + '*', prefixOf(t));
			return t.includes(HOLE);
		};
		const asClasses = (add) => (t) => {
			let partial = false;
			for (const c of t.split(/\s+/)) {
				if (!c) continue;
				if (wholeName(c)) add('class', c);
				else if (c.includes(HOLE)) {
					partial = true;
					if (prefixOf(c)) add('class*', prefixOf(c));
				}
			}
			return partial;
		};
		const asSelector = (add) => (t) => scanSelector(t, add);
		const asAttr = (add) => (t) => {
			if (/^data-/i.test(t) && !t.includes(HOLE)) add('attr', t.toLowerCase());
			return t.includes(HOLE) && /^data-/i.test(t);
		};

		traverse(ast, {
			CallExpression(p) {
				const c = p.node.callee;
				const args = p.node.arguments;
				const S = p.scope;

				// Nom de l'appel : F(...) ou objet.F(...), pour rejouer les operations differees.
				const callName = c.type === 'Identifier' ? c.name
					: c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier'
						&& /^[A-Z]/.test(c.property.name) ? c.property.name : null;
				if (callName) {
					if (!callsByName.has(callName)) callsByName.set(callName, []);
					callsByName.get(callName).push({ file: f, node: p.node });
				}
				if (!args.length) return;

				// GetNode(...) s'appelle nu : c'est la voie la plus frequente vers un element.
				if (c.type === 'Identifier' && c.name === 'GetNode') {
					// GetNode accepte aussi un element : seul un argument textuel est une demande.
					if (resolve(args[0]).every((x) => x === HOLE)) return;
					each(f, args[0], 'GetNode', asName('id', R), S);
					return;
				}
				if (c.type !== 'MemberExpression' || c.computed || c.property.type !== 'Identifier') return;
				const m = c.property.name;
				const onClassList = isClassList(c.object)
					|| (c.object.type === 'Identifier' && classListAliases.has(c.object.name));

				if (onClassList) {
					if (m === 'replace') {
						each(f, args[0], 'classList.replace', asClasses(R), S);
						if (args[1]) each(f, args[1], 'classList.replace', asClasses(P), S);
					} else if (CLASSLIST_PROVIDE.has(m)) {
						const list = m === 'toggle' ? [args[0]] : args;   // le 2e argument de toggle est un booleen
						for (const a of list) each(f, a, 'classList.' + m, asClasses(P), S);
					} else if (CLASSLIST_REQUEST.has(m)) {
						for (const a of m === 'contains' ? [args[0]] : args) each(f, a, 'classList.' + m, asClasses(R), S);
					}
					return;
				}
				if (m === 'getElementById' || m === 'GetNode') {
					if (m === 'GetNode' && resolve(args[0]).every((x) => x === HOLE)) return;
					each(f, args[0], m, asName('id', R), S);
				} else if (m === 'getElementsByClassName') {
					each(f, args[0], m, asClasses(R), S);
				} else if (m === 'getElementsByName') {
					each(f, args[0], m, asName('name', R), S);
				} else if (SELECTOR_METHODS.has(m)) {
					each(f, args[0], m, asSelector(R), S);
				} else if (m === 'setAttribute' || m === 'toggleAttribute') {
					const names = resolve(args[0]);
					for (const a of names) {
						if (a === HOLE) { blind(args[0], m); continue; }
						const low = a.toLowerCase();
						if (low.startsWith('data-')) P('attr', low);
						if (m === 'setAttribute' && args[1]) {
							if (low === 'id') each(f, args[1], m, asName('id', P), S);
							else if (low === 'name') each(f, args[1], m, asName('name', P), S);
							else if (low === 'class') each(f, args[1], m, asClasses(P), S);
						}
					}
				} else if (ATTR_READ.has(m)) {
					each(f, args[0], m, asAttr(R), S);
				} else if (m === 'insertAdjacentHTML' && args[1]) {
					for (const t of resolve(args[1])) if (t !== HOLE) scanMarkup(t, P);
				}
			},
			AssignmentExpression(p) {
				const l = p.node.left;
				if (l.type !== 'MemberExpression' || l.computed || l.property.type !== 'Identifier') return;
				const m = l.property.name;
				const r = p.node.right;
				const S = p.scope;
				if (m === 'id') each(f, r, '.id =', asName('id', P), S);
				else if (m === 'name') each(f, r, '.name =', asName('name', P), S);
				else if (m === 'className') each(f, r, '.className =', asClasses(P), S);
				else if (m === 'innerHTML' || m === 'outerHTML') {
					for (const t of resolve(r)) if (t !== HOLE) scanMarkup(t, P);
				}
			},
			// Un fragment de balisage ecrit en chaine fournit ses noms, ou qu'il finisse.
			StringLiteral(p) {
				if (p.node.value.includes('<')) scanMarkup(p.node.value, P);
			},
			TemplateLiteral(p) {
				const t = p.node.quasis.map((q) => q.value.cooked || q.value.raw).join(HOLE);
				if (t.includes('<')) scanMarkup(t, P);
			},
		});
	}

	// Rejoue chaque operation differee sur l'argument de chaque appel, sans scope : un niveau.
	for (const d of deferred) {
		const sites = (callsByName.get(d.name) || []).filter((s) => s.node.arguments.length > d.index);
		if (!sites.length) {
			blindAt(d.file, d.node, d.how);
			continue;
		}
		for (const s of sites) each(s.file, s.node.arguments[d.index], d.how + ' via ' + d.name, d.onText, null);
	}

	const dangling = {};
	for (const k of ALL_KINDS) {
		const base = k.replace('*', '');
		const satisfied = k.endsWith('*')
			? (p) => [...reg.provided[base].keys()].some((n) => n.startsWith(p))
			: (n) => reg.provided[k].has(n);
		dangling[k] = [...reg.requested[k]]
			.filter(([n]) => !satisfied(n))
			.map(([n, files]) => [n, [...files].sort().join(' ')])
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	}
	return { scope, reg, dangling, unresolved };
};

// ---------------------------------------------------------------------------------------------
// Rapport

const ext = analyse(extensionScope);
const page = analyse(pageScope);
const count = (d) => ALL_KINDS.reduce((s, k) => s + d[k].length, 0);
const total = count(ext.dangling);

const l = [];
l.push('ACCORD ENTRE SCRIPT, BALISAGE ET FEUILLES DE STYLE');
l.push('');
const section = (res, note) => {
	const { scope, reg, dangling } = res;
	l.push('== ' + scope.title + ' ==');
	if (note) l.push('   ' + note);
	l.push('   balisage : ' + (scope.html.join(' ') || '(celui de la page, inconnu)'));
	l.push('   scripts  : ' + scope.js.join(' '));
	l.push('   styles   : ' + scope.css.join(' '));
	l.push('');
	l.push('   ' + ''.padEnd(26) + 'fournis   demandes   pendants');
	for (const k of ALL_KINDS) {
		const provided = k.endsWith('*') ? '-' : String(reg.provided[k].size);
		l.push('   ' + KIND_LABEL[k].padEnd(26) + provided.padStart(7)
			+ String(reg.requested[k].size).padStart(11) + String(dangling[k].length).padStart(11));
	}
	l.push('');
	for (const k of ALL_KINDS) {
		if (!dangling[k].length) continue;
		l.push('   ' + KIND_LABEL[k] + ' : ' + dangling[k].length);
		for (const [n, files] of dangling[k]) {
			// Un fait, pas un verdict : ShowForm ajoute comme classe l'id d'un formulaire.
			const hint = k === 'class' && reg.provided.id.has(n) ? '   (porte aussi comme id)' : '';
			l.push('      ' + n.padEnd(42) + files + hint);
		}
	}
	l.push('');
};
section(ext, "Monde clos : tout nom demande doit etre fourni ici. C'est l'invariant.");
section(page, 'Le DOM de twitch.tv est inconnu : liste indicative, hors total.');

l.push('== CHEMINS NON RESOLUS ==');
l.push("   L'outil ne sait pas quel nom est demande ou fourni ici. C'est son angle mort restant.");
l.push('');
const seen = new Set();
for (const u of [...ext.unresolved, ...page.unresolved]) {
	const key = u.file + ':' + u.line + ':' + u.how;
	if (seen.has(key)) continue;
	seen.add(key);
	l.push('   ' + (u.file + ':' + u.line).padEnd(20) + (u.how + ' ').padEnd(36) + u.code);
}
l.push('');
l.push('PENDANTES, PAGE TWITCH.TV (hors total) : ' + count(page.dangling));
l.push('CHEMINS NON RESOLUS                    : ' + seen.size);
l.push('TOTAL PENDANTES                        : ' + total);

const texte = l.join('\n');
fs.writeFileSync(OUT, texte, 'utf8');
console.log('pendantes, pages de l\'extension : ' + total);
for (const k of ALL_KINDS) console.log('   ' + KIND_LABEL[k].padEnd(26) + ext.dangling[k].length);
console.log('pendantes, page twitch.tv (hors total) : ' + count(page.dangling));
console.log('chemins non resolus : ' + seen.size);
console.log('rapport : ' + OUT);
console.log('TOTAL PENDANTES : ' + total);

if (JSON_OUT) {
	const names = (d) => Object.fromEntries(ALL_KINDS.map((k) => [k, d[k].map((x) => x[0])]));
	fs.writeFileSync(JSON_OUT, JSON.stringify({
		total,
		extension: names(ext.dangling),
		page: names(page.dangling),
		unresolved: seen.size,
	}, null, 1), 'utf8');
}
