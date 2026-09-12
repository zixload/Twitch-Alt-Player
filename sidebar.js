'use strict';

/**
 * Left navigation sidebar for the alternate player page.
 *
 * The alternate player replaces the whole twitch.tv page with `player.html`, so the
 * site navigation is gone once a channel is opened. This module rebuilds the part
 * of it that matters while watching: which followed channels are live, and what else
 * is on right now, both fetched straight from Twitch's GraphQL API.
 *
 * It is deliberately self-contained — it reads the auth cookie itself and never calls
 * into `м_Twitch` — so that a failure here can never take the player down with it.
 * Every entry point is guarded; on any error the sidebar degrades to a status line.
 */
const m_Sidebar = (() => {
	const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
	const GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
	const TWITCH_COOKIE_URL = 'https://www.twitch.tv/';

	const REFRESH_INTERVAL = 60000;
	const REQUEST_TIMEOUT = 15000;
	const FOLLOWED_LIVE_FETCH_COUNT = 100;
	const FOLLOWED_ALL_FETCH_COUNT = 100;
	const LIVE_FETCH_COUNT = 24;
	const PREVIEW_COUNT = 8;
	const OFFLINE_PREVIEW_COUNT = 3;
	const AVATAR_WIDTH = 70;

	const COLLAPSED_STORAGE_KEY = 'alt-sidebar-collapsed';

	/** @type {?HTMLElement} */
	let _elSidebar = null;
	/** @type {?HTMLElement} */
	let _elStatus = null;
	/** @type {!Map<string, !Object>} Section name -> its elements, expanded flag and cached items. */
	let _amSections = new Map();
	/** Cached credentials read from the twitch.tv cookies, or null when logged out. */
	let _oAuth = null;
	let _bCollapsed = false;
	let _sCurrentChannel = '';
	let _nRefreshTimer = 0;
	let _bRequestInFlight = false;

	// ------------------------------------------------------------------ helpers

	/**
	 * Reads a localised string, falling back to English when the key is missing so a
	 * forgotten `_locales` entry shows a word rather than an empty box.
	 * @param {string} sCode
	 * @param {string} sFallback
	 * @returns {string}
	 */
	function text(sCode, sFallback) {
		try {
			const sMessage = m_i18n.GetMessage(sCode);
			if (typeof sMessage === 'string' && sMessage !== '') {
				return sMessage;
			}
		} catch (_) { }
		return sFallback;
	}

	/**
	 * @param {number} nCount
	 * @returns {string} Viewer count in the compact form Twitch uses ("1.2K").
	 */
	function formatViewers(nCount) {
		try {
			return new Intl.NumberFormat(undefined, {
				notation: 'compact',
				maximumFractionDigits: 1
			}).format(nCount);
		} catch (_) {
			return String(nCount);
		}
	}

	/**
	 * @param {string} sChannel
	 * @returns {string} Address of our own player for that channel.
	 */
	function getPlayerAddress(sChannel) {
		if (typeof GetOurPlayerAddress === 'function') {
			return GetOurPlayerAddress(sChannel);
		}
		return chrome.runtime.getURL('player.html') + '?channel=' + encodeURIComponent(sChannel);
	}

	function log(sMessage) {
		try {
			m_Log.Вот('[Sidebar] ' + sMessage);
		} catch (_) {
			console.log('[Sidebar] ' + sMessage);
		}
	}

	// -------------------------------------------------------------------- auth

	/**
	 * Reads the viewer's OAuth token and device id from the twitch.tv cookies.
	 * Both are optional: without them the followed section is unavailable but the
	 * public "live channels" section still works.
	 * @returns {!Promise<?{id: string, login: string, displayName: string, authToken: string, deviceId: string}>}
	 */
	function readAuth() {
		return new Promise(fResolve => {
			try {
				chrome.cookies.getAll({ url: TWITCH_COOKIE_URL }, aCookies => {
					if (chrome.runtime.lastError || !Array.isArray(aCookies)) {
						fResolve(null);
						return;
					}
					let oUser = null;
					let sDeviceId = '';
					for (const oCookie of aCookies) {
						if (oCookie.name === 'twilight-user') {
							try {
								const oParsed = JSON.parse(decodeURIComponent(oCookie.value));
								if (oParsed && oParsed.login && oParsed.authToken) {
									oUser = oParsed;
								}
							} catch (_) { }
						} else if (oCookie.name === 'unique_id') {
							sDeviceId = oCookie.value || '';
						}
					}
					fResolve(oUser === null ? null : {
						id: oUser.id || '',
						login: oUser.login,
						displayName: oUser.displayName || oUser.login,
						authToken: oUser.authToken,
						deviceId: sDeviceId
					});
				});
			} catch (oException) {
				console.error('[Sidebar] cookies.getAll', oException);
				fResolve(null);
			}
		});
	}

	// --------------------------------------------------------------- transport

	/**
	 * Sends one raw GraphQL query. The `declarativeNetRequest` rules already rewrite
	 * Origin/Referer for extension-initiated requests to twitch.tv, so no extra work
	 * is needed here.
	 *
	 * @param {string} sQuery
	 * @param {!Object} oVariables
	 * @param {boolean} bAuthenticated Send the viewer's OAuth token with the request.
	 * @returns {!Promise<!Object>} The `data` payload.
	 */
	function sendGqlRequest(sQuery, oVariables, bAuthenticated) {
		const oHeaders = {
			'Accept-Language': 'en-US',
			'Client-ID': CLIENT_ID,
			'Content-Type': 'text/plain; charset=UTF-8'
		};
		if (_oAuth !== null && _oAuth.deviceId !== '') {
			oHeaders['X-Device-ID'] = _oAuth.deviceId;
		}
		if (bAuthenticated) {
			if (_oAuth === null) {
				return Promise.reject(new Error('Not signed in'));
			}
			oHeaders.Authorization = 'OAuth ' + _oAuth.authToken;
		}

		const oAbort = new AbortController();
		const nTimer = setTimeout(() => oAbort.abort(), REQUEST_TIMEOUT);

		return fetch(GQL_ENDPOINT, {
			method: 'POST',
			headers: oHeaders,
			body: JSON.stringify({ query: sQuery, variables: oVariables }),
			signal: oAbort.signal,
			credentials: 'omit'
		}).then(oResponse => {
			if (!oResponse.ok) {
				throw new Error('GQL HTTP ' + oResponse.status);
			}
			return oResponse.json();
		}).then(oResult => {
			if (oResult.errors && oResult.errors.length !== 0) {
				throw new Error('GQL: ' + oResult.errors.map(o => o.message).join(', '));
			}
			return oResult.data || {};
		}).finally(() => clearTimeout(nTimer));
	}

	// ----------------------------------------------------------------- queries

	const FOLLOWED_QUERY = `query AltSidebarFollowed($liveLimit: Int!, $followLimit: Int!, $avatarWidth: Int!) {
	currentUser {
		id
		login
		displayName
		followedLiveUsers(first: $liveLimit) {
			edges {
				node {
					id
					login
					displayName
					profileImageURL(width: $avatarWidth)
					stream {
						id
						title
						viewersCount
						game { displayName }
					}
				}
			}
		}
		follows(first: $followLimit) {
			edges {
				node {
					id
					login
					displayName
					profileImageURL(width: $avatarWidth)
					stream { id }
				}
			}
		}
	}
}`;

	const LIVE_QUERY = `query AltSidebarLive($limit: Int!, $options: StreamOptions, $avatarWidth: Int!) {
	streams(first: $limit, options: $options) {
		edges {
			node {
				id
				title
				viewersCount
				game { displayName }
				broadcaster {
					id
					login
					displayName
					profileImageURL(width: $avatarWidth)
				}
			}
		}
	}
}`;

	/**
	 * @param {!Object} oNode A `User` node carrying an optional `stream`.
	 * @returns {!Object} Normalised row data.
	 */
	function toItem(oNode) {
		const oStream = oNode.stream || null;
		return {
			login: oNode.login || '',
			displayName: oNode.displayName || oNode.login || '',
			avatar: oNode.profileImageURL || '',
			live: oStream !== null,
			title: oStream ? oStream.title || '' : '',
			viewers: oStream && typeof oStream.viewersCount === 'number' ? oStream.viewersCount : 0,
			game: oStream && oStream.game ? oStream.game.displayName || '' : ''
		};
	}

	/** @returns {!Promise<!Array<!Object>>} Live follows first, then a few offline ones. */
	function queryFollowed() {
		return sendGqlRequest(FOLLOWED_QUERY, {
			liveLimit: FOLLOWED_LIVE_FETCH_COUNT,
			followLimit: FOLLOWED_ALL_FETCH_COUNT,
			avatarWidth: AVATAR_WIDTH
		}, true).then(oData => {
			const oUser = oData.currentUser;
			if (!oUser) {
				throw new Error('currentUser is null');
			}
			const aLive = (oUser.followedLiveUsers ? oUser.followedLiveUsers.edges || [] : [])
				.map(oEdge => toItem(oEdge.node))
				.filter(oItem => oItem.login !== '');
			aLive.sort((a, b) => b.viewers - a.viewers);

			const asLive = new Set(aLive.map(oItem => oItem.login));
			const aOffline = (oUser.follows ? oUser.follows.edges || [] : [])
				.map(oEdge => toItem(oEdge.node))
				.filter(oItem => oItem.login !== '' && !oItem.live && !asLive.has(oItem.login))
				.slice(0, OFFLINE_PREVIEW_COUNT);

			return aLive.concat(aOffline);
		});
	}

	/**
	 * Public "what else is on" list, filtered to the interface language so a French
	 * viewer is not handed the global English top 20.
	 * @returns {!Promise<!Array<!Object>>}
	 */
	function queryLive() {
		let sLanguage = '';
		try {
			sLanguage = (chrome.i18n.getUILanguage() || navigator.language || '').slice(0, 2).toUpperCase();
		} catch (_) { }

		const oOptions = /^[A-Z]{2}$/.test(sLanguage) ? { languages: [sLanguage] } : null;

		return sendGqlRequest(LIVE_QUERY, {
			limit: LIVE_FETCH_COUNT,
			options: oOptions,
			avatarWidth: AVATAR_WIDTH
		}, false).then(oData => {
			const aEdges = oData.streams ? oData.streams.edges || [] : [];
			return aEdges
				.filter(oEdge => oEdge.node && oEdge.node.broadcaster)
				.map(oEdge => {
					const oItem = toItem(oEdge.node.broadcaster);
					oItem.live = true;
					oItem.title = oEdge.node.title || '';
					oItem.viewers = oEdge.node.viewersCount || 0;
					oItem.game = oEdge.node.game ? oEdge.node.game.displayName || '' : '';
					return oItem;
				})
				.filter(oItem => oItem.login !== '');
		});
	}

	// --------------------------------------------------------------- rendering

	/**
	 * @param {!Object} oItem
	 * @returns {!HTMLAnchorElement}
	 */
	function createRow(oItem) {
		const elRow = document.createElement('a');
		elRow.className = 'alt-sb-row' + (oItem.live ? '' : ' alt-sb-offline');
		elRow.href = getPlayerAddress(oItem.login);
		elRow.title = [oItem.displayName, oItem.title, oItem.game]
			.filter(s => s !== '')
			.join('\n');
		if (oItem.login.toLowerCase() === _sCurrentChannel) {
			elRow.classList.add('alt-sb-current');
		}

		const elAvatar = document.createElement('span');
		elAvatar.className = 'alt-sb-avatar';
		if (oItem.avatar !== '') {
			const elImage = document.createElement('img');
			elImage.src = oItem.avatar;
			elImage.alt = '';
			elImage.loading = 'lazy';
			elImage.addEventListener('error', () => elImage.remove());
			elAvatar.appendChild(elImage);
		}
		elRow.appendChild(elAvatar);

		const elMeta = document.createElement('span');
		elMeta.className = 'alt-sb-meta';

		const elName = document.createElement('span');
		elName.className = 'alt-sb-name';
		elName.textContent = oItem.displayName;
		elMeta.appendChild(elName);

		if (oItem.live && oItem.title !== '') {
			const elStreamTitle = document.createElement('span');
			elStreamTitle.className = 'alt-sb-stream-title';
			elStreamTitle.textContent = oItem.title;
			elMeta.appendChild(elStreamTitle);
		}

		const elGame = document.createElement('span');
		elGame.className = 'alt-sb-game';
		elGame.textContent = oItem.live ? oItem.game : text('F1905', 'Offline');
		elMeta.appendChild(elGame);

		elRow.appendChild(elMeta);

		if (oItem.live) {
			const elCount = document.createElement('span');
			elCount.className = 'alt-sb-count';

			const elDot = document.createElement('i');
			elDot.className = 'alt-sb-dot';
			elCount.appendChild(elDot);
			elCount.appendChild(document.createTextNode(formatViewers(oItem.viewers)));

			elRow.appendChild(elCount);
		}

		return elRow;
	}

	/**
	 * Repaints one section from its cached items, honouring its expanded state.
	 * @param {string} sName
	 */
	function renderSection(sName) {
		const oSection = _amSections.get(sName);
		if (!oSection) {
			return;
		}

		const aItems = oSection.items;
		oSection.section.hidden = aItems.length === 0;
		oSection.list.textContent = '';

		const aVisible = oSection.expanded ? aItems : aItems.slice(0, PREVIEW_COUNT);
		for (const oItem of aVisible) {
			oSection.list.appendChild(createRow(oItem));
		}

		oSection.more.hidden = aItems.length <= PREVIEW_COUNT;
		oSection.more.textContent = oSection.expanded
			? text('F1904', 'Show Less')
			: text('F1903', 'Show More');
	}

	/**
	 * @param {string} sName
	 * @param {number} nRows How many placeholder rows to draw.
	 */
	function renderSkeleton(sName, nRows) {
		const oSection = _amSections.get(sName);
		if (!oSection) {
			return;
		}
		oSection.section.hidden = false;
		oSection.list.textContent = '';
		for (let i = 0; i !== nRows; ++i) {
			const elSkeleton = document.createElement('div');
			elSkeleton.className = 'alt-sb-skeleton';
			oSection.list.appendChild(elSkeleton);
		}
		oSection.more.hidden = true;
	}

	/**
	 * Shows a one-line message under the lists, optionally with an action.
	 * @param {string} sMessage Empty string clears the status line.
	 * @param {?{label: string, action: !Function}=} oAction
	 */
	function setStatus(sMessage, oAction) {
		if (_elStatus === null) {
			return;
		}
		_elStatus.textContent = '';
		if (sMessage === '') {
			_elStatus.hidden = true;
			return;
		}
		_elStatus.hidden = false;
		_elStatus.appendChild(document.createTextNode(sMessage + ' '));
		if (oAction) {
			const elButton = document.createElement('button');
			elButton.type = 'button';
			elButton.className = 'alt-sb-retry';
			elButton.textContent = oAction.label;
			elButton.addEventListener('click', () => oAction.action());
			_elStatus.appendChild(elButton);
		}
	}

	// ----------------------------------------------------------------- loading

	/** Reloads both sections. Failures are reported per section, never thrown. */
	function refresh() {
		if (_bRequestInFlight) {
			return Promise.resolve();
		}
		_bRequestInFlight = true;

		const oFollowed = _oAuth === null
			? Promise.resolve(null)
			: queryFollowed().catch(oException => {
				console.error('[Sidebar] followed channels', oException);
				return null;
			});

		const oLive = queryLive().catch(oException => {
			console.error('[Sidebar] live channels', oException);
			return null;
		});

		return Promise.all([oFollowed, oLive]).then(([aFollowed, aLive]) => {
			const oFollowedSection = _amSections.get('followed');
			const oLiveSection = _amSections.get('live');
			if (!oFollowedSection || !oLiveSection) {
				return;
			}

			if (aFollowed !== null) {
				oFollowedSection.items = aFollowed;
				renderSection('followed');
			} else {
				oFollowedSection.items = [];
				oFollowedSection.section.hidden = true;
			}

			if (aLive !== null) {
				const asFollowed = new Set(oFollowedSection.items.map(oItem => oItem.login));
				oLiveSection.items = aLive.filter(oItem =>
					!asFollowed.has(oItem.login) && oItem.login.toLowerCase() !== _sCurrentChannel);
				renderSection('live');
			} else {
				oLiveSection.items = [];
				oLiveSection.section.hidden = true;
			}

			if (_oAuth === null) {
				setStatus(text('F1906', 'Sign in on twitch.tv to see your followed channels.'), {
					label: text('F1907', 'Open Twitch'),
					action: () => window.open(TWITCH_COOKIE_URL + '?' + DO_NOT_REDIRECT_ADDRESS)
				});
			} else if (aFollowed === null && aLive === null) {
				setStatus(text('F1908', 'Could not load channels.'), {
					label: text('F1909', 'Retry'),
					action: reload
				});
			} else {
				setStatus('');
			}

			log(`refreshed: ${oFollowedSection.items.length} followed, ${oLiveSection.items.length} live`);
		}).finally(() => {
			_bRequestInFlight = false;
		});
	}

	/**
	 * Re-reads the credentials before refreshing. Used by the retry action, since the
	 * usual reason for a failure is that the viewer signed in or out in another tab.
	 * @returns {!Promise<void>}
	 */
	function reload() {
		renderSkeleton('followed', 5);
		renderSkeleton('live', 4);
		setStatus('');
		return readAuth().then(oAuth => {
			_oAuth = oAuth;
			return refresh();
		}).catch(oException => {
			console.error('[Sidebar] reload', oException);
		});
	}

	// ------------------------------------------------------------------ layout

	/** @param {boolean} bCollapsed */
	function applyCollapsed(bCollapsed) {
		_bCollapsed = bCollapsed;
		_elSidebar.classList.toggle('alt-sb-collapsed', bCollapsed);
		const elButton = _elSidebar.querySelector('.alt-sb-collapse');
		if (elButton) {
			elButton.title = bCollapsed
				? text('A0901', 'Expand the sidebar')
				: text('A0900', 'Collapse the sidebar');
		}
		try {
			localStorage.setItem(COLLAPSED_STORAGE_KEY, bCollapsed ? '1' : '0');
		} catch (_) { }
	}

	function readCollapsed() {
		try {
			return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
		} catch (_) {
			return false;
		}
	}

	// ------------------------------------------------------------------- start

	function bindSection(sName) {
		const elSection = _elSidebar.querySelector(`[data-alt-sb-section="${sName}"]`);
		if (elSection === null) {
			return;
		}
		const oSection = {
			section: elSection,
			list: elSection.querySelector('.alt-sb-list'),
			more: elSection.querySelector('.alt-sb-more'),
			expanded: false,
			items: []
		};
		oSection.more.addEventListener('click', () => {
			oSection.expanded = !oSection.expanded;
			renderSection(sName);
		});
		_amSections.set(sName, oSection);
	}

	function start() {
		_elSidebar = document.getElementById('alt-sidebar');
		if (_elSidebar === null) {
			return;
		}
		_elStatus = _elSidebar.querySelector('.alt-sb-status');

		try {
			_sCurrentChannel = (new URLSearchParams(location.search).get('channel') || '').toLowerCase();
		} catch (_) { }

		bindSection('followed');
		bindSection('live');

		const elCollapse = _elSidebar.querySelector('.alt-sb-collapse');
		if (elCollapse) {
			elCollapse.addEventListener('click', () => applyCollapsed(!_bCollapsed));
		}
		applyCollapsed(readCollapsed());

		_elSidebar.hidden = false;
		renderSkeleton('followed', 5);
		renderSkeleton('live', 4);
		setStatus('');

		readAuth().then(oAuth => {
			_oAuth = oAuth;
			log(oAuth === null ? 'not signed in' : `signed in as ${oAuth.login}`);
			return refresh();
		}).catch(oException => {
			console.error('[Sidebar] start', oException);
		});

		if (_nRefreshTimer === 0) {
			_nRefreshTimer = setInterval(() => {
				if (document.visibilityState === 'visible') {
					refresh();
				}
			}, REFRESH_INTERVAL);
		}
	}

	return { start, refresh };
})();

try {
	m_Sidebar.start();
} catch (oException) {
	console.error('[Sidebar] failed to start', oException);
}
