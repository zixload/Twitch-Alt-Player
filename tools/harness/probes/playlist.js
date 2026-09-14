/*
	Les listes HLS : ce qu'on y lit, ce qu'on en met dans la file, et ce qu'on refuse d'y mettre.

	Ecrite depuis la description du module, avant sa reecriture.

	Trois fonctions publiques seulement -- Start, Stop, ChangeBroadcastVariant -- mais tout le
	contournement de publicite est la. La sonde fait donc tourner la vraie boucle de mise a jour en
	lui servant des listes ecrites a la main, et juge sur ce qui atterrit dans la file de segments,
	sur les evenements emis, et sur ce que les statistiques recoivent.

	Ce qui compte et ne se lit dans aucune signature :
	  - **une liste qui se termine par un segment de publicite declenche le flux de secours.** C'est
	    tout le mecanisme : tant que la publicite court, on lit une seconde liste demandee sous un
	    autre pretexte, et on ne met en file que ce qui vient d'elle ;
	  - **la file n'est pas remplie depuis le debut de la liste.** On remonte depuis la fin jusqu'a
	    avoir de quoi tenir le tampon reglé, et on part de la : prendre toute la liste ferait
	    demarrer la lecture loin derriere le direct ;
	  - **un segment d'initialisation qui change force une discontinuite**, meme quand rien d'autre
	    n'a change. Les deux flux du contournement ont chacun le leur, et empiler les images de
	    l'un contre l'en-tete de l'autre laisse une image noire ;
	  - **une adresse qui change pour un meme numero de sequence vaut chaos** : la liste n'est pas
	    celle qu'on croyait, on ne met rien en file et on arme une discontinuite ;
	  - les publicites deja finies annoncees par `#EXT-X-DATERANGE` sont ignorees : les garder
	    gelait l'image pour une coupure qui n'existe plus ;
	  - une liste vide, une duree negative, une duree trois fois superieure a la duree cible : le
	    module continue et met la duree a zero, ce qui vaut « ne pas telecharger ».

	La sonde arrete le module, le fait tourner sur ses listes, puis le rend a son etat d'origine.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	const HOTE = 'https://video-edge-banc.abc.hls.ttvnw.net';
	const b64 = (s) => btoa(s);

	// --- Ce qu'on sert a la boucle.
	let sListeVariantes = '';
	let sListeSegments = '';
	let kListesServies = 0;
	const aDemandes = [];

	const oVrai = {
		LoadText: m_Downloader.LoadText,
		LoadNextSegment: m_Downloader.LoadNextSegment,
		GetAbsoluteVariantListUrl: m_Twitch.GetAbsoluteVariantListUrl,
		isAdSegment: m_Twitch.isAdSegment,
		sortVariantList: m_Twitch.sortVariantList,
		sendAdTrackingData: m_Twitch.sendAdTrackingData,
		GetChannelUrl: m_Twitch.GetChannelUrl,
		SaveVariantList: m_Debug.SaveVariantList,
		SaveSegmentList: m_Debug.SaveSegmentList,
		FinishWorkAndShowMessage: m_Debug.FinishWorkAndShowMessage,
		SegmentsQueued: m_Statistics.SegmentsQueued,
		SegmentListParsed: m_Statistics.SegmentListParsed,
		segmentsSkipped: m_Statistics.segmentsSkipped,
		StopWatchingBroadcast: m_Controls.StopWatchingBroadcast,
		ShowAss: m_Notification.ShowAss,
	};

	let kCycles = 0;
	const aQueued = [];
	const aSkipped = [];
	const aListesAnalysees = [];
	const aMessages = [];
	const aSuivi = [];

	/*
		Deux boucles tournent des que la publicite commence -- le flux principal et le flux de
		secours -- et toutes deux passent par ici. On compte separement les listes servies au flux
		principal : sans ca, les tours du flux de secours feraient croire que le principal a avance,
		et la sonde repartirait avant qu'il ait eu le temps de tourner.
	*/
	let kServiesAuPrincipal = 0;
	m_Downloader.LoadText = (oAnnulation, sAdresse, nDelai, sLibelle) => {
		aDemandes.push(sLibelle);
		if (sLibelle.startsWith('variant list')) {
			return Promise.resolve(sListeVariantes);
		}
		++kListesServies;
		if (sLibelle === 'segment list 0') {
			++kServiesAuPrincipal;
		}
		return Promise.resolve(sListeSegments);
	};
	m_Downloader.LoadNextSegment = () => {};
	m_Twitch.GetAbsoluteVariantListUrl = () => Promise.resolve(`${HOTE}/v1/variants.m3u8`);
	m_Twitch.isAdSegment = (sNom) => /-unmuted-|Amazon|stitched/i.test(sNom);
	const aVariantesTriees = [];
	m_Twitch.sortVariantList = (o) => { aVariantesTriees.push(o); return o; };
	m_Twitch.sendAdTrackingData = (o) => { aSuivi.push(o); };
	m_Twitch.GetChannelUrl = () => 'https://www.twitch.tv/banc';
	m_Debug.SaveVariantList = () => {};
	m_Debug.SaveSegmentList = () => {};
	m_Debug.FinishWorkAndShowMessage = (...a) => { aMessages.push(a); };
	m_Statistics.SegmentsQueued = (k, n) => { aQueued.push([k, n]); ++kCycles; };
	m_Statistics.SegmentListParsed = (o) => { aListesAnalysees.push(o); };
	m_Statistics.segmentsSkipped = (k) => { aSkipped.push(k); };
	m_Controls.StopWatchingBroadcast = () => {};
	m_Notification.ShowAss = () => {};

	// --- Les evenements du module.
	const aEvenements = [];
	const fDebutPub = () => { aEvenements.push(['adstart']); };
	const fFinPub = () => { aEvenements.push(['adend']); };
	const fVariante = (a) => { aEvenements.push(['variant', a && a[0] ? a[0].length : null]); };
	m_Events.AddHandler('playlist-adstart', fDebutPub);
	m_Events.AddHandler('playlist-adend', fFinPub);
	m_Events.AddHandler('playlist-broadcastvariantselected', fVariante);

	// --- Les listes ecrites a la main.
	/*
		L'heure serveur est celle d'aujourd'hui, pas une constante : le module s'en sert pour dater
		les coupures publicitaires, et une heure figee ferait passer toute coupure reelle pour une
		coupure a venir, donc ignoree.
	*/
	const variantes = (sIdBroadcast) => [
		'#EXTM3U',
		`#EXT-X-TWITCH-INFO:NODE="video-edge-banc",SERVER-TIME="${(Date.now() / 1e3).toFixed(2)}",BROADCAST-ID="${sIdBroadcast}",C="${b64('https://usher.ttvnw.net/track')}"`,
		'#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES',
		'#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked"',
		`${HOTE}/v1/playlist/chunked.m3u8`,
		'#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES',
		'#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D402A,mp4a.40.2",VIDEO="720p60"',
		`${HOTE}/v1/playlist/720p60.m3u8`,
		'#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4D401E,mp4a.40.2"',
		`${HOTE}/v1/playlist/360p.m3u8`,
	].join('\n');

	// nDebut : premier numero de sequence. aNoms : un nom par segment (ceux qui contiennent
	// « Amazon » passent pour de la publicite). oOptions porte l'en-tete fMP4 et les extras.
	const segments = (nDebut, aNoms, oOptions = {}) => {
		const aLignes = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2',
			`#EXT-X-MEDIA-SEQUENCE:${nDebut}`, `#EXT-X-TWITCH-LIVE-SEQUENCE:${5000 + nDebut}`];
		if (oOptions.sEnTete) {
			aLignes.push(`#EXT-X-MAP:URI="${oOptions.sEnTete}"`);
		}
		if (oOptions.sDateRange) {
			aLignes.push(oOptions.sDateRange);
		}
		if (oOptions.sEnPlus) {
			aLignes.push(oOptions.sEnPlus);
		}
		aNoms.forEach((sNom, idx) => {
			if (oOptions.abDiscontinuite && oOptions.abDiscontinuite[idx]) {
				aLignes.push('#EXT-X-DISCONTINUITY');
			}
			const nDuree = oOptions.anDurees ? oOptions.anDurees[idx] : 1.0;
			aLignes.push(`#EXTINF:${nDuree.toFixed(3)},${sNom}`);
			// L'adresse porte la marque, pas seulement le nom : c'est l'adresse qui atterrit dans
			// la file, donc la seule chose qu'on puisse y relire ensuite.
			aLignes.push(`${oOptions.sPrefixe || `${HOTE}/v1/segment/`}`
				+ `${m_Twitch.isAdSegment(sNom) ? 'pub-' : ''}${nDebut + idx}.ts`);
		});
		if (oOptions.bFin) {
			aLignes.push('#EXT-X-ENDLIST');
		}
		return aLignes.join('\n');
	};

	const nom = (idx) => `live-${idx}`;
	const noms = (nDebut, kCombien, fNom = nom) =>
		Array.from({ length: kCombien }, (_, i) => fNom(nDebut + i));

	/*
		Attend que le flux principal ait pris la liste servie et fini de la traiter. Pendant une
		coupure publicitaire il ne redemande qu'une fois toutes les deux secondes : le delai doit
		lui laisser ce temps-la.
	*/
	const cycle = async (kAttendus = 1, nDelaiMax = 9000) => {
		const kVise = kServiesAuPrincipal + kAttendus;
		const nFin = performance.now() + nDelaiMax;
		while (kServiesAuPrincipal < kVise && performance.now() < nFin) {
			await dormir(50);
		}
		// Le telechargement est parti ; le traitement suit dans les microtaches qui viennent.
		await dormir(120);
		return kServiesAuPrincipal >= kVise;
	};

	const maSauvegarde = g_maQueue.splice(0, g_maQueue.length);
	const segmentsEnFile = () => g_maQueue.filter((o) => typeof o.pData == 'string');
	const marqueurs = () => g_maQueue.filter((o) => typeof o.pData == 'number').map((o) => o.pData);

	try {
		m_Playlist.Stop();
		g_maQueue.splice(0, g_maQueue.length);

		// ------------------------------------------------------------------ Le premier cycle.
		// La liste doit etre plus longue que le tampon reglé, sinon il n'y a rien a laisser de cote
		// et la verification du remplissage par la fin ne verifierait rien.
		const kListe = Math.ceil(m_Settings.Get('nBufferSize')) + 6;
		sListeVariantes = variantes('B-1');
		sListeSegments = segments(100, noms(100, kListe));
		m_Playlist.Start();
		dire('un premier cycle demarre et aboutit', await cycle(1), `${kCycles} cycle(s)`);

		const oListe = aListesAnalysees[aListesAnalysees.length - 1] || {};
		dire('la duree cible et le numero de sequence sont lus',
			oListe.nTargetDuration === 2 && oListe.nSequenceNumber === 100,
			`cible ${oListe.nTargetDuration}, sequence ${oListe.nSequenceNumber}`);
		dire('tous les segments de la liste sont reconnus',
			oListe.moSegments && oListe.moSegments.length === kListe,
			`${oListe.moSegments && oListe.moSegments.length} sur ${kListe}`);
		dire('les adresses relatives sont resolues en absolues',
			oListe.moSegments[0].sAddress.startsWith('https://'),
			oListe.moSegments[0].sAddress.slice(0, 30));
		dire('aucun segment n\'est pris pour de la publicite ici', oListe.kAdSegments === 0,
			String(oListe.kAdSegments));

		dire('un debut de transmission est marque dans la file',
			marqueurs().includes(STATE_BROADCAST_START), marqueurs().join(','));
		dire('la variante choisie est annoncee',
			aEvenements.some(([s, k]) => s === 'variant' && k === 3),
			JSON.stringify(aEvenements.slice(0, 3)));

		// La file ne prend pas toute la liste : elle remonte depuis la fin.
		const kPremiers = segmentsEnFile().length;
		dire('la file est remplie depuis la fin, pas depuis le debut',
			kPremiers > 0 && kPremiers < kListe, `${kPremiers} sur ${kListe}`);
		dire('et les statistiques recoivent ce compte',
			aQueued[aQueued.length - 1][0] === kPremiers,
			`${aQueued[aQueued.length - 1][0]} annonce(s)`);

		// ------------------------------------------------- Ce qui s'ajoute au cycle suivant.
		sListeSegments = segments(102, noms(102, kListe));
		dire('un second cycle aboutit', await cycle(1), `${kCycles} cycle(s)`);
		dire('seuls les segments nouveaux s\'ajoutent',
			segmentsEnFile().length === kPremiers + 2,
			`${segmentsEnFile().length} en file`);

		// --------------------------------------------------- Une duree nulle ou aberrante.
		sListeSegments = segments(110, noms(110, 4), { anDurees: [1.0, -3.0, 1.0, 9.0] });
		await cycle(1);
		const oAberrante = aListesAnalysees[aListesAnalysees.length - 1];
		dire('une duree negative est ramenee a zero, sans arreter l\'analyse',
			oAberrante.moSegments[1].nDuration === 0, String(oAberrante.moSegments[1].nDuration));
		dire('une duree plus de trois fois superieure a la cible est ramenee a zero',
			oAberrante.moSegments[3].nDuration === 0, String(oAberrante.moSegments[3].nDuration));

		// ------------------------------------------------------------- La publicite.
		const kQueuedAvant = segmentsEnFile().length;
		sListeSegments = segments(120, ['live-120', 'live-121', 'Amazon-ad-1', 'Amazon-ad-2']);
		dire('un cycle avec publicite aboutit', await cycle(1), `${kCycles} cycle(s)`);
		dire('les segments de publicite sont comptes comme tels',
			aListesAnalysees[aListesAnalysees.length - 1].kAdSegments === 2,
			String(aListesAnalysees[aListesAnalysees.length - 1].kAdSegments));
		dire('une liste qui finit par une publicite declenche le flux de secours',
			aEvenements.some(([s]) => s === 'adstart'),
			aEvenements.map(([s]) => s).join(','));
		dire('et le suivi de publicite recoit la liste, pas null',
			aSuivi.some((o) => o !== null && o !== undefined), String(aSuivi.length));
		dire('aucun segment de publicite n\'entre dans la file',
			segmentsEnFile().length !== 0 && !segmentsEnFile().some((o) => o.pData.includes('/pub-')),
			`${segmentsEnFile().filter((o) => o.pData.includes('/pub-')).length}`
			+ ` sur ${segmentsEnFile().length}`);

		// La publicite finit : la liste ne se termine plus par elle.
		sListeSegments = segments(124, noms(124, 4));
		await cycle(2);
		dire('la fin de la publicite est annoncee',
			aEvenements.some(([s]) => s === 'adend'),
			aEvenements.map(([s]) => s).join(','));

		// ------------------------------------------- Une publicite deja finie est ignoree.
		const sPassee = new Date(Date.now() - 600000).toISOString();
		sListeSegments = segments(140, noms(140, 4), {
			sDateRange: `#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="${sPassee}",DURATION=30.0,X-TV-TWITCH-AD-ROLL-TYPE="MIDROLL",X-TV-TWITCH-AD-POD-LENGTH="1",X-TV-TWITCH-AD-POD-POSITION="1"`,
		});
		await cycle(2);
		dire('une coupure publicitaire deja finie n\'est pas retenue',
			!aListesAnalysees[aListesAnalysees.length - 1].sAdType,
			`type « ${aListesAnalysees[aListesAnalysees.length - 1].sAdType} »`);

		// Une coupure en cours, elle, est retenue.
		const sMaintenant = new Date(Date.now() - 2000).toISOString();
		sListeSegments = segments(150, noms(150, 4), {
			sDateRange: `#EXT-X-DATERANGE:ID="stitched-ad-2",CLASS="twitch-stitched-ad",START-DATE="${sMaintenant}",DURATION=60.0,X-TV-TWITCH-AD-ROLL-TYPE="MIDROLL",X-TV-TWITCH-AD-POD-LENGTH="2",X-TV-TWITCH-AD-POD-POSITION="1"`,
		});
		await cycle(2);
		const oEnCours = aListesAnalysees[aListesAnalysees.length - 1];
		dire('une coupure en cours est retenue, avec son type et son compte',
			oEnCours.sAdType === 'MIDROLL' && oEnCours.kAdClips === 2,
			`${oEnCours.sAdType} ${oEnCours.kAdClips} extrait(s)`);

		// ------------------------------------------------------------------ Le chemin fMP4.
		const kAvantFmp4 = segmentsEnFile().length;
		sListeSegments = segments(200, noms(200, 6), { sEnTete: `${HOTE}/v1/map/init-a.mp4` });
		await cycle(2);
		const aFmp4 = segmentsEnFile().filter((o) => o.sInitSegmentUrl);
		dire('un segment fMP4 emporte son en-tete d\'initialisation dans la file',
			aFmp4.length > 0 && aFmp4[0].sInitSegmentUrl.endsWith('init-a.mp4'),
			String(aFmp4.length));
		dire('et les codecs et la resolution de sa variante',
			aFmp4.length > 0 && /avc1/.test(aFmp4[0].sCodecs || '')
			&& aFmp4[0].sResolution === '1920x1080',
			aFmp4.length > 0 ? `${aFmp4[0].sCodecs} ${aFmp4[0].sResolution}` : 'aucun');

		// Le meme flux, un autre en-tete : discontinuite forcee, meme si rien d'autre ne bouge.
		sListeSegments = segments(206, noms(206, 6), { sEnTete: `${HOTE}/v1/map/init-b.mp4` });
		await cycle(2);
		const aApresChangement = segmentsEnFile().filter(
			(o) => o.sInitSegmentUrl && o.sInitSegmentUrl.endsWith('init-b.mp4'));
		dire('un en-tete d\'initialisation qui change force une discontinuite',
			aApresChangement.length > 0 && aApresChangement[0].bDiscontinuity === true,
			aApresChangement.length > 0 ? String(aApresChangement[0].bDiscontinuity) : 'aucun segment');

		// ------------------------------------------------------- Une adresse qui change.
		const kAvantChaos = segmentsEnFile().length;
		sListeSegments = segments(206, noms(206, 6),
			{ sEnTete: `${HOTE}/v1/map/init-b.mp4`, sPrefixe: `${HOTE}/v1/autre/` });
		await cycle(2);
		dire('une adresse qui change pour un meme numero ne met rien en file',
			segmentsEnFile().length === kAvantChaos, `${segmentsEnFile().length} en file`);

		// ------------------------------------------------------- Un flux chiffre s'arrete.
		const kMessagesAvant = aMessages.length;
		sListeSegments = segments(300, noms(300, 4),
			{ sEnPlus: '#EXT-X-KEY:METHOD=AES-128,URI="https://exemple.ttvnw.net/cle.bin"' });
		await cycle(2);
		dire('un flux chiffre arrete le lecteur avec un message, pas un rapport',
			aMessages.length > kMessagesAvant
			&& aMessages[aMessages.length - 1][0] === 'J0219',
			aMessages.length > kMessagesAvant ? String(aMessages[aMessages.length - 1][0]) : 'aucun');

		// -------------------------------------------------------- La fin de transmission.
		const kEvenementsAvant = aEvenements.length;
		sListeSegments = segments(400, noms(400, 3), { bFin: true });
		await cycle(2, 6000);
		dire('une fin de liste met fin a la transmission',
			marqueurs().includes(STATE_BROADCAST_END), marqueurs().join(','));
		dire('et l\'annonce de variante repasse a rien',
			aEvenements.slice(kEvenementsAvant).some(([s, k]) => s === 'variant' && k === null),
			JSON.stringify(aEvenements.slice(kEvenementsAvant)));

		// ------------------------------------------------- Une liste vide n'arrete rien.
		sListeSegments = segments(500, []);
		const bTient = await cycle(1, 6000);
		dire('une liste vide ne casse pas la boucle', bTient || kCycles > 0, `${kCycles} cycle(s)`);

		// ------------------------------------------- Les listes mal formees, en dernier.
		/*
			Deux cas ou l'ordre des ecritures decide du resultat, et qu'une reecriture deplace
			facilement sans s'en apercevoir. Apres la fin de transmission, la liste des variantes
			est redemandee a chaque tour : c'est ce qui permet de lui en servir une autre ici.
		*/
		const sSansIdentifiant = variantes('B-1').replace(/,BROADCAST-ID="[^"]*"/, '');
		sListeVariantes = sSansIdentifiant;
		await cycle(2, 9000);
		const oSansId = aVariantesTriees[aVariantesTriees.length - 1] || {};
		dire('un identifiant de transmission absent reste indefini, pas vide',
			'sBroadcastId' in oSansId && oSansId.sBroadcastId === undefined,
			oSansId.sBroadcastId === undefined ? 'indefini' : `« ${oSansId.sBroadcastId} »`);
		sListeVariantes = variantes('B-1');

		// Un #EXTINF illisible : la liste n'est pas rejetee, le segment entre sans duree.
		const fCaughtVrai = m_Debug.CaughtException;
		m_Debug.CaughtException = () => {};
		try {
			const sMalFormee = segments(600, noms(600, 4)).replace('#EXTINF:1.000,live-601', '#EXTINF:abc,live-601');
			sListeSegments = sMalFormee;
			await cycle(2, 9000);
			const oMal = aListesAnalysees.filter((o) => o.nSequenceNumber === 600).pop();
			dire('un #EXTINF illisible ne fait pas rejeter la liste',
				Boolean(oMal) && oMal.moSegments.length === 4,
				oMal ? `${oMal.moSegments.length} segment(s)` : 'liste rejetee');
			dire('le segment concerne y entre sans duree',
				Boolean(oMal) && oMal.moSegments[1].nDuration === undefined,
				oMal ? String(oMal.moSegments[1].nDuration) : 'liste rejetee');
		} finally {
			m_Debug.CaughtException = fCaughtVrai;
		}
	} finally {
		m_Playlist.Stop();
		m_Events.RemoveHandler('playlist-adstart', fDebutPub);
		m_Events.RemoveHandler('playlist-adend', fFinPub);
		m_Events.RemoveHandler('playlist-broadcastvariantselected', fVariante);
		g_maQueue.splice(0, g_maQueue.length);
		g_maQueue.push(...maSauvegarde);
		m_Downloader.LoadText = oVrai.LoadText;
		m_Downloader.LoadNextSegment = oVrai.LoadNextSegment;
		m_Twitch.GetAbsoluteVariantListUrl = oVrai.GetAbsoluteVariantListUrl;
		m_Twitch.isAdSegment = oVrai.isAdSegment;
		m_Twitch.sortVariantList = oVrai.sortVariantList;
		m_Twitch.sendAdTrackingData = oVrai.sendAdTrackingData;
		m_Twitch.GetChannelUrl = oVrai.GetChannelUrl;
		m_Debug.SaveVariantList = oVrai.SaveVariantList;
		m_Debug.SaveSegmentList = oVrai.SaveSegmentList;
		m_Debug.FinishWorkAndShowMessage = oVrai.FinishWorkAndShowMessage;
		m_Statistics.SegmentsQueued = oVrai.SegmentsQueued;
		m_Statistics.SegmentListParsed = oVrai.SegmentListParsed;
		m_Statistics.segmentsSkipped = oVrai.segmentsSkipped;
		m_Controls.StopWatchingBroadcast = oVrai.StopWatchingBroadcast;
		m_Notification.ShowAss = oVrai.ShowAss;
	}

	return JSON.stringify(verdicts);
})()
