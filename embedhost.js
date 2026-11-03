"use strict";
/*
	Notre lecteur, monte dans la vraie page de Twitch a la place du sien.

	**L'iframe vit dans .persistent-player et n'en bouge jamais.** C'est le meme noeud que Twitch
	garde pour la page de la chaine, le mode cinema et le mini-lecteur des autres pages : la video
	native y survit a la navigation interne, donc la notre aussi. Deplacer une iframe dans le DOM la
	recharge ; si Twitch remplace le noeud, on en monte une neuve plutot que de la promener.

	**Le lecteur natif se tait de deux facons.** Le service worker bloque, pour cet onglet seul, le
	direct que la page demande elle-meme (voir background.js) ; ici on met sa video en pause et on la
	cache, pour les quelques secondes qu'il aurait chargees avant le blocage.

	**La barre sous l'image** porte ce que le lecteur n'a pas en facade : le mode cinema (la page
	s'assombrit autour de l'image), la vitesse et le volume au-dela de 100 %. Elle parle a l'iframe par
	postMessage ; l'iframe lui renvoie son etat, et la barre ne fait que le peindre.

	Rien de ce module ne s'appelle pendant sa construction : content.js le pilote par Mount, Away et
	Unmount, au gre des changements d'adresse.
*/
const m_EmbedHost = (() => {
	const PLAYER_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
	const TICK_INTERVAL = 500;
	// Les memes vitesses que la liste du lecteur (#speed), sans quoi il refuserait la valeur.
	const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
	const BOOST_MIN = 100;
	const BOOST_MAX = 400;
	const BOOST_STORE = 'tw5EmbedBoost';

	let _sChannel = '';
	let _bOnChannelPage = false;
	let _elFrame = null;
	let _elBar = null;
	// Les menus de la barre, accroches au body : la rangee de Twitch les enfermerait sous son titre.
	let _elPops = null;
	let _elCinema = null;
	let _bBlocked = false;
	let _nTimer = 0;
	let _nBoost = BOOST_MIN;
	let _oState = { bSpeedApplies: false, nSpeed: 1 };
	// Le salon de visionnage commun, tel que le lecteur le rapporte (modules/sync.js).
	const SYNC_STORE = 'tw5SyncRoom';
	const NO_SYNC = { sRoom: '', nMembers: 0, sStatus: '', sRoomChannel: '' };
	let _oSync = NO_SYNC;

	function log(sText) {
		m_Log.Wow(`[EmbedHost] ${sText}`);
	}

	function blockTwitchPlayer(bBlock) {
		if (_bBlocked === bBlock) {
			return;
		}
		_bBlocked = bBlock;
		log(`Twitch player blocked: ${bBlock}`);
		chrome.runtime.sendMessage({ sQuery: 'BlockTwitchPlayer', bBlock }, () => void chrome.runtime.lastError);
	}

	function findTwitchPlayer() {
		return document.querySelector('.persistent-player');
	}

	function postToPlayer(oMessage) {
		if (_elFrame && _elFrame.contentWindow) {
			_elFrame.contentWindow.postMessage({ sTw5: 'host', ...oMessage }, PLAYER_ORIGIN);
		}
	}

	// ------------------------------------------------------------------------------------------
	// L'iframe

	// Ce que l'iframe montre : une chaine en direct, ou une VOD sous la cle « video:<id>:<debut> ».
	function playerAddress(sKey) {
		const msVideo = /^video:(\d+):(\d+)$/.exec(sKey);
		return msVideo ? GetOurVideoPlayerAddress(msVideo[1], Number(msVideo[2])) : GetOurPlayerAddress(sKey);
	}

	function createFrame(elTwitchPlayer) {
		log(`Inserting player for ${_sChannel}`);
		_elFrame = document.createElement('iframe');
		_elFrame.className = 'tw5-embed';
		_elFrame.allow = 'autoplay; fullscreen; picture-in-picture; clipboard-write';
		_elFrame.allowFullscreen = true;
		_elFrame.src = playerAddress(_sChannel);
		_elFrame.dataset.tw5Channel = _sChannel;
		elTwitchPlayer.setAttribute('data-tw5-host', '');
		elTwitchPlayer.append(_elFrame);
	}

	function removeFrame() {
		if (_elFrame) {
			log('Removing player');
			_elFrame.remove();
			_elFrame = null;
		}
		const elTwitchPlayer = findTwitchPlayer();
		if (elTwitchPlayer) {
			elTwitchPlayer.removeAttribute('data-tw5-host');
		}
	}

	// Le lecteur natif a pu charger quelques secondes avant le blocage : on ne veut pas l'entendre.
	function silenceTwitchVideo(elTwitchPlayer) {
		for (const elVideo of elTwitchPlayer.querySelectorAll('video')) {
			if (!elVideo.paused) {
				elVideo.pause();
			}
		}
	}

	// ------------------------------------------------------------------------------------------
	// La barre

	// Des icones au trait, sans texte, facon Enhancer for YouTube.
	const SVG = (sPaths) => `<svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round>${sPaths}</svg>`;
	const ICON_CINEMA = SVG('<rect x=3 y=4.5 width=18 height=12.5 rx=1.5 /><path d="M8.5 20.5h7M12 17v3.5" /><path d="M10.5 8.5v5l4-2.5z" fill=currentColor stroke-width=1 />');
	const ICON_SPEED = SVG('<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0" /><path d="M12 13.5l4-4.5" /><circle cx=12 cy=13.5 r=1 fill=currentColor />');
	const ICON_SYNC = SVG('<circle cx=9 cy=8 r=3.2 /><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" /><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.6 14.6c1.8.7 3 2.4 3.4 4.9" />');
	const ICON_VOLUME = SVG('<circle cx=12 cy=12 r=1.6 fill=currentColor /><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />');

	/*
		Trois boutons ; la vitesse et le volume ouvrent chacun un petit menu sous la barre, ferme par
		un second clic, un clic ailleurs ou Echap. Un bouton allume dit qu'un reglage est en force.
	*/
	function createBar() {
		const elBar = document.createElement('div');
		elBar.className = 'tw5-bar';
		elBar.innerHTML = `
			<button type=button class=tw5-bar-button data-tw5-action=cinema>${ICON_CINEMA}</button>
			<div class=tw5-bar-slot>
				<button type=button class=tw5-bar-button data-tw5-action=speed>${ICON_SPEED}</button>
				<div class=tw5-pop data-tw5-pop=speed hidden>
					${SPEEDS.map((n) => `<button type=button class=tw5-pop-speed data-tw5-speed=${n}>${n}×</button>`).join('')}
				</div>
			</div>
			<div class=tw5-bar-slot>
				<button type=button class=tw5-bar-button data-tw5-action=boost>${ICON_VOLUME}</button>
				<div class=tw5-pop data-tw5-pop=boost hidden>
					<input class=tw5-pop-boost type=range min=${BOOST_MIN} max=${BOOST_MAX} step=10>
					<span class=tw5-pop-boost-value></span>
				</div>
			</div>
			<div class=tw5-bar-slot>
				<button type=button class=tw5-bar-button data-tw5-action=sync>${ICON_SYNC}</button>
				<div class="tw5-pop tw5-pop--column" data-tw5-pop=sync hidden>
					<div class=tw5-sync-out>
						<button type=button class=tw5-sync-primary data-tw5-sync=create></button>
						<input class=tw5-sync-code maxlength=6 spellcheck=false autocomplete=off>
					</div>
					<div class=tw5-sync-in>
						<div class=tw5-sync-head>
							<span class=tw5-sync-dot></span>
							<button type=button class=tw5-sync-room data-tw5-sync=copy></button>
							<span class=tw5-sync-members></span>
						</div>
						<div class=tw5-sync-status></div>
						<div class=tw5-sync-links>
							<button type=button class=tw5-sync-link data-tw5-sync=goto></button>
							<button type=button class=tw5-sync-link data-tw5-sync=leave></button>
						</div>
					</div>
					<div class=tw5-sync-error></div>
				</div>
			</div>`;
		elBar.querySelector('[data-tw5-action=cinema]').title = m_i18n.GetMessage('F2000');
		elBar.querySelector('[data-tw5-action=boost]').title = m_i18n.GetMessage('F2002');
		elBar.querySelector('[data-tw5-action=cinema]').addEventListener('click', () => {
			closePops();
			toggleCinema();
		});
		elBar.querySelector('[data-tw5-action=speed]').addEventListener('click', () => togglePop('speed'));
		elBar.querySelector('[data-tw5-action=boost]').addEventListener('click', () => togglePop('boost'));
		elBar.querySelector('[data-tw5-action=sync]').title = m_i18n.GetMessage('F2010');
		elBar.querySelector('[data-tw5-action=sync]').addEventListener('click', () => togglePop('sync'));
		_elPops = document.createElement('div');
		_elPops.className = 'tw5-pops';
		_elPops.append(...elBar.querySelectorAll('.tw5-pop'));
		document.body.append(_elPops);
		_elPops.querySelector('[data-tw5-pop=speed]').addEventListener('click', (oEvent) => {
			const elSpeed = oEvent.target.closest('[data-tw5-speed]');
			if (elSpeed) {
				postToPlayer({ sCommand: 'speed', nSpeed: Number.parseFloat(elSpeed.dataset.tw5Speed) });
				closePops();
			}
		});
		_elPops.querySelector('.tw5-pop-boost').addEventListener('input', (oEvent) => {
			setBoost(Number.parseInt(oEvent.target.value, 10), true);
		});
		createSyncPop(_elPops.querySelector('[data-tw5-pop=sync]'));
		return elBar;
	}

	// ------------------------------------------------------------------------------------------
	// Regarder ensemble

	function createSyncPop(elPop) {
		const TEXTS = {
			'[data-tw5-sync=create]': 'F2011',
			'[data-tw5-sync=goto]': 'F2022',
			'[data-tw5-sync=leave]': 'F2014',
		};
		for (const [sSelector, sKey] of Object.entries(TEXTS)) {
			elPop.querySelector(sSelector).textContent = m_i18n.GetMessage(sKey);
		}
		elPop.querySelector('.tw5-sync-code').placeholder = m_i18n.GetMessage('F2012');
		elPop.querySelector('[data-tw5-sync=copy]').title = m_i18n.GetMessage('F2026');
		elPop.querySelector('.tw5-sync-code').addEventListener('keydown', (oEvent) => {
			if (oEvent.key === 'Enter') {
				joinTypedRoom();
			}
		});
		elPop.addEventListener('click', (oEvent) => {
			const elAction = oEvent.target.closest('[data-tw5-sync]');
			if (!elAction) {
				return;
			}
			switch (elAction.dataset.tw5Sync) {
			case 'create':
				postToPlayer({ sCommand: 'sync-create' });
				break;
			case 'copy':
				navigator.clipboard.writeText(_oSync.sRoom).then(() => {
					elAction.title = m_i18n.GetMessage('F2027');
				}, STUB);
				break;
			case 'goto': {
				const msVideo = /^video:(\d+)$/.exec(_oSync.sRoomChannel);
				location.assign(msVideo
					? `https://www.twitch.tv/videos/${msVideo[1]}`
					: `https://www.twitch.tv/${encodeURIComponent(_oSync.sRoomChannel)}`);
				break;
			}
			case 'leave':
				sessionStorage.removeItem(SYNC_STORE);
				postToPlayer({ sCommand: 'sync-leave' });
				break;
			}
		});
	}

	function joinTypedRoom() {
		const sRoom = _elPops.querySelector('.tw5-sync-code').value.trim().toUpperCase();
		if (sRoom !== '') {
			postToPlayer({ sCommand: 'sync-join', sRoom });
		}
	}

	// Ce que le lecteur rapporte du salon ; le code est garde pour la page suivante de l'onglet.
	function takeSyncState(oSync) {
		if (!IsObject(oSync) || typeof oSync.sRoom != 'string') {
			return;
		}
		_oSync = {
			sRoom: oSync.sRoom,
			nMembers: Number.isSafeInteger(oSync.nMembers) ? oSync.nMembers : 0,
			sStatus: typeof oSync.sStatus == 'string' ? oSync.sStatus : '',
			sRoomChannel: typeof oSync.sRoomChannel == 'string' ? oSync.sRoomChannel : '',
		};
		if (_oSync.sRoom !== '') {
			sessionStorage.setItem(SYNC_STORE, _oSync.sRoom);
		}
	}

	// Une ligne seulement quand quelque chose cloche ou se fait attendre ; synchronise, le point
	// vert suffit.
	function syncStatusText() {
		const oSync = _oSync;
		switch (oSync.sStatus) {
		case 'connecting': return m_i18n.GetMessage('F2016');
		case 'adjusting':
		case 'behind': return m_i18n.GetMessage('F2018');
		case 'loading': return m_i18n.GetMessage('F2020');
		case 'channel':
			return oSync.sRoomChannel.startsWith('video:') ? m_i18n.GetMessage('F2031') : m_i18n.GetMessage('F2021', oSync.sRoomChannel);
		case 'imprecise': return m_i18n.GetMessage('F2023');
		case 'offline': return m_i18n.GetMessage('F2024');
		case 'norecording': return m_i18n.GetMessage('F2028');
		default: return '';
		}
	}

	function paintSync() {
		const elPop = _elPops.querySelector('[data-tw5-pop=sync]');
		const bIn = _oSync.sRoom !== '';
		elPop.querySelector('.tw5-sync-out').hidden = bIn;
		elPop.querySelector('.tw5-sync-in').hidden = !bIn;
		elPop.querySelector('.tw5-sync-error').hidden = _oSync.sStatus !== 'badcode';
		elPop.querySelector('.tw5-sync-error').textContent = _oSync.sStatus === 'badcode' ? m_i18n.GetMessage('F2029') : '';
		_elBar.querySelector('[data-tw5-action=sync]').classList.toggle('tw5-on', bIn);
		if (!bIn) {
			return;
		}
		elPop.querySelector('.tw5-sync-room').textContent = _oSync.sRoom;
		elPop.querySelector('.tw5-sync-members').textContent = m_i18n.GetMessage('F2030', String(_oSync.nMembers));
		const elDot = elPop.querySelector('.tw5-sync-dot');
		elDot.dataset.tw5Status = _oSync.sStatus;
		elDot.title = m_i18n.GetMessage(_oSync.sStatus === 'synced' ? 'F2017' : 'F2018');
		const elStatus = elPop.querySelector('.tw5-sync-status');
		elStatus.textContent = syncStatusText();
		elStatus.hidden = elStatus.textContent === '';
		elStatus.dataset.tw5Status = _oSync.sStatus;
		elPop.querySelector('[data-tw5-sync=goto]').hidden = _oSync.sStatus !== 'channel';
	}

	function togglePop(sName) {
		const elPop = _elPops.querySelector(`[data-tw5-pop=${sName}]`);
		const bOpen = elPop.hidden && !(sName === 'speed' && !_oState.bSpeedApplies);
		closePops();
		const elButton = _elBar.querySelector(`[data-tw5-action=${sName}]`);
		elButton.classList.toggle('tw5-open', bOpen);
		if (bOpen) {
			// Sous le bouton, bord droit sur son bord droit, sans sortir de la fenetre a gauche.
			elPop.hidden = false;
			const oButton = elButton.getBoundingClientRect();
			const nWidth = elPop.offsetWidth;
			elPop.style.top = `${Math.round(oButton.bottom + 8)}px`;
			elPop.style.left = `${Math.round(Math.max(8, oButton.right - nWidth))}px`;
		} else {
			elPop.hidden = true;
		}
	}

	function closePops() {
		if (!_elBar) {
			return;
		}
		for (const elPop of _elPops.querySelectorAll('.tw5-pop')) {
			elPop.hidden = true;
		}
		for (const elButton of _elBar.querySelectorAll('.tw5-open')) {
			elButton.classList.remove('tw5-open');
		}
	}

	function paintBar() {
		if (!_elBar) {
			return;
		}
		const elSpeed = _elBar.querySelector('[data-tw5-action=speed]');
		elSpeed.classList.toggle('tw5-unavailable', !_oState.bSpeedApplies);
		elSpeed.classList.toggle('tw5-on', _oState.nSpeed !== 1);
		elSpeed.title = m_i18n.GetMessage(_oState.bSpeedApplies ? 'F2001' : 'F2003');
		if (!_oState.bSpeedApplies) {
			_elPops.querySelector('[data-tw5-pop=speed]').hidden = true;
			elSpeed.classList.remove('tw5-open');
		}
		for (const elChoice of _elPops.querySelectorAll('[data-tw5-speed]')) {
			elChoice.classList.toggle('tw5-on', Number.parseFloat(elChoice.dataset.tw5Speed) === _oState.nSpeed);
		}
		_elBar.querySelector('[data-tw5-action=boost]').classList.toggle('tw5-on', _nBoost > BOOST_MIN);
		_elPops.querySelector('.tw5-pop-boost').value = String(_nBoost);
		_elPops.querySelector('.tw5-pop-boost-value').textContent = `${_nBoost} %`;
		_elBar.querySelector('[data-tw5-action=cinema]').classList.toggle('tw5-on', _elCinema !== null);
		paintSync();
	}

	/*
		La rangee de boutons de Twitch sous l'image (Suivre, Cadeau, S'abonner) : on remonte du bouton
		Suivre tant que son conteneur n'a que lui, la rangee est le premier parent qui a d'autres
		enfants. Pas de classe a viser : Twitch les genere.
	*/
	function findTwitchButtonRow() {
		const elFollow = document.querySelector(
			'.channel-info-content [data-a-target="follow-button"], .channel-info-content [data-a-target="unfollow-button"]'
		);
		let el = elFollow;
		while (el && el.parentElement && el.parentElement.children.length === 1) {
			el = el.parentElement;
		}
		return el && el.parentElement ? el.parentElement : null;
	}

	/*
		Nos boutons se mettent en tete de cette rangee, au style des siens : integres, pas une bande de
		plus entre l'image et la chaine. Sans rangee (Twitch a change sa page), ils retombent sous
		l'image. React ignore un enfant qu'il n'a pas cree mais peut recreer le bloc : on y revient a
		chaque tour.
	*/
	function placeBar() {
		const elInfo = _bOnChannelPage && _elFrame ? document.querySelector('.channel-root__info') : null;
		if (!elInfo) {
			if (_elBar) {
				_elBar.remove();
			}
			return;
		}
		if (!_elBar) {
			_elBar = createBar();
			paintBar();
		}
		const elRow = findTwitchButtonRow();
		const elParent = elRow || elInfo;
		_elBar.classList.toggle('tw5-bar--row', elRow !== null);
		if (_elBar.parentElement !== elParent || elParent.firstElementChild !== _elBar) {
			elParent.prepend(_elBar);
		}
	}

	// ------------------------------------------------------------------------------------------
	// Le mode cinema et le volume

	// Le trou du voile suit l'image a chaque image : la page defile, la fenetre change.
	function cutCinemaHole() {
		if (!_elCinema) {
			return;
		}
		if (_elFrame && _elFrame.isConnected) {
			const oFrame = _elFrame.getBoundingClientRect();
			const nLeft = Math.round(oFrame.left);
			const nTop = Math.round(oFrame.top);
			const nRight = Math.round(oFrame.right);
			const nBottom = Math.round(oFrame.bottom);
			const sClip = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${nLeft}px ${nTop}px, ${nRight}px ${nTop}px, ${nRight}px ${nBottom}px, ${nLeft}px ${nBottom}px, ${nLeft}px ${nTop}px)`;
			if (_elCinema.style.clipPath !== sClip) {
				_elCinema.style.clipPath = sClip;
			}
		}
		requestAnimationFrame(cutCinemaHole);
	}

	function toggleCinema(bForce) {
		const bOn = bForce === undefined ? _elCinema === null : bForce;
		if (bOn && !_elCinema && _elFrame) {
			log('Cinema mode on');
			_elCinema = document.createElement('div');
			_elCinema.className = 'tw5-cinema';
			_elCinema.addEventListener('click', () => toggleCinema(false));
			document.body.append(_elCinema);
			cutCinemaHole();
		} else if (!bOn && _elCinema) {
			log('Cinema mode off');
			_elCinema.remove();
			_elCinema = null;
		}
		paintBar();
	}

	function setBoost(nBoost, bSave) {
		_nBoost = Math.min(Math.max(Math.round(nBoost), BOOST_MIN), BOOST_MAX);
		postToPlayer({ sCommand: 'boost', nBoost: _nBoost / 100 });
		if (bSave) {
			chrome.storage.local.set({ [BOOST_STORE]: _nBoost });
		}
		paintBar();
	}

	/*
		Le mode cinema de Twitch, celui qui garde le chat a cote : c'est ce que devient le mode studio
		du lecteur dans la page. Le bouton natif n'existe que pendant que ses commandes sont affichees,
		donc on passe par son raccourci, Alt+T.
	*/
	function toggleTwitchTheatre() {
		log('Toggling Twitch theatre mode');
		const oInit = { key: 't', code: 'KeyT', keyCode: 84, which: 84, altKey: true, bubbles: true, cancelable: true };
		document.body.dispatchEvent(new KeyboardEvent('keydown', oInit));
		document.body.dispatchEvent(new KeyboardEvent('keyup', oInit));
	}

	// ------------------------------------------------------------------------------------------
	// Messages du lecteur

	function handleMessage(oEvent) {
		if (!_elFrame || oEvent.source !== _elFrame.contentWindow || oEvent.origin !== PLAYER_ORIGIN) {
			return;
		}
		const oMessage = oEvent.data;
		if (!IsObject(oMessage) || oMessage.sTw5 !== 'player') {
			return;
		}
		switch (oMessage.sCommand) {
		case 'ready':
			setBoost(_nBoost, false);
			// Le salon de la page precedente de cet onglet suit le spectateur.
			if (sessionStorage.getItem(SYNC_STORE)) {
				postToPlayer({ sCommand: 'sync-join', sRoom: sessionStorage.getItem(SYNC_STORE) });
			}
			break;
		case 'state':
			if (IsObject(oMessage.oState)) {
				_oState = {
					bSpeedApplies: oMessage.oState.bSpeedApplies === true,
					nSpeed: SPEEDS.includes(oMessage.oState.nSpeed) ? oMessage.oState.nSpeed : 1
				};
				takeSyncState(oMessage.oState.oSync);
				paintBar();
			}
			break;
		case 'theatre':
			toggleTwitchTheatre();
			break;
		}
	}

	function handleKeyDown(oEvent) {
		if (oEvent.key === 'Escape') {
			closePops();
			if (_elCinema) {
				toggleCinema(false);
			}
		}
	}

	// Un menu ouvert ne suit pas son bouton : il se ferme si la page defile sous lui. Le chat de
	// Twitch, lui, defile sans cesse et ne doit pas le fermer.
	function handleScroll(oEvent) {
		if (_elBar && (oEvent.target === document || (oEvent.target.contains && oEvent.target.contains(_elBar)))) {
			closePops();
		}
	}

	function handlePointerDown(oEvent) {
		if (_elBar && !_elBar.contains(oEvent.target) && !_elPops.contains(oEvent.target)) {
			closePops();
		}
	}

	// ------------------------------------------------------------------------------------------
	// Le tour

	function tick() {
		const elTwitchPlayer = findTwitchPlayer();
		if (_elFrame && !_elFrame.isConnected) {
			_elFrame = null;
			// Hors de la page de la chaine, l'iframe ne disparait que si l'on a ferme le mini-lecteur.
			if (!_bOnChannelPage) {
				Unmount();
				return;
			}
		}
		if (!_elFrame) {
			if (!_bOnChannelPage || !elTwitchPlayer) {
				placeBar();
				return;
			}
			createFrame(elTwitchPlayer);
		}
		const elHost = _elFrame.parentElement;
		elHost.setAttribute('data-tw5-host', '');
		_elFrame.classList.toggle('tw5-embed--mini', elHost.getAttribute('data-a-player-state') === 'mini');
		silenceTwitchVideo(elHost);
		if (_elCinema && !_bOnChannelPage) {
			toggleCinema(false);
		}
		placeBar();
	}

	function startTicking() {
		if (_nTimer === 0) {
			_nTimer = setInterval(AddExceptionHandler(tick), TICK_INTERVAL);
		}
		tick();
	}

	// ------------------------------------------------------------------------------------------
	// Ce que pilote content.js

	// Avant de savoir si la chaine est en direct : le lecteur de Twitch ne doit pas prendre d'avance.
	function Prepare() {
		blockTwitchPlayer(true);
	}

	// Une page de chaine en direct.
	function Mount(sChannel) {
		Check(IsNonEmptyString(sChannel));
		_bOnChannelPage = true;
		blockTwitchPlayer(true);
		if (_elFrame && _sChannel !== sChannel) {
			log(`Switching player to ${sChannel}`);
			_sChannel = sChannel;
			_oState = { bSpeedApplies: false, nSpeed: 1 };
			_elFrame.dataset.tw5Channel = sChannel;
			_elFrame.src = playerAddress(sChannel);
		}
		_sChannel = sChannel;
		startTicking();
	}

	// Une VOD : meme montage, meme rangee de boutons, le lecteur la joue seule.
	function MountVideo(sVideoId, nStart) {
		Mount(`video:${sVideoId}:${Math.max(0, Math.floor(nStart))}`);
	}

	// Une page qui n'est pas une chaine : Twitch y reduit son lecteur, le notre le suit.
	function Away() {
		_bOnChannelPage = false;
		if (!_elFrame) {
			Unmount();
			return;
		}
		tick();
	}

	// Une chaine hors ligne, une VOD, ou le lecteur coupe : Twitch reprend la main. Vrai si un
	// lecteur etait la : celui de Twitch, bloque jusque-la, est alors a relancer.
	function Unmount() {
		const bHadPlayer = _elFrame !== null;
		_bOnChannelPage = false;
		toggleCinema(false);
		removeFrame();
		if (_elBar) {
			_elBar.remove();
			_elBar = null;
			_elPops.remove();
			_elPops = null;
		}
		_sChannel = '';
		if (_nTimer !== 0) {
			clearInterval(_nTimer);
			_nTimer = 0;
		}
		blockTwitchPlayer(false);
		return bHadPlayer;
	}

	function IsMounted() {
		return _elFrame !== null && _bOnChannelPage;
	}

	window.addEventListener('message', AddExceptionHandler(handleMessage));
	window.addEventListener('keydown', handleKeyDown, true);
	window.addEventListener('pointerdown', handlePointerDown, true);
	window.addEventListener('scroll', handleScroll, true);
	window.addEventListener('resize', closePops);
	chrome.storage.local.get(BOOST_STORE, (oItems) => {
		if (!chrome.runtime.lastError && Number.isFinite(oItems[BOOST_STORE])) {
			_nBoost = Math.min(Math.max(oItems[BOOST_STORE], BOOST_MIN), BOOST_MAX);
		}
	});

	return { Prepare, Mount, MountVideo, Away, Unmount, IsMounted };
})();
