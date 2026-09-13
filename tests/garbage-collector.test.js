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

	This suite is written BEFORE the module is rewritten. It is the description the rewrite has to
	satisfy, not a report on the old code.

	ONE CASE READS manifest.json. The module keeps a second, older flavour that hands buffers to a
	worker thread, chosen when the browser engine is below 67. The manifest requires Chrome 92, and
	MV3 itself requires 88, so that flavour cannot run in any browser able to load this extension:
	`recycler.js` is a whole file kept alive by an unreachable branch. Case 5 pins that down from
	the manifest, so that the day someone lowers the floor below 67 the test says so instead of
	quietly resurrecting dead code.

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
	// L'etiquette du journal n'est pas verifiee : elle dit « Recycler » alors que le module
	// s'appelle GarbageCollector, et la reecriture a le droit de trancher.
	ok(asJournal.some(s => s.includes('4096')), 'la taille jetee est portee au journal');
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

titre('3. Burn');
cas(() => {
	const { G } = charger();
	ok(typeof G.Burn == 'function', 'Burn existe dans les deux saveurs');
	ok(!leve(() => G.Burn()), 'et ne fait rien de visible sur celle-ci');
	const auOctets = new Uint8Array(512);
	G.Discard(auOctets);
	G.Burn();
	ok(auOctets.byteLength === 0, 'la memoire jetee avant reste jetee apres');
});

titre('4. Sur mobile, le module s efface');
cas(() => {
	const { G, asJournal } = charger({ bMobile: true });
	const auOctets = new Uint8Array(4096);
	G.Discard(auOctets);
	ok(auOctets.byteLength === 4096,
		'rien n est detache : sur mobile le module ne fait deliberement rien');
	ok(asJournal.length === 0, 'et ne dit rien');
	ok(!leve(() => G.Burn()), 'Burn reste appelable');
});

titre('5. La saveur a fil de travail est hors de portee');
cas(() => {
	const oManifest = JSON.parse(fs.readFileSync(path.join(RACINE, 'manifest.json'), 'utf8'));
	const nPlancher = Number.parseInt(oManifest.minimum_chrome_version, 10);
	ok(oManifest.manifest_version === 3 && nPlancher >= 67,
		`manifest.json : MV3 et Chrome ${nPlancher} minimum, donc la branche « < 67 » est morte`);
	const { G, aoWorkers } = charger({ nVersion: nPlancher });
	G.Discard(new Uint8Array(1024));
	ok(aoWorkers.length === 0,
		'au plancher de version declare, aucun Worker n est cree : recycler.js ne sert plus');
});

for (const oPort of aoPortsOuverts) {
	oPort.close();
}
console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);
