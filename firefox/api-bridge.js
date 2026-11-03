'use strict';
/*
	Firefox gives an extension page framed inside a web page only the APIs of a content script:
	runtime, storage, i18n. The embedded player (embedhost.js) is such a page, and it still needs
	tabs.getCurrent, permissions.contains and the Twitch cookies. Here those calls go to the
	background page (firefox/api-host.js), which has every permission, and answer the player's
	callbacks as Chrome would. Opened on its own, or where the APIs exist, this does nothing.
*/
(() => {
  if (window.top === window || (chrome.tabs && chrome.cookies && chrome.permissions)) {
    return;
  }

  function ask(sApi, aArgs) {
    return browser.runtime.sendMessage({ sQuery: 'FirefoxApi', sApi, aArgs }).then(
      (oAnswer) => (oAnswer && !oAnswer.sError ? oAnswer.pResult : undefined),
      () => undefined
    );
  }

  // Chrome's shape: the result goes to the callback. A refusal arrives as undefined, which every
  // caller already treats as a failure.
  function bridged(sApi) {
    return (...aArgs) => {
      const fCallback = typeof aArgs[aArgs.length - 1] == 'function' ? aArgs.pop() : null;
      const oPromise = ask(sApi, aArgs);
      if (fCallback === null) {
        return oPromise;
      }
      oPromise.then(fCallback);
      return undefined;
    };
  }

  const afCookieListeners = [];
  let oCookiePort = null;

  // The tab id comes from the page that framed the player (Firefox build of embedhost.js).
  const nTabId = Number(new URLSearchParams(location.search).get('tab'));
  const getCurrentFromBackground = bridged('tabs.getCurrent');
  function getCurrent(fCallback) {
    if (!Number.isSafeInteger(nTabId) || nTabId < 0) {
      return getCurrentFromBackground(fCallback);
    }
    const oTab = { id: nTabId };
    if (typeof fCallback == 'function') {
      Promise.resolve().then(() => fCallback(oTab));
      return undefined;
    }
    return Promise.resolve(oTab);
  }

  chrome.tabs = { TAB_ID_NONE: -1, getCurrent };
  chrome.permissions = { contains: bridged('permissions.contains') };
  chrome.cookies = {
    getAll: bridged('cookies.getAll'),
    remove: bridged('cookies.remove'),
    onChanged: {
      addListener(fListener) {
        afCookieListeners.push(fListener);
        if (oCookiePort === null) {
          oCookiePort = browser.runtime.connect({ name: 'FirefoxCookies' });
          oCookiePort.onMessage.addListener((oChange) => {
            for (const f of afCookieListeners) {
              f(oChange);
            }
          });
        }
      },
    },
  };
})();
