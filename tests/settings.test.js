'use strict';
/*
	Unit test for m_Settings, run without a browser.

	The browser harness can only see a setting that shows on screen, and it sees it through the
	whole player. Most of what this module decides never reaches a pixel: which of two values a
	preset lets through, what a migration carries over, what a deferred write ends up containing,
	what happens to a store written by a version that does not exist yet. Those decisions are
	where a silent loss of settings would come from, so they are tested here, directly.

	The module is loaded with the real prelude of common.js -- the real bounds, the real Check,
	the real m_Log -- and a fake browser underneath: a store that is a plain object, a timer that
	only fires when told to, and two <select> elements that record what was put in them.

	One trap is worth naming, because it cost a false accusation in the browser harness already:
	READING BACK A SETTING GOVERNED BY A PRESET DOES NOT SHOW WHAT WAS STORED. Get returns the
	preset's value. Case 4 below asserts exactly that, and the migration cases that touch such a
	setting read pCurrent through GetSettingParameters instead.

	Every case runs inside its own guard. A module broken in one place tends to throw somewhere
	well away from the break, and a suite that died on the first throw would report one accident
	instead of the list of everything that stopped working -- which is the list worth reading.

	Usage: node tests/settings.test.js [chemin/vers/common.js]
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Le chemin peut etre donne en argument : settings-selftest.js s'en sert pour lancer la suite
// contre des copies abimees expres, et verifier qu'elle les attrape.
const sSource = process.argv[2] || path.join(__dirname, '..', 'common.js');
const src = fs.readFileSync(sSource, 'utf8');

function tranche(sDebut, sFin) {
	const nDebut = src.indexOf(sDebut);
	if (nDebut === -1) {
		console.error(`introuvable dans common.js : ${sDebut}`);
		process.exit(2);
	}
	const nFin = src.indexOf(sFin, nDebut);
	if (nFin === -1) {
		console.error(`fin introuvable apres : ${sDebut}`);
		process.exit(2);
	}
	return src.slice(nDebut, nFin + sFin.length);
}

// Les constantes et les aides de common.js, puis m_Log, puis le module teste. Pris dans le
// fichier et non recopies : une borne qui change dans le code change ici aussi.
const prelude = tranche('const DO_NOT_REDIRECT_ADDRESS', 'const m_Log = (() => {').slice(0, -'const m_Log = (() => {'.length);
const journal = tranche('const m_Log = (() => {', '\n})();');
const module_ = tranche('const m_Settings = (() => {', '\n})();');

let nEchecs = 0;
const ok = (bCondition, sMessage) => {
	console.log(`${bCondition ? '  ok    ' : '  ECHEC '}${sMessage}`);
	if (!bCondition) { nEchecs++; }
};
const titre = sTexte => console.log(`\n${sTexte}`);
// Un cas qui explose est un cas en echec, pas une fin de suite.
async function cas(fCorps) {
	try {
		await fCorps();
	} catch (pException) {
		ok(false, `exception : ${pException && pException.message}`);
	}
}

class FausseOption {
	constructor(sTexte, sValeur, bParDefaut, bSelectionnee) {
		this.text = sTexte;
		this.value = sValeur;
		this.defaultSelected = bParDefaut;
		this.selected = bSelectionnee;
	}
}

class FausseListe {
	constructor(sId) {
		this.id = sId;
		this.nodeType = 1;
		this.aoOptions = [];
		this.value = '';
		this.asEcouteurs = [];
	}
	get length() {
		return this.aoOptions.length;
	}
	set length(n) {
		// Le module ne s'en sert que pour vider la liste avant de la reconstruire.
		this.aoOptions.length = n;
		if (n === 0) {
			this.value = '';
		}
	}
	add(oOption) {
		this.aoOptions.push(oOption);
		if (oOption.selected) {
			this.value = oOption.value;
		}
	}
	addEventListener(sNom, fHandler) {
		this.asEcouteurs.push([ sNom, fHandler ]);
	}
}

/*
	Monte une instance neuve du module au-dessus d'un magasin donne. Rend de quoi observer ce que
	le module fait : le magasin, la suite des ecritures, le minuteur en attente, les deux listes.
*/
function charger(oMagasinInitial) {
	const magasin = Object.assign({}, oMagasinInitial);
	const aoEcritures = [];
	const aoListes = new Map([
		[ 'preset-buffering', new FausseListe('preset-buffering') ],
		[ 'preset-appearance', new FausseListe('preset-appearance') ]
	]);
	const asEvenements = [];
	let oMinuteur = null;
	let nProchainId = 1;
	let nRechargements = 0;
	let oFichierEcrit = null;

	const ctx = {
		console,
		JSON, Math, Number, Object, String, Promise, Error, Set, Map, Array, Infinity, isNaN,
		Symbol, encodeURIComponent,
		// Le prelude de common.js pose un correctif sur ces deux-la : il leur faut un prototype.
		NodeList: class NodeList {},
		HTMLCollection: class HTMLCollection {},
		performance: { now: () => 1000 },
		navigator: { userAgent: 'node', userAgentData: null },
		document: {
			currentScript: {},
			getElementById: sId => aoListes.get(sId) || null
		},
		window: {
			addEventListener: () => {},
			location: { reload: () => { ++nRechargements; } }
		},
		chrome: {
			runtime: { lastError: null },
			storage: { local: {
				get: (pKeys, fCallback) => fCallback(Object.assign({}, magasin)),
				set: (oValues, fCallback) => {
					aoEcritures.push({ sType: 'set', oValues: Object.assign({}, oValues) });
					Object.assign(magasin, oValues);
					if (fCallback) { fCallback(); }
				},
				clear: fCallback => {
					aoEcritures.push({ sType: 'clear' });
					for (const sKey of Object.keys(magasin)) { delete magasin[sKey]; }
					if (fCallback) { fCallback(); }
				}
			} }
		},
		setTimeout: (fCallback, nDelay) => {
			oMinuteur = { fCallback, nDelay };
			return nProchainId++;
		},
		clearTimeout: () => { oMinuteur = null; },
		Option: FausseOption,
		FileReader: class {},
		m_Debug: { CaughtException: p => { throw p; }, FinishWorkAndShowMessage: () => {} },
		m_Notification: { ShowAss: () => {} },
		m_Events: { SendEvent: sNom => asEvenements.push(sNom) },
		GetText: sName => `<${sName}>`,
		WriteTextToLocalFile: (sText, sType, sName) => { oFichierEcrit = { sText, sType, sName }; }
	};
	vm.createContext(ctx);
	vm.runInContext(
		`const THIS_IS_CONTENT_SCRIPT = false;\n${prelude}\n${journal}\n${module_}\nthis.m_Settings = m_Settings;`,
		ctx);

	return {
		S: ctx.m_Settings,
		magasin,
		aoEcritures,
		aoListes,
		asEvenements,
		get oFichierEcrit() { return oFichierEcrit; },
		get nRechargements() { return nRechargements; },
		get bMinuteurArme() { return oMinuteur !== null; },
		get nDelai() { return oMinuteur && oMinuteur.nDelay; },
		// Fait ce que le navigateur aurait fait a l'echeance.
		Declencher() {
			if (oMinuteur === null) {
				throw new Error('aucune ecriture n etait en attente');
			}
			const fCallback = oMinuteur.fCallback;
			oMinuteur = null;
			fCallback();
		}
	};
}

