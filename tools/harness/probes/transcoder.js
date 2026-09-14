/*
	Le convertisseur : ce qui part au fil d'execution, ce qui passe sans lui, et dans quel ordre.

	Ecrite depuis la description du module, avant sa reecriture.

	Twitch sert deux sortes de segments. La plupart des chaines envoient du MPEG-TS, que le
	navigateur ne sait pas jouer : il faut le demultiplexer et le remultiplexer en fMP4, et ce
	travail part dans un fil separe. Une minorite croissante sert deja du fMP4 : il n'y a alors rien
	a convertir, et le segment traverse le module sans jamais toucher au fil.

	Ce qui compte et ne se lit dans aucune signature :
	  - **un segment fMP4 attend que le fil soit vide.** Il se convertit sur place, instantanement,
	    alors qu'un segment parti au fil met quelques dizaines de millisecondes a revenir. Emettre
	    le fMP4 pendant ce temps le placerait avant, dans la file, un segment qui le precede dans
	    le flux -- et l'image sauterait en arriere ;
	  - **un trou dans la numerotation vaut discontinuite.** Si le segment 41 suit le 39, le 40 a
	    ete perdu : le decodeur doit etre reinitialise, sinon il essaiera de decoder par rapport a
	    une image qu'il n'a jamais vue ;
	  - **l'en-tete d'initialisation est recopie a chaque discontinuite.** Le lecteur le remet au
	    recycleur apres l'avoir empile, et le recycleur neutralise le tampon. Partager l'exemplaire
	    du cache reviendrait a le detruire a la premiere utilisation ;
	  - **les segments partent par transfert, pas par copie** : le tampon est detache au passage.
	    Quelques megaoctets par segment, plusieurs fois par seconde -- les copier se verrait ;
	  - la boucle s'arrete au premier segment pas encore descendu : la file est un ordre, pas un
	    ensemble.

	La sonde remplace le fil d'execution par un faux, et rend la file telle qu'elle l'a trouvee.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const tourner = () => new Promise((f) => setTimeout(f, 0));

	// --- Le fil d'execution de paille.
	const aPostes = [];
	let oFil = null;
	let kTerminaisons = 0;
	class FauxFil {
		constructor(sUrl) {
			this.sUrl = sUrl;
			this._mfEcouteurs = new Map();
			oFil = this;
		}
		addEventListener(sType, fHandler) {
			if (!this._mfEcouteurs.has(sType)) {
				this._mfEcouteurs.set(sType, []);
			}
			this._mfEcouteurs.get(sType).push(fHandler);
		}
		removeEventListener() {}
		postMessage(pMessage, aTransfert) {
			aPostes.push({ pMessage, aTransfert: aTransfert || null });
			// Un vrai transfert detache le tampon. On le fait pour de vrai, sinon la verification
			// du transfert ne verifierait rien.
			if (aTransfert && aTransfert.length !== 0) {
				structuredClone({ x: pMessage.pData }, { transfer: aTransfert });
			}
		}
		terminate() { ++kTerminaisons; }
		Repondre(mData) {
			for (const fHandler of (this._mfEcouteurs.get('message') || []).slice()) {
				fHandler({ data: mData });
			}
		}
	}

	const fFilVrai = window.Worker;
	window.Worker = FauxFil;

	// --- Tout ce que le module touche autour de lui.
	const oVrai = {
		SourceSegmentReceived: m_Statistics.SourceSegmentReceived,
		ConvertedSegmentReceived: m_Statistics.ConvertedSegmentReceived,
		SaveTransportStream: m_Debug.SaveTransportStream,
		SaveConvertedSegment: m_Debug.SaveConvertedSegment,
		TerminateAndSendReport: m_Debug.TerminateAndSendReport,
		FinishWorkAndShowMessage: m_Debug.FinishWorkAndShowMessage,
		Discard: m_GarbageCollector.Discard,
		AddNextSegment: m_Player.AddNextSegment,
		Get: m_InitSegment.Get,
		Here: m_Log.Here,
	};
	let kSources = 0;
	let kConvertisSignales = 0;
	let kSauvegardesTS = 0;
	let kSauvegardesConvertis = 0;
	let kSuivants = 0;
	const aJetes = [];
	const aRapports = [];
	const aMessages = [];
	const aJournal = [];
	const aDefauts = [];
	let pInitSegment = null;
	m_Statistics.SourceSegmentReceived = () => { ++kSources; };
	m_Statistics.ConvertedSegmentReceived = () => { ++kConvertisSignales; };
	m_Debug.SaveTransportStream = () => { ++kSauvegardesTS; };
	m_Debug.SaveConvertedSegment = () => { ++kSauvegardesConvertis; };
	m_Debug.TerminateAndSendReport = (...a) => { aRapports.push(a); };
	m_Debug.FinishWorkAndShowMessage = (...a) => { aMessages.push(a); };
	m_GarbageCollector.Discard = (p) => { aJetes.push(p); };
	m_Player.AddNextSegment = () => { ++kSuivants; };
	m_InitSegment.Get = () => pInitSegment;
	m_Log.Here = (s) => { aJournal.push(s); };
	const fOopsVrai = m_Log.Oops;
	m_Log.Oops = (s) => { aDefauts.push(s); return fOopsVrai.call(m_Log, s); };

	// La file du lecteur est mise de cote pour toute la duree de la sonde.
	const maSauvegarde = g_maQueue.splice(0, g_maQueue.length);
	const octets = (kTaille) => new ArrayBuffer(kTaille);
	const segmentTS = (nNumero, nDuree = 2.0, bDisc = false) => {
		const o = new Segment(PROCESSING_DOWNLOADED, octets(64), nDuree, bDisc, nNumero);
		return o;
	};
	const segmentFmp4 = (nNumero, bDisc, sCodecs) => {
		const o = new Segment(PROCESSING_DOWNLOADED, octets(64), 2.0, bDisc, nNumero);
		o.sInitSegmentUrl = 'https://video-edge-banc.abc.hls.ttvnw.net/v1/map/init.mp4';
		o.sCodecs = sCodecs;
		o.sResolution = '1920x1080';
		return o;
	};

	try {
		// --- Le fil nait du premier marqueur de debut.
		m_Transcoder.Stop();
		let kSuivantsAvant = kSuivants;
		g_maQueue.push(new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_START));
		m_Transcoder.ConvertNextSegment();
		dire('un debut de transmission cree le fil d\'execution', oFil !== null,
			oFil ? oFil.sUrl : 'aucun');
		dire('le marqueur est marque converti et reste dans la file',
			g_maQueue.length === 1 && g_maQueue[0].nProcessing === PROCESSING_CONVERTED,
			`${g_maQueue.length} dans la file`);
		dire('et le lecteur est invite a empiler la suite', kSuivants > kSuivantsAvant);

		// --- Un segment MPEG-TS part au fil, par transfert.
		const oTS = segmentTS(10);
		const bufTS = oTS.pData;
		g_maQueue.push(oTS);
		let kPostesAvant = aPostes.length;
		let kSourcesAvant = kSources;
		m_Transcoder.ConvertNextSegment();
		dire('un segment MPEG-TS part au fil d\'execution', aPostes.length - kPostesAvant === 1,
			String(aPostes.length - kPostesAvant));
		dire('il part par transfert, pas par copie',
			aPostes[aPostes.length - 1].aTransfert !== null && bufTS.byteLength === 0,
			`${bufTS.byteLength} octet(s) restant(s) a l'envoyeur`);
		dire('il quitte la file : c\'est le fil qui le detient maintenant',
			!g_maQueue.includes(oTS), `${g_maQueue.length} dans la file`);
		dire('il est compte comme segment source', kSources - kSourcesAvant === 1,
			String(kSources - kSourcesAvant));
		dire('et une copie est gardee pour le rapport de bug', kSauvegardesTS === 1,
			String(kSauvegardesTS));

		// --- Un fMP4 n'a pas le droit de doubler le segment parti au fil.
		pInitSegment = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
		const oAttente = segmentFmp4(11, false, 'avc1.4d401f,mp4a.40.2');
		g_maQueue.push(oAttente);
		kPostesAvant = aPostes.length;
		m_Transcoder.ConvertNextSegment();
		dire('un fMP4 attend tant qu\'un segment est encore au fil',
			oAttente.nProcessing === PROCESSING_DOWNLOADED && g_maQueue.includes(oAttente),
			`etat ${oAttente.nProcessing}`);

		// Le fil rend son segment : la voie est libre.
		oFil.Repondre([1, {
			pData: { mbMediaSegment: new Uint8Array([1]), nConvertedIn: 12 },
			nDuration: 2.0,
			bDiscontinuity: false,
			nNumber: 10,
		}]);
		dire('le segment converti revient et rejoint la file',
			g_maQueue.some((o) => o.nNumber === 10 && o.nProcessing === PROCESSING_CONVERTED));
		dire('et il est garde pour le rapport de bug', kSauvegardesConvertis === 1,
			String(kSauvegardesConvertis));

		let kConvertisAvant = kConvertisSignales;
		m_Transcoder.ConvertNextSegment();
		dire('le fil vide, le fMP4 passe enfin',
			oAttente.nProcessing === PROCESSING_CONVERTED, `etat ${oAttente.nProcessing}`);
		dire('et il reste a sa place dans la file, converti sur place',
			g_maQueue.includes(oAttente), `${g_maQueue.length} dans la file`);
		dire('il est signale converti aux statistiques',
			kConvertisSignales - kConvertisAvant === 1, String(kConvertisSignales - kConvertisAvant));
		dire('sans jamais passer par le fil d\'execution', aPostes.length - kPostesAvant === 0,
			String(aPostes.length - kPostesAvant));

		// --- Ce que le fMP4 raconte de lui-meme.
		dire('les codecs annonces sont lus : video et son',
			oAttente.pData.bPassthrough === true && oAttente.pData.bHasVideo && oAttente.pData.bHasAudio,
			`v=${oAttente.pData.bHasVideo} a=${oAttente.pData.bHasAudio}`);

		/*
			Attendre n'est pas un trou. Un segment gare est reexamine a chaque passage : si la
			numerotation avancait des le premier regard, il se comparerait a lui-meme au second et
			se croirait precede d'un trou -- et tout fMP4 ayant attendu ressortirait en
			discontinuite, avec un en-tete d'initialisation et une reinitialisation du decodeur
			dont il n'a pas besoin. Le journal le disait a sa facon, en annoncant un trou entre un
			numero et lui-meme.
		*/
		dire('un fMP4 qui a attendu ne ressort pas en discontinuite',
			oAttente.bDiscontinuity === false, String(oAttente.bDiscontinuity));
		dire('et le journal n\'annonce pas de trou entre un numero et lui-meme',
			!aDefauts.some((s) => /between (\d+) and \1\b/.test(s)),
			(aDefauts.find((s) => /between (\d+) and \1\b/.test(s)) || 'aucune ligne de ce genre').slice(12));
		dire('hors discontinuite, pas d\'en-tete d\'initialisation',
			!oAttente.pData.hasOwnProperty('mbInitializationSegment'));

		const oMuet = segmentFmp4(12, true, 'avc1.4d401f');
		g_maQueue.push(oMuet);
		m_Transcoder.ConvertNextSegment();
		dire('une piste video seule est reconnue comme telle',
			oMuet.pData.bHasVideo && !oMuet.pData.bHasAudio,
			`v=${oMuet.pData.bHasVideo} a=${oMuet.pData.bHasAudio}`);
		dire('a une discontinuite, l\'en-tete d\'initialisation accompagne le segment',
			oMuet.pData.mbInitializationSegment instanceof Uint8Array,
			String(oMuet.pData.mbInitializationSegment && oMuet.pData.mbInitializationSegment.length));
		dire('et c\'est une copie : le cache ne doit pas etre neutralise par le recycleur',
			oMuet.pData.mbInitializationSegment !== pInitSegment
			&& oMuet.pData.mbInitializationSegment.buffer !== pInitSegment.buffer,
			oMuet.pData.mbInitializationSegment === pInitSegment ? 'le meme objet' : 'une copie');
		dire('la discontinuite emporte aussi les codecs et la resolution',
			/avc1\.4d401f/.test(oMuet.pData.sCodecs || '') && oMuet.pData.sResolution === '1920x1080',
			`${oMuet.pData.sCodecs} ${oMuet.pData.sResolution}`);

		// --- L'en-tete manquant gare la file.
		pInitSegment = null;
		const oGare = segmentFmp4(13, false, 'avc1.4d401f,mp4a.40.2');
		g_maQueue.push(oGare);
		m_Transcoder.ConvertNextSegment();
		dire('sans en-tete d\'initialisation, le segment attend au lieu de passer faux',
			oGare.nProcessing === PROCESSING_DOWNLOADED && g_maQueue.includes(oGare),
			`etat ${oGare.nProcessing}`);
		pInitSegment = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
		m_Transcoder.ConvertNextSegment();
		dire('et il passe des que l\'en-tete arrive',
			oGare.nProcessing === PROCESSING_CONVERTED, `etat ${oGare.nProcessing}`);

		// Un vrai trou reste un vrai trou, meme quand le segment a du attendre en chemin.
		pInitSegment = null;
		const oTrouGare = segmentFmp4(oGare.nNumber + 7, false, 'avc1.4d401f,mp4a.40.2');
		g_maQueue.push(oTrouGare);
		m_Transcoder.ConvertNextSegment();
		pInitSegment = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
		m_Transcoder.ConvertNextSegment();
		dire('un segment qui a attendu ET qui suit un trou ressort bien en discontinuite',
			oTrouGare.nProcessing === PROCESSING_CONVERTED && oTrouGare.bDiscontinuity === true,
			`etat ${oTrouGare.nProcessing}, discontinuite ${oTrouGare.bDiscontinuity}`);

		// --- Un trou dans la numerotation.
		const oSaut = segmentFmp4(99, false, 'avc1.4d401f,mp4a.40.2');
		g_maQueue.push(oSaut);
		m_Transcoder.ConvertNextSegment();
		dire('un trou dans la numerotation vaut discontinuite',
			oSaut.bDiscontinuity === true, String(oSaut.bDiscontinuity));
		dire('et le segment suivant, lui, n\'en declenche pas',
			(() => {
				const oSuite = segmentFmp4(100, false, 'avc1.4d401f,mp4a.40.2');
				g_maQueue.push(oSuite);
				m_Transcoder.ConvertNextSegment();
				return oSuite.bDiscontinuity === false;
			})());

		// --- La boucle s'arrete au premier segment pas encore descendu.
		const oPasPret = new Segment(PROCESSING_AWAITING_DOWNLOAD,
			'https://video-edge-banc.abc.hls.ttvnw.net/v1/segment/x.ts', 2.0, false, 200);
		const oDerriere = segmentFmp4(201, false, 'avc1.4d401f,mp4a.40.2');
		g_maQueue.push(oPasPret, oDerriere);
		m_Transcoder.ConvertNextSegment();
		dire('la file est un ordre : rien ne double un segment pas encore descendu',
			oDerriere.nProcessing === PROCESSING_DOWNLOADED, `etat ${oDerriere.nProcessing}`);
		g_maQueue.splice(g_maQueue.indexOf(oPasPret), 1);
		g_maQueue.splice(g_maQueue.indexOf(oDerriere), 1);

		// --- Les autres sortes de messages du fil.
		const kJournalAvant = aJournal.length;
		oFil.Repondre([2, ['Here', 'Here'], ['[Worker] un', '[Worker] deux']]);
		dire('le fil peut ecrire dans le journal du lecteur',
			aJournal.length - kJournalAvant === 2
			&& aJournal[aJournal.length - 1] === '[Worker] deux',
			String(aJournal.length - kJournalAvant));

		const bufRendu = new ArrayBuffer(32);
		const kJetesAvant = aJetes.length;
		oFil.Repondre([5, bufRendu]);
		dire('le fil peut rendre un tampon au recycleur',
			aJetes.length - kJetesAvant === 1 && aJetes[aJetes.length - 1] === bufRendu,
			String(aJetes.length - kJetesAvant));

		const kRapportsAvant = aRapports.length;
		oFil.Repondre([3, 'panne du demultiplexeur', { n: 1 }]);
		dire('une panne du fil declenche un rapport', aRapports.length - kRapportsAvant === 1,
			String(aRapports.length - kRapportsAvant));

		const kMessagesAvant = aMessages.length;
		oFil.Repondre([4, 'J0219']);
		dire('et un motif d\'arret connu declenche un message, pas un rapport',
			aMessages.length - kMessagesAvant === 1
			&& aMessages[aMessages.length - 1][0] === 'J0219',
			String(aMessages.length - kMessagesAvant));

		// --- L'arret.
		const kTerminaisonsAvant = kTerminaisons;
		m_Transcoder.Stop();
		dire('arreter tue le fil d\'execution', kTerminaisons - kTerminaisonsAvant === 1,
			String(kTerminaisons - kTerminaisonsAvant));
		m_Transcoder.Stop();
		dire('et l\'arreter deux fois n\'en tue pas un second',
			kTerminaisons - kTerminaisonsAvant === 1,
			String(kTerminaisons - kTerminaisonsAvant));

		// Apres un arret, la numerotation repart de zero : le flux qui suit est un autre flux.
		g_maQueue.splice(0, g_maQueue.length);
		// Le marqueur prend un numero comme les autres : le segment qui le suit porte le suivant,
		// sinon c'est la sonde qui fabrique le trou.
		const oMarqueur = new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_START);
		g_maQueue.push(oMarqueur);
		const oApres = segmentFmp4(oMarqueur.nNumber + 1, false, 'avc1.4d401f,mp4a.40.2');
		g_maQueue.push(oApres);
		m_Transcoder.ConvertNextSegment();
		dire('apres un arret, le premier segment ne passe pas pour un trou',
			oApres.bDiscontinuity === false, String(oApres.bDiscontinuity));
	} finally {
		// On rend la file et tout ce qui a ete emprunte.
		g_maQueue.splice(0, g_maQueue.length);
		g_maQueue.push(...maSauvegarde);
		window.Worker = fFilVrai;
		m_Statistics.SourceSegmentReceived = oVrai.SourceSegmentReceived;
		m_Statistics.ConvertedSegmentReceived = oVrai.ConvertedSegmentReceived;
		m_Debug.SaveTransportStream = oVrai.SaveTransportStream;
		m_Debug.SaveConvertedSegment = oVrai.SaveConvertedSegment;
		m_Debug.TerminateAndSendReport = oVrai.TerminateAndSendReport;
		m_Debug.FinishWorkAndShowMessage = oVrai.FinishWorkAndShowMessage;
		m_GarbageCollector.Discard = oVrai.Discard;
		m_Player.AddNextSegment = oVrai.AddNextSegment;
		m_InitSegment.Get = oVrai.Get;
		m_Log.Here = oVrai.Here;
		m_Log.Oops = fOopsVrai;
		m_Transcoder.Stop();
	}

	return JSON.stringify(verdicts);
})()
