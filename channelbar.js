'use strict';

/**
 * Channel bar under the video.
 *
 * The player already fetches everything this bar shows — the channel window and the
 * top panel are filled by `ShowChannelMetadata` and `ShowBroadcastMetadata`.
 * Rather than duplicating that plumbing, this module mirrors those nodes with a
 * MutationObserver and proxies its buttons to the ones the player already wires up.
 *
 * That keeps it additive: nothing in player.js has to know this bar exists, and if a
 * source node is missing the bar simply leaves that line empty.
 */
const m_ChannelBar = (() => {
	/** Nodes the player writes to, mirrored into the bar. */
	const SOURCE = {
		avatar: 'channel-avatar',
		name: 'channel-name',
		title: 'broadcasttitle',
		viewers: 'viewercount',
		streamType: 'broadcasttype',
		subscription: 'viewer-subscription',
		subscribe: 'viewer-follow',
		unsubscribe: 'viewer-unfollow'
	};

	/** The player's own channel-info button, still inside the (hidden) top panel. */
	const INFO_BUTTON_SELECTOR = '#toppanel [data-window-toggle="channel"]';

	/**
	 * `data-subscription` values, straight from the SUBSCRIPTION_* constants in player.js.
	 * They are not a boolean: 0 means following is unavailable — the viewer is not
	 * signed in — and the player hides its own row for it in CSS. 1 means "not
	 * following yet", 2 and 3 mean following, without and with notifications.
	 */
	const FOLLOW_UNAVAILABLE = '0';
	const FOLLOW_NOT_YET = '1';
	const FOLLOWING_QUIET = '2';
	const FOLLOWING_NOTIFY = '3';
	const UPDATING_CLASS = 'updating';

	/** @param {string} sState @returns {boolean} */
	function isFollowing(sState) {
		return sState === FOLLOWING_QUIET || sState === FOLLOWING_NOTIFY;
	}

	let _elBar = null;
	let _amSource = new Map();
	let _oObserver = null;

	function get(sKey) {
		return _amSource.get(sKey) || null;
	}

	/** @returns {string} Trimmed text of a mirrored node, empty when absent or hidden. */
	function readText(sKey) {
		const el = get(sKey);
		if (el === null || el.hidden) {
			return '';
		}
		return (el.textContent || '').trim();
	}

	// ------------------------------------------------------------------ painting

	function paint() {
		if (_elBar === null) {
			return;
		}

		const elAvatar = get('avatar');
		const sAvatar = elAvatar && elAvatar.src ? elAvatar.src : '';
		const elImage = document.getElementById('alt-cb-avatar-img');
		if (elImage && elImage.src !== sAvatar) {
			// Assigning an empty src would re-request the page itself.
			if (sAvatar === '') {
				elImage.removeAttribute('src');
			} else {
				elImage.src = sAvatar;
			}
		}

		const sName = readText('name');
		const sTitle = readText('title');
		const sViewers = readText('viewers');

		document.getElementById('alt-cb-name').textContent = sName;
		document.getElementById('alt-cb-title').textContent = sTitle;
		document.getElementById('alt-cb-title').title = sTitle;
		document.getElementById('alt-cb-viewers').textContent = sViewers;

		// The stream-title link carries the channel address, with the marker that stops
		// content.js bouncing the page straight back into this player.
		const elTitleLink = get('title');
		const sChannelUrl = elTitleLink && elTitleLink.href ? elTitleLink.href : '';
		for (const sId of ['alt-cb-avatar', 'alt-cb-name']) {
			const el = document.getElementById(sId);
			if (el === null) {
				continue;
			}
			if (sChannelUrl === '') {
				el.removeAttribute('href');
			} else {
				el.href = sChannelUrl;
			}
		}

		// "Live" is whatever the player decided for its own badge in the top panel.
		const elType = get('streamType');
		const bLive = elType !== null
			&& elType.classList.contains('livebroadcast')
			&& elType.parentElement !== null
			&& !elType.parentElement.hidden;
		_elBar.classList.toggle('alt-cb-islive', bLive);
		const elLive = document.getElementById('alt-cb-live');
		if (elLive) {
			elLive.hidden = !bLive;
			if (bLive && elType) {
				elLive.textContent = (elType.textContent || '').trim();
			}
		}

		paintFollow();

		// Nothing worth showing until the channel has a name.
		_elBar.hidden = sName === '';
	}

	function paintFollow() {
		const elButton = document.getElementById('alt-cb-follow');
		const elState = get('subscription');
		if (elButton === null || elState === null) {
			return;
		}

		// State 0 means the viewer cannot follow at all; the player hides its own row
		// through CSS rather than the hidden property, so read the attribute instead.
		const sState = elState.getAttribute('data-subscription');
		if (elState.hidden || sState === FOLLOW_UNAVAILABLE || sState === null) {
			elButton.hidden = true;
			return;
		}

		const bUpdating = elState.classList.contains(UPDATING_CLASS);
		const bFollowing = isFollowing(sState);
		const elProxy = get(bFollowing ? 'unsubscribe' : 'subscribe');

		elButton.hidden = elProxy === null;
		elButton.classList.toggle('alt-cb-following', bFollowing);
		elButton.classList.toggle('alt-cb-busy', bUpdating);
		if (elProxy !== null) {
			// Reuse the player's own label and tooltip so this bar needs no new strings.
			elButton.textContent = (elProxy.textContent || '').trim();
			elButton.title = elProxy.title || '';
		}
	}

	// ------------------------------------------------------------------- actions

	function onFollowClick() {
		const elState = get('subscription');
		if (elState === null || elState.classList.contains(UPDATING_CLASS)) {
			return;
		}
		const sState = elState.getAttribute('data-subscription');
		if (sState === FOLLOW_UNAVAILABLE || sState === null) {
			return;
		}
		const elProxy = get(isFollowing(sState) ? 'unsubscribe' : 'subscribe');
		if (elProxy !== null) {
			elProxy.click();
		}
	}

	/**
	 * The window-toggle handler listens for a click event raised inside the player,
	 * and this bar sits outside it, so the click is forwarded to the original button
	 * rather than duplicating the toggle logic.
	 */
	function onInfoClick() {
		const elProxy = document.querySelector(INFO_BUTTON_SELECTOR);
		if (elProxy !== null) {
			elProxy.click();
		}
	}

	function onLeaveClick() {
		const elTitleLink = get('title');
		const sUrl = elTitleLink && elTitleLink.href ? elTitleLink.href : '';
		if (sUrl !== '') {
			location.assign(sUrl);
		}
	}

	// --------------------------------------------------------------------- start

	function start() {
		_elBar = document.getElementById('alt-channelbar');
		if (_elBar === null) {
			return;
		}

		for (const sKey of Object.keys(SOURCE)) {
			const el = document.getElementById(SOURCE[sKey]);
			if (el !== null) {
				_amSource.set(sKey, el);
			}
		}

		const elFollow = document.getElementById('alt-cb-follow');
		if (elFollow) {
			elFollow.addEventListener('click', onFollowClick);
		}
		const elInfo = document.getElementById('alt-cb-info');
		if (elInfo) {
			elInfo.addEventListener('click', onInfoClick);
		}
		const elLeave = document.getElementById('alt-cb-leave');
		if (elLeave) {
			elLeave.addEventListener('click', onLeaveClick);
		}

		// Watch the mirrored nodes rather than polling: the player writes to them only
		// when metadata actually changes, roughly once a minute.
		_oObserver = new MutationObserver(() => paint());
		for (const el of _amSource.values()) {
			_oObserver.observe(el, {
				attributes: true,
				childList: true,
				characterData: true,
				subtree: true
			});
			if (el.parentElement !== null) {
				// The player toggles `hidden` on the wrapper, not on the node itself.
				_oObserver.observe(el.parentElement, { attributes: true });
			}
		}

		paint();
	}

	return { start, paint };
})();

try {
	m_ChannelBar.start();
} catch (oException) {
	console.error('[ChannelBar] failed to start', oException);
}
