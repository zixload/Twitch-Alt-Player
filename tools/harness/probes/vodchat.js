/*
	Le chat d'une rediffusion, rejoue a l'heure de ce qu'on regarde.

	Ecrite depuis la description du module, avant sa relecture.

	Le module ne fait rien de visible tant que la lecture n'avance pas : la sonde tient donc elle-meme
	la position de la video -- une propriete remplacee sur l'element, rendue a la fin -- et sert les
	messages a la place de Twitch, pour juger sur ce qui se pose dans le panneau.

	Ce qui compte et ne se lit dans aucune signature :
	  - **un message ne parait pas avant son heure.** Il est recu par tranches, souvent en avance sur
	    la lecture, et attend qu'elle le rattrape ;
	  - **un saut n'est pas le fil de la lecture.** Au-dela de cinq secondes d'ecart, ce qui est
	    affiche ne raconte plus ce qu'on voit : tout est repris a la nouvelle position ;
	  - **une tranche vide ne veut pas dire la fin**, seulement qu'il n'y a rien ici : redemander la
	    meme position en boucle ne la remplirait pas ;
	  - **le texte des autres n'entre jamais dans du HTML** : un pseudonyme qui ressemble a une
	    balise reste un pseudonyme, et une couleur qui n'en est pas une n'est pas posee ;
	  - un clip n'a pas de chat a rejouer, et le panneau ne s'ouvre pas chez qui regarde sans chat.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const $ = (s) => document.querySelector(s);
	const elVideo = $('#videos-video');
	const elPanneau = $('#chatreplay');
	const elLignes = $('#chatreplay-lines');
	const lignes = () => [...elLignes.children];
	const textes = () => lignes().map((el) => el.textContent);

	const oDorigine = { nChatState: m_Settings.Get('nChatState') };
	const fVraiComments = m_Twitch.GetVideoComments;

	// La position de la video, tenue a la main : rien ne joue sur le banc.
	let nTemps = 0;
	Object.defineProperty(elVideo, 'currentTime', {
		configurable: true,
		get: () => nTemps,
		set: (n) => { nTemps = n; },
	});
	const avancer = async (n) => {
		nTemps = n;
		elVideo.dispatchEvent(new Event('timeupdate'));
		await dormir(120);
	};

	// Ce que Twitch aurait rendu. Chaque appel est note, avec la position demandee.
	const aDemandes = [];
	let fServir = null;
	m_Twitch.GetVideoComments = (sId, nOffset) => {
		aDemandes.push([sId, nOffset]);
		return Promise.resolve(fServir(nOffset));
	};
	const message = (sId, nOffset, sAuteur, aoParts, sCouleur) => ({
		sId, nOffset, sAuthor: sAuteur, sColour: sCouleur || '', aoParts,
	});
	const texte = (s) => [{ sText: s, sEmoteId: '' }];

	try {
		m_Settings.Change('nChatState', CHAT_PANEL);

		// --- Ce qui s'ouvre, et ce qui ne s'ouvre pas.
		fServir = () => ({ aoMessages: [], bMore: false });
		nTemps = 0;
		m_VodChat.Open('');
		dire('sans video, rien ne s\'ouvre', elPanneau.hidden && !m_VodChat.IsShown());

		fServir = (nOffset) => ({
			aoMessages: nOffset > 100 ? [] : [
				message('a', 5, 'Alice', texte('bonjour')),
				message('b', 12, 'Bob', [{ sText: 'salut ', sEmoteId: '' }, { sText: 'Kappa', sEmoteId: '25' }]),
				message('c', 40, 'Carl', texte('plus tard')),
			],
			bMore: true,
		});
		m_VodChat.Open('123');
		await dormir(250);
		dire('le panneau s\'ouvre sur une rediffusion', !elPanneau.hidden && m_VodChat.IsShown());
		dire('et la premiere demande part de la position lue', aDemandes.length === 1 && aDemandes[0][1] === 0,
			JSON.stringify(aDemandes));
		dire('rien ne parait avant son heure', lignes().length === 0, textes().join(' | '));

		// --- La lecture rattrape les messages, un par un.
		await avancer(6);
		dire('a six secondes, le message de cinq est la', textes().join('') .includes('Alice'),
			textes().join(' | '));
		dire('et celui de douze ne l\'est pas', !textes().join('').includes('Bob'), textes().join(' | '));
		await avancer(13);
		dire('a treize, il arrive', textes().join('').includes('Bob'), textes().join(' | '));

		// --- Ce qui se pose dans la ligne.
		const elLigneBob = lignes().find((el) => el.textContent.includes('Bob'));
		const elEmote = elLigneBob && elLigneBob.querySelector('img.chatreplay-emote');
		dire('une emote devient une image', elEmote !== null && /emoticons\/v2\/25\//.test(elEmote.src),
			elEmote ? elEmote.getAttribute('src') : 'aucune');
		dire('le temps du message est ecrit devant', /^00:00:12/.test(elLigneBob.textContent),
			elLigneBob.textContent.slice(0, 20));

		// --- Un saut reprend tout.
		let nDemandeAvant = aDemandes.length;
		await avancer(3600);
		await dormir(250);
		dire('un saut vide ce qui etait affiche', lignes().length === 0, textes().join(' | '));
		dire('et redemande a la nouvelle position',
			aDemandes.length > nDemandeAvant && aDemandes[aDemandes.length - 1][1] === 3600,
			JSON.stringify(aDemandes[aDemandes.length - 1]));

		/*
			Une tranche vide ne se redemande pas au meme endroit : elle porte le regard trente secondes
			plus loin, a 3630. La lecture doit d'abord s'en approcher a moins de la marge, d'ou les
			petits pas -- en sauter quinze d'un coup serait un deplacement, pas le fil de la lecture,
			et c'est le chemin d'a cote qui serait mesure.
		*/
		nDemandeAvant = aDemandes.length;
		await avancer(3604);
		await avancer(3608);
		dire('tant que la marge suffit, rien ne repart',
			aDemandes.length === nDemandeAvant, JSON.stringify(aDemandes.slice(nDemandeAvant)));
		await avancer(3612);
		await dormir(200);
		const aoVides = aDemandes.slice(nDemandeAvant).map(([, n]) => n);
		dire('puis la suite se demande au-dela de la tranche vide',
			aoVides.length === 1 && aoVides[0] === 3630, JSON.stringify(aoVides));

		// --- Le texte des autres reste du texte.
		m_VodChat.Close();
		fServir = () => ({
			aoMessages: [message('x', 1, '<img src=x onerror=alert(1)>', texte('<b>gras</b>'), 'javascript:1')],
			bMore: false,
		});
		nTemps = 0;
		m_VodChat.Open('456');
		await dormir(250);
		await avancer(2);
		const elLigne = lignes()[0];
		dire('un pseudonyme qui ressemble a une balise reste un texte',
			elLigne && elLigne.getElementsByTagName('img').length === 0
			&& elLigne.textContent.includes('<img src=x'), elLigne ? elLigne.innerHTML.slice(0, 60) : 'aucune ligne');
		dire('et une balise dans le message aussi',
			elLigne && elLigne.getElementsByTagName('b').length === 0 && elLigne.textContent.includes('<b>gras</b>'),
			elLigne ? elLigne.innerHTML.slice(0, 80) : 'aucune ligne');
		dire('une couleur qui n\'en est pas une n\'est pas posee',
			elLigne && $('#chatreplay-lines .chatreplay-author').style.color === '',
			elLigne ? $('#chatreplay-lines .chatreplay-author').getAttribute('style') : 'aucune');

		// --- Fermer.
		m_VodChat.Close();
		await dormir(120);
		dire('fermer vide le panneau et le cache',
			elPanneau.hidden && lignes().length === 0 && !m_VodChat.IsShown());

		// --- Sans panneau de chat, pas de chat rejoue.
		m_Settings.Change('nChatState', CHAT_HIDDEN);
		m_VodChat.Open('789');
		await dormir(200);
		dire('qui regarde sans chat n\'en recoit pas un', elPanneau.hidden && !m_VodChat.IsShown());
	} catch (oErreur) {
		dire('la sonde va jusqu\'au bout', false, String((oErreur && oErreur.stack) || oErreur).slice(0, 300));
	} finally {
		m_VodChat.Close();
		m_Twitch.GetVideoComments = fVraiComments;
		delete elVideo.currentTime;
		for (const [sNom, pValeur] of Object.entries(oDorigine)) {
			m_Settings.Change(sNom, pValeur);
		}
	}
	return JSON.stringify(verdicts);
})()
