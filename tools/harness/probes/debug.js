/*
	Le rapport de bug : ce qu'il contient, et ce qu'il ne doit surtout pas contenir.

	Ecrite depuis la description du module, avant sa reecriture.

	**Ce module est terminal.** Chacune de ses entrees publiques arrete le lecteur et remplace la
	page par le formulaire de rapport. La sonde accumule donc d'abord tout ce qui se collecte sans
	rien casser, puis declenche le rapport une seule fois, a la fin, et juge sur ce qui aurait ete
	ecrit dans le fichier. Le chemin du message d'erreur, qui termine aussi, a sa propre sonde.

	Ce qui compte et ne se lit dans aucune signature :
	  - le jeton de lecture est caviarde, et pas seulement dans ses deux champs : Twitch le renvoie
	    en echo dans le journal, a l'interieur d'une autre chaine JSON ou ses guillemets sont
	    echappes. Le rapport entier est donc parcouru, les deux formes comprises ;
	  - trois identifiants partent avec lui : l'adresse IP publique du spectateur, son identifiant
	    de compte, celui de son appareil. Ce sont eux qui font qu'un rapport de bug ne doit pas etre
	    publie tel quel ;
	  - les listes de segments sont gardees en anneau de dix : une session de trois heures en
	    produirait des milliers, et les dix dernieres sont les seules qui expliquent une panne ;
	  - les longues chaines sont coupees. Une liste de variantes peut faire des centaines de
	    kilooctets d'adresses, et un rapport qu'on ne peut pas ouvrir ne sert a personne ;
	  - rien n'est envoye sur le reseau. L'envoi vers le site de l'auteur d'origine a ete retire ;
	    le rapport s'ecrit dans un fichier local, et seulement si le spectateur le demande.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	// On intercepte l'ecriture du fichier et tout depart reseau.
	let oEcrit = null;
	window.WriteTextToLocalFile = (sText, sType, sName) => {
		oEcrit = { sText, sType, sName };
	};
	const aReseau = [];
	const fOpenOrigine = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (sMethod, sUrl) {
		aReseau.push(`${sMethod} ${sUrl}`);
		return fOpenOrigine.apply(this, arguments);
	};
	const fFetchOrigine = window.fetch;
	window.fetch = function (pUrl) {
		aReseau.push(`fetch ${pUrl}`);
		return fFetchOrigine.apply(this, arguments);
	};

	// --- Ce qui s'accumule sans rien casser.
	const sJetonAvecPub = 'JETON-AVEC-PUB {"user_ip":"203.0.113.7","user_id":12345,"device_id":"abc"}';
	const sJetonSansPub = 'JETON-SANS-PUB {"user_ip":"203.0.113.8"}';
	m_Debug.saveBroadcastToken(sJetonAvecPub, false);
	m_Debug.saveBroadcastToken(sJetonSansPub, true);

	const sListeVariantes = [
		'#EXTM3U',
		`https://video-edge-exemple.abc.hls.ttvnw.net/v1/playlist/${'x'.repeat(300)}.m3u8`,
		'#EXT-X-TWITCH-INFO:NODE="video-edge"',
	].join('\n');
	m_Debug.SaveVariantList(sListeVariantes);

	// Douze listes de segments pour un anneau de dix.
	for (let i = 1; i <= 12; i++) {
		m_Debug.SaveSegmentList(`#EXTM3U\n#LISTE-${i}\nhttps://exemple.net/${'y'.repeat(300)}-${i}.ts`);
	}

	// Une chaine plus longue que la limite du rapport.
	m_Debug.saveBroadcastToken('Z'.repeat(200000), false);

	dire('collecter ne casse rien', document.getElementById('player') !== null);
	dire('le lecteur tourne encore', !document.body.classList.contains('novideo'),
		document.body.className.slice(0, 40));

	// --- L'unique action terminale du passage.
	m_Debug.TerminateAndSendFeedback();
	await dormir(1500);

	const elFrame = document.querySelector('iframe');
	dire('la page est remplacee par le rapport', Boolean(elFrame && elFrame.contentDocument),
		elFrame ? elFrame.src.slice(-20) : 'aucun cadre');
	if (!elFrame || !elFrame.contentDocument) {
		return JSON.stringify(verdicts);
	}
	const oDoc = elFrame.contentDocument;
	const elFormulaire = oDoc.getElementById('debug-feedback');
	dire('c\'est le formulaire d\'avis, pas celui d\'erreur',
		Boolean(elFormulaire) && !elFormulaire.hasAttribute('hidden'));
	dire('le formulaire d\'erreur reste cache',
		oDoc.getElementById('debug-error').hasAttribute('hidden'));

	// Envoyer : c'est la que le fichier s'ecrit.
	const elMessage = elFormulaire.elements['debug-message'];
	if (elMessage) {
		elMessage.value = 'essai du banc';
	}
	elFormulaire.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await dormir(500);

	// Le nom porte l'heure : on rapporte sa forme, pas sa valeur, sinon deux passages different.
	dire('un fichier est propose au spectateur', oEcrit !== null, oEcrit ? 'nomme' : 'rien');
	if (oEcrit === null) {
		return JSON.stringify(verdicts);
	}
	dire('c\'est du JSON, nomme par la date', oEcrit.sType === 'application/json'
		&& /^tw5-report-\d{4}-\d{2}-\d{2}T/.test(oEcrit.sName), oEcrit.sType);

	const oRapport = JSON.parse(oEcrit.sText);
	dire('le message du spectateur y est', oRapport.Message === 'essai du banc', String(oRapport.Message));
	dire('le rapport porte ce qu\'il faut pour diagnostiquer',
		['TerminationReason', 'ExtensionVersion', 'Browser', 'Settings', 'Statistics', 'Log',
			'Display', 'Connection', 'ProcessorAndRAM'].every((s) => s in oRapport),
		Object.keys(oRapport).length + ' champs');

	// Le caviardage.
	dire('les deux champs de jeton sont caviardes',
		oRapport.BroadcastToken === '[removed: playback token]'
		&& oRapport.BroadcastTokenWithoutAds === '[removed: playback token]',
		`${oRapport.BroadcastToken} / ${oRapport.BroadcastTokenWithoutAds}`);
	dire('aucun identifiant de compte ne sort', !/"user_id"\s*:\s*(?!"\[removed\]")/.test(oEcrit.sText));
	dire('aucun identifiant d\'appareil ne sort', !/"device_id"\s*:\s*(?!"\[removed\]")/.test(oEcrit.sText));
	dire('aucune adresse IP du spectateur ne sort', !oEcrit.sText.includes('203.0.113.'),
		oEcrit.sText.includes('203.0.113.') ? 'trouvee' : '');
	dire('le caviardage laisse une trace lisible', oEcrit.sText.includes('[removed]'));

	// L'anneau des listes de segments.
	dire('les listes de segments sont gardees par dix',
		Array.isArray(oRapport.SegmentLists) && oRapport.SegmentLists.length === 10,
		String(oRapport.SegmentLists && oRapport.SegmentLists.length));
	dire('ce sont les dix dernieres',
		oRapport.SegmentLists.some((s) => s.includes('#LISTE-12'))
		&& !oRapport.SegmentLists.some((s) => s.includes('#LISTE-1\n')),
		oRapport.SegmentLists.map((s) => (s.match(/#LISTE-\d+/) || [''])[0]).join(' '));

	// Les longues chaines coupees.
	dire('les adresses trop longues sont coupees',
		!oRapport.VariantList.includes('x'.repeat(200)),
		String(oRapport.VariantList.length));
	dire('la coupe se voit', /---8<---/.test(oRapport.VariantList) || oRapport.VariantList.length < 1000,
		oRapport.VariantList.slice(0, 60));

	// Le reseau.
	dire('rien n\'est envoye sur le reseau au moment du rapport',
		aReseau.filter((s) => !s.includes('twitch') && !s.includes('ttvnw')).length === 0,
		aReseau.slice(0, 3).join(' | '));

	return JSON.stringify(verdicts);
})()
