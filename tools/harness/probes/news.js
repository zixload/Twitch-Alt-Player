/*
	Les nouveautes et le manuel : ce qu'on montre, a qui, et une seule fois.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui compte et ne se lit dans aucune signature :
	  - la table melange des dates et quatre marqueurs qui n'en sont pas -- montrer une fois,
	    toujours montrer, le manuel complet, les tablettes. Tous commencent par « 2000 », et c'est
	    ce prefixe qui les distingue d'une vraie version ;
	  - trois cas a l'ouverture, et ils ne donnent pas la meme fenetre. Premiere fois : tout, sans
	    demande de confirmation, et le bouton disparait. Version plus ancienne : ce qui est plus
	    recent qu'elle, avec le bouton « plus tard ». A jour : rien de neuf ;
	  - la version vue n'est enregistree que quand l'utilisateur a confirme avoir lu. Sinon, une
	    ouverture accidentelle ferait disparaitre des nouveautes que personne n'a lues ;
	  - le lien de traduction se remplit au clic, pas a l'affichage : construire l'adresse pour
	    chaque entree couterait un encodage de tout le texte a chaque ouverture.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const elTexte = document.getElementById('newstext');
	const elOuvrir = document.getElementById('opennews');
	const elPlusTard = document.getElementById('postponenews');
	const elIndicateur = document.getElementById('scrollindicator-newstext');
	const ouverte = () => document.body.getAttribute('data-window-opened') || '';
	const entrees = () => elTexte.querySelectorAll('h4').length;
	// Le titre d'une entree datee est « date <espace demi-cadratin> point median ... » :
	// chercher un espace ordinaire autour du point ne trouve rien.
	const POINT_MEDIAN = '\u00b7';

	const sVersionDorigine = m_Settings.Get('sPreviousVersion');
	const { pInitial: sVersionInitiale } = m_Settings.GetSettingParameters('sPreviousVersion');

	// --- Le manuel : tout, plus les entrees du manuel complet.
	m_Window.close(false);
	m_News.OpenHelp();
	await dormir(150);
	dire('le manuel ouvre la fenetre des nouveautes', ouverte() === 'news', ouverte());
	const nManuel = entrees();
	/*
		AddNewsItems(Infinity, ...) exclut toute entree datee : plus recent que l'infini, personne.
		Le manuel ne montre donc que les entrees marquees -- le manuel lui-meme et ce qui est
		toujours visible -- et jamais le journal des versions.
	*/
	dire('le manuel montre le manuel, pas le journal', nManuel >= 2 && nManuel <= 4, String(nManuel));
	dire('aucune entree du manuel n\'est datee',
		[...elTexte.querySelectorAll('h4')].every((el) => !el.textContent.includes(POINT_MEDIAN)),
		[...elTexte.querySelectorAll('h4')].map((el) => el.textContent.slice(0, 18)).join(' | '));
	dire('les entrees sont separees', elTexte.querySelectorAll('hr').length === nManuel - 1,
		String(elTexte.querySelectorAll('hr').length));
	dire('le manuel ne demande pas de confirmation', elPlusTard.hasAttribute('hidden'));
	dire('l\'indicateur de defilement est pose', elIndicateur !== null);

	// --- Premiere fois : tout, sans confirmation, et le bouton disparait.
	m_Window.close(false);
	m_Settings.Change('sPreviousVersion', sVersionInitiale);
	m_News.OpenNews();
	await dormir(150);
	const nPremiere = entrees();
	// Meme raison : la premiere ouverture montre l'avis unique et ce qui est toujours visible.
	dire('la premiere fois montre l\'avis unique, pas le journal', nPremiere >= 1 && nPremiere <= 3,
		String(nPremiere));
	dire('sans demande de confirmation', elPlusTard.hasAttribute('hidden'));
	dire('le bouton des nouveautes disparait', elOuvrir.hasAttribute('hidden'));
	dire('la version vue est enregistree tout de suite',
		m_Settings.Get('sPreviousVersion') === EXTENSION_VERSION, m_Settings.Get('sPreviousVersion'));

	// --- Une version plus ancienne : ce qui est plus recent qu'elle, avec « plus tard ».
	m_Window.close(false);
	m_Settings.Change('sPreviousVersion', '2018.1.1');
	ShowElement(elOuvrir, true);
	elOuvrir.classList.add('unread');
	m_News.OpenNews();
	await dormir(150);
	const nDepuis2018 = entrees();
	dire('une version ancienne montre ce qui est plus recent qu\'elle', nDepuis2018 > nPremiere,
		String(nDepuis2018));
	dire('et ces entrees-la portent leur date',
		[...elTexte.querySelectorAll('h4')].filter((el) => el.textContent.includes(POINT_MEDIAN)).length > 0,
		String([...elTexte.querySelectorAll('h4')].filter((el) => el.textContent.includes(POINT_MEDIAN)).length));
	dire('avec la demande de confirmation', !elPlusTard.hasAttribute('hidden'));
	dire('la marque « non lu » est retiree', !elOuvrir.classList.contains('unread'));
	dire('la version vue n\'est PAS encore enregistree',
		m_Settings.Get('sPreviousVersion') === '2018.1.1', m_Settings.Get('sPreviousVersion'));

	// Confirmer la lecture enregistre la version et retire le bouton.
	m_Events.SendEvent('controls-leftclick', { sCallsign: 'closenews', target: document.getElementById('closenews') });
	await dormir(100);
	dire('confirmer la lecture enregistre la version',
		m_Settings.Get('sPreviousVersion') === EXTENSION_VERSION, m_Settings.Get('sPreviousVersion'));
	dire('et retire le bouton', elOuvrir.hasAttribute('hidden'));

	// --- A jour : rien de neuf.
	m_Window.close(false);
	m_News.OpenNews();
	await dormir(150);
	const nAJour = entrees();
	/*
		A jour, on ne montre pas moins : on montre tout. L'utilisateur a demande les nouveautes
		lui-meme, il n'y a rien de neuf a lui signaler, alors il recoit le journal entier -- mais
		sans qu'on lui demande de confirmer avoir lu quoi que ce soit.
	*/
	dire('a jour, le journal complet', nAJour > nDepuis2018, `${nAJour} contre ${nDepuis2018}`);
	dire('et pas de demande de confirmation', elPlusTard.hasAttribute('hidden'));

	// --- Le lien de traduction se remplit au clic.
	const elLien = elTexte.querySelector('a.news-translate');
	if (elLien) {
		dire('le lien de traduction est vide avant le clic', elLien.getAttribute('href') === 'translate:',
			elLien.getAttribute('href'));
		m_Events.SendEvent('controls-leftclick', { sCallsign: '', target: elLien });
		await dormir(100);
		dire('le clic construit l\'adresse de traduction',
			elLien.href.startsWith('https://translate.google.com/'), elLien.href.slice(0, 48));
		dire('et y met le texte de l\'entree', elLien.href.includes('text='), '');
	} else {
		dire('le lien de traduction est vide avant le clic', GetText('M0010') === 'ru',
			'interface en russe : pas de lien, cas saute');
		dire('le clic construit l\'adresse de traduction', GetText('M0010') === 'ru', 'cas saute');
		dire('et y met le texte de l\'entree', GetText('M0010') === 'ru', 'cas saute');
	}

	// --- Start : la pastille « non lu » selon ce qui a ete vu.
	m_Window.close(false);
	ShowElement(elOuvrir, false);
	elOuvrir.classList.remove('unread');
	m_Settings.Change('sPreviousVersion', '2018.1.1');
	m_News.Start();
	await dormir(100);
	dire('au demarrage, une vieille version allume le bouton',
		!elOuvrir.hasAttribute('hidden') && elOuvrir.classList.contains('unread'),
		elOuvrir.outerHTML.slice(0, 60));

	ShowElement(elOuvrir, false);
	elOuvrir.classList.remove('unread');
	m_Settings.Change('sPreviousVersion', EXTENSION_VERSION);
	m_News.Start();
	await dormir(100);
	dire('a jour, le bouton reste eteint',
		elOuvrir.hasAttribute('hidden') && !elOuvrir.classList.contains('unread'));

	m_Settings.Change('sPreviousVersion', sVersionDorigine);
	m_Window.close(false);
	dire('le reglage d\'origine est rendu', m_Settings.Get('sPreviousVersion') === sVersionDorigine,
		m_Settings.Get('sPreviousVersion'));

	return JSON.stringify(verdicts);
})()
