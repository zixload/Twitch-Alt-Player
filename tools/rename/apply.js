'use strict';
/*
	Renames declared bindings, by scope analysis, as surgical edits to the original text.

	Two choices worth stating, because the obvious alternatives are wrong here.

	It does NOT regenerate the file from the AST. @babel/generator would reprint all 9000 lines,
	reflow the formatting and drop nothing but move everything — the diff would be unreviewable and
	the commented-out English translations would be reshuffled. So Babel is used only to find out
	*which* character ranges belong to which binding, and the edits are applied to the original
	bytes, right to left. Everything not renamed stays byte for byte identical.

	It only touches real bindings. A property name (`o.Получить`), a DOM id inside a string and a
	settings key all look like the same word to a text replacer, and all three break differently:
	the property breaks at its call sites in other files, the DOM id breaks against player.html,
	and the settings key silently resets the user's settings. Those are handled elsewhere, on
	purpose, not here.

	Verification is not optional: the file is reparsed afterwards and the two syntax trees must
	have exactly the same shape, node for node. If a rename had swallowed a token, the shapes
	would differ and the run fails.

	Usage: node apply.js <map.json> <file.js> [...]      (add --dry to only report)
*/
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const DRY = process.argv.includes('--dry');
const args = process.argv.slice(2).filter((a) => a !== '--dry');
const MAP_PATH = args[0];
const FILES = args.slice(1);

if (!MAP_PATH || !FILES.length) {
	console.error('usage: node apply.js <map.json> <file.js> [...] [--dry]');
	process.exit(2);
}
/*
	A real Map, never a plain object.

	The keys are identifier names taken straight from the source, and the source contains names
	like hasOwnProperty, constructor and toString. Looking one of those up on a plain object does
	not give undefined: it gives the method inherited from Object.prototype, which is truthy. The
	first run duly rewrote `x.hasOwnProperty(...)` into the literal text of the native function,
	and three files stopped parsing. A Map has no prototype chain to fall through.
*/
const MAP = new Map(Object.entries(JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))));

function parse(src) {
	return parser.parse(src, {
		sourceType: 'script',
		allowReturnOutsideFunction: true,
		ranges: true,
		errorRecovery: true,
	});
}

// The shape of the tree, with every name blanked out. Renaming may change names and nothing else.
function shape(ast) {
	const out = [];
	const walk = (node) => {
		if (!node || typeof node.type !== 'string') return;
		out.push(node.type);
		for (const key of Object.keys(node)) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
			const v = node[key];
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
		}
	};
	walk(ast.program);
	return out.join('|');
}

/*
	The shared global namespace.

	common.js, player.js, content.js and sidebar.js are classic scripts, not modules, so every
	top-level declaration lands on `window` and the others read it straight off. 36 of the 48
	top-level names in common.js are used from other files — `Проверить`, `м_Журнал`, `Узел`, the
	side and volume constants. Renaming a file on its own would leave those callers pointing at a
	name that no longer exists, and nothing would complain until the player ran.

	So the whole project is renamed in one pass: a free reference to one of these names is renamed
	too. That is safe here precisely because the names are Cyrillic — no browser API, no library
	and no Twitch payload ever uses a Cyrillic identifier, so there is nothing to collide with.
*/
/*
	Names that are also written as strings somewhere in the project.

	`_oSettings` is indexed both ways: `_oSettings.чВерсияНастроек` as a property, and
	`Get2('чВерсияНастроек')` as a string. Rename the property alone and the object gains a key
	nobody looks up while the lookups find nothing — `Check(_oSettings.nSettingsVersion.pCurrent)`
	then fails and the player stops before it starts. The same holds for every settings key, every
	DOM id passed to Узел(), and every CSS class passed to classList.

	The rule has to be all or nothing. Sparing only the property accesses was not enough: the log
	method is picked dynamically by string — m_Log[n > 0 ? "Вот" : "Ой"](...) — and its declaration
	is a plain function, so renaming the binding alone rewrote the exported name to Here while 66
	call sites still asked for .Вот. A name written as a string anywhere therefore moves nowhere:
	not its binding, not its property, not its free references.

	These move later, in their own step, with the string and the identifier renamed together and a
	migration for the persisted ones.
*/
function collectStringNames(files) {
	const names = new Set();
	for (const file of files) {
		const ast = parse(fs.readFileSync(file, 'utf8'));
		traverse(ast, {
			StringLiteral(p) {
				const v = p.node.value;
				if (/[Ѐ-ӿ]/.test(v)) names.add(v);
			},
			TemplateElement(p) {
				const v = p.node.value && p.node.value.cooked;
				if (v && /[Ѐ-ӿ]/.test(v)) names.add(v);
			},
		});
	}
	return names;
}

