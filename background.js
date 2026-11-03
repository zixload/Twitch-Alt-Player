'use strict';

// Listener for `content.js` to get a list of other installed extensions.
// This allows the player's chat iframe to load support for BetterTTV and FrankerFaceZ.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.sQuery === 'InsertThirdPartyExtensions') {
    // if (message.sRequest === 'InsertThirdPartyExtensions') {
        // This must return true to indicate that sendResponse will be called asynchronously.
        chrome.management.getAll().then(extensions => {
            const response = { sThirdPartyExtensions: '' };
            for (const ext of extensions) {
                if (ext.enabled) {
                    switch (ext.id) {
                        // BetterTTV IDs
                        case 'ajopnjidmegmdimjlfnijceegpefgped': // Chrome
                        case 'deofbbdfofnmppcjbhjibgodpcdchjii': // Opera
                        case 'icllegkipkooaicfmdfaloehobmglglb': // Edge
                            response.sThirdPartyExtensions += 'BTTV ';
                            break;
                        // FrankerFaceZ IDs
                        case 'fadndhdgpmmaapbmfcknlfgcflmmmieb': // Chrome
                        case 'djkpepcignmpfblhbfpmlhoindhndkdj': // Opera
                            response.sThirdPartyExtensions += 'FFZ ';
                            break;
                    }
                }
            }
            try {
                sendResponse(response);
            } catch (e) {
                // This can happen if the original tab was closed. Ignore the error.
                console.log("Could not send response for 'InsertThirdPartyExtensions', tab may have closed.", e);
            }
        });
        return true; 
    }
});


/*
	Le lecteur de Twitch se tait pendant que le notre joue a sa place.

	Des regles de session, par onglet, bloquent ce que la page twitch.tv demande elle-meme : sur un
	direct, la playlist d'usher, les playlists de video-weaver et les segments ; sur une VOD, ses
	listes et ses segments (usher /vod/, cloudfront), pas ses vignettes. Elles ne visent que les
	requetes dont l'initiateur est twitch.tv, donc jamais celles de notre lecteur, qui partent de
	l'extension.

	**Une expression par regle.** Reunies en une seule, elles depassent la memoire que Chrome accorde
	a une expression (isRegexSupported : memoryLimitExceeded) : la regle est refusee, et plus rien
	n'est coupe.
*/
const TWITCH_PLAYER_REGEXES = [
	'^https://(usher\\.ttvnw\\.net/api/(v[0-9]+/)?channel/hls/|[^/]*\\.hls\\.ttvnw\\.net/|[^/]*\\.live-video\\.net/)',
	'^https://(usher\\.ttvnw\\.net/vod/|vod-[a-z0-9-]+\\.twitch\\.tv/)',
	'^https://[^/]*\\.cloudfront\\.net/[^/]+/[^/]+/[^/?]+\\.(m3u8|ts|mp4)',
];

// Un identifiant de regle tient sur 32 bits signes ; Edge numerote ses onglets pres du milliard.
function twitchPlayerRuleIds(nTabId) {
	const nBase = (nTabId % 700000000) * TWITCH_PLAYER_REGEXES.length + 1;
	return TWITCH_PLAYER_REGEXES.map((_, k) => nBase + k);
}

function blockTwitchPlayer(nTabId, bBlock) {
	const anRuleIds = twitchPlayerRuleIds(nTabId);
	return chrome.declarativeNetRequest.updateSessionRules({
		removeRuleIds: anRuleIds,
		addRules: bBlock ? TWITCH_PLAYER_REGEXES.map((sRegex, k) => ({
			id: anRuleIds[k],
			priority: 2,
			action: { type: 'block' },
			condition: {
				regexFilter: sRegex,
				initiatorDomains: ['twitch.tv'],
				tabIds: [nTabId]
			}
		})) : []
	});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.sQuery !== 'BlockTwitchPlayer' || !sender.tab) {
		return false;
	}
	blockTwitchPlayer(sender.tab.id, message.bBlock === true).then(
		() => sendResponse(true),
		(oError) => {
			console.error('BlockTwitchPlayer', oError);
			sendResponse(false);
		}
	);
	return true;
});

chrome.tabs.onRemoved.addListener((nTabId) => {
	blockTwitchPlayer(nTabId, false).catch(() => {});
});

// Listener for `player.js` to check if the same channel is already open.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.sQuery === 'ThisChannelIsAlreadyOpen') {
    // if (message.sRequest === 'IsThisChannelAlreadyOpen') {
        // Query all tabs for one that matches the extension's player URL and channel.
        const playerUrl = `chrome-extension://${chrome.runtime.id}/player.html`;
        
        chrome.tabs.query({ url: `${playerUrl}?*` }).then(tabs => {
            // Find a tab that is not the sender and has the same channel.
            const duplicate = tabs.find(tab => 
                tab.id !== sender.tab.id && 
                new URL(tab.url).searchParams.get('channel') === message.sChannel
            );

            if (duplicate) {
                // If a duplicate is found, send `true` back.
                try {
                    sendResponse(true);
                } catch (e) {
                    console.log("Could not send response for 'ThisChannelIsAlreadyOpen', tab may have closed.", e);
                    // console.log("Could not send response for 'IsThisChannelAlreadyOpen', tab may have closed.", e);
                }
            } else {
                // Otherwise, the original logic doesn't explicitly send `false`,
                // but we can do that for clarity. The original code relies on an empty response.
                try {
                    sendResponse(false);
                } catch(e) {
                    console.log("Could not send response for 'ThisChannelIsAlreadyOpen', tab may have closed.", e);
                    // console.log("Could not send response for 'IsThisChannelAlreadyOpen', tab may have closed.", e);
                }
            }
        });
        // Indicate that the response is asynchronous.
        return true;
    }
});