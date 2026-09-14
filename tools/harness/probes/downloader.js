/*
	Le telechargeur : ce qu'il reessaie, ce qu'il abandonne, et ce qu'il compte.

	Ecrite depuis la description du module, avant sa reecriture.

	Le module ne fait rien d'observable a l'ecran : il rend des promesses et nourrit des compteurs.
	La sonde lui substitue donc un XMLHttpRequest de paille, qui repond ce qu'on lui dit de repondre
	et qui le fait sur-le-champ -- `Load` installe ses deux resolveurs avant d'envoyer, donc repondre
	dans `send()` est legitime et rend la sonde deterministe, sans une seule attente.

	Ce qui compte et ne se lit dans aucune signature :
	  - **un segment n'est jamais reessaye.** Texte et JSON ont droit a deux tentatives ; un segment
	    n'en a qu'une, parce qu'une seconde arriverait apres l'heure ou il devait etre joue ;
	  - **une reponse 4xx n'est jamais reessayee** : le serveur a repondu, il repondra pareil ;
	  - une annulation retire l'ecouteur d'abandon avant d'abandonner, sinon l'abandon passerait
	    pour une panne reseau et declencherait la tentative suivante ;
	  - la taille annoncee aux statistiques est une **estimation**, pas une mesure : les en-tetes
	    sont comptes, moities en HTTP/2 parce qu'ils y sont comprimes, et un corps compresse est
	    ramene a 35 %. HTTP/2 se reconnait a un `statusText` vide -- le navigateur ne transporte
	    plus de phrase de statut ;
	  - le delai d'attente d'un segment n'est pas une constante : duree x telechargements
	    simultanes x 1,15, plus huit secondes de marge ;
	  - quand la duree de tout ce qui reste a telecharger depasse le tampon, le telechargeur
	    considere la liaison perdue : il elague la file au lieu d'attendre.

	La file est celle du lecteur. La sonde se veut donc jouable sur une chaine hors direct, ou la
	file est vide ; les verifications de file mesurent des ecarts et rendent la file telle qu'elles
	l'ont trouvee.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);

	// --- Le XMLHttpRequest de paille.
	const aEnvois = [];       // une entree par appel a send()
	let aScenarios = [];      // ce que le prochain send() doit repondre

	class FauxXhr {
		constructor() {
			this._mfEcouteurs = new Map();
			this.readyState = 0;
			this.status = 0;
			this.statusText = 'OK';
			this.response = null;
			this.responseType = '';
			this.timeout = 0;
			this._oEntetesEnvoyes = {};
			this._oEntetesRecus = {};
			this._sToutesEntetes = '';
			this._bAbandonne = false;
		}
		addEventListener(sType, fHandler) {
			if (!this._mfEcouteurs.has(sType)) {
				this._mfEcouteurs.set(sType, []);
			}
			this._mfEcouteurs.get(sType).push(fHandler);
		}
		removeEventListener(sType, fHandler) {
			const af = this._mfEcouteurs.get(sType);
			if (af) {
				const idx = af.indexOf(fHandler);
				if (idx !== -1) {
					af.splice(idx, 1);
				}
			}
		}
		_Emettre(sType) {
			for (const fHandler of (this._mfEcouteurs.get(sType) || []).slice()) {
				fHandler({ target: this, type: sType });
			}
		}
		open(sMethod, sUrl) {
			this._sMethodeEnvoyee = sMethod;
			this._sAdresseEnvoyee = sUrl;
			this.readyState = 1;
		}
		setRequestHeader(sName, sValue) {
			this._oEntetesEnvoyes[sName] = sValue;
		}
		getAllResponseHeaders() {
			return this._sToutesEntetes;
		}
		getResponseHeader(sName) {
			const sCle = sName.toLowerCase();
			return sCle in this._oEntetesRecus ? this._oEntetesRecus[sCle] : null;
		}
		abort() {
			this._bAbandonne = true;
			this.readyState = 4;
			this._Emettre('abort');
		}
		send(pBody) {
			aEnvois.push({
				oRequete: this,
				sMethode: this._sMethodeEnvoyee,
				sAdresse: this._sAdresseEnvoyee,
				oEntetes: Object.assign({}, this._oEntetesEnvoyes),
				pCorps: pBody,
				nDelai: this.timeout,
				sTypeReponse: this.responseType,
			});
			const oScenario = aScenarios.shift() || { code: 200, corps: '' };
			if (oScenario.suspens) {
				// Le serveur ne repond pas encore : c'est dans cet etat qu'on annule.
				return;
			}
			if (oScenario.panne) {
				this.readyState = 4;
				this._Emettre(oScenario.panne);
				return;
			}
			// L'en-tete arrive avant le corps : c'est la que se mesure l'attente de reponse.
			this.readyState = 2;
			this._Emettre('readystatechange');
			this.status = oScenario.code;
			this.statusText = 'statusText' in oScenario ? oScenario.statusText : 'OK';
			this._oEntetesRecus = {};
			let sToutes = '';
			for (const sCle of Object.keys(oScenario.entetes || {})) {
				this._oEntetesRecus[sCle.toLowerCase()] = oScenario.entetes[sCle];
				sToutes += `${sCle.toLowerCase()}: ${oScenario.entetes[sCle]}\r\n`;
			}
			this._sToutesEntetes = sToutes;
			if (oScenario.corps === null) {
				this.response = null;
			} else if (this.responseType === 'arraybuffer') {
				this.response = new ArrayBuffer(oScenario.nOctets === undefined ? 8 : oScenario.nOctets);
			} else {
				this.response = oScenario.corps;
			}
			this.readyState = 4;
			this._Emettre('load');
		}
	}
	FauxXhr.UNSENT = 0;
	FauxXhr.OPENED = 1;
	FauxXhr.HEADERS_RECEIVED = 2;
	FauxXhr.LOADING = 3;
	FauxXhr.DONE = 4;

	const ADRESSE = 'https://video-edge-banc.abc.hls.ttvnw.net/v1/segment/essai.ts';
	const fXhrVrai = window.XMLHttpRequest;
	window.XMLHttpRequest = FauxXhr;

	// Les compteurs et le chemin media sont espionnes, jamais appeles pour de vrai.
	const oStatVrai = {
		SegmentLoaded: m_Statistics.SegmentLoaded,
		SomethingDownloaded: m_Statistics.SomethingDownloaded,
		SegmentsNotLoaded: m_Statistics.SegmentsNotLoaded,
		WindowOpened: m_Statistics.WindowOpened,
	};
	const fConvertirVrai = m_Transcoder.ConvertNextSegment;
	const aSegmentLoaded = [];
	const aSomethingDownloaded = [];
	const aSegmentsNotLoaded = [];
	let kConversions = 0;
	m_Statistics.SegmentLoaded = (...aArgs) => aSegmentLoaded.push(aArgs);
	m_Statistics.SomethingDownloaded = (...aArgs) => aSomethingDownloaded.push(aArgs);
	m_Statistics.SegmentsNotLoaded = (...aArgs) => aSegmentsNotLoaded.push(aArgs);
	m_Statistics.WindowOpened = () => false;
	m_Transcoder.ConvertNextSegment = () => { ++kConversions; };

	const remettre = () => {
		window.XMLHttpRequest = fXhrVrai;
		Object.assign(m_Statistics, oStatVrai);
		m_Transcoder.ConvertNextSegment = fConvertirVrai;
	};
	const attraper = (oPromesse) => oPromesse.then(
		(pValeur) => ({ bTenue: true, pValeur }),
		(pRaison) => ({ bTenue: false, pRaison }));

	try {
		// --- Ce qui revient au demandeur.
		aScenarios = [{ code: 200, corps: '#EXTM3U\n#EXT-X-VERSION:3' }];
		let kAvant = aEnvois.length;
		let oIssue = await attraper(
			m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('un texte revient tel quel',
			oIssue.bTenue && oIssue.pValeur === '#EXTM3U\n#EXT-X-VERSION:3',
			String(oIssue.pValeur).slice(0, 20));
		dire('et il a fallu un seul envoi', aEnvois.length - kAvant === 1,
			String(aEnvois.length - kAvant));
		dire('le type de reponse demande est du texte',
			aEnvois[aEnvois.length - 1].sTypeReponse === 'text',
			aEnvois[aEnvois.length - 1].sTypeReponse);
		dire('le delai demande est celui passe',
			aEnvois[aEnvois.length - 1].nDelai === 5000,
			String(aEnvois[aEnvois.length - 1].nDelai));

		aScenarios = [{ code: 200, corps: '{"data":{"n":7}}' }];
		oIssue = await attraper(m_Downloader.LoadJson(null, ADRESSE, 5000, 'gql', false));
		dire('un JSON revient analyse',
			oIssue.bTenue && oIssue.pValeur && oIssue.pValeur.data.n === 7,
			JSON.stringify(oIssue.pValeur));

		// Un JSON casse n'est pas une panne de reseau : rien a reessayer.
		aScenarios = [{ code: 200, corps: '{ casse' }];
		kAvant = aEnvois.length;
		oIssue = await attraper(m_Downloader.LoadJson(null, ADRESSE, 5000, 'gql', false));
		dire('un JSON illisible est rejete', !oIssue.bTenue && oIssue.pRaison === 'Failed to parse JSON',
			String(oIssue.pRaison));
		dire('et n\'est pas redemande', aEnvois.length - kAvant === 1,
			String(aEnvois.length - kAvant));

		// --- Ce qui est reessaye, et ce qui ne l'est pas.
		aScenarios = [{ panne: 'error' }, { panne: 'error' }];
		kAvant = aEnvois.length;
		oIssue = await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('une panne reseau donne droit a une seconde tentative, pas une troisieme',
			aEnvois.length - kAvant === 2, String(aEnvois.length - kAvant));
		dire('puis le demandeur est rejete', !oIssue.bTenue, String(oIssue.pRaison));

		aScenarios = [{ panne: 'timeout' }, { code: 200, corps: 'enfin' }];
		kAvant = aEnvois.length;
		oIssue = await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('une expiration se rattrape a la seconde tentative',
			oIssue.bTenue && oIssue.pValeur === 'enfin' && aEnvois.length - kAvant === 2,
			`${aEnvois.length - kAvant} envoi(s)`);

		aScenarios = [{ code: 503, corps: 'oups' }, { code: 200, corps: 'enfin' }];
		kAvant = aEnvois.length;
		oIssue = await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('une panne serveur est reessayee',
			oIssue.bTenue && oIssue.pValeur === 'enfin' && aEnvois.length - kAvant === 2,
			`${aEnvois.length - kAvant} envoi(s)`);

		aScenarios = [{ code: 403, corps: 'non' }, { code: 200, corps: 'jamais atteint' }];
		kAvant = aEnvois.length;
		oIssue = await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('une reponse 4xx n\'est jamais redemandee', aEnvois.length - kAvant === 1,
			String(aEnvois.length - kAvant));
		dire('et le code revient au demandeur',
			!oIssue.bTenue && oIssue.pRaison === 'Server returned code 403', String(oIssue.pRaison));

		// Un segment : une seule tentative, quelle que soit la panne.
		aScenarios = [{ panne: 'error' }, { code: 200, corps: '' }];
		kAvant = aEnvois.length;
		oIssue = await attraper(
			m_Downloader.Load(null, 'GET', ADRESSE, 20000, null, null, 'segment 1', false, 2.0));
		dire('un segment perdu n\'est pas redemande', aEnvois.length - kAvant === 1,
			String(aEnvois.length - kAvant));
		dire('un segment demande des octets, pas du texte',
			aEnvois[kAvant].sTypeReponse === 'arraybuffer', aEnvois[kAvant].sTypeReponse);

		// --- L'annulation.
		aScenarios = [{ suspens: true }];
		const oAnnulation = new PromiseCancellation();
		kAvant = aEnvois.length;
		const oPromesseAnnulee = attraper(
			m_Downloader.Load(oAnnulation, 'GET', ADRESSE, 20000, null, null, 'segment 2', false, 2.0));
		// Rien n'a repondu : la requete est en suspens, comme un serveur qui tarde.
		aScenarios = [{ code: 200, corps: '' }];
		oAnnulation.Cancel();
		oIssue = await oPromesseAnnulee;
		dire('une annulation rejette avec la raison convenue',
			!oIssue.bTenue && oIssue.pRaison === PromiseCancellation.REASON,
			oIssue.bTenue ? 'tenue' : String(oIssue.pRaison && oIssue.pRaison.message));
		dire('l\'abandon qui suit ne relance pas la requete', aEnvois.length - kAvant === 1,
			String(aEnvois.length - kAvant));
		dire('la requete a bien ete abandonnee', aEnvois[kAvant].oRequete._bAbandonne);

		// Annuler avant meme de demander : rien ne part.
		const oDejaAnnulee = new PromiseCancellation();
		oDejaAnnulee.Cancel();
		kAvant = aEnvois.length;
		oIssue = await attraper(
			m_Downloader.LoadText(oDejaAnnulee, ADRESSE, 5000, 'liste', false));
		dire('une demande deja annulee ne part pas',
			!oIssue.bTenue && aEnvois.length - kAvant === 0, String(aEnvois.length - kAvant));

		// --- La requete telle qu'elle part.
		aScenarios = [{ code: 200, corps: '{}' }];
		await attraper(m_Downloader.LoadJson(null, ADRESSE, 5000, 'gql', false,
			{ 'Authorization': 'OAuth abc', 'Client-Id': 'xyz' }, 'POST'));
		let oDernier = aEnvois[aEnvois.length - 1];
		dire('la methode demandee est celle employee', oDernier.sMethode === 'POST', oDernier.sMethode);
		dire('les en-tetes demandes sont poses',
			oDernier.oEntetes['Authorization'] === 'OAuth abc' && oDernier.oEntetes['Client-Id'] === 'xyz',
			Object.keys(oDernier.oEntetes).join(','));

		aScenarios = [{ code: 200, corps: '{}' }];
		const oFormulaire = new URLSearchParams({ a: '1', b: 'deux' });
		await attraper(m_Downloader.Load(null, 'POST', ADRESSE, 5000, null, oFormulaire,
			'formulaire', false, 'json'));
		oDernier = aEnvois[aEnvois.length - 1];
		dire('un formulaire part encode, avec son type declare',
			oDernier.pCorps === 'a=1&b=deux'
			&& /application\/x-www-form-urlencoded/.test(oDernier.oEntetes['Content-Type'] || ''),
			String(oDernier.pCorps));

		// --- L'adresse est verifiee avant qu'une requete existe.
		kAvant = aEnvois.length;
		let bLeve = false;
		try {
			m_Downloader.LoadText(null, 'https://exemple.invalide/liste.m3u8', 5000, 'liste', false);
		} catch (oErreur) {
			bLeve = true;
		}
		dire('une adresse hors Twitch est refusee, et rien ne part',
			bLeve && aEnvois.length - kAvant === 0, String(aEnvois.length - kAvant));

		// --- Ce que les statistiques recoivent.
		// En-tetes : 17 + statusText(2) + « content-length: 1000\r\n »(22) = 41, plus 1000 annonces.
		aScenarios = [{ code: 200, corps: 'x', entetes: { 'Content-Length': '1000' } }];
		let kAvantStat = aSomethingDownloaded.length;
		await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('la taille annoncee compte les en-tetes, pas seulement le corps',
			aSomethingDownloaded.length - kAvantStat === 1
			&& aSomethingDownloaded[aSomethingDownloaded.length - 1][0] === 1041,
			String(aSomethingDownloaded[aSomethingDownloaded.length - 1][0]));

		// HTTP/2 : pas de phrase de statut, et des en-tetes comprimes -- comptes de moitie.
		aScenarios = [{ code: 200, corps: 'x', statusText: '', entetes: { 'Content-Length': '1000' } }];
		await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('en HTTP/2 les en-tetes ne comptent qu\'a moitie',
			aSomethingDownloaded[aSomethingDownloaded.length - 1][0] === 1020,
			String(aSomethingDownloaded[aSomethingDownloaded.length - 1][0]));

		// Corps compresse, sans taille annoncee : 43 d'en-tetes + 35 % de 1000 caracteres.
		aScenarios = [{ code: 200, corps: 'y'.repeat(1000), entetes: { 'Content-Encoding': 'gzip' } }];
		await attraper(m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false));
		dire('un corps compresse est ramene a 35 %',
			aSomethingDownloaded[aSomethingDownloaded.length - 1][0] === 393,
			String(aSomethingDownloaded[aSomethingDownloaded.length - 1][0]));

		// Un delai nul veut dire « ne compte pas ceci » : c'est ainsi que les sondes de disponibilite
		// n'entrent pas dans le total telecharge.
		aScenarios = [{ code: 200, corps: 'x' }];
		kAvantStat = aSomethingDownloaded.length;
		await attraper(m_Downloader.LoadText(null, ADRESSE, 0, 'sonde', false));
		dire('une requete sans delai ne compte pas dans le total',
			aSomethingDownloaded.length - kAvantStat === 0,
			String(aSomethingDownloaded.length - kAvantStat));

		// Un segment reussi porte sa taille, sa duree et son attente de reponse.
		aScenarios = [{ code: 200, corps: 'octets', nOctets: 4096 }];
		let kAvantSeg = aSegmentLoaded.length;
		await attraper(
			m_Downloader.Load(null, 'GET', ADRESSE, 20000, null, null, 'segment 3', true, 2.0));
		let aDernierSeg = aSegmentLoaded[aSegmentLoaded.length - 1] || [];
		dire('un segment reussi rend sa taille et sa duree aux statistiques',
			aSegmentLoaded.length - kAvantSeg === 1 && aDernierSeg[0] === 4096 && aDernierSeg[1] === 2.0,
			aDernierSeg.map(String).join(' / '));
		dire('et l\'attente de reponse est mesuree, pas devinee',
			Number.isFinite(aDernierSeg[3]) && aDernierSeg[3] >= 0, String(aDernierSeg[3]));

		// Un segment perdu rend quand meme l'attente : c'est elle qui dit si le serveur repondait.
		aScenarios = [{ panne: 'error' }];
		kAvantSeg = aSegmentLoaded.length;
		await attraper(
			m_Downloader.Load(null, 'GET', ADRESSE, 20000, null, null, 'segment 4', true, 2.0));
		aDernierSeg = aSegmentLoaded[aSegmentLoaded.length - 1] || [];
		dire('un segment perdu signale quand meme son attente',
			aSegmentLoaded.length - kAvantSeg === 1 && Number.isNaN(aDernierSeg[0]),
			aDernierSeg.map(String).join(' / '));

		// Sans journal, l'attente n'est pas mesuree du tout.
		aScenarios = [{ code: 200, corps: 'octets', nOctets: 16 }];
		await attraper(
			m_Downloader.Load(null, 'GET', ADRESSE, 20000, null, null, 'segment 5', false, 2.0));
		aDernierSeg = aSegmentLoaded[aSegmentLoaded.length - 1] || [];
		dire('sans journal, l\'attente n\'est pas mesuree',
			Number.isNaN(aDernierSeg[3]), String(aDernierSeg[3]));

		// --- La file : ce qui part, et combien a la fois.
		const nSimultanes = m_Settings.Get('nConcurrentDownloads');
		const nMaxTampon = m_Settings.Get('nMaxBufferSize');
		const nEtirement = m_Settings.Get('nBufferStretch');

		// On met la vraie file de cote le temps d'un bloc synchrone : aucune reponse en vol ne peut
		// s'y glisser, et elle est rendue intacte avant la moindre attente.
		const maSauvegarde = g_maQueue.splice(0, g_maQueue.length);
		let kEnvoyes = 0;
		let kConversionsAvant = kConversions;
		let oErreurFile = null;
		try {
			aScenarios = [];
			for (let idx = 0; idx < nSimultanes + 3; ++idx) {
				g_maQueue.push(new Segment(PROCESSING_AWAITING_DOWNLOAD, `${ADRESSE}?n=${idx}`, 2.0, false));
			}
			kAvant = aEnvois.length;
			m_Downloader.LoadNextSegment();
			kEnvoyes = aEnvois.length - kAvant;
		} catch (oErreur) {
			oErreurFile = oErreur;
		} finally {
			g_maQueue.splice(0, g_maQueue.length);
			g_maQueue.push(...maSauvegarde);
		}
		dire('la file n\'envoie que le nombre de telechargements simultanes regle',
			oErreurFile === null && kEnvoyes === nSimultanes,
			`${kEnvoyes} envoi(s) pour ${nSimultanes} autorise(s)`);
		dire('et elle pousse ensuite le convertisseur',
			kConversions > kConversionsAvant, String(kConversions - kConversionsAvant));

		// Le delai d'un segment suit sa duree, pas une constante.
		const oEnvoiSegment = aEnvois[aEnvois.length - 1];
		dire('le delai d\'un segment suit sa duree et le nombre de telechargements simultanes',
			oEnvoiSegment.nDelai === (2.0 * nSimultanes * 1.15 + 8) * 1e3,
			`${oEnvoiSegment.nDelai}ms`);

		// Trop a telecharger d'un coup : la liaison est jugee perdue et la file est elaguee.
		const maSauvegarde2 = g_maQueue.splice(0, g_maQueue.length);
		let kRestants = -1;
		let kNonCharges = aSegmentsNotLoaded.length;
		let oErreurElagage = null;
		try {
			aScenarios = [];
			const kTrop = Math.ceil((nMaxTampon + nEtirement) / 2.0) + 2;
			for (let idx = 0; idx < kTrop; ++idx) {
				g_maQueue.push(new Segment(PROCESSING_AWAITING_DOWNLOAD, `${ADRESSE}?t=${idx}`, 2.0, false));
			}
			m_Downloader.LoadNextSegment();
			kRestants = g_maQueue.length;
		} catch (oErreur) {
			oErreurElagage = oErreur;
		} finally {
			g_maQueue.splice(0, g_maQueue.length);
			g_maQueue.push(...maSauvegarde2);
		}
		dire('une file trop longue est elaguee au lieu d\'etre attendue',
			oErreurElagage === null && kRestants >= 0 && kRestants < Math.ceil((nMaxTampon + nEtirement) / 2.0) + 2,
			`${kRestants} restant(s)`);
		dire('et l\'elagage est signale aux statistiques',
			aSegmentsNotLoaded.length > kNonCharges
			&& aSegmentsNotLoaded[aSegmentsNotLoaded.length - 1][0] > 0,
			String(aSegmentsNotLoaded.length - kNonCharges));

		// Un changement de variante en queue de file jette ce qui precede et n'envoie rien.
		const maSauvegarde3 = g_maQueue.splice(0, g_maQueue.length);
		let kApresVariante = -1;
		let kEnvoisVariante = -1;
		let oErreurVariante = null;
		try {
			aScenarios = [];
			g_maQueue.push(new Segment(PROCESSING_AWAITING_DOWNLOAD, `${ADRESSE}?v=0`, 2.0, false));
			g_maQueue.push(new Segment(PROCESSING_AWAITING_DOWNLOAD, `${ADRESSE}?v=1`, 2.0, false));
			g_maQueue.push(new Segment(PROCESSING_DOWNLOADED, STATE_VARIANT_CHANGE, 0, true));
			kAvant = aEnvois.length;
			m_Downloader.LoadNextSegment();
			kEnvoisVariante = aEnvois.length - kAvant;
			kApresVariante = g_maQueue.length;
		} catch (oErreur) {
			oErreurVariante = oErreur;
		} finally {
			g_maQueue.splice(0, g_maQueue.length);
			g_maQueue.push(...maSauvegarde3);
		}
		dire('un changement de variante en fin de file jette ce qui precede',
			oErreurVariante === null && kApresVariante === 1,
			`${kApresVariante} restant(s)`);
		dire('et rien de nouveau n\'est telecharge pendant ce temps',
			kEnvoisVariante === 0, String(kEnvoisVariante));

		// --- Le travail termine ferme la porte.
		const bTermineAvant = g_bWorkFinished;
		kAvant = aEnvois.length;
		let bLeveApresFin = false;
		try {
			g_bWorkFinished = true;
			m_Downloader.LoadText(null, ADRESSE, 5000, 'liste', false);
		} catch (oErreur) {
			bLeveApresFin = true;
		} finally {
			g_bWorkFinished = bTermineAvant;
		}
		dire('une fois le travail termine, plus rien ne part',
			bLeveApresFin && aEnvois.length - kAvant === 0, String(aEnvois.length - kAvant));
	} catch (oErreur) {
		// Une reecriture fautive peut arreter le lecteur en cours de route. On rend quand meme les
		// verdicts deja rassembles : ce sont eux qui disent ou ca s'est arrete.
		dire("la sonde va jusqu'au bout", false,
			oErreur === undefined ? "le lecteur s'est arrete" : String((oErreur && oErreur.message) || oErreur));
	} finally {
		remettre();
	}

	return JSON.stringify(verdicts);
})()
