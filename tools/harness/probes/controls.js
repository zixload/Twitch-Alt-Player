/*
	Les commandes : ce que font les touches et les clics, l'etat de la diffusion, et l'affichage des
	metadonnees de la chaine.

	Ecrite depuis la description du module, avant sa reecriture.

	Le module aiguille : il ne fait presque rien lui-meme, il decide qui doit agir. La sonde remplace
	donc chaque destinataire par un enregistreur, declenche touches et clics, et juge sur qui a ete
	appele, avec quoi. Ce qu'il affiche lui-meme -- etat, titre, spectateurs, menu de qualite -- se
	juge dans le DOM.

	Ce qui compte et ne se lit dans aucune signature :
	  - **une touche maintenue ne repete pas les bascules.** Plein ecran, menus, chat, diffusion : la
	    repetition automatique du clavier les ferait clignoter. Seuls le volume et les deplacements
	    dans la rediffusion suivent la repetition ;
	  - **les touches de rediffusion ne font rien en direct.** Pause, vitesse, deplacement image par
	    image n'ont de sens que sur ce qui est deja enregistre ;
	  - **une touche geree n'atteint pas la page, une touche inconnue si** : le module annule le
	    comportement par defaut seulement pour ce qu'il a pris en charge ;
	  - un clic est reconnu a l'identifiant ou au nom de l'element, ou de son parent immediat : les
	    boutons portent une icone, et c'est souvent elle qu'on touche ;
	  - le volume au clavier monte de quatre et descend de deux, jamais sous le minimum ;
	  - « (source) » dans le libelle d'une qualite est traduit, et le menu se desactive quand il n'y
	    a qu'un choix.
*/
(async () => {
	const verdicts = [];
	const dire = (nom, ok, detail) => verdicts.push([nom, !!ok, detail === undefined ? '' : detail]);
	const dormir = (ms) => new Promise((f) => setTimeout(f, ms));

	// --- Les destinataires, remplaces par des enregistreurs.
	const aAppels = [];
	const aRemis = [];
	const remplacer = (oModule, sNom, sEtiquette, fRendu) => {
		const fVrai = oModule[sNom];
		aRemis.push(() => { oModule[sNom] = fVrai; });
		oModule[sNom] = (...aArgs) => {
			aAppels.push([sEtiquette, aArgs]);
			return fRendu ? fRendu(...aArgs) : undefined;
		};
	};
	const appels = (sEtiquette) => aAppels.filter(([s]) => s === sEtiquette);
	const depuis = (k) => aAppels.slice(k).map(([s, a]) => `${s}(${a.map((x) => typeof x == 'object' ? '…' : String(x)).join(',')})`);

	let bStatsOuvert = false;
	remplacer(m_FullscreenMode, 'Toggle', 'pleinecran');
	remplacer(m_FullscreenMode, 'ToggleStudio', 'studio');
	remplacer(m_PictureInPicture, 'toggle', 'pip');
	remplacer(m_Window, 'toggle', 'fenetre');
	remplacer(m_Window, 'close', 'fermerfenetre');
	remplacer(m_Chat, 'TogglePanelState', 'chat');
	remplacer(m_Chat, 'TogglePanelPosition', 'chatposition');
	remplacer(m_Statistics, 'OpenWindow', 'statsouvrir', () => { bStatsOuvert = true; });
	remplacer(m_Statistics, 'CloseWindow', 'statsfermer', () => { bStatsOuvert = false; });
	remplacer(m_Statistics, 'WindowOpened', 'statsouvert?', () => bStatsOuvert);
	remplacer(m_News, 'OpenHelp', 'aide');
	remplacer(m_News, 'OpenNews', 'nouvelles');
	remplacer(m_Twitch, 'CreateClip', 'clip');
	remplacer(m_Twitch, 'ChangeViewerChannelSubscription', 'abo');
	remplacer(m_Twitch, 'FinishCollectingBroadcastMetadata', 'finmeta');
	remplacer(m_Twitch, 'StartCollectingBroadcastMetadata', 'debutmeta');
	remplacer(m_Twitch, 'GetChannelUrl', 'adressechaine', () => 'https://www.twitch.tv/banc');
	remplacer(m_Player, 'TogglePause', 'pause');
	remplacer(m_Player, 'SeekReplayBy', 'deplacer');
	remplacer(m_Player, 'SetReplaySpeed', 'vitesse');
	remplacer(m_Player, 'ApplyVolume', 'volume');
	remplacer(m_Player, 'AddNextSegment', 'segmentsuivant');
	remplacer(m_Player, 'Reload', 'recharger');
	remplacer(m_Playlist, 'Stop', 'listestop');
	remplacer(m_Playlist, 'Start', 'listestart');
	remplacer(m_Transcoder, 'Stop', 'convstop');
	remplacer(m_AutoHide, 'Show', 'montrer');
	remplacer(m_AutoHide, 'Hide', 'cacher');
	remplacer(m_Notification, 'Show', 'notif');
	remplacer(m_Notification, 'ShowAss', 'rate');
	remplacer(m_Notification, 'ShowHappiness', 'reussi');
	const fEcrireVrai = navigator.clipboard.writeText;
	aRemis.push(() => { navigator.clipboard.writeText = fEcrireVrai; });
	navigator.clipboard.writeText = (s) => { aAppels.push(['pressepapier', [s]]); return Promise.resolve(); };

	const aEtats = [];
	const fEtat = (n) => { aEtats.push(n); };
	m_Events.AddHandler('controls-statechanged', fEtat);
	const aClics = [];
	const fClic = (o) => { aClics.push(o.sCallsign); };
	m_Events.AddHandler('controls-leftclick', fClic);

	const touche = (nCode, o = {}) => {
		const e = new KeyboardEvent(o.sType || 'keydown', {
			bubbles: true, cancelable: true, repeat: !!o.repeat,
			shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: !!o.alt,
		});
		Object.defineProperty(e, 'keyCode', { get: () => nCode });
		document.dispatchEvent(e);
		return e;
	};
	const cliquer = (sNom, o = {}) => {
		const el = document.createElement('button');
		el.name = sNom;
		el.hidden = true;
		let elCible = el;
		if (o.bEnfant) {
			elCible = el.appendChild(document.createElement('span'));
		}
		document.body.appendChild(el);
		elCible.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: o.nBouton || 0 }));
		el.remove();
	};

	// Reglages touches par la sonde, rendus a la fin.
	const oReglages = {};
	for (const s of ['nVolume2', 'bMute', 'bScaleImage']) {
		oReglages[s] = m_Settings.Get(s);
	}
	const bSansSon = document.body.classList.contains('noaudio');
	const bSansImage = document.body.classList.contains('novideo');
	const nEtatInitial = m_Controls.GetState();
	const sTitreInitial = document.title;

	try {
		// ------------------------------------------------------------- Le clavier : bascules.
		let k = aAppels.length;
		let e = touche(70);
		dire('F bascule le plein ecran', appels('pleinecran').length === 1, depuis(k).join(' '));
		dire('et une touche prise en charge n\'atteint pas la page', e.defaultPrevented);
		touche(13);
		touche(13, { alt: true });
		dire('Entree et Alt+Entree aussi', appels('pleinecran').length === 3, String(appels('pleinecran').length));
		touche(13, { shift: true });
		dire('Maj+Entree bascule l\'image dans l\'image', appels('pip').length === 1);

		k = aAppels.length;
		touche(70, { repeat: true });
		touche(70, { sType: 'keyup' });
		dire('une touche maintenue ou relachee ne rebascule pas', aAppels.length === k, depuis(k).join(' '));

		k = aAppels.length;
		e = touche(81);
		dire('une touche inconnue ne fait rien et atteint la page', aAppels.length === k && !e.defaultPrevented,
			depuis(k).join(' '));

		k = aAppels.length;
		touche(88);
		touche(86);
		touche(73);
		dire('X, V et I ouvrent menu, reglages et chaine',
			depuis(k).join(' ') === 'fenetre(mainmenu) fenetre(settings) fenetre(channel)', depuis(k).join(' '));

		k = aAppels.length;
		touche(67);
		touche(85, { ctrl: true });
		dire('C bascule le chat, Ctrl+U sa position',
			appels('chat').length === 1 && appels('chatposition').length === 1, depuis(k).join(' '));

		k = aAppels.length;
		touche(83);
		touche(83);
		dire('S ouvre puis ferme les statistiques',
			depuis(k).filter((s) => !s.startsWith('statsouvert')).join(' ') === 'statsouvrir() statsfermer()',
			depuis(k).join(' '));

		k = aAppels.length;
		touche(112);
		dire('F1 ouvre l\'aide', depuis(k).join(' ') === 'aide()', depuis(k).join(' '));

		k = aAppels.length;
		e = touche(27);
		dire('Echap ferme la fenetre ouverte et cache l\'interface',
			depuis(k).join(' ') === 'fermerfenetre(false) cacher(false)' && e.defaultPrevented, depuis(k).join(' '));

		k = aAppels.length;
		touche(88, { alt: true });
		dire('Alt+X cree un clip', depuis(k).join(' ') === 'clip()', depuis(k).join(' '));

		// ------------------------------------------------------------------ Le volume.
		document.body.classList.remove('noaudio');
		m_Settings.Change('bMute', false);
		m_Settings.Change('nVolume2', 50);
		touche(38);
		dire('fleche haut monte le volume de quatre', m_Settings.Get('nVolume2') === 54, String(m_Settings.Get('nVolume2')));
		touche(38, { repeat: true });
		dire('et suit la repetition du clavier', m_Settings.Get('nVolume2') === 58, String(m_Settings.Get('nVolume2')));
		touche(40);
		dire('fleche bas le descend de deux', m_Settings.Get('nVolume2') === 56, String(m_Settings.Get('nVolume2')));
		m_Settings.Change('nVolume2', MIN_VOLUME + 1);
		touche(40);
		touche(40);
		dire('jamais sous le minimum', m_Settings.Get('nVolume2') === MIN_VOLUME, String(m_Settings.Get('nVolume2')));
		dire('et chaque changement est applique au lecteur', appels('volume').length >= 4, String(appels('volume').length));
		dire('le curseur de volume suit', Number(document.getElementById('volume').value) === MIN_VOLUME,
			document.getElementById('volume').value);
		touche(77);
		dire('M coupe le son', m_Settings.Get('bMute') === true);
		touche(77);
		dire('M le remet', m_Settings.Get('bMute') === false);
		touche(34);
		dire('Page suivante coupe', m_Settings.Get('bMute') === true);
		touche(33);
		dire('Page precedente remet', m_Settings.Get('bMute') === false);
		document.body.classList.add('noaudio');
		m_Settings.Change('nVolume2', 50);
		touche(38);
		dire('sans piste audio, le volume ne bouge pas', m_Settings.Get('nVolume2') === 50, String(m_Settings.Get('nVolume2')));
		document.body.classList.remove('noaudio');

		// Ctrl+I : mise a l'echelle de l'image.
		const bEchelle = m_Settings.Get('bScaleImage');
		k = aAppels.length;
		touche(73, { ctrl: true });
		dire('Ctrl+I bascule la mise a l\'echelle et le dit',
			m_Settings.Get('bScaleImage') === !bEchelle
			&& document.getElementById('eye').classList.contains('scaled') === !bEchelle
			&& depuis(k).includes(`notif(svg-fullscreen-${bEchelle},false)`),
			depuis(k).join(' '));

		// -------------------------------------------------------- Rediffusion ou direct.
		m_Controls.ChangeState(STATE_PLAYING);
		k = aAppels.length;
		touche(37);
		touche(49);
		touche(187);
		dire('en direct, deplacement et vitesse ne font rien',
			!depuis(k).some((s) => /^(deplacer|vitesse)/.test(s)), depuis(k).join(' '));
		k = aAppels.length;
		touche(75);
		dire('en direct, K met la diffusion en pause', depuis(k).includes('pause()'), depuis(k).join(' '));
		k = aAppels.length;
		touche(32);
		dire('et Espace fait la meme chose, sans couper la reception',
			depuis(k).includes('pause()') && !depuis(k).some((s) => s.startsWith('listestop')),
			depuis(k).join(' '));

		m_Controls.ChangeState(STATE_REPEAT);
		k = aAppels.length;
		touche(75);
		dire('en rediffusion, K met en pause', depuis(k).includes('pause()'), depuis(k).join(' '));
		k = aAppels.length;
		touche(37);
		touche(39, { repeat: true });
		dire('les fleches deplacent de cinq secondes, repetition comprise',
			depuis(k).filter((s) => s.startsWith('deplacer')).join(' ') === 'deplacer(false,-5) deplacer(false,5)',
			depuis(k).join(' '));
		k = aAppels.length;
		touche(37, { shift: true });
		touche(39, { shift: true });
		dire('Maj+fleches deplacent de trois images en arriere, une en avant',
			depuis(k).filter((s) => s.startsWith('deplacer')).join(' ') === 'deplacer(true,-3) deplacer(true,1)',
			depuis(k).join(' '));

		const elVitesse = document.getElementById('speed');
		k = aAppels.length;
		touche(48);
		dire('0 choisit la premiere vitesse', elVitesse.selectedIndex === 0
			&& depuis(k).some((s) => s.startsWith('vitesse(')), `${elVitesse.selectedIndex} ${depuis(k).join(' ')}`);
		touche(189);
		dire('- passe a la vitesse suivante dans la liste', elVitesse.selectedIndex === 1, String(elVitesse.selectedIndex));
		touche(187);
		dire('+ revient a la precedente', elVitesse.selectedIndex === 0, String(elVitesse.selectedIndex));
		touche(187);
		dire('et ne sort pas de la liste', elVitesse.selectedIndex === 0, String(elVitesse.selectedIndex));
		const nDefaut = [...elVitesse.options].findIndex((o) => o.defaultSelected);
		elVitesse.selectedIndex = nDefaut;
		dire('la vitesse par defaut s\'affiche « 1x » et vaut 1',
			m_Controls.getReplaySpeed() === 1 && elVitesse.options[nDefaut].text === '1x',
			`${m_Controls.getReplaySpeed()} ${elVitesse.options[nDefaut].text}`);

		k = aAppels.length;
		cliquer('togglepause');
		dire('en rediffusion, le bouton pause met en pause', depuis(k).includes('pause()'), depuis(k).join(' '));
		m_Controls.ChangeState(STATE_PLAYING);
		k = aAppels.length;
		cliquer('togglepause');
		dire('en direct, le bouton pause met le direct en pause', depuis(k).includes('pause()'),
			depuis(k).join(' '));

		// ------------------------------------------------------------------ Les clics.
		k = aAppels.length;
		cliquer('togglefullscreen');
		cliquer('togglestudio');
		cliquer('togglepictureinpicture');
		cliquer('togglechat');
		cliquer('createclip');
		cliquer('openhelp');
		cliquer('opennews2');
		dire('les boutons atteignent leur destinataire',
			depuis(k).join(' ') === 'pleinecran() studio() pip() chat() clip() aide() nouvelles()',
			depuis(k).join(' '));
		dire('et chaque clic est annonce avec son nom',
			aClics.slice(-7).join(' ')
			=== 'togglefullscreen togglestudio togglepictureinpicture togglechat createclip openhelp opennews2',
			aClics.slice(-7).join(' '));

		k = aAppels.length;
		cliquer('togglefullscreen', { bEnfant: true });
		dire('un clic sur l\'icone d\'un bouton compte pour le bouton', depuis(k).join(' ') === 'pleinecran()', depuis(k).join(' '));
		k = aAppels.length;
		cliquer('togglefullscreen', { nBouton: 2 });
		dire('un clic droit ne fait rien', aAppels.length === k, depuis(k).join(' '));

		bStatsOuvert = false;
		k = aAppels.length;
		cliquer('position');
		cliquer('closestatistics');
		dire('la position ouvre les statistiques, la croix les ferme',
			depuis(k).filter((s) => !s.startsWith('statsouvert')).join(' ') === 'statsouvrir() statsfermer()',
			depuis(k).join(' '));

		k = aAppels.length;
		cliquer('copychannelurl');
		await dormir(50);
		dire('copier l\'adresse de la chaine la met dans le presse-papiers et le dit',
			depuis(k).includes('pressepapier(https://www.twitch.tv/banc)') && depuis(k).includes('reussi()'),
			depuis(k).join(' '));

		// ------------------------------------------------------------ L'etat de diffusion.
		const kEtats = aEtats.length;
		m_Controls.ChangeState(STATE_BROADCAST_END);
		m_Controls.ChangeState(STATE_BROADCAST_END);
		dire('un changement d\'etat est annonce une seule fois',
			aEtats.slice(kEtats).join(',') === String(STATE_BROADCAST_END), aEtats.slice(kEtats).join(','));
		dire('et porte sur le corps de la page', document.body.getAttribute('data-state') === String(STATE_BROADCAST_END),
			document.body.getAttribute('data-state'));
		dire('m_Controls rend l\'etat courant', m_Controls.GetState() === STATE_BROADCAST_END);
		dire('une fin de diffusion l\'affiche', document.getElementById('broadcasttype').textContent === GetText('J0145'),
			document.getElementById('broadcasttype').textContent);
		m_Controls.ChangeState(STATE_START);
		dire('un redemarrage remet le titre en attente', document.getElementById('broadcasttitle').textContent === '• • •',
			document.getElementById('broadcasttitle').textContent);

		// --------------------------------------------------------------- Les metadonnees.
		m_Events.SendEvent('twitch-channelmetadatareceived', {
			sName: 'Banc', sLanguageCode: '', kSubscribers: 1234,
			moTeams: [{ sAddress: 'https://www.twitch.tv/team/a', sName: 'A' },
				{ sAddress: 'https://www.twitch.tv/team/b', sName: 'B', sDescription: 'desc' }],
		});
		const elEquipes = document.getElementById('channel-teams');
		dire('le nom de la chaine s\'affiche et titre l\'onglet',
			document.getElementById('channel-name').textContent === 'Banc'
			&& document.title === 'Banc - Alternate Player for Twitch.tv', document.title);
		dire('une langue inconnue est cachee', document.getElementById('channel-language').parentNode.hidden);
		dire('les equipes sont des liens separes par des virgules',
			// Le separateur est une virgule suivie d'une espace demi-cadratin (U+2002), pas d'une espace.
			elEquipes.textContent === 'A, B' && elEquipes.querySelectorAll('a').length === 2,
			JSON.stringify(elEquipes.textContent) + ' ' + elEquipes.querySelectorAll('a').length);
		dire('ouverts dans un autre onglet, sans renvoyer l\'origine',
			[...elEquipes.querySelectorAll('a')].every((a) => a.target === '_blank' && a.rel === 'noopener noreferrer'),
			[...elEquipes.querySelectorAll('a')].map((a) => `${a.target}/${a.rel}`).join(' '));
		dire('une equipe decrite porte sa description en infobulle',
			elEquipes.querySelectorAll('a')[1].className === 'channel-link' && elEquipes.querySelectorAll('a')[1].title === 'desc'
			&& elEquipes.querySelectorAll('a')[0].className === '', elEquipes.querySelectorAll('a')[1].className);
		dire('et la ligne des equipes est montree', !elEquipes.parentNode.hidden,
			`${elEquipes.parentNode.tagName} hidden=${elEquipes.parentNode.hidden}`);
		m_Events.SendEvent('twitch-channelmetadatareceived', { moTeams: [] });
		dire('sans equipe, la ligne disparait', elEquipes.parentNode.hidden);

		m_Events.SendEvent('twitch-viewermetadatareceived', { nSubscription: SUBSCRIPTION_UPDATING });
		const elAbo = document.getElementById('viewer-subscription');
		dire('un abonnement en cours de changement est marque', elAbo.classList.contains('updating'));
		k = aAppels.length;
		cliquer('viewer-follow');
		dire('et bloque un second changement', !depuis(k).some((s) => s.startsWith('abo')), depuis(k).join(' '));
		m_Events.SendEvent('twitch-viewermetadatareceived', { nSubscription: SUBSCRIPTION_NOTIFY });
		dire('l\'abonnement recu s\'affiche, notifications comprises',
			!elAbo.classList.contains('updating') && elAbo.getAttribute('data-subscription') === String(SUBSCRIPTION_NOTIFY)
			&& document.getElementById('viewer-notify').checked, elAbo.getAttribute('data-subscription'));
		k = aAppels.length;
		cliquer('viewer-unfollow');
		dire('hors changement en cours, se desabonner part vers Twitch',
			depuis(k).join(' ') === `abo(${SUBSCRIPTION_NOT_SUBSCRIBED})`, depuis(k).join(' '));

		m_Events.SendEvent('twitch-broadcastmetadatareceived', {
			sBroadcastType: 'live', kViewers: 4321, sGameName: '', nBroadcastDuration: 3723000,
		});
		const elSpect = document.getElementById('viewercount');
		dire('les spectateurs s\'affichent', !elSpect.hidden && elSpect.textContent === m_i18n.FormatNumber(4321),
			elSpect.textContent);
		dire('une diffusion en direct est marquee comme telle',
			document.getElementById('broadcasttype').classList.contains('livebroadcast'));
		dire('sans categorie, la categorie est cachee', document.getElementById('broadcastcategory').hidden);
		dire('la duree de diffusion s\'affiche en HH:MM:SS',
			document.getElementById('position').textContent === formatTimecode(3723),
			document.getElementById('position').textContent);
		m_Events.SendEvent('twitch-broadcastmetadatareceived', { kViewers: -1 });
		dire('un compte de spectateurs invalide est cache', elSpect.hidden);

		// ------------------------------------------------------------ Le menu de qualite.
		const oSource = { sLabel: '1080p60 (source)' };
		m_Events.SendEvent('playlist-broadcastvariantselected', [[oSource, { sLabel: '720p60' }, { sLabel: 'audio_only' }], oSource]);
		const elMenu = document.getElementById('broadcastvariant');
		dire('le menu de qualite liste les variantes, la choisie selectionnee',
			elMenu.options.length === 3 && elMenu.selectedIndex === 0 && !elMenu.disabled, String(elMenu.options.length));
		dire('« (source) » et le son seul sont traduits',
			elMenu.options[0].text === '1080p60 ' + GetText('J0139') && elMenu.options[2].text === GetText('J0144'),
			`${elMenu.options[0].text} | ${elMenu.options[2].text}`);
		m_Events.SendEvent('playlist-broadcastvariantselected', [[oSource], oSource]);
		dire('un seul choix desactive le menu', elMenu.disabled);

		// ------------------------------------------------------------------ Les pistes.
		m_Controls.UpdateTrackCount(false, true);
		dire('sans video, la page le sait', document.body.classList.contains('novideo') && !document.body.classList.contains('noaudio'));
		m_Controls.UpdateTrackCount(true, false);
		dire('sans son aussi', !document.body.classList.contains('novideo') && document.body.classList.contains('noaudio'));

		// ---------------------------------------------------- Arreter et reprendre le direct.
		const maFile = g_maQueue.splice(0, g_maQueue.length);
		try {
			m_Controls.ChangeState(STATE_PLAYING);
			k = aAppels.length;
			dire('arreter le direct le dit', m_Controls.StopWatchingBroadcast() === true);
			dire('et arrete liste et conversion, puis passe en rediffusion',
				depuis(k).join(' ') === 'listestop() convstop() segmentsuivant()'
				&& g_maQueue.length === 1 && g_maQueue[0].pData === STATE_REPEAT, depuis(k).join(' '));
			m_Controls.ChangeState(STATE_REPEAT);
			k = aAppels.length;
			dire('deja arrete, rien a arreter', m_Controls.StopWatchingBroadcast() === false && aAppels.length === k);
			g_maQueue.splice(0, g_maQueue.length);
			touche(32);
			dire('Espace relance le direct depuis la rediffusion',
				depuis(k).join(' ').startsWith(`recharger(${STATE_START}) listestart()`), depuis(k).join(' '));
		} finally {
			g_maQueue.splice(0, g_maQueue.length);
			g_maQueue.push(...maFile);
		}
	} catch (oErreur) {
		dire('la sonde va jusqu\'au bout', false, String((oErreur && oErreur.stack) || oErreur).slice(0, 300));
	} finally {
		m_Events.RemoveHandler('controls-statechanged', fEtat);
		m_Events.RemoveHandler('controls-leftclick', fClic);
		for (const s of Object.keys(oReglages)) {
			m_Settings.Change(s, oReglages[s]);
		}
		document.getElementById('eye').classList.toggle('scaled', oReglages.bScaleImage);
		document.body.classList.toggle('noaudio', bSansSon);
		document.body.classList.toggle('novideo', bSansImage);
		m_Controls.ChangeState(nEtatInitial);
		document.title = sTitreInitial;
		for (const f of aRemis) {
			f();
		}
	}

	return JSON.stringify(verdicts);
})()
