/*
	La barre de progression d'une rediffusion : ou on en est, et ou on veut aller.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui compte et ne se lit dans aucune signature :
	  - la partie parcourue est peinte par un scaleX, pas par une largeur. Une largeur recalculerait
	    la mise en page a chaque image de video ;
	  - la position est toujours ramenee dans la fenetre [debut, fin] : un temps de lecture qui
	    depasse la fin -- et cela arrive en fin de segment -- ne doit pas peindre au-dela de la barre ;
	  - le clic ne vaut que pendant une rediffusion. En direct il n'y a rien ou aller ;
	  - le clic se mesure sur la boite de contenu, sans les marges interieures : la barre en a, pour
	    que la poignee deborde sans sortir.

	Le clic est eprouve pour de vrai : l'etat passe en rediffusion, la demande de deplacement est
	interceptee le temps de l'essai, et l'etat est rendu. Rien n'est demande au lecteur lui-meme.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const elScale = document.getElementById('scale');
	const elWatched = document.getElementById('scale-watched');
	const echelle = () => {
		const m = elWatched.style.transform.match(/scaleX\(([-\d.]+)\)/);
		return m ? Number(m[1]) : null;
	};

	// Une fenetre de temps connue, comme une rediffusion d'une heure.
	m_Scale.SetStartAndEnd(1000, 4600);
	dire('le debut et la fin se relisent', m_Scale.GetStart() === 1000 && m_Scale.GetEnd() === 4600,
		`${m_Scale.GetStart()}..${m_Scale.GetEnd()}`);

	m_Scale.SetWatched(1000);
	dire('au debut, la barre est vide', echelle() === 0, elWatched.style.transform);
	m_Scale.SetWatched(2800);
	dire('au milieu, la barre est a moitie', Math.abs(echelle() - 0.5) < 0.001, elWatched.style.transform);
	m_Scale.SetWatched(4600);
	dire('a la fin, la barre est pleine', echelle() === 1, elWatched.style.transform);

	m_Scale.SetWatched(99999);
	dire('au-dela de la fin, elle ne deborde pas', echelle() === 1, elWatched.style.transform);
	m_Scale.SetWatched(-5);
	dire('avant le debut, elle ne recule pas', echelle() === 0, elWatched.style.transform);

	m_Scale.SetWatched(2800);
	dire('la peinture passe par un scaleX', /^scaleX\(/.test(elWatched.style.transform.trim()),
		elWatched.style.transform);
	/*
		L'arrondi ne se voit pas sur une moitie : le navigateur renormalise « scaleX(0.5000) » en
		« scaleX(0.5) ». Un tiers, lui, le montre.
	*/
	m_Scale.SetWatched(1000 + 3600 / 3);
	dire('le rapport est arrondi a quatre decimales', echelle() === 0.3333, elWatched.style.transform);

	let leve = false;
	try {
		m_Scale.SetStartAndEnd(500, 100);
	} catch (oError) {
		leve = true;
	}
	dire('une fenetre a l\'envers est refusee', leve);

	// Le clic. On intercepte la demande de deplacement au lieu de la laisser partir.
	const fVraiSeek = m_Player.SeekReplayTo;
	const demandes = [];
	m_Player.SeekReplayTo = (nTime) => demandes.push(nTime);
	const nEtatDorigine = m_Controls.GetState();

	const cliquerA = (nFraction) => {
		const oBorder = elScale.getBoundingClientRect();
		const oStyle = getComputedStyle(elScale);
		const nDebut = Math.round(oBorder.left + Number.parseFloat(oStyle.paddingLeft));
		const nFin = Math.round(oBorder.right - Number.parseFloat(oStyle.paddingRight));
		elScale.dispatchEvent(new MouseEvent('click', {
			bubbles: true,
			clientX: Math.round(nDebut + (nFin - nDebut) * nFraction),
			clientY: Math.round(oBorder.top + oBorder.height / 2),
		}));
	};

	try {
		// En direct : le clic ne demande rien.
		m_Controls.ChangeState(STATE_PLAYING);
		await dormir(50);
		cliquerA(0.5);
		await dormir(50);
		dire('en direct, un clic ne demande aucun deplacement', demandes.length === 0, String(demandes.length));

		// En rediffusion : le clic demande un deplacement proportionnel.
		m_Controls.ChangeState(STATE_REPEAT);
		await dormir(50);
		cliquerA(0.5);
		await dormir(50);
		dire('en rediffusion, un clic demande un deplacement', demandes.length === 1, String(demandes.length));
		dire('le deplacement vise le milieu de la fenetre',
			demandes.length === 1 && Math.abs(demandes[0] - 2800) < 60, String(demandes[0]));

		demandes.length = 0;
		cliquerA(0);
		await dormir(50);
		dire('un clic tout a gauche vise le debut',
			demandes.length === 1 && Math.abs(demandes[0] - 1000) < 60, String(demandes[0]));

		demandes.length = 0;
		cliquerA(1);
		await dormir(50);
		dire('un clic tout a droite vise la fin',
			demandes.length === 1 && Math.abs(demandes[0] - 4600) < 60, String(demandes[0]));

		demandes.length = 0;
		cliquerA(-2);
		await dormir(50);
		dire('un clic avant la barre est ramene au debut',
			demandes.length === 1 && demandes[0] === 1000, String(demandes[0]));

		// Un second SetStartAndEnd ne doit pas doubler l'ecouteur.
		demandes.length = 0;
		m_Scale.SetStartAndEnd(1000, 4600);
		cliquerA(0.5);
		await dormir(50);
		dire('redefinir la fenetre ne double pas l\'ecouteur', demandes.length === 1, String(demandes.length));
	} finally {
		m_Player.SeekReplayTo = fVraiSeek;
		m_Controls.ChangeState(nEtatDorigine);
	}
	dire('la demande de deplacement est rendue au lecteur', m_Player.SeekReplayTo === fVraiSeek);
	dire('l\'etat d\'origine est rendu', m_Controls.GetState() === nEtatDorigine, String(m_Controls.GetState()));

	return JSON.stringify(verdicts);
})()
