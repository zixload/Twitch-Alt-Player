/*
	Le panneau de statistiques : ce qu'il compte, ce qu'il montre, et ce qu'il souligne.

	Ecrite depuis la description du module, avant sa reecriture.

	Ce qui compte et ne se lit dans aucune signature :
	  - **tout ce qui alimente le panneau compte meme quand il est ferme, mais n'ecrit que s'il est
	    ouvert.** Les compteurs d'incidents doivent survivre a une session entiere sans que personne
	    n'ouvre le panneau, puisqu'ils partent dans le rapport de bug ;
	  - chaque mesure suivie garde un historique et en tire un minimum, une moyenne et un maximum.
	    La derniere valeur est celle qu'on lit en gros ; les autres sont la pour dire si elle est
	    normale ;
	  - le soulignement n'est pas decoratif : il dit « regarde ca ». Deux segments ajoutes par
	    rafraichissement, c'est normal ; trois ne l'est pas. Une seconde d'attente de reponse non
	    plus ;
	  - changer de variante ou repartir remet a zero les compteurs de telechargement, mais pas ceux
	    qui comptent des pertes : elles restent vraies pour la session ;
	  - la frequence des publicites se lit « duree <intervalle> duree » et garde quinze coupures.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const el = (sId) => document.getElementById(sId);
	const texte = (sId) => (el(sId) ? el(sId).textContent : '(absent)');
	const souligne = (sId) => el(sId).classList.contains('statistics-highlight');
	const ouvert = () => !el('statistics').hasAttribute('hidden');

	const bOuvertAuDepart = m_Statistics.WindowOpened();
	const bReglageDorigine = m_Settings.Get('bShowStatistics');

	// --- Ouvrir, fermer
	m_Statistics.CloseWindow();
	await dormir(100);
	dire('ferme, le panneau est cache et le reglage suit',
		!m_Statistics.WindowOpened() && !ouvert() && m_Settings.Get('bShowStatistics') === false,
		`ouvert=${ouvert()} reglage=${m_Settings.Get('bShowStatistics')}`);

	m_Statistics.OpenWindow();
	await dormir(200);
	dire('ouvert, le panneau parait et le reglage suit',
		m_Statistics.WindowOpened() && ouvert() && m_Settings.Get('bShowStatistics') === true);

	// Ouvrir deux fois ne double rien.
	const nLignesAvant = el('statistics-updateinterval').children.length;
	m_Statistics.OpenWindow();
	await dormir(100);
	dire('ouvrir deux fois ne double pas les cases',
		el('statistics-updateinterval').children.length === nLignesAvant, String(nLignesAvant));

	// --- Un tableau d'analyse : minimum, moyenne, maximum, puis l'historique
	const elTable = el('statistics-segmentsadded');
	dire('un tableau porte ses cinq cases de tete et son historique',
		elTable.children.length > 5 && elTable.children[0].className === 'analysis-minimum'
		&& elTable.children[2].className === 'analysis-average'
		&& elTable.children[4].className === 'analysis-maximum',
		String(elTable.children.length) + ' cases');

	m_Statistics.SegmentsQueued(2, 4);
	await dormir(50);
	m_Statistics.SegmentsQueued(2, 4);
	await dormir(50);
	dire('deux segments ajoutes, ce n\'est pas souligne',
		![...elTable.querySelectorAll('.analysis-history')].some((c) => c.classList.contains('statistics-highlight')),
		[...elTable.querySelectorAll('.analysis-history')].filter((c) => c.textContent.trim()).map((c) => c.textContent).join(','));

	m_Statistics.SegmentsQueued(3, 6);
	await dormir(50);
	dire('trois segments ajoutes, c\'est souligne',
		[...elTable.querySelectorAll('.analysis-history')].some((c) => c.classList.contains('statistics-highlight')));
	dire('le minimum et le maximum encadrent les valeurs vues',
		elTable.children[0].textContent.trim() === '2' && elTable.children[4].textContent.trim() === '3',
		`${elTable.children[0].textContent} .. ${elTable.children[4].textContent}`);

	// --- L'attente de reponse : une seconde souligne
	const elAttente = el('statistics-responsewait');
	m_Statistics.SegmentLoaded(1000000, 2, 500, 200);
	await dormir(50);
	const bSousUneSeconde = [...elAttente.querySelectorAll('.analysis-history')]
		.some((c) => c.textContent.trim() && c.classList.contains('statistics-highlight'));
	m_Statistics.SegmentLoaded(1000000, 2, 500, 1500);
	await dormir(50);
	const bAuDelaDuneSeconde = [...elAttente.querySelectorAll('.analysis-history')]
		.some((c) => c.classList.contains('statistics-highlight'));
	dire('sous une seconde d\'attente, rien n\'est souligne', !bSousUneSeconde);
	dire('au-dela d\'une seconde, c\'est souligne', bAuDelaDuneSeconde);

	// --- Les compteurs d'incidents et leur soulignement
	m_Statistics.SegmentRejected();
	m_Statistics.SegmentsNotLoaded(2);
	m_Statistics.segmentsSkipped(3);
	await dormir(100);
	dire('un segment refuse se compte et se souligne',
		texte('statistics-rejected') !== '0' && souligne('statistics-rejected'),
		texte('statistics-rejected'));
	dire('une erreur de telechargement aussi',
		texte('statistics-downloaderrors') !== '0' && souligne('statistics-downloaderrors'),
		texte('statistics-downloaderrors'));
	dire('les segments non telecharges s\'additionnent',
		Number(texte('statistics-unloadedsegments')) >= 5, texte('statistics-unloadedsegments'));

	// Les epuisements de tampon : souligne a partir du cinquieme.
	for (let i = 0; i < 4; i++) {
		m_Statistics.PlayerBufferExhausted(false);
	}
	await dormir(50);
	const bQuatre = souligne('statistics-exhausted');
	m_Statistics.PlayerBufferExhausted(true);
	await dormir(50);
	dire('quatre epuisements ne sont pas souligne', !bQuatre, texte('statistics-exhausted'));
	dire('le cinquieme l\'est', souligne('statistics-exhausted'), texte('statistics-exhausted'));

	// --- Le total telecharge
	m_Statistics.SomethingDownloaded(5 * 1024 * 1024);
	await dormir(50);
	dire('le total telecharge se compte en megaoctets', Number(texte('statistics-downloaded')) >= 5,
		texte('statistics-downloaded'));

	// --- Les publicites
	const nAvantPub = Number(texte('statistics-adcount'));
	m_Events.SendEvent('playlist-adstart');
	await dormir(120);
	dire('une publicite se compte des son debut',
		Number(texte('statistics-adcount')) === nAvantPub + 1, texte('statistics-adcount'));
	dire('sa duree est inconnue tant qu\'elle dure', texte('statistics-adfrequency').includes('?'),
		texte('statistics-adfrequency'));
	m_Events.SendEvent('playlist-adend');
	await dormir(120);
	dire('la fin remplace le point d\'interrogation par une duree',
		!texte('statistics-adfrequency').includes('?'), texte('statistics-adfrequency'));
	const sFrequenceUne = texte('statistics-adfrequency');
	m_Events.SendEvent('playlist-adend');
	await dormir(120);
	dire('une fin sans debut ne change rien', texte('statistics-adfrequency') === sFrequenceUne,
		texte('statistics-adfrequency'));

	// --- Le debordement de tampon
	const nAvantDebordement = Number(texte('statistics-overflowed'));
	m_Events.SendEvent('player-bufferoverflow', 1.5);
	await dormir(120);
	dire('un debordement se compte et se souligne',
		Number(texte('statistics-overflowed')) === nAvantDebordement + 1 && souligne('statistics-overflowed'),
		texte('statistics-overflowed'));

	// --- La liste de segments
	m_Statistics.SegmentListParsed({
		nTargetDuration: 4,
		kAdSegments: 1,
		moSegments: [
			{ sAddress: 'https://video-edge-exemple.ttvnw.net/a.ts', nDuration: 2 },
			{ sAddress: 'https://video-edge-exemple.ttvnw.net/b.ts', nDuration: 2 },
		],
	});
	await dormir(100);
	dire('la duree cible est retenue', m_Statistics.GetTargetDuration() === 4,
		String(m_Statistics.GetTargetDuration()));
	dire('le serveur servant la liste est montre',
		texte('statistics-server').includes('ttvnw'), texte('statistics-server'));
	dire('la liste se lit « nombre x duree = total - publicites »',
		/2 × 2\.0 = 4\.0 − 1/.test(texte('statistics-list')), texte('statistics-list'));

	// --- Les bornes de duree d'image
	const oDuree = m_Statistics.GetFrameDurationInSeconds();
	dire('les bornes de duree d\'image sont encadrees',
		oDuree.nMinimum >= 0.017 && oDuree.nMaximum <= 0.04,
		`${oDuree.nMinimum} .. ${oDuree.nMaximum}`);

	// --- Le rapport
	const oRapport = m_Statistics.GetDataForReport();
	dire('le rapport porte les compteurs',
		oRapport.RejectedSegments >= 1 && oRapport.DownloadErrors >= 1 && oRapport.SkippedSegments >= 1
		&& oRapport.BufferExhaustions >= 5 && oRapport.EarlyBufferExhaustions >= 1,
		JSON.stringify(oRapport).slice(0, 80));
	dire('et la frequence des publicites', typeof oRapport.Ads === 'string' && oRapport.Ads.length > 0,
		oRapport.Ads);

	// --- Remettre a zero : les telechargements oui, les pertes non
	const nRefusesAvant = oRapport.RejectedSegments;
	m_Statistics.ClearHistory();
	await dormir(100);
	const oApres = m_Statistics.GetDataForReport();
	dire('remettre a zero efface les compteurs de telechargement',
		oApres.DownloadErrors === 0 && oApres.SkippedSegments === 0 && oApres.UnloadedSegments === 0
		&& oApres.BufferExhaustions === 0 && oApres.BufferOverflows === 0,
		JSON.stringify(oApres).slice(0, 80));
	dire('mais garde ce qui a ete refuse', oApres.RejectedSegments === nRefusesAvant,
		String(oApres.RejectedSegments));
	dire('et le soulignement part avec les compteurs',
		!souligne('statistics-downloaderrors') && !souligne('statistics-exhausted'));

	// --- Le glisser du panneau
	const elPanneau = el('statistics');
	const oGlisser = {
		nodePressed: elPanneau, nodeDragging: elPanneau, nStep: 1, bCancel: false,
		bChangedX: true, bChangedY: true, nDeltaX: 0, nDeltaY: 0,
	};
	m_Events.SendEvent('dragger-drag-statistics', oGlisser);
	oGlisser.nStep = 2;
	oGlisser.nDeltaX = 40;
	oGlisser.nDeltaY = 25;
	m_Events.SendEvent('dragger-drag-statistics', oGlisser);
	await dormir(100);
	dire('glisser le panneau le deplace',
		elPanneau.style.getPropertyValue('--x') !== '' && elPanneau.style.getPropertyValue('--y') !== '',
		// Les valeurs dependent de la position de depart du panneau : on rapporte qu'elles sont posees.
		'posees');
	oGlisser.nStep = 3;
	m_Events.SendEvent('dragger-drag-statistics', oGlisser);
	await dormir(50);

	// --- Fermer vide les cases
	m_Statistics.CloseWindow();
	await dormir(150);
	dire('fermer vide les cases marquees data-clear',
		[...document.querySelectorAll('[data-clear]')].every((elCase) => elCase.textContent === ''),
		String(document.querySelectorAll('[data-clear]').length) + ' cases');
	dire('et le panneau est cache', !ouvert() && !m_Statistics.WindowOpened());

	// Ferme, les compteurs continuent de compter.
	const oAvantFerme = m_Statistics.GetDataForReport();
	m_Statistics.SegmentRejected();
	m_Statistics.PlayerBufferExhausted(false);
	await dormir(100);
	const oApresFerme = m_Statistics.GetDataForReport();
	dire('ferme, le panneau compte quand meme',
		oApresFerme.RejectedSegments === oAvantFerme.RejectedSegments + 1
		&& oApresFerme.BufferExhaustions === oAvantFerme.BufferExhaustions + 1,
		`${oAvantFerme.RejectedSegments} -> ${oApresFerme.RejectedSegments}`);

	// --- Start suit le reglage
	m_Settings.Change('bShowStatistics', false);
	m_Statistics.Start();
	await dormir(100);
	dire('au demarrage, reglage a faux : rien ne s\'ouvre', !m_Statistics.WindowOpened());
	m_Settings.Change('bShowStatistics', true);
	m_Statistics.Start();
	await dormir(150);
	dire('reglage a vrai : le panneau s\'ouvre', m_Statistics.WindowOpened());

	// Rendre l'etat de depart.
	if (!bOuvertAuDepart) {
		m_Statistics.CloseWindow();
	}
	m_Settings.Change('bShowStatistics', bReglageDorigine);
	await dormir(100);
	dire('l\'etat d\'origine est rendu',
		m_Statistics.WindowOpened() === bOuvertAuDepart
		&& m_Settings.Get('bShowStatistics') === bReglageDorigine);

	return JSON.stringify(verdicts);
})()