// Un magasin « normal » : la version courante, et rien d'autre a reparer.
const SAIN = { nSettingsVersion: 2 };

(async () => {

titre('1. Migration des anciennes cles');
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, 'лПриглушить': true, 'чРазмерИнтерфейса': 130 });
	await t.S.Restore();
	ok(t.S.Get('bMute') === true, 'une valeur rangee sous l ancien nom est reprise');
	ok(t.S.Get('nInterfaceSize') === 130, 'un nombre aussi');
	t.Declencher();
	const oEcrit = t.aoEcritures.find(e => e.sType === 'set').oValues;
	ok(!oEcrit.hasOwnProperty('лПриглушить'), 'l ancien nom n est pas reecrit');
	ok(t.magasin.hasOwnProperty('лПриглушить'), 'et n est pas efface du magasin non plus');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, 'лПриглушить': true, bMute: false });
	await t.S.Restore();
	ok(t.S.Get('bMute') === false, 'le nom nouveau l emporte sur l ancien');
});
await cas(async () => {
	// Le piege : nBufferSize est gouverne par une predefinie, Get rend celle-ci.
	const t = charger({ nSettingsVersion: 2, 'чРазмерБуфера': 12.5 });
	await t.S.Restore();
	ok(t.S.Get('nBufferSize') === 8.5, 'Get rend la predefinie J0127, pas ce qui est range');
	ok(t.S.GetSettingParameters('nBufferSize').pCurrent === 12.5, 'la valeur reprise est bien la');
});

