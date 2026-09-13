/*
	Le menu principal : ce qui l'ouvre, ce qui le ferme, et ce qui sort du parcours au clavier.

	Ecrite depuis la description du module, avant sa reecriture.

	Le clic droit est teste par un vrai evenement contextmenu sur l'oeil, parce que c'est le seul
	chemin : le module l'ecoute lui-meme, il ne passe pas par le bus. Le clic gauche, lui, arrive par
	le bus, comme m_Controls l'envoie.

	Le detail qui compte : la fermeture par une entree du menu se fait sans animation. Une entree de
	menu declenche autre chose -- une fenetre, un plein ecran -- et l'animation de fermeture se
	verrait par-dessus.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const ouverte = () => document.body.getAttribute('data-window-opened') || '';
	const elMenu = document.getElementById('mainmenu');

	m_Window.close(false);
	dire('rien d\'ouvert au depart', ouverte() === '', ouverte());

	// Le clic droit sur l'oeil : le vrai evenement, pas le bus.
	const clicDroit = () => {
		const oEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		document.getElementById('eye').dispatchEvent(oEvent);
		return oEvent.defaultPrevented;
	};
	const prevenu = clicDroit();
	dire('le clic droit sur l\'oeil ouvre le menu', ouverte() === 'mainmenu', ouverte());
	dire('le menu du navigateur est empeche', prevenu);

	const prevenu2 = clicDroit();
	dire('un second clic droit le referme', ouverte() === '', ouverte());
	dire('le menu du navigateur est encore empeche', prevenu2);

	// Une entree du menu referme, et sans animation.
	m_Window.open('mainmenu');
	const elItem = elMenu.querySelector('.menu-item');
	dire('le menu porte des entrees', !!elItem);
	if (elItem) {
		m_Events.SendEvent('controls-leftclick', { target: elItem });
		dire('un clic sur une entree referme le menu', ouverte() === '', ouverte());
		dire('la fermeture se fait sans animation', !elMenu.classList.contains('windowanimation'));
	}

	// Un clic ailleurs dans le menu ne le referme pas par ce chemin-la.
	m_Window.open('mainmenu');
	m_Events.SendEvent('controls-leftclick', { target: elMenu });
	dire('un clic sur le fond du menu le laisse ouvert', ouverte() === 'mainmenu', ouverte());
	m_Window.close(false);

	// Le parcours au clavier.
	const elCible = elItem || elMenu;
	m_Menu.setItemAvailability(elCible, false);
	dire('une entree indisponible sort du parcours', elCible.tabIndex === -1, String(elCible.tabIndex));
	m_Menu.setItemAvailability(elCible, true);
	dire('une entree disponible y revient', elCible.tabIndex === 0, String(elCible.tabIndex));

	// Par identifiant aussi, comme GetNode l'accepte partout ailleurs.
	if (elCible.id) {
		m_Menu.setItemAvailability(elCible.id, false);
		dire('l\'identifiant marche comme l\'element', elCible.tabIndex === -1, String(elCible.tabIndex));
		m_Menu.setItemAvailability(elCible, true);
	} else {
		dire('l\'identifiant marche comme l\'element', true, 'entree sans id, cas saute');
	}

	return JSON.stringify(verdicts);
})()
