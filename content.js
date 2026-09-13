"use strict";

const STORE_CHANNEL_STATE = 2e4;

let g_oParsedAddress = null;

let g_sAddressSettingMethod = "";
// let g_sAddressSettingMethod = '';

let g_nLastCheck = 0;

let g_oRequest = null;

let g_sChannelCode = "";
// let g_sChannelCode = '';

let g_bIsStreaming = false;

const m_Debug = {
  FinishWorkAndShowMessage: finishWork,
  CaughtException: finishWork,
  // CaughtException: finishWork
};

function finishWork(pExceptionOrMessageCode) {
  if (!g_bWorkFinished) {
    console.error(pExceptionOrMessageCode);
    try {
      g_bWorkFinished = true;
      m_Log.Wow("[content.js] Работа ended");
      // m_Log.Wow('[content.js] Work finished');
    } catch (_) {}
  }
  throw void 0;
}

function setPageAddress(sAddress, bReplace = false) {
  location[bReplace ? "replace" : "assign"](sAddress);
  // location[bReplace ? 'replace' : 'assign'](sAddress);
}

function insertOnPage() {
  const nodeScript = document.createElement("script");
  // const nodeScript = document.createElement('script');
  // MV3-compliant: Injects the script by URL instead of using textContent.
  nodeScript.src = chrome.runtime.getURL("content_injection.js");
  // nodeScript.src = chrome.runtime.getURL('content_injection.js');
  (document.head || document.documentElement).appendChild(nodeScript);
  nodeScript.remove();
}

function thisAddressCanBeRedirected(oAddress) {
  return !oAddress.search.includes(DO_NOT_REDIRECT_ADDRESS);
}

function getNonRedirectableAddress(oAddress) {
  return `${oAddress.protocol}//${oAddress.host}${oAddress.pathname}${
    oAddress.search.length > 1
      ? `${oAddress.search}&${DO_NOT_REDIRECT_ADDRESS}`
      : `?${DO_NOT_REDIRECT_ADDRESS}`
  }${oAddress.hash}`;
  // return `${oAddress.protocol}//${oAddress.host}${oAddress.pathname}${oAddress.search.length > 1 ? `${oAddress.search}&${DO_NOT_REDIRECT_ADDRESS}` : `?${DO_NOT_REDIRECT_ADDRESS}`}${oAddress.hash}`;
}

function disableAutoRedirectForThisPage() {
  if (thisAddressCanBeRedirected(location)) {
    history.replaceState(
      history.state,
      "",
      getNonRedirectableAddress(location)
    );
    // history.replaceState(history.state, '', getNonRedirectableAddress(location));
  }
}

parseAddress.THIS_IS_NOT_A_CHANNEL_CODE = new Set([
  "directory",
  "embed",
  "friends",
  "inventory",
  "login",
  "logout",
  "manager",
  "messages",
  "payments",
  "popout",
  "search",
  "settings",
  "signup",
  "subscriptions",
  "team",
]);
// parseAddress.THIS_IS_NOT_A_CHANNEL_CODE = new Set([ 'directory', 'embed', 'friends', 'inventory', 'login', 'logout', 'manager', 'messages', 'payments', 'popout', 'search', 'settings', 'signup', 'subscriptions', 'team' ]);

