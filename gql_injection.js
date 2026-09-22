'use strict';
/*
	Le jeton d'integrite de Twitch, capte au passage.

	Les mutations qui engagent le compte -- suivre une chaine, ne plus la suivre -- sont refusees par
	gql.twitch.tv sans un en-tete Client-Integrity. Ce jeton, seule la page de Twitch sait l'obtenir :
	elle le demande a https://gql.twitch.tv/integrity.

	Ce script est injecte dans la page de Twitch par gqltoken.js, dans un cadre cache que le lecteur
	ouvre quand il lui faut un jeton. Il enveloppe fetch, laisse passer la demande telle quelle, et
	lit la reponse au vol pour deposer le jeton dans un cookie que le lecteur sait relire.

	IL Y A DEUX FACONS D'APPELER fetch, ET TWITCH EST PASSE DE L'UNE A L'AUTRE. On peut lui donner
	une adresse et des options, ou un seul objet Request qui porte tout. Ce script ne reconnaissait
	que la premiere -- adresse en chaine de caracteres, en-tetes dans les options, Authorization
	parmi eux. Releve le 22 septembre 2026 : Twitch appelle fetch(new Request(...)), sans options du
	tout, et ses en-tetes ne portent pas d'autorisation ; ce sont client-id, x-device-id et la serie
	x-kpsdk. Les trois conditions etaient donc fausses en meme temps, et rien n'etait jamais capte.
	D'ou la lecture des deux formes, et la condition reduite a ce qui se verifie : une adresse et une
	methode. Un jeton capte sur un cadre non connecte serait refuse par la mutation exactement comme
	une absence de jeton, en trente secondes de moins.

	LES DEUX NOMS ECRITS DANS CE COOKIE SONT UN CONTRAT AVEC m_Twitch : parseGqlTokenCookie y lit
	sToken et nExpiresAfter. En ecrire d'autres ne casse rien de visible ici -- le lecteur ne
	reconnait simplement jamais le jeton, attend trente secondes, puis abandonne, et suivre une
	chaine echoue sans que rien n'explique pourquoi. C'est ce qui est arrive quand le lecteur a ete
	traduit en anglais et pas ce fichier, reste avec ses noms russes. tests/gqltoken.test.js tient
	desormais les deux cotes ensemble, et les deux facons d'appeler fetch.

	La peremption est ramenee en deca de celle annoncee, et bornee : au moins une heure, pour ne pas
	rouvrir un cadre a chaque requete, au plus un jour, pour ne pas garder un jeton mort.
*/

(() => {
	const INTEGRITY_ADDRESS = 'https://gql.twitch.tv/integrity';

	// L'adresse et la methode, quelle que soit la facon dont l'appelant les a donnees.
	function readAddress(pAddress) {
		return typeof pAddress == 'string' ? pAddress : (pAddress && pAddress.url) || '';
	}

	function readMethod(pAddress, oParameters) {
		const sMethod = (oParameters && oParameters.method) || (pAddress && pAddress.method) || '';
		return String(sMethod).toUpperCase();
	}

	function isIntegrityRequest(pAddress, oParameters) {
		return (
			readAddress(pAddress).split('?')[0] === INTEGRITY_ADDRESS &&
			readMethod(pAddress, oParameters) === 'POST'
		);
	}

	function writeToken(sToken, nExpiration) {
		const nNow = Date.now();
		const nExpiresAfter = Math.min(
			Math.max(nExpiration - 3 * 60 * 1e3, nNow + 1 * 60 * 60 * 1e3),
			nNow + 24 * 60 * 60 * 1e3
		);
		document.cookie = `tw5~gqltoken=${encodeURIComponent(JSON.stringify({
			sToken,
			nExpiresAfter
		}))}; path=/tw5~storage/; samesite=none; secure; max-age=86400`;
	}

	const fOriginalFetch = window.fetch;
	window.fetch = function (pAddress, oParameters) {
		const oPromise = fOriginalFetch.apply(this, arguments);
		if (isIntegrityRequest(pAddress, oParameters)) {
			oPromise
				.then(oResponse => {
					if (oResponse.ok && oResponse.status === 200) {
						return oResponse
							.clone()
							.json()
							.then(({ token: sToken, expiration: nExpiration }) => {
								if (typeof sToken == 'string' && sToken && Number.isSafeInteger(nExpiration)) {
									writeToken(sToken, nExpiration);
								}
							});
					}
				})
				.catch(pReason => {});
		}
		return oPromise;
	};
})();