/*
	Names that appear in the markup or the stylesheets.

	The settings schema is keyed by DOM element id: `m_Settings.Get(nodeButton.id)` reads the key
	straight off the element. So `_oSettings` and `player.html` have to agree letter for letter,
	and a schema key renamed on the JavaScript side alone stops matching the button that asks for
	it — Check(_oSettings.hasOwnProperty(sName)) fails and the player stops during start-up.

	Until the markup, the stylesheets and the script are renamed together in one coordinated step,
	anything written in an .html or .css file is off limits. Collected coarsely on purpose: every
	Cyrillic word in those files is spared, because over-sparing costs a later pass while
	under-sparing costs a player that does not start.
*/
function collectMarkupNames(dir) {
	const names = new Set();
	const files = fs.readdirSync(dir).filter((f) => /\.(html|css)$/i.test(f));
	for (const f of files) {
		const text = fs.readFileSync(path.join(dir, f), 'utf8');
		const m = text.match(/[Ѐ-ӿ][Ѐ-ӿA-Za-z0-9_$-]*/g) || [];
		for (const w of m) names.add(w);
	}
	return names;
}

function collectProjectGlobals(files) {
	const globals = new Set();
	for (const file of files) {
		const ast = parse(fs.readFileSync(file, 'utf8'));
		const program = ast.program;
		traverse(ast, {
			Program(p) {
				for (const name of Object.keys(p.scope.bindings)) globals.add(name);
				p.stop();
			},
		});
		void program;
	}
	return globals;
}