function parseAddress(oAddress) {
  let bMobileVersion = false;
  let sPage = "UNKNOWN";
  // let sPage = 'UNKNOWN';
  let sChannelCode = "";
  // let sChannelCode = '';
  let bCanRedirect = false;
  if (
    oAddress.protocol === "https:" &&
    (oAddress.host === "www.twitch.tv" || oAddress.host === "m.twitch.tv")
  ) {
    // if (oAddress.protocol === 'https:' && (oAddress.host === 'www.twitch.tv' || oAddress.host === 'm.twitch.tv')) {
    bMobileVersion = oAddress.host === "m.twitch.tv";
    // bMobileVersion = oAddress.host === 'm.twitch.tv';
    const msParts = oAddress.pathname.split("/");
    // const msParts = oAddress.pathname.split('/');
    if (msParts.length <= 3 && msParts[1] && !msParts[2]) {
      if (!parseAddress.THIS_IS_NOT_A_CHANNEL_CODE.has(msParts[1])) {
        sPage = "POSSIBLY_LIVE_BROADCAST";
        // sPage = 'POSSIBLY_LIVE_STREAM';
        sChannelCode = decodeURIComponent(msParts[1]);
        bCanRedirect = thisAddressCanBeRedirected(oAddress);
      }
    } else if (
      (msParts[1] === "embed" || msParts[1] === "popout") &&
      msParts[2] &&
      msParts[3] === "chat"
    ) {
      // } else if ((msParts[1] === 'embed' || msParts[1] === 'popout') && msParts[2] && msParts[3] === 'chat') {
      sPage = "CHANNEL_CHAT";
      // sPage = 'CHANNEL_CHAT';
      sChannelCode = decodeURIComponent(msParts[2]);
    }
  }
  m_Log.Wow(
    `[content.js] Адрес разобран: Страница=${sPage} КодКанала=${sChannelCode} МожноПеренаправлять=${bCanRedirect}`
  );
  // m_Log.Wow(`[content.js] Address parsed: Page=${sPage} ChannelCode=${sChannelCode} CanRedirect=${bCanRedirect}`);
  return {
    bMobileVersion,
    sPage,
    sChannelCode,
    bCanRedirect,
    // bCanRedirect
  };
}

function requestChannelState(oParsedAddress) {
  if (
    !oParsedAddress.bCanRedirect ||
    !m_Settings.Get("bAutoRedirectAllowed")
  ) {
    // if (!oParsedAddress.bCanRedirect || !m_Settings.Get('bAutoRedirectAllowed')) {
    return;
  }
  if (
    !g_oRequest &&
    g_sChannelCode === oParsedAddress.sChannelCode &&
    performance.now() - g_nLastCheck < STORE_CHANNEL_STATE
  ) {
    // if (!g_oRequest && g_sChannelCode === oParsedAddress.sChannelCode && performance.now() - g_nLastCheck < STORE_CHANNEL_STATE) {
    return;
  }
  if (g_oRequest && g_sChannelCode === oParsedAddress.sChannelCode) {
    return;
  }
  cancelRequest();
  g_sChannelCode = oParsedAddress.sChannelCode;
  g_nLastCheck = -1;
  sendRequest();
}

function pageAddressChanged(sMethod) {
  g_oParsedAddress = parseAddress(location);
  g_sAddressSettingMethod = sMethod;
  if (
    !g_oParsedAddress.bCanRedirect ||
    !m_Settings.Get("bAutoRedirectAllowed")
  ) {
    // if (!g_oParsedAddress.bCanRedirect || !m_Settings.Get('bAutoRedirectAllowed')) {
    if (g_nLastCheck === -2) {
      g_nLastCheck = -1;
    }
    return;
  }
  if (
    !g_oRequest &&
    g_sChannelCode === g_oParsedAddress.sChannelCode &&
    performance.now() - g_nLastCheck < STORE_CHANNEL_STATE
  ) {
    // if (!g_oRequest && g_sChannelCode === g_oParsedAddress.sChannelCode && performance.now() - g_nLastCheck < STORE_CHANNEL_STATE) {
    if (g_bIsStreaming) {
      redirectToOurPlayer(g_sChannelCode);
    }
    return;
  }
  if (g_oRequest && g_sChannelCode === g_oParsedAddress.sChannelCode) {
    g_nLastCheck = -2;
    return;
  }
  cancelRequest();
  g_sChannelCode = g_oParsedAddress.sChannelCode;
  g_nLastCheck = -2;
  sendRequest();
}

function cancelRequest() {
  if (g_oRequest) {
    m_Log.Wow("[content.js] Отменяю незавершенный запрос");
    // m_Log.Wow('[content.js] Canceling pending request');
    g_oRequest.abort();
  }
}

