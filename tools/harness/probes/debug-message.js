/*
	L'autre chemin terminal de m_Debug : le message d'erreur, sans rapport a remplir.

	Ecrite depuis la description du module, avant sa reecriture. Elle vit a part de `debug.js`
	parce que les deux chemins arretent le lecteur : un seul par passage, et chacun son navigateur.

	Ce chemin sert quand le lecteur sait pourquoi il s'arrete et que le spectateur n'a rien a
	rapporter -- navigateur trop ancien, chaine chiffree, onglet deja ouvert ailleurs. Le message
	est un code de traduction, jamais une phrase ecrite dans le code, et il peut porter un lien.

	Ce qui compte et ne se lit dans aucune signature :
	  - la page est demontee avant d'etre remplacee : feuilles de style retirees, attributs de
	    classe et de style effaces. Le rapport s'affiche dans un cadre isole, avec sa propre feuille,
	    pour qu'une page a moitie stylee par le lecteur ne le rende pas illisible ;
	  - le formulaire montre porte son identifiant en classe sur la racine du document : c'est ce
	    qui permet a report.css de peindre un fond different selon qu'on montre un message, une
	    erreur ou une demande d'avis ;
	  - terminer deux fois ne fait rien la seconde fois.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	dire('le lecteur est en place avant', document.getElementById('player') !== null);
	const nFeuillesAvant = document.querySelectorAll('link[rel="stylesheet"], style').length;
	dire('la page a ses feuilles de style', nFeuillesAvant > 0, String(nFeuillesAvant));

	// Un seul appel terminal, et il leve : c'est ainsi que l'appelant s'arrete aussi.
	let bLeve = false;
	try {
		m_Debug.FinishWorkAndShowMessage('J0204');
	} catch (oError) {
		bLeve = true;
	}
	dire('l\'appel leve pour arreter son appelant', bLeve);
	await dormir(1500);

	dire('les feuilles de style de la page sont retirees',
		document.querySelectorAll('link[rel="stylesheet"], style').length === 0,
		String(document.querySelectorAll('link[rel="stylesheet"], style').length));
	dire('le corps ne porte plus ni classe ni style',
		!document.body.hasAttribute('class') && !document.body.hasAttribute('style'),
		document.body.getAttribute('class') || '(aucune)');

	const elFrame = document.querySelector('iframe');
	dire('un cadre isole porte la page de rapport', Boolean(elFrame && elFrame.contentDocument),
		elFrame ? elFrame.src.slice(-20) : 'aucun');
	if (!elFrame || !elFrame.contentDocument) {
		return JSON.stringify(verdicts);
	}
	const oDoc = elFrame.contentDocument;
	const elMessage = oDoc.getElementById('debug-message');
	dire('le formulaire de message est montre', Boolean(elMessage) && !elMessage.hasAttribute('hidden'));
	dire('les deux autres restent caches',
		oDoc.getElementById('debug-error').hasAttribute('hidden')
		&& oDoc.getElementById('debug-feedback').hasAttribute('hidden'));
	dire('la racine du document porte le nom du formulaire',
		oDoc.documentElement.classList.contains('debug-message'),
		oDoc.documentElement.className);

	const elTexte = oDoc.getElementById('debug-messagetext');
	dire('le message est traduit, pas un code', Boolean(elTexte) && elTexte.textContent.length > 10
		&& elTexte.textContent !== 'J0204', (elTexte ? elTexte.textContent : '').slice(0, 50));
	dire('le cadre est traduit lui aussi',
		![...oDoc.querySelectorAll('[data-i18n]')].some((el) => el.textContent.trim() === ''),
		String(oDoc.querySelectorAll('[data-i18n]').length) + ' elements');

	// Terminer une seconde fois ne refait rien.
	const sAvant = oDoc.documentElement.className;
	let bLeveEncore = false;
	try {
		m_Debug.FinishWorkAndShowMessage('J0200');
	} catch (oError) {
		bLeveEncore = true;
	}
	await dormir(800);
	dire('un second arret leve aussi', bLeveEncore);
	dire('mais ne remplace pas la page', document.querySelectorAll('iframe').length === 1,
		String(document.querySelectorAll('iframe').length));
	dire('et ne change pas le message affiche', oDoc.documentElement.className === sAvant, sAvant);

	return JSON.stringify(verdicts);
})()