titre('2. Table de migration : integrite');
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	const aasEntrees = [...src.matchAll(/^\t\t'([^']+)': '([A-Za-z0-9_]+)',$/gm)].map(m => [ m[1], m[2] ]);
	ok(aasEntrees.length === 43, `43 entrees dans la table (trouve ${aasEntrees.length})`);
	const asCibles = aasEntrees.map(([ , sCible ]) => sCible);
	ok(new Set(asCibles).size === asCibles.length, 'aucune cible en double');
	let nInconnues = 0;
	for (const sCible of asCibles) {
		try {
			t.S.GetSettingParameters(sCible);
		} catch (pException) {
			nInconnues++;
			console.log(`        cible inconnue : ${sCible}`);
		}
	}
	ok(nInconnues === 0, 'chaque cible existe dans le schema');
});

titre('3. Correction des valeurs');
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, nInterfaceSize: 5000, nVolume2: -40, nChatPanelPosition: 77 });
	await t.S.Restore();
	ok(t.S.Get('nInterfaceSize') === 200, 'au-dessus du maximum : ramene au maximum');
	ok(t.S.Get('nVolume2') === 1, 'en dessous du minimum : ramene au minimum');
	ok(t.S.Get('nChatPanelPosition') === 2, 'hors de l enumeration : revient au defaut');
	t.Declencher();
	const oEcrit = t.aoEcritures.find(e => e.sType === 'set').oValues;
	ok(oEcrit.nInterfaceSize === 200 && oEcrit.nVolume2 === 1 && oEcrit.nChatPanelPosition === 2,
		'les corrections sont reecrites dans le magasin');
});
await cas(async () => {
	const AUTO = Number.MIN_SAFE_INTEGER;
	const t = charger({ nSettingsVersion: 2, nReplayDuration2: AUTO, nAutoHideInterval: AUTO });
	await t.S.Restore();
	ok(t.S.Get('nReplayDuration2') === AUTO, 'le sentinel automatique tient sur un reglage qui le declare');
	ok(t.S.Get('nAutoHideInterval') === 4, 'et retombe au defaut sur un reglage qui ne le declare pas');
});

titre('4. Predefinies : lecture');
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	ok(t.S.Get('nBufferSize') === 8.5 && t.S.Get('nConcurrentDownloads') === 2,
		'la predefinie prend le pas sur le defaut du schema');
	ok(t.S.GetSettingParameters('nBufferSize').pCurrent === 0,
		'alors que le schema, lui, vaut bien zero');
	ok(t.S.Get('sBackgroundColour') === '#282828', 'idem pour la famille de l apparence');
	ok(t.S.Get('nMaxBufferSize') === 8.5, 'nMaxBufferSize : le plus grand des deux (8.5 > 3)');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, sPresetSelected_buffering: 'J0128' });
	await t.S.Restore();
	ok(t.S.Get('nPlaybackStart') === 17 && t.S.Get('nMaxBufferSize') === 17,
		'J0128 : nMaxBufferSize suit nPlaybackStart quand il est le plus grand');
});