function sendRequest() {
  m_Log.Wow(`[content.js] Посылаю запрос для канала ${g_sChannelCode}`);
  // m_Log.Wow(`[content.js] Sending request for channel ${g_sChannelCode}`);
  g_oRequest = new XMLHttpRequest();
  g_oRequest.addEventListener("loadend", processResponse);
  // g_oRequest.addEventListener('loadend', processResponse);
  g_oRequest.open("POST", "https://gql.twitch.tv/gql#origin=twilight");
  // g_oRequest.open('POST', 'https://gql.twitch.tv/gql#origin=twilight');
  g_oRequest.responseType = "json";
  // g_oRequest.responseType = 'json';
  g_oRequest.timeout = 15e3;
  g_oRequest.setRequestHeader("Accept-Language", "en-US");
  // g_oRequest.setRequestHeader('Accept-Language', 'en-US');
  g_oRequest.setRequestHeader("Client-ID", "kimne78kx3ncx6brgo4mv6wki5h1ko");
  // g_oRequest.setRequestHeader('Client-ID', 'kimne78kx3ncx6brgo4mv6wki5h1ko');
  g_oRequest.setRequestHeader("Content-Type", "text/plain; charset=UTF-8");
  // g_oRequest.setRequestHeader('Content-Type', 'text/plain; charset=UTF-8');
  if (sendRequest._msDeviceId === void 0) {
    sendRequest._msDeviceId = document.cookie.match(
      /(?:^|;[ \t]?)unique_id=([^;]+)/
    );
    // sendRequest._msDeviceId = document.cookie.match(/(?:^|;[ \t]?)unique_id=([^;]+)/);
  }
  if (sendRequest._msDeviceId) {
    g_oRequest.setRequestHeader(
      "X-Device-ID",
      sendRequest._msDeviceId[1]
    );
    // g_oRequest.setRequestHeader('X-Device-ID', sendRequest._msDeviceId[1]);
  }
  // g_oRequest.send(createGqlRequestBody(`query($login: String!) {
  g_oRequest.send(
    createGqlRequestBody(
      `query($login: String!) {
	
			user(login: $login) {
				stream {
					isEncrypted
				}
				watchParty {
					session {
						state
					}
				}
			}
		}`,
      {
        login: g_sChannelCode,
        // login: g_sChannelCode
      }
    )
  );
}

function processResponse({ target: oRequest }) {
  // function processResponse({target: oRequest}) {
  g_oRequest = null;
  if (
    oRequest.status >= 200 &&
    oRequest.status < 300 &&
    IsObject(oRequest.response)
  ) {
    // if (oRequest.status >= 200 && oRequest.status < 300 && IsObject(oRequest.response)) {
    const bRedirect = g_nLastCheck === -2;
    g_nLastCheck = performance.now();
    let bBroadcastEndedOrEncoded = true,
      bCoWatching = false;
    // let bStreamFinishedOrEncoded = true, bWatchParty = false;
    try {
      bBroadcastEndedOrEncoded =
        oRequest.response.data.user.stream.isEncrypted === true;
      // bStreamFinishedOrEncoded = oRequest.response.data.user.stream.isEncrypted === true;
      bCoWatching =
        oRequest.response.data.user.watchParty.session.state === "IN_PROGRESS";
      // bWatchParty = oRequest.response.data.user.watchParty.session.state === 'IN_PROGRESS';
    } catch (_) {}
    g_bIsStreaming =
      !bBroadcastEndedOrEncoded && !bCoWatching;
    // g_bIsStreaming = !bStreamFinishedOrEncoded && !bWatchParty;
    if (g_bIsStreaming && bRedirect) {
      redirectToOurPlayer(g_sChannelCode);
    }
  } else {
    g_nLastCheck = 0;
  }
}

function launchOurPlayer(sChannelCode) {
  const sPlayerAddress = GetOurPlayerAddress(sChannelCode);
  m_Log.Wow(`[content.js] Перехожу на страницу ${sPlayerAddress}`);
  // m_Log.Wow(`[content.js] Navigating to page ${sPlayerAddress}`);
  disableAutoRedirectForThisPage();
  setPageAddress(sPlayerAddress);
}

