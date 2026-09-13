/*
	La peau du lecteur : les couleurs choisies, l'opacite des panneaux, la taille de l'interface.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui compte ici et ne se lit dans aucune signature :
	  - l'identifiant d'un bouton de couleur EST le nom de son reglage. C'est ce qui permet de tous
	    les traiter sans en nommer aucun, et ce qui casse en silence si le balisage renomme un id ;
	  - « input » et « change » ne font pas la meme chose. Pendant qu'on fait glisser le selecteur,
	    input arrive en continu et la couleur se voit tout de suite ; change n'arrive qu'au relachement
	    et c'est lui seul qui enregistre. Confondre les deux ecrirait dans chrome.storage a chaque
	    pixel de deplacement ;
	  - les fenetres ne descendent pas sous 0,85 d'opacite meme quand les panneaux sont presque
	    transparents : un texte de reglages sur une video en mouvement, sinon, ne se lit plus ;
	  - la taille d'interface est une taille de police sur la racine. Toute l'interface est en rem,
	    donc un seul nombre la met a l'echelle -- et les seuils de m_MediaQuery en dependent.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const oStyle = document.documentElement.style;
	const variable = (sNom) => oStyle.getPropertyValue(sNom).trim();
	const boutons = [...document.querySelectorAll('input[type="color"]')];

	dire('le corps est visible', !document.body.hasAttribute('hidden'));
	dire('les boutons de couleur existent', boutons.length > 0, String(boutons.length));

	// Chaque bouton de couleur pose sa variable, en composantes decimales.
	const sansVariable = boutons.filter((el) => !/^\d+,\d+,\d+$/.test(variable(`--${el.id}`)));
	dire('chaque couleur est posee en r,g,b', sansVariable.length === 0,
		sansVariable.map((el) => el.id).join(' ') || variable(`--${boutons[0].id}`));

	// L'identifiant du bouton est le nom du reglage.
	const elCouleur = boutons[0];
	dire('l\'identifiant du bouton est un reglage', m_Settings.Get(elCouleur.id) === elCouleur.value,
		`${elCouleur.id}=${elCouleur.value}`);

	const sCouleurDorigine = elCouleur.value;
	const sAutre = sCouleurDorigine === '#010203' ? '#0a0b0c' : '#010203';
	const attendu = (s) => `${parseInt(s.slice(1, 3), 16)},${parseInt(s.slice(3, 5), 16)},${parseInt(s.slice(5, 7), 16)}`;

	// input : la couleur se voit, mais rien n'est enregistre.
	elCouleur.value = sAutre;
	elCouleur.dispatchEvent(new Event('input', { bubbles: true }));
	await dormir(50);
	dire('un « input » applique la couleur tout de suite', variable(`--${elCouleur.id}`) === attendu(sAutre),
		variable(`--${elCouleur.id}`));
	dire('un « input » n\'enregistre pas', m_Settings.Get(elCouleur.id) === sCouleurDorigine,
		m_Settings.Get(elCouleur.id));

	// change : c'est lui qui enregistre.
	elCouleur.dispatchEvent(new Event('change', { bubbles: true }));
	await dormir(50);
	dire('un « change » enregistre', m_Settings.Get(elCouleur.id) === sAutre, m_Settings.Get(elCouleur.id));

	// Le changement de predefinie relit les reglages et repeint.
	m_Settings.Change(elCouleur.id, sCouleurDorigine);
	elCouleur.value = sAutre;
	m_Events.SendEvent('settings-presetchanged-appearance');
	await dormir(80);
	dire('le changement de predefinie relit les boutons', elCouleur.value === sCouleurDorigine,
		elCouleur.value);
	dire('et repeint les variables', variable(`--${elCouleur.id}`) === attendu(sCouleurDorigine),
		variable(`--${elCouleur.id}`));

	// L'opacite, et le plancher des fenetres.
	const nOpaciteDorigine = m_Settings.Get('nOpacity');
	m_Settings.Change('nOpacity', 40);
	m_Events.SendEvent('settings-presetchanged-appearance');
	await dormir(80);
	dire('l\'opacite suit le reglage, a l\'envers', Number(variable('--nOpacity')).toFixed(2) === '0.60',
		variable('--nOpacity'));
	dire('les fenetres restent au-dessus du plancher', Number(variable('--nWindowOpacity')) >= 0.85,
		variable('--nWindowOpacity'));

	// 80 est le maximum du reglage : au-dela, Change refuse, et c'est tant mieux.
	m_Settings.Change('nOpacity', 80);
	m_Events.SendEvent('settings-presetchanged-appearance');
	await dormir(80);
	dire('des panneaux presque transparents ne rendent pas les fenetres illisibles',
		Number(variable('--nOpacity')) <= 0.2 && Number(variable('--nWindowOpacity')) >= 0.85,
		`${variable('--nOpacity')} / ${variable('--nWindowOpacity')}`);
	let refuse = false;
	try {
		m_Settings.Change('nOpacity', 200);
	} catch (oError) {
		refuse = true;
	}
	dire('une opacite hors plage est refusee', refuse);

	m_Settings.Change('nOpacity', nOpaciteDorigine);
	m_Events.SendEvent('settings-presetchanged-appearance');

	// La taille d'interface, par le vrai chemin : le bouton « plus » du reglage.
	const nTailleDorigine = m_Settings.Get('nInterfaceSize');
	const sPoliceAvant = document.documentElement.style.fontSize;
	dire('la taille d\'interface est une taille de police sur la racine',
		sPoliceAvant === `${(16 * nTailleDorigine) / 100}px`, sPoliceAvant);

	const elPlus = document.querySelector('#interfacesize > .numberinput-plus');
	m_Events.SendEvent('dragger-drag-interfacesize', { nStep: 1, nodePressed: elPlus });
	m_Events.SendEvent('dragger-drag-interfacesize', { nStep: 3, nodePressed: elPlus });
	await dormir(120);
	const nApres = m_Settings.Get('nInterfaceSize');
	dire('un appui sur « plus » augmente la taille', nApres > nTailleDorigine, String(nApres));
	dire('la police de la racine suit', document.documentElement.style.fontSize === `${(16 * nApres) / 100}px`,
		document.documentElement.style.fontSize);

	m_Settings.Change('nInterfaceSize', nTailleDorigine);
	m_Events.SendEvent('dragger-drag-interfacesize', { nStep: 1, nodePressed: document.querySelector('#interfacesize > .numberinput-minus') });
	m_Events.SendEvent('dragger-drag-interfacesize', { nStep: 3, nodePressed: document.querySelector('#interfacesize > .numberinput-minus') });
	await dormir(120);
	m_Settings.Change('nInterfaceSize', nTailleDorigine);
	m_Settings.Change(elCouleur.id, sCouleurDorigine);
	m_Events.SendEvent('settings-presetchanged-appearance');
	await dormir(80);
	dire('les reglages d\'origine sont rendus',
		m_Settings.Get('nInterfaceSize') === nTailleDorigine
		&& m_Settings.Get(elCouleur.id) === sCouleurDorigine
		&& m_Settings.Get('nOpacity') === nOpaciteDorigine);

	return JSON.stringify(verdicts);
})()