titre('5. Predefinies : ecriture');
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.aoEcritures.length = 0;
	t.S.Change('nBufferSize', 12);
	ok(t.S.GetSettingParameters('sPresetSelected_buffering').pCurrent === 'J0129',
		'changer une valeur de la predefinie fait passer au personnalise');
	ok(t.S.GetSettingParameters('bPresetFilled_buffering').pCurrent === true,
		'et marque le creneau comme rempli');
	ok(t.S.Get('nBufferSize') === 12, 'la valeur demandee est en place');
	ok(t.S.Get('nConcurrentDownloads') === 2 && t.S.Get('nPlaybackStart') === 3 && t.S.Get('nBufferStretch') === 20,
		'LES TROIS AUTRES N ONT PAS BOUGE : la predefinie a ete recopiee avant la sortie');
	t.Declencher();
	const oEcrit = t.aoEcritures.find(e => e.sType === 'set').oValues;
	ok(oEcrit.nConcurrentDownloads === 2 && oEcrit.nPlaybackStart === 3 && oEcrit.nBufferStretch === 20 && oEcrit.nBufferSize === 12,
		'et le magasin les recoit, sans quoi le prochain demarrage les perdrait');
	ok(t.aoListes.get('preset-buffering').value === 'J0129', 'la liste montre le personnalise');
});
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.Declencher();
	t.aoEcritures.length = 0;
	t.S.Change('nBufferSize', 8.5);
	ok(t.S.GetSettingParameters('sPresetSelected_buffering').pCurrent === 'J0127',
		'ecrire la valeur que la predefinie porte deja n en fait pas sortir');
	ok(t.aoEcritures.length === 0 && !t.bMinuteurArme, 'et ne declenche aucune ecriture');
});
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.S.Change('nVolume2', 70);
	ok(t.S.GetSettingParameters('sPresetSelected_buffering').pCurrent === 'J0127',
		'changer un reglage hors predefinie ne touche a aucune famille');
});

titre('6. Predefinies : la liste et son evenement');
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.S.ConfigurePresetLists();
	const oListe = t.aoListes.get('preset-buffering');
	ok(oListe.length === 3, 'trois entrees tant que le personnalise est vide');
	ok(oListe.value === 'J0127', 'la selection porte sur la predefinie en cours');
	ok(oListe.aoOptions[0].text === '<J0126>', 'les libelles passent par la traduction');
	// Ce que fait le navigateur quand l'utilisateur choisit dans la liste.
	oListe.asEcouteurs[0][1]({ target: { id: 'preset-buffering', value: 'J0128' } });
	ok(t.S.Get('nPlaybackStart') === 17, 'choisir J0128 met ses valeurs en vigueur');
	ok(t.asEvenements[0] === 'settings-presetchanged-buffering', 'et annonce le changement a la famille');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, sPresetSelected_buffering: 'J0129', bPresetFilled_buffering: true, nBufferSize: 11 });
	await t.S.Restore();
	t.S.ConfigurePresetLists();
	const oListe = t.aoListes.get('preset-buffering');
	ok(oListe.length === 4 && oListe.value === 'J0129', 'le personnalise rempli ajoute sa propre entree');
	ok(t.S.Get('nBufferSize') === 11, 'et rend la main aux valeurs rangees');
});