function redirectToOurPlayer(sChannelCode) {
  const sPlayerAddress = GetOurPlayerAddress(sChannelCode);
  m_Log.Wow(
    `[content.js] Меняю адрес страницы с ${location.href} на ${sPlayerAddress}`
  );
  // m_Log.Wow(`[content.js] Changing page address from ${location.href} to ${sPlayerAddress}`);
  document.documentElement.setAttribute(
    "data-tw5-перенаправление",
    sPlayerAddress
  );
  // document.documentElement.setAttribute('data-tw5-redirect', sPlayerAddress);
  setPageAddress(sPlayerAddress, true);
}

function handlePointerDownAndClick(oEvent) {
  if (g_oParsedAddress) {
    const nodeLink = oEvent.target.closest("a[href]");
    // const nodeLink = oEvent.target.closest('a[href]');
    if (
      nodeLink &&
      oEvent.isPrimary !== false &&
      oEvent.button === LEFT_BUTTON &&
      !oEvent.shiftKey &&
      !oEvent.ctrlKey &&
      !oEvent.altKey &&
      !oEvent.metaKey
    ) {
      // if (nodeLink && oEvent.isPrimary !== false && oEvent.button === LEFT_BUTTON && !oEvent.shiftKey && !oEvent.ctrlKey && !oEvent.altKey && !oEvent.metaKey) {
      m_Log.Wow(
        `[content.js] Произошло событие ${oEvent.type} у ссылки ${nodeLink.href}`
      );
      // m_Log.Wow(`[content.js] Event ${oEvent.type} occurred on link ${nodeLink.href}`);
      requestChannelState(parseAddress(nodeLink));
    }
  }
}

function handlePopState(oEvent) {
  if (g_oParsedAddress) {
    m_Log.Wow(`[content.js] Произошло событие popstate ${location.href}`);
    // m_Log.Wow(`[content.js] popstate event occurred ${location.href}`);
    if (getBrowserEngineVersion() < 67) {
      document.title = "Twitch";
    }
    pageAddressChanged("POPSTATE");
    // pageAddressChanged('POPSTATE');
    if (document.documentElement.hasAttribute("data-tw5-перенаправление")) {
      // if (document.documentElement.hasAttribute('data-tw5-redirect')) {
      m_Log.Wow("[content.js] Скрываю событие popstate");
      // m_Log.Wow('[content.js] Hiding popstate event');
      oEvent.stopImmediatePropagation();
    }
  }
}

function handlePushState(oEvent) {
  m_Log.Wow(
    `[content.js] Произошло событие tw5-pushstate ${location.href}`
  );
  // m_Log.Wow(`[content.js] tw5-pushstate event occurred ${location.href}`);
  pageAddressChanged("PUSHSTATE");
  // pageAddressChanged('PUSHSTATE');
}

function handleLaunchOurPlayer(oEvent) {
  oEvent.preventDefault();
  if (
    oEvent.button === LEFT_BUTTON &&
    g_oParsedAddress.sPage === "POSSIBLY_LIVE_BROADCAST"
  ) {
    // if (oEvent.button === LEFT_BUTTON && g_oParsedAddress.sPage === 'POSSIBLY_LIVE_STREAM') {
    launchOurPlayer(g_oParsedAddress.sChannelCode);
  } else {
    m_Log.Wow(
      `[content.js] Не запускать player Кнопка=${oEvent.button} Страница=${g_oParsedAddress.sPage}`
    );
    // m_Log.Wow(`[content.js] Do not launch player Button=${oEvent.button} Page=${g_oParsedAddress.sPage}`);
  }
}

function handleToggleAutoRedirect(oEvent) {
  oEvent.preventDefault();
  const b = !m_Settings.Get("bAutoRedirectAllowed");
  // const b = !m_Settings.Get('bAutoRedirectAllowed');
  m_Log.Wow(`[content.js] Автоперенаправление разрешено: ${b}`);
  // m_Log.Wow(`[content.js] Auto-redirect allowed: ${b}`);
  m_Settings.Change("bAutoRedirectAllowed", b);
  // m_Settings.Change('bAutoRedirectAllowed', b);
  updateOurButton();
}

