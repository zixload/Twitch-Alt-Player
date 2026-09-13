'use strict';
/*
	Proves that settings.test.js can fail.

	A suite that prints sixty-three "ok" proves nothing unless it is known to print something else
	when the module is wrong. Each case below copies common.js into a temporary file, breaks ONE
	thing in m_Settings, runs the suite against that copy, and requires it to fail on the line it
	is supposed to fail on. Nothing in the repository is modified.

	The eight breakages are not invented: they are the eight ways a rewrite of this module could
	plausibly go wrong while still parsing, still loading, and still playing a stream -- which is
	to say, the eight ways the browser harness would have let it through.

	Usage: node tests/settings-selftest.js      (exit 0 when every case is caught)
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE = path.join(__dirname, '..', 'common.js');
const SUITE = path.join(__dirname, 'settings.test.js');

/*
	sLibelle, le texte attendu dans la premiere ligne en echec, puis la mutation : le texte a
	trouver dans common.js et ce qui le remplace. Le texte a trouver doit y apparaitre une fois
	exactement, sinon le cas ne prouve rien et le dit.
*/
const CAS = [
	[ 'la predefinie n est plus recopiee en sortant', 'N ONT PAS BOUGE',
		'\t\t\tfor (const sPresetName of Object.keys(oPreset)) {\n'
		+ '\t\t\t\toSave[sPresetName] = _oSettings[sPresetName].pCurrent = oPreset[sPresetName];\n'
		+ '\t\t\t}\n', '' ],
	[ 'la table de migration n est plus parcourue', 'ancien nom est reprise',
		'for (const [ sOld, sNew ] of _amOldSettingNames) {', 'for (const [ sOld, sNew ] of []) {' ],
	/*
		La file en attente est fusionnee dans l'effacement au lieu d'etre jetee. Le drapeau reste
		pose, donc l'effacement a bien lieu : seule la valeur qui devait disparaitre reapparait.
		C'est la panne la plus discrete des huit, et c'est pour elle que le cas 7 existe.
	*/
	[ 'un effacement fusionne au lieu de remplacer', 'ne ressuscite pas',
		'\t\t} else if (bWipeFirst) {\n\t\t\t_oDelayedSave = oSave;',
		'\t\t} else if (bWipeFirst) {\n\t\t\tObject.assign(_oDelayedSave, oSave);' ],
	[ 'le plancher d un intervalle ne s applique plus', 'ramene au minimum',
		'\t\t\tif (pValue < this.nMinimum) {\n\t\t\t\treturn this.nMinimum;\n\t\t\t}',
		'\t\t\tif (pValue < this.nMinimum) {\n\t\t\t\treturn pValue;\n\t\t\t}' ],
	[ 'la predefinie ne prend plus le pas sur le schema', 'prend le pas sur le defaut',
		'if (oPreset && oPreset[sName] !== void 0) {', 'if (false) {' ],
	[ 'un magasin trop recent n est plus refuse', 'tout est jete',
		' || oStore.nSettingsVersion > SETTINGS_VERSION)', ')' ],
	[ 'l etat de retour du chat n est plus recale', 'recale sur l etat courant',
		'\t\t\toSave.nClosedChatState = oStore.nClosedChatState = oStore.nChatState;', '' ],
	[ 'les permanents ne sont plus ecrits au premier demarrage', 'des le premier demarrage',
		'\t\t\t\tif (_mnoPermanentSettings.has(sName)) {\n'
		+ '\t\t\t\t\toSave[sName] = _oSettings[sName].pInitial;\n'
		+ '\t\t\t\t}\n', '' ],
];

const sOriginal = fs.readFileSync(SOURCE, 'utf8');
const sDossier = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-selftest-'));

// La suite doit passer sur la source intacte, sinon les cas ne mesurent rien.
let nEchecs = 0;
try {
	execFileSync(process.execPath, [ SUITE, SOURCE ], { stdio: 'pipe' });
	console.log('reference : la suite passe sur common.js intact');
} catch (pException) {
	console.log('INVALIDE  la suite echoue deja sur common.js intact : rien ne peut etre prouve ici');
	process.exit(2);
}
console.log('');

CAS.forEach(([ sLibelle, sAttendu, sTrouver, sRemplacer ], nIndex) => {
	const nOccurrences = sOriginal.split(sTrouver).length - 1;
	if (nOccurrences !== 1) {
		// Le code a bouge sous le cas : il ne mute plus ce qu'il croit muter.
		console.log(`  INVALIDE  ${nIndex + 1}. ${sLibelle} — le texte a muter apparait ${nOccurrences} fois, pas une`);
		nEchecs++;
		return;
	}
	const sCopie = path.join(sDossier, `cas${nIndex + 1}.js`);
	fs.writeFileSync(sCopie, sOriginal.replace(sTrouver, sRemplacer), 'utf8');
	let sSortie = '';
	let bTombee = false;
	try {
		execFileSync(process.execPath, [ SUITE, sCopie ], { stdio: 'pipe' });
	} catch (pException) {
		bTombee = true;
		sSortie = `${pException.stdout || ''}${pException.stderr || ''}`;
	}
	const asEchecs = sSortie.split('\n').filter(s => s.includes('ECHEC'));
	const bBonneLigne = asEchecs.some(s => s.includes(sAttendu));
	const bOk = bTombee && bBonneLigne;
	if (!bOk) { nEchecs++; }
	console.log(`  ${bOk ? 'VU      ' : 'RATE    '}  ${nIndex + 1}. ${sLibelle.padEnd(56)}`
		+ (bOk ? `${asEchecs.length} cas tombe(s)`
			: !bTombee ? 'la suite est passee quand meme'
				: `tombee ailleurs : ${asEchecs.map(s => s.trim()).join(' | ') || 'nulle part'}`));
});

fs.rmSync(sDossier, { recursive: true, force: true });
console.log('');
console.log(nEchecs
	? `${nEchecs} cas non detecte(s) : settings.test.js ne garde plus m_Settings.`
	: 'Tous les cas sont detectes.');
process.exit(nEchecs ? 1 : 0);