titre('7. Ecritures differees');
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.Declencher();
	t.aoEcritures.length = 0;
	t.S.Change('nVolume2', 70);
	t.S.Change('bScaleImage', false);
	ok(t.aoEcritures.length === 0, 'rien n est ecrit avant l echeance');
	ok(t.nDelai === 500, 'delai de 500 ms hors script de contenu');
	t.Declencher();
	ok(t.aoEcritures.length === 1, 'deux changements, une seule ecriture');
	ok(t.aoEcritures[0].oValues.nVolume2 === 70 && t.aoEcritures[0].oValues.bScaleImage === false,
		'les deux y sont');
});
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.Declencher();
	t.S.Change('nVolume2', 70);
	t.S.SaveChanges();
	ok(!t.bMinuteurArme && t.magasin.nVolume2 === 70, 'SaveChanges vide la file tout de suite');
});
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.Declencher();
	t.aoEcritures.length = 0;
	t.S.Change('nVolume2', 70);
	t.S.Reset();
	t.Declencher();
	ok(t.aoEcritures[0].sType === 'clear', 'la remise a zero efface le magasin');
	ok(!t.aoEcritures[1].oValues.hasOwnProperty('nVolume2'),
		'et le changement en attente ne ressuscite pas : l effacement remplace la file');
	ok(t.aoEcritures[1].oValues.hasOwnProperty('nRandomNumber'), 'les reglages permanents survivent');
	ok(t.nRechargements === 1, 'la page est rechargee');
});

titre('8. Version du magasin');
await cas(async () => {
	const t = charger({});
	await t.S.Restore();
	t.Declencher();
	ok(t.aoEcritures[0].sType === 'clear', 'un magasin vide est traite comme illisible : on repart propre');
	const oEcrit = t.aoEcritures[1].oValues;
	ok(typeof oEcrit.nRandomNumber === 'number' && oEcrit.nSettingsVersion === 2,
		'et les permanents sont ecrits des le premier demarrage');
	ok(Object.keys(oEcrit).length === 5, 'exactement les cinq permanents, rien d autre');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 99, nVolume2: 70 });
	await t.S.Restore();
	t.Declencher();
	ok(t.aoEcritures[0].sType === 'clear', 'une version plus recente que la notre : tout est jete');
	ok(t.S.Get('nVolume2') === 50, 'et rien n en est retenu');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 1, nVolume2: 70 });
	await t.S.Restore();
	t.Declencher();
	ok(t.S.Get('nVolume2') === 70, 'une version plus ancienne est lue');
	ok(t.magasin.nSettingsVersion === 2, 'et le numero est remis a jour');
});

titre('9. Reparations au demarrage');
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, sPresetSelected_appearance: 'J9999' });
	await t.S.Restore();
	ok(t.S.GetSettingParameters('sPresetSelected_appearance').pCurrent === 'J0122',
		'une predefinie qui n existe plus revient au defaut');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, nChatState: 1, nClosedChatState: 0 });
	await t.S.Restore();
	ok(t.S.Get('nClosedChatState') === 1,
		'chat ferme : l etat de retour est recale sur l etat courant');
});
await cas(async () => {
	const t = charger({ nSettingsVersion: 2, nChatState: 2, nClosedChatState: 0 });
	await t.S.Restore();
	ok(t.S.Get('nClosedChatState') === 0,
		'chat en panneau : l etat de retour est laisse tel quel');
});

titre('10. Export et rapport');
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.S.Change('nVolume2', 70);
	t.S.Export();
	const oExport = JSON.parse(t.oFichierEcrit.sText);
	ok(oExport.nVolume2 === 70, 'l export porte ce que l utilisateur a change');
	ok(!oExport.hasOwnProperty('nRandomNumber') && !oExport.hasOwnProperty('sPreviousVersion'),
		'et laisse la comptabilite interne de cote');
	ok(oExport.nSettingsVersion === 2, 'sauf le numero de version, qui sert a le relire');
	ok(t.oFichierEcrit.sType === 'application/json', 'ecrit en JSON');
});
await cas(async () => {
	const t = charger(SAIN);
	await t.S.Restore();
	t.Declencher();
	t.S.Change('nVolume2', 70);
	t.S.Change('bDimChat', true);
	t.Declencher();
	const oRapport = t.S.GetDataForReport();
	ok(oRapport.nVolume2 === 70 && oRapport.bDimChat === true, 'le rapport montre ce qui a change');
	ok(!oRapport.hasOwnProperty('bScaleImage'), 'et tait ce qui est reste au defaut');
	ok(oRapport.hasOwnProperty('nRandomNumber'), 'la comptabilite interne y figure toujours');
});

console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);

})();
