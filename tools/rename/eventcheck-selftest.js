'use strict';
/*
	Proves that eventcheck.js can fail.

	A check that reports zero on the tree proves nothing unless it is known to report something
	when a side is lost. Each case copies the extension into a temporary directory, breaks ONE
	thing, and requires eventcheck to report that exact name under that exact defect. Nothing in
	the repository is modified.

	Case 1 is the outage this check was written after: the sender's prefix inside a template
	literal renamed, the handler not.

	The last case goes the other way. A rename that moves BOTH sides must report nothing: a check
	that cries on every rename is a check nobody reads.

	Usage: node eventcheck-selftest.js      (exit 0 when every case behaves)
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = path.join(__dirname, 'eventcheck.js');
const COPY = /\.(html|css|js|json)$/i;
const PAGE = 'player.html';

/*
	[libelle, attendu, mutations]
	attendu : { defaut: [noms] } qui doivent apparaitre, ou { angles: true }, ou { rien: true }.
	mutation : [ou, motif, remplacement] ; le motif doit mordre quelque part, sinon le cas est
	invalide.

	**« ou » est un ensemble de fichiers candidats, pas un fichier.** La premiere version nommait
	player.js, et le premier module extrait de player.js l'a cassee : l'emetteur du gabarit
	window-opened-${...} avait simplement demenage dans modules/window.js. Les cas cherchent donc
	leur motif dans tous les scripts charges, et mordent la ou il se trouve. SCRIPTS pour les
	scripts, PAGES pour le balisage, un nom de fichier quand le cas porte precisement sur lui.
*/
const SCRIPTS = '*.js';
const PAGES = '*.html';
// Quatrieme element d'une modification : l'appliquer dans chaque fichier qui porte le motif, pas le premier.
const PARTOUT = true;
const CASES = [
	['panne documentee : prefixe du gabarit emetteur renomme seul',
		{ 'sans-emetteur': ['window-opened-mainmenu'] },
		[[SCRIPTS, /SendEvent\(`window-opened-\$\{/, 'SendEvent(`окно-открыто-${']]],
	/*
		PARTOUT depuis que deux modules emettent cet evenement : le lecteur du direct et celui de
		l'enregistrement. Muter le seul premier fichier laissait un emetteur debout, l'evenement
		gardait le sien, et le cas ne prouvait plus rien.
	*/
	['nom litteral renomme a l\'emission seulement',
		{ 'sans-emetteur': ['player-paused'] },
		[[SCRIPTS, /SendEvent\("player-paused"/g, 'SendEvent("player-pause"', PARTOUT]]],
	['nom litteral renomme a l\'ecoute seulement',
		{ 'sans-auditeur': ['fullscreen-changed'], 'sans-emetteur': ['fullscreen-change'] },
		[[SCRIPTS, /AddHandler\(\s*"fullscreen-changed"/, 'AddHandler("fullscreen-change"']]],
	['valeur de propriete sEvent renommee',
		{ 'sans-auditeur': ['settings-presetchanged-look'], 'sans-emetteur': ['settings-presetchanged-appearance'] },
		[[SCRIPTS, /sEvent: 'settings-presetchanged-appearance'/, "sEvent: 'settings-presetchanged-look'"]]],
	['argument de constructeur change (new NumberInput)',
		{ 'trou-hors-balisage': ['dragger-drag-opacityx'] },
		[[SCRIPTS, /new NumberInput\("nOpacity", 5, 0, "opacity"\)/, 'new NumberInput("nOpacity", 5, 0, "opacityx")']]],
	['id renomme au balisage seul, nom d\'evenement intact',
		{ 'trou-hors-balisage': ['window-opened-mainmenu'] },
		[[PAGES, /\bid=mainmenu\b/g, 'id=mainmenu2']]],
	['retrait sur un nom que plus personne n\'ajoute',
		{ 'retrait-sans-ajout': ['focus-state-changed'] },
		[[SCRIPTS, /RemoveHandler\(\s*"focus-statechanged"/, 'RemoveHandler("focus-state-changed"']]],
	['bus utilise indirectement',
		{ angles: true },
		[['channelbar.js', /$/, '\nconst fSendAlias = m_Events.SendEvent;\n']]],
	/*
		Un module extrait vit dans son propre fichier. Le controle doit le lire parce que la page le
		charge, et seulement pour cela : c'est ce qui permet a l'extraction de ne rien changer ici.
	*/
	['script ajoute a la page : lu parce que charge',
		{ 'sans-emetteur': ['ghost-event'] },
		[['player.html', /<script src=channelbar\.js defer><\/script>/, '$&\n<script src=ghost.js defer></script>'],
			['ghost.js', null, 'm_Events.AddHandler("ghost-event", () => {});\n']]],
	/*
		Un faux positif paye : suivre un parametre par le seul nom de son appele confondait les
		homonymes. m_Window a eu une fonction Show interne, m_Notification en exporte une, et les
		« m_Notification.Show("svg-fail") » se sont mis a fournir des noms de fenetre inventes. Le
		cas plante les deux cotes lui-meme : un module qui batit un nom d'evenement depuis son
		parametre, et un homonyme ailleurs qui n'a rien a voir. Rien ne doit apparaitre.
	*/
	['homonyme dans un autre module : aucun nom invente',
		{ rien: true },
		[['channelbar.js', /$/, [
			'',
			'const m_SondeEmetteur = (() => {',
			'\tfunction Diffuser(sQuoi) {',
			'\t\tm_Events.SendEvent(`sonde-ouverte-${sQuoi}`);',
			'\t}',
			'\tm_Events.AddHandler(\'sonde-ouverte-reelle\', () => {});',
			'\treturn { Diffuser };',
			'})();',
			'm_SondeEmetteur.Diffuser(\'reelle\');',
			'',
			'const m_SondeHomonyme = (() => {',
			'\tfunction Diffuser(sAutreChose) {',
			'\t\tdocument.title = sAutreChose;',
			'\t}',
			'\treturn { Diffuser };',
			'})();',
			'm_SondeHomonyme.Diffuser(\'ceci-n-est-pas-une-fenetre\');',
			'',
		].join('\n')]]],
	['renommage coherent des deux cotes : rien ne doit apparaitre',
		{ rien: true },
		// PARTOUT : un renommage coherent touche l'emetteur et l'ecouteur, qui vivent dans deux fichiers
		// depuis que les modules sont extraits. Mordre le premier fichier seulement casserait l'appariement.
		[[SCRIPTS, /"player-paused"/g, '"player-pause-toggled"', PARTOUT]]],
];

const pages = (dir) => fs.readdirSync(dir).filter((f) => /\.html$/i.test(f)).sort();
// Les scripts que les pages chargent, dans leur ordre : un module extrait suit son fichier.
const scriptsCharges = (dir) => {
	const out = [];
	for (const p of pages(dir)) {
		const text = fs.readFileSync(path.join(dir, p), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
		for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) {
			const f = m[1].replace(/^\.?\//, '');
			if (!out.includes(f) && fs.existsSync(path.join(dir, f))) out.push(f);
		}
	}
	return out;
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'eventcheck-selftest-'));

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

const check = (dir) => {
	const json = path.join(dir, 'ev.json');
	const r = spawnSync(process.execPath, [CHECK, '--root', dir, '--out', path.join(dir, 'ev.txt'), '--json', json], { encoding: 'utf8' });
	if (!fs.existsSync(json)) throw new Error('eventcheck.js n\'a rien produit :\n' + r.stdout + r.stderr);
	return { code: r.status, ...JSON.parse(fs.readFileSync(json, 'utf8')) };
};

let failures = 0;
try {
	const base = check(snapshot('base'));
	console.log('reference : ' + base.total + ' defaut(s), ' + base.angles_morts + ' angle(s) mort(s), sortie ' + base.code);
	if (base.total !== 0 || base.code !== 0) {
		console.log('La reference doit etre propre pour que chaque cas mesure sa seule casse.');
		failures++;
	}
	console.log('');
	CASES.forEach(([label, expected, edits], i) => {
		const dir = snapshot('case' + (i + 1));
		for (const [ou, re, to, bPartout] of edits) {
			if (re === null) { fs.writeFileSync(path.join(dir, ou), to, 'utf8'); continue; }
			const candidats = ou === SCRIPTS ? scriptsCharges(dir) : ou === PAGES ? pages(dir) : [ou];
			let mordu = false;
			for (const f of candidats) {
				const p = path.join(dir, f);
				const before = fs.readFileSync(p, 'utf8');
				const after = before.replace(re, to);
				if (after === before) continue;
				fs.writeFileSync(p, after, 'utf8');
				mordu = true;
				if (!bPartout) break;
			}
			if (!mordu) {
				console.log('  INVALIDE  ' + (i + 1) + '. ' + label + ' — ' + re + ' ne se trouve dans aucun de : ' + candidats.join(' '));
				failures++;
				return;
			}
		}
		const res = check(dir);
		const got = res.pages[PAGE] || {};
		let ok;
		let detail;
		if (expected.rien) {
			ok = res.total === 0 && res.code === 0 && res.angles_morts === base.angles_morts;
			detail = 'attendu : rien, obtenu : ' + res.total + ' defaut(s)';
		} else if (expected.angles) {
			ok = res.angles_morts > base.angles_morts && res.code === 1;
			detail = 'attendu : un angle mort de plus, obtenu : ' + res.angles_morts;
		} else {
			const missing = [];
			for (const [kind, names] of Object.entries(expected)) {
				for (const n of names) if (!(got[kind] || []).includes(n)) missing.push(kind + ' ' + n);
			}
			ok = missing.length === 0 && res.code === 1;
			detail = 'manque : ' + (missing.join(', ') || '(sortie ' + res.code + ')') + ' ; obtenu : ' + JSON.stringify(got);
		}
		if (!ok) failures++;
		console.log('  ' + (ok ? 'VU      ' : 'RATE    ') + '  ' + String(i + 1).padStart(2) + '. ' + label.padEnd(62)
			+ base.total + ' -> ' + res.total + (ok ? '' : '\n              ' + detail));
	});
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
console.log('');
console.log(failures ? failures + ' cas en defaut : eventcheck.js ne garde plus les evenements.' : 'Tous les cas se comportent comme attendu.');
process.exit(failures ? 1 : 0);
