/*
	L'effacement de l'interface, et ce qui la fait revenir.

	Ecrite depuis la description du module, avant sa reecriture.

	Le module pose ou retire la classe « autohide » sur le body ; c'est la feuille de style qui
	decide ensuite quoi effacer, et seulement pendant la lecture. La sonde juge donc la classe, qui
	est le contrat du module, pas ce qui disparait a l'ecran.

	Quatre comportements meritent d'etre tenus, et aucun ne se lit dans une signature :
	  - le delai se prolonge sans relancer de minuteur. Bouger la souris repousse une echeance ; le
	    minuteur en cours, en arrivant, la constate et se rearme. Cent mouvements ne font pas cent
	    clearTimeout ;
	  - un mouvement ne compte que s'il change les coordonnees ecran ET page. Un defilement deplace
	    la page sous une souris immobile ; deplacer la fenetre deplace l'ecran sous elle. Ni l'un ni
	    l'autre n'est un utilisateur qui revient ;
	  - moins de trois pixels, ce n'est pas un mouvement ;
	  - apres un effacement sans animation, les mouvements sont ignores pendant un demi-seconde.
	    Cet effacement-la accompagne autre chose -- un plein ecran, une fenetre qui s'ouvre -- et le
	    deplacement de la page sous la souris ferait aussitot revenir ce qu'on vient d'effacer.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const elPlayer = document.getElementById('player');
	const cachee = () => document.body.classList.contains('autohide');

	const nIntervalleDorigine = m_Settings.Get('nAutoHideInterval');
	m_Settings.Change('nAutoHideInterval', 0.5);

	/*
		La souris, dans les deux systemes de coordonnees, suivis separement : c'est leur difference
		qui distingue une souris qui bouge d'une page qui defile sous elle.

		Le module garde la derniere position qu'il a vue. Tant qu'on ne la lui a pas donnee, tout
		ecart mesure est un ecart avec une position inconnue : la premiere version de cette sonde
		comparait a la sienne et deux cas sur vingt mesuraient n'importe quoi. D'ou l'amorce.
	*/
	let nEcranX = 400;
	let nEcranY = 300;
	let nPageX = 400;
	let nPageY = 300;
	const bougerDe = async (nEcran, nPage) => {
		nEcranX += nEcran;
		nEcranY += nEcran;
		nPageX += nPage;
		nPageY += nPage;
		elPlayer.dispatchEvent(new PointerEvent('pointermove', {
			bubbles: true,
			screenX: nEcranX,
			screenY: nEcranY,
			clientX: nPageX,
			clientY: nPageY,
		}));
		// Le module ne traite qu'un mouvement par 150 ms : il retire son ecouteur et le remet.
		await dormir(200);
	};
	const amorcer = async () => {
		await bougerDe(0, 0);
		m_AutoHide.Hide();
	};

	m_AutoHide.Show();
	dire('Show montre l\'interface', !cachee());
	m_AutoHide.Hide();
	dire('Hide l\'efface', cachee());

	// Le delai : un demi-seconde ici.
	m_AutoHide.Show();
	await dormir(200);
	const bAvantDelai = cachee();
	await dormir(600);
	dire('l\'interface reste le temps du delai', !bAvantDelai);
	dire('puis elle s\'efface toute seule', cachee(), '');

	// L'echeance se prolonge : un second Show au milieu repousse l'effacement.
	m_AutoHide.Show();
	await dormir(300);
	m_AutoHide.Show();
	await dormir(350);
	dire('un nouveau Show repousse l\'effacement', !cachee());
	await dormir(500);
	dire('l\'effacement finit par venir', cachee());

	// La position connue du module, puis l'interface effacee : la base des trois cas qui suivent.
	await amorcer();

	// Un mouvement de moins de trois pixels ne reveille rien.
	await bougerDe(1, 1);
	dire('moins de trois pixels ne reveille pas', cachee());

	// Seule la page bouge : un defilement sous une souris immobile.
	await bougerDe(0, 40);
	dire('la page qui bouge sous la souris ne reveille pas', cachee());

	// Seul l'ecran bouge : la fenetre qu'on deplace sous la souris.
	await bougerDe(40, 0);
	dire('la fenetre qu\'on deplace ne reveille pas', cachee());

	// Un vrai mouvement : les deux changent, de plus de trois pixels.
	await bougerDe(40, 40);
	dire('un vrai mouvement reveille l\'interface', !cachee());

	// Un clic reveille aussi.
	m_AutoHide.Hide();
	elPlayer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	await dormir(50);
	dire('un clic reveille l\'interface', !cachee());

	// La souris qui quitte le lecteur efface tout de suite.
	elPlayer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
	await dormir(50);
	dire('la souris qui sort efface aussitot', cachee());

	// Apres un effacement sans animation, un demi-seconde de silence.
	m_AutoHide.Show();
	await dormir(50);
	m_AutoHide.Hide(false);
	dire('Hide(false) efface aussi', cachee());
	await bougerDe(40, 40);
	dire('un mouvement juste apres est ignore', cachee());
	await dormir(400);
	await bougerDe(40, 40);
	dire('passe le demi-seconde, le mouvement reveille', !cachee());

	// Le choix de vitesse garde l'interface : classe posee, rearmee, puis retiree apres cinq secondes.
	const elSpeed = document.getElementById('speed');
	const pointe = (nButton) => elSpeed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: nButton }));
	pointe(0);
	await dormir(50);
	dire('le choix de vitesse pose sa classe', document.body.classList.contains('speedpick'));
	await dormir(2000);
	pointe(0);
	await dormir(50);
	dire('un second appui la rearme', document.body.classList.contains('speedpick'));
	await dormir(3200);
	dire('elle tient encore apres le rearmement', document.body.classList.contains('speedpick'));
	await dormir(2000);
	dire('elle part cinq secondes apres le dernier appui', !document.body.classList.contains('speedpick'));

	// Un appui du bouton droit ne la pose pas.
	pointe(2);
	await dormir(50);
	dire('un appui droit ne la pose pas', !document.body.classList.contains('speedpick'));

	m_Settings.Change('nAutoHideInterval', nIntervalleDorigine);
	m_AutoHide.Show();
	dire('le reglage d\'origine est rendu', m_Settings.Get('nAutoHideInterval') === nIntervalleDorigine,
		String(m_Settings.Get('nAutoHideInterval')));

	return JSON.stringify(verdicts);
})()
