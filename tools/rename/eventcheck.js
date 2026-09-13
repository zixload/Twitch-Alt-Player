'use strict';
/*
	Checks that every internal event sent is listened to, and every event listened to is sent.

	crosscheck.js proves that script, markup and stylesheets agree on DOM names. An internal event
	name is none of those: it lives only in two script strings, m_Events.SendEvent(x) on one side
	and m_Events.AddHandler(x) on the other. Nothing compared them, and a rename that moves one side
	breaks nothing visible — SendEvent finds no handler set and returns, quietly.

	That is exactly the outage this check was written after. The player sent
	`окно-открыто-${sWindowId}` while m_Controls listened to "window-opened-mainmenu": opening the
	main menu notified nobody, and dragging the statistics panel neither. The sender's name is
	built by prefix inside a template literal, so the word-level rename never saw it.

	**Pairing is done per page.** Each extension page is its own JavaScript realm: an event sent in
	player.html can never reach a handler in report.html. The scripts of a page are those its
	<script src> tags load, so a module extracted into its own file is picked up with no change here.

	**Names are resolved with the parser, never with regular expressions.** A name can be:
	  - a string literal                       SendEvent("player-paused")
	  - a constant, local or global            const EVENT = "..."; SendEvent(EVENT)
	  - a template built by prefix             SendEvent(`window-opened-${sWindowId}`)
	  - a function or constructor parameter    new NumberInput(..., "opacity") -> `dragger-drag-${sNodeId}`
	    followed one level, to the arguments of every call or `new` of that name
	  - a Hungarian string property            SendEvent(oMetadata.sEvent), resolved from every
	    `sEvent: "..."` written in the page's scripts

	What stays dynamic becomes a *pattern*: `window-opened-` + hole. A pattern pairs with a concrete
	name it fits. That alone is weak — `window-opened-anything` would fit — so the part the hole
	stands for must also be an element id carried by the page's markup. Every dynamic part in this
	player is an element id (a window, a dragged node); a hole that is not one is reported, and the
	rename that dropped the id from the markup is caught here even when crosscheck is not looking.

	A name that is dynamic from end to end cannot pair with anything without masking every other
	defect, so it is listed as a blind spot and paired with nothing. So is any use of m_Events
	that is not a direct call — `const send = m_Events.SendEvent` hides every name sent through it.

	Usage: node eventcheck.js [--root <dir>] [--out <rapport.txt>] [--json <fichier>]
	  exit 0 when every page pairs completely with no blind spot, 1 otherwise.
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
const OUT = arg('--out') || path.join(__dirname, 'eventcheck-report.txt');
const JSON_OUT = arg('--json');

// Le bus et ses trois methodes. Si une reecriture les renomme, c'est ici que ca se change.
const BUS = 'm_Events';
const SEND = 'SendEvent';
const LISTEN = 'AddHandler';
const UNLISTEN = 'RemoveHandler';
const METHODS = new Set([SEND, LISTEN, UNLISTEN]);

const HOLE = '';
const MAX_ALTERNATIVES = 64;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const stripHtmlComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

// ---------------------------------------------------------------------------------------------
// Pages, et ce que chacune charge

const pages = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort().map((html) => {
	const text = stripHtmlComments(read(html));
	const scripts = [...text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]).filter(exists);
	const ids = new Set();
	for (const tag of text.matchAll(/<[A-Za-z][^<>]*>/g)) {
		const m = tag[0].match(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i);
		if (m) ids.add(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
	}
	return { html, scripts, ids };
});

// ---------------------------------------------------------------------------------------------
// Resolution d'une expression en texte(s), avec des trous pour ce qui reste dynamique

const combine = (a, b) => {
	const out = [];
	for (const x of a) for (const y of b) {
		out.push(x + y);
		if (out.length >= MAX_ALTERNATIVES) return out;
	}
	return out;
};
const union = (lists) => [...new Set(lists.flat())].slice(0, MAX_ALTERNATIVES);

// Nom sous lequel une fonction s'appelle : F(...), objet.F(...), new F(...).
const functionName = (fn) => {
	if (fn.isClassMethod() || fn.isClassPrivateMethod()) {
		if (fn.node.kind === 'constructor') {
			const cls = fn.parentPath.parentPath;
			return cls.node.id ? { name: cls.node.id.name, isNew: true } : null;
		}
		return fn.node.key.type === 'Identifier' ? { name: fn.node.key.name, isNew: false } : null;
	}
	if (fn.node.id) return { name: fn.node.id.name, isNew: false };
	const p = fn.parentPath;
	if (p.isVariableDeclarator() && p.node.id.type === 'Identifier') return { name: p.node.id.name, isNew: false };
	if ((p.isObjectProperty() || p.isObjectMethod()) && p.node.key.type === 'Identifier') return { name: p.node.key.name, isNew: false };
	if (p.isAssignmentExpression() && p.node.left.type === 'MemberExpression' && p.node.left.property.type === 'Identifier') {
		return { name: p.node.left.property.name, isNew: false };
	}
	if (fn.isObjectMethod() && fn.node.key.type === 'Identifier') return { name: fn.node.key.name, isNew: false };
	return null;
};

const analysePage = (page) => {
	const files = page.scripts.map((f) => {
		const src = read(f);
		return { f, src, ast: parser.parse(src, { sourceType: 'script', allowReturnOutsideFunction: true, errorRecovery: true }) };
	});
	const srcOf = new Map(files.map((x) => [x.f, x.src]));
	const codeOf = (file, node) => srcOf.get(file).slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 90);

	// Tout ce qu'il faut pour resoudre, releve une fois sur les scripts de la page.
	const globalConsts = new Map();      // nom -> [{ path }]   (scripts classiques : tout est global)
	const stringProps = new Map();       // sNom -> [{ path du noeud valeur }]
	const callSites = new Map();         // nom -> [{ file, path }] pour F(...) et objet.F(...)
	const newSites = new Map();          // nom -> [{ file, path }] pour new F(...)
	const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

	for (const { f, ast } of files) {
		traverse(ast, {
			VariableDeclarator(p) {
				if (p.parent.kind === 'const' && p.node.id.type === 'Identifier' && p.node.init && p.scope.block.type === 'Program') {
					push(globalConsts, p.node.id.name, { file: f, path: p.get('init') });
				}
			},
			ObjectProperty(p) {
				const k = p.node.key;
				const name = k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null;
				if (name && /^s[A-Z]/.test(name)) push(stringProps, name, { file: f, path: p.get('value') });
			},
			AssignmentExpression(p) {
				const l = p.node.left;
				if (l.type === 'MemberExpression' && !l.computed && l.property.type === 'Identifier' && /^s[A-Z]/.test(l.property.name)) {
					push(stringProps, l.property.name, { file: f, path: p.get('right') });
				}
			},
			CallExpression(p) {
				const c = p.node.callee;
				if (c.type === 'Identifier') push(callSites, c.name, { file: f, path: p });
				else if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') push(callSites, c.property.name, { file: f, path: p });
			},
			NewExpression(p) {
				if (p.node.callee.type === 'Identifier') push(newSites, p.node.callee.name, { file: f, path: p });
			},
		});
	}

	/*
		resolve(path, depth) rend une liste de textes ; HOLE marque un morceau inconnu.
		depth borne le suivi des parametres a un niveau : un argument lui-meme parametre reste un
		trou, au lieu d'ouvrir une analyse de flux complete.
	*/
	const resolving = new Set();
	const resolve = (p, depth) => {
		const node = p && p.node;
		if (!node) return [HOLE];
		switch (node.type) {
		case 'StringLiteral':
			return [node.value];
		case 'NumericLiteral':
			return [String(node.value)];
		case 'TemplateLiteral': {
			let acc = [''];
			const exprs = p.get('expressions');
			node.quasis.forEach((q, i) => {
				acc = acc.map((s) => s + (q.value.cooked != null ? q.value.cooked : q.value.raw));
				if (i < exprs.length) acc = combine(acc, resolve(exprs[i], depth));
			});
			return acc;
		}
		case 'BinaryExpression':
			return node.operator === '+' ? combine(resolve(p.get('left'), depth), resolve(p.get('right'), depth)) : [HOLE];
		case 'ConditionalExpression':
			return union([resolve(p.get('consequent'), depth), resolve(p.get('alternate'), depth)]);
		case 'LogicalExpression':
			return node.operator === '&&' ? resolve(p.get('right'), depth)
				: union([resolve(p.get('left'), depth), resolve(p.get('right'), depth)]);
		case 'Identifier':
			return resolveIdentifier(p, depth);
		case 'MemberExpression':
			return resolveProperty(p, depth);
		default:
			return [HOLE];
		}
	};

	const guarded = (key, fn) => {
		if (resolving.has(key)) return [HOLE];
		resolving.add(key);
		try { return fn(); } finally { resolving.delete(key); }
	};

	const resolveIdentifier = (p, depth) => {
		const name = p.node.name;
		const binding = p.scope.getBinding(name);
		if (!binding) {
			const decls = globalConsts.get(name);
			if (!decls) return [HOLE];
			return guarded('g:' + name, () => sameOrHole(decls.map((d) => resolve(d.path, depth))));
		}
		if (binding.kind === 'param') return resolveParam(binding, depth);
		if (binding.kind === 'const' || (binding.constant && (binding.kind === 'let' || binding.kind === 'var'))) {
			const decl = binding.path;
			if (!decl.isVariableDeclarator() || decl.node.id.type !== 'Identifier' || !decl.node.init) return [HOLE];
			return guarded('b:' + decl.node.start, () => resolve(decl.get('init'), depth));
		}
		return [HOLE];
	};

	// Un nom declare deux fois avec des valeurs differentes est ambigu : un trou, pas un choix.
	const sameOrHole = (values) => {
		const flat = values.map((v) => JSON.stringify(v));
		return flat.every((v) => v === flat[0]) ? values[0] : [HOLE];
	};

	const resolveParam = (binding, depth) => {
		if (depth <= 0) return [HOLE];
		const fn = binding.path.parentPath;
		if (!fn || !fn.isFunction()) return [HOLE];
		const index = fn.node.params.indexOf(binding.path.node);
		const target = index === -1 ? null : functionName(fn);
		if (!target) return [HOLE];
		const sites = (target.isNew ? newSites : callSites).get(target.name) || [];
		const values = [];
		for (const s of sites) {
			const args = s.path.get('arguments');
			// Un appel qui omet l'argument ne l'apporte pas ; un appel etale (...args) le cache.
			if (args.some((a) => a.isSpreadElement())) { values.push([HOLE]); continue; }
			if (args.length > index) values.push(resolve(args[index], depth - 1));
		}
		return values.length ? guarded('p:' + fn.node.start + ':' + index, () => union(values)) : [HOLE];
	};

	/*
		oMetadata.sEvent : l'objet est inconnu, mais la propriete porte un nom hongrois de chaine.
		Toutes les valeurs ecrites sous ce nom dans la page sont les candidates. Limite aux noms
		/^s[A-Z]/ : une propriete du DOM comme .id ramasserait n'importe quel `id:` d'une requete
		GraphQL et fabriquerait des noms qui n'existent pas.
	*/
	const resolveProperty = (p, depth) => {
		const n = p.node;
		if (n.computed || n.property.type !== 'Identifier' || !/^s[A-Z]/.test(n.property.name)) return [HOLE];
		const writes = stringProps.get(n.property.name);
		if (!writes) return [HOLE];
		return guarded('s:' + n.property.name, () => union(writes.map((w) => resolve(w.path, depth))));
	};

	// -----------------------------------------------------------------------------------------
	// Releve des appels

	const sends = [];
	const listens = [];
	const unlistens = [];
	const blind = [];
	const busDefined = [];

	for (const { f, ast } of files) {
		traverse(ast, {
			Identifier(p) {
				if (p.node.name !== BUS) return;
				if (p.parentPath.isVariableDeclarator() && p.parent.id === p.node) { busDefined.push(f); return; }
				if (p.parentPath.isMemberExpression() && p.parent.object === p.node) {
					const m = p.parentPath;
					const prop = m.node.property;
					const method = !m.node.computed && prop.type === 'Identifier' ? prop.name : null;
					if (method && METHODS.has(method) && m.parentPath.isCallExpression() && m.parent.callee === m.node) {
						const call = m.parentPath;
						const argPath = call.get('arguments')[0];
						const entry = {
							file: f, line: call.node.loc.start.line,
							code: argPath ? codeOf(f, argPath.node) : '(aucun argument)',
							names: argPath ? resolve(argPath, 1) : [HOLE],
						};
						(method === SEND ? sends : method === LISTEN ? listens : unlistens).push(entry);
						return;
					}
					blind.push({ file: f, line: p.node.loc.start.line, how: method && !METHODS.has(method)
						? 'methode inconnue du bus : ' + method : 'usage indirect du bus', code: codeOf(f, m.parentPath.node) });
					return;
				}
				if (p.parentPath.isMemberExpression() && p.parent.property === p.node && !p.parent.computed) return;  // x.m_Events
				if (p.parentPath.isObjectProperty() && p.parent.key === p.node && !p.parent.computed) return;
				blind.push({ file: f, line: p.node.loc.start.line, how: 'le bus passe comme valeur', code: codeOf(f, p.parentPath.node) });
			},
		});
	}

	// -----------------------------------------------------------------------------------------
	// Appariement

	const isPattern = (t) => t.includes(HOLE);
	const fullyDynamic = (t) => t.split(HOLE).join('') === '';
	const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regexOf = (t) => new RegExp('^' + t.split(HOLE).map(escape).join('(.+?)') + '$');
	const shown = (t) => t.split(HOLE).join('${…}');

	// Deux motifs peuvent designer le meme nom si leurs parties fixes aux extremites s'accordent.
	const patternsMeet = (a, b) => {
		const [pa, sa] = [a.slice(0, a.indexOf(HOLE)), a.slice(a.lastIndexOf(HOLE) + 1)];
		const [pb, sb] = [b.slice(0, b.indexOf(HOLE)), b.slice(b.lastIndexOf(HOLE) + 1)];
		return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa));
	};

	// Chaque alternative d'un appel devient une entree a apparier.
	const explode = (list, role) => {
		const out = [];
		for (const e of list) {
			for (const t of e.names) {
				if (fullyDynamic(t)) {
					blind.push({ file: e.file, line: e.line, how: role + ' : nom entierement dynamique', code: e.code });
					continue;
				}
				out.push({ ...e, name: t });
			}
		}
		return out;
	};
	const S = explode(sends, SEND);
	const L = explode(listens, LISTEN);
	const U = explode(unlistens, UNLISTEN);

	const defects = {
		'sans-auditeur': [],          // envoye, personne n'ecoute
		'sans-emetteur': [],          // ecoute, personne n'envoie
		'retrait-sans-ajout': [],     // RemoveHandler d'un nom jamais ajoute
		'trou-hors-balisage': [],     // un motif s'apparie, mais ce que remplit son trou n'est pas un id de la page
	};
	const pairedByPattern = [];
	const where = (e) => e.file + ':' + e.line;

	// Rend vrai si `e` trouve un partenaire dans `others` ; note les appariements par motif.
	const findPartner = (e, others) => {
		let found = false;
		for (const o of others) {
			const ep = isPattern(e.name);
			const op = isPattern(o.name);
			if (!ep && !op) {
				if (e.name === o.name) found = true;
				continue;
			}
			if (ep && op) {
				if (patternsMeet(e.name, o.name)) {
					found = true;
					pairedByPattern.push({ a: e, b: o, unchecked: true });
				}
				continue;
			}
			const [pat, con] = ep ? [e, o] : [o, e];
			const m = con.name.match(regexOf(pat.name));
			if (!m) continue;
			found = true;
			const holes = m.slice(1);
			const missing = holes.filter((h) => !page.ids.has(h));
			pairedByPattern.push({ a: pat, b: con, holes, missing });
		}
		return found;
	};

	for (const s of S) if (!findPartner(s, L)) defects['sans-auditeur'].push(s);
	for (const l of L) if (!findPartner(l, S)) defects['sans-emetteur'].push(l);
	for (const u of U) if (!findPartner(u, L)) defects['retrait-sans-ajout'].push(u);

	const seenHole = new Set();
	for (const pr of pairedByPattern) {
		if (!pr.missing || !pr.missing.length) continue;
		// Un defaut par nom concret, pas un par site d'emission du motif.
		const key = where(pr.b) + '|' + pr.b.name;
		if (seenHole.has(key)) continue;
		seenHole.add(key);
		defects['trou-hors-balisage'].push({ ...pr.b, pattern: pr.a, missing: pr.missing });
	}

	return { page, files: files.map((x) => x.f), busDefined, sends, listens, unlistens, S, L, U, defects, pairedByPattern, blind, shown, where };
};

// ---------------------------------------------------------------------------------------------
// Rapport

const results = pages.map(analysePage).filter((r) => r.sends.length || r.listens.length || r.unlistens.length || r.blind.length || r.busDefined.length);
const KINDS = ['sans-auditeur', 'sans-emetteur', 'retrait-sans-ajout', 'trou-hors-balisage'];
const LABEL = {
	'sans-auditeur': 'envoyes, personne n\'ecoute',
	'sans-emetteur': 'ecoutes, personne n\'envoie',
	'retrait-sans-ajout': 'retires, jamais ajoutes',
	'trou-hors-balisage': 'trou de motif hors du balisage',
};

const l = [];
l.push('APPARIEMENT DES EVENEMENTS INTERNES — ' + BUS + '.' + SEND + ' / ' + LISTEN + ' / ' + UNLISTEN);
l.push('');
let total = 0;
let blindTotal = 0;
const json = { total: 0, pages: {}, angles_morts: 0 };
const failures = [];

if (!results.length) failures.push('aucune page n\'utilise ' + BUS + ' : rien n\'est verifie');

for (const r of results) {
	const { page, shown, where } = r;
	l.push('== ' + page.html + ' ==');
	l.push('   scripts : ' + r.files.join(' '));
	l.push('   ' + BUS + ' defini dans : ' + (r.busDefined.join(' ') || 'AUCUN SCRIPT DE LA PAGE'));
	l.push('   appels  : ' + r.sends.length + ' ' + SEND + ', ' + r.listens.length + ' ' + LISTEN + ', ' + r.unlistens.length + ' ' + UNLISTEN);
	l.push('');
	if (!r.busDefined.length) failures.push(page.html + ' appelle ' + BUS + ' sans charger de script qui le definit');
	if (r.sends.length === 0 || r.listens.length === 0) {
		failures.push(page.html + ' : aucun ' + (r.sends.length ? LISTEN : SEND) + ' releve — le bus a-t-il ete renomme ?');
	}

	// Table des noms : qui envoie, qui ecoute.
	const names = new Map();
	const note = (e, role) => {
		const k = shown(e.name);
		if (!names.has(k)) names.set(k, { send: [], listen: [], unlisten: [] });
		names.get(k)[role].push(where(e));
	};
	r.S.forEach((e) => note(e, 'send'));
	r.L.forEach((e) => note(e, 'listen'));
	r.U.forEach((e) => note(e, 'unlisten'));
	l.push('   ' + 'nom'.padEnd(44) + 'envoye  ecoute  retire');
	for (const k of [...names.keys()].sort()) {
		const n = names.get(k);
		l.push('   ' + k.padEnd(44) + String(n.send.length).padStart(6) + String(n.listen.length).padStart(8) + String(n.unlisten.length).padStart(8));
	}
	l.push('');

	l.push('   appariements par motif :');
	const seenPair = new Set();
	for (const pr of r.pairedByPattern) {
		const key = shown(pr.a.name) + ' ~ ' + shown(pr.b.name);
		if (seenPair.has(key)) continue;
		seenPair.add(key);
		const verdict = pr.unchecked ? 'deux motifs : non verifiable'
			: pr.missing.length ? 'TROU HORS DU BALISAGE : ' + pr.missing.join(' ')
				: 'trou = id ' + pr.holes.join(' ');
		l.push('      ' + key.padEnd(62) + '  ' + verdict);
	}
	l.push('');

	const pageJson = {};
	for (const k of KINDS) {
		const list = r.defects[k];
		pageJson[k] = [...new Set(list.map((e) => shown(e.name)))].sort();
		total += list.length;
		if (!list.length) continue;
		l.push('   ' + LABEL[k] + ' : ' + list.length);
		for (const e of list) {
			const extra = e.missing ? '   motif ' + shown(e.pattern.name) + ' (' + where(e.pattern) + '), ni id : ' + e.missing.join(' ') : '';
			l.push('      ' + shown(e.name).padEnd(44) + where(e).padEnd(18) + e.code + extra);
		}
		l.push('');
	}
	json.pages[page.html] = pageJson;

	if (r.blind.length) {
		l.push('   angles morts : ' + r.blind.length);
		for (const b of r.blind) l.push('      ' + (b.file + ':' + b.line).padEnd(18) + b.how.padEnd(40) + b.code);
		l.push('');
	}
	blindTotal += r.blind.length;
}

json.total = total;
json.angles_morts = blindTotal;
l.push('ANGLES MORTS                : ' + blindTotal);
l.push('TOTAL DEFAUTS D\'APPARIEMENT : ' + total);
for (const f of failures) l.push('ECHEC : ' + f);

fs.writeFileSync(OUT, l.join('\n') + '\n', 'utf8');
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(json, null, 1), 'utf8');

for (const r of results) {
	console.log(r.page.html + ' : ' + r.sends.length + ' envois, ' + r.listens.length + ' ecoutes, ' + r.unlistens.length + ' retraits');
	for (const k of KINDS) if (r.defects[k].length) console.log('   ' + LABEL[k].padEnd(34) + r.defects[k].map((e) => r.shown(e.name)).join(' '));
}
for (const f of failures) console.log('ECHEC : ' + f);
console.log('angles morts : ' + blindTotal);
console.log('rapport : ' + OUT);
console.log('TOTAL DEFAUTS : ' + total);
// Un angle mort n'est pas un defaut prouve, mais un controle qui ne voit plus tout ne dit pas OK.
process.exit(total || blindTotal || failures.length ? 1 : 0);
