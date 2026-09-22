'use strict';
/*
	Le jeton d'integrite de Twitch, capte au passage.

	Les mutations qui engagent le compte -- suivre une chaine, ne plus la suivre -- sont refusees par
	gql.twitch.tv sans un en-tete Client-Integrity. Ce jeton, seule la page de Twitch sait l'obtenir :
	elle le demande a https://gql.twitch.tv/integrity avec l'autorisation du spectateur.

	Ce script est injecte dans la page de Twitch par gqltoken.js, dans un cadre cache que le lecteur
	ouvre quand il lui faut un jeton. Il enveloppe fetch, laisse passer la demande telle quelle, et
	lit la reponse au vol pour deposer le jeton dans un cookie que le lecteur sait relire.

	LES DEUX NOMS ECRITS DANS CE COOKIE SONT UN CONTRAT AVEC m_Twitch : parseGqlTokenCookie y lit
	sToken et nExpiresAfter. En ecrire d'autres ne casse rien de visible ici -- le lecteur ne
	reconnait simplement jamais le jeton, attend trente secondes, puis abandonne, et suivre une
	chaine echoue sans que rien n'explique pourquoi. C'est ce qui est arrive quand le lecteur a ete
	traduit en anglais et pas ce fichier, reste avec ses noms russes. tests/gqltoken.test.js tient
	desormais les deux cotes ensemble.

	La peremption est ramenee en deca de celle annoncee, et bornee : au moins une heure, pour ne pas
	rouvrir un cadre a chaque requete, au plus un jour, pour ne pas garder un jeton mort.
*/

(() => {
	const fOriginalFetch = window.fetch;
	window.fetch = function (pAddress, oParameters) {
		const oPromise = fOriginalFetch(pAddress, oParameters);
		if (
			pAddress === 'https://gql.twitch.tv/integrity' &&
			oParameters &&
			oParameters.method &&
			oParameters.method.toUpperCase() === 'POST' &&
			oParameters.headers &&
			oParameters.headers.Authorization
		) {
			oPromise
				.then(oResponse => {
					if (oResponse.ok && oResponse.status === 200) {
						return oResponse
							.clone()
							.json()
							.then(({ token: sToken, expiration: nExpiration }) => {
								if (typeof sToken == 'string' && sToken && Number.isSafeInteger(nExpiration)) {
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
							});
					}
				})
				.catch(pReason => {});
		}
		return oPromise;
	};
})();
