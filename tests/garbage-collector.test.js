'use strict';
/*
	Unit test for m_GarbageCollector, run without a browser.

	The module exists for one reason: a video buffer freed the ordinary way waits for the garbage
	collector, and by then the next few seconds of stream have already been allocated. So it hands
	each discarded buffer to a MessagePort with a transfer list, which DETACHES it -- the memory is
	released at that instant, deterministically, on a player that runs for hours.

	That is the whole contract, and it is invisible from outside: drop the transfer list and the
	buffer is merely copied. Nothing throws, nothing is logged, the stream plays -- and the player
	leaks a few megabytes a minute. The browser harness cannot see it. This can:
	`byteLength === 0` after the call, or the contract is broken.

	Node implements the same transfer semantics, so the assertions here are the real thing and not
	an imitation.

	This suite was written BEFORE the module was rewritten, as the description the rewrite had to
	satisfy. The rewrite changed two parts of it on purpose, and the cases say so where they stand:
	the worker-thread flavour and recycler.js are gone, and Burn() went with them.

	Usage: node tests/garbage-collector.test.js [chemin/vers/le/fichier]
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MessageChannel } = require('worker_threads');

const RACINE = path.join(__dirname, '..');
const CANDIDATS = [ 'modules/garbage-collector.js', 'player.js' ];
const DEBUT = 'const m_GarbageCollector = (() => {';
const FIN = '\n})();';

function trouverSource() {
	if (process.argv[2]) {
		return process.argv[2];
	}
	for (const sNom of CANDIDATS) {
		const sChemin = path.join(RACINE, sNom);
		if (fs.existsSync(sChemin) && fs.readFileSync(sChemin, 'utf8').includes(DEBUT)) {
			return sChemin;
		}
	}
	console.error(`m_GarbageCollector introuvable dans : ${CANDIDATS.join(', ')}`);
	process.exit(2);
}

const sSource = trouverSource();
const src = fs.readFileSync(sSource, 'utf8');
const nDebut = src.indexOf(DEBUT);
const nFin = src.indexOf(FIN, nDebut);
if (nDebut === -1 || nFin === -1) {
	console.error(`m_GarbageCollector mal delimite dans ${sSource}`);
	process.exit(2);
}
const module_ = src.slice(nDebut, nFin + FIN.length);

let nEchecs = 0;
const ok = (bCondition, sMessage) => {
	console.log(`${bCondition ? '  ok    ' : '  ECHEC '}${sMessage}`);
	if (!bCondition) { nEchecs++; }
};
const titre = sTexte => console.log(`\n${sTexte}`);
function cas(fCorps) {
	try {
		fCorps();
	} catch (pException) {
		ok(false, `exception : ${pException && pException.message}`);
	}
}
const leve = fCorps => {
	try {
		fCorps();
		return false;
	} catch (pException) {
		return true;
	}
};

// Les ports ouverts par le module empecheraient node de rendre la main.
const aoPortsOuverts = [];

function charger({ nVersion = 92, bMobile = false } = {}) {
	const asJournal = [];
	const aoWorkers = [];
	const ctx = {
		console, JSON, Object, Math, Set, Map, String, Error,
		IsObject: pValue => pValue !== null && typeof pValue == 'object',
		STUB: () => {},
		isMobileDevice: () => bMobile,
		getBrowserEngineVersion: () => nVersion,
		m_Log: { Here: sText => asJournal.push(sText) },
		m_Events: { AddHandler: () => {} },
		STATE_BROADCAST_END: 7,
		STATE_STOP: 8,
		STATE_REPEAT: 9,
		MessageChannel: class {
			constructor() {
				const oChannel = new MessageChannel();
				aoPortsOuverts.push(oChannel.port1, oChannel.port2);
				this.port1 = oChannel.port1;
				this.port2 = oChannel.port2;
			}
		},
		Worker: class {
			constructor(sUrl) {
				aoWorkers.push(sUrl);
			}
			postMessage() {}
		}
	};
	vm.createContext(ctx);
	vm.runInContext(`${module_}\nthis.m_GarbageCollector = m_GarbageCollector;`, ctx);
	return { G: ctx.m_GarbageCollector, asJournal, aoWorkers };
}

titre(`source : ${path.relative(RACINE, sSource)}`);

titre('1. Ce que jeter veut dire : la memoire part tout de suite');
cas(() => {
	const { G } = charger();
	const auOctets = new Uint8Array(4096);
	ok(auOctets.byteLength === 4096, 'le tampon est plein avant');
	G.Discard(auOctets);
	ok(auOctets.byteLength === 0,
		'apres, il est DETACHE -- sans cela le lecteur fuit sans que rien ne le signale');
	ok(auOctets.buffer.byteLength === 0, 'le tampon sous-jacent aussi');
});
cas(() => {
	const { G } = charger();
	const bufOctets = new ArrayBuffer(2048);
	G.Discard(bufOctets);
	ok(bufOctets.byteLength === 0, 'un ArrayBuffer nu est accepte tel quel, sans vue autour');
});
cas(() => {
	const { G } = charger();
	const au1 = new Uint8Array(1024);
	const au2 = new Uint8Array(1024);
	G.Discard(au1);
	G.Discard(au2);
	ok(au1.byteLength === 0 && au2.byteLength === 0,
		'le second passage marche autant que le premier : le canal se reutilise');
});
cas(() => {
	const { G, asJournal } = charger();
	G.Discard(new Uint8Array(4096));
	ok(asJournal.some(s => s.includes('4096')), 'la taille jetee est portee au journal');
	ok(asJournal.some(s => s.includes('[GarbageCollector]')),
		'sous le nom du module -- l ancienne etiquette disait « Recycler »');
});

titre('2. Ce qui n est pas un tampon');
cas(() => {
	const { G, asJournal } = charger();
	ok(!leve(() => G.Discard(null)), 'null ne fait rien');
	ok(!leve(() => G.Discard(void 0)), 'rien du tout non plus');
	ok(!leve(() => G.Discard(42)), 'un nombre non plus');
	ok(!leve(() => G.Discard('abc')), 'une chaine non plus');
	ok(!leve(() => G.Discard({})), 'un objet sans tampon non plus');
	ok(asJournal.length === 0, 'et aucun de ces cas ne salit le journal');
});
cas(() => {
	const { G, asJournal } = charger();
	ok(!leve(() => G.Discard(new Uint8Array(0))), 'un tampon vide ne fait rien');
	ok(asJournal.length === 0, 'et ne compte pas comme une liberation');
});

titre('3. Burn n existe plus');
/*
	Burn() servait a la saveur a fil de travail, qui terminait le fil pour vider sa poubelle. Dans
	toutes les configurations capables de tourner, c'etait une fonction vide appelee une fois, a
	l'arret. Partie avec la saveur ; l'appel dans Terminate aussi.
*/
cas(() => {
	const { G } = charger();
	ok(G.Burn === void 0, 'l interface ne l expose plus');
	ok(Object.keys(G).join(' ') === 'Discard', 'Discard est le seul membre');
});

