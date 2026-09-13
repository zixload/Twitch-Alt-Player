'use strict';
/*
	Unit test for m_Events, run without a browser.

	m_Events is the switchboard: every module announces what it did through it, and every other
	module hears about it there. `eventcheck.js` already proves that each event name has a sender
	and a listener. Nothing proves what the dispatcher itself does -- and that is where the
	surprises live: two shapes of handler, a shared event object, and what happens when a handler
	adds or removes a handler while the dispatch is running.

	This suite is written BEFORE the module is rewritten, on purpose. It is the description that
	the rewrite has to satisfy: read it as the specification, not as a report on the old code.

	THE RE-ENTRANCY CASES PIN CURRENT BEHAVIOUR, THEY DO NOT BLESS IT. A handler that adds another
	handler for the same event has the new one run in the same dispatch, because the loop walks the
	live Set. Anyone rewriting this into `[...set].forEach(...)` changes that silently, which is
	why it is nailed down here: the change may well be right, but it has to be a decision.

	The module is found by name in whichever file currently holds it, so an extraction into
	modules/ does not break the suite.

	Usage: node tests/events.test.js [chemin/vers/le/fichier]
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const CANDIDATS = [ 'modules/events.js', 'player.js' ];
const DEBUT = 'const m_Events = (() => {';
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
	console.error(`m_Events introuvable dans : ${CANDIDATS.join(', ')}`);
	process.exit(2);
}

const sSource = trouverSource();
const src = fs.readFileSync(sSource, 'utf8');
const nDebut = src.indexOf(DEBUT);
const nFin = src.indexOf(FIN, nDebut);
if (nDebut === -1 || nFin === -1) {
	console.error(`m_Events mal delimite dans ${sSource}`);
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

function charger() {
	const asJournal = [];
	const ctx = {
		console, JSON, Object, Set, Map, String, Error,
		Check: pCondition => { if (!pCondition) { throw new Error('Check failed'); } },
		IsNonEmptyString: pValue => typeof pValue == 'string' && pValue.length !== 0,
		IsObject: pValue => pValue !== null && typeof pValue == 'object',
		m_Log: { Here: sText => asJournal.push(sText) }
	};
	vm.createContext(ctx);
	vm.runInContext(`${module_}\nthis.m_Events = m_Events;`, ctx);
	return { E: ctx.m_Events, asJournal };
}

// Un « leve-t-il ? » lisible : rend true quand l'appel a jete.
function leve(fCorps) {
	try {
		fCorps();
		return false;
	} catch (pException) {
		return true;
	}
}

titre(`source : ${path.relative(RACINE, sSource)}`);

titre('1. Une fonction en guise d ecouteur');
cas(() => {
	const { E, asJournal } = charger();
	const aoRecu = [];
	E.AddHandler('essai', (pData, sEvent) => aoRecu.push([ pData, sEvent ]));
	E.SendEvent('essai', 42);
	ok(aoRecu.length === 1, 'l ecouteur est appele une fois');
	ok(aoRecu[0][0] === 42, 'il recoit la donnee');
	ok(aoRecu[0][1] === 'essai', 'et le nom de l evenement, pour les ecouteurs partages');
	ok(asJournal.some(s => s.includes('essai')), 'l envoi laisse une trace au journal');
});
cas(() => {
	const { E } = charger();
	let pRecu = 'pas touche';
	E.AddHandler('essai', pData => { pRecu = pData; });
	E.SendEvent('essai');
	ok(pRecu === void 0, 'un evenement sans donnee en passe une indefinie, pas une absence');
});

titre('2. Plusieurs ecouteurs');
cas(() => {
	const { E } = charger();
	const asOrdre = [];
	E.AddHandler('essai', () => asOrdre.push('a'));
	E.AddHandler('essai', () => asOrdre.push('b'));
	E.AddHandler('essai', () => asOrdre.push('c'));
	E.SendEvent('essai');
	ok(asOrdre.join('') === 'abc', 'ils partent dans l ordre ou ils se sont inscrits');
});
cas(() => {
	const { E } = charger();
	let nAppels = 0;
	const fEcouteur = () => { nAppels++; };
	E.AddHandler('essai', fEcouteur);
	E.AddHandler('essai', fEcouteur);
	E.SendEvent('essai');
	ok(nAppels === 1, 'le meme ecouteur inscrit deux fois ne part qu une fois');
});
cas(() => {
	const { E } = charger();
	const asVus = [];
	E.AddHandler('un', () => asVus.push('un'));
	E.AddHandler('deux', () => asVus.push('deux'));
	E.SendEvent('deux');
	ok(asVus.join('') === 'deux', 'un envoi ne reveille que son propre evenement');
});

titre('3. Un objet en guise d ecouteur');
cas(() => {
	const { E } = charger();
	const aoRecu = [];
	E.AddHandler('essai', { handleEvent: oEvent => aoRecu.push(oEvent) });
	E.SendEvent('essai', 'charge');
	ok(aoRecu.length === 1, 'handleEvent est appele');
	ok(aoRecu[0].type === 'essai' && aoRecu[0].data === 'charge',
		'il recoit un seul objet, { type, data }');
});
cas(() => {
	const { E } = charger();
	const aoRecu = [];
	const faire = () => ({ handleEvent: oEvent => aoRecu.push(oEvent) });
	E.AddHandler('essai', faire());
	E.AddHandler('essai', faire());
	E.SendEvent('essai', 1);
	ok(aoRecu.length === 2, 'les deux objets sont servis');
	ok(aoRecu[0] === aoRecu[1],
		'et partagent le MEME objet d evenement : le modifier depuis un ecouteur atteint les suivants');
});
cas(() => {
	const { E } = charger();
	let nArguments = -1;
	E.AddHandler('essai', { handleEvent: function () { nArguments = arguments.length; } });
	E.SendEvent('essai', 1);
	ok(nArguments === 1, 'un objet ne recoit pas la paire (donnee, nom) reservee aux fonctions');
});

titre('4. Retrait');
cas(() => {
	const { E } = charger();
	let nAppels = 0;
	const fEcouteur = () => { nAppels++; };
	E.AddHandler('essai', fEcouteur);
	E.RemoveHandler('essai', fEcouteur);
	E.SendEvent('essai');
	ok(nAppels === 0, 'un ecouteur retire ne part plus');
});
cas(() => {
	const { E } = charger();
	let nB = 0;
	const fA = () => {};
	E.AddHandler('essai', fA);
	E.AddHandler('essai', () => { nB++; });
	E.RemoveHandler('essai', fA);
	E.SendEvent('essai');
	ok(nB === 1, 'retirer l un ne retire pas l autre');
});
cas(() => {
	const { E } = charger();
	const fEcouteur = () => {};
	E.AddHandler('essai', fEcouteur);
	E.RemoveHandler('essai', fEcouteur);
	/*
		Le dernier retire, l'entree de l'evenement doit disparaitre et non rester vide : SendEvent
		exige qu'une entree trouvee porte au moins un ecouteur. Une entree vide survivante ferait
		lever ici, et nulle part ailleurs.
	*/
	ok(!leve(() => E.SendEvent('essai')), 'le dernier retire, l entree de l evenement disparait');
});
cas(() => {
	const { E } = charger();
	ok(!leve(() => E.RemoveHandler('jamais-inscrit', () => {})),
		'retirer un ecouteur jamais inscrit ne fait rien');
	ok(!leve(() => E.SendEvent('personne-n-ecoute')),
		'envoyer un evenement que personne n ecoute ne fait rien non plus');
});

