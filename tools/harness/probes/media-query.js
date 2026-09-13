/*
	Les regles de media du lecteur : ce qui se replie quand la place manque.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce ne sont pas des regles CSS, et c'est la raison d'etre du module : le seuil ne porte pas sur la
	hauteur de la fenetre mais sur la hauteur du lecteur **rapportee au reglage de taille de
	l'interface**. A 200 % de taille, un lecteur de 800 pixels vaut 400 pixels d'interface, et le
	menu doit se replier comme s'il etait petit. Aucune media query ne sait faire cela.

	Le levier de la sonde est donc ce reglage, pas la hauteur : forcer une hauteur sur #player ne
	change pas sa hauteur reelle, qui vient de la mise en page. Premiere version de cette sonde
	essayee ainsi, et sept cas sur quinze mesuraient le vide.

	L'ordonnancement se mesure autrement : on retire la classe a la main, on demande une mise a jour,
	et on regarde quand elle revient. Vite, c'est la prochaine image ; lentement, c'est deux cents
	millisecondes ; une demande rapide passe devant une demande lente en attente.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const elPlayer = document.getElementById('player');
	const elPanel = document.getElementById('toppanel');
	const elFiller = document.getElementById('filler');
	const replie = (sClasse) => elPlayer.classList.contains(sClasse);

	const nHauteur = elPlayer.clientHeight;
	/*
		La hauteur logique visee pour « tout se replie ». Elle doit rester atteignable : le reglage
		monte a 200 %, donc un lecteur de 649 pixels ne descend pas sous 325 de hauteur logique.
	*/
	const BAS = 350;
	const nTailleDorigine = m_Settings.Get('nInterfaceSize');
	// La taille qui donne telle hauteur logique. Hors de 50-200, le cas ne serait pas mesurable.
	const tailleParHauteur = (nVoulue) => Math.round((nHauteur * 100) / nVoulue);
	const dansLaPlage = (n) => n >= 50 && n <= 200;
	const poser = async (nVoulue) => {
		const nTaille = tailleParHauteur(nVoulue);
		if (!dansLaPlage(nTaille)) {
			return false;
		}
		m_Settings.Change('nInterfaceSize', nTaille);
		m_MediaQuery.updateQuickly();
		await dormir(120);
		return true;
	};

	dire('le lecteur a une hauteur', nHauteur > 0, String(nHauteur));

	if (await poser(BAS)) {
		dire('sous 412, les reglages se replient', replie('collapsesettings'));
		dire('sous 460, le menu se replie', replie('collapsemainmenu'));
	} else {
		dire(`hauteur logique de ${BAS} atteignable`, false, 'taille hors plage : ' + tailleParHauteur(BAS));
	}

	if (await poser(600)) {
		dire('au-dessus des seuils, rien n\'est replie', !replie('collapsesettings') && !replie('collapsemainmenu'));
	} else {
		dire('hauteur logique de 600 atteignable', false, 'taille hors plage : ' + tailleParHauteur(600));
	}

	if (await poser(430)) {
		dire('entre 412 et 460, seul le menu se replie', replie('collapsemainmenu') && !replie('collapsesettings'),
			`menu=${replie('collapsemainmenu')} reglages=${replie('collapsesettings')}`);
	} else {
		dire('hauteur logique de 430 atteignable', false, 'taille hors plage : ' + tailleParHauteur(430));
	}

	// L'ordonnancement, sans toucher aux reglages : la classe est retiree a la main.
	const attendreRetour = async (fDemander, nAvant, nApres) => {
		elPlayer.classList.remove('collapsemainmenu');
		fDemander();
		await dormir(nAvant);
		const bAvant = replie('collapsemainmenu');
		await dormir(nApres);
		return { avant: bAvant, apres: replie('collapsemainmenu') };
	};

	if (dansLaPlage(tailleParHauteur(BAS))) {
		await poser(BAS);
		const vite = await attendreRetour(() => m_MediaQuery.updateQuickly(), 60, 300);
		dire('vite remet la classe a l\'image suivante', vite.avant);

		const lentement = await attendreRetour(() => m_MediaQuery.updateSlowly(), 60, 300);
		dire('lentement ne s\'applique pas tout de suite', !lentement.avant);
		dire('lentement s\'applique apres le delai', lentement.apres);

		const double = await attendreRetour(() => {
			m_MediaQuery.updateSlowly();
			m_MediaQuery.updateQuickly();
		}, 60, 300);
		dire('une demande rapide devance la lente', double.avant);

		// Deux demandes rapides de suite ne font qu'une mise a jour : rien ne doit lever.
		let leve = false;
		try {
			m_MediaQuery.updateQuickly();
			m_MediaQuery.updateQuickly();
			await dormir(120);
		} catch (oError) {
			leve = true;
		}
		dire('deux demandes rapides ne levent pas', !leve && replie('collapsemainmenu'));
	}

	// L'ajustement de la police du bandeau : soit le contenu tient, soit on est descendu au minimum.
	const nTaillePolice = parseInt(elPanel.style.fontSize, 10);
	dire('la police du bandeau est dans sa plage', nTaillePolice >= 100 && nTaillePolice <= 124, elPanel.style.fontSize);
	dire('soit le contenu tient, soit la police est au minimum',
		elFiller.clientWidth > 0 || nTaillePolice === 100,
		`filler=${elFiller.clientWidth} police=${elPanel.style.fontSize}`);

	m_Settings.Change('nInterfaceSize', nTailleDorigine);
	m_MediaQuery.updateQuickly();
	await dormir(120);
	dire('le reglage d\'origine est rendu', m_Settings.Get('nInterfaceSize') === nTailleDorigine,
		String(m_Settings.Get('nInterfaceSize')));

	return JSON.stringify(verdicts);
})()
