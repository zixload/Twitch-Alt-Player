/*
	La pastille d'accuse de reception, exercee comme l'exercent ses appelants.

	Ecrite depuis la description du module, avant sa reecriture. Elle ne regarde jamais l'interieur
	du module : seulement son interface et ce que le DOM montre.

	Le cas qui compte est le troisieme : une seconde notification pendant les deux secondes de la
	premiere remplace l'icone ET relance le compte a rebours. Une implementation qui garderait le
	minuteur de la premiere cacherait la seconde trop tot, et rien d'autre ne le verrait.
*/
(async () => {
	const XLINK = 'http://www.w3.org/1999/xlink';
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	const elBadge = document.getElementById('notification');
	if (!elBadge) {
		dire('la pastille existe dans la page', false, 'aucun element #notification');
		return JSON.stringify(verdicts);
	}
	const elUse = elBadge.firstElementChild;
	const icone = () => elUse.getAttributeNS(XLINK, 'href') || elUse.getAttribute('href') || '';
	const cachee = () => elBadge.hasAttribute('hidden');
	const rouge = () => elBadge.classList.contains('trouble');

	dire('cachee au repos', cachee());

	m_Notification.ShowHappiness();
	dire('visible apres ShowHappiness', !cachee());
	dire('icone de reussite', icone() === '#svg-success', icone());
	dire('pas en rouge', !rouge());

	await dormir(900);
	m_Notification.ShowAss();
	dire('icone d\'echec', icone() === '#svg-fail', icone());
	dire('en rouge', rouge());

	// 2,3 s depuis la premiere : son minuteur aurait expire. Celui de la seconde, non.
	await dormir(1400);
	dire('le compte a rebours est reparti a la seconde', !cachee());

	// 2,3 s depuis la seconde.
	await dormir(900);
	dire('cachee apres deux secondes', cachee());

	// Une icone que la planche ne porte pas est une erreur de programmation, pas une boite vide.
	let leve = false;
	try {
		m_Notification.Show('svg-cette-icone-n-existe-pas', false);
	} catch (oError) {
		leve = true;
	}
	dire('icone inconnue refusee', leve);
	dire('rien ne s\'est affiche apres le refus', cachee());

	let leveSaveur = false;
	try {
		m_Notification.Show('svg-cut', 'oui');
	} catch (oError) {
		leveSaveur = true;
	}
	dire('saveur non booleenne refusee', leveSaveur);

	// L'appel direct, tel que m_Controls et m_Twitch s'en servent.
	m_Notification.Show('svg-cut', true);
	dire('visible apres un appel direct', !cachee());
	dire('icone demandee', icone() === '#svg-cut', icone());
	dire('en rouge sur demande', rouge());
	await dormir(2300);
	dire('cachee a nouveau', cachee());

	return JSON.stringify(verdicts);
})()