titre('5. Ce qui est refuse');
cas(() => {
	const { E } = charger();
	ok(leve(() => E.AddHandler('', () => {})), 'un nom d evenement vide est refuse');
	ok(leve(() => E.AddHandler('essai', 'pas un ecouteur')), 'une chaine n est pas un ecouteur');
	ok(leve(() => E.AddHandler('essai', null)), 'null non plus');
	ok(leve(() => E.SendEvent('')), 'un envoi sans nom est refuse');
});

titre('6. Un ecouteur qui touche a la liste pendant l envoi');
cas(() => {
	const { E } = charger();
	const asOrdre = [];
	const fSeRetire = () => {
		asOrdre.push('a');
		E.RemoveHandler('essai', fSeRetire);
	};
	E.AddHandler('essai', fSeRetire);
	E.AddHandler('essai', () => asOrdre.push('b'));
	E.SendEvent('essai');
	ok(asOrdre.join('') === 'ab', 'un ecouteur qui se retire lui-meme laisse partir les suivants');
	asOrdre.length = 0;
	E.SendEvent('essai');
	ok(asOrdre.join('') === 'b', 'et ne repart pas a l envoi suivant');
});
cas(() => {
	const { E } = charger();
	const asOrdre = [];
	const fB = () => asOrdre.push('b');
	E.AddHandler('essai', () => {
		asOrdre.push('a');
		E.RemoveHandler('essai', fB);
	});
	E.AddHandler('essai', fB);
	E.SendEvent('essai');
	ok(asOrdre.join('') === 'a',
		'un ecouteur retire pendant l envoi, avant son tour, ne part pas');
});
cas(() => {
	const { E } = charger();
	const asOrdre = [];
	E.AddHandler('essai', () => {
		asOrdre.push('a');
		E.AddHandler('essai', () => asOrdre.push('c'));
	});
	E.AddHandler('essai', () => asOrdre.push('b'));
	E.SendEvent('essai');
	// Comportement constate, epingle pour qu une reecriture le change sciemment ou pas du tout.
	ok(asOrdre.join('') === 'abc',
		'un ecouteur inscrit PENDANT l envoi part dans le meme envoi');
});

titre('7. Envois imbriques');
cas(() => {
	const { E } = charger();
	const asOrdre = [];
	E.AddHandler('dehors', () => {
		asOrdre.push('dehors-debut');
		E.SendEvent('dedans');
		asOrdre.push('dehors-fin');
	});
	E.AddHandler('dedans', () => asOrdre.push('dedans'));
	E.SendEvent('dehors');
	ok(asOrdre.join(' ') === 'dehors-debut dedans dehors-fin',
		'un envoi depuis un ecouteur se deroule tout de suite, pas apres');
});

console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);