titre('4. Sur mobile, le module s efface');
cas(() => {
	const { G, asJournal } = charger({ bMobile: true });
	const auOctets = new Uint8Array(4096);
	G.Discard(auOctets);
	ok(auOctets.byteLength === 4096,
		'rien n est detache : sur mobile le module ne fait deliberement rien');
	ok(asJournal.length === 0, 'et ne dit rien');
	ok(Object.keys(G).join(' ') === 'Discard', 'meme interface qu ailleurs');
});

titre('5. Plus aucun fil de travail, quelle que soit la version');
/*
	La saveur retiree etait choisie sous Chrome 67, et recycler.js n'etait charge que par elle. Le
	module ne lit plus la version du navigateur : ce cas le fait tourner sous une version tres
	ancienne et une recente, et exige que le meme chemin serve et qu'aucun Worker ne naisse.
*/
cas(() => {
	for (const nVersion of [ 50, 150 ]) {
		const { G, aoWorkers } = charger({ nVersion });
		const auOctets = new Uint8Array(1024);
		G.Discard(auOctets);
		ok(aoWorkers.length === 0 && auOctets.byteLength === 0,
			`version ${nVersion} : detache par le port, aucun Worker cree`);
	}
	ok(!fs.existsSync(path.join(RACINE, 'recycler.js')), 'recycler.js n est plus dans l arbre');
});

for (const oPort of aoPortsOuverts) {
	oPort.close();
}
console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);
