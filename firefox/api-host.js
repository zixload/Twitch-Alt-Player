'use strict';
/*
	The background half of firefox/api-bridge.js: the APIs Firefox withholds from the player when it
	is framed inside twitch.tv. Only our own player page may ask, and only for Twitch cookies.
*/
(() => {
  const player = browser.runtime.getURL('player.html');

  function fromPlayer(sender) {
    return typeof sender.url == 'string' && sender.url.startsWith(player);
  }

  function twitchOnly(details) {
    try {
      const host = details.url ? new URL(details.url).hostname : String(details.domain || '');
      return host === 'twitch.tv' || host.endsWith('.twitch.tv');
    } catch (_) {
      return false;
    }
  }

  const answer = (pResult) => ({ pResult });
  const refusal = (reason) => ({ sError: String(reason) });

  browser.runtime.onMessage.addListener((message, sender) => {
    // The content script knows its tab through us; it hands the id to the player it frames.
    if (message && message.sQuery === 'FirefoxWhoAmI') {
      return Promise.resolve(sender.tab ? sender.tab.id : undefined);
    }
    if (!message || message.sQuery !== 'FirefoxApi') {
      return undefined;
    }
    if (!fromPlayer(sender)) {
      return Promise.resolve(refusal('not the player'));
    }
    const [details] = Array.isArray(message.aArgs) ? message.aArgs : [];
    switch (message.sApi) {
    case 'tabs.getCurrent':
      return Promise.resolve(answer(sender.tab ? { id: sender.tab.id, incognito: sender.tab.incognito } : undefined));
    case 'permissions.contains':
      return browser.permissions.contains(details).then(answer, refusal);
    case 'cookies.getAll':
      return twitchOnly(details) ? browser.cookies.getAll(details).then(answer, refusal) : Promise.resolve(refusal('not twitch'));
    case 'cookies.remove':
      return twitchOnly(details) ? browser.cookies.remove(details).then(answer, refusal) : Promise.resolve(refusal('not twitch'));
    default:
      return Promise.resolve(refusal('unknown'));
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'FirefoxCookies' || !fromPlayer(port.sender)) {
      return;
    }
    const forward = (change) => {
      if (change.cookie && /(^|\.)twitch\.tv$/.test(change.cookie.domain.replace(/^\./, ''))) {
        port.postMessage(change);
      }
    };
    browser.cookies.onChanged.addListener(forward);
    port.onDisconnect.addListener(() => browser.cookies.onChanged.removeListener(forward));
  });
})();