function run(file, projectGlobals, stringNames) {
	const src = fs.readFileSync(file, 'utf8');
	const ast = parse(src);

	const targets = new Map(); // binding.identifier node -> newName
	const edits = new Map(); // start offset -> edit, pour ne jamais ecrire deux fois la meme plage
	const blocked = [];
	const blockedNames = new Set();
	const renamed = new Map();
	const freeRenamed = new Map();
	const propRenamed = new Map();
	const skippedProps = new Set();

	// Pass 1: find the bindings we are allowed to rename, and refuse any whose new name is
	// already taken in the same scope — that would merge two different variables into one.
	traverse(ast, {
		Scope(p) {
			for (const name of Object.keys(p.scope.bindings)) {
				const to = MAP.get(name);
				if (!to) continue;
				if (stringNames.has(name)) {
					// Written as a string somewhere: see collectStringNames. Spared entirely.
					skippedProps.add(name);
					continue;
				}
				const binding = p.scope.bindings[name];
				if (targets.has(binding.identifier)) continue;
				if (p.scope.hasBinding(to) || p.scope.hasGlobal(to) || p.scope.hasReference(to)) {
					blocked.push(name + ' -> ' + to + ' (nom deja pris dans cette portee)');
					blockedNames.add(name);
					continue;
				}
				targets.set(binding.identifier, to);
			}
		},
	});

	// Is this identifier the *name* of a property rather than a reference to a variable?
	const isPropertyName = (p) => {
		const parent = p.parent;
		if (!parent || parent.computed) return false;
		if (parent.type === 'MemberExpression') return parent.property === p.node;
		if (parent.type === 'OptionalMemberExpression') return parent.property === p.node;
		return /^(ObjectProperty|ObjectMethod|ClassMethod|ClassProperty)$/.test(parent.type)
			&& parent.key === p.node;
	};

	/*
		Pass 2: three kinds of identifier, and getting any one of them wrong breaks the player.

		A reference to a binding we are renaming. A free reference to a name a sibling script
		declares at top level. And a property name.

		The property kind broke the first attempt. Every module here ends with
		`return { Получить, Установить }`, a shorthand object. Renaming only the binding rewrote
		the exported property name to `Get` while every caller still said `m_Settings.Получить`,
		so the whole player died on load — no syntax error, no warning, just a player that never
		started. The binding and the property have to move together, or neither moves.

		The second attempt died on a subtler one: `isReferencedIdentifier()` is false for the
		left-hand side of an assignment. `_мсЖурнал = new Array(1500)` is neither a read nor a
		declaration, so it stayed Cyrillic while its own declaration became `_msLog` — common.js
		threw on load, m_Log was never defined, and player.js died after it. Hence
		`isBindingIdentifier()`, which covers assignment targets, parameters and catch clauses.

		Shorthand properties put the key and the value at the very same character range, so edits
		are keyed by their start offset: the same range can only be written once.
	*/
	traverse(ast, {
		Identifier(p) {
			const node = p.node;
			const binding = p.scope.getBinding(node.name);
			let to = null;
			if (binding && targets.has(binding.identifier)
				&& (p.isReferencedIdentifier() || p.isBindingIdentifier()
					|| binding.identifier === node)) {
				to = targets.get(binding.identifier);
			} else if (!binding && MAP.has(node.name) && projectGlobals.has(node.name)
				&& !stringNames.has(node.name)
				&& (p.isReferencedIdentifier() || p.isBindingIdentifier())) {
				// Declared by a sibling script, read off `window` from here.
				to = MAP.get(node.name);
				freeRenamed.set(node.name, to);
			} else if (MAP.has(node.name) && isPropertyName(p)) {
				if (stringNames.has(node.name)) {
					// Indexed by string elsewhere: moving the property alone would orphan it.
					skippedProps.add(node.name);
					return;
				}
				to = MAP.get(node.name);
				propRenamed.set(node.name, to);
			}
			if (!to) return;
			edits.set(node.start, { start: node.start, end: node.end, from: node.name, to });
			renamed.set(node.name, to);
		},
	});

	let out = src;
	const ordered = [...edits.values()].sort((a, b) => b.start - a.start);
	for (const e of ordered) out = out.slice(0, e.start) + e.to + out.slice(e.end);

	// Verification: same tree shape, or we did more than rename.
	let ok = true, why = '';
	try {
		const after = parse(out);
		if (shape(ast) !== shape(after)) {
			ok = false;
			why = 'la forme de l’arbre a change';
		}
	} catch (e) {
		ok = false;
		why = 'le fichier ne reparse plus : ' + e.message;
	}

	/*
		The check that actually catches this class of bug.

		A tree-shape comparison passes happily on a file that parses and does not run: the second
		attempt produced ten files that all parsed, and a player that died on load because one
		assignment target had kept its Cyrillic name while its declaration had moved. Shape said
		yes, the extension said no.

		So: once the edits are in, no name the map knows about may still be present as an
		identifier. Names deliberately skipped for a scope collision are expected survivors and do
		not count.
	*/
	if (ok) {
		try {
			const after = parse(out);
			const survivors = new Set();
			traverse(after, {
				Identifier(p) {
					const n = p.node.name;
					if (MAP.has(n) && !blockedNames.has(n) && !skippedProps.has(n)) survivors.add(n);
				},
			});
			if (survivors.size) {
				ok = false;
				why = survivors.size + ' nom(s) de la carte survivent au renommage : '
					+ [...survivors].slice(0, 6).join(', ');
			}
		} catch (e) {
			ok = false;
			why = 'controle des survivants impossible : ' + e.message;
		}
	}

	// Nothing Cyrillic may survive inside a name we just wrote.
	for (const [, to] of renamed) {
		if (/[Ѐ-ӿ]/.test(to)) { ok = false; why = 'nom cible encore cyrillique : ' + to; }
	}

	// En cas d'echec, deposer la sortie fautive pour pouvoir la lire : un message de parseur
	// donne une position, pas une explication.
	if (!ok) fs.writeFileSync(path.join(__dirname, 'failed-' + path.basename(file)), out, 'utf8');
	if (ok && !DRY) fs.writeFileSync(file, out, 'utf8');

	return {
		file: path.basename(file),
		names: renamed.size,
		free: freeRenamed.size,
		edits: edits.size,
		props: propRenamed.size,
		skipped: skippedProps.size,
		blocked,
		ok,
		why,
		bytesBefore: Buffer.byteLength(src),
		bytesAfter: Buffer.byteLength(out),
	};
}

const projectGlobals = collectProjectGlobals(FILES);
const stringNames = collectStringNames(FILES);
for (const n of collectMarkupNames(path.dirname(path.resolve(FILES[0])))) stringNames.add(n);
let failed = 0;
const lines = [];
lines.push('espace de noms partage : ' + projectGlobals.size + ' declarations de haut niveau');
lines.push('noms epargnes (chaines JS + balisage + feuilles de style) : ' + stringNames.size);
for (const f of FILES) {
	const r = run(f, projectGlobals, stringNames);
	lines.push('');
	lines.push('=== ' + r.file + (DRY ? '   (essai a blanc)' : '') + ' ===');
	lines.push('  noms renommes     : ' + r.names);
	lines.push('  occurrences       : ' + r.edits);
	lines.push('  dont globales d’un autre fichier : ' + r.free);
	lines.push('  dont noms de propriete           : ' + r.props);
	lines.push('  proprietes epargnees (indexees par chaine) : ' + r.skipped);
	lines.push('  refuses (collision): ' + r.blocked.length);
	for (const b of r.blocked) lines.push('      ' + b);
	lines.push('  verification      : ' + (r.ok ? 'OK, meme arbre a l’identique' : 'ECHEC — ' + r.why));
	if (!r.ok) failed++;
}
const text = lines.join('\n');
fs.writeFileSync(path.join(__dirname, 'apply-report.txt'), text, 'utf8');
console.log(text);
process.exit(failed ? 1 : 0);
