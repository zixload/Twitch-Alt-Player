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

	Une regle de session par onglet bloque le direct que demande la page twitch.tv elle-meme : la
	playlist d'usher, les playlists de video-weaver, les segments. Elle ne vise que les requetes dont
	l'initiateur est twitch.tv, donc jamais celles de notre lecteur, qui partent de l'extension. Les
	VOD de Twitch (usher /vod/, cloudfront) ne sont pas touchees.
*/
const TWITCH_LIVE_REGEX =
	'^https://(usher\\.ttvnw\\.net/api/(v[0-9]+/)?channel/hls/|[^/]*\\.hls\\.ttvnw\\.net/|[^/]*\\.live-video\\.net/)';

// Un identifiant de regle tient sur 32 bits signes ; Edge numerote ses onglets pres du milliard.
function twitchPlayerRuleId(nTabId) {
	return (nTabId % 2147483000) + 1;
}

function blockTwitchPlayer(nTabId, bBlock) {
	const nRuleId = twitchPlayerRuleId(nTabId);
	return chrome.declarativeNetRequest.updateSessionRules({
		removeRuleIds: [nRuleId],
		addRules: bBlock ? [{
			id: nRuleId,
			priority: 2,
			action: { type: 'block' },
			condition: {
				regexFilter: TWITCH_LIVE_REGEX,
				initiatorDomains: ['twitch.tv'],
				tabIds: [nTabId]
			}
		}] : []
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