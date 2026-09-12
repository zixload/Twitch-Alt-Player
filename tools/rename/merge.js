'use strict';
/*
	Fusionne les trois sources de correspondances, de la moins sure a la plus sure.

	  mined-map.json    extrait automatiquement des traductions deja presentes dans le depot
	  manual-map.json   traduit a la main, pour les fichiers qu'aucune source ne couvre
	  overrides.json    correctifs, quand une source se trompe

	L'ordre compte : un correctif doit pouvoir contredire la mine, et une traduction manuelle
	doit pouvoir combler ce que la mine n'a pas vu sans l'ecraser au hasard.
*/
const fs = require('fs');
const path = require('path');

function lire(nom) {
	const p = path.join(__dirname, nom);
	if (!fs.existsSync(p)) return {};
	const d = JSON.parse(fs.readFileSync(p, 'utf8'));
	// Une note de lecture porte une cle qui ne peut pas etre un identifiant JavaScript.
	// **Surtout pas le prefixe _** : ce depot nomme ainsi tous ses membres prives, et filtrer
	// la-dessus avait silencieusement supprime cinquante correspondances valides.
	for (const k of Object.keys(d)) if (!/^[A-Za-z_$Ѐ-ӿ][A-Za-z0-9_$Ѐ-ӿ]*$/.test(k)) delete d[k];
	return d;
}

const mined = lire('mined-map.json');
const manual = lire('manual-map.json');
const over = lire('overrides.json');
const merged = Object.assign({}, mined, manual, over);

/*
	Une valeur nulle dans overrides.json retire l'entree au lieu de la corriger.

	Le glossaire contient des noms qui n'existent plus dans le code vivant : deux orthographes de
	_чМинДлительностьВидеоСемпла y cohabitent, l'une avec une majuscule et l'autre sans, et seule
	la premiere subsiste. Garder la seconde ne casse rien toute seule, mais elle vise le meme nom
	anglais que la vraie, ce que la validation refuse a juste titre -- et refuse les DEUX.
*/
let retires = 0;
for (const [k, v] of Object.entries(merged)) {
	if (v === null) { delete merged[k]; retires += 1; }
}
if (retires) console.log('  %d entrees perimees retirees', retires);

fs.writeFileSync(path.join(__dirname, 'merged-map.json'),
	JSON.stringify(merged, null, 1), 'utf8');
console.log('carte fusionnee : %d extraites + %d manuelles + %d correctifs = %d',
	Object.keys(mined).length, Object.keys(manual).length, Object.keys(over).length,
	Object.keys(merged).length);
