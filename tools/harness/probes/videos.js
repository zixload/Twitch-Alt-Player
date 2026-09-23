/*
	L'onglet Videos : parcourir et lire les videos de la chaine sans perdre le direct.

	Ecrite depuis la description de la fonctionnalite, avant son code. Elle demande une chaine en
	direct qui a des rediffusions publiques.

	Ce qui doit etre vrai :
	  - un bouton « Videos » dans la barre de chaine ouvre une vue posee sur la zone video ;
	  - **le direct ne s'arrete pas** : il continue, reduit dans un coin, et un clic dessus le ramene ;
	  - quatre onglets -- rediffusions, extraits, mises en ligne, clips -- listent des vignettes avec
	    duree, titre, date et vues, et « Plus » charge la suite ;
	  - cliquer une vignette lit la video en haut de la vue ; le direct se tait pendant ce temps et
	    retrouve son volume au retour ;
	  - une rediffusion reservee aux abonnes le dit, au lieu d'un lecteur noir ;
	  - tant que la vue est ouverte, les raccourcis du direct ne s'appliquent pas, sauf Echap qui la
	    ferme ; la molette ne touche pas au volume du direct ;
	  - la miniature se deplace.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : String(detail)]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
	const attendre = async (f, ms) => {
		const t = performance.now() + ms;
		while (!f() && performance.now() < t) {
			await dormir(100);
		}
		return f();
	};
	const $ = (s) => document.querySelector(s);
	const eye = document.getElementById('eye');
	const rect = (el) => el.getBoundingClientRect();
	const touche = (nCode, elCible) => {
		const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'keyCode', { get: () => nCode });
		(elCible || document).dispatchEvent(e);
		return e;
	};
	const cartes = () => [...document.querySelectorAll('#videos-grid .videos-card')];
	const vueOuverte = () => document.body.classList.contains('videosopen') && !$('#videos').hidden;

	const oVrai = {
		GetChannelVideos: m_Twitch.GetChannelVideos,
		GetChannelClips: m_Twitch.GetChannelClips,
		GetVideoPlaybackUrl: m_Twitch.GetVideoPlaybackUrl,
		resolveVodQualities: TwitchNoSub.resolveVodQualities,
	};
	const bMuteReglage = m_Settings.Get('bMute');
	const nVolumeReglage = m_Settings.Get('nVolume2');

	try {
		dire('le direct joue au depart', await attendre(() => m_Controls.GetState() === STATE_PLAYING && !eye.paused, 25000));

		// ------------------------------------------------------------------ L'entree.
		const elBouton = $('#alt-cb-videos');
		dire('un bouton Videos est dans la barre de chaine', elBouton && !elBouton.hidden);
		if (!elBouton) {
			return JSON.stringify(verdicts);
		}
		elBouton.click();
		dire('il ouvre la vue des videos', await attendre(vueOuverte, 2000));

		// ---------------------------------------------------------- Le direct, reduit.
		const t0 = eye.currentTime;
		await dormir(2000);
		dire('le direct continue de jouer', !eye.paused && eye.currentTime > t0 + 1);
		const rPlayer = rect($('#player'));
		const rEye = rect(eye);
		dire('reduit en miniature', rEye.width > 0 && rEye.width <= rPlayer.width * 0.4,
			rEye.width <= rPlayer.width * 0.4 ? 'reduit' : 'pleine taille');
		dire('dans le coin en bas a droite', Math.abs(rPlayer.right - rEye.right) < 48 && Math.abs(rPlayer.bottom - rEye.bottom) < 48);
		const rMini = rect($('#videos-mini'));
		dire('une zone cliquable recouvre la miniature', !$('#videos-mini').hidden
			&& Math.abs(rMini.left - rEye.left) < 2 && Math.abs(rMini.width - rEye.width) < 2);
		dire('la vue passe sous la miniature', rect($('#videos')).width > rPlayer.width * 0.9);

		// --------------------------------------------------------------- La liste reelle.
		const elOnglet = (s) => $(`[data-videos-tab="${s}"]`);
		dire('les rediffusions sont l\'onglet par defaut', elOnglet('ARCHIVE') && elOnglet('ARCHIVE').getAttribute('aria-selected') === 'true');
		dire('quatre onglets', ['ARCHIVE', 'HIGHLIGHT', 'UPLOAD', 'CLIPS'].every((s) => elOnglet(s)));
		dire('les rediffusions de la chaine arrivent', await attendre(() => cartes().length > 0, 15000));
		// La rediffusion en cours d'enregistrement n'a pas encore d'image : on juge sur une terminee.
		const elCarte = cartes().find((el) => !el.querySelector('.videos-live'));
		dire('une vignette porte image, duree, titre et informations', elCarte
			&& elCarte.querySelector('img') && elCarte.querySelector('img').getAttribute('src')
			&& elCarte.querySelector('.videos-duration').textContent.trim() !== ''
			&& elCarte.querySelector('.videos-title').textContent.trim() !== ''
			&& elCarte.querySelector('.videos-meta').textContent.trim() !== '');

		// --------------------------------------------- Format, pagination, vide, erreur.
		const aDemandes = [];
		const nDate = Date.UTC(2026, 0, 15, 12);
		const video = (sId, oPlus = {}) => Object.assign({ sKind: 'video', sId, sTitle: `Titre ${sId}`, nDuration: 3723, kViews: 12345, nDate, sThumbnail: 'https://static-cdn.jtvnw.net/x.jpg', sGame: 'Jeu', bRecording: false }, oPlus);
		m_Twitch.GetChannelVideos = (sType, sCursor) => {
			aDemandes.push([sType, sCursor]);
			if (sType === 'HIGHLIGHT') {
				return Promise.resolve(sCursor ? { aoItems: [video('v2', { bRecording: true })], sCursor: null } : { aoItems: [video('v1')], sCursor: 'c1' });
			}
			if (sType === 'UPLOAD') {
				return Promise.resolve({ aoItems: [], sCursor: null });
			}
			return Promise.reject('reseau');
		};
		m_Twitch.GetChannelClips = (sCursor) => {
			aDemandes.push(['CLIPS', sCursor]);
			return Promise.resolve({ aoItems: [video('clip-a', { sKind: 'clip', nDuration: 42 })], sCursor: null });
		};

		elOnglet('HIGHLIGHT').click();
		await attendre(() => cartes().length === 1 && cartes()[0].dataset.videoId === 'v1', 3000);
		dire('changer d\'onglet demande ce type, depuis le debut', aDemandes[0] && aDemandes[0][0] === 'HIGHLIGHT' && aDemandes[0][1] === null,
			JSON.stringify(aDemandes[0]));
		dire('et le marque choisi', elOnglet('HIGHLIGHT').getAttribute('aria-selected') === 'true' && elOnglet('ARCHIVE').getAttribute('aria-selected') === 'false');
		const c1 = cartes()[0];
		dire('la duree est ecrite comme sur Twitch, secondes comprises', c1 && c1.querySelector('.videos-duration').textContent === '1:02:03',
			c1 && c1.querySelector('.videos-duration').textContent);
		dire('les vues et la date sont formatees', c1 && c1.querySelector('.videos-meta').textContent.includes(m_i18n.FormatNumber(12345))
			&& c1.querySelector('.videos-meta').textContent.includes(m_i18n.FormatDate(nDate)), c1 && c1.querySelector('.videos-meta').textContent);
		const elPlus = $('#videos-more');
		dire('une suite existe : « Plus » est propose', elPlus && !elPlus.hidden);
		elPlus.click();
		await attendre(() => cartes().length === 2, 3000);
		dire('« Plus » demande la suite avec le curseur, et l\'ajoute', aDemandes[1] && aDemandes[1][1] === 'c1' && cartes().length === 2,
			`${cartes().length} vignette(s)`);
		dire('sans suite, « Plus » disparait', elPlus.hidden);
		dire('une rediffusion en cours d\'enregistrement est marquee en direct', cartes()[1] && cartes()[1].querySelector('.videos-live') !== null);

		elOnglet('UPLOAD').click();
		await attendre(() => !$('#videos-status').hidden, 3000);
		dire('un onglet vide le dit', cartes().length === 0 && !$('#videos-status').hidden && $('#videos-status').textContent.trim() !== '');
		elOnglet('ARCHIVE').click();
		await attendre(() => $('#videos-status').classList.contains('videos-error'), 3000);
		dire('une erreur de chargement le dit', cartes().length === 0 && $('#videos-status').classList.contains('videos-error'));
		elOnglet('CLIPS').click();
		await attendre(() => cartes().length === 1, 3000);
		dire('l\'onglet des clips liste des clips', cartes()[0] && cartes()[0].dataset.clipSlug === 'clip-a', cartes()[0] && JSON.stringify(cartes()[0].dataset));
		dire('un clip de 42 s affiche 0:42', cartes()[0] && cartes()[0].querySelector('.videos-duration').textContent === '0:42',
			cartes()[0] && cartes()[0].querySelector('.videos-duration').textContent);

		// --------------------------------------------------- Reserve aux abonnes.
		// Rien resolu par le port ET usher qui refuse : c'est ce qui donne le message « abonnes ».
		m_Twitch.GetChannelVideos = oVrai.GetChannelVideos;
		m_Twitch.GetChannelClips = oVrai.GetChannelClips;
		TwitchNoSub.resolveVodQualities = () => Promise.resolve([]);
		m_Twitch.GetVideoPlaybackUrl = () => Promise.reject('SUBSCRIBERS_ONLY');
		elOnglet('ARCHIVE').click();
		await attendre(() => cartes().length > 0, 15000);
		cartes().find((el) => !el.querySelector('.videos-live')).click();
		await attendre(() => !$('#videos-stage').hidden && $('#videos-nowplaying').classList.contains('videos-error'), 5000);
		dire('une rediffusion reservee aux abonnes le dit', !$('#videos-stage').hidden && $('#videos-nowplaying').classList.contains('videos-error')
			&& $('#videos-nowplaying').textContent.trim() !== '');
		dire('et le direct garde son son', eye.muted === bMuteReglage);
		TwitchNoSub.resolveVodQualities = oVrai.resolveVodQualities;
		m_Twitch.GetVideoPlaybackUrl = oVrai.GetVideoPlaybackUrl;

		// --------------------------------------------------------- Lire une rediffusion.
		const elAJouer = cartes().find((el) => !el.querySelector('.videos-live'));
		const sTitre = elAJouer.querySelector('.videos-title').textContent;
		elAJouer.click();
		const elVideo = $('#videos-video');
		dire('cliquer une rediffusion la lit en haut de la vue', await attendre(() => !$('#videos-stage').hidden && elVideo.currentTime > 2, 30000),
			`t=${elVideo.currentTime > 2 ? 'avance' : elVideo.currentTime} err=${elVideo.error && elVideo.error.code}`);
		dire('avec son titre', $('#videos-nowplaying').textContent.includes(sTitre));
		dire('le direct se tait pendant ce temps', eye.muted === true);
		dire('et continue de jouer', !eye.paused);

		// ------------------------------------------------------------- La qualite (port TwitchNoSub).
		const elQualite = $('#videos-quality');
		dire('un menu de qualite propose plusieurs qualites', !elQualite.hidden && elQualite.options.length > 1,
			`${elQualite.options.length} qualite(s)`);
		dire('la source est proposee', [...elQualite.options].some((o) => o.value === 'chunked'),
			[...elQualite.options].map((o) => o.value).join(','));
		if (elQualite.options.length > 1) {
			const sSrcAvant = elVideo.getAttribute('src');
			const sAutre = [...elQualite.options].map((o) => o.value).find((v) => v !== elQualite.value);
			elQualite.value = sAutre;
			elQualite.dispatchEvent(new Event('change'));
			dire('changer de qualite change la source lue', await attendre(() => elVideo.getAttribute('src') !== sSrcAvant, 8000),
				elVideo.getAttribute('src') !== sSrcAvant ? 'changee' : 'inchangee');
			dire('et la lecture repart', await attendre(() => elVideo.currentTime > 1, 20000), `t=${elVideo.currentTime}`);
		}

		// Un vrai clip : un fichier MP4, par un autre chemin que les rediffusions.
		elOnglet('CLIPS').click();
		await attendre(() => cartes().length > 0 && cartes()[0].dataset.clipSlug, 15000);
		cartes()[0].click();
		dire('cliquer un clip le lit aussi', await attendre(() => elVideo.currentTime > 2 && /\.mp4/.test(elVideo.getAttribute('src') || ''), 20000),
			`err=${elVideo.error && elVideo.error.code}`);
		dire('et un clip n\'a pas de menu de qualite', elQualite.hidden, `${elQualite.options.length} option(s)`);

		// ------------------------------------------------------- Raccourcis et molette.
		const nEtat = m_Controls.GetState();
		const eEspace = touche(32);
		await dormir(300);
		dire('Espace n\'arrete pas le direct pendant que la vue est ouverte', m_Controls.GetState() === nEtat && !eEspace.defaultPrevented);
		m_Settings.Change('nVolume2', 50);
		elVideo.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: rect(elVideo).left + 10, clientY: rect(elVideo).top + 10 }));
		dire('la molette ne touche pas au volume du direct', m_Settings.Get('nVolume2') === 50);

		/*
			Les fleches deplacent la video regardee. Rien ne les prenait : m_Controls s'efface des que la
			vue est ouverte, et un element video sans attribut controls n'ecoute pas le clavier.
		*/
		const nAvant = elVideo.currentTime;
		const eDroite = touche(39);
		await dormir(200);
		dire('la fleche droite avance de cinq secondes',
			Math.abs(elVideo.currentTime - (nAvant + 5)) < 1.5 && eDroite.defaultPrevented,
			`${nAvant.toFixed(1)} -> ${elVideo.currentTime.toFixed(1)}`);
		const nApres = elVideo.currentTime;
		touche(37);
		await dormir(200);
		dire('et la gauche recule de cinq secondes aussi',
			Math.abs(elVideo.currentTime - (nApres - 5)) < 1.5,
			`${nApres.toFixed(1)} -> ${elVideo.currentTime.toFixed(1)}`);

		elVideo.currentTime = 1;
		await dormir(200);
		touche(37);
		await dormir(200);
		dire('elle ne passe pas avant le debut', elVideo.currentTime >= 0 && elVideo.currentTime < 2,
			elVideo.currentTime.toFixed(1));

		const nGarde = elVideo.currentTime;
		const eMenu = touche(39, $('#videos-speed'));
		await dormir(200);
		dire('une fleche dans un menu lui appartient',
			!eMenu.defaultPrevented && Math.abs(elVideo.currentTime - nGarde) < 1.5,
			`${nGarde.toFixed(1)} -> ${elVideo.currentTime.toFixed(1)}`);

		// ------------------------------------------------------------ Deplacer la miniature.
		const rAvant = rect(eye);
		const oParams = { nodePressed: $('#videos-mini'), nodeDragging: $('#videos-mini'), nStep: 1, bCancel: false, nDeltaX: 0, nDeltaY: 0 };
		m_Events.SendEvent('dragger-drag-videos-mini', oParams);
		oParams.nStep = 2;
		oParams.nDeltaX = -120;
		oParams.nDeltaY = -60;
		m_Events.SendEvent('dragger-drag-videos-mini', oParams);
		oParams.nStep = 3;
		m_Events.SendEvent('dragger-drag-videos-mini', oParams);
		await dormir(100);
		const rApres = rect(eye);
		dire('la miniature se deplace', Math.abs(rApres.left - (rAvant.left - 120)) < 3 && Math.abs(rApres.top - (rAvant.top - 60)) < 3);
		dire('et sa zone cliquable la suit', Math.abs(rect($('#videos-mini')).left - rApres.left) < 2);

		// ------------------------------------------------------- Retour au direct.
		$('#videos-mini').click();
		await attendre(() => !vueOuverte(), 2000);
		dire('cliquer la miniature ramene le direct', !vueOuverte() && $('#videos-mini').hidden);
		dire('la rediffusion s\'arrete', elVideo.paused && !elVideo.getAttribute('src'));
		dire('le direct reprend toute la place', Math.abs(rect(eye).width - rect($('#player')).width) < 2);
		dire('et retrouve son reglage de son', eye.muted === bMuteReglage);

		elBouton.click();
		await attendre(vueOuverte, 2000);
		dire('rouvrir retrouve la liste sans lecture en cours', cartes().length > 0 && $('#videos-stage').hidden);

		// ------------------------------------------------ Redimensionner et fermer la miniature.
		const nLargeurAvant = rect(eye).width;
		const rGrip = rect($('#videos-mini-resize'));
		const gripEvt = (sType, nX) => $('#videos-mini-resize').dispatchEvent(new PointerEvent(sType, {
			bubbles: true, cancelable: true, button: 0, clientX: nX, clientY: rGrip.top + 4,
		}));
		gripEvt('pointerdown', rGrip.left + 4);
		document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rGrip.left - 100, clientY: rGrip.top + 4 }));
		document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		await dormir(100);
		dire('tirer la poignee agrandit la miniature', rect(eye).width > nLargeurAvant + 40,
			`${Math.round(nLargeurAvant)} -> ${Math.round(rect(eye).width)}`);

		$('#videos-mini-close').click();
		await dormir(100);
		dire('la croix ferme le direct dans le coin', document.body.classList.contains('videos-mini-closed')
			&& eye.offsetParent === null, `closed=${document.body.classList.contains('videos-mini-closed')}`);
		dire('mais la vue des videos reste ouverte', vueOuverte());

		const eEchap = touche(27);
		await attendre(() => !vueOuverte(), 2000);
		dire('Echap ferme la vue', !vueOuverte() && eEchap.defaultPrevented);
		elBouton.click();
		await attendre(vueOuverte, 2000);
		$('#videos-close').click();
		await attendre(() => !vueOuverte(), 2000);
		dire('le bouton de retour au direct ferme la vue', !vueOuverte());
	} catch (oErreur) {
		dire('la sonde va jusqu\'au bout', false, String((oErreur && oErreur.stack) || oErreur).slice(0, 300));
	} finally {
		m_Twitch.GetChannelVideos = oVrai.GetChannelVideos;
		m_Twitch.GetChannelClips = oVrai.GetChannelClips;
		m_Twitch.GetVideoPlaybackUrl = oVrai.GetVideoPlaybackUrl;
		TwitchNoSub.resolveVodQualities = oVrai.resolveVodQualities;
		m_Settings.Change('nVolume2', nVolumeReglage);
		if (document.body.classList.contains('videosopen') && $('#videos-close')) {
			$('#videos-close').click();
		}
	}
	return JSON.stringify(verdicts);
})()
