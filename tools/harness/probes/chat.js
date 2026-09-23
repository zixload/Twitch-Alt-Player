/*
	Le panneau de chat : son etat, sa place, sa taille.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui compte et ne se lit dans aucune signature :
	  - trois etats, pas deux. « Decharge » retire le cadre ; « cache » le garde connecte derriere une
	    classe. La difference se paie a la reouverture : un chat cache revient avec son historique,
	    un chat decharge se reconnecte ;
	  - le cote reellement en vigueur se lit dans la mise en page calculee de #playerandchat, pas
	    dans le reglage. En mode automatique, c'est la feuille de style qui decide, et le module lui
	    demande plutot que de deviner ;
	  - le panneau s'emprunte : le plein ecran le cache, la vue des videos aussi, et il ne revient
	    qu'une fois rendu par tous -- sortir du plein ecran depuis la vue des videos ne doit pas le
	    laisser retomber sur la rediffusion. L'emprunt ne s'enregistre jamais, sinon quitter le plein
	    ecran laisserait le chat ferme pour de bon ;
	  - la taille se retient a la fin du glisser seulement, jamais pendant : cent enregistrements par
	    glisser pour une valeur que l'utilisateur n'a pas encore choisie.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const cadre = () => document.getElementById('chat');
	const cache = () => document.body.classList.contains('hidechat');
	const etat = () => m_Settings.Get('nChatState');
	const cotes = () => ['chattop', 'chatright', 'chatbottom', 'chatleft']
		.filter((c) => document.body.classList.contains(c)).join(' ');

	const oDorigine = {
		nChatState: m_Settings.Get('nChatState'),
		nClosedChatState: m_Settings.Get('nClosedChatState'),
		bAutoChatPosition: m_Settings.Get('bAutoChatPosition'),
		nChatPanelPosition: m_Settings.Get('nChatPanelPosition'),
		nChatPanelWidth: m_Settings.Get('nChatPanelWidth'),
		nChatPanelHeight: m_Settings.Get('nChatPanelHeight'),
	};

	// --- Les trois etats
	m_Settings.Change('nChatState', CHAT_PANEL);
	m_Chat.SaveAndApplyClosedPanelState(CHAT_HIDDEN);
	m_Chat.TogglePanelState();
	await dormir(300);
	dire('fermer un panneau visible le cache sans le decharger',
		etat() === CHAT_HIDDEN && cadre() !== null && cache(),
		`etat=${etat()} cadre=${cadre() !== null} classe=${cache()}`);

	m_Chat.TogglePanelState();
	await dormir(300);
	dire('le rouvrir le montre', etat() === CHAT_PANEL && cadre() !== null && !cache(),
		`etat=${etat()} classe=${cache()}`);

	m_Chat.SaveAndApplyClosedPanelState(CHAT_UNLOADED);
	m_Chat.TogglePanelState();
	await dormir(300);
	dire('avec « decharger » choisi, fermer retire le cadre',
		etat() === CHAT_UNLOADED && cadre() === null && cache(),
		`etat=${etat()} cadre=${cadre() !== null}`);

	// Changer le choix de fermeture pendant que le chat est ferme s'applique tout de suite.
	m_Chat.SaveAndApplyClosedPanelState(CHAT_HIDDEN);
	await dormir(300);
	dire('changer le choix de fermeture s\'applique aussitot',
		etat() === CHAT_HIDDEN && cadre() !== null,
		`etat=${etat()} cadre=${cadre() !== null}`);

	// --- Les quatre cotes
	m_Chat.TogglePanelState();
	await dormir(300);
	dire('le panneau est de nouveau visible', etat() === CHAT_PANEL && !cache());

	m_Settings.Change('bAutoChatPosition', false);
	m_Settings.Change('nChatPanelPosition', TOP_SIDE);
	m_Chat.ApplyPanelPosition();
	await dormir(150);
	dire('en haut', cotes() === 'chattop', cotes());

	m_Chat.TogglePanelPosition();
	await dormir(150);
	dire('la bascule fait le tour : a droite', m_Settings.Get('nChatPanelPosition') === RIGHT_SIDE,
		cotes());
	m_Chat.TogglePanelPosition();
	await dormir(150);
	dire('puis en bas', m_Settings.Get('nChatPanelPosition') === BOTTOM_SIDE, cotes());
	m_Chat.TogglePanelPosition();
	await dormir(150);
	dire('puis a gauche', m_Settings.Get('nChatPanelPosition') === LEFT_SIDE, cotes());
	m_Chat.TogglePanelPosition();
	await dormir(150);
	dire('et revient en haut', m_Settings.Get('nChatPanelPosition') === TOP_SIDE, cotes());

	// La bascule quitte le mode automatique en figeant le cote en vigueur.
	m_Settings.Change('bAutoChatPosition', true);
	m_Chat.ApplyPanelPosition();
	await dormir(150);
	dire('le mode automatique se voit', document.body.classList.contains('autochatposition'));
	m_Chat.TogglePanelPosition();
	await dormir(150);
	dire('la bascule quitte le mode automatique',
		!document.body.classList.contains('autochatposition') && m_Settings.Get('bAutoChatPosition') === false);

	// Panneau ferme : la bascule de position ne fait rien.
	m_Chat.TogglePanelState();
	await dormir(200);
	const nAvantPosition = m_Settings.Get('nChatPanelPosition');
	m_Chat.TogglePanelPosition();
	await dormir(150);
	dire('panneau ferme, la position ne bouge pas',
		m_Settings.Get('nChatPanelPosition') === nAvantPosition, String(nAvantPosition));
	m_Chat.TogglePanelState();
	await dormir(300);

	// --- La taille, par le glisser
	m_Settings.Change('bAutoChatPosition', false);
	m_Settings.Change('nChatPanelPosition', RIGHT_SIDE);
	m_Chat.ApplyPanelPosition();
	await dormir(200);
	const elChat = cadre();
	const nLargeurAvant = elChat ? Number.parseInt(getComputedStyle(elChat).width, 10) : 0;
	const nReglageAvant = m_Settings.Get('nChatPanelWidth');
	const oGlisser = {
		nodePressed: document.getElementById('chatsize'),
		nodeDragging: document.getElementById('chatsize'),
		nStep: 1, bCancel: false, bChangedX: false, bChangedY: false, nDeltaX: 0, nDeltaY: 0,
	};
	m_Events.SendEvent('dragger-drag-chatsize', oGlisser);
	await dormir(100);
	oGlisser.nStep = 2;
	oGlisser.bChangedX = true;
	oGlisser.nDeltaX = -60;
	m_Events.SendEvent('dragger-drag-chatsize', oGlisser);
	await dormir(200);
	const nLargeurPendant = Number.parseInt(getComputedStyle(cadre()).width, 10);
	dire('tirer vers la gauche elargit le chat a droite', nLargeurPendant > nLargeurAvant,
		`${nLargeurAvant} -> ${nLargeurPendant}`);
	dire('rien n\'est enregistre pendant le glisser',
		m_Settings.Get('nChatPanelWidth') === nReglageAvant, String(m_Settings.Get('nChatPanelWidth')));

	oGlisser.nStep = 3;
	m_Events.SendEvent('dragger-drag-chatsize', oGlisser);
	await dormir(200);
	dire('la fin du glisser enregistre la largeur',
		m_Settings.Get('nChatPanelWidth') === nLargeurPendant,
		`${m_Settings.Get('nChatPanelWidth')} contre ${nLargeurPendant}`);

	// Un glisser annule ne touche a rien.
	const nApresGlisser = m_Settings.Get('nChatPanelWidth');
	oGlisser.nStep = 1;
	oGlisser.bCancel = false;
	m_Events.SendEvent('dragger-drag-chatsize', oGlisser);
	oGlisser.nStep = 2;
	oGlisser.bCancel = true;
	oGlisser.nDeltaX = -200;
	m_Events.SendEvent('dragger-drag-chatsize', oGlisser);
	oGlisser.nStep = 3;
	m_Events.SendEvent('dragger-drag-chatsize', oGlisser);
	await dormir(200);
	dire('un glisser annule ne change pas la taille enregistree',
		m_Settings.Get('nChatPanelWidth') === nApresGlisser, String(m_Settings.Get('nChatPanelWidth')));

	// --- Le plein ecran : le module l'apprend par le bus.
	m_Settings.Change('nChatState', CHAT_PANEL);
	m_Chat.TogglePanelState();
	m_Chat.TogglePanelState();
	await dormir(300);
	const bPanneauAvant = etat() === CHAT_PANEL;
	m_Events.SendEvent('fullscreen-changed', true);
	await dormir(300);
	dire('le plein ecran cache le panneau', bPanneauAvant && etat() === CHAT_HIDDEN && cache(),
		`avant=${bPanneauAvant} etat=${etat()}`);
	m_Events.SendEvent('fullscreen-changed', false);
	await dormir(300);
	dire('en sortir le rend', etat() === CHAT_PANEL && !cache(), `etat=${etat()}`);

	// --- La vue des videos emprunte le meme panneau.
	m_Events.SendEvent('videos-opened', true);
	await dormir(300);
	dire('la vue des videos cache le panneau', etat() === CHAT_HIDDEN && cache(), `etat=${etat()}`);
	m_Events.SendEvent('videos-opened', false);
	await dormir(300);
	dire('la refermer le rend', etat() === CHAT_PANEL && !cache(), `etat=${etat()}`);

	/*
		Les deux ensemble. Un seul souvenir pour deux emprunteurs rendrait le chat des la sortie du
		plein ecran, c'est-a-dire par-dessus la video qu'on regarde.
	*/
	m_Events.SendEvent('videos-opened', true);
	m_Events.SendEvent('fullscreen-changed', true);
	await dormir(300);
	dire('les deux a la fois le cachent', etat() === CHAT_HIDDEN && cache(), `etat=${etat()}`);
	m_Events.SendEvent('fullscreen-changed', false);
	await dormir(300);
	dire('sortir du plein ecran ne le rend pas tant que la vue est ouverte',
		etat() === CHAT_HIDDEN && cache(), `etat=${etat()}`);
	m_Events.SendEvent('videos-opened', false);
	await dormir(300);
	dire('le dernier qui rend ramene le panneau', etat() === CHAT_PANEL && !cache(), `etat=${etat()}`);

	// Tout rendre.
	for (const [sNom, pValeur] of Object.entries(oDorigine)) {
		m_Settings.Change(sNom, pValeur);
	}
	m_Chat.ApplyPanelPosition();
	await dormir(200);
	dire('les reglages d\'origine sont rendus',
		Object.entries(oDorigine).every(([sNom, pValeur]) => m_Settings.Get(sNom) === pValeur));

	return JSON.stringify(verdicts);
})()
