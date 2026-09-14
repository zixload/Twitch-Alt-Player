/*
	Le segment d'initialisation : le petit en-tete que reclame le chemin fMP4.

	Ecrite depuis la description du module, avant sa reecriture.

	Une liste fMP4 annonce, par `#EXT-X-MAP`, une adresse ou vivent les parametres du flux -- codecs,
	resolution, tables de decodage. Les segments media qui suivent n'ont aucun sens sans lui, et il
	ne change qu'a une discontinuite. Le module le garde donc, par adresse.

	Ce qui compte et ne se lit dans aucune signature :
	  - **`Get` rend null, pas une promesse.** Le convertisseur l'appelle depuis une boucle qui doit
	    rester synchrone ; quand les octets manquent, il gare la file et s'arrete. C'est le module
	    qui rappelle le convertisseur une fois les octets arrives ;
	  - **une seule descente par adresse.** Vingt segments de suite reclament le meme en-tete : la
	    deuxieme demande ne doit pas relancer une requete, sinon chaque changement de qualite
	    declencherait une rafale ;
	  - **un echec efface l'entree.** Sans ca, l'adresse resterait marquee « en cours » pour
	    toujours et le flux serait gele sans que rien ne leve ;
	  - le telechargement est demande avec une duree de zero seconde. C'est ce qui le fait passer
	    pour un segment -- donc recu en octets -- sans qu'il pese sur les mesures de debit.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const tourner = () => new Promise((f) => setTimeout(f, 0));

	// --- Le telechargeur de paille : on garde la main sur chaque descente.
	const aDemandes = [];
	const fLoadVrai = m_Downloader.Load;
	m_Downloader.Load = (...aArgs) => {
		const oDemande = { aArgs, fTenir: null, fRompre: null };
		oDemande.oPromesse = new Promise((fTenir, fRompre) => {
			oDemande.fTenir = fTenir;
			oDemande.fRompre = fRompre;
		});
		aDemandes.push(oDemande);
		return oDemande.oPromesse;
	};
	const fConvertirVrai = m_Transcoder.ConvertNextSegment;
	let kRappels = 0;
	m_Transcoder.ConvertNextSegment = () => { ++kRappels; };

	// Chaque passage invente ses adresses : le cache du module survit d'une sonde a l'autre.
	const sJeton = Math.random().toString(36).slice(2);
	const adresse = (sQuoi) => `https://video-edge-banc.abc.hls.ttvnw.net/v1/map/${sJeton}-${sQuoi}.mp4`;

	try {
		// --- La premiere demande.
		const sPremiere = adresse('a');
		let kAvant = aDemandes.length;
		let pRendu = m_InitSegment.Get(sPremiere);
		dire('la premiere demande ne rend rien tout de suite', pRendu === null, String(pRendu));
		dire('mais elle lance une descente', aDemandes.length - kAvant === 1,
			String(aDemandes.length - kAvant));

		const aArgs = aDemandes[aDemandes.length - 1].aArgs;
		// L'adresse porte un jeton tire au sort a chaque passage : on rapporte qu'elle est la bonne,
		// pas laquelle, sinon deux passages ne se comparent plus.
		dire('demandee en GET, a l\'adresse annoncee', aArgs[1] === 'GET' && aArgs[2] === sPremiere,
			`${aArgs[1]}, ${aArgs[2] === sPremiere ? 'celle annoncee' : 'une autre'}`);
		dire('avec un moyen de l\'annuler', aArgs[0] instanceof PromiseCancellation);
		dire('recue en octets, sans peser sur les mesures de debit', aArgs[8] === 0, String(aArgs[8]));
		dire('avec un delai d\'attente, pas une attente sans fin',
			Number.isFinite(aArgs[3]) && aArgs[3] > 1e3, `${aArgs[3]}ms`);

		// --- Pendant que ca descend.
		kAvant = aDemandes.length;
		pRendu = m_InitSegment.Get(sPremiere);
		dire('redemander pendant la descente ne rend toujours rien', pRendu === null);
		dire('et ne relance pas de descente', aDemandes.length - kAvant === 0,
			String(aDemandes.length - kAvant));

		// --- Les octets arrivent.
		const kRappelsAvant = kRappels;
		const bufOctets = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer;
		aDemandes[aDemandes.length - 1].fTenir(bufOctets);
		await tourner();

		pRendu = m_InitSegment.Get(sPremiere);
		dire('une fois arrives, les octets sont rendus',
			pRendu instanceof Uint8Array && pRendu.length === 8,
			pRendu === null ? 'null' : `${pRendu.length} octets`);
		dire('et le convertisseur est rappele : c\'est lui qui attendait',
			kRappels > kRappelsAvant, String(kRappels - kRappelsAvant));

		kAvant = aDemandes.length;
		m_InitSegment.Get(sPremiere);
		dire('une adresse deja connue ne redescend jamais', aDemandes.length - kAvant === 0,
			String(aDemandes.length - kAvant));

		// Une seconde adresse est une seconde entree : le cache n'ecrase pas la premiere.
		const sSeconde = adresse('b');
		kAvant = aDemandes.length;
		dire('une autre adresse lance sa propre descente',
			m_InitSegment.Get(sSeconde) === null && aDemandes.length - kAvant === 1,
			String(aDemandes.length - kAvant));
		aDemandes[aDemandes.length - 1].fTenir(new Uint8Array([1, 2, 3]).buffer);
		await tourner();
		dire('et les deux cohabitent',
			m_InitSegment.Get(sPremiere).length === 8 && m_InitSegment.Get(sSeconde).length === 3,
			`${m_InitSegment.Get(sPremiere).length} / ${m_InitSegment.Get(sSeconde).length}`);

		// --- L'echec.
		const sRatee = adresse('c');
		m_InitSegment.Get(sRatee);
		aDemandes[aDemandes.length - 1].fRompre('Server returned code 404');
		await tourner();

		kAvant = aDemandes.length;
		pRendu = m_InitSegment.Get(sRatee);
		dire('apres un echec, l\'adresse est reessayee au lieu de rester gelee',
			pRendu === null && aDemandes.length - kAvant === 1,
			`${aDemandes.length - kAvant} nouvelle(s) descente(s)`);
		// Celle-la reussit : l'entree ratee n'a pas laisse de trace.
		aDemandes[aDemandes.length - 1].fTenir(new Uint8Array([9, 9]).buffer);
		await tourner();
		dire('et la seconde tentative aboutit',
			m_InitSegment.Get(sRatee) !== null && m_InitSegment.Get(sRatee).length === 2,
			String(m_InitSegment.Get(sRatee) && m_InitSegment.Get(sRatee).length));

		// --- L'echec au depart, pas en route.
		const sRefusee = adresse('d');
		m_Downloader.Load = () => { throw new Error('refus immediat'); };
		let bLeve = false;
		try {
			pRendu = m_InitSegment.Get(sRefusee);
		} catch (oErreur) {
			bLeve = true;
		}
		dire('une descente refusee des le depart ne remonte pas a l\'appelant',
			!bLeve && pRendu === null, bLeve ? 'a leve' : String(pRendu));

		// Et elle n'a pas non plus laisse l'adresse marquee « en cours ».
		const aDemandes2 = [];
		m_Downloader.Load = (...aArgs2) => {
			aDemandes2.push(aArgs2);
			return new Promise(() => {});
		};
		m_InitSegment.Get(sRefusee);
		dire('elle laisse l\'adresse libre pour une prochaine fois', aDemandes2.length === 1,
			String(aDemandes2.length));
	} finally {
		m_Downloader.Load = fLoadVrai;
		m_Transcoder.ConvertNextSegment = fConvertirVrai;
	}

	return JSON.stringify(verdicts);
})()
