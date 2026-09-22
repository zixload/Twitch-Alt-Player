'use strict';
/*
	Le temps affiche le long d'une barre de lecture.

	Deux formats cohabitaient : « 6 : 14 » sur la barre du direct, « 0:09 » dans la vue des videos.
	Le meme instant s'ecrivait donc de deux facons selon l'endroit, et aucune des deux ne gardait ses
	colonnes : « 9:07 » devenant « 1:09:07 », le texte sautait sous le curseur au moment ou l'oeil le
	suivait. Il n'en reste qu'un, HH:MM:SS, zeros compris.

	Ce que ce test tient, parce que c'est ce qui se voit a l'ecran : la largeur constante, le
	debordement au-dela de vingt-quatre heures plutot qu'un retour a zero, et le fait qu'un temps
	inconnu ne s'ecrive pas comme zero.

	Usage: node tests/timecode.test.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RACINE, 'player.js'), 'utf8');
const nDebut = src.indexOf('function formatTimecode(');
const nFin = nDebut === -1 ? -1 : src.indexOf('\n}\n', nDebut);
if (nDebut === -1 || nFin === -1) {
	console.error('formatTimecode introuvable dans player.js');
	process.exit(2);
}

const ctx = { Number, Math, String, Array };
vm.createContext(ctx);
vm.runInContext(`${src.slice(nDebut, nFin + 3)}\nthis.formatTimecode = formatTimecode;`, ctx);
const f = ctx.formatTimecode;

let nEchecs = 0;
const ok = (bCondition, sMessage) => {
	console.log(`${bCondition ? '  ok    ' : '  ECHEC '}${sMessage}`);
	if (!bCondition) { nEchecs++; }
};
const vaut = (nEntree, sAttendu) => ok(f(nEntree) === sAttendu,
	`${String(nEntree).padStart(9)} s donne ${sAttendu} (obtenu ${f(nEntree)})`);

vaut(0, '00:00:00');
vaut(9, '00:00:09');
vaut(74, '00:01:14');
vaut(3599, '00:59:59');
vaut(3600, '01:00:00');
vaut(3725.9, '01:02:05');
vaut(55708, '15:28:28');

// Une diffusion de plus d'un jour deborde la colonne des heures : repartir a zero mentirait.
vaut(108000, '30:00:00');

// Un temps inconnu ne vaut pas zero. C'est ce qui donnait « Infinity:NaN:NaN » a l'ecran.
vaut(Infinity, '--:--:--');
vaut(NaN, '--:--:--');

// Une position negative n'existe pas : elle se lit comme le debut, pas comme une soustraction.
vaut(-5, '00:00:00');

const asLargeurs = [0, 9, 3725.9, 55708].map((n) => f(n).length);
ok(new Set(asLargeurs).size === 1, `meme largeur pour tous : ${asLargeurs.join(', ')}`);

console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);