function handleCloseHelp(oEvent) {
  oEvent.preventDefault();
  m_Log.Wow("[content.js] Закрываю справку");
  // m_Log.Wow('[content.js] Closing help');
  oEvent.currentTarget.classList.remove("tw5-справка");
  // oEvent.currentTarget.classList.remove('tw5-help');
  oEvent.currentTarget.removeEventListener(
    "mouseover",
    handleCloseHelp
  );
  // oEvent.currentTarget.removeEventListener('mouseover', handleCloseHelp);
  oEvent.currentTarget.removeEventListener(
    "touchstart",
    handleCloseHelp,
    {
      // oEvent.currentTarget.removeEventListener('touchstart', handleCloseHelp, {
      passive: false,
    }
  );
  m_Settings.Change("bAutoRedirectNoticed", true);
  // m_Settings.Change('bAutoRedirectNoticed', true);
}

function getOurButton() {
  return document.getElementById("tw5-автоперенаправление");
  // return document.getElementById('tw5-autoredirect');
}

function updateOurButton() {
  getOurButton().classList.toggle(
    "tw5-запрещено",
    !m_Settings.Get("bAutoRedirectAllowed")
  );
  // getOurButton().classList.toggle('tw5-forbidden', !m_Settings.Get('bAutoRedirectAllowed'));
}

