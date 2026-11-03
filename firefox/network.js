'use strict';
// Firefox supports blocking webRequest listeners; limit changes to our own documents.
(() => {
  const root = browser.runtime.getURL('');
  const hosts = ['twitch.tv', 'twitchcdn.net', 'ttvnw.net', 'jtvnw.net', 'live-video.net', 'akamaized.net', 'cloudfront.net'];
  function isOwnRequest(details) {
    return [details.originUrl, details.documentUrl].some(url => typeof url === 'string' && url.startsWith(root));
  }
  browser.webRequest.onBeforeSendHeaders.addListener(details => {
    if (!isOwnRequest(details)) return undefined;
    const requestHeaders = (details.requestHeaders || []).filter(h => !['origin', 'referer'].includes(h.name.toLowerCase()));
    requestHeaders.push({ name: 'Origin', value: 'https://www.twitch.tv' }, { name: 'Referer', value: 'https://www.twitch.tv/' });
    return { requestHeaders };
  }, { urls: hosts.map(host => `*://*.${host}/*`), types: ['xmlhttprequest'] }, ['blocking', 'requestHeaders']);
  browser.webRequest.onHeadersReceived.addListener(details => {
    const url = new URL(details.url);
    if (!isOwnRequest(details) || url.hostname !== 'www.twitch.tv' || !/^\/(?:popout\/$|(?:popout|embed)\/.+\/chat\/?$|[^/]+\/chat\/?$)/.test(url.pathname)) return undefined;
    return { responseHeaders: (details.responseHeaders || []).filter(h => !['x-frame-options', 'content-security-policy'].includes(h.name.toLowerCase())) };
  }, { urls: ['https://www.twitch.tv/*'], types: ['sub_frame'] }, ['blocking', 'responseHeaders']);

  // The live stream twitch.tv requests for itself, cut tab by tab while our embedded player plays in
  // its place (background.js). The Chrome build does this with a declarativeNetRequest session
  // rule; our own requests come from the extension and are never cut.
  const blockedTabs = new Set();
  const live = /^https:\/\/(usher\.ttvnw\.net\/(api\/(v[0-9]+\/)?channel\/hls\/|vod\/)|[^/]*\.hls\.ttvnw\.net\/|[^/]*\.live-video\.net\/|[^/]*\.cloudfront\.net\/[^/]+\/[^/]+\/[^/?]+\.(m3u8|ts|mp4)|vod-[a-z0-9-]+\.twitch\.tv\/)/;
  browser.webRequest.onBeforeRequest.addListener(details => {
    if (!blockedTabs.has(details.tabId) || isOwnRequest(details) || !live.test(details.url)) return undefined;
    return { cancel: true };
  }, { urls: ['*://*.ttvnw.net/*', '*://*.live-video.net/*', '*://*.cloudfront.net/*', '*://*.twitch.tv/*'] }, ['blocking']);
  browser.tabs.onRemoved.addListener(tabId => blockedTabs.delete(tabId));
  globalThis.FirefoxNetwork = {
    blockTwitchPlayer(tabId, block) {
      if (block) blockedTabs.add(tabId); else blockedTabs.delete(tabId);
      return Promise.resolve();
    }
  };
})();
