'use strict';
/*
	Le cookie du jeton d'integrite : celui qui l'ecrit et celui qui le lit disent-ils la meme chose ?

	gql_injection.js tourne dans la page de Twitch et depose le jeton dans un cookie ; m_Twitch le
	relit dans la page du lecteur. Entre les deux il n'y a qu'un nom de cookie et deux noms de
	champs, et rien dans le code ne les tient ensemble : ce sont deux fichiers qui ne se connaissent
	pas, charges dans deux mondes differents.

	PANNE REELLE. La passe de traduction a renomme le lecteur en anglais et laisse l'injection avec
	ses noms russes, сТокен et чПротухнетПосле. Plus rien ne levait, rien ne s'affichait : le lecteur
	ne reconnaissait simplement jamais le jeton, ouvrait un cadre, attendait trente secondes et
	rendait ACCESS_DENIED. Suivre une chaine echouait, et le seul indice tenait dans une ligne de
	journal. Le commentaire jumeau de l'injection proposait d'ailleurs nExpiresAt la ou le lecteur
	attend nExpiresAfter : une traduction au mot a mot serait restee cassee.

	Ce test ne verifie pas que les noms sont ceux d'aujourd'hui -- il les LIT des deux cotes et
	verifie qu'ils se correspondent, puis fait passer un vrai cookie de l'un a l'autre.

	Usage: node tests/gqltoken.test.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const parser = require(path.join(RACINE, 'tools', 'rename', 'node_modules', '@babel', 'parser'));

let nEchecs = 0;
const ok = (bCondition, sMessage) => {
	console.log(`${bCondition ? '  ok    ' : '  ECHEC '}${sMessage}`);
	if (!bCondition) { nEchecs++; }
};

function tranche(src, sDebut, sFin, sQuoi) {
	const nDebut = src.indexOf(sDebut);
	const nFin = nDebut === -1 ? -1 : src.indexOf(sFin, nDebut);
	if (nDebut === -1 || nFin === -1) {
		console.error(`introuvable : ${sQuoi}`);
		process.exit(2);
	}
	return src.slice(nDebut, nFin + sFin.length);
}

// --- Ce que l'injection ecrit, lu sur son arbre syntaxique plutot qu'au texte ---

const sInjection = fs.readFileSync(path.join(RACINE, 'gql_injection.js'), 'utf8');
const oInjection = parser.parse(sInjection, { sourceType: 'script' });
let asWritten = null;
let sWrittenCookie = '';
(function chercher(pNode) {
	if (pNode === null || typeof pNode != 'object') {
		return;
	}
	if (Array.isArray(pNode)) {
		pNode.forEach(chercher);
		return;
	}
	// document.cookie = `<nom>=${encodeURIComponent(JSON.stringify({ ... }))}; ...`
	if (pNode.type === 'AssignmentExpression'
		&& pNode.left.type === 'MemberExpression'
		&& pNode.left.property.name === 'cookie'
		&& pNode.right.type === 'TemplateLiteral') {
		sWrittenCookie = pNode.right.quasis[0].value.cooked.replace(/=$/, '');
		(function trouverObjet(pInner) {
			if (pInner === null || typeof pInner != 'object') {
				return;
			}
			if (Array.isArray(pInner)) {
				pInner.forEach(trouverObjet);
				return;
			}
			if (pInner.type === 'ObjectExpression') {
				asWritten = pInner.properties.map(o => o.key.name || o.key.value);
			}
			Object.values(pInner).forEach(trouverObjet);
		})(pNode.right.expressions);
	}
	Object.values(pNode).forEach(chercher);
})(oInjection.program.body);

ok(asWritten !== null, `l injection ecrit un cookie : ${sWrittenCookie}`);
ok(Array.isArray(asWritten) && asWritten.length === 2, `avec deux champs : ${asWritten}`);

// --- Ce que le lecteur attend, pris dans m_Twitch et execute pour de vrai ---

const sTwitch = fs.readFileSync(path.join(RACINE, 'modules', 'twitch.js'), 'utf8');
const sParse = tranche(sTwitch, 'function parseGqlTokenCookie(', '\n  }', 'parseGqlTokenCookie');
const sNomCookie = (sTwitch.match(/const GQL_TOKEN_COOKIE = "([^"]+)"/) || [])[1];

ok(sNomCookie === sWrittenCookie, `le meme nom de cookie des deux cotes : ${sNomCookie}`);

const ctx = {
	JSON, Number, decodeURIComponent,
	Check: (p) => { if (!p) { throw new Error('Check failed'); } },
	IsNonEmptyString: (p) => typeof p == 'string' && p !== '',
	m_Log: { Oops() {} },
};
vm.createContext(ctx);
vm.runInContext(`${sParse}\nthis.parse = parseGqlTokenCookie;`, ctx);

// Le cookie tel que l'injection le fabrique, avec les champs qu'elle ecrit vraiment.
const JETON = 'un-jeton';
const EXPIRE = 1800000000000;
const oEcrit = {};
if (Array.isArray(asWritten) && asWritten.length === 2) {
	oEcrit[asWritten[0]] = JETON;
	oEcrit[asWritten[1]] = EXPIRE;
}
const [sLu, nLu] = ctx.parse(encodeURIComponent(JSON.stringify(oEcrit)));

ok(sLu === JETON && nLu === EXPIRE,
	`le lecteur retrouve le jeton ecrit par l injection (lu : ${JSON.stringify([sLu, nLu])})`);

// Et il refuse ce qu'il ne comprend pas, sinon le test precedent ne prouverait rien.
const [sVide, nVide] = ctx.parse(encodeURIComponent(JSON.stringify({ tokenSurUnAutreNom: JETON, autre: EXPIRE })));
ok(sVide === '' && nVide === 0, 'des champs qu il ne connait pas ne donnent aucun jeton');

console.log('');
console.log(nEchecs ? `${nEchecs} cas en echec.` : 'OK : tous les cas');
process.exit(nEchecs ? 1 : 0);