function insertOurButton() {
  if (g_oParsedAddress.bMobileVersion) {
    const nodeToInsert = document.querySelector(
      ".top-nav__menu > div:last-child > div:first-child"
    );
    // const nodeToInsert = document.querySelector('.top-nav__menu > div:last-child > div:first-child');
    if (!nodeToInsert) {
      return false;
    }
    m_Log.Wow("[content.js] Вставляю нашу кнопку для мобильного сайта");
    // m_Log.Wow('[content.js] Inserting our button for mobile site');
    nodeToInsert.insertAdjacentHTML(
      "afterend",
      `
		<div class="tw5-автоперенаправление tw5-js-удалить">
			<button id="tw5-автоперенаправление">
		// <div class="tw5-autoredirect tw5-js-remove">
			// <button id="tw5-autoredirect">
				<svg viewBox="0 0 128 128">
					<g>
						<path d="M64 53h-19.688l-1.313-15.225h57l1.313-14.7h-74.55l3.937 44.888h51.712l-1.8 19.162-16.6 4.463l-16.8-4.463-1.1-11.813h-14.7l1.838 23.362 30.713 8.4l30.45-8.4 4.2-45.675z"/>
					</g>
				</svg>
			</button>
			<style>
				.tw5-автоперенаправление
				{
					flex: 0 0 auto;
					margin: 0 0 0 .5rem;
				}
				.tw5-автоперенаправление button
				{
					align-items: center;
					background-color: transparent;
					border-radius: .4rem;
					color: #0e0e10;
					display: inline-flex;
					height: 3.6rem;
					justify-content: center;
					width: 3.6rem;
				}
				.tw-root--theme-dark .tw5-автоперенаправление button
				// .tw-root--theme-dark .tw5-autoredirect button
				{
					color: #efeff1;
				}
				.tw5-автоперенаправление button:active
				{
					background-color: rgba(0, 0, 0, 0.05);
				}
				.tw-root--theme-dark .tw5-автоперенаправление button:active
				// .tw-root--theme-dark .tw5-autoredirect button:active
				{
					background-color: rgba(255, 255, 255, 0.15);
				}
				.tw5-автоперенаправление svg
				{
					fill: currentColor;
					width: 75%;
				}
				.tw5-запрещено svg
				{
					opacity: .4;
				}
			</style>
		</div>
		`
    );
  } else {
    const nodeToInsert = document.querySelector(
      ".top-nav__menu > div:last-child > div:first-child"
    );
    // const nodeToInsert = document.querySelector('.top-nav__menu > div:last-child > div:first-child');
    if (!nodeToInsert) {
      return false;
    }
    m_Log.Wow("[content.js] Вставляю нашу кнопку");
    // m_Log.Wow('[content.js] Inserting our button');
    nodeToInsert.insertAdjacentHTML(
      "afterend",
      `
		<div class="tw5-автоперенаправление tw5-js-удалить">
			<button id="tw5-автоперенаправление">
		// <div class="tw5-autoredirect tw5-js-remove">
			// <button id="tw5-autoredirect">
				<svg viewBox="0 0 128 128">
					<g>
						<path d="M64 53h-19.688l-1.313-15.225h57l1.313-14.7h-74.55l3.937 44.888h51.712l-1.8 19.162-16.6 4.463l-16.8-4.463-1.1-11.813h-14.7l1.838 23.362 30.713 8.4l30.45-8.4 4.2-45.675z"/>
					</g>
				</svg>
			</button>
			<div class="tw5-tooltip">
				${m_i18n.GetMessage("F0600")}
			</div>
			<style>
				.tw5-автоперенаправление
				{
					flex: 0 0 auto;
					margin: 0 .5rem;
					position: relative;
				}
				.tw5-автоперенаправление button
				{
					align-items: center;
					background-color: var(--color-background-button-text-default);
					border-radius: var(--border-radius-medium);
					color: var(--color-fill-button-icon);
					display: inline-flex;
					height: var(--button-size-default);
					justify-content: center;
					width: var(--button-size-default);
				}
				.tw5-автоперенаправление button:hover
				{
					background-color: var(--color-background-button-text-hover);
					color: var(--color-fill-button-icon-hover);
				}
				.tw5-автоперенаправление button:active
				{
					background-color: var(--color-background-button-text-active);
					color: var(--color-fill-button-icon-active);
				}
				.tw5-автоперенаправление svg
				{
					fill: currentColor;
					width: 75%;
				}
				.tw5-запрещено svg
				{
					opacity: .4;
				}
				.tw5-tooltip
				{
					background-color: var(--color-background-tooltip);
					border-radius: var(--border-radius-medium);
					color: var(--color-text-tooltip);
					display: none;
					font-size: var(--font-size-6);
					font-weight: var(--font-weight-semibold);
					left: 50%;
					line-height: var(--line-height-heading);
					margin-top: 6px;
					padding: 3px 6px;
					pointer-events: none;
					position: absolute;
					text-align: left;
					top: 100%;
					transform: translateX(-50%);
					user-select: none;
					white-space: nowrap;
					z-index: var(--z-index-balloon);
				}
				.tw5-tooltip::after
				{
					background-color: inherit;
					content: "";
					height: 6px;
					left: 50%;
					position: absolute;
					top: 0;
					transform: rotate(45deg) translateX(-68%);
					width: 6px;
					z-index: var(--z-index-below);
				}
				.tw5-автоперенаправление:hover .tw5-tooltip
				{
					display: block;
				}
				.tw5-справка .tw5-tooltip
				{
					background: #f00000;
					color: #fff;
					cursor: pointer;
					display: block;
					pointer-events: auto;
				}
			</style>
		</div>
		`
    );
  }
  const nodeButton = getOurButton();
  nodeButton.addEventListener("click", handleLaunchOurPlayer);
  // nodeButton.addEventListener('click', handleLaunchOurPlayer);
  nodeButton.addEventListener(
    "contextmenu",
    handleToggleAutoRedirect
  );
  // nodeButton.addEventListener('contextmenu', handleToggleAutoRedirect);
  if (
    !g_oParsedAddress.bMobileVersion &&
    !m_Settings.Get("bAutoRedirectNoticed")
  ) {
    // if (!g_oParsedAddress.bMobileVersion && !m_Settings.Get('bAutoRedirectNoticed')) {
    nodeButton.parentNode.classList.add("tw5-справка");
    // nodeButton.parentNode.classList.add('tw5-help');
    nodeButton.parentNode.addEventListener(
      "mouseover",
      handleCloseHelp
    );
    // nodeButton.parentNode.addEventListener('mouseover', handleCloseHelp);
    nodeButton.parentNode.addEventListener(
      "touchstart",
      handleCloseHelp,
      {
        // nodeButton.parentNode.addEventListener('touchstart', handleCloseHelp, {
        passive: false,
      }
    );
  }
  updateOurButton();
  return true;
}

