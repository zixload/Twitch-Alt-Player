/*
	Les fenetres du lecteur : menu, reglages, fiche de chaine, nouveautes.

	Ecrite depuis la description du module, avant sa reecriture. Elle n'entre jamais dans le module :
	elle appelle son interface, lui envoie le clic tel que m_Controls l'envoie, et lit le DOM.

	Trois choses meritent d'etre surveillees et ne se lisent pas dans une signature :
	  - l'attribut data-window-opened du body n'est pas de la comptabilite. La feuille de style s'en
	    sert pour garder l'interface visible tant qu'une fenetre est ouverte
	    (« .autohide:not([data-window-opened]) »). Le perdre ferait disparaitre les controles sous
	    une fenetre ouverte, sans qu'aucune erreur ne soit levee ;
	  - l'identifiant de l'indicateur de defilement est construit par prefixe,
	    « scrollindicator- » + l'id de la zone. C'est le motif qui a mordu trois fois ;
	  - une fois l'indicateur cache, l'ecouteur de defilement est retire : redefiler vers le haut ne
	    le ramene pas. C'est le comportement d'origine, garde tel quel.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const ouverte = () => document.body.getAttribute('data-window-opened') || '';
	const elWindow = (sId) => document.getElementById(sId);
	const affichee = (sId) => elWindow(sId).classList.contains('windowopen');

	// L'evenement d'ouverture, tel que m_Controls l'ecoute.
	const vus = [];
	for (const sId of ['mainmenu', 'settings', 'news']) {
		m_Events.AddHandler(`window-opened-${sId}`, () => vus.push(sId));
	}

	m_Window.close(false);
	dire('aucune fenetre ouverte au depart', ouverte() === '', ouverte());

	dire('open rend vrai sur une fenetre fermee', m_Window.open('mainmenu') === true);
	dire('le menu principal est affiche', affichee('mainmenu'));
	dire('le body porte data-window-opened', ouverte() === 'mainmenu', ouverte());
	dire('l\'animation est demandee', elWindow('mainmenu').classList.contains('windowanimation'));
	dire('l\'evenement d\'ouverture est parti', vus.includes('mainmenu'), vus.join(' '));

	dire('open rend faux si elle est deja ouverte', m_Window.open('mainmenu') === false);
	dire('elle est restee ouverte', ouverte() === 'mainmenu' && affichee('mainmenu'));

	m_Window.open('settings');
	dire('ouvrir une autre ferme la premiere', !affichee('mainmenu'));
	dire('la nouvelle est affichee', affichee('settings') && ouverte() === 'settings', ouverte());

	m_Window.toggle('settings');
	dire('toggle ferme celle qui est ouverte', ouverte() === '' && !affichee('settings'), ouverte());
	m_Window.toggle('settings');
	dire('toggle la rouvre', ouverte() === 'settings' && affichee('settings'));

	m_Window.close(false);
	dire('close(false) ferme', ouverte() === '' && !affichee('settings'));
	dire('close(false) retire l\'animation', !elWindow('settings').classList.contains('windowanimation'));
	m_Window.open('settings');
	m_Window.close();
	dire('close() ferme en gardant l\'animation', ouverte() === '' && elWindow('settings').classList.contains('windowanimation'));

	let leve = false;
	try {
		m_Window.close();
	} catch (oError) {
		leve = true;
	}
	dire('close sans rien d\'ouvert ne leve pas', !leve && ouverte() === '');

	leve = false;
	try {
		m_Window.open('player');
	} catch (oError) {
		leve = true;
	}
	dire('ouvrir ce qui n\'est pas une fenetre est refuse', leve);
	dire('rien ne s\'est ouvert apres le refus', ouverte() === '', ouverte());

	// Le clic, tel que m_Controls l'emet sur le bus.
	const clic = (elTarget) => m_Events.SendEvent('controls-leftclick', { target: elTarget });
	clic(document.getElementById('togglemainmenu'));
	dire('un clic sur un bouton data-window-toggle ouvre', ouverte() === 'mainmenu', ouverte());
	clic(elWindow('mainmenu'));
	dire('un clic dans la fenetre ouverte ne la ferme pas', ouverte() === 'mainmenu', ouverte());
	clic(document.getElementById('player'));
	dire('un clic ailleurs dans le lecteur la ferme', ouverte() === '', ouverte());

	// L'indicateur de defilement, et son identifiant construit par prefixe.
	const elNews = document.getElementById('newstext');
	const elIndicator = document.getElementById('scrollindicator-newstext');
	m_Window.open('news');
	await dormir(100);
	const elHaut = document.createElement('div');
	elHaut.style.height = '4000px';
	elNews.appendChild(elHaut);
	m_Window.configureScrollIndicator('newstext');
	dire('l\'indicateur parait quand il reste a defiler', !elIndicator.hasAttribute('hidden'));
	dire('la zone est remise en haut', elNews.scrollTop === 0, String(elNews.scrollTop));

	elNews.scrollTop = elNews.scrollHeight;
	elNews.dispatchEvent(new Event('scroll'));
	await dormir(50);
	dire('l\'indicateur part une fois tout defile', elIndicator.hasAttribute('hidden'));

	elNews.scrollTop = 0;
	elNews.dispatchEvent(new Event('scroll'));
	await dormir(50);
	dire('il ne revient pas sans configureScrollIndicator', elIndicator.hasAttribute('hidden'));

	m_Window.configureScrollIndicator(elNews);
	dire('configureScrollIndicator le ramene', !elIndicator.hasAttribute('hidden'));

	elHaut.remove();
	m_Window.configureScrollIndicator('newstext');
	dire('plus rien a defiler, plus d\'indicateur', elIndicator.hasAttribute('hidden'));
	m_Window.close(false);
	dire('la page est rendue fermee', ouverte() === '');

	return JSON.stringify(verdicts);
})()