function insertOurButtonIfNeeded() {
  return Boolean(getOurButton()) || insertOurButton();
}

function insertOurButtonFirstTime() {
  insertOurButton();
  if (g_oParsedAddress.bMobileVersion) {
    new MutationObserver((moRecords) => {
      // new MutationObserver(moRecords => {
      insertOurButtonIfNeeded();
    }).observe(document.head || document.documentElement, {
      childList: true,
      subtree: true,
    });
  } else {
    window.addEventListener(
      "tw5-изменензаголовок",
      insertOurButtonIfNeeded
    );
    // window.addEventListener('tw5-titlechanged', insertOurButtonIfNeeded);
  }
}

function waitForDom() {
  return new Promise((fResolve) => {
    // return new Promise(fResolve => {
    if (document.readyState !== "loading") {
      fResolve();
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        function HandleHomePageLoad() {
          // document.addEventListener('DOMContentLoaded', function HandleDomLoad() {
          document.removeEventListener(
            "DOMContentLoaded",
            HandleHomePageLoad
          );
          // document.removeEventListener('DOMContentLoaded', HandleDomLoad);
          fResolve();
        }
      );
    }
  });
}

function waitForPageLoad() {
  return new Promise((fResolve) => {
    // return new Promise(fResolve => {
    if (document.readyState === "complete") {
      fResolve();
    } else {
      window.addEventListener("load", function HandlePageLoad() {
        // window.addEventListener('load', function HandlePageLoad() {
        window.removeEventListener("load", HandlePageLoad);
        // window.removeEventListener('load', HandlePageLoad);
        fResolve();
      });
    }
  });
}

function insertThirdPartyExtensions() {
  chrome.runtime.sendMessage(
    {
      sQuery: "InsertThirdPartyExtensions",
      // sRequest: 'InsertThirdPartyExtensions'
    },
    (oMessage) => {
      // }, oMessage => {
      if (chrome.runtime.lastError) {
        m_Log.Wow(
          `[content.js] Не удалось послать запрос на вставку сторонних расширений: ${chrome.runtime.lastError.message}`
        );
        // m_Log.Wow(`[content.js] Failed to send request to insert third-party extensions: ${chrome.runtime.lastError.message}`);
        return;
      }
      //! оСообщение.сСторонниеРасширения contains a limited set of known browser extensions that are currently
      // ! oMessage.sThirdPartyExtensions contains a limited set of known browser extensions that are currently
      //! installed and enabled in the browser. See обработатьСообщениеЧата() in player.js. Load those
      // ! installed and enabled in the browser. See handleChatMessage() in player.js. Load those
      //! extensions into <iframe>. Chrome itself cannot load installed extensions into another extension.
      //! See https://bugs.chromium.org/p/chromium/issues/detail?id=599167
      if (oMessage.sThirdPartyExtensions.includes("BTTV ")) {
        // if (oMessage.sThirdPartyExtensions.includes('BTTV ')) {
        waitForPageLoad().then(() => {

          //! BetterTTV browser extension
          //! https://betterttv.com/
          //! https://chrome.google.com/webstore/detail/ajopnjidmegmdimjlfnijceegpefgped
          const script = document.createElement("script");
          script.id = "betterttv";
          script.src = "https://cdn.betterttv.net/betterttv.js";
          document.head.appendChild(script);
        });
      }
      if (oMessage.sThirdPartyExtensions.includes("FFZ ")) {
        // if (oMessage.sThirdPartyExtensions.includes('FFZ ')) {
        waitForDom().then(() => {

          //! FrankerFaceZ browser extension
          //! https://www.frankerfacez.com/
          //! https://chrome.google.com/webstore/detail/fadndhdgpmmaapbmfcknlfgcflmmmieb
          const script = document.createElement("script");
          script.id = "ffz_script";
          script.src = "https://cdn.frankerfacez.com/script/script.min.js";
          document.head.appendChild(script);
        });
      }
    }
  );
}

function changeChatStyle() {
  const nodeStyle = document.createElement("link");
  // const nodeStyle = document.createElement('link');
  nodeStyle.rel = "stylesheet";
  // nodeStyle.rel = 'stylesheet';
  nodeStyle.href = chrome.runtime.getURL("content.css");
  // nodeStyle.href = chrome.runtime.getURL('content.css');
  nodeStyle.className = "tw5-js-удалить";
  // nodeStyle.className = 'tw5-js-remove';
  (document.head || document.documentElement).appendChild(nodeStyle);
}

function changeChatBehavior() {
  window.addEventListener(
    "click",
    (oEvent) => {
      // window.addEventListener('click', oEvent => {
      if (oEvent.button !== LEFT_BUTTON) {
        return;
      }
      const nodeLink = oEvent.target.closest(
        'a[href^="http:"],a[href^="https:"],a[href]:not([href=""]):not([href^="#"]):not([href*=":"]):not([href$="/not-a-location"])'
      );
      // const nodeLink = oEvent.target.closest('a[href^="http:"],a[href^="https:"],a[href]:not([href=""]):not([href^="#"]):not([href*=":"]):not([href$="/not-a-location"])');
      if (!nodeLink) {
        return;
      }
      m_Log.Wow(
        `[content.js] Открываю ссылку в новой вкладке: ${nodeLink.getAttribute(
          "href"
        )}`
      );
      // m_Log.Wow(`[content.js] Opening link in new tab: ${nodeLink.getAttribute('href')}`);
      nodeLink.target = "_blank";
      // nodeLink.target = '_blank';
      oEvent.stopImmediatePropagation();
    },
    true
  );
  const oObserver = new MutationObserver((moRecords) => {
    // const oObserver = new MutationObserver(moRecords => {
    const sel = document.getElementsByClassName("channel-leaderboard");
    // const sel = document.getElementsByClassName('channel-leaderboard');
    if (sel.length !== 0) {
      sel[0].parentElement.parentElement.classList.add(
        "tw5-parent-channel-leaderboard"
      );
      // sel[0].parentElement.parentElement.classList.add('tw5-parent-channel-leaderboard');
      oObserver.disconnect();
    }
  });
  oObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  setTimeout(() => oObserver.disconnect(), 6e4);
}

function removeOldVersionTails() {}

AddExceptionHandler(() => {
  m_Log.Wow(
    `[content.js] Запущен ${performance.now().toFixed()}мс ${location.href}`
  );
  // m_Log.Wow(`[content.js] Launched ${performance.now().toFixed()}ms ${location.href}`);
  if (parseAddress(location).sPage === "CHANNEL_CHAT") {
    // if (parseAddress(location).sPage === 'CHANNEL_CHAT') {
    insertOnPage();
    if (window.top !== window) {
      insertThirdPartyExtensions();
      changeChatStyle();
      changeChatBehavior();
    }
    return;
  }
  removeOldVersionTails();
  const sEvent = window.PointerEvent ? "pointerdown" : "mousedown";
  // const sEvent = window.PointerEvent ? 'pointerdown' : 'mousedown';
  window.addEventListener(sEvent, handlePointerDownAndClick, true);
  window.addEventListener("click", handlePointerDownAndClick, true);
  // window.addEventListener('click', handlePointerDownAndClick, true);
  window.addEventListener("popstate", handlePopState);
  // window.addEventListener('popstate', handlePopState);
  m_Settings
    .Restore()
    .then(() => {
      // m_Settings.Restore().then(() => {
      pageAddressChanged("LOAD");
      // pageAddressChanged('LOAD');
      window.addEventListener("tw5-pushstate", handlePushState);
      // window.addEventListener('tw5-pushstate', handlePushState);
      insertOnPage();
      insertOurButtonFirstTime();
    })
    .catch(m_Debug.CaughtException);
  // }).catch(m_Debug.CaughtException);
})();
