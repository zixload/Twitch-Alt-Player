/**
 * @toc
 *
 * =============================================================================
 *                     TABLE OF CONTENTS (GOTO Line: control+g)
 * =============================================================================
 *
 *  In order of appearance in the file:
 *
 *  1. CONSTANTS...........................................(lines 4-82)
 *     - Global constants for player states, processing status, etc.
 *
 *  2. UTILITY FUNCTIONS...................................(lines 84-417)
 *     - Generic helper functions (Text, Round, Clamp, DOM manipulation, etc.).
 *
 *  3. DEBUG & ERROR REPORTING (м_Отладка).................(lines 419-866)
 *     - Handles all fatal errors, exceptions, and user-submitted reports.
 *     - Displays the final error/feedback screen.
 *
 *  4. CORE DATA STRUCTURES & ASYNC........................(lines 868-1191)
 *     - Promise Cancellation (ОтменаОбещания): Custom promise cancellation logic.
 *     - Segment (Сегмент): Class representing a single video/audio segment.
 *     - Segment Queue (г_моОчередь): Global queue for managing segments through
 *       the processing pipeline (download -> convert -> buffer).
 *
 *  5. UI & UX MODULES.....................................(lines 1193-3435)
 *     - Number Input (ВводЧисла): Reusable component for number inputs.
 *     - Event Bus (м_События): Global pub/sub for inter-module communication.
 *     - Memory Recycler (м_Помойка): Manages memory by offloading ArrayBuffers.
 *     - Focus Manager (м_Фокусник): Tracks browser tab focus/visibility.
 *     - Pulse Checker (м_Пульс): Monitors for UI thread freezes.
 *     - Statistics (м_Статистика): Core module for collecting and displaying
 *       all playback, network, and performance metrics in the stats overlay.
 *     - Window Manager (м_Окно): Manages modal dialogs (Settings, News, etc.).
 *     - Menu (м_Меню): Handles the main player context menu.
 *     - Fullscreen Mode (м_ПолноэкранныйРежим): Manages fullscreen state.
 *     - Picture-in-Picture (м_КартинкаВКартинке): Manages PiP state.
 *     - Dragger (м_Тащилка): Handles dragging/resizing UI elements (e.g., chat).
 *     - Auto-Hide Controls (м_Автоскрытие): Manages auto-hiding of player controls.
 *     - Media Query (м_Медиазапрос): Handles responsive UI adjustments.
 *     - Theming/Appearance (м_Оформление): Manages custom styling and UI colors.
 *
 *  6. NEWS & UPDATES (м_Новости)..........................(lines 3437-3861)
 *     - Displays the changelog and help manual.
 *     - Checks for new versions of the extension.
 *
 *  7. CENTRAL CONTROL (м_Управление)......................(lines 3863-5050)
 *     - Central hub for all user input (keyboard shortcuts, clicks).
 *     - Manages player state transitions (playing, stopped, replay).
 *     - Bridges UI actions to player logic.
 *
 *  8. CHAT MODULE (м_Чат).................................(lines 5052-5445)
 *     - Manages the integrated Twitch chat iframe, including its position and state.
 *
 *  9. PLAYER CORE (м_Проигрыватель).......................(lines 5447-6001)
 *     - The heart of the player. Manages the `<video>` element and MediaSource Extensions (MSE).
 *     - Appends processed segments to the SourceBuffer.
 *     - Handles playback state (play, pause, seeking, ended).
 *     - Manages buffer health (stalls, overflow) and seeking logic.
 *
 *  10. PLAYLIST MANAGER (м_Список)........................(lines 6003-7502)
 *      - Fetches and parses M3U8 master and media playlists.
 *      - Manages ad-detection and switching between ad/clean streams.
 *      - Identifies new segments and adds them to the processing queue.
 *
 *  11. SEGMENT PROCESSOR (м_Преобразователь)..............(lines 7504-7694)
 *      - Uses a Web Worker to process downloaded TS segments.
 *      - Receives raw segments and sends back transmuxed/inspected segments.
 *
 *  12. HTTP DOWNLOADER (м_Загрузчик)......................(lines 7696-8096)
 *      - Low-level XHR-based utility for downloading playlists and segments.
 *      - Includes retry logic, timeout handling, and stats collection.
 *
 *  13. TWITCH API WRAPPER (м_Twitch)......................(lines 8098-9043)
 *      - Handles all communication with Twitch's backend (GQL, Usher).
 *      - Fetches stream access tokens, channel metadata, user info, etc.
 *      - Sends telemetry for ad viewership.
 *
 *  14. MAIN INITIALIZATION (Запускалка)...................(lines 9045-9095)
 *      - The main entry point. Initializes all modules and starts the player.
 * 
 *  15. AD DATA LOGGING
 *      - Where to start looking into the "hiding ads" problem: the video freezing,
 *        showing a solid black screen, or the player waiting through the whole
 *        pre-roll pod before playback starts.
 *      - Search the log for the [AdBlock] prefix. Those messages go through
 *        м_Журнал, so they land in the debug window and in bug reports rather
 *        than only in the devtools console.
 */
"use strict";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
// const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const LOAD_METADATA_NO_LONGER_THAN = 15e3;
// const LOAD_METADATA_NO_LONGER_THAN = 15e3;

const LOAD_VARIANT_LIST_NO_LONGER_THAN = 15e3;
// const LOAD_VARIANT_LIST_NO_LONGER_THAN = 15e3;

const LOAD_SEGMENT_LIST_NO_LONGER_THAN = 6e3;
// const LOAD_SEGMENT_LIST_NO_LONGER_THAN = 6e3;

const PROCESSING_AWAITING_DOWNLOAD = 1;
// const PROCESSING_AWAITING_DOWNLOAD = 1;

const PROCESSING_DOWNLOADING = 2;
// const PROCESSING_DOWNLOADING = 2;

const PROCESSING_DOWNLOADED = 3;
// const PROCESSING_DOWNLOADED = 3;

const PROCESSING_CONVERTED = 4;
// const PROCESSING_CONVERTED = 4;

const STATE_START = 1;
// const STATE_START = 1;

const STATE_BROADCAST_START = 2;
// const STATE_BROADCAST_START = 2;

const STATE_BROADCAST_END = 3;
// const STATE_BROADCAST_END = 3;

const STATE_LOADING = 4;
// const STATE_LOADING = 4;

const STATE_PLAYBACK_START = 5;
// const STATE_PLAYBACK_START = 5;

const STATE_PLAYING = 6;
// const STATE_PLAYING = 6;

const STATE_STOP = 7;
// const STATE_STOP = 7;

const STATE_REPEAT = 8;
// const STATE_REPEAT = 8;

const STATE_VARIANT_CHANGE = 9;
// const STATE_VARIANT_CHANGE = 9;

const SUBSCRIPTION_UPDATING = -1;
// const SUBSCRIPTION_UPDATING = -1;

const SUBSCRIPTION_UNAVAILABLE = 0;
// const SUBSCRIPTION_UNAVAILABLE = 0;

const SUBSCRIPTION_NOT_SUBSCRIBED = 1;
// const SUBSCRIPTION_NOT_SUBSCRIBED = 1;

let г_лИгнорироватьСегментыРекламы = false;

const SUBSCRIPTION_DO_NOT_NOTIFY = 2;
// const SUBSCRIPTION_DO_NOT_NOTIFY = 2;

const SUBSCRIPTION_NOTIFY = 3;
// const SUBSCRIPTION_NOTIFY = 3;

const КОД_ОТВЕТА = "Server returned code ";
// const RESPONSE_CODE = 'Server returned code ';

let g_nExactTime = NaN;
// let g_nExactTime = NaN;

if (!navigator.clipboard) {
  navigator.clipboard = {};
}

if (!navigator.clipboard.writeText) {
  navigator.clipboard.writeText = function (sText) {
    // navigator.clipboard.writeText = function(sText) {
    Check(typeof sText == "string");
    // Check(typeof sText == 'string');
    return new Promise(
      AddExceptionHandler((fResolve, fReject) => {
        // return new Promise(AddExceptionHandler((fResolve, fReject) => {
        const nodeText = document.createElement("input");
        // const nodeText = document.createElement('input');
        nodeText.type = "text";
        // nodeText.type = 'text';
        nodeText.readOnly = true;
        // nodeText.readOnly = true;
        nodeText.value = sText;
        // nodeText.value = sText;
        nodeText.style.position = "fixed";
        // nodeText.style.position = 'fixed';
        nodeText.style.left = "-100500px";
        // nodeText.style.left = '-100500px';
        document.body.appendChild(nodeText);
        // document.body.appendChild(nodeText);
        nodeText.select();
        // nodeText.select();
        const bSuccess = document.execCommand("copy");
        // const bSuccess = document.execCommand('copy');
        nodeText.remove();
        // nodeText.remove();
        if (bSuccess) {
          // if (bSuccess) {
          fResolve();
          // fResolve();
        } else {
          fReject();
          // fReject();
        }
      })
    );
  };
}

function GetText(sCode, sSubstitution) {
  // function Text(sCode, sSubstitution) {
  return m_i18n.GetMessage(sCode, sSubstitution);
  // return m_i18n.GetMessage(sCode, sSubstitution);
}

function Round(nValue, nPrecision) {
  // function Round(nValue, nPrecision) {
  Check(
    typeof nValue == "number" &&
    Number.isInteger(nPrecision) &&
    nPrecision >= 0 &&
    nPrecision <= 20
  );
  // Check(typeof nValue == 'number' && Number.isInteger(nPrecision) && nPrecision >= 0 && nPrecision <= 20);
  if (nPrecision === 0) {
    // if (nPrecision === 0) {
    return Math.round(nValue);
    // return Math.round(nValue);
  }
  const h = Math.pow(10, nPrecision);
  // const n = Math.pow(10, nPrecision);
  return Math.round(nValue * h) / h;
  // return Math.round(nValue * n) / n;
}

function Clamp(nValue, nMin, nMax) {
  // function Clamp(nValue, nMin, nMax) {
  Check(
    Number.isFinite(nValue) &&
    Number.isFinite(nMin) &&
    Number.isFinite(nMax) &&
    nMin <= nMax
  );
  // Check(Number.isFinite(nValue) && Number.isFinite(nMin) && Number.isFinite(nMax) && nMin <= nMax);
  return Math.min(Math.max(nValue, nMin), nMax);
  // return Math.min(Math.max(nValue, nMin), nMax);
}

function chain(pObject, ...msProperties) {
  // function chain(pObject, ...msProperties) {
  Check(msProperties.length !== 0);
  // Check(msProperties.length !== 0);
  for (const sProperty of msProperties) {
    // for (const sProperty of msProperties) {
    if (!IsObject(pObject)) {
      // if (!IsObject(pObject)) {
      return null;
    }
    Check(IsNonEmptyString(sProperty));
    // Check(IsNonEmptyString(sProperty));
    pObject = pObject[sProperty];
    // pObject = pObject[sProperty];
  }
  return pObject;
  // return pObject;
}

function ResolveRelativeUrl(sRelativeUrl, sAbsoluteBaseUrl) {
  return new URL(sRelativeUrl, sAbsoluteBaseUrl).href;
}

function ChangeDocumentTitle(sTitle) {
  // function ChangeDocumentTitle(sTitle) {
  history.replaceState(null, "");
  document.title = sTitle;
  // document.title = sTitle;
}

function checkExtensionPermissions() {
  return new Promise((fResolve) => {
    chrome.permissions.contains(
      {
        origins: chrome.runtime
          .getManifest()
          .permissions.filter((sPermission) => sPermission.includes(":")),
      },
      (bAllowed) => {
        if (chrome.runtime.lastError) {
          console.error(
            "permissions.contains",
            chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        if (!bAllowed) {
          m_Debug.FinishWorkAndShowMessage("J0215");
        }
        fResolve();
      }
    );
  });
}

getCurrentTab.nTabId = NaN;

getCurrentTab.sCookieStore = "";

function getCurrentTab() {
  return new Promise((fResolve) => {
    chrome.tabs.getCurrent(
      AddExceptionHandler((oTab) => {
        if (
          chrome.runtime.lastError ||
          !IsObject(oTab) ||
          !Number.isSafeInteger(oTab.id) ||
          oTab.id === chrome.tabs.TAB_ID_NONE
        ) {
          console.error(
            "tabs.getCurrent",
            chrome.runtime.lastError && chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        getCurrentTab.nTabId = oTab.id;
        fResolve();
      })
    );
  });
}

function getAllCookies(sAddress) {
  return new Promise((fResolve) => {
    const oParameters = {
      url: sAddress,
    };
    if (getCurrentTab.sCookieStore) {
      oParameters.storeId = getCurrentTab.sCookieStore;
    }
    chrome.cookies.getAll(
      oParameters,
      AddExceptionHandler((maCookies) => {
        if (!chrome.runtime.lastError && Array.isArray(maCookies)) {
          m_Log.Вот(`[API] Количество печенек: ${maCookies.length}`);
          fResolve(maCookies);
        } else {
          console.error(
            "cookies.getAll",
            chrome.runtime.lastError && chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
      })
    );
  });
}

function deleteCookie(sName, sAddress) {
  return new Promise((fResolve) => {
    chrome.cookies.remove(
      {
        name: sName,
        url: sAddress,
      },
      AddExceptionHandler(() => {
        if (chrome.runtime.lastError) {
          console.error("cookies.remove", chrome.runtime.lastError.message);
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        fResolve();
      })
    );
  });
}

function OpenAddressInNewTab(sAddress) {
  window.open(sAddress);
}

function WriteTextToLocalFile(sText, sDataType, sFileName) {
  Check(
    typeof sText == "string" &&
    IsNonEmptyString(sDataType) &&
    IsNonEmptyString(sFileName)
  );
  const nodeLink = document.createElement("a");
  nodeLink.href = URL.createObjectURL(
    new Blob([sText], {
      type: sDataType,
    })
  );
  nodeLink.download = sFileName;
  nodeLink.dispatchEvent(new MouseEvent("click"));
}

function createElementEventHandler(fCall) {
  return AddExceptionHandler((oEvent) => {
    if (oEvent.target.nodeType === Node.ELEMENT_NODE) {
      fCall(oEvent);
    }
  });
}

function IsLinkEvent(oEvent) {
  return !!oEvent.target.closest("a[href]");
}

function ElementAtThisPointCanScroll(x, y) {
  for (
    let nodeElement = document.elementFromPoint(x, y);
    nodeElement;
    nodeElement = nodeElement.parentElement
  ) {
    if (ThisElementCanScroll(nodeElement)) {
      return true;
    }
  }
  return false;
}

function ThisElementCanScroll(nodeElement) {
  const oStyle = getComputedStyle(nodeElement);
  return (
    (oStyle.overflowY === "scroll" || oStyle.overflowY === "auto") &&
    nodeElement.clientHeight < nodeElement.scrollHeight
  );
}

function thisElementIsFullyScrolled(elElement) {
  return (
    elElement.scrollHeight - elElement.scrollTop - elElement.clientHeight < 2
  );
}

function ShowElement(pElement, bShow) {
  const nodeElement = GetNode(pElement);
  if (bShow) {
    nodeElement.removeAttribute("hidden");
  } else {
    nodeElement.setAttribute("hidden", "");
  }
  return nodeElement;
}

function ElementIsShown(pElement) {
  return !GetNode(pElement).hasAttribute("hidden");
}

function ChangeButton(pButton, pState) {
  const nodeButton = GetNode(pButton);
  const nState = Number(pState);
  const nodeStates = nodeButton.getElementsByTagName("use");
  Check(nState >= 0 && nState < nodeStates.length);
  for (let idx = 0; idx < nodeStates.length; ++idx) {
    if (idx === nState) {
      const sTooltip = nodeStates[idx].getAttributeNS(
        "http://www.w3.org/1999/xlink",
        "title"
      );
      if (sTooltip) {
        nodeButton.title = GetText(sTooltip);
      }
      nodeStates[idx].removeAttribute("display");
    } else {
      nodeStates[idx].setAttribute("display", "none");
    }
  }
  return nodeButton;
}

const m_Debug = (() => {
  const MAX_REPORT_STRING_LENGTH = 15e4;
  let _sBroadcastToken = "";
  let _sBroadcastTokenWithoutAds = "";
  let _sVariantList = "";
  let _msSegmentLists = [];
  function InsertFileDownloadLinks(nodeForm) { }
  function ShowPage() {
    try {
      m_FullscreenMode.Disable();
    } catch (_) { }
    document.body.textContent = "";
    for (let node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      node.remove();
    }
    for (let node of [document.documentElement, document.body]) {
      node.removeAttribute("class");
      node.removeAttribute("style");
      node.removeAttribute("hidden");
    }
    return new Promise((fResolve) => {
      const node = document.createElement("iframe");
      node.src = "report.html";
      node.style.position = "fixed";
      node.style.top = "0";
      node.style.left = "0";
      node.style.width = "100%";
      node.style.height = "100%";
      node.style.zIndex = "100500";
      node.style.border = "0";
      node.addEventListener("load", () => {
        m_i18n.TranslateDocument(node.contentDocument);
        fResolve(node.contentDocument);
      });
      document.body.appendChild(node);
    });
  }
  function ShowForm(oDocument, sFormId, bConfigureBackground) {
    if (bConfigureBackground) {
      oDocument.documentElement.classList.add(sFormId);
    }
    for (
      let nodeShowOrHide, nodeForms = oDocument.forms, idx = 0;
      (nodeShowOrHide = nodeForms[idx]);
      ++idx
    ) {
      if (nodeShowOrHide.id === sFormId) {
        ShowElement(nodeShowOrHide, true);
        const nodeFocus = nodeShowOrHide.querySelector("[autofocus]");
        if (nodeFocus) {
          nodeFocus.focus();
        }
      } else {
        ShowElement(nodeShowOrHide, false);
      }
    }
  }
  function ShowMessage(sMessage, sLinkCode, sLinkAddress) {
    ShowPage().then((oDocument) => {
      oDocument.getElementById("отладка-текстсообщения").textContent =
        sMessage;
      if (sLinkCode) {
        const elLink = oDocument.getElementById("отладка-ссылкасообщения");
        elLink.textContent = GetText(sLinkCode);
        elLink.href = sLinkAddress;
      }
      ShowForm(oDocument, "отладка-сообщение", true);
    });
  }
  function ShowAndSendReport(oReport, bufSend) {
    ShowPage().then((oDocument) => {
      let nodeForm;
      if (oReport.TerminationReason === "ОТПРАВИТЬ ОТЗЫВ") {
        nodeForm = oDocument.getElementById("отладка-отзыв");
      } else {
        nodeForm = oDocument.getElementById("отладка-ошибка");
        InsertFileDownloadLinks(nodeForm);
      }
      nodeForm.elements["отладка-отчет"].value = JSON.stringify(oReport);
      ShowForm(oDocument, nodeForm.id, true);
      oDocument.addEventListener("reset", (oEvent) => {
        oEvent.preventDefault();
        window.location.reload(true);
      });
      /**
       * The report is written to a local file. It used to be POSTed to a personal
       * shared-hosting box over plain HTTP; that upload is gone, along with the
       * XMLHttpRequest, the progress bar and the status-code handling that served it.
       *
       * The identifiers the Twitch playback token carries — the viewer's public IP
       * address, their account id and their device id — are stripped on the way out.
       * Dropping the two token fields is not enough: the token is echoed into the log
       * as well, so the whole report is walked and every occurrence is replaced.
       */
      // The token is echoed into the log inside another JSON string, where its
      // quotes are backslash-escaped, so both forms have to match.
      const РВ_ЛИЧНЫЕ_ДАННЫЕ =
        /\\?"(user_ip|user_id|device_id)\\?"\s*:\s*(?:\\?"(?:[^"\\]|\\.)*?\\?"|-?\d+|null)/g;

      function ВычиститьЛичныеДанные(pValue) {
        if (typeof pValue == "string") {
          return pValue.replace(РВ_ЛИЧНЫЕ_ДАННЫЕ, '"$1":"[removed]"');
        }
        if (Array.isArray(pValue)) {
          return pValue.map(ВычиститьЛичныеДанные);
        }
        if (IsObject(pValue)) {
          const оВычищено = {};
          for (const сКлюч of Object.keys(pValue)) {
            оВычищено[сКлюч] = ВычиститьЛичныеДанные(pValue[сКлюч]);
          }
          return оВычищено;
        }
        return pValue;
      }

      oDocument.addEventListener("submit", (oEvent) => {
        oEvent.preventDefault();

        const СНЯТО = "[removed: playback token]";
        const оОтчетДляФайла = ВычиститьЛичныеДанные(
          Object.assign({}, oReport, {
            BroadcastToken: СНЯТО,
            BroadcastTokenWithoutAds: СНЯТО,
          })
        );

        const узСообщение = nodeForm.elements["отладка-сообщение"];
        if (узСообщение && узСообщение.value) {
          оОтчетДляФайла.Сообщение = узСообщение.value;
        }

        WriteTextToLocalFile(
          JSON.stringify(оОтчетДляФайла, null, "\t"),
          "application/json",
          `tw5-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
        );
      });
    });
  }
  function saveBroadcastToken(sBroadcastToken, bWithoutAds) {
    sBroadcastToken = LimitStringLength(
      sBroadcastToken,
      MAX_REPORT_STRING_LENGTH
    );
    if (bWithoutAds) {
      _sBroadcastTokenWithoutAds = sBroadcastToken;
    } else {
      _sBroadcastToken = sBroadcastToken;
    }
  }
  function SaveVariantList(sVariantList) {
    _sVariantList = sVariantList;
  }
  function SaveSegmentList(sSegmentList) {
    if (_msSegmentLists.length === 10) {
      _msSegmentLists.shift();
    }
    _msSegmentLists.push(sSegmentList);
  }
  function SaveTransportStream(oSegment) { }
  function SaveConvertedSegment(oSegment) { }
  function compressList(sList) {
    return LimitStringLength(
      sList.replace(
        /^(?:https?:\/\/|#EXT-X-TWITCH-PREFETCH:).+$/gm,
        (sString) => LimitStringLength(sString, 100)
      ),
      MAX_REPORT_STRING_LENGTH
    );
  }
  function SniffProcessorAndRAM(fCall) {
    const oProcessorAndRAM = {
      capacity: navigator.deviceMemory,
      numOfProcessors: navigator.hardwareConcurrency,
    };
    if (performance.memory) {
      oProcessorAndRAM.jsHeapSizeLimit = Math.round(
        performance.memory.jsHeapSizeLimit / 1024 / 1024
      );
      oProcessorAndRAM.totalJSHeapSize = Math.round(
        performance.memory.totalJSHeapSize / 1024 / 1024
      );
      oProcessorAndRAM.usedJSHeapSize = Math.round(
        performance.memory.usedJSHeapSize / 1024 / 1024
      );
    }
    try {
      chrome.system.memory.getInfo((oRAM) => {
        try {
          oProcessorAndRAM.capacity = Round(
            oRAM.capacity / 1024 / 1024 / 1024,
            1
          );
          oProcessorAndRAM.availableCapacity = Round(
            oRAM.availableCapacity / 1024 / 1024 / 1024,
            1
          );
          chrome.system.cpu.getInfo((oProcessor) => {
            try {
              oProcessorAndRAM.numOfProcessors =
                oProcessor.numOfProcessors;
              oProcessorAndRAM.modelName = oProcessor.modelName;
              oProcessorAndRAM.archName = oProcessor.archName;
            } catch (_) { }
            fCall(oProcessorAndRAM);
          });
        } catch (_) {
          fCall(oProcessorAndRAM);
        }
      });
    } catch (_) {
      fCall(oProcessorAndRAM);
    }
  }
  function SniffGPU() {
    try {
      const oContext = document.createElement("canvas").getContext("webgl");
      const oExtension = oContext.getExtension("WEBGL_debug_renderer_info");
      return `${oContext.getParameter(
        oExtension.UNMASKED_VENDOR_WEBGL
      )} | ${oContext.getParameter(oExtension.UNMASKED_RENDERER_WEBGL)}`;
    } catch (_) { }
  }
  function getConnectionParameters() {
    const oConnection = navigator.connection || {};
    return {
      online: navigator.onLine,
      effectiveType: oConnection.effectiveType,
      downlink: oConnection.downlink,
      rtt: oConnection.rtt,
      type: oConnection.type,
      downlinkMax: oConnection.downlinkMax,
    };
  }
  function GetLanguages() {
    try {
      return `${navigator.language} | ${navigator.languages} | ${GetText(
        "J0103"
      )}`;
    } catch (_) { }
  }
  function GetDateSettings() {
    try {
      const oSettings = new Intl.DateTimeFormat().resolvedOptions();
      oSettings.timezoneOffset = new Date().getTimezoneOffset();
      return oSettings;
    } catch (_) { }
  }
  function CreateShowAndSendReport(
    sTerminationReason,
    bufSend
  ) {
    SniffProcessorAndRAM((oProcessorAndRAM) => {
      ShowAndSendReport(
        {
          TerminationReason: sTerminationReason,
          ExtensionVersion: EXTENSION_VERSION,
          Browser: navigator.userAgent,
          Time: new Date().toISOString(),
          Address: window.location.href,
          Incognito: chrome.extension.inIncognitoContext,
          Desync: Date.now() - performance.now() - g_nExactTime,
          FocusManager: m_FocusManager.GetState(),
          Heartbeat: m_Heartbeat.GetDataForReport(),
          Settings: m_Settings.GetDataForReport(),
          Statistics: m_Statistics.GetDataForReport(),
          Languages: GetLanguages(),
          DateSettings: GetDateSettings(),
          Connection: getConnectionParameters(),
          GPU: SniffGPU(),
          ProcessorAndRAM: oProcessorAndRAM,
          TouchPoints: navigator.maxTouchPoints,
          Display: {
            top: window.screen.top,
            left: window.screen.left,
            width: window.screen.width,
            height: window.screen.height,
            availTop: window.screen.availTop,
            availLeft: window.screen.availLeft,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
            colorDepth: window.screen.colorDepth,
            pixelDepth: window.screen.pixelDepth,
            orientation:
              typeof window.screen.orientation == "object"
                ? window.screen.orientation.type
                : void 0,
            screenX: window.screenX,
            screenY: window.screenY,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          },
          BroadcastToken: _sBroadcastToken,
          BroadcastTokenWithoutAds: _sBroadcastTokenWithoutAds,
          VariantList: compressList(_sVariantList),
          SegmentLists: _msSegmentLists.map(compressList),
          Log: m_Log.GetDataForReport(),
        },
        bufSend
      );
    });
  }
  function FinishWorkAndShowMessage(
    sMessageCode,
    sLinkCode,
    sLinkAddress
  ) {
    if (!g_bWorkFinished) {
      console.error(sMessageCode);
      Terminate(false);
      ShowMessage(GetText(sMessageCode), sLinkCode, sLinkAddress);
    }
    throw void 0;
  }
  function TerminateAndSendReport(
    sTerminationReason,
    bufSend
  ) {
    if (!g_bWorkFinished) {
      console.error(sTerminationReason);
      sTerminationReason = LimitStringLength(
        String(sTerminationReason),
        MAX_REPORT_STRING_LENGTH
      );
      if (sTerminationReason.includes("out of memory")) {
        FinishWorkAndShowMessage("J0200");
      }
      try {
        m_Player.ShowState("Вот", "Завершаю работу");
        g_maQueue.ShowState();
      } catch (_) { }
      Terminate(false);
      CreateShowAndSendReport(sTerminationReason, bufSend);
    }
    throw void 0;
  }
  function CaughtException(pException) {
    TerminateAndSendReport(ExceptionToString(pException));
  }
  function TerminateAndSendFeedback() {
    try {
      TerminateAndSendReport("ОТПРАВИТЬ ОТЗЫВ");
    } catch (_) { }
  }
  return {
    CaughtException,
    FinishWorkAndShowMessage,
    TerminateAndSendReport,
    TerminateAndSendFeedback,
    saveBroadcastToken,
    SaveVariantList,
    SaveSegmentList,
    SaveTransportStream,
    SaveConvertedSegment,
  };
})();

class PromiseCancellation {
  constructor() {
    this.bCancelled = false;
    this._fHandler = null;
  }
  Cancel() {
    this.bCancelled = true;
    if (this._fHandler) {
      this._fHandler();
      this._fHandler = null;
    }
  }
  ReplaceHandler(fHandler) {
    Check(!this.bCancelled);
    Check(typeof fHandler == "function" || fHandler === null);
    this._fHandler = fHandler;
  }
}

PromiseCancellation.REASON = new Error("ОБЕЩАНИЕ_ОТМЕНЕНО");

function Wait(oPromiseCancellation, nMilliseconds) {
  if (oPromiseCancellation && oPromiseCancellation.bCancelled) {
    return Promise.reject(PromiseCancellation.REASON);
  }
  if (nMilliseconds === -Infinity) {
    let oPromise = Promise.resolve();
    if (oPromiseCancellation) {
      oPromise = oPromise.then(() => {
        if (oPromiseCancellation.bCancelled) {
          throw PromiseCancellation.REASON;
        }
      });
    }
    return oPromise;
  }
  Check(Number.isFinite(nMilliseconds));
  nMilliseconds = Math.round(nMilliseconds);
  Check(nMilliseconds >= 0 && nMilliseconds <= 2147483647);
  if (oPromiseCancellation) {
    return new Promise((fResolve, fReject) => {
      const nTimer = setTimeout(() => {
        oPromiseCancellation.ReplaceHandler(null);
        fResolve();
      }, nMilliseconds);
      oPromiseCancellation.ReplaceHandler(() => {
        clearTimeout(nTimer);
        fReject(PromiseCancellation.REASON);
      });
    });
  }
  return new Promise((fResolve) => {
    setTimeout(fResolve, nMilliseconds);
  });
}

class Segment {
  constructor(nProcessing, pData, nDuration, bDiscontinuity, nNumber) {
    Check(
      typeof nProcessing == "number" &&
      nProcessing >= PROCESSING_AWAITING_DOWNLOAD &&
      nProcessing <= PROCESSING_CONVERTED
    );
    Check(
      (typeof pData == "number" && nProcessing >= PROCESSING_DOWNLOADED) ||
      (typeof pData == "string" &&
        nProcessing === PROCESSING_AWAITING_DOWNLOAD) ||
      (IsObject(pData) && nProcessing > PROCESSING_AWAITING_DOWNLOAD)
    );
    switch (arguments.length) {
      case 2:
        nDuration = 0;
        bDiscontinuity = true;

      case 4:
        Check(Number.isFinite(nDuration) && nDuration >= 0);
        Check(typeof bDiscontinuity == "boolean");
        nNumber = ++Segment._nNumber;

      case 5:
        Check(Number.isFinite(nNumber));
        break;

      default:
        Check(false);
    }
    if (typeof pData == "number") {
      m_Log.Окак(
        `[Очередь] Добавлен сегмент ${nNumber} Состояние=${pData} Обработка=${nProcessing}`
      );
    }
    this.nProcessing = nProcessing;
    this.pData = pData;
    this.nDuration = nDuration;
    this.bDiscontinuity = bDiscontinuity;
    this.nNumber = nNumber;
  }
  toString() {
    if (typeof this.pData == "number") {
      return `${this.nNumber}-${this.nProcessing}-${this.pData}`;
    }
    if (this.bDiscontinuity) {
      return `${this.nNumber}-${this.nProcessing}-Р`;
    }
    return `${this.nNumber}-${this.nProcessing}`;
  }
}

Segment._nNumber = 0;

let g_maQueue = [];

g_maQueue.CountConvertedSegments = function () {
  let nAmount = 0,
    nDuration = 0;
  for (
    ;
    nAmount < this.length &&
    this[nAmount].nProcessing === PROCESSING_CONVERTED;
    ++nAmount
  ) {
    if (typeof this[nAmount].pData != "number") {
      nDuration += this[nAmount].nDuration;
    }
  }
  return {
    nAmount,
    nDuration,
  };
};

g_maQueue.Add = function (oSegment) {
  Check(oSegment instanceof Segment);
  for (let o of this) {
    Check(o.nNumber !== oSegment.nNumber);
  }
  if (oSegment.nProcessing !== PROCESSING_CONVERTED) {
    this.push(oSegment);
  } else {
    const { nAmount, nDuration } =
      this.CountConvertedSegments();
    if (nDuration > BUFFER_OVERFLOW * 1.5) {
      m_Debug.FinishWorkAndShowMessage("J0208");
    }
    this.splice(nAmount, 0, oSegment);
  }
  return oSegment;
};

g_maQueue.Remove = function (pElement, nAmount = 1) {
  if (nAmount === 0) {
    return;
  }
  Check(Number.isInteger(nAmount) && nAmount > 0);
  let nIndex;
  if (typeof pElement == "number") {
    Check(Number.isInteger(pElement) && pElement >= 0);
    nIndex = pElement;
  } else if ((nIndex = this.indexOf(pElement)) === -1) {
    Check(pElement instanceof Segment);
    return;
  }
  while (--nAmount >= 0) {
    Check(nIndex < this.length);
    switch (this[nIndex].nProcessing) {
      case PROCESSING_DOWNLOADING:
        if (IsObject(this[nIndex].pData)) {
          m_Log.Вот(`[Очередь] Отменяю загрузку ${this[nIndex]}`);
          this[nIndex].pData.Cancel();
        }
        break;

      case PROCESSING_DOWNLOADED:
        m_GarbageCollector.Discard(this[nIndex].pData);
        break;

      case PROCESSING_CONVERTED:
        if (IsObject(this[nIndex].pData)) {
          m_GarbageCollector.Discard(this[nIndex].pData.mbInitializationSegment);
          m_GarbageCollector.Discard(this[nIndex].pData.мбМедиасегмент);
        }
    }
    m_Log.Вот(`[Очередь] Удаляю ${this[nIndex]}`);
    this.splice(nIndex, 1);
  }
};

g_maQueue.Clear = function () {
  this.Remove(0, this.length);
};

g_maQueue.ShowState = function () {
  m_Log.Вот(`[Очередь] ${this.join(" ")}`);
};

class NumberInput {
  constructor(sSettingName, nStep, nPrecision, sNodeId) {
    Check(nPrecision >= 0 && IsNonEmptyString(sNodeId));
    this._sSettingName = sSettingName;
    this._nStep = nStep;
    this._nPrecision = nPrecision;
    this._nToAdd = 0;
    this._nInterval = 0;
    this._nTimer = 0;
    m_Events.AddHandler(
      `тащилка-перетаскивание-${sNodeId}`,
      (oParameters) => this._HandleDrag(oParameters)
    );
    this._nodeNumber = document.querySelector(`#${sNodeId} > .вводчисла-число`);
    this.Update();
  }
  Update(nValue = m_Settings.Get(this._sSettingName)) {
    this._nodeNumber.value =
      nValue === AUTO_SETTING
        ? GetText(
          m_Settings.GetSettingParameters(this._sSettingName)
            .sAutoTune
        )
        : m_i18n.FormatNumber(nValue, this._nPrecision);
  }
  _HandleDrag(oParameters) {
    const VALUE_CHANGE_INTERVAL = 130;
    if (oParameters.nStep === 1) {
      this._nToAdd = oParameters.nodePressed.classList.contains("вводчисла-минус")
        ? -this._nStep
        : this._nStep;
      this._nInterval = 0;
      this._nTimer = setInterval(
        () => this._HandleTimer(),
        VALUE_CHANGE_INTERVAL
      );
      this._HandleTimer();
    }
    if (oParameters.nStep === 3) {
      clearInterval(this._nTimer);
    }
  }
}

NumberInput.prototype._HandleTimer = AddExceptionHandler(
  function () {
    const VALUE_CHANGE_DELAY = 3;
    if (
      ++this._nInterval == 1 ||
      this._nInterval > VALUE_CHANGE_DELAY
    ) {
      const oSettingParameters = m_Settings.GetSettingParameters(
        this._sSettingName
      );
      const nValue = m_Settings.Get(this._sSettingName);
      let nNewValue;
      if (
        (oSettingParameters.sAutoTune &&
          this._nToAdd < 0 &&
          nValue === oSettingParameters.nMinimum) ||
        (oSettingParameters.sAutoTune &&
          this._nToAdd > 0 &&
          nValue === oSettingParameters.nMaximum)
      ) {
        nNewValue = AUTO_SETTING;
      } else if (nValue === AUTO_SETTING && this._nToAdd > 0) {
        nNewValue = oSettingParameters.nMinimum;
      } else if (nValue === AUTO_SETTING && this._nToAdd < 0) {
        nNewValue = oSettingParameters.nMaximum;
      } else {
        nNewValue = nValue + this._nToAdd;
      }
      if (nNewValue !== AUTO_SETTING) {
        nNewValue = Clamp(
          Round(nNewValue, this._nPrecision),
          oSettingParameters.nMinimum,
          oSettingParameters.nMaximum
        );
      }
      if (nNewValue !== nValue) {
        m_Settings.Change(this._sSettingName, nNewValue);
        this.Update(nNewValue);
        this.AfterChange(nNewValue);
      }
    }
  }
);

NumberInput.prototype.AfterChange = STUB;

const m_Events = (() => {
  let _amHandlers = new Map();
  function AddHandler(sEvent, fHandler) {
    Check(IsNonEmptyString(sEvent));
    Check(typeof fHandler == "function" || IsObject(fHandler));
    let setEventHandlers = _amHandlers.get(sEvent);
    if (setEventHandlers === void 0) {
      setEventHandlers = new Set();
      _amHandlers.set(sEvent, setEventHandlers);
    }
    setEventHandlers.add(fHandler);
  }
  function RemoveHandler(sEvent, fHandler) {
    Check(IsNonEmptyString(sEvent));
    Check(typeof fHandler == "function" || IsObject(fHandler));
    const setEventHandlers = _amHandlers.get(sEvent);
    if (setEventHandlers !== void 0) {
      setEventHandlers.delete(fHandler);
      if (setEventHandlers.size === 0) {
        _amHandlers.delete(sEvent);
      }
    }
  }
  function SendEvent(sEvent, pData) {
    Check(IsNonEmptyString(sEvent));
    m_Log.Вот(`[События] Event occurred: ${sEvent}`);
    const setEventHandlers = _amHandlers.get(sEvent);
    if (setEventHandlers !== void 0) {
      Check(setEventHandlers.size !== 0);
      let oEvent;
      for (let fHandler of setEventHandlers.values()) {
        if (typeof fHandler == "function") {
          fHandler(pData, sEvent);
        } else {
          if (oEvent === void 0) {
            oEvent = {
              type: sEvent,
              data: pData,
            };
          }
          fHandler.handleEvent(oEvent);
        }
      }
    }
  }
  return {
    AddHandler,
    RemoveHandler,
    SendEvent,
  };
})();

const m_GarbageCollector = (() => {
  class MessageChannelGarbageCollector {
    constructor() {
      this._oMessageChannel = null;
    }
    Discard(pJunk) {
      if (IsObject(pJunk)) {
        const bufJunk = pJunk.buffer ? pJunk.buffer : pJunk;
        if (bufJunk.byteLength) {
          m_Log.Вот(`[Помойка] Выбрасываю ${bufJunk.byteLength} байтов`);
          if (this._oMessageChannel === null) {
            this._oMessageChannel = new MessageChannel();
            this._oMessageChannel.port2.close();
          }
          this._oMessageChannel.port1.postMessage(bufJunk, [bufJunk]);
        }
      }
    }
    Burn() { }
  }
  class WorkerThreadGarbageCollector {
    constructor() {
      this._oWorkerThread = null;
      this._kbInGarbage = 0;
      m_Events.AddHandler(
        "управление-изменилосьсостояние",
        (nState) => {
          if (
            nState === STATE_BROADCAST_END ||
            nState === STATE_STOP ||
            nState === STATE_REPEAT
          ) {
            this.Burn();
          }
        }
      );
    }
    Discard(pJunk) {
      const GARBAGE_CAPACITY = 1e7;
      if (IsObject(pJunk)) {
        const bufJunk = pJunk.buffer ? pJunk.buffer : pJunk;
        if (bufJunk.byteLength) {
          m_Log.Вот(`[Помойка] Выбрасываю ${bufJunk.byteLength} байтов`);
          if (this._oWorkerThread === null) {
            this._oWorkerThread = new Worker("/recycler.js");
          }
          this._kbInGarbage += bufJunk.byteLength;
          this._oWorkerThread.postMessage(bufJunk, [bufJunk]);
          if (this._kbInGarbage > GARBAGE_CAPACITY) {
            this.Burn();
          }
        }
      }
    }
    Burn() {
      if (this._oWorkerThread !== null) {
        m_Log.Вот(`[Помойка] Сжигаю ${this._kbInGarbage} байтов`);
        this._oWorkerThread.postMessage(null);
        this._oWorkerThread = null;
        this._kbInGarbage = 0;
      }
    }
  }
  if (isMobileDevice()) {
    return {
      Discard: STUB,
      Burn: STUB,
    };
  }
  return getBrowserEngineVersion() < 67
    ? new WorkerThreadGarbageCollector()
    : new MessageChannelGarbageCollector();
})();

const m_FocusManager = (() => {
  let _oState = GetNewState();
  function GetState() {
    return _oState;
  }
  function GetNewState() {
    const bShown = !document.hidden;
    const bActive = bShown && document.hasFocus();
    return {
      bShown,
      bActive,
    };
  }
  const HandleEvent = AddExceptionHandler((oEvent) => {
    m_Log.Вот(
      `[Фокусник] Событие ${oEvent.type}, старое состояние ${m_Log.O(
        _oState
      )}`
    );
    setTimeout(UpdateState);
  });
  const UpdateState = AddExceptionHandler(() => {
    const oNewState = GetNewState();
    if (
      _oState.bShown !== oNewState.bShown ||
      _oState.bActive !== oNewState.bActive
    ) {
      m_Log.Окак(
        `[Фокусник] Новое состояние ${m_Log.O(oNewState)}`
      );
      _oState = oNewState;
      m_Events.SendEvent("фокусник-изменилосьсостояние", oNewState);
    }
  });
  m_Log.Вот(`[Фокусник] Начальное состояние ${m_Log.O(_oState)}`);
  document.addEventListener("visibilitychange", HandleEvent);
  window.addEventListener("focus", HandleEvent);
  window.addEventListener("blur", HandleEvent);
  return {
    GetState,
  };
})();

const m_Heartbeat = (() => {
  const CHECK_INTERVAL = 970;
  const MIN_TIME_DEVIATION = -30;
  const MAX_TIME_DEVIATION = 200;
  const MAX_DATE_DEVIATION = 40;
  let _nMaximumDeviation = 0;
  let _nTimer = 0;
  let _nTime;
  let _nDate;
  const CheckHeartbeat = AddExceptionHandler(() => {
    const nTime = performance.now();
    const nDate = Date.now();
    const nTimeDeviation = nTime - _nTime - CHECK_INTERVAL;
    const nDateDeviation = nDate - _nDate - (nTime - _nTime);
    if (
      nTimeDeviation < MIN_TIME_DEVIATION ||
      nTimeDeviation > MAX_TIME_DEVIATION ||
      Math.abs(nDateDeviation) > MAX_DATE_DEVIATION
    ) {
      m_Log.Ой(
        `[Пульс] ${m_Log.F0(nTimeDeviation)} ${m_Log.F0(
          nDateDeviation
        )}`
      );
    }
    _nMaximumDeviation = Math.max(
      _nMaximumDeviation,
      nTimeDeviation
    );
    _nTime = nTime;
    _nDate = nDate;
    _nTimer = setTimeout(CheckHeartbeat, CHECK_INTERVAL);
  });
  function HandleStateChange(nState) {
    if (
      nState === STATE_BROADCAST_END ||
      nState === STATE_STOP ||
      nState === STATE_REPEAT
    ) {
      if (_nTimer !== 0) {
        m_Log.Вот("[Пульс] Таймер остановлен");
        clearTimeout(_nTimer);
        _nTimer = 0;
      }
    } else if (_nTimer === 0) {
      m_Log.Вот("[Пульс] Таймер запущен");
      _nTime = performance.now();
      _nDate = Date.now();
      _nTimer = setTimeout(CheckHeartbeat, CHECK_INTERVAL);
    }
  }
  function GetDataForReport() {
    return _nMaximumDeviation;
  }
  m_Events.AddHandler(
    "управление-изменилосьсостояние",
    HandleStateChange
  );
  return {
    GetDataForReport,
  };
})();

const m_Statistics = (() => {
  const STATISTICS_UPDATE_FREQUENCY = 3;
  const LIST_HISTORY_SIZE = 30;
  const DOWNLOAD_HISTORY_SIZE = 30;
  const BUFFER_HISTORY_SIZE = 30;
  const AD_HISTORY_SIZE = 15;
  const HIGHLIGHT_RESPONSE_WAIT = 1;
  const HIGHLIGHT_CONVERTED = 2;
  const HIGHLIGHT_UNWATCHED_MIN = 1;
  const HIGHLIGHT_UNWATCHED_MAX = 0.5;
  const HIGHLIGHT_DROPPED_FRAMES = 100;
  const HIGHLIGHT_FRAME_RATE = 0.85;
  const HIGHLIGHT_VIDEO_LOSS_REL = 1 / 5;
  const HIGHLIGHT_VIDEO_LOSS_ABS = 300;
  const HIGHLIGHT_BUFFER_EXHAUSTION = 5;
  let _nTimer = 0;
  let _nTargetDuration = 0;
  let _nMinVideoSampleDuration = -Infinity;
  let _nMaxVideoSampleDuration = +Infinity;
  let _oUpdateInterval = null;
  let _oSegmentsAdded = null;
  let _oSecondsAdded = null;
  let _oSegmentThickness = null;
  let _oChannelThickness = null;
  let _oResponseWait = null;
  let _oUnwatched = null;
  let _nInitialSegments = 0;
  let _nRejectedSegments = 0;
  let _kbTotalDownloaded = 0;
  let _nDownloadErrors = 0;
  let _nSkippedSegments = 0;
  let _nUndownloadedSegments = 0;
  let _nVideoLosses = 0;
  let _nAudioLosses = 0;
  let _nBufferExhaustions = 0;
  let _nEarlyBufferExhaustions = 0;
  let _nBufferOverflows = 0;
  let _nSkippedInBuffer = 0;
  let _nAdCount = 0;
  let _nAdStartTimes = [];
  let _nAdEndTimes = [];
  let _nLastUpdateTime;
  function HighlightSegmentsAdded(nCount) {
    return nCount !== 1 && nCount !== 2;
  }
  function HighlightResponseWait(nCount) {
    return nCount >= HIGHLIGHT_RESPONSE_WAIT;
  }
  function ВыделитьНеПросмотрено(nCount) {
    return (
      nCount < HIGHLIGHT_UNWATCHED_MIN ||
      nCount >=
      m_Settings.Get("чМаксРазмерБуфера") +
      m_Settings.Get("чРастягиваниеБуфера") *
      HIGHLIGHT_UNWATCHED_MAX
    );
  }
  class Анализ {
    constructor(sNodeId, чРазмерИстории, nPrecision) {
      Check(чРазмерИстории > 0 && nPrecision >= 0);
      this._nodeTable = GetNode(sNodeId);
      this._mnHistory = new Array(чРазмерИстории);
      this._mlHighlight = new Array(чРазмерИстории);
      this._nPrecision = nPrecision;
      this._Clear();
    }
    Free() {
      this._nodeTable.textContent = "";
      this._nodeTable = null;
    }
    Clear() {
      if (this._kFilled !== 0) {
        this._Clear();
      }
    }
    ПолучитьПоследнееЧисло(чЗаглушка) {
      return this._kFilled === 0
        ? чЗаглушка
        : this._mnHistory[this._nIndex];
    }
    AddNumber(nCount, пВыделить, пВыделитьСреднее) {
      const НАЧАЛО_ИСТОРИИ = 5;
      const лВыделить = Boolean(
        typeof пВыделить == "function" ? пВыделить(nCount) : пВыделить
      );
      if (this._kFilled !== 0) {
        this._nodeTable.children[НАЧАЛО_ИСТОРИИ + this._nIndex].classList.add(
          "статистика-подробно"
        );
      }
      if (this._kFilled !== this._mnHistory.length) {
        ++this._kFilled;
      }
      if (++this._nIndex === this._mnHistory.length) {
        this._nIndex = 0;
      }
      this._mnHistory[this._nIndex] = nCount;
      this._mlHighlight[this._nIndex] = лВыделить;
      let чМинимальноеЧисло = Infinity,
        лВыделитьМинимальное = false;
      let чМаксимальноеЧисло = -Infinity,
        лВыделитьМаксимальное = false;
      let чСреднееЧисло = 0,
        кЧисел = 0;
      for (let idx = 0; idx < this._kFilled; ++idx) {
        if (Number.isFinite(this._mnHistory[idx])) {
          if (
            this._mnHistory[idx] < чМинимальноеЧисло ||
            (this._mnHistory[idx] === чМинимальноеЧисло && this._mlHighlight[idx])
          ) {
            чМинимальноеЧисло = this._mnHistory[idx];
            лВыделитьМинимальное = this._mlHighlight[idx];
          }
          if (
            this._mnHistory[idx] > чМаксимальноеЧисло ||
            (this._mnHistory[idx] === чМаксимальноеЧисло && this._mlHighlight[idx])
          ) {
            чМаксимальноеЧисло = this._mnHistory[idx];
            лВыделитьМаксимальное = this._mlHighlight[idx];
          }
          чСреднееЧисло += this._mnHistory[idx];
          ++кЧисел;
        }
      }
      let лВыделитьСреднее;
      if (кЧисел === 0) {
        чСреднееЧисло = NaN;
        лВыделитьСреднее = false;
      } else {
        чСреднееЧисло /= кЧисел;
        лВыделитьСреднее = Boolean(
          typeof пВыделитьСреднее == "function"
            ? пВыделитьСреднее(чСреднееЧисло)
            : пВыделитьСреднее
        );
      }
      ОбновитьЗначение(
        this._nodeTable.children[0],
        this._ToString(чМинимальноеЧисло),
        лВыделитьМинимальное
      );
      ОбновитьЗначение(
        this._nodeTable.children[2],
        this._ToString(чСреднееЧисло),
        лВыделитьСреднее
      );
      ОбновитьЗначение(
        this._nodeTable.children[4],
        this._ToString(чМаксимальноеЧисло),
        лВыделитьМаксимальное
      );
      ОбновитьЗначение(
        this._nodeTable.children[НАЧАЛО_ИСТОРИИ + this._nIndex],
        this._ToString(nCount),
        лВыделить
      ).classList.remove("статистика-подробно");
      return чСреднееЧисло;
    }
    _Clear() {
      this._kFilled = 0;
      this._nIndex = -1;
      const узФрагмент = document.createDocumentFragment();
      узФрагмент.appendChild(document.createElement("td")).className =
        "анализ-минимум";
      узФрагмент.appendChild(document.createElement("td")).textContent = " < ";
      узФрагмент.lastChild.className = "статистика-символ";
      узФрагмент.appendChild(document.createElement("td")).className =
        "анализ-среднее";
      узФрагмент.appendChild(document.createElement("td")).textContent = " < ";
      узФрагмент.lastChild.className = "статистика-символ";
      узФрагмент.appendChild(document.createElement("td")).className =
        "анализ-максимум";
      for (let idx = this._mnHistory.length; --idx >= 0;) {
        узФрагмент.appendChild(document.createElement("td")).className =
          "анализ-история статистика-подробно";
      }
      this._nodeTable.textContent = "";
      this._nodeTable.appendChild(узФрагмент);
    }
    _ToString(nCount) {
      return Number.isFinite(nCount)
        ? nCount.toFixed(nCount < 100 ? this._nPrecision : 0)
        : " ";
    }
  }
  function ОбновитьЗначение(pElement, pValue, лВыделить) {
    const nodeElement = GetNode(pElement);
    nodeElement.classList.toggle("статистика-выделить", лВыделить);
    nodeElement.textContent = pValue;
    return nodeElement;
  }
  function ПолучитьНазваниеПрофиляH264(nProfileIndication, nConstraintSetFlag) {
    switch (nProfileIndication) {
      case 66:
        return (nConstraintSetFlag & 64) == 0
          ? "Baseline"
          : "Constrained Baseline";

      case 77:
        return "Main";

      case 88:
        return "Extended";

      case 100:
        switch (nConstraintSetFlag & 12) {
          case 8:
            return "Progressive High";

          case 12:
            return "Constrained High";
        }
        return "High";

      case 110:
        return (nConstraintSetFlag & 16) == 0 ? "High 10" : "High 10 Intra";

      case 122:
        return (nConstraintSetFlag & 16) == 0
          ? "High 4:2:2"
          : "High 4:2:2 Intra";

      case 244:
        return (nConstraintSetFlag & 16) == 0
          ? "High 4:4:4 Predictive"
          : "High 4:4:4 Intra";

      case 44:
        return "CAVLC 4:4:4 Intra";
    }
    m_Log.Ой(
      `[Статистика] Неизвестный профиль H.264 ProfileIndication=${nProfileIndication} ConstraintSetFlag=${nConstraintSetFlag}`
    );
    return `P${nProfileIndication}C${nConstraintSetFlag}`;
  }
  function ОбновитьСтатистику() { // function UpdateStatistics() {
    document.getElementById("статистика-длительностьпросмотра").textContent = // document.getElementById("statistics-viewingduration").textContent =
      m_i18n.SecondsToString(performance.now() / 1e3, true); // m_i18n.ConvertSecondsToString(performance.now() / 1e3, true);
    const { droppedVideoFrames, totalVideoFrames } =
      m_Player.GetDroppedFrameCount(); // m_Player.GetDroppedFramesCount();
    ОбновитьЗначение( // UpdateValue(
      "статистика-пропущено", // "statistics-dropped",
      droppedVideoFrames,
      droppedVideoFrames >= HIGHLIGHT_DROPPED_FRAMES // droppedVideoFrames >= HIGHLIGHT_DROPPED_FRAMES
    ).nextElementSibling.nextElementSibling.textContent = totalVideoFrames;
    let чЖдетЗагрузки = 0, // let nWaitingForDownload = 0,
      чЗагружается = 0, // nDownloading = 0,
      кПреобразовано = 0, // nConvertedCount = 0,
      чПреобразовано = 0; // nConvertedDuration = 0;
    for (let oSegment of g_maQueue) { // for (let oSegment of g_aoQueue) {
      switch (oSegment.nProcessing) { // switch (oSegment.nProcessing) {
        case PROCESSING_AWAITING_DOWNLOAD: // case PROCESSING_WAITING_FOR_DOWNLOAD:
          чЖдетЗагрузки += oSegment.nDuration; // nWaitingForDownload += oSegment.nDuration;
          break;

        case PROCESSING_DOWNLOADING: // case PROCESSING_DOWNLOADING:
        case PROCESSING_DOWNLOADED: // case PROCESSING_DOWNLOADED:
          чЗагружается += oSegment.nDuration; // nDownloading += oSegment.nDuration;
          break;

        case PROCESSING_CONVERTED: // case PROCESSING_CONVERTED:
          кПреобразовано++;
          чПреобразовано += oSegment.nDuration; // nConvertedDuration += oSegment.nDuration;
          break;

        default:
          Check(false); // Check(false);
      }
    }
    const { nWatched, nUnwatched } = // const { nWatched, nNotWatched } =
      m_Player.GetBufferFill(); // m_Player.GetBufferFullness();
    let node = ОбновитьЗначение( // let node = UpdateValue(
      "статистика-очередь", // "statistics-queue",
      чЖдетЗагрузки.toFixed(1), // nWaitingForDownload.toFixed(1),
      чЖдетЗагрузки > m_Settings.Get("чМаксРазмерБуфера") // nWaitingForDownload > m_Settings.Get("nMaxBufferSize")
    );
    node = node.nextElementSibling.nextElementSibling;
    node.textContent = чЗагружается.toFixed(1); // node.textContent = nDownloading.toFixed(1);
    node = node.nextElementSibling;
    ОбновитьЗначение( // UpdateValue(
      node, // node,
      чПреобразовано.toFixed(1), // nConvertedDuration.toFixed(1),
      кПреобразовано >= HIGHLIGHT_CONVERTED // nConvertedCount >= HIGHLIGHT_CONVERTED
    );
    node = node.nextElementSibling;
    ОбновитьЗначение( // UpdateValue(
      node, // node,
      nUnwatched.toFixed(1), // nNotWatched.toFixed(1),
      ВыделитьНеПросмотрено(nUnwatched) // HighlightNotWatched(nNotWatched)
    );
    node = node.nextElementSibling.nextElementSibling;
    node.textContent = nWatched.toFixed(1); // node.textContent = nWatched.toFixed(1);
  }
  function WindowOpened() {
    return _nTimer !== 0;
  }
  function OpenWindow() {
    if (WindowOpened()) {
      return;
    }
    _oUpdateInterval = new Анализ(
      "statistics-updateinterval",
      LIST_HISTORY_SIZE,
      1
    );
    _oSegmentsAdded = new Анализ(
      "statistics-segmentsadded",
      LIST_HISTORY_SIZE,
      0
    );
    _oSecondsAdded = new Анализ(
      "statistics-secondsadded",
      LIST_HISTORY_SIZE,
      1
    );
    _oSegmentThickness = new Анализ(
      "statistics-segmentthickness",
      DOWNLOAD_HISTORY_SIZE,
      1
    );
    _oChannelThickness = new Анализ(
      "statistics-channelthickness",
      DOWNLOAD_HISTORY_SIZE,
      1
    );
    _oResponseWait = new Анализ(
      "statistics-responsewait",
      DOWNLOAD_HISTORY_SIZE,
      1
    );
    _oUnwatched = new Анализ(
      "statistics-unwatched",
      BUFFER_HISTORY_SIZE,
      1
    );
    _nLastUpdateTime = NaN;
    GetNode("статистика-количестворекламы").textContent = _nAdCount;
    GetNode("статистика-частотарекламы").textContent = получитьЧастотуРекламы();
    GetNode("статистика-исходных").textContent = _nInitialSegments;
    ОбновитьЗначение(
      "статистика-забракованных",
      _nRejectedSegments,
      _nRejectedSegments !== 0
    );
    ОбновитьЗначение(
      "статистика-ошибокзагрузки",
      _nDownloadErrors,
      _nDownloadErrors !== 0
    );
    ОбновитьЗначение(
      "статистика-пропущенныхсегментов",
      _nSkippedSegments,
      _nSkippedSegments !== 0
    );
    GetNode("статистика-незагруженныхсегментов").textContent =
      _nUndownloadedSegments;
    ОбновитьЗначение(
      "статистика-потерьвидео",
      _nVideoLosses,
      _nVideoLosses !== 0
    );
    ОбновитьЗначение(
      "статистика-потерьзвука",
      _nAudioLosses,
      _nAudioLosses !== 0
    );
    ОбновитьЗначение(
      "статистика-исчерпано",
      _nBufferExhaustions,
      _nBufferExhaustions >= HIGHLIGHT_BUFFER_EXHAUSTION
    );
    ОбновитьЗначение(
      "статистика-переполнено",
      _nBufferOverflows,
      _nBufferOverflows !== 0
    ).nextElementSibling.nextElementSibling.textContent =
      _nSkippedInBuffer.toFixed(1);
    _nTimer = setInterval(
      AddExceptionHandler(ОбновитьСтатистику),
      1e3 / STATISTICS_UPDATE_FREQUENCY
    );
    ОбновитьСтатистику();
    m_Events.AddHandler(
      "тащилка-перетаскивание-статистика",
      ОбработатьПеретаскиваниеОкна
    );
    ShowElement("статистика", true);
    m_Settings.Change("лПоказатьСтатистику", true);
  }
  function CloseWindow() {
    if (!WindowOpened()) {
      return;
    }
    ShowElement("статистика", false);
    _oUpdateInterval.Free();
    _oUpdateInterval = null;
    _oSegmentsAdded.Free();
    _oSegmentsAdded = null;
    _oSecondsAdded.Free();
    _oSecondsAdded = null;
    _oSegmentThickness.Free();
    _oSegmentThickness = null;
    _oChannelThickness.Free();
    _oChannelThickness = null;
    _oResponseWait.Free();
    _oResponseWait = null;
    _oUnwatched.Free();
    _oUnwatched = null;
    for (let node of document.querySelectorAll("[data-очистить]")) {
      node.textContent = "";
    }
    clearInterval(_nTimer);
    _nTimer = 0;
    m_Settings.Change("лПоказатьСтатистику", false);
  }
  function ОбработатьПеретаскиваниеОкна(oParameters) {
    switch (oParameters.nStep) {
      case 1:
        const oStyle = getComputedStyle(oParameters.nodeDragging);
        oParameters._nInitialX = Number.parseInt(oStyle.left, 10);
        oParameters._nInitialY = Number.parseInt(oStyle.top, 10);
        break;

      case 2:
        oParameters.nodeDragging.style.setProperty(
          "--x",
          `${oParameters._nInitialX + oParameters.nDeltaX}px`
        );
        oParameters.nodeDragging.style.setProperty(
          "--y",
          `${oParameters._nInitialY + oParameters.nDeltaY}px`
        );
        break;

      case 3:
        break;

      default:
        Check(false);
    }
  }
  function Start() {
    if (m_Settings.Get("лПоказатьСтатистику")) {
      OpenWindow();
    }
  }
  function ClearHistory() {
    if (_oUpdateInterval !== null) {
      _oUpdateInterval.Clear();
      _oSegmentsAdded.Clear();
      _oSecondsAdded.Clear();
      _oSegmentThickness.Clear();
      _oChannelThickness.Clear();
      _oResponseWait.Clear();
      _oUnwatched.Clear();
      _nLastUpdateTime = NaN;
    }
    ОбновитьЗначение(
      "статистика-ошибокзагрузки",
      (_nDownloadErrors = 0),
      false
    );
    ОбновитьЗначение(
      "статистика-пропущенныхсегментов",
      (_nSkippedSegments = 0),
      false
    );
    GetNode("статистика-незагруженныхсегментов").textContent =
      _nUndownloadedSegments = 0;
    ОбновитьЗначение("статистика-исчерпано", (_nBufferExhaustions = 0), false);
    ОбновитьЗначение(
      "статистика-переполнено",
      (_nBufferOverflows = 0),
      false
    ).nextElementSibling.nextElementSibling.textContent =
      (_nSkippedInBuffer = 0).toFixed(1);
  }
  function GetTargetDuration() {
    return _nTargetDuration;
  }
  function GetFrameDurationInSeconds() {
    return {
      чМинимальная: Math.max(17, _nMinVideoSampleDuration) / 1e3,
      чМаксимальная: Math.min(1e3 / 25, _nMaxVideoSampleDuration) / 1e3,
    };
  }
  function GetDataForReport() {
    return {
      ПараметрыВидео:
        GetNode("статистика-разрешениевидео").textContent +
        " " +
        GetNode("statistics-videocompression").textContent,
      ПараметрыЗвука: GetNode("статистика-сжатиезвука").textContent,
      ЗабракованныхСегментов: _nRejectedSegments,
      ПропущенныхСегментов: _nSkippedSegments,
      ОшибокЗагрузки: _nDownloadErrors,
      НезагруженныхСегментов: _nUndownloadedSegments,
      ПотерьВидео: _nVideoLosses,
      ПотерьЗвука: _nAudioLosses,
      ИсчерпанийБуфера: _nBufferExhaustions,
      ИсчерпанийБуфераДосрочно: _nEarlyBufferExhaustions,
      ПереполненийБуфера: _nBufferOverflows,
      ПропущеноВБуфере: _nSkippedInBuffer,
      Реклама: `${_nAdCount} ${получитьЧастотуРекламы()}`,
    };
  }
  function SegmentListParsed(оСписок) {
    _nTargetDuration = оСписок.nTargetDuration;
    if (WindowOpened()) {
      if (оСписок.moSegments.length !== 0) {
        GetNode("statistics-server").textContent = new URL(
          оСписок.moSegments[оСписок.moSegments.length - 1].sAddress
        ).host;
      }
      const чДлительностьСписка = оСписок.moSegments.reduce(
        (чСумма, { nDuration }) => чСумма + nDuration,
        0
      );
      GetNode("статистика-список").textContent = `${оСписок.moSegments.length
        } × ${(чДлительностьСписка / оСписок.moSegments.length).toFixed(
          1
        )} = ${чДлительностьСписка.toFixed(1)} − ${оСписок.kAdSegments}`;
      GetNode("статистика-targetduration").textContent = оСписок.nTargetDuration;
    }
  }
  function SegmentsQueued(кСегментовДобавлено, кСекундДобавлено) {
    if (WindowOpened()) {
      const nTime = performance.now();
      _oUpdateInterval.AddNumber(
        (nTime - _nLastUpdateTime) / 1e3
      );
      _nLastUpdateTime = nTime;
      _oSegmentsAdded.AddNumber(
        кСегментовДобавлено,
        HighlightSegmentsAdded,
        HighlightSegmentsAdded
      );
      _oSecondsAdded.AddNumber(кСекундДобавлено);
    }
  }
  function SourceSegmentReceived() {
    ++_nInitialSegments;
    if (WindowOpened()) {
      document.getElementById("статистика-исходных").textContent =
        _nInitialSegments;
    }
  }
  function ЗабракованСегмент() {
    ++_nRejectedSegments;
    if (WindowOpened()) {
      ОбновитьЗначение(
        "статистика-забракованных",
        _nRejectedSegments,
        true
      );
    }
  }
  function SomethingDownloaded(кбСкачано) {
    if (Number.isFinite(кбСкачано)) {
      _kbTotalDownloaded += кбСкачано;
      if (WindowOpened()) {
        document.getElementById("статистика-скачано").textContent = (
          _kbTotalDownloaded /
          1024 /
          1024
        ).toFixed();
      }
    }
  }
  function SegmentLoaded(
    чРазмерСегмента,
    чДлительностьСегмента,
    чДлительностьЗагрузки,
    чОжиданиеОтвета
  ) {
    if (WindowOpened()) {
      const чСредняяТолщинаСегмента = _oSegmentThickness.AddNumber(
        (чРазмерСегмента * 8) / 1e6 / чДлительностьСегмента
      );
      чДлительностьЗагрузки /= 1e3;
      _oChannelThickness.AddNumber(
        (чРазмерСегмента * 8) / 1e6 / чДлительностьЗагрузки,
        чДлительностьЗагрузки > чДлительностьСегмента,
        (nCount) => nCount < чСредняяТолщинаСегмента
      );
      _oResponseWait.AddNumber(
        чОжиданиеОтвета / 1e3,
        HighlightResponseWait,
        HighlightResponseWait
      );
    }
  }
  function SegmentsNotLoaded(кНезагруженныхСегментов) {
    Check(кНезагруженныхСегментов > 0);
    _nDownloadErrors++;
    _nUndownloadedSegments += кНезагруженныхСегментов;
    if (WindowOpened()) {
      ОбновитьЗначение("статистика-ошибокзагрузки", _nDownloadErrors, true);
      GetNode("статистика-незагруженныхсегментов").textContent =
        _nUndownloadedSegments;
    }
  }
  function segmentsSkipped(кПропущенныхСегментов) {
    Check(кПропущенныхСегментов > 0);
    _nSkippedSegments++;
    _nUndownloadedSegments += кПропущенныхСегментов;
    if (WindowOpened()) {
      ОбновитьЗначение(
        "статистика-пропущенныхсегментов",
        _nSkippedSegments,
        true
      );
      GetNode("статистика-незагруженныхсегментов").textContent =
        _nUndownloadedSegments;
    }
  }
  function ConvertedSegmentReceived(oSegment) {
    const лОкноОткрыто = WindowOpened();
    const oData = oSegment.pData;
    if (oData.bPassthrough) {
      // fMP4 arrives already muxed, so none of the values the MPEG-TS demuxer
      // derives exist here. Report what the playlist itself declares and leave the
      // rest blank rather than printing NaN.
      if (oSegment.bDiscontinuity && лОкноОткрыто) {
        GetNode("statistics-videocompression").textContent = oData.bHasVideo
          ? oData.sCodecsDescription || "fMP4"
          : "—";
        GetNode("статистика-разрешениевидео").textContent =
          oData.sResolution || "—";
        GetNode("статистика-частотакадров").textContent = "";
        GetNode("статистика-сжатиезвука").textContent = oData.bHasAudio
          ? "fMP4"
          : "—";
        GetNode("статистика-битрейтзвука").textContent = "";
        GetNode("статистика-преобразованза").textContent = "—";
      }
      return;
    }
    if (oData.hasOwnProperty("мбМедиасегмент")) {
      if (oSegment.bDiscontinuity) {
        if (oData.bHasVideo) {
          let сСжатиеВидео =
            "H.264" +
            ` ${ПолучитьНазваниеПрофиляH264(
              oData.nProfileIndication,
              oData.nConstraintSetFlag
            )}` +
            ` L${(oData.nLevelIndication / 10).toFixed(1)}` +
            ` RF${oData.nMaxNumberReferenceFrames}`;
          if (oData.чДиапазон !== -1) {
            сСжатиеВидео += oData.чДиапазон === 0 ? " 16-235" : " 0-255";
          }
          if (oData.лЧересстрочное) {
            сСжатиеВидео += " interlaced";
          }
          if (oData.nFrameRate !== 0) {
            сСжатиеВидео += ` ${oData.nFrameRate < 0 ? "≈" : ""
              }${Math.abs(oData.nFrameRate).toFixed(2)} ${GetText("J0140")}`;
          }
          GetNode("statistics-videocompression").textContent = сСжатиеВидео;
          GetNode(
            "статистика-разрешениевидео"
          ).textContent = `${oData.чШиринаКартинки}x${oData.чВысотаКартинки}`;
        } else {
          GetNode("statistics-videocompression").textContent = "—";
          GetNode("статистика-разрешениевидео").textContent = "—";
        }
        GetNode("статистика-частотакадров").textContent = "";
        if (oData.bHasAudio) {
          GetNode("статистика-сжатиезвука").textContent =
            ["AAC-Main", "AAC-LC", "AAC-SSR", "AAC-LTP"][
            oData.nAudioObjectType - 1
            ] +
            ` ${oData.чЧастотаДискретизации} ${GetText("J0141")}` +
            ` ${oData.чКоличествоКаналов} ${GetText("J0142")}`;
        } else {
          GetNode("статистика-сжатиезвука").textContent = "—";
        }
        GetNode("статистика-битрейтзвука").textContent = "";
      }
      if (Number.isFinite(oData.nAvgVideoSampleDuration)) {
        _nMinVideoSampleDuration = oData.nMinVideoSampleDuration;
        _nMaxVideoSampleDuration = oData.nMaxVideoSampleDuration;
        Check(
          _nMinVideoSampleDuration <= _nMaxVideoSampleDuration
        );
        const чОтносительноеОтклонение =
          oData.nAvgVideoSampleDuration /
          oData.nMaxVideoSampleDuration;
        const чАбсолютноеОтклонение =
          oData.nMaxVideoSampleDuration -
          oData.nAvgVideoSampleDuration;
        if (
          чОтносительноеОтклонение <= HIGHLIGHT_VIDEO_LOSS_REL &&
          чАбсолютноеОтклонение >= HIGHLIGHT_VIDEO_LOSS_ABS
        ) {
          m_Log.Ой(
            `[Статистика] Превышено отклонение длительности кадра в сегменте ${oSegment.nNumber}` +
            ` СредняяДлительностьКадра=${m_Log.F0(
              oData.nAvgVideoSampleDuration
            )}мс` +
            ` АбсолютноеОтклонение=${m_Log.F0(чАбсолютноеОтклонение)}мс` +
            ` ОтносительноеОтклонение=${m_Log.F2(
              чОтносительноеОтклонение
            )}`
          );
          oData.лПотериВидео = true;
        }
        if (лОкноОткрыто) {
          let сОтклонение = `@${(
            1e3 / oData.nAvgVideoSampleDuration
          ).toFixed(1)}`;
          if (
            oData.nMaxVideoSampleDuration -
            oData.nMinVideoSampleDuration >
            2
          ) {
            сОтклонение +=
              ` −${(
                100 -
                (oData.nAvgVideoSampleDuration /
                  oData.nMaxVideoSampleDuration) *
                100
              ).toFixed()}%` +
              ` +${(
                (oData.nAvgVideoSampleDuration /
                  oData.nMinVideoSampleDuration) *
                100 -
                100
              ).toFixed()}%`;
          }
          ОбновитьЗначение(
            "статистика-частотакадров",
            сОтклонение,
            чОтносительноеОтклонение <= HIGHLIGHT_FRAME_RATE
          );
        }
      }
      if (Number.isFinite(oData.чБитрейтЗвука) && лОкноОткрыто) {
        GetNode(
          "статистика-битрейтзвука"
        ).textContent = `${oData.чБитрейтЗвука.toFixed()} ${GetText("J0143")}`;
      }
    }
    if (IsNumber(oData.nConvertedIn) && лОкноОткрыто) {
      GetNode("статистика-преобразованза").textContent =
        oData.nConvertedIn.toFixed();
    }
    if (oData.лЗабраковано) {
      ЗабракованСегмент();
    }
    if (oData.лПотериВидео) {
      ++_nVideoLosses;
      if (лОкноОткрыто) {
        ОбновитьЗначение("статистика-потерьвидео", _nVideoLosses, true);
      }
    }
    if (oData.лПотериЗвука) {
      ++_nAudioLosses;
      if (лОкноОткрыто) {
        ОбновитьЗначение("статистика-потерьзвука", _nAudioLosses, true);
      }
    }
  }
  function updateBufferFill(nUnwatched) {
    if (WindowOpened()) {
      _oUnwatched.AddNumber(
        nUnwatched,
        ВыделитьНеПросмотрено,
        ВыделитьНеПросмотрено
      );
    }
  }
  function PlayerBufferExhausted(лДосрочно) {
    ++_nBufferExhaustions;
    if (лДосрочно) {
      ++_nEarlyBufferExhaustions;
    }
    if (WindowOpened()) {
      ОбновитьЗначение(
        "статистика-исчерпано",
        _nBufferExhaustions,
        _nBufferExhaustions >= HIGHLIGHT_BUFFER_EXHAUSTION
      );
    }
  }
  function получитьЧастотуРекламы() {
    let sResult = "";
    for (let idx = 0; idx < _nAdStartTimes.length; ++idx) {
      if (idx !== 0) {
        sResult += ` <${(
          (_nAdStartTimes[idx] - _nAdEndTimes[idx - 1]) /
          1e3
        ).toFixed()}> `;
      }
      if (idx < _nAdEndTimes.length) {
        sResult += (
          (_nAdEndTimes[idx] - _nAdStartTimes[idx]) /
          1e3
        ).toFixed();
      } else {
        sResult += "?";
      }
    }
    return sResult;
  }
  m_Events.AddHandler("список-началорекламы", () => {
    Check(_nAdStartTimes.length === _nAdEndTimes.length);
    _nAdCount++;
    _nAdStartTimes.push(performance.now());
    if (WindowOpened()) {
      GetNode("статистика-количестворекламы").textContent = _nAdCount;
      GetNode("статистика-частотарекламы").textContent = получитьЧастотуРекламы();
    }
  });
  m_Events.AddHandler("список-конецрекламы", () => {
    if (_nAdStartTimes.length !== _nAdEndTimes.length) {
      if (_nAdEndTimes.length === AD_HISTORY_SIZE) {
        _nAdStartTimes.shift();
        _nAdEndTimes.shift();
      }
      _nAdEndTimes.push(performance.now());
      if (WindowOpened()) {
        GetNode("статистика-частотарекламы").textContent =
          получитьЧастотуРекламы();
      }
    }
  });
  m_Events.AddHandler(
    "проигрыватель-переполненбуфер",
    (чПропущено) => {
      ++_nBufferOverflows;
      _nSkippedInBuffer += чПропущено;
      if (WindowOpened()) {
        ОбновитьЗначение(
          "статистика-переполнено",
          _nBufferOverflows,
          true
        ).nextElementSibling.nextElementSibling.textContent =
          _nSkippedInBuffer.toFixed(1);
      }
    }
  );
  m_Events.AddHandler(
    "управление-изменилосьсостояние",
    (nState) => {
      if (nState === STATE_START) {
        ClearHistory();
      }
    }
  );
  m_Events.AddHandler(
    "список-выбранварианттрансляции",
    ([moVariants]) => {
      if (moVariants) {
        ClearHistory();
      }
    }
  );
  return {
    Start,
    WindowOpened,
    OpenWindow,
    CloseWindow,
    ОбновитьЗначение,
    ClearHistory,
    GetTargetDuration,
    GetFrameDurationInSeconds,
    GetDataForReport,
    SegmentListParsed,
    SegmentsQueued,
    SourceSegmentReceived,
    ЗабракованСегмент,
    SomethingDownloaded,
    SegmentLoaded,
    SegmentsNotLoaded,
    segmentsSkipped,
    ConvertedSegmentReceived,
    updateBufferFill,
    PlayerBufferExhausted,
  };
})();

const м_Окно = (() => {
  function получитьОткрытое() {
    return document.body.getAttribute("data-окно-открыто") || "";
  }
  function открытьОкно(sWindowId) {
    const элОкно = GetNode(sWindowId);
    Check(элОкно.classList.contains("окно"));
    элОкно.classList.add("окнооткрыто", "анимацияокна");
    document.body.setAttribute("data-окно-открыто", sWindowId);
    m_Events.SendEvent(`окно-открыто-${sWindowId}`);
  }
  function закрытьОкно(sWindowId, лСАнимацией = true) {
    const элОкно = GetNode(sWindowId);
    Check(элОкно.classList.contains("окно"));
    элОкно.classList.remove("окнооткрыто");
    элОкно.classList.toggle("анимацияокна", лСАнимацией);
    document.body.removeAttribute("data-окно-открыто");
  }
  function open(sWindowId) {
    Check(IsNonEmptyString(sWindowId));
    const сИдОткрытогоОкна = получитьОткрытое();
    if (sWindowId === сИдОткрытогоОкна) {
      return false;
    }
    if (сИдОткрытогоОкна) {
      закрытьОкно(сИдОткрытогоОкна);
    }
    открытьОкно(sWindowId);
    return true;
  }
  function close(лСАнимацией = true) {
    const сИдОткрытогоОкна = получитьОткрытое();
    if (сИдОткрытогоОкна) {
      закрытьОкно(сИдОткрытогоОкна, лСАнимацией);
    }
  }
  function toggle(sWindowId) {
    open(sWindowId) || закрытьОкно(sWindowId);
  }
  function configureScrollIndicator(пПрокрутка) {
    const элПрокрутка = GetNode(пПрокрутка);
    элПрокрутка.scrollTop = 0;
    обновитьИндикаторПрокрутки(элПрокрутка);
  }
  function обновитьИндикаторПрокрутки(элПрокрутка) {
    const bShow = !thisElementIsFullyScrolled(элПрокрутка);
    ShowElement(GetNode(`индикаторпрокрутки-${элПрокрутка.id}`), bShow);
    элПрокрутка[bShow ? "addEventListener" : "removeEventListener"](
      "scroll",
      обработатьПрокрутку
    );
  }
  const обработатьПрокрутку = AddExceptionHandler((oEvent) => {
    обновитьИндикаторПрокрутки(oEvent.target);
  });
  m_Events.AddHandler(
    "управление-левыйщелчок",
    ({ target: элЩелчок }) => {
      const sWindowId = элЩелчок.getAttribute("data-окно-переключить");
      if (sWindowId) {
        toggle(sWindowId);
        return;
      }
      const сИдОткрытогоОкна = получитьОткрытое();
      if (
        сИдОткрытогоОкна &&
        !GetNode(сИдОткрытогоОкна).contains(элЩелчок) &&
        GetNode("проигрыватель").contains(элЩелчок)
      ) {
        закрытьОкно(сИдОткрытогоОкна);
      }
    }
  );
  return {
    open,
    close,
    toggle,
    configureScrollIndicator,
  };
})();

const м_Меню = (() => {
  function setItemAvailability(пПункт, лДоступен) {
    GetNode(пПункт).tabIndex = лДоступен ? 0 : -1;
  }
  GetNode("глаз").addEventListener("contextmenu", (oEvent) => {
    oEvent.preventDefault();
    м_Окно.toggle("главноеменю");
  });
  m_Events.AddHandler("управление-левыйщелчок", (oEvent) => {
    if (oEvent.target.classList.contains("меню-пункт")) {
      м_Окно.close(false);
    }
  });
  return {
    setItemAvailability,
  };
})();

const m_FullscreenMode = (() => {
  let _sRequestFullscreen = "requestFullscreen";
  let _sExitFullscreen = "exitFullscreen";
  let _sFullscreenElement = "fullscreenElement";
  let _sFullscreenchange = "fullscreenchange";
  if (!document.exitFullscreen) {
    _sRequestFullscreen = "webkitRequestFullscreen";
    _sExitFullscreen = "webkitExitFullscreen";
    _sFullscreenElement = "webkitFullscreenElement";
    _sFullscreenchange = "webkitfullscreenchange";
  }
  const ОбработатьИзменениеРежима = AddExceptionHandler(() => {
    m_Events.SendEvent("полноэкранныйрежим-изменен", Update());
  });
  const ОбработатьДвойнойЩелчок = AddExceptionHandler((oEvent) => {
    if (oEvent.button === LEFT_BUTTON) {
      oEvent.preventDefault();
      Toggle();
    }
  });
  function GetElement() {
    return GetNode("проигрывательичат");
  }
  function Включен() {
    return !!document[_sFullscreenElement];
  }
  function Update() {
    const лВключен = Включен();
    m_Log.Окак(`[ПолноэкранныйРежим] Режим включен: ${лВключен}`);
    ChangeButton("переключитьполноэкранный", лВключен);
    // Tell the stylesheets we are fullscreen. The sidebar is a sibling of the fullscreen
    // element, so in principle the browser stops painting it — but its `backdrop-filter`
    // promotes it to its own composited layer, and that layer survives on top of the video.
    // This is the one place that knows the real state, so it also covers entering fullscreen
    // first and only then showing the chat.
    document.body.classList.toggle("alt-fullscreen", лВключен);
    return лВключен;
  }
  function Включить() {
    if (Включен()) {
      return false;
    }
    m_Log.Вот("[ПолноэкранныйРежим] Включаю режим");
    м_Автоскрытие.Hide(false);
    м_КартинкаВКартинке.отключить();
    GetElement()[_sRequestFullscreen]();
    return true;
  }
  function Disable() {
    if (!Включен()) {
      return false;
    }
    m_Log.Вот("[ПолноэкранныйРежим] Отключаю режим");
    м_Автоскрытие.Hide(false);
    document[_sExitFullscreen]();
    return true;
  }
  function Toggle() {
    Включить() || Disable();
  }
  document.addEventListener(_sFullscreenchange, ОбработатьИзменениеРежима);
  GetNode("глаз").addEventListener("dblclick", ОбработатьДвойнойЩелчок);
  Update();
  return {
    Включен,
    Disable,
    Toggle,
    GetElement,
  };
})();

const м_КартинкаВКартинке = (() => {
  let _oMediaElement = null;
  const обработатьИзменениеРежима = AddExceptionHandler(() => {
    обновить();
  });
  function включен() {
    return Boolean(document.pictureInPictureElement);
  }
  function обновить() {
    const лВключен = включен();
    m_Log.Окак(`[КартинкаВКартинке] Режим включен: ${лВключен}`);
    ChangeButton("переключитькартинкавкартинке", лВключен);
  }
  function включить() {
    if (включен()) {
      return false;
    }
    m_Log.Вот("[КартинкаВКартинке] Включаю режим");
    m_FullscreenMode.Disable();
    _oMediaElement.requestPictureInPicture();
    return true;
  }
  function отключить() {
    if (!включен()) {
      return false;
    }
    m_Log.Вот("[КартинкаВКартинке] Отключаю режим");
    document.exitPictureInPicture();
    return true;
  }
  function toggle() {
    _oMediaElement &&
      !document.body.classList.contains("нетвидео") &&
      (включить() || отключить());
  }
  function start(oMediaElement) {
    if (
      !document.pictureInPictureEnabled ||
      oMediaElement.disablePictureInPicture
    ) {
      m_Log.Ой(
        `[КартинкаВКартинке] pictureInPictureEnabled=${document.pictureInPictureEnabled} disablePictureInPicture=${oMediaElement.disablePictureInPicture}`
      );
      return;
    }
    _oMediaElement = oMediaElement;
    oMediaElement.addEventListener(
      "enterpictureinpicture",
      обработатьИзменениеРежима
    );
    oMediaElement.addEventListener(
      "leavepictureinpicture",
      обработатьИзменениеРежима
    );
    обновить();
    ShowElement("переключитькартинкавкартинке", true);
  }
  return {
    start,
    отключить,
    toggle,
  };
})();

const м_Тащилка = (() => {
  const МИН_ИНТЕРВАЛ_ПЕРЕТАСКИВАНИЯ = 45;
  let _чИдУказателя = NaN;
  let _оПараметры = null;
  let _чВремяПоследнегоПеретаскивания;
  let _nInitialX, _nInitialY;
  let _чПоследняяX, _чПоследняяY;
  function Параметры(nodePressed, nodeDragging) {
    this.nodePressed = nodePressed;
    this.nodeDragging = nodeDragging;
    this.nStep = 1;
    this.лОтмена = false;
    this.bChangedX = false;
    this.bChangedY = false;
    this.nDeltaX = 0;
    this.nDeltaY = 0;
  }
  const ОбработатьPointerDown = createElementEventHandler((oEvent) => {
    if (!Number.isNaN(_чИдУказателя) || oEvent.button !== LEFT_BUTTON) {
      return;
    }
    const nodePressed = oEvent.target.closest("[data-тащилка]");
    if (nodePressed === null) {
      return;
    }
    _чИдУказателя = oEvent.pointerId;
    _оПараметры = new Параметры(
      nodePressed,
      GetNode(nodePressed.getAttribute("data-тащилка"))
    );
    _чВремяПоследнегоПеретаскивания = 0;
    _nInitialX = _чПоследняяX = oEvent.clientX;
    _nInitialY = _чПоследняяY = oEvent.clientY;
    m_Log.Окак(
      `[Тащилка] Начинаю перетаскивать ${_оПараметры.nodeDragging.id} X=${_nInitialX} Y=${_nInitialY} id=${_чИдУказателя} type=${oEvent.pointerType} primary=${oEvent.isPrimary}`
    );
    document.addEventListener(
      "pointermove",
      ОбработатьPointerMove,
      PASSIVE_HANDLER
    );
    document.addEventListener(
      "pointerup",
      ОбработатьPointerUpИPointerCancel,
      PASSIVE_HANDLER
    );
    document.addEventListener(
      "pointercancel",
      ОбработатьPointerUpИPointerCancel
    );
    m_Events.AddHandler(
      "фокусник-изменилосьсостояние",
      ОбработатьПокиданиеВкладки
    );
    m_FullscreenMode
      .GetElement()
      .style.setProperty(
        "cursor",
        getComputedStyle(nodePressed).cursor,
        "important"
      );
    m_FullscreenMode.GetElement().classList.add("тащилка-перехват");
    _оПараметры.nodeDragging.classList.add("тащилка");
    m_Events.SendEvent(
      `тащилка-перетаскивание-${_оПараметры.nodeDragging.id}`,
      _оПараметры
    );
  });
  const ОбработатьPointerMove = AddExceptionHandler((oEvent) => {
    if (_чИдУказателя === oEvent.pointerId) {
      if ((oEvent.buttons & LEFT_BUTTON_PRESSED) == 0) {
        ЗавершитьПеретаскивание("кнопка отпущена");
      } else {
        const nTime = performance.now();
        if (
          nTime - _чВремяПоследнегоПеретаскивания >=
          МИН_ИНТЕРВАЛ_ПЕРЕТАСКИВАНИЯ
        ) {
          _чВремяПоследнегоПеретаскивания = nTime;
          _оПараметры.bChangedX = _чПоследняяX !== oEvent.clientX;
          _оПараметры.bChangedY = _чПоследняяY !== oEvent.clientY;
          if (_оПараметры.bChangedX || _оПараметры.bChangedY) {
            _чПоследняяX = oEvent.clientX;
            _чПоследняяY = oEvent.clientY;
            _оПараметры.nStep = 2;
            _оПараметры.nDeltaX = _чПоследняяX - _nInitialX;
            _оПараметры.nDeltaY = _чПоследняяY - _nInitialY;
            m_Events.SendEvent(
              `тащилка-перетаскивание-${_оПараметры.nodeDragging.id}`,
              _оПараметры
            );
          }
        }
      }
    }
  });
  const ОбработатьPointerUpИPointerCancel = AddExceptionHandler(
    (oEvent) => {
      if (_чИдУказателя === oEvent.pointerId) {
        ЗавершитьПеретаскивание(oEvent.type);
      }
    }
  );
  function ОбработатьПокиданиеВкладки({ bActive }) {
    if (!bActive) {
      ЗавершитьПеретаскивание("вкладка неактивна");
    }
  }
  function ОтменитьПеретаскивание(sNodeId) {
    Check(sNodeId === void 0 || IsNonEmptyString(sNodeId));
    if (
      !Number.isNaN(_чИдУказателя) &&
      (sNodeId === void 0 || sNodeId === _оПараметры.nodeDragging.id)
    ) {
      _оПараметры.лОтмена = true;
      ЗавершитьПеретаскивание("операция отменена");
    }
  }
  function ЗавершитьПеретаскивание(sReason) {
    if (_оПараметры.nStep !== 3) {
      m_Log.Окак(
        `[Тащилка] Заканчиваю перетаскивание: ${sReason} X=${_чПоследняяX} Y=${_чПоследняяY}`
      );
      _оПараметры.nStep = 3;
      m_Events.SendEvent(
        `тащилка-перетаскивание-${_оПараметры.nodeDragging.id}`,
        _оПараметры
      );
      m_FullscreenMode.GetElement().style.removeProperty("cursor");
      m_FullscreenMode
        .GetElement()
        .classList.remove("тащилка-перехват");
      _оПараметры.nodeDragging.classList.remove("тащилка");
      document.removeEventListener(
        "pointermove",
        ОбработатьPointerMove,
        PASSIVE_HANDLER
      );
      document.removeEventListener(
        "pointerup",
        ОбработатьPointerUpИPointerCancel,
        PASSIVE_HANDLER
      );
      document.removeEventListener(
        "pointercancel",
        ОбработатьPointerUpИPointerCancel
      );
      m_Events.RemoveHandler(
        "фокусник-изменилосьсостояние",
        ОбработатьПокиданиеВкладки
      );
      _чИдУказателя = NaN;
      _оПараметры = null;
    }
  }
  document.addEventListener(
    "pointerdown",
    ОбработатьPointerDown,
    PASSIVE_HANDLER
  );
  return {
    ОтменитьПеретаскивание,
  };
})();

const м_Автоскрытие = (() => {
  const МИН_ИНТЕРВАЛ_ДВИЖЕНИЯ = 150;
  const ПОРОГ_ДВИЖЕНИЯ = 3;
  const _узАвтоскрытие = document.getElementById("проигрыватель");
  let _nTimer = 0;
  let _чСкрытьПосле = 0;
  let _чНеПоказыватьДо = 0;
  let _чЭкранX = 0,
    _чЭкранY = 0;
  let _чКлиентX = 0,
    _чКлиентY = 0;
  let _чИдТаймераВыбораСкорости = 0;
  function Show() {
    if (_nTimer === 0) {
      document.body.classList.remove("автоскрытие");
      document.body.classList.add("анимацияпанели");
      _nTimer = setTimeout(
        обработатьТаймер,
        m_Settings.Get("чИнтервалАвтоскрытия") * 1e3
      );
      _чСкрытьПосле = _чНеПоказыватьДо = 0;
    } else {
      _чСкрытьПосле =
        performance.now() + m_Settings.Get("чИнтервалАвтоскрытия") * 1e3;
    }
  }
  function Hide(лСАнимацией = true) {
    if (_nTimer !== 0) {
      clearTimeout(_nTimer);
      _nTimer = 0;
      document.body.classList.add("автоскрытие");
    }
    document.body.classList.toggle("анимацияпанели", лСАнимацией);
    if (!лСАнимацией) {
      document.body.clientTop;
      document.body.classList.add("анимацияпанели");
      _чНеПоказыватьДо = performance.now() + 500;
    }
  }
  const обработатьТаймер = AddExceptionHandler(() => {
    Check(_nTimer !== 0);
    const чСкрытьЧерез = _чСкрытьПосле - performance.now();
    if (чСкрытьЧерез > 50) {
      _nTimer = setTimeout(обработатьТаймер, чСкрытьЧерез);
      _чСкрытьПосле = 0;
    } else {
      Hide();
    }
  });
  const обработатьДвижениеУказателя = AddExceptionHandler(
    ({ screenX, screenY, clientX, clientY }) => {
      _узАвтоскрытие.removeEventListener(
        "pointermove",
        обработатьДвижениеУказателя,
        PASSIVE_HANDLER
      );
      setTimeout(перехватитьДвижениеУказателя, МИН_ИНТЕРВАЛ_ДВИЖЕНИЯ);
      if (
        (_чЭкранX !== screenX || _чЭкранY !== screenY) &&
        (_чКлиентX !== clientX || _чКлиентY !== clientY) &&
        (Math.abs(_чКлиентX - clientX) >= ПОРОГ_ДВИЖЕНИЯ ||
          Math.abs(_чКлиентY - clientY) >= ПОРОГ_ДВИЖЕНИЯ) &&
        performance.now() >= _чНеПоказыватьДо
      ) {
        Show();
      }
      _чЭкранX = screenX;
      _чЭкранY = screenY;
      _чКлиентX = clientX;
      _чКлиентY = clientY;
    }
  );
  const перехватитьДвижениеУказателя = AddExceptionHandler(() => {
    _узАвтоскрытие.addEventListener(
      "pointermove",
      обработатьДвижениеУказателя,
      PASSIVE_HANDLER
    );
  });
  const обработатьЩелчок = AddExceptionHandler(() => {
    Show();
  });
  const обработатьПокиданиеУказателя = AddExceptionHandler(() => {
    Hide();
  });
  const обработатьВыборСкорости = AddExceptionHandler((oEvent) => {
    if (oEvent.button === LEFT_BUTTON) {
      if (_чИдТаймераВыбораСкорости !== 0) {
        clearTimeout(_чИдТаймераВыбораСкорости);
      }
      _чИдТаймераВыбораСкорости = setTimeout(
        () => document.body.classList.remove("выборскорости"),
        5e3
      );
      document.body.classList.add("выборскорости");
    }
  });
  function Start() {
    перехватитьДвижениеУказателя();
    _узАвтоскрытие.addEventListener("click", обработатьЩелчок);
    _узАвтоскрытие.addEventListener("mouseleave", обработатьПокиданиеУказателя);
    GetNode("скорость").addEventListener("pointerdown", обработатьВыборСкорости);
  }
  return {
    Start,
    Show,
    Hide,
  };
})();

const м_Медиазапрос = (() => {
  let _nTimer = -2;
  const обновить = AddExceptionHandler(() => {
    Check(_nTimer !== 0);
    _nTimer = 0;
    const элПроигрыватель = GetNode("проигрыватель");
    const чВысотаПроигрывателя =
      (элПроигрыватель.clientHeight * 100) /
      m_Settings.Get("чРазмерИнтерфейса");
    Check(чВысотаПроигрывателя > 0);
    элПроигрыватель.classList.toggle(
      "ужатьглавноеменю",
      чВысотаПроигрывателя <= 460
    );
    элПроигрыватель.classList.toggle(
      "ужатьнастройки",
      чВысотаПроигрывателя <= 412
    );
    const РАЗМЕР_ШРИФТА_МИН = 100;
    const РАЗМЕР_ШРИФТА_МАКС = 124;
    const РАЗМЕР_ШРИФТА_ШАГ = 8;
    const оСтильПанели = GetNode("верхняяпанель").style;
    const элЗаполнитель = GetNode("заполнитель");
    for (
      let чРазмерШрифта = РАЗМЕР_ШРИФТА_МАКС;
      ;
      чРазмерШрифта -= РАЗМЕР_ШРИФТА_ШАГ
    ) {
      оСтильПанели.fontSize = `${чРазмерШрифта}%`;
      if (
        чРазмерШрифта === РАЗМЕР_ШРИФТА_МИН ||
        элЗаполнитель.clientWidth > 0
      ) {
        break;
      }
    }
  });
  function updateQuickly() {
    if (_nTimer !== -1) {
      if (_nTimer > 0) {
        clearTimeout(_nTimer);
      }
      _nTimer = -1;
      requestAnimationFrame(обновить);
    }
  }
  function updateSlowly() {
    if (_nTimer === -2 || _nTimer === 0) {
      _nTimer = setTimeout(обновить, 200);
      Check(_nTimer > 0);
    }
  }
  window.addEventListener(
    "resize",
    AddExceptionHandler(() => {
      if (_nTimer !== -2) {
        updateSlowly();
      }
    })
  );
  return {
    updateQuickly,
    updateSlowly,
  };
})();

const м_Оформление = (() => {
  const СЕЛЕКТОР_КНОПКИ_ЦВЕТА = 'input[type="color"]';
  let _оПрозрачность = null;
  const ОбработатьВводЦвета = AddExceptionHandler((oEvent) => {
    if (oEvent.target.matches(СЕЛЕКТОР_КНОПКИ_ЦВЕТА)) {
      ОбновитьСтили();
    }
  });
  const ОбработатьИзменениеЦвета = AddExceptionHandler((oEvent) => {
    if (oEvent.target.matches(СЕЛЕКТОР_КНОПКИ_ЦВЕТА)) {
      m_Settings.Change(oEvent.target.id, oEvent.target.value);
    }
  });
  function ОбработатьИзменениеПредустановкиОформления() {
    ОбновитьОкноНастроек();
    ОбновитьСтили();
  }
  function ОбновитьОкноНастроек() {
    for (let nodeButton of document.querySelectorAll(СЕЛЕКТОР_КНОПКИ_ЦВЕТА)) {
      nodeButton.value = m_Settings.Get(nodeButton.id);
    }
    _оПрозрачность.Update();
  }
  function ОбновитьСтили() {
    const oStyle = document.documentElement.style;
    for (let nodeButton of document.querySelectorAll(СЕЛЕКТОР_КНОПКИ_ЦВЕТА)) {
      oStyle.setProperty(
        `--${nodeButton.id}`,
        Number.parseInt(nodeButton.value.slice(1, 3), 16) +
        "," +
        Number.parseInt(nodeButton.value.slice(3, 5), 16) +
        "," +
        Number.parseInt(nodeButton.value.slice(5, 7), 16)
      );
    }
    const чНепрозрачность = Round(
      1 - m_Settings.Get("чПрозрачность") / 100,
      2
    );
    oStyle.setProperty("--чНепрозрачность", чНепрозрачность);
    oStyle.setProperty(
      "--чНепрозрачностьОкна",
      Clamp(чНепрозрачность, 0.85, 1)
    );
  }
  function ПрименитьРазмерИнтерфейса() {
    document.documentElement.style.fontSize = `${(16 * m_Settings.Get("чРазмерИнтерфейса")) / 100
      }px`;
    м_Медиазапрос.updateSlowly();
  }
  function Start() {
    m_i18n.TranslateDocument(document);
    _оПрозрачность = new NumberInput("чПрозрачность", 5, 0, "прозрачность");
    _оПрозрачность.AfterChange = ОбновитьСтили;
    document.addEventListener("input", ОбработатьВводЦвета);
    document.addEventListener("change", ОбработатьИзменениеЦвета);
    m_Events.AddHandler(
      "настройки-измениласьпредустановка-оформление",
      ОбработатьИзменениеПредустановкиОформления
    );
    ОбработатьИзменениеПредустановкиОформления();
    new NumberInput(
      "чРазмерИнтерфейса",
      1,
      0,
      "размеринтерфейса"
    ).AfterChange = ПрименитьРазмерИнтерфейса;
    ПрименитьРазмерИнтерфейса();
    ShowElement(document.body, true);
  }
  return {
    Start,
  };
})();

const m_Notification = (() => {
  const ПОКАЗЫВАТЬ_УВЕДОМЛЕНИЕ = 2e3;
  let _nTimer = 0;
  function Show(сИдЗначка, лЖопа) {
    Check(document.getElementById(сИдЗначка) && typeof лЖопа == "boolean");
    const узУведомление = GetNode("уведомление");
    узУведомление.classList.toggle("жопа", лЖопа);
    ShowElement(узУведомление, true);
    узУведомление.firstElementChild.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "href",
      `#${сИдЗначка}`
    );
    if (_nTimer !== 0) {
      clearTimeout(_nTimer);
    }
    _nTimer = setTimeout(СкрытьУведомление, ПОКАЗЫВАТЬ_УВЕДОМЛЕНИЕ);
  }
  function ShowHappiness() {
    Show("svg-success", false);
  }
  function ShowAss() {
    Show("svg-fail", true);
  }
  const СкрытьУведомление = AddExceptionHandler(() => {
    ShowElement("уведомление", false);
    _nTimer = 0;
  });
  return {
    Show,
    ShowHappiness,
    ShowAss,
  };
})();

const м_Шкала = (() => {
  let _чНачало = 0;
  let _чКонец = 0;
  let _чПросмотрено;
  function ОграничитьВремя(nTime) {
    return Clamp(nTime, _чНачало, _чКонец);
  }
  function Update() {
    Check(
      Number.isFinite(_чНачало) &&
      Number.isFinite(_чКонец) &&
      Number.isFinite(_чПросмотрено)
    );
    GetNode("шкала-просмотрено").style.transform = `scaleX(${(
      (_чПросмотрено - _чНачало) /
      (_чКонец - _чНачало)
    ).toFixed(4)})`;
  }
  const ОбработатьЩелчок = AddExceptionHandler((oEvent) => {
    if (м_Управление.GetState() !== STATE_REPEAT) {
      return;
    }
    const оБордюр = oEvent.currentTarget.getBoundingClientRect();
    const oStyle = getComputedStyle(oEvent.currentTarget);
    const чНачалоШкалы = Math.round(
      оБордюр.left + Number.parseFloat(oStyle.paddingLeft)
    );
    const чКонецШкалы = Math.round(
      оБордюр.right - Number.parseFloat(oStyle.paddingRight)
    );
    const чУказатель = oEvent.clientX + 1;
    const nSeekTo = ОграничитьВремя(
      ((чУказатель - чНачалоШкалы) / (чКонецШкалы - чНачалоШкалы)) *
      (_чКонец - _чНачало) +
      _чНачало
    );
    m_Log.Окак(`[Шкала] Перематываю до ${nSeekTo}`);
    m_Player.ПеремотатьПовторДо(nSeekTo);
  });
  function ЗадатьНачалоИКонец(чНачало, чКонец) {
    Check(чНачало <= чКонец);
    _чНачало = чНачало;
    _чКонец = чКонец;
    document
      .getElementById("шкала")
      .addEventListener("click", ОбработатьЩелчок);
  }
  function SetWatched(nWatched) {
    _чПросмотрено = ОграничитьВремя(nWatched);
    Update();
  }
  function GetStart() {
    return _чНачало;
  }
  function GetEnd() {
    return _чКонец;
  }
  return {
    ЗадатьНачалоИКонец,
    SetWatched,
    GetStart,
    GetEnd,
  };
})();

/**
 * Module: News & Updates Manager (м_Новости)
 * -----------------------------------------------------------------------------
 * This module is a Singleton (IIFE) responsible for:
 * 1. CHANGELOG & NEWS DISPLAY:
 *    - Stores the entire history of changes (`_мНовости`) as [Date/Version, TitleKey, ContentKeys...].
 *    - Renders these items into the UI (via `ДобавитьНовости`).
 *    - Supports "Special" pages like "Full Help" (`ПОЛНАЯ_СПРАВКА`) or "Tablet Info".
 *    - Auto-generates "Google Translate" links for non-Russian users.
 *
 * 2. UPDATE CHECKING:
 *    - Notifies the user if a new version is found (logic involves `м_Настройки.чПоследняяПроверкаОбновленияРасширения`).
 *
 * 3. VERSION TRACKING:
 *    - On startup (`Запустить`), compares the current extension version (`ВЕРСИЯ_РАСШИРЕНИЯ`)
 *      with the last seen version (`сПредыдущаяВерсия` in Settings).
 *    - If upgraded, highlights the "News" button to alert the user of new features.
 *
 * USAGE IN CODEBASE:
 * - `м_Новости.Запустить()`: Called on player startup to verify version and check for updates.
 * - `м_Новости.ОткрытьНовости()`: Triggered by UI menu ("открытьновости"). Shows relevant changes based on what the user has seen.
 * - `м_Новости.ОткрытьСправку()`: Triggered by UI menu ("открытьсправку"). Displays the full manual.
 *
 * DEPENDENCIES:
 * - `м_Настройки`: To read/write version history and check times.
 * - `м_i18n`: To translate news keys (Jxxxx, Fxxxx) into text.
 * - `м_Загрузчик`: To fetch the version.json file.
 * - `м_Окно`: To open the modal window.
 */
const м_Новости = (() => {
  // Special "Version" Constants (Markers for non-date items)
  const ПОКАЗАТЬ_ОДИН_РАЗ = "2000.1.1"; // Show once (e.g. urgent notice)
  const ПОКАЗЫВАТЬ_ВСЕГДА = "2000.2.2"; // Always visible (e.g. pinned)
  const ПОЛНАЯ_СПРАВКА = "2000.3.3";    // Full Help/Manual identifier
  const ДЛЯ_ПЛАНШЕТА = "2000.4.4";      // Tablet-specific info

  // Changelog Data: [Version/Date, Title_I18n_Key, Content_I18n_Keys...]
  // Used to generate the "What's New" list.
  const _мНовости = [
    ["2025.5.28", "J1010", "F1078"],
    ["2024.6.14", "J1010", "F1077"],
    ["2024.6.5", "J1010", "F1076"],
    ["2024.6.5", "J1010", "F1074"],
    ["2024.5.31", "F1072", "F1073"],
    ["2022.1.20", "J1513", "F1515"],
    ["2021.12.17", "J1066", "F1070", "F1514"],
    ["2021.12.17", "J1010", "F1069"],
    ["2021.3.7", "J1010", "F1068"],
    ["2020.10.30", "J1066", "F1067"],
    ["2020.10.5", "J1010", "F1065"],
    ["2019.10.9", "J1010", "F1064"],
    ["2019.3.17", "J1010", "F1063"],
    ["2018.10.28", "J1010", "F1062"],
    ["2018.8.17", "J1010", "F1060"],
    ["2018.7.30", "J1010", "F1059"],
    ["2018.6.27", "J1010", "F1058"],
    ["2018.6.12", "J1010", "F1057"],
    ["2018.5.18", "J1010", "F1049"],
    ["2018.4.24", "J1036", "F1048"],
    ["2018.4.6", "J1010", "F1047"],
    ["2018.3.17", "J1010", "F1046"],
    ["2018.3.4", "J1041", "F1042"],
    ["2018.2.17", "J1010", "F1044"],
    ["2018.1.7", "J1010", "F1043"],
    ["2017.11.6", "J1010", "F1037", "F1038"],
    ["2017.10.22", "J1010", "F1023"],
    ["2017.10.14", "J1010", "F1020"],
    ["2017.9.11", "J1010", "F1018"],
    ["2017.8.8", "J1035", "F1017"],
    ["2017.6.23", "J1010", "F1014"],
    ["2017.5.29", "J1010", "F1013"],
    ["2017.3.31", "J1031", "F1012"],
    ["2017.2.26", "J1030", "F1011"],
    [
      ПОЛНАЯ_СПРАВКА,
      "J1500", // Start of manual ? (Keys are cryptic, likely "Manual" or "Help")
      "F1501",
      "F1503",
      "F1502",
      "F1575",
      "F1509",
      "F1573",
      "F1574",
      "F1504",
      "F1514",
      "F1507",
    ],
    [
      ПОЛНАЯ_СПРАВКА,
      "J1513",
      "F1570",
      "F1571",
      "F1572",
      "F1515",
      "F1511",
      "F1506",
      "F1510",
    ],
    [ПОКАЗАТЬ_ОДИН_РАЗ, "J1054", "F1501"],
    [ДЛЯ_ПЛАНШЕТА, "J1055", "F1056"],
    [ПОКАЗЫВАТЬ_ВСЕГДА, "J1003", "F1000"],
  ];
  function ПеревестиВерсиюВМиллисекунды(сВерсия) {
    const мчЧасти = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(сВерсия);
    мчЧасти[1] |= 0;
    мчЧасти[2] |= 0;
    мчЧасти[3] |= 0;
    мчЧасти[4] |= 0;
    return Date.UTC(
      мчЧасти[1],
      мчЧасти[2] - 1,
      мчЧасти[3],
      0,
      0,
      0,
      мчЧасти[4]
    );
  }
  function ЕстьНовостиСВерсиейСтарше(сВерсия) {
    const чВерсия = ПеревестиВерсиюВМиллисекунды(сВерсия);
    return _мНовости.some(
      (мНовость) => ПеревестиВерсиюВМиллисекунды(мНовость[0]) > чВерсия
    );
  }
  function ДобавитьНовости(чДобавитьВерсииСтарше, сДобавитьВерсиюСправки) {
    Check(
      typeof чДобавитьВерсииСтарше == "number" && чДобавитьВерсииСтарше >= 0
    );
    Check(
      сДобавитьВерсиюСправки === "" || сДобавитьВерсиюСправки.startsWith("2000")
    );
    Check(
      Number.isFinite(чДобавитьВерсииСтарше) || сДобавитьВерсиюСправки !== ""
    );
    const элДобавитьВ = GetNode("текстновостей");
    элДобавитьВ.textContent = "";
    for (let мНовость of _мНовости) {
      const сВерсия = мНовость[0];
      if (сВерсия.startsWith("2000")) {
        if (
          сВерсия === сДобавитьВерсиюСправки ||
          (сВерсия === ДЛЯ_ПЛАНШЕТА && isMobileDevice()) ||
          сВерсия === ПОКАЗЫВАТЬ_ВСЕГДА
        ) {
          ДобавитьНовость(элДобавитьВ, мНовость, 0);
        }
      } else {
        const чВерсия = ПеревестиВерсиюВМиллисекунды(сВерсия);
        if (чВерсия > чДобавитьВерсииСтарше) {
          ДобавитьНовость(элДобавитьВ, мНовость, чВерсия);
        }
      }
    }
    м_Окно.configureScrollIndicator(элДобавитьВ);
  }
  function ДобавитьНовость(элДобавитьВ, мНовость, чДатаНовости) {
    if (элДобавитьВ.firstElementChild) {
      элДобавитьВ.appendChild(document.createElement("hr"));
    }
    const узЗаголовок = document.createElement("h4");
    if (чДатаНовости === 0) {
      узЗаголовок.textContent = GetText(мНовость[1]);
    } else {
      узЗаголовок.textContent = `${m_i18n.FormatDate(
        чДатаНовости
      )} · ${GetText(мНовость[1])}`;
    }
    элДобавитьВ.appendChild(узЗаголовок);
    if (GetText("M0010") !== "ru") {
      const elLink = узЗаголовок.appendChild(document.createElement("a"));
      elLink.className = "новость-перевести";
      elLink.href = "translate:";
      elLink.target = "_blank";
      elLink.title = GetText("J0148");
    }
    for (let idx = 2; idx < мНовость.length; ++idx) {
      m_i18n.InsertAdjacentHtmlMessage(элДобавитьВ, "beforeend", мНовость[idx]);
    }
  }
  function OpenWindow(лПодтвердитьПрочтение) {
    if (лПодтвердитьПрочтение) {
      m_i18n.InsertAdjacentHtmlMessage(
        "закрытьновости",
        "content",
        "F0619"
      ).title = GetText("A0620");
      ShowElement("отложитьновости", true);
    } else {
      m_i18n.InsertAdjacentHtmlMessage(
        "закрытьновости",
        "content",
        "F0663"
      ).title = "";
      ShowElement("отложитьновости", false);
    }
    m_Events.AddHandler(
      "управление-левыйщелчок",
      ОбработатьЛевыйЩелчок
    );
    м_Окно.open("новости");
  }
  function ОбработатьЛевыйЩелчок(oEvent) {
    if (
      oEvent.сПозывной === "закрытьновости" &&
      ElementIsShown("отложитьновости")
    ) {
      ShowElement("открытьновости", false);
      m_Settings.Change("сПредыдущаяВерсия", EXTENSION_VERSION);
    } else if (oEvent.target.href === "translate:") {
      let sText = "";
      for (
        let элТекст = oEvent.target.parentElement;
        элТекст && элТекст.nodeName !== "HR";
        элТекст = элТекст.nextElementSibling
      ) {
        sText += `${элТекст.textContent}\n\n`;
      }
      oEvent.target.href = `https://translate.google.com/?op=translate&sl=${GetText(
        "M0010"
      )}&text=${encodeURIComponent(sText)}`;
    }
  }
  function OpenHelp() {
    ДобавитьНовости(Infinity, ПОЛНАЯ_СПРАВКА);
    OpenWindow(false);
  }
  function ОткрытьНовости() {
    const { pCurrent: сПредыдущаяВерсия, pInitial: сНачальнаяВерсия } =
      m_Settings.GetSettingParameters("сПредыдущаяВерсия");
    if (сПредыдущаяВерсия === сНачальнаяВерсия) {
      ДобавитьНовости(Infinity, ПОКАЗАТЬ_ОДИН_РАЗ);
      OpenWindow(false);
      ShowElement("открытьновости", false);
      m_Settings.Change("сПредыдущаяВерсия", EXTENSION_VERSION);
    } else if (сПредыдущаяВерсия !== EXTENSION_VERSION) {
      ДобавитьНовости(ПеревестиВерсиюВМиллисекунды(сПредыдущаяВерсия), "");
      OpenWindow(true);
      GetNode("открытьновости").classList.remove("непрочитано");
    } else {
      ДобавитьНовости(0, "");
      OpenWindow(false);
    }
  }
  /*
   * The extension used to poll the original author's website every five days for
   * a version manifest, and offer an update from it. This fork does not ship from
   * there, so the check is gone rather than left pointing at someone else's site.
   */
  function Start() {
    const { pCurrent: сПредыдущаяВерсия, pInitial: сНачальнаяВерсия } =
      m_Settings.GetSettingParameters("сПредыдущаяВерсия");
    if (сПредыдущаяВерсия !== EXTENSION_VERSION) {
      m_Log.Окак(
        `[Новости] Версия расширения изменилась с ${сПредыдущаяВерсия} на ${EXTENSION_VERSION}`
      );
      if (
        сПредыдущаяВерсия === сНачальнаяВерсия ||
        ЕстьНовостиСВерсиейСтарше(сПредыдущаяВерсия)
      ) {
        ShowElement("открытьновости", true).classList.add("непрочитано");
      } else {
        m_Settings.Change("сПредыдущаяВерсия", EXTENSION_VERSION);
      }
    }
  }
  return {
    Start,
    ОткрытьНовости,
    OpenHelp,
  };
})();

const м_Управление = (() => {
  const ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА = 5;
  const ПЕРЕМАТЫВАТЬ_ПО_КАДРАМ_НА = 3;
  const НАЗВАНИЕ_ТРАНСЛЯЦИИ_НЕИЗВЕСТНО = "• • •";
  let _чСостояние;
  let _оНачалоВоспроизведения,
    _оРазмерБуфера,
    _оРастягиваниеБуфера,
    _оДлительностьПовтора;
  let _оИнтервалАвтоскрытия;
  function запуститьИзменениеГромкостиКолесом() {
    document.removeEventListener("pointerdown", обработатьНажатиеКолеса);
    document.removeEventListener("wheel", обработатьВращениеКолеса);
    if (m_Settings.Get("лМенятьГромкостьКолесом")) {
      document.addEventListener("pointerdown", обработатьНажатиеКолеса);
      if (m_Settings.Get("чШагИзмененияГромкостиКолесом") !== 0) {
        document.addEventListener("wheel", обработатьВращениеКолеса, {
          passive: false,
        });
      }
    }
  }
  const обработатьНажатиеКолеса = createElementEventHandler(
    (oEvent) => {
      if (
        !(
          oEvent.button !== MIDDLE_BUTTON ||
          oEvent.shiftKey ||
          oEvent.ctrlKey ||
          oEvent.altKey ||
          oEvent.metaKey ||
          IsLinkEvent(oEvent)
        )
      ) {
        oEvent.preventDefault();
        СохранитьИПрименитьГромкость(!m_Settings.Get("лПриглушить"));
      }
    }
  );
  const обработатьВращениеКолеса = AddExceptionHandler((oEvent) => {
    if (
      !(
        oEvent.shiftKey ||
        oEvent.ctrlKey ||
        oEvent.altKey ||
        oEvent.metaKey ||
        ElementAtThisPointCanScroll(oEvent.clientX, oEvent.clientY)
      )
    ) {
      oEvent.preventDefault();
      m_Log.Вот(
        `[Управление] Движение колеса deltaY=${oEvent.deltaY} deltaMode=${oEvent.deltaMode}`
      );
      if (oEvent.deltaY !== 0) {
        СохранитьИПрименитьГромкость(
          void 0,
          Clamp(
            m_Settings.Get("чГромкость2") -
            m_Settings.Get("чШагИзмененияГромкостиКолесом") *
            Math.sign(oEvent.deltaY),
            MIN_VOLUME,
            MAX_VOLUME
          )
        );
      }
    }
  });
  function ПрименитьМасштабированиеИзображения() {
    GetNode("глаз").classList.toggle(
      "масштабировать",
      m_Settings.Get("лМасштабироватьИзображение")
    );
  }
  function ПрименитьАнимациюИнтерфейса() {
    document.body.classList.toggle(
      "анимацияинтерфейса",
      m_Settings.Get("лАнимацияИнтерфейса")
    );
  }
  function StopWatchingBroadcast() {
    if (
      _чСостояние === STATE_STOP ||
      _чСостояние === STATE_REPEAT
    ) {
      return false;
    }
    m_Log.Окак("[Управление] Останавливаю просмотр трансляции");
    м_Список.Stop();
    м_Преобразователь.Stop();
    g_maQueue.Clear();
    g_maQueue.Add(new Segment(PROCESSING_CONVERTED, STATE_REPEAT));
    m_Player.AddNextSegment();
    return true;
  }
  function ПереключитьПросмотрТрансляции() {
    if (!StopWatchingBroadcast()) {
      m_Log.Окак("[Управление] Начинаю просмотр трансляции");
      g_maQueue.Clear();
      m_Player.Перезагрузить(STATE_START);
      м_Список.Start();
    }
  }
  function ПереключитьОкноСтатистики() {
    if (m_Statistics.WindowOpened()) {
      m_Statistics.CloseWindow();
    } else {
      m_Statistics.OpenWindow();
    }
  }
  function ПереключитьПроверкуЦвета(oEvent) {
    if (document.body.classList.toggle("проверкацвета")) {
      document.body.classList.toggle("проверкацветафон", !oEvent.shiftKey);
      м_Новости.OpenHelp();
    } else {
      document.body.classList.remove("проверкацветафон");
    }
  }
  function КопироватьТекстВБуферОбмена(sText) {
    Check(typeof sText == "string");
    if (sText === "") {
      m_Notification.ShowAss();
      return;
    }
    navigator.clipboard
      .writeText(sText)
      .then(
        () => {
          m_Log.Вот("[Управление] Копирование в буфер обмена завершено");
          m_Notification.ShowHappiness();
        },
        (pReason) => {
          m_Log.Ой(
            `[Управление] Error copying to clipboard: ${pReason}`
          );
          m_Notification.ShowAss();
        }
      )
      .catch(m_Debug.CaughtException);
  }
  function КопироватьАдресТрансляцииВБуферОбмена() {
    if (КопироватьАдресТрансляцииВБуферОбмена.bInProgress) {
      return;
    }
    КопироватьАдресТрансляцииВБуферОбмена.bInProgress = true;
    m_Log.Окак("[Управление] Получаю адрес трансляции для копирования");
    м_Twitch
      .GetAbsoluteVariantListUrl(null, true, false)
      .then((sResult) => {
        m_Log.Вот("[Управление] Копирую адрес трансляции в буфер обмена");
        return navigator.clipboard.writeText(sResult).then(
          () => {
            КопироватьАдресТрансляцииВБуферОбмена.bInProgress = false;
            m_Log.Вот("[Управление] Копирование в буфер обмена завершено");
            м_Управление.StopWatchingBroadcast();
            m_Notification.ShowHappiness();
          },
          (pReason) => {
            throw `Error copying to clipboard: ${pReason}`;
          }
        );
      })
      .catch(
        AddExceptionHandler((pReason) => {
          КопироватьАдресТрансляцииВБуферОбмена.bInProgress = false;
          if (typeof pReason == "string") {
            m_Log.Ой(
              `[Управление] Ошибка при копировании адреса трансляции в буфер обмена: ${pReason}`
            );
            m_Notification.ShowAss();
          } else {
            throw pReason;
          }
        })
      );
  }
  const ОбработатьИзменениеГромкости = AddExceptionHandler(
    (oEvent) => {
      СохранитьИПрименитьГромкость(false, oEvent.target.valueAsNumber);
    }
  );
  function СохранитьИПрименитьГромкость(лПриглушить, чГромкость) {
    Check(лПриглушить !== void 0 || чГромкость !== void 0);
    if (document.body.classList.contains("нетзвука")) {
      return;
    }
    if (лПриглушить !== void 0) {
      m_Settings.Change("лПриглушить", лПриглушить);
    }
    if (чГромкость !== void 0) {
      m_Settings.Change("чГромкость2", Math.round(чГромкость));
    }
    m_Player.ПрименитьГромкость();
    ОбновитьГромкость();
    м_Автоскрытие.Show();
  }
  function ОбновитьГромкость() {
    const чГромкость = m_Settings.Get("чГромкость2");
    const узГромкость = GetNode("громкость");
    узГромкость.value = чГромкость;
    узГромкость.style.setProperty(
      "--ширина",
      `${((чГромкость - MIN_VOLUME) / (100 - MIN_VOLUME)) *
      100
      }%`
    );
    ChangeButton(
      "переключитьприглушить",
      m_Settings.Get("лПриглушить")
    );
  }
  function ОбновитьКоличествоДорожек(bHasVideo, bHasAudio) {
    document.body.classList.toggle("нетвидео", !bHasVideo);
    document.body.classList.toggle("нетзвука", !bHasAudio);
  }
  function ChangeViewerChannelSubscription(nSubscription) {
    if (
      !document
        .getElementById("зритель-подписка")
        .classList.contains("обновляется")
    ) {
      м_Twitch.ChangeViewerChannelSubscription(nSubscription);
    }
  }
  const ОбработатьЛевыйЩелчок = createElementEventHandler((oEvent) => {
    if (oEvent.button !== LEFT_BUTTON) {
      return;
    }
    const узЩелчок = oEvent.target;
    let узПозывной = узЩелчок;
    let сПозывной = узПозывной.id || узПозывной.name;
    if (!сПозывной && узЩелчок.parentNode) {
      узПозывной = узЩелчок.parentNode;
      сПозывной = узПозывной.id || узПозывной.name;
    }
    oEvent.узПозывной = узПозывной;
    oEvent.сПозывной = сПозывной;
    m_Events.SendEvent("управление-левыйщелчок", oEvent);
    switch (сПозывной) {
      case "переключитьтрансляцию":
        ПереключитьПросмотрТрансляции();
        break;

      case "переключитьпаузу":
        if (_чСостояние === STATE_REPEAT) {
          m_Player.TogglePause();
        }
        break;

      case "переключитьприглушить":
        СохранитьИПрименитьГромкость(!m_Settings.Get("лПриглушить"));
        break;

      case "переключитьчат":
        м_Чат.TogglePanelState();
        break;

      case "создатьклип":
        м_Twitch.CreateClip();
        break;

      case "переключитькартинкавкартинке":
        м_КартинкаВКартинке.toggle();
        break;

      case "переключитьполноэкранный":
        m_FullscreenMode.Toggle();
        break;

      case "одновременныхзагрузок":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "кОдновременныхЗагрузок",
          Number.parseInt(узЩелчок.value, 10)
        );
        m_Statistics.ClearHistory();
        break;

      case "анимацияинтерфейса":
        m_Settings.Change("лАнимацияИнтерфейса", узЩелчок.checked);
        ПрименитьАнимациюИнтерфейса();
        break;

      case "масштабироватьизображение":
        m_Settings.Change("лМасштабироватьИзображение", узЩелчок.checked);
        ПрименитьМасштабированиеИзображения();
        break;

      case "автоположениечата":
        m_Settings.Change("лАвтоПоложениеЧата", узЩелчок.checked);
        ОбновитьОкноНастроек();
        м_Чат.ApplyPanelPosition();
        break;

      case "горизонтальноеположениечата":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "чГоризонтальноеПоложениеЧата",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Чат.ApplyPanelPosition();
        break;

      case "вертикальноеположениечата":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "чВертикальноеПоложениеЧата",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Чат.ApplyPanelPosition();
        break;

      case "положениечата":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "чПоложениеПанелиЧата",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Чат.ApplyPanelPosition();
        break;

      case "состояниезакрытогочата":
        Check(узЩелчок.checked);
        м_Чат.СохранитьИПрименитьСостояниеЗакрытойПанели(
          Number.parseInt(узЩелчок.value, 10)
        );
        break;

      case "переключитьстатистику":
      case "позиция":
        ПереключитьОкноСтатистики();
        break;

      case "открытьновости":
      case "открытьновости2":
        м_Новости.ОткрытьНовости();
        break;

      case "открытьсправку":
        м_Новости.OpenHelp();
        break;

      case "отправитьотзыв":
        m_Debug.TerminateAndSendFeedback();
        break;

      case "экспортнастроек":
        m_Settings.Export();
        break;

      case "импортнастроек":
        const node = document.getElementById("выборфайладляимпортанастроек");
        node.value = "";
        node.click();
        break;

      case "сброситьнастройки":
        m_Settings.Reset();
        break;

      case "проверкацвета":
        ПереключитьПроверкуЦвета(oEvent);
        break;

      case "зритель-подписаться":
        ChangeViewerChannelSubscription(SUBSCRIPTION_NOTIFY);
        break;

      case "зритель-отписаться":
        ChangeViewerChannelSubscription(SUBSCRIPTION_NOT_SUBSCRIBED);
        break;

      case "зритель-уведомлять":
        ChangeViewerChannelSubscription(
          узЩелчок.checked ? SUBSCRIPTION_NOTIFY : SUBSCRIPTION_DO_NOT_NOTIFY
        );
        break;

      case "закрытьстатистику":
        m_Statistics.CloseWindow();
        break;

      case "копироватьадресканала":
        m_Log.Вот("[Управление] Копирую адрес канала в буфер обмена");
        КопироватьТекстВБуферОбмена(м_Twitch.GetChannelUrl(false));
        break;

      case "копироватьадрестрансляции":
        КопироватьАдресТрансляцииВБуферОбмена();
    }
  });
  const ОбработатьНажатиеИОтпусканиеКлавы = AddExceptionHandler(
    (oEvent) => {
      const SHIFT_KEY = 1 << 16;
      const CTRL_KEY = 1 << 17;
      const ALT_KEY = 1 << 18;
      const META_KEY = 1 << 19;
      const лНажатие = oEvent.type === "keydown";
      const лНажатие1 = лНажатие && !oEvent.repeat;
      switch (
      oEvent.keyCode +
      oEvent.shiftKey * SHIFT_KEY +
      oEvent.ctrlKey * CTRL_KEY +
      oEvent.altKey * ALT_KEY +
      oEvent.metaKey * META_KEY
      ) {
        case 27:
          oEvent.preventDefault();
          if (лНажатие1) {
            getSelection().removeAllRanges();
            м_Окно.close(false);
            м_Автоскрытие.Hide(false);
          }
          break;

        case 70:
        case 13:
        case 13 + ALT_KEY:
          if (лНажатие1) {
            m_FullscreenMode.Toggle();
          }
          break;

        case 13 + SHIFT_KEY:
          if (лНажатие1) {
            м_КартинкаВКартинке.toggle();
          }
          break;

        case 93:
          if (!лНажатие) {
            GetNode("глаз").focus();
          }
          return;

        case 88:
          if (лНажатие1) {
            м_Окно.toggle("главноеменю");
          }
          break;

        case 67:
          if (лНажатие1) {
            м_Чат.TogglePanelState();
          }
          break;

        case 86:
          if (лНажатие1) {
            м_Окно.toggle("настройки");
          }
          break;

        case 73:
          if (лНажатие1) {
            м_Окно.toggle("канал");
          }
          break;

        case 83:
          if (лНажатие1) {
            ПереключитьОкноСтатистики();
          }
          break;

        case 112:
          if (лНажатие1) {
            м_Новости.OpenHelp();
          }
          break;

        case 65 + CTRL_KEY:
          break;

        case 85 + CTRL_KEY:
          if (лНажатие1) {
            м_Чат.ПереключитьПоложениеПанели();
            ОбновитьОкноНастроек();
          }
          break;

        case 32:
          if (лНажатие1) {
            ПереключитьПросмотрТрансляции();
            м_Автоскрытие.Show();
          }
          break;

        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
        case 48:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            задатьСкоростьПовтора(
              58 - (oEvent.keyCode === 48 ? 58 : oEvent.keyCode)
            );
            м_Автоскрытие.Show();
          }
          break;

        case 187:
        case 107:
        case 190:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            задатьСкоростьПовтора(-Infinity);
            м_Автоскрытие.Show();
          }
          break;

        case 189:
        case 109:
        case 188:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            задатьСкоростьПовтора(Infinity);
            м_Автоскрытие.Show();
          }
          break;

        case 75:
        case 12:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            m_Player.TogglePause();
            м_Автоскрытие.Show();
          }
          break;

        case 74:
        case 37:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(
              `[Управление] Перематываю на -${ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА}с`
            );
            m_Player.SeekReplayBy(
              false,
              -ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА
            );
            м_Автоскрытие.Show();
          }
          break;

        case 76:
        case 39:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(
              `[Управление] Перематываю на +${ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА}с`
            );
            m_Player.SeekReplayBy(
              false,
              ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА
            );
            м_Автоскрытие.Show();
          }
          break;

        case 74 + SHIFT_KEY:
        case 37 + SHIFT_KEY:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(
              `[Управление] Перематываю на -${ПЕРЕМАТЫВАТЬ_ПО_КАДРАМ_НА} кадров`
            );
            m_Player.SeekReplayBy(
              true,
              -ПЕРЕМАТЫВАТЬ_ПО_КАДРАМ_НА
            );
          }
          break;

        case 76 + SHIFT_KEY:
        case 39 + SHIFT_KEY:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(`[Управление] Перематываю на +1 кадр`);
            m_Player.SeekReplayBy(true, 1);
          }
          break;

        case 38:
          if (лНажатие) {
            СохранитьИПрименитьГромкость(
              false,
              Math.min(
                m_Settings.Get("чГромкость2") +
                VOLUME_INCREASE_STEP_BY_KEY,
                MAX_VOLUME
              )
            );
          }
          break;

        case 40:
          if (лНажатие) {
            СохранитьИПрименитьГромкость(
              false,
              Math.max(
                m_Settings.Get("чГромкость2") -
                VOLUME_DECREASE_STEP_BY_KEY,
                MIN_VOLUME
              )
            );
          }
          break;

        case 33:
          if (лНажатие1) {
            СохранитьИПрименитьГромкость(false);
          }
          break;

        case 34:
          if (лНажатие1) {
            СохранитьИПрименитьГромкость(true);
          }
          break;

        case 77:
          if (лНажатие1) {
            СохранитьИПрименитьГромкость(!m_Settings.Get("лПриглушить"));
          }
          break;

        case 73 + CTRL_KEY:
          if (лНажатие1) {
            const лМасштабироватьИзображение = m_Settings.Get(
              "лМасштабироватьИзображение"
            );
            m_Settings.Change(
              "лМасштабироватьИзображение",
              !лМасштабироватьИзображение
            );
            ОбновитьОкноНастроек();
            ПрименитьМасштабированиеИзображения();
            m_Notification.Show(
              `svg-fullscreen-${лМасштабироватьИзображение}`,
              false
            );
          }
          break;

        case 88 + ALT_KEY:
          if (лНажатие1) {
            м_Twitch.CreateClip();
          }
          break;

        default:
          return;
      }
      oEvent.preventDefault();
    }
  );
  function ОбновитьОкноНастроек() {
    document.querySelector(
      `input[name="одновременныхзагрузок"][value="${m_Settings.Get(
        "кОдновременныхЗагрузок"
      )}"]`
    ).checked = true;
    document.querySelector(
      `input[name="состояниезакрытогочата"][value="${m_Settings.Get(
        "чСостояниеЗакрытогоЧата"
      )}"]`
    ).checked = true;
    GetNode("адресчата").selectedIndex = m_Settings.Get("лПолноценныйЧат")
      ? 0
      : m_Settings.Get("лЗатемнитьЧат")
        ? 2
        : 1;
    GetNode("масштабироватьизображение").checked = m_Settings.Get(
      "лМасштабироватьИзображение"
    );
    GetNode("анимацияинтерфейса").checked = m_Settings.Get(
      "лАнимацияИнтерфейса"
    );
    GetNode("менятьгромкостьколесом").value = m_Settings.Get(
      "лМенятьГромкостьКолесом"
    )
      ? m_Settings.Get("чШагИзмененияГромкостиКолесом")
      : "";
    const лАвтоПоложение = m_Settings.Get("лАвтоПоложениеЧата");
    GetNode("автоположениечата").checked = лАвтоПоложение;
    const сузСтороны = document.querySelectorAll(".положениечата input");
    if (лАвтоПоложение) {
      const чГоризонтальноеПоложение = m_Settings.Get(
        "чГоризонтальноеПоложениеЧата"
      );
      const чВертикальноеПоложение = m_Settings.Get(
        "чВертикальноеПоложениеЧата"
      );
      let узГоризонтальноеПоложение, узВертикальноеПоложение;
      for (let узСторона of сузСтороны) {
        const чСторона = Number.parseInt(узСторона.value, 10);
        if (чГоризонтальноеПоложение === чСторона) {
          узГоризонтальноеПоложение = узСторона;
        }
        if (чВертикальноеПоложение === чСторона) {
          узВертикальноеПоложение = узСторона;
        }
        узСторона.name =
          чСторона === RIGHT_SIDE || чСторона === LEFT_SIDE
            ? "горизонтальноеположениечата"
            : "вертикальноеположениечата";
      }
      узГоризонтальноеПоложение.checked =
        узВертикальноеПоложение.checked = true;
    } else {
      const nPosition = m_Settings.Get("чПоложениеПанелиЧата");
      let узПоложение;
      for (let узСторона of сузСтороны) {
        if (nPosition === Number.parseInt(узСторона.value, 10)) {
          узПоложение = узСторона;
        }
        узСторона.name = "положениечата";
      }
      узПоложение.checked = true;
    }
    if (_оНачалоВоспроизведения) {
      _оНачалоВоспроизведения.Update();
      _оРазмерБуфера.Update();
      _оРастягиваниеБуфера.Update();
      _оДлительностьПовтора.Update();
      _оИнтервалАвтоскрытия.Update();
    } else {
      _оНачалоВоспроизведения = new NumberInput(
        "чНачалоВоспроизведения",
        0.5,
        1,
        "началовоспроизведения"
      );
      _оРазмерБуфера = new NumberInput("чРазмерБуфера", 0.5, 1, "размербуфера");
      _оРастягиваниеБуфера = new NumberInput(
        "чРастягиваниеБуфера",
        0.5,
        1,
        "растягиваниебуфера"
      );
      _оДлительностьПовтора = new NumberInput(
        "чДлительностьПовтора2",
        30,
        0,
        "длительностьповтора"
      );
      _оНачалоВоспроизведения.AfterChange =
        _оРазмерБуфера.AfterChange =
        _оРастягиваниеБуфера.AfterChange =
        m_Statistics.ClearHistory;
      _оИнтервалАвтоскрытия = new NumberInput(
        "чИнтервалАвтоскрытия",
        0.5,
        1,
        "интервалавтоскрытия"
      );
    }
  }
  function ОбработатьОткрытиеГлавногоМеню() {
    const элПункт = GetNode("адресзаписи");
    const sAddress = м_Twitch.ПолучитьАдресЗаписиДляТекущейПозиции();
    if (sAddress) {
      элПункт.href = sAddress;
      м_Меню.setItemAvailability(элПункт, true);
    } else {
      элПункт.removeAttribute("href");
      м_Меню.setItemAvailability(элПункт, false);
    }
  }
  function ОбработатьПаузу(bPause) {
    ChangeButton("переключитьпаузу", bPause);
  }
  function ОбработатьИзменениеПредустановкиБуферизации() {
    ОбновитьОкноНастроек();
    m_Statistics.ClearHistory();
  }
  function получитьСкоростьПовтора() {
    const узСкорость = GetNode("скорость");
    if (узСкорость.options[0].text === "") {
      for (const node of узСкорость.options) {
        node.text = node.defaultSelected
          ? "1x"
          : m_i18n.FormatNumber(node.value, 2);
      }
    }
    const чСкорость = Number.parseFloat(узСкорость.value);
    Check(чСкорость > 0);
    return чСкорость;
  }
  function задатьСкоростьПовтора(nCode) {
    const узСкорость = GetNode("скорость");
    if (!Number.isSafeInteger(nCode)) {
      Check(
        узСкорость.selectedIndex >= 0 &&
        (nCode === -Infinity || nCode === Infinity)
      );
      nCode = узСкорость.selectedIndex + Math.sign(nCode);
    }
    if (nCode >= 0 && nCode < узСкорость.options.length) {
      узСкорость.selectedIndex = nCode;
      m_Player.SetReplaySpeed(получитьСкоростьПовтора());
    }
  }
  const ОбработатьИзменениеСкоростиВоспроизведения =
    AddExceptionHandler((oEvent) => {
      if (_чСостояние === STATE_REPEAT) {
        m_Player.SetReplaySpeed(получитьСкоростьПовтора());
      }
    });
  const ОбработатьИзменениеВариантаТрансляции = AddExceptionHandler(
    ({ target: { selectedIndex } }) => {
      if (selectedIndex !== -1) {
        m_Log.Окак(`[Управление] Выбран вариант ${selectedIndex}`);
        м_Список.ИзменитьВариантТрансляции(selectedIndex);
      }
    }
  );
  const ОбработатьИзменениеГромкостиКолесом = AddExceptionHandler(
    (oEvent) => {
      if (oEvent.target.value) {
        m_Settings.Change("лМенятьГромкостьКолесом", true);
        m_Settings.Change(
          "чШагИзмененияГромкостиКолесом",
          Number(oEvent.target.value)
        );
      } else {
        m_Settings.Change("лМенятьГромкостьКолесом", false);
      }
      запуститьИзменениеГромкостиКолесом();
    }
  );
  const ОбработатьИзменениеАдресаЧата = AddExceptionHandler(
    (oEvent) => {
      m_Log.Окак(
        `[Управление] Выбран адрес чата ${oEvent.target.selectedIndex}`
      );
      switch (oEvent.target.selectedIndex) {
        case 0:
          m_Settings.Change("лПолноценныйЧат", true);
          break;

        case 1:
          m_Settings.Change("лПолноценныйЧат", false);
          m_Settings.Change("лЗатемнитьЧат", false);
          break;

        case 2:
          m_Settings.Change("лПолноценныйЧат", false);
          m_Settings.Change("лЗатемнитьЧат", true);
          break;

        default:
          Check(false);
      }
      м_Чат.ПрименитьАдрес();
    }
  );
  const ОбработатьВыборФайлаДляИмпортаНастроек = AddExceptionHandler(
    (oEvent) => {
      if (oEvent.target.files.length === 1) {
        m_Settings.Import(oEvent.target.files[0]);
      }
    }
  );
  function ОбновитьСписокВариантовТрансляции([moVariants, oSelectedVariant]) {
    const nodeList = GetNode("варианттрансляции");
    nodeList.length = 0;
    if (moVariants) {
      for (const oVariant of moVariants) {
        let sLabel = oVariant.sLabel;
        if (sLabel === "audio_only") {
          sLabel = GetText("J0144");
        } else if (sLabel.endsWith("(source)")) {
          sLabel = sLabel.slice(0, -8) + GetText("J0139");
        }
        nodeList.add(
          new Option(
            sLabel,
            void 0,
            oVariant === oSelectedVariant,
            oVariant === oSelectedVariant
          )
        );
      }
    }
    nodeList.disabled = nodeList.length < 2;
  }
  function обработатьНачалоРекламы() {
    document.body.classList.add("реклама");
  }
  function обработатьКонецРекламы() {
    document.body.classList.remove("реклама");
  }
  function обработатьПереполнениеБуфера() {
    m_Notification.Show("svg-cut", true);
  }
  function Start() {
    Check(_чСостояние === void 0);
    GetNode("названиетрансляции").href = м_Twitch.GetChannelUrl(true);
    const узГромкость = GetNode("громкость");
    узГромкость.min = MIN_VOLUME;
    узГромкость.addEventListener("input", ОбработатьИзменениеГромкости);
    ОбновитьГромкость();
    ОбновитьОкноНастроек();
    m_Settings.ConfigurePresetLists();
    м_Автоскрытие.Start();
    м_Автоскрытие.Show();
    м_Новости.Start();
    м_Чат.Restore();
    m_Events.AddHandler(
      "окно-открыто-главноеменю",
      ОбработатьОткрытиеГлавногоМеню
    );
    m_Events.AddHandler(
      "список-выбранварианттрансляции",
      ОбновитьСписокВариантовТрансляции
    );
    m_Events.AddHandler(
      "список-началорекламы",
      обработатьНачалоРекламы
    );
    m_Events.AddHandler("список-конецрекламы", обработатьКонецРекламы);
    m_Events.AddHandler(
      "проигрыватель-переполненбуфер",
      обработатьПереполнениеБуфера
    );
    m_Events.AddHandler("проигрыватель-пауза", ОбработатьПаузу);
    m_Events.AddHandler(
      "настройки-измениласьпредустановка-буферизация",
      ОбработатьИзменениеПредустановкиБуферизации
    );
    m_Events.AddHandler(
      "twitch-полученыметаданныеканала",
      ПоказатьМетаданныеКанала
    );
    m_Events.AddHandler(
      "twitch-полученыметаданныезрителя",
      ПоказатьМетаданныеЗрителя
    );
    m_Events.AddHandler(
      "twitch-полученыметаданныетрансляции",
      ПоказатьМетаданныеТрансляции
    );
    document.documentElement.addEventListener("click", ОбработатьЛевыйЩелчок);
    document.addEventListener("keydown", ОбработатьНажатиеИОтпусканиеКлавы);
    document.addEventListener("keyup", ОбработатьНажатиеИОтпусканиеКлавы);
    GetNode("скорость").addEventListener(
      "change",
      ОбработатьИзменениеСкоростиВоспроизведения
    );
    GetNode("варианттрансляции").addEventListener(
      "change",
      ОбработатьИзменениеВариантаТрансляции
    );
    GetNode("менятьгромкостьколесом").addEventListener(
      "change",
      ОбработатьИзменениеГромкостиКолесом
    );
    GetNode("адресчата").addEventListener("change", ОбработатьИзменениеАдресаЧата);
    GetNode("выборфайладляимпортанастроек").addEventListener(
      "change",
      ОбработатьВыборФайлаДляИмпортаНастроек
    );
    запуститьИзменениеГромкостиКолесом();
    ChangeState(STATE_START);
    ПрименитьМасштабированиеИзображения();
    ПрименитьАнимациюИнтерфейса();
    м_Оформление.Start();
  }
  function ChangeState(nNewState) {
    Check(Number.isInteger(nNewState));
    if (_чСостояние === nNewState) {
      return;
    }
    m_Log.Вот(
      `[Управление] Состояние трансляции изменилось с ${_чСостояние} на ${nNewState}`
    );
    _чСостояние = nNewState;
    document.body.setAttribute("data-состояние", nNewState);
    ChangeButton(
      "переключитьтрансляцию",
      nNewState === STATE_STOP ||
      nNewState === STATE_REPEAT
    );
    m_Events.SendEvent("управление-изменилосьсостояние", nNewState);
    switch (nNewState) {
      case STATE_START:
        ПоказатьМетаданныеТрансляции({
          sBroadcastType: null,
          sBroadcastTitle: НАЗВАНИЕ_ТРАНСЛЯЦИИ_НЕИЗВЕСТНО,
          sGameName: null,
          sGameUrl: null,
          kViewers: null,
          nBroadcastDuration: null,
        });
        м_Twitch.FinishCollectingBroadcastMetadata(true);
        break;

      case STATE_BROADCAST_START:
        ПоказатьМетаданныеТрансляции({
          sBroadcastType: null,
          sBroadcastTitle: НАЗВАНИЕ_ТРАНСЛЯЦИИ_НЕИЗВЕСТНО,
          sGameName: null,
          sGameUrl: null,
          kViewers: null,
          nBroadcastDuration: null,
        });
        м_Twitch.НачатьСборМетаданныхТрансляции();
        break;

      case STATE_BROADCAST_END:
        ПоказатьМетаданныеТрансляции({
          sBroadcastType: "завершена",
          kViewers: null,
          nBroadcastDuration: null,
        });
        м_Twitch.FinishCollectingBroadcastMetadata(true);
        GetNode("статистика-задержкатрансляции").textContent = "";
        break;

      case STATE_LOADING:
      case STATE_PLAYBACK_START:
      case STATE_PLAYING:
        break;

      case STATE_STOP:
      case STATE_REPEAT:
        ПоказатьМетаданныеТрансляции({
          kViewers: null,
        });
        м_Twitch.FinishCollectingBroadcastMetadata(false);
        GetNode("статистика-задержкатрансляции").textContent = "";
        break;

      default:
        Check(false);
    }
  }
  function GetState() {
    Check(_чСостояние !== void 0);
    return _чСостояние;
  }
  function ПоказатьМетаданныеКанала(oMetadata) {
    if (oMetadata.sName !== void 0) {
      ChangeDocumentTitle(
        `${oMetadata.sName} - Alternate Player for Twitch.tv`
      );
      GetNode("канал-имя").textContent = oMetadata.sName;
    }
    if (oMetadata.sAvatar !== void 0) {
      Check(oMetadata.sAvatar);
      GetNode("канал-аватар").src = oMetadata.sAvatar;
    }
    if (oMetadata.sDescription !== void 0) {
      GetNode("канал-описание").textContent = oMetadata.sDescription || "";
    }
    if (oMetadata.sLanguageCode !== void 0) {
      const node = GetNode("канал-язык");
      if (oMetadata.sLanguageCode) {
        node.textContent = m_i18n.GetLanguageName(oMetadata.sLanguageCode);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.kSubscribers !== void 0) {
      const node = GetNode("канал-подписчиков");
      if (Number.isFinite(oMetadata.kSubscribers)) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kSubscribers);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.nChannelCreated !== void 0) {
      const node = GetNode("канал-создан");
      if (Number.isFinite(oMetadata.nChannelCreated)) {
        node.textContent = m_i18n.FormatDate(oMetadata.nChannelCreated);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.moTeams !== void 0) {
      ПоказатьМассивСсылок(oMetadata.moTeams, "канал-команды");
    }
  }
  function ПоказатьМассивСсылок(моСсылки, пВставить) {
    const узВставить = GetNode(пВставить);
    if (моСсылки.length === 0) {
      ShowElement(узВставить.parentNode, false);
    } else {
      const оФрагмент = document.createDocumentFragment();
      for (let оСсылка, idx = 0; (оСсылка = моСсылки[idx]); ++idx) {
        if (idx !== 0) {
          оФрагмент.appendChild(document.createTextNode(", "));
        }
        Check(
          IsNonEmptyString(оСсылка.sAddress) && IsNonEmptyString(оСсылка.sName)
        );
        const nodeLink = document.createElement("a");
        nodeLink.href = оСсылка.sAddress;
        nodeLink.rel = "noopener noreferrer";
        nodeLink.target = "_blank";
        if (оСсылка.sDescription) {
          nodeLink.className = "канал-ссылка";
          nodeLink.title = оСсылка.sDescription;
        }
        nodeLink.textContent = оСсылка.sName;
        оФрагмент.appendChild(nodeLink);
      }
      узВставить.textContent = "";
      узВставить.appendChild(оФрагмент);
      ShowElement(узВставить.parentNode, true);
    }
  }
  function ПоказатьМетаданныеЗрителя(oMetadata) {
    if (oMetadata.sName !== void 0) {
      if (oMetadata.sName !== "") {
        GetNode("зритель-имя").textContent = oMetadata.sName;
      } else {
        m_i18n.InsertAdjacentHtmlMessage("зритель-имя", "content", "F0590");
      }
    }
    if (oMetadata.nSubscription !== void 0) {
      const node = GetNode("зритель-подписка");
      if (oMetadata.nSubscription === SUBSCRIPTION_UPDATING) {
        node.classList.add("обновляется");
      } else {
        node.classList.remove("обновляется");
        node.setAttribute("data-подписка", oMetadata.nSubscription);
        GetNode("зритель-уведомлять").checked =
          oMetadata.nSubscription === SUBSCRIPTION_NOTIFY;
      }
    }
  }
  const _оТипыТрансляции = {
    завершена: ["J0145", "J0100", false],
    прямая: ["J0146", "J0149", true],
    повтор: ["J0147", "J0150", false],
  };
  function ПоказатьМетаданныеТрансляции(oMetadata) {
    if (oMetadata.sBroadcastType !== void 0) {
      const node = GetNode("типтрансляции");
      if (typeof oMetadata.sBroadcastType == "string") {
        Check(_оТипыТрансляции.hasOwnProperty(oMetadata.sBroadcastType));
        node.textContent = GetText(_оТипыТрансляции[oMetadata.sBroadcastType][0]);
        node.parentElement.title = GetText(
          _оТипыТрансляции[oMetadata.sBroadcastType][1]
        );
        node.classList.toggle(
          "прямаятрансляция",
          _оТипыТрансляции[oMetadata.sBroadcastType][2]
        );
        ShowElement(node.parentElement, true);
      } else {
        ShowElement(node.parentElement, false);
      }
      м_Медиазапрос.updateQuickly();
    }
    if (oMetadata.sBroadcastTitle !== void 0) {
      Check(oMetadata.sBroadcastTitle !== null);
      const node = GetNode("названиетрансляции");
      node.title = oMetadata.sBroadcastTitle + GetText("J0101");
      node.textContent = oMetadata.sBroadcastTitle;
      м_Медиазапрос.updateQuickly();
    }
    if (oMetadata.sGameName !== void 0) {
      const node = GetNode("категориятрансляции");
      if (oMetadata.sGameName) {
        node.textContent = oMetadata.sGameName;
        node.title = node.previousElementSibling.title =
          oMetadata.sGameName + GetText("J0102");
        if (oMetadata.sGameUrl) {
          node.href = oMetadata.sGameUrl;
        } else {
          node.removeAttribute("href");
        }
        ShowElement(node, true);
        ShowElement(node.previousElementSibling, true);
      } else {
        ShowElement(node, false);
        ShowElement(node.previousElementSibling, false);
      }
      м_Медиазапрос.updateQuickly();
    }
    if (oMetadata.kViewers !== void 0) {
      const node = GetNode("количествозрителей");
      if (
        Number.isFinite(oMetadata.kViewers) &&
        oMetadata.kViewers >= 0
      ) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kViewers);
        ShowElement(node, true);
        ShowElement(node.previousElementSibling, true);
      } else {
        ShowElement(node, false);
        ShowElement(node.previousElementSibling, false);
      }
      м_Медиазапрос.updateQuickly();
    }
    if (oMetadata.nBroadcastDuration !== void 0) {
      GetNode("позиция").textContent =
        Number.isFinite(oMetadata.nBroadcastDuration) &&
          oMetadata.nBroadcastDuration >= 0
          ? m_i18n.SecondsToString(
            oMetadata.nBroadcastDuration / 1e3,
            false
          )
          : "";
    }
  }
  return {
    Start,
    GetState,
    ChangeState,
    получитьСкоростьПовтора,
    ОбновитьКоличествоДорожек,
    StopWatchingBroadcast,
  };
})();

const м_Чат = (() => {
  let _узЧат = null;
  //! <iframe>
  function ПолучитьПоложениеПанели() {
    switch (
    getComputedStyle(document.getElementById("проигрывательичат"))
      .flexDirection
    ) {
      case "column-reverse":
        return TOP_SIDE;

      case "row":
        return RIGHT_SIDE;

      case "column":
        return BOTTOM_SIDE;

      case "row-reverse":
        return LEFT_SIDE;

      default:
        Check(false);
    }
  }
  function ВставитьПанель() {
    if (_узЧат) {
      return;
    }
    const sAddress = м_Twitch.открытьЧат();
    m_Log.Вот(`[Чат] Вставляю iframe ${sAddress}`);
    _узЧат = document.createElement("iframe");
    _узЧат.src = sAddress;
    _узЧат.id = "чат";
    _узЧат.width = m_Settings.Get("чШиринаПанелиЧата");
    _узЧат.height = m_Settings.Get("чВысотаПанелиЧата");
    GetNode("размерчата").insertAdjacentElement("afterend", _узЧат);
  }
  function УдалитьПанель() {
    if (_узЧат) {
      m_Log.Вот(`[Чат] Удаляю iframe ${_узЧат.src}`);
      м_Twitch.закрытьЧат();
      _узЧат.remove();
      _узЧат = null;
    }
  }
  function ПрименитьАдрес() {
    if (_узЧат) {
      m_Log.Окак("[Чат] Меняю адрес iframe");
      УдалитьПанель();
      ВставитьПанель();
    }
  }
  function ПрименитьСостояниеПанели() {
    const nState = m_Settings.Get("чСостояниеЧата");
    m_Log.Окак(`[Чат] Новое состояние панели: ${nState}`);
    ОтменитьПеретаскиваниеПанели();
    switch (nState) {
      case CHAT_UNLOADED:
        document.body.classList.add("скрытьчат");
        УдалитьПанель();
        break;

      case CHAT_HIDDEN:
        ВставитьПанель();
        document.body.classList.add("скрытьчат");
        break;

      case CHAT_PANEL:
        ВставитьПанель();
        document.body.classList.remove("скрытьчат");
        break;

      default:
        Check(false);
    }
    м_Медиазапрос.updateSlowly();
  }
  function ApplyPanelPosition() {
    ОтменитьПеретаскиваниеПанели();
    const оКлассы = document.body.classList;
    if (m_Settings.Get("лАвтоПоложениеЧата")) {
      оКлассы.add("автоположениечата");
      оКлассы.toggle(
        "чатвверху",
        m_Settings.Get("чВертикальноеПоложениеЧата") === TOP_SIDE
      );
      оКлассы.toggle(
        "чатслева",
        m_Settings.Get("чГоризонтальноеПоложениеЧата") === LEFT_SIDE
      );
    } else {
      const nPosition = m_Settings.Get("чПоложениеПанелиЧата");
      оКлассы.remove("автоположениечата");
      оКлассы.toggle("чатвверху", nPosition === TOP_SIDE);
      оКлассы.toggle("чатсправа", nPosition === RIGHT_SIDE);
      оКлассы.toggle("чатвнизу", nPosition === BOTTOM_SIDE);
      оКлассы.toggle("чатслева", nPosition === LEFT_SIDE);
    }
    м_Медиазапрос.updateSlowly();
  }
  function СохранитьИПрименитьСостояниеЗакрытойПанели(nNewState) {
    m_Settings.Change("чСостояниеЗакрытогоЧата", nNewState);
    const nState = m_Settings.Get("чСостояниеЧата");
    if (
      (nState === CHAT_UNLOADED || nState === CHAT_HIDDEN) &&
      nState !== nNewState
    ) {
      m_Settings.Change("чСостояниеЧата", nNewState);
      ПрименитьСостояниеПанели();
    }
  }
  function TogglePanelState() {
    const лПолноэкранныйРежим = m_FullscreenMode.Включен();
    switch (m_Settings.Get("чСостояниеЧата")) {
      case CHAT_UNLOADED:
      case CHAT_HIDDEN:
        m_Settings.Change("чСостояниеЧата", CHAT_PANEL, лПолноэкранныйРежим);
        break;

      case CHAT_PANEL:
        m_Settings.Change(
          "чСостояниеЧата",
          лПолноэкранныйРежим
            ? CHAT_HIDDEN
            : m_Settings.Get("чСостояниеЗакрытогоЧата"),
          лПолноэкранныйРежим
        );
        break;

      default:
        Check(false);
    }
    ПрименитьСостояниеПанели();
  }
  function ПереключитьПоложениеПанели() {
    if (m_Settings.Get("чСостояниеЧата") !== CHAT_PANEL) {
      return;
    }
    let nPosition;
    if (m_Settings.Get("лАвтоПоложениеЧата")) {
      m_Settings.Change("лАвтоПоложениеЧата", false);
      nPosition = ПолучитьПоложениеПанели();
    } else {
      nPosition = m_Settings.Get("чПоложениеПанелиЧата");
    }
    switch (nPosition) {
      case TOP_SIDE:
        m_Settings.Change("чПоложениеПанелиЧата", RIGHT_SIDE);
        break;

      case RIGHT_SIDE:
        m_Settings.Change("чПоложениеПанелиЧата", BOTTOM_SIDE);
        break;

      case BOTTOM_SIDE:
        m_Settings.Change("чПоложениеПанелиЧата", LEFT_SIDE);
        break;

      case LEFT_SIDE:
        m_Settings.Change("чПоложениеПанелиЧата", TOP_SIDE);
        break;

      default:
        Check(false);
    }
    ApplyPanelPosition();
  }
  function ОбработатьПеретаскиваниеПанели(oParameters) {
    if (oParameters.лОтмена) {
      return;
    }
    const nPosition = ПолучитьПоложениеПанели();
    if (
      oParameters.nStep !== 1 &&
      oParameters._чНачальноеПоложение !== nPosition
    ) {
      m_Log.Ой(
        `[Чат] Положение перетаскиваемой панели изменилось с ${oParameters._чНачальноеПоложение} на ${nPosition}`
      );
      ОтменитьПеретаскиваниеПанели();
      return;
    }
    switch (oParameters.nStep) {
      case 1:
        oParameters._чНачальноеПоложение = nPosition;
        if (nPosition === RIGHT_SIDE || nPosition === LEFT_SIDE) {
          oParameters._nInitialSize = Number.parseInt(
            getComputedStyle(_узЧат).width,
            10
          );
        } else {
          oParameters._nInitialSize = Number.parseInt(
            getComputedStyle(_узЧат).height,
            10
          );
        }
        break;

      case 2:
        if (nPosition === RIGHT_SIDE || nPosition === LEFT_SIDE) {
          if (oParameters.bChangedX) {
            const чМаксРазмер =
              Number.parseInt(
                getComputedStyle(GetNode("проигрывательичат")).width,
                10
              ) -
              Number.parseInt(
                getComputedStyle(GetNode("проигрыватель")).minWidth,
                10
              );
            _узЧат.width = Math.max(
              Math.min(
                nPosition === LEFT_SIDE
                  ? oParameters._nInitialSize + oParameters.nDeltaX
                  : oParameters._nInitialSize - oParameters.nDeltaX,
                чМаксРазмер
              ),
              0
            );
            м_Медиазапрос.updateSlowly();
          }
        } else if (oParameters.bChangedY) {
          const чМаксРазмер =
            Number.parseInt(
              getComputedStyle(GetNode("проигрывательичат")).height,
              10
            ) -
            Number.parseInt(
              getComputedStyle(GetNode("проигрыватель")).minHeight,
              10
            );
          _узЧат.height = Math.max(
            Math.min(
              nPosition === TOP_SIDE
                ? oParameters._nInitialSize + oParameters.nDeltaY
                : oParameters._nInitialSize - oParameters.nDeltaY,
              чМаксРазмер
            ),
            0
          );
          м_Медиазапрос.updateSlowly();
        }
        break;

      case 3:
        if (nPosition === RIGHT_SIDE || nPosition === LEFT_SIDE) {
          m_Settings.Change(
            "чШиринаПанелиЧата",
            Number.parseInt(getComputedStyle(_узЧат).width, 10)
          );
        } else {
          m_Settings.Change(
            "чВысотаПанелиЧата",
            Number.parseInt(getComputedStyle(_узЧат).height, 10)
          );
        }
        break;

      default:
        Check(false);
    }
  }
  function ОтменитьПеретаскиваниеПанели() {
    м_Тащилка.ОтменитьПеретаскивание("размерчата");
  }
  ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode = -1;
  function ОбработатьИзменениеПолноэкранногоРежима(лВключен) {
    if (лВключен) {
      if (
        ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode === -1
      ) {
        ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode =
          m_Settings.Get("чСостояниеЧата");
        if (
          ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode ===
          CHAT_PANEL
        ) {
          m_Settings.Change("чСостояниеЧата", CHAT_HIDDEN, true);
          ПрименитьСостояниеПанели();
        }
      }
    } else if (
      ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode !== -1
    ) {
      if (
        ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode ===
        CHAT_PANEL
      ) {
        m_Settings.Change("чСостояниеЧата", CHAT_PANEL);
        ПрименитьСостояниеПанели();
      } else if (
        m_Settings.Get("чСостояниеЧата") === CHAT_HIDDEN &&
        m_Settings.Get("чСостояниеЗакрытогоЧата") === CHAT_UNLOADED
      ) {
        m_Settings.Change("чСостояниеЧата", CHAT_UNLOADED);
        ПрименитьСостояниеПанели();
      }
      ОбработатьИзменениеПолноэкранногоРежима.nStateInNormalMode = -1;
    }
  }
  function Restore() {
    ПрименитьСостояниеПанели();
    ApplyPanelPosition();
    m_Events.AddHandler(
      "тащилка-перетаскивание-размерчата",
      ОбработатьПеретаскиваниеПанели
    );
    m_Events.AddHandler(
      "полноэкранныйрежим-изменен",
      ОбработатьИзменениеПолноэкранногоРежима
    );
  }
  return {
    Restore,
    ApplyPanelPosition,
    ПрименитьАдрес,
    СохранитьИПрименитьСостояниеЗакрытойПанели,
    TogglePanelState,
    ПереключитьПоложениеПанели,
  };
})();

const м_Аудиоустройство = (() => {
  const УСТРОЙСТВО_ПО_УМОЛЧАНИЮ = "default";
  const УСТРОЙСТВО_ДЛЯ_ОБЩЕНИЯ = "communications";
  let _oMediaElement = null;
  function обновитьСписокУстройствИВыбратьУстройство() {
    const узСписокУстройств = GetNode("аудиоустройства-список");
    m_Log.Окак("[Аудиоустройства] Получаю список медиаустройств");
    navigator.mediaDevices
      .enumerateDevices()
      .then(
        (моМедиаустройства) => {
          if (!Array.isArray(моМедиаустройства)) {
            m_Log.Ой("[Аудиоустройства] Список аудиоустройств недоступен");
            ShowElement("аудиоустройства", false);
            return;
          }
          узСписокУстройств.length = 0;
          m_Log.Вот(
            `[Аудиоустройства] Текущее устройство ${_oMediaElement.sinkId}`
          );
          const сТекущееУстройство =
            _oMediaElement.sinkId === УСТРОЙСТВО_ПО_УМОЛЧАНИЮ
              ? ""
              : _oMediaElement.sinkId;
          const сСохраненноеУстройство =
            m_Settings.Get("сИдАудиоустройства");
          let кУстройств = 0,
            кНастоящихУстройств = 0;
          let лЕстьУстройствоПоУмолчанию = false,
            лЕстьТекущееУстройство = сТекущееУстройство === "",
            лЕстьСохраненноеУстройство = сСохраненноеУстройство === "";
          for (const оМедиаустройство of моМедиаустройства) {
            m_Log.Вот(
              `[Аудиоустройства] Медиаустройство kind=${оМедиаустройство.kind} deviceId=${оМедиаустройство.deviceId} groupId=${оМедиаустройство.groupId} label=${оМедиаустройство.label}`
            );
            if (оМедиаустройство.kind === "audiooutput") {
              кУстройств++;
              if (оМедиаустройство.deviceId && оМедиаустройство.label) {
                кНастоящихУстройств +=
                  оМедиаустройство.deviceId !== УСТРОЙСТВО_ПО_УМОЛЧАНИЮ &&
                  оМедиаустройство.deviceId !== УСТРОЙСТВО_ДЛЯ_ОБЩЕНИЯ;
                лЕстьУстройствоПоУмолчанию =
                  лЕстьУстройствоПоУмолчанию ||
                  оМедиаустройство.deviceId === УСТРОЙСТВО_ПО_УМОЛЧАНИЮ;
                лЕстьТекущееУстройство =
                  лЕстьТекущееУстройство ||
                  оМедиаустройство.deviceId === сТекущееУстройство;
                лЕстьСохраненноеУстройство =
                  лЕстьСохраненноеУстройство ||
                  оМедиаустройство.deviceId === сСохраненноеУстройство;
                узСписокУстройств.add(
                  new Option(
                    оМедиаустройство.label,
                    оМедиаустройство.deviceId === УСТРОЙСТВО_ПО_УМОЛЧАНИЮ
                      ? ""
                      : оМедиаустройство.deviceId
                  )
                );
              }
            }
          }
          if (кУстройств !== 0 && узСписокУстройств.length === 0) {
            if (
              getBrowserEngineVersion() <= 68 &&
              chrome.extension.inIncognitoContext
            ) {
              ShowElement("аудиоустройства", false);
            } else {
              ShowElement("аудиоустройства-доступ", true);
              ShowElement(узСписокУстройств, false);
              ShowElement("аудиоустройства", true);
              m_Events.AddHandler(
                "управление-левыйщелчок",
                обработатьЩелчокИПолучитьДоступКАудиоустройствам
              );
            }
          } else {
            if (!лЕстьУстройствоПоУмолчанию && узСписокУстройств.length !== 0) {
              узСписокУстройств.add(new Option("Default", ""), 0);
            }
            узСписокУстройств.value = сТекущееУстройство;
            узСписокУстройств.disabled = узСписокУстройств.length === 0;
            ShowElement("аудиоустройства-доступ", false);
            ShowElement(узСписокУстройств, true);
            if (кНастоящихУстройств > 1) {
              ShowElement("аудиоустройства", true);
              узСписокУстройств.addEventListener(
                "change",
                обработатьВыборУстройства
              );
            }
            let sSelect;
            if (
              лЕстьСохраненноеУстройство &&
              сСохраненноеУстройство !== сТекущееУстройство
            ) {
              sSelect = сСохраненноеУстройство;
            } else if (
              !лЕстьТекущееУстройство &&
              узСписокУстройств.length !== 0
            ) {
              sSelect = "";
            }
            if (sSelect !== void 0) {
              m_Log.Окак(`[Аудиоустройства] Выбираю устройство ${sSelect}`);
              return _oMediaElement.setSinkId(sSelect).then(
                () => {
                  m_Log.Вот("[Аудиоустройства] Устройство выбрано");
                  узСписокУстройств.value = sSelect;
                },
                (pReason) => {
                  m_Log.Ой(
                    `[Аудиоустройства] Не удалось выбрать устройство: ${pReason}`
                  );
                }
              );
            }
          }
        },
        (pReason) => {
          m_Log.Ой(
            `[Аудиоустройства] Не удалось получить список медиаустройств: ${pReason}`
          );
          узСписокУстройств.length = 0;
          узСписокУстройств.disabled = true;
        }
      )
      .catch(m_Debug.CaughtException);
  }
  function обработатьЩелчокИПолучитьДоступКАудиоустройствам({ сПозывной }) {
    if (сПозывной !== "аудиоустройства-доступ") {
      return;
    }
    m_Log.Окак("[Аудиоустройства] Запрашиваю разрешение contentSettings");
    chrome.permissions.request(
      {
        permissions: ["contentSettings"],
      },
      AddExceptionHandler((лРазрешениеПолучено) => {
        if (лРазрешениеПолучено) {
          m_Log.Окак("[Аудиоустройства] Получаю доступ к аудиоустройствам");
          chrome.contentSettings.microphone.set(
            {
              primaryPattern: `*://${chrome.runtime.id}/*`,
              setting: "allow",
              scope: chrome.extension.inIncognitoContext
                ? "incognito_session_only"
                : "regular",
            },
            AddExceptionHandler(() => {
              if (chrome.runtime.lastError) {
                m_Log.Ой(
                  `[Аудиоустройства] Доступ не получен: ${chrome.runtime.lastError.message}`
                );
                m_Notification.ShowAss();
              }
              обновитьСписокУстройствИВыбратьУстройство();
            })
          );
        } else {
          m_Log.Ой(
            `[Аудиоустройства] Разрешение не получено: ${chrome.runtime.lastError && chrome.runtime.lastError.message
            }`
          );
          m_Notification.ShowAss();
        }
      })
    );
  }
  const обработатьВыборУстройства = AddExceptionHandler((oEvent) => {
    if (oEvent.target.selectedIndex !== -1) {
      const sSelect = oEvent.target.value;
      m_Log.Окак(
        `[Аудиоустройства] Выбираю устройство ${sSelect} вместо ${_oMediaElement.sinkId}`
      );
      _oMediaElement
        .setSinkId(sSelect)
        .then(
          () => {
            m_Log.Вот("[Аудиоустройства] Устройство выбрано");
            m_Settings.Change("сИдАудиоустройства", sSelect);
          },
          (pReason) => {
            m_Log.Ой(
              `[Аудиоустройства] Не удалось выбрать устройство: ${pReason}`
            );
            m_Notification.ShowAss();
            обновитьСписокУстройствИВыбратьУстройство();
          }
        )
        .catch(m_Debug.CaughtException);
    }
  });
  function start(oMediaElement) {
    if (_oMediaElement) {
      return;
    }
    _oMediaElement = oMediaElement;
    if (!("setSinkId" in _oMediaElement)) {
      m_Log.Ой(
        "[Аудиоустройства] Браузер не поддерживает MediaElement.setSinkId"
      );
      return;
    }
    if (!("addEventListener" in navigator.mediaDevices)) {
      m_Log.Ой(
        "[Аудиоустройства] Браузер не поддерживает MediaDevices.ondevicechange"
      );
    } else {
      navigator.mediaDevices.addEventListener(
        "devicechange",
        AddExceptionHandler(обновитьСписокУстройствИВыбратьУстройство)
      );
    }
    обновитьСписокУстройствИВыбратьУстройство();
  }
  return {
    start,
  };
})();

const m_Player = (() => {
  const ИНТЕРВАЛ_УДАЛЕНИЯ_ВИДЕО = 10;
  const ИСЧЕРПАНИЕ_БУФЕРА = (1 / 25) * 7;
  const ПОВТОР_ДОСТУПЕН_ЕСЛИ_ПРОСМОТРЕНО = 1;
  const ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА = -1;
  const ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ = -2;
  const ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ = -3;
  const ПРОВЕРИТЬ_ОСТАНОВКА_ВОСПРОИЗВЕДЕНИЯ = -4;
  const ВОСПРОИЗВЕДЕНИЕ_НЕВОЗМОЖНО = 0;
  const ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО = 1;
  const ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО_ПОСЛЕ_ПЕРЕМОТКИ = 2;
  let _oMediaElement;
  let _oMediaSource;
  let _oMediaSourceBuffer = null;
  let _лЕстьВидеодорожка = false;
  let _чВоспроизведениеНачиналось = 0;
  let _лАсинхроннаяОперация = false;
  let _сРазмерБуфера = "чНачалоВоспроизведения";
  let _лЖдатьЗаполненияБуфера = true;
  let _чСмещениеТрансляции = NaN;
  let _лНужнаПеремотка = false;
  const _оПрямаяТрансляция = {
    ОбработатьSourceOpen() {
      Check(_oMediaElement.paused);
      _чВоспроизведениеНачиналось = Math.max(_чВоспроизведениеНачиналось, 1);
      AddNextSegment();
    },
    ОбработатьProgress() {
      if (!_лАсинхроннаяОперация) {
        НачатьВоспроизведение(
          CheckPlaybackPosition(ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА)
        );
      }
    },
    ОбработатьWaiting() { },
    ОбработатьPlaying() {
      if (
        м_Управление.GetState() === STATE_PLAYBACK_START &&
        !_oMediaElement.paused
      ) {
        м_Управление.ChangeState(STATE_PLAYING);
      }
    },
    ОбработатьSeeking: STUB,
    ОбработатьSeeked: НачатьВоспроизведение,
    ОбработатьEnded() {
      ПерезагрузитьПроигрыватель(STATE_LOADING);
    },
    ОбработатьTimeUpdate() {
      if (
        !_oMediaElement.seeking &&
        !_oMediaElement.paused &&
        !_oMediaElement.ended
      ) {
        CheckPlaybackPosition(ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ);
      }
    },
  };
  const _оПовтор = {
    bPause: true,
    ОбработатьSourceOpen() {
      Check(_oMediaElement.paused);
      _чВоспроизведениеНачиналось = Math.max(_чВоспроизведениеНачиналось, 1);
    },
    ОбработатьProgress: STUB,
    ОбработатьWaiting: STUB,
    ОбработатьPlaying: STUB,
    ОбработатьSeeked: STUB,
    ОбработатьSeeking() {
      м_Шкала.SetWatched(_oMediaElement.currentTime);
    },
    ОбработатьEnded() {
      if (!this.bPause) {
        _oMediaElement.play();
      }
    },
    ОбработатьTimeUpdate() {
      if (!this.bPause && !_oMediaElement.seeking) {
        this.CheckPlaybackPosition(ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ);
      }
      м_Шкала.SetWatched(_oMediaElement.currentTime);
    },
    CheckPlaybackPosition(nTime) {
      Check(Number.isFinite(nTime));
      Check(
        nTime === ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ ||
        nTime === ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ ||
        nTime >= 0
      );
      const oBuffer = _oMediaElement.buffered;
      const чПоследняяОбласть = oBuffer.length - 1;
      const nCurrentTime = _oMediaElement.currentTime + 1e-4;
      let nSeekTo = nTime >= 0 ? nTime : nCurrentTime;
      let сПричинаПеремотки = "";
      for (let лНачатьСначала = false; ;) {
        let чНужноДляВоспроизведения =
          nTime === ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ
            ? ИСЧЕРПАНИЕ_БУФЕРА
            : MIN_BUFFER_SIZE;
        for (let чОбласть = 0; чОбласть <= чПоследняяОбласть; ++чОбласть) {
          if (nSeekTo < oBuffer.start(чОбласть)) {
            чНужноДляВоспроизведения = MIN_BUFFER_SIZE;
            сПричинаПеремотки += "Jumping over gap. ";
            nSeekTo = oBuffer.start(чОбласть);
          }
          if (
            oBuffer.end(чОбласть) - nSeekTo >=
            чНужноДляВоспроизведения
          ) {
            break;
          }
        }
        if (this.bPause || nSeekTo < м_Шкала.GetEnd()) {
          break;
        }
        if (лНачатьСначала) {
          ShowState("Ой", `Бесконечная перемотка Время=${nTime}`);
          return;
        }
        nSeekTo = м_Шкала.GetStart();
        сПричинаПеремотки += "Starting from beginning. ";
        лНачатьСначала = true;
      }
      if (nSeekTo !== nCurrentTime) {
        ShowState(
          "Окак",
          `${сПричинаПеремотки}Перематываю до ${nSeekTo}`
        );
        _oMediaElement.currentTime = nSeekTo;
      }
    },
  };
  let _оПоведение = _оПрямаяТрансляция;
  function ShowState(sImportance, sRecord) {
    const oBuffer =
      _oMediaSource.sourceBuffers.length !== 0
        ? _oMediaSource.sourceBuffers[0]
        : null;
    const сОбластиБуфера = ПеревестиОбластиВСтроку(
      oBuffer ? oBuffer.buffered : null
    );
    const сОбласти = ПеревестиОбластиВСтроку(_oMediaElement.buffered);
    const лОбластиРавны = сОбластиБуфера === сОбласти;
    if (
      sImportance === "Вот" &&
      ((oBuffer && oBuffer.buffered.length > 1) ||
        _oMediaElement.buffered.length > 1)
    ) {
      sImportance = "Окак";
    }
    if (_oMediaElement.error || !лОбластиРавны) {
      sImportance = "Ой";
    }
    m_Log[sImportance](
      `${sRecord.charAt(0) === "[" ? "" : "[Проигрыватель] "}${sRecord} •••` +
      (oBuffer && oBuffer.updating ? " [U]" : "") +
      (_oMediaElement.paused ? " [P]" : "") +
      (_oMediaElement.seeking ? " [S]" : "") +
      (_oMediaElement.ended ? " [E]" : "") +
      (_oMediaElement.error ? ` error=${_oMediaElement.error.code}` : "") +
      (_oMediaElement.src.startsWith("blob:") ||
        _oMediaElement.src.startsWith("mediasource:")
        ? ""
        : ` src=${_oMediaElement.src}`) +
      (_oMediaSource.readyState === "open"
        ? ""
        : ` MSE.readyState=${_oMediaSource.readyState}`) +
      (_oMediaSource.sourceBuffers.length === 1
        ? ""
        : ` MSE.buffers=${_oMediaSource.sourceBuffers.length}`) +
      (_oMediaElement.networkState === HTMLMediaElement.NETWORK_LOADING
        ? ""
        : ` networkState=${_oMediaElement.networkState}`) +
      ` readyState=${_oMediaElement.readyState}` +
      ` currentTime=${_oMediaElement.currentTime}` +
      (лОбластиРавны
        ? ` buffered=${сОбласти}`
        : ` MSE.buffered=${сОбластиБуфера} buffered=${сОбласти}`) +
      (_oMediaElement.duration === Infinity
        ? ""
        : ` duration=${_oMediaElement.duration}`) +
      ` seekable=${ПеревестиОбластиВСтроку(_oMediaElement.seekable)}` +
      ` played=${ПеревестиОбластиВСтроку(_oMediaElement.played)}`
    );
  }
  function ПеревестиОбластиВСтроку(оОбласти) {
    let sResult = "";
    if (оОбласти && оОбласти.length !== 0) {
      let чОбласть = Math.max(оОбласти.length - 5, 0);
      if (чОбласть !== 0) {
        sResult = `[${чОбласть}]`;
      }
      for (; чОбласть < оОбласти.length; ++чОбласть) {
        if (чОбласть !== 0) {
          sResult += `(${(
            оОбласти.start(чОбласть) - оОбласти.end(чОбласть - 1)
          ).toFixed(3)})`;
        }
        sResult += `${оОбласти.start(чОбласть)}-${оОбласти.end(чОбласть)}`;
      }
    }
    return sResult;
  }
  function GetBufferFill(oBuffer = _oMediaElement.buffered) {
    let nWatched = 0;
    let nUnwatched = 0;
    if (oBuffer.length !== 0) {
      const чНачало = oBuffer.start(0);
      const чКонец = oBuffer.end(oBuffer.length - 1);
      const nCurrentTime = Clamp(
        _oMediaElement.currentTime,
        чНачало,
        чКонец
      );
      nWatched = nCurrentTime - чНачало;
      nUnwatched = чКонец - nCurrentTime;
    }
    return {
      nWatched,
      nUnwatched,
    };
  }
  function GetDroppedFrameCount() {
    return _oMediaElement.getVideoPlaybackQuality
      ? _oMediaElement.getVideoPlaybackQuality()
      : {
        totalVideoFrames: _oMediaElement.webkitDecodedFrameCount,
        droppedVideoFrames: _oMediaElement.webkitDroppedFrameCount,
      };
  }
  function GetBroadcastPlaybackPosition(лДляКлипа) {
    if (Number.isNaN(_чСмещениеТрансляции)) {
      return -1;
    }
    СледитьЗаОшибками();
    let чПозиция = _oMediaElement.currentTime;
    if (лДляКлипа && м_Управление.GetState() === STATE_REPEAT) {
      чПозиция = м_Шкала.GetEnd();
    }
    if (!лДляКлипа && чПозиция === 0 && _oMediaSourceBuffer !== null) {
      if (_oMediaSourceBuffer.buffered.length !== 0) {
        чПозиция = _oMediaSourceBuffer.buffered.start(0);
      }
    }
    return чПозиция === 0 ? -1 : Math.max(чПозиция + _чСмещениеТрансляции, 0);
  }
  function РасчитатьСмещениеТрансляции(oSegment) {
    if (
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.чПозицияТрансляции)
    ) {
      const чСмещениеТрансляции =
        oSegment.pData.чПозицияТрансляции -
        oSegment.pData.nEncodingPosition;
      m_Log[
        Math.abs(чСмещениеТрансляции - _чСмещениеТрансляции) > 2 ? "Ой" : "Вот"
      ](
        `[Проигрыватель] Смещение трансляции: ${m_Log.F1(
          чСмещениеТрансляции
        )}с`
      );
      _чСмещениеТрансляции = чСмещениеТрансляции;
    }
  }
  function ПоказатьЗадержкуТрансляции(oSegment) {
    if (
      m_Statistics.WindowOpened() &&
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.чВремяКодирования) &&
      _oMediaElement.currentTime !== 0
    ) {
      const чПолучение =
        (performance.now() +
          g_nExactTime -
          oSegment.pData.чВремяКодирования) /
        1e3;
      const чВоспроизведение =
        oSegment.pData.nEncodingPosition - _oMediaElement.currentTime;
      const сЗадержка = `${чПолучение.toFixed(1)} + ${чВоспроизведение.toFixed(
        1
      )} = ${(чПолучение + чВоспроизведение).toFixed(1)}`;
      m_Log[чПолучение > 0 && чВоспроизведение > -0.1 ? "Вот" : "Ой"](
        `[Проигрыватель] Задержка трансляции: ${сЗадержка}с`
      );
      GetNode("статистика-задержкатрансляции").textContent = сЗадержка;
    }
  }
  function ПрименитьГромкость() {
    _oMediaElement.volume =
      m_Settings.Get("чГромкость2") / MAX_VOLUME;
    _oMediaElement.muted = m_Settings.Get("лПриглушить");
  }
  function ПерезагрузитьИЖдатьЗаполненияБуфера(nNewState) {
    _лЖдатьЗаполненияБуфера = true;
    ПерезагрузитьПроигрыватель(nNewState);
  }
  function ПерезагрузитьПроигрыватель(nNewState) {
    ShowState("Окак", "Перезагрузка проигрывателя");
    м_Управление.ChangeState(nNewState);
    _оПоведение = _оПрямаяТрансляция;
    _oMediaSourceBuffer = null;
    _лНужнаПеремотка = false;
    подключитьMediaSourceКMediaElement();
  }
  function СледитьЗаОшибками() {
    if (_oMediaElement.error) {
      m_Debug.FinishWorkAndShowMessage("J0206");
    }
  }
  const СледитьЗаСобытиямиMediaSource = AddExceptionHandler(
    (oEvent) => {
      СледитьЗаОшибками();
      const sRecord = `[MediaSource] ${oEvent.type}`;
      switch (oEvent.type) {
        case "sourceopen":
          ShowState("Вот", sRecord);
          _оПоведение.ОбработатьSourceOpen();
          break;

        case "sourceended":
        case "sourceclose":
          ShowState("Вот", sRecord);
          break;

        default:
          m_Log.Вот(sRecord);
      }
    }
  );
  const СледитьЗаСобытиямиMediaElement = AddExceptionHandler(
    (oEvent) => {
      СледитьЗаОшибками();
      const sRecord = `[MediaElement] ${oEvent.type}`;
      switch (oEvent.type) {
        case "loadstart":
          ShowState(
            "Вот",
            `${sRecord} src=${_oMediaElement.src} currentSrc=${_oMediaElement.currentSrc}`
          );
          break;

        case "progress":
          ShowState("Вот", sRecord);
          _оПоведение.ОбработатьProgress();
          break;

        case "abort":
          ShowState("Вот", sRecord);
          break;

        case "waiting":
          ShowState("Окак", sRecord);
          _оПоведение.ОбработатьWaiting();
          break;

        case "playing":
          ShowState("Вот", sRecord);
          _оПоведение.ОбработатьPlaying();
          break;

        case "seeking":
          ShowState("Вот", sRecord);
          _оПоведение.ОбработатьSeeking();
          break;

        case "seeked":
          ShowState("Вот", sRecord);
          _оПоведение.ОбработатьSeeked();
          break;

        case "ended":
          ShowState("Вот", sRecord);
          _оПоведение.ОбработатьEnded();
          break;

        case "timeupdate":
          m_Log.Вот(
            `${sRecord} readyState=${_oMediaElement.readyState} currentTime=${_oMediaElement.currentTime
            } НеПросмотрено=${m_Log.F2(
              GetBufferFill().nUnwatched
            )}`
          );
          _оПоведение.ОбработатьTimeUpdate();
          break;

        default:
          m_Log.Вот(sRecord);
      }
    }
  );
  function CheckPlaybackPosition(
    чИсточникПроверки,
    чБудетДобавлено = 0
  ) {
    const oBuffer = _oMediaElement.buffered;
    const чПоследняяОбласть = oBuffer.length - 1;
    if (чПоследняяОбласть === -1) {
      return false;
    }
    const nCurrentTime = _oMediaElement.currentTime + 1e-4;
    let nSeekTo = Math.max(nCurrentTime, oBuffer.start(0));
    let сПричинаПеремотки = "";
    const nUnwatched = oBuffer.end(чПоследняяОбласть) - nSeekTo;
    if (чИсточникПроверки === ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА) {
      const чРазмерБуфера = m_Settings.Get("чМаксРазмерБуфера");
      const чПереполнение =
        чРазмерБуфера + m_Settings.Get("чРастягиваниеБуфера");
      if (nUnwatched <= чПереполнение) {
        return;
      }
      if (_чВоспроизведениеНачиналось === 2) {
        m_Events.SendEvent(
          "проигрыватель-переполненбуфер",
          nUnwatched - чРазмерБуфера
        );
      }
      сПричинаПеремотки += `Переполнен буфер проигрывателя ${nUnwatched.toFixed(
        2
      )}с > ${чПереполнение}с. `;
      nSeekTo = oBuffer.end(чПоследняяОбласть) - чРазмерБуфера - 0.1;
    }
    if (
      чИсточникПроверки === ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ &&
      _чВоспроизведениеНачиналось !== 2
    ) {
      _чВоспроизведениеНачиналось = 2;
      const чПереполнение =
        m_Settings.Get("чМаксРазмерБуфера") +
        m_Statistics.GetTargetDuration() / 2;
      if (nUnwatched > чПереполнение) {
        сПричинаПеремотки += `Превышена задержка трансляции ${nUnwatched.toFixed(
          2
        )}с > ${чПереполнение}с. `;
        nSeekTo = oBuffer.end(чПоследняяОбласть) - чПереполнение;
      }
    }
    Check(ИСЧЕРПАНИЕ_БУФЕРА < MIN_BUFFER_SIZE);
    let чНужноДляВоспроизведения =
      чИсточникПроверки === ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ
        ? ИСЧЕРПАНИЕ_БУФЕРА
        : чИсточникПроверки === ПРОВЕРИТЬ_ОСТАНОВКА_ВОСПРОИЗВЕДЕНИЯ
          ? Infinity
          : MIN_BUFFER_SIZE;
    let лВоспроизведениеВозможно = _oMediaSource.readyState === "ended";
    let чДоКонцаОбласти;
    for (let чОбласть = 0; чОбласть <= чПоследняяОбласть; ++чОбласть) {
      if (nSeekTo < oBuffer.start(чОбласть)) {
        чНужноДляВоспроизведения = MIN_BUFFER_SIZE;
        сПричинаПеремотки += "Jumping over gap. ";
        nSeekTo = oBuffer.start(чОбласть);
      }
      чДоКонцаОбласти = oBuffer.end(чОбласть) - nSeekTo;
      if (чДоКонцаОбласти >= чНужноДляВоспроизведения) {
        лВоспроизведениеВозможно = true;
        break;
      }
    }
    if (!лВоспроизведениеВозможно && !_oMediaElement.paused) {
      БуферИсчерпан(чДоКонцаОбласти, nUnwatched, чБудетДобавлено);
    }
    if (
      (лВоспроизведениеВозможно ||
        чИсточникПроверки === ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА) &&
      (nSeekTo !== nCurrentTime || _лНужнаПеремотка)
    ) {
      if (nSeekTo === nCurrentTime) {
        nSeekTo = _oMediaElement.currentTime;
      }
      ShowState(
        сПричинаПеремотки ? "Ой" : "Окак",
        `${сПричинаПеремотки}Перематываю до ${nSeekTo}`
      );
      _лНужнаПеремотка = false;
      _oMediaElement.currentTime = nSeekTo;
      return ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО_ПОСЛЕ_ПЕРЕМОТКИ;
    }
    return лВоспроизведениеВозможно
      ? ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО
      : ВОСПРОИЗВЕДЕНИЕ_НЕВОЗМОЖНО;
  }
  function НачатьВоспроизведение(чПроверка) {
    if (
      _oMediaElement.seeking ||
      чПроверка === ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО_ПОСЛЕ_ПЕРЕМОТКИ ||
      !_oMediaElement.paused ||
      _oMediaElement.ended
    ) {
      return;
    }
    if (_лЖдатьЗаполненияБуфера && _oMediaSource.readyState !== "ended") {
      const { nUnwatched } = GetBufferFill();
      const чРазмерБуфера = m_Settings.Get(_сРазмерБуфера);
      if (nUnwatched < чРазмерБуфера) {
        m_Log.Вот(
          `[Проигрыватель] В буфере не просмотрено ${m_Log.F3(
            nUnwatched
          )}с < ${чРазмерБуфера}с`
        );
        return;
      }
      m_Log.Окак(
        `[Проигрыватель] В буфере не просмотрено ${m_Log.F3(
          nUnwatched
        )}с >= ${чРазмерБуфера}с`
      );
    } else {
      m_Log.Окак("[Проигрыватель] Не нужно ждать заполнения буфера");
    }
    switch (CheckPlaybackPosition(ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ)) {
      case ВОСПРОИЗВЕДЕНИЕ_НЕВОЗМОЖНО:
        ShowState(
          "Ой",
          `Не найдена область >= ${MIN_BUFFER_SIZE}с для начала воспроизведения`
        );
        _лЖдатьЗаполненияБуфера = true;
        break;

      case ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО:
        ShowState("Окак", "Начало воспроизведения");
        _лЖдатьЗаполненияБуфера = true;
        _oMediaElement.play();
        м_Управление.ChangeState(STATE_PLAYBACK_START);
    }
  }
  function ОстановитьВоспроизведение(nNewState) {
    if (nNewState !== void 0) {
      м_Управление.ChangeState(nNewState);
    }
    _oMediaElement.pause();
  }
  function БуферИсчерпан(
    чДоКонцаПоследнейОбласти,
    nUnwatched,
    чБудетДобавлено
  ) {
    Check(_oMediaSource.readyState !== "ended");
    Check(чДоКонцаПоследнейОбласти < MIN_BUFFER_SIZE);
    const лДосрочно = nUnwatched > 1;
    m_Statistics.PlayerBufferExhausted(лДосрочно);
    _сРазмерБуфера = "чМаксРазмерБуфера";
    const чРазмерБуфера = m_Settings.Get(_сРазмерБуфера);
    if (
      чДоКонцаПоследнейОбласти + чБудетДобавлено >= MIN_BUFFER_SIZE &&
      nUnwatched + чБудетДобавлено >= чРазмерБуфера
    ) {
      ShowState(
        лДосрочно ? "Ой" : "Окак",
        `Буфер исчерпан, остановка не нужна БудетДобавлено=${m_Log.F3(
          чБудетДобавлено
        )}с ДоКонцаПоследнейОбласти=${m_Log.F3(
          чДоКонцаПоследнейОбласти
        )}с НеПросмотрено=${m_Log.F3(
          nUnwatched
        )}с РазмерБуфера=${чРазмерБуфера}с`
      );
    } else {
      ShowState(
        лДосрочно ? "Ой" : "Окак",
        `Приостанавливаю воспроизведение для заполнения буфера ДоКонцаПоследнейОбласти=${m_Log.F3(
          чДоКонцаПоследнейОбласти
        )}с НеПросмотрено=${m_Log.F3(
          nUnwatched
        )}с РазмерБуфера=${чРазмерБуфера}с`
      );
      _лНужнаПеремотка = true;
      ОстановитьВоспроизведение(STATE_LOADING);
    }
  }
  function ЗавершитьПоток(oSegment) {
    ShowState(
      "Окак",
      `Сегмент ${oSegment.nNumber} вызвал окончание потока`
    );
    if (
      _oMediaElement.buffered.length === 0 ||
      (_oMediaElement.paused &&
        GetBufferFill().nUnwatched < ИСЧЕРПАНИЕ_БУФЕРА + 0.1)
    ) {
      ПерезагрузитьИЖдатьЗаполненияБуфера(STATE_LOADING);
    } else {
      _лЖдатьЗаполненияБуфера =
        typeof oSegment.pData == "number" ||
        (!_oMediaElement.seeking && _oMediaElement.paused);
      _oMediaSource.endOfStream();
      НачатьВоспроизведение();
    }
  }
  function УдалитьПросмотренноеВидео(oSegment) {
    const МАКС_ДЛИТЕЛЬНОСТЬ_ПОВТОРА_ЗВУКА = 640;
    СледитьЗаОшибками();
    let чДлительностьПовтора = m_Settings.Get("чДлительностьПовтора2");
    if (чДлительностьПовтора === AUTO_SETTING) {
      if (_лЕстьВидеодорожка) {
        return Promise.resolve(oSegment);
      }
      чДлительностьПовтора = МАКС_ДЛИТЕЛЬНОСТЬ_ПОВТОРА_ЗВУКА;
    }
    const { nWatched } = GetBufferFill(
      _oMediaSourceBuffer.buffered
    );
    if (nWatched < чДлительностьПовтора + ИНТЕРВАЛ_УДАЛЕНИЯ_ВИДЕО) {
      return Promise.resolve(oSegment);
    }
    const чУдалитьДо = _oMediaElement.currentTime - чДлительностьПовтора;
    return new Promise((fResolve, fReject) => {
      ShowState(
        "Вот",
        `Удаляю просмотренное видео Просмотрено=${m_Log.F3(
          nWatched
        )}с УдалитьДо=${m_Log.F3(чУдалитьДо)}с`
      );
      _oMediaSourceBuffer.addEventListener("updateend", Удалено);
      let чПрошлоВремени = -performance.now();
      _oMediaSourceBuffer.remove(0, чУдалитьДо);
      function Удалено() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
          } else {
            чПрошлоВремени += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Удалено);
            const { nWatched } = GetBufferFill(
              _oMediaSourceBuffer.buffered
            );
            ShowState(
              чПрошлоВремени > 100 || nWatched < MIN_BUFFER_SIZE
                ? "Ой"
                : "Вот",
              `Просмотренное видео удалено за ${m_Log.F0(
                чПрошлоВремени
              )}мс Просмотрено=${m_Log.F0(nWatched)}с`
            );
            fResolve(oSegment);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function ДобавитьСегментИнициализации(oSegment) {
    return ДобавитьСегмент(
      oSegment,
      oSegment.pData.mbInitializationSegment,
      "сегмент инициализации"
    );
  }
  function ДобавитьМедиасегмент(oSegment) {
    return ДобавитьСегмент(
      oSegment,
      oSegment.pData.мбМедиасегмент,
      "медиасегмент"
    );
  }
  function ДобавитьСегмент(oSegment, мбДобавить, сДобавить) {
    СледитьЗаОшибками();
    return new Promise((fResolve, fReject) => {
      ShowState("Вот", `Добавляю ${сДобавить} ${oSegment.nNumber}`);
      _oMediaSourceBuffer.addEventListener("updateend", Добавлено);
      let чПрошлоВремени = -performance.now();
      _oMediaSourceBuffer.appendBuffer(мбДобавить);
      function Добавлено() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
          } else {
            чПрошлоВремени += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Добавлено);
            ShowState(
              чПрошлоВремени > 100 ? "Ой" : "Вот",
              `Добавлен ${сДобавить} ${oSegment.nNumber} за ${m_Log.F0(
                чПрошлоВремени
              )}мс`
            );
            fResolve(oSegment);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function ПроверитьИсчерпаниеБуфера(oSegment) {
    if (
      !_oMediaElement.seeking &&
      !_oMediaElement.paused &&
      !_oMediaElement.ended
    ) {
      CheckPlaybackPosition(
        ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ,
        oSegment.nDuration
      );
    }
    if (_oMediaElement.played.length !== 0) {
      m_Statistics.updateBufferFill(
        GetBufferFill().nUnwatched
      );
    }
    return oSegment;
  }
  function СегментБылДобавлен(oSegment) {
    _лАсинхроннаяОперация = false;
    g_maQueue.Remove(oSegment);
    РасчитатьСмещениеТрансляции(oSegment);
    if (!(g_maQueue[0] && g_maQueue[0].pData === STATE_REPEAT)) {
      const чПроверка = CheckPlaybackPosition(
        ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА
      );
      if (
        !(
          g_maQueue[0] && g_maQueue[0].nProcessing === PROCESSING_CONVERTED
        )
      ) {
        НачатьВоспроизведение(чПроверка);
        ПоказатьЗадержкуТрансляции(oSegment);
      }
    }
    AddNextSegment();
  }
  const СегментНеБылДобавлен = AddExceptionHandler((pReason) => {
    _лАсинхроннаяОперация = false;
    if (pReason === "ДОБАВЛЕНИЕ СЕГМЕНТА ОТЛОЖЕНО") {
      return;
    }
    if (pReason === PromiseCancellation.REASON) {
      m_Log.Вот("[Проигрыватель] Отменено добавление сегмента");
    } else {
      throw pReason;
    }
  });
  function ПредотвратитьПереполнениеОчереди() {
    const { nDuration } = g_maQueue.CountConvertedSegments();
    if (nDuration >= BUFFER_OVERFLOW) {
      m_Log.Ой(
        `[Проигрыватель] MediaSource закрыт слишком долго ${nDuration}с >= ${BUFFER_OVERFLOW}с`
      );
      Check(
        м_Управление.GetState() === STATE_START ||
        м_Управление.GetState() === STATE_BROADCAST_START
      );
      м_Управление.StopWatchingBroadcast();
    }
  }
  function НайтиИОбработатьСменуВариантаТрансляции() {
    for (let idx = g_maQueue.length; --idx >= 0;) {
      if (
        g_maQueue[idx].pData === STATE_VARIANT_CHANGE &&
        g_maQueue[idx].nProcessing === PROCESSING_CONVERTED
      ) {
        g_maQueue.ShowState();
        do {
          if (
            g_maQueue[idx].pData === STATE_VARIANT_CHANGE ||
            typeof g_maQueue[idx].pData != "number"
          ) {
            g_maQueue.Remove(idx);
          }
        } while (--idx >= 0);
        g_maQueue.ShowState();
        ПерезагрузитьИЖдатьЗаполненияБуфера(STATE_LOADING);
        break;
      }
    }
  }
  function AddNextSegment() {
    СледитьЗаОшибками();
    НайтиИОбработатьСменуВариантаТрансляции();
    const oSegment = g_maQueue[0];
    if (!oSegment || oSegment.nProcessing !== PROCESSING_CONVERTED) {
      return;
    }
    Check(_оПоведение === _оПрямаяТрансляция);
    if (oSegment.pData === STATE_BROADCAST_START) {
      Check(_oMediaSource.sourceBuffers.length === 0);
      _чСмещениеТрансляции = NaN;
      м_Управление.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_лАсинхроннаяОперация) {
      return;
    }
    if (oSegment.pData === STATE_REPEAT) {
      Check(
        м_Управление.GetState() !== STATE_STOP &&
        м_Управление.GetState() !== STATE_REPEAT
      );
      ЗапуститьПовтор();
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    const сГотовность = _oMediaSource.readyState;
    if (сГотовность !== "open") {
      m_Log.Вот(
        `[Проигрыватель] Добавление сегмента ${oSegment.nNumber} отложено MediaSource.readyState=${сГотовность} MediaElement.src=${_oMediaElement.src}`
      );
      if (сГотовность === "closed" && _чВоспроизведениеНачиналось === 0) {
        ПредотвратитьПереполнениеОчереди();
      }
      return;
    }
    if (oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length !== 0) {
      ЗавершитьПоток(oSegment);
      return;
    }
    if (oSegment.pData === STATE_BROADCAST_END) {
      Check(oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length === 0);
      м_Управление.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_oMediaSource.sourceBuffers.length === 0) {
      ДобавитьБуферы(oSegment);
      м_Управление.ОбновитьКоличествоДорожек(
        oSegment.pData.bHasVideo,
        oSegment.pData.bHasAudio
      );
    }
    _лАсинхроннаяОперация = true;
    let oPromise = УдалитьПросмотренноеВидео(oSegment).then(
      ПроверитьИсчерпаниеБуфера
    );
    if (oSegment.pData.mbInitializationSegment) {
      oPromise = oPromise.then(ДобавитьСегментИнициализации);
    }
    oPromise
      .then(ДобавитьМедиасегмент)
      .then(СегментБылДобавлен)
      .catch(СегментНеБылДобавлен);
  }
  function ПеремотатьПовторДо(nSeekTo) {
    Check(м_Управление.GetState() === STATE_REPEAT);
    _оПовтор.CheckPlaybackPosition(nSeekTo);
  }
  function SeekReplayBy(лКадры, чПеремотатьНа) {
    Check(м_Управление.GetState() === STATE_REPEAT);
    Check(Number.isFinite(чПеремотатьНа));
    if (лКадры) {
      чПеремотатьНа *=
        m_Statistics.GetFrameDurationInSeconds().чМинимальная;
    }
    if (чПеремотатьНа !== 0) {
      ПеремотатьПовторДо(
        Clamp(
          _oMediaElement.currentTime + чПеремотатьНа,
          м_Шкала.GetStart(),
          м_Шкала.GetEnd()
        )
      );
    }
  }
  function TogglePause() {
    Check(м_Управление.GetState() === STATE_REPEAT);
    if ((_оПовтор.bPause = !_оПовтор.bPause)) {
      m_Log.Окак("[Проигрыватель] Ставлю повтор на паузу");
      _oMediaElement.pause();
    } else {
      m_Log.Окак("[Проигрыватель] Снимаю повтор с паузы");
      _оПовтор.CheckPlaybackPosition(
        ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ
      );
      _oMediaElement.play();
    }
    m_Events.SendEvent("проигрыватель-пауза", _оПовтор.bPause);
  }
  function SetReplaySpeed(чСкорость) {
    Check(чСкорость > 0);
    Check(м_Управление.GetState() === STATE_REPEAT);
    m_Log.Окак(`[Проигрыватель] Задана скорость ${чСкорость}`);
    _oMediaElement.playbackRate = чСкорость;
  }
  function ЗапуститьПовтор() {
    _оПовтор.bPause = true;
    _оПоведение = _оПовтор;
    ОстановитьВоспроизведение();
    if (
      _oMediaSource.sourceBuffers.length !== 0 &&
      _oMediaSource.readyState === "open"
    ) {
      _oMediaSource.endOfStream();
    }
    if (
      _oMediaElement.played.length === 0 ||
      GetBufferFill().nWatched <
      ПОВТОР_ДОСТУПЕН_ЕСЛИ_ПРОСМОТРЕНО
    ) {
      ShowState("Окак", "Повторять нечего");
      м_Управление.ChangeState(STATE_STOP);
      return;
    }
    ShowState("Окак", "Запуск повтора");
    m_Events.SendEvent("проигрыватель-пауза", _оПовтор.bPause);
    м_Шкала.ЗадатьНачалоИКонец(
      _oMediaElement.buffered.start(0),
      _oMediaElement.buffered.end(_oMediaElement.buffered.length - 1)
    );
    м_Шкала.SetWatched(_oMediaElement.currentTime);
    м_Управление.ChangeState(STATE_REPEAT);
    SetReplaySpeed(м_Управление.получитьСкоростьПовтора());
  }
  function ДобавитьБуферы(oSegment) {
    m_Log.Окак(`[Проигрыватель] Добавляю буфер ${oSegment.pData.sCodecs}`);
    Check(oSegment.bDiscontinuity && oSegment.pData.sCodecs);
    try {
      _oMediaSourceBuffer = _oMediaSource.addSourceBuffer(
        oSegment.pData.sCodecs
      );
    } catch (pException) {
      if (IsObject(pException) && pException.name === "NotSupportedError") {
        m_Debug.FinishWorkAndShowMessage("J0201");
      } else {
        m_Debug.CaughtException(pException);
      }
    }
    _лЕстьВидеодорожка = oSegment.pData.bHasVideo;
    _oMediaSourceBuffer.addEventListener(
      "updatestart",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSourceBuffer.addEventListener(
      "update",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSourceBuffer.addEventListener(
      "updateend",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSourceBuffer.addEventListener(
      "abort",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSourceBuffer.addEventListener(
      "error",
      СледитьЗаСобытиямиMediaSource
    );
  }
  function подключитьMediaSourceКMediaElement() {
    if (_oMediaElement.src) {
      URL.revokeObjectURL(_oMediaElement.src);
    }
    _oMediaElement.src = URL.createObjectURL(_oMediaSource);
    м_Аудиоустройство.start(_oMediaElement);
  }
  function Start() {
    Check(!_oMediaElement);
    try {
      _oMediaSource = new MediaSource();
    } catch (pException) {
      console.error(`MediaSource ${pException}`);
      m_Debug.FinishWorkAndShowMessage("J0221");
    }
    _oMediaSource.addEventListener("sourceopen", СледитьЗаСобытиямиMediaSource);
    _oMediaSource.addEventListener(
      "sourceended",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSource.addEventListener(
      "sourceclose",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSource.sourceBuffers.addEventListener(
      "addsourcebuffer",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaSource.sourceBuffers.addEventListener(
      "removesourcebuffer",
      СледитьЗаСобытиямиMediaSource
    );
    _oMediaElement = document.getElementById("глаз");
    ПрименитьГромкость();
    м_КартинкаВКартинке.start(_oMediaElement);
    for (let sEvent of [
      "progress",
      "error",
      "playing",
      "seeking",
      "seeked",
      "ended",
      "timeupdate",
      "waiting",
      "loadstart",
      "suspend",
      "abort",
      "emptied",
      "stalled",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "durationchange",
      "play",
      "pause",
      "ratechange",
      "resize",
    ]) {
      _oMediaElement.addEventListener(sEvent, СледитьЗаСобытиямиMediaElement);
    }
    подключитьMediaSourceКMediaElement();
    return true;
  }
  function Stop() {
    if (_oMediaElement) {
      URL.revokeObjectURL(_oMediaElement.src);
      _oMediaElement.removeAttribute("src");
      _oMediaElement.load();
    }
  }
  return {
    Start,
    Stop,
    GetBufferFill,
    GetDroppedFrameCount,
    GetBroadcastPlaybackPosition,
    ShowState,
    Перезагрузить: ПерезагрузитьИЖдатьЗаполненияБуфера,
    ПрименитьГромкость,
    AddNextSegment,
    ПеремотатьПовторДо,
    SeekReplayBy,
    TogglePause,
    SetReplaySpeed,
  };
})();

const м_Список = (() => {
  const ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКА_С_РЕКЛАМОЙ = 2e3;
  const МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ = 500;
  class ОбновлениеСписков {
    constructor(bWithoutAds) {
      this._bNoAds = bWithoutAds;
      this._oPromiseCancel = null;
      this.очистить();
    }
    очистить() {
      this.oVariantList = null;
      this.oSegmentList = null;
      this.oSelectedVariant = null;
    }
    start() {
      Check(!this._oPromiseCancel);
      this._oPromiseCancel = new PromiseCancellation();
      this._update(this._oPromiseCancel, -Infinity);
    }
    stop() {
      if (this._oPromiseCancel) {
        m_Log.Вот(
          `[Список] Останавливаю обновление списков ${+this._bNoAds}`
        );
        this._oPromiseCancel.Cancel();
        this._oPromiseCancel = null;
      }
    }
    сохранитьВариантТрансляции(oVariant) {
      m_Settings.Change("сНазваниеВарианта", oVariant.sIdentifier);
      m_Settings.Change("чБитрейтВарианта", oVariant.nBitrate);
    }
    выбратьВариантТрансляции(moVariants) {
      const сСохраненныйИд = m_Settings.Get("сНазваниеВарианта");
      const чСохраненныйБитрейт = m_Settings.Get("чБитрейтВарианта");
      let oSelectedVariant = moVariants.find(
        ({ sIdentifier }) => sIdentifier === сСохраненныйИд
      );
      if (!oSelectedVariant) {
        if (сСохраненныйИд === "chunked" || сСохраненныйИд === "audio_only") {
          oSelectedVariant = moVariants[0];
        } else {
          oSelectedVariant = moVariants.find(
            ({ sIdentifier, nBitrate }) =>
              sIdentifier !== "audio_only" && nBitrate <= чСохраненныйБитрейт
          );
          if (!oSelectedVariant) {
            oSelectedVariant = moVariants.reduceRight((oResult, oVariant) =>
              oResult.sIdentifier === "audio_only" ? oVariant : oResult
            );
          }
        }
      }
      m_Log.Вот(
        `[Список] Для списка ${+this._bNoAds} выбран вариант трансляции ${oSelectedVariant.sIdentifier
        }/${oSelectedVariant.nBitrate
        }. Сохраненный ${сСохраненныйИд}/${чСохраненныйБитрейт}`
      );
      return oSelectedVariant;
    }
    _update(oPromiseCancellation, чЧерез) {
      Check(IsNumber(чЧерез));
      if (чЧерез >= МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ || чЧерез === -Infinity) {
        m_Log.Вот(
          `[Список] Обновление списков ${+this
            ._bNoAds} начнется через ${m_Log.F0(чЧерез)}мс`
        );
      } else {
        m_Log.Ой(
          `[Список] Обновление списков ${+this
            ._bNoAds} начнется через ${МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ}мс вместо ${m_Log.F0(
              чЧерез
            )}мс`
        );
        чЧерез = МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ;
      }
      let oPromise = Wait(oPromiseCancellation, чЧерез);
      let { oVariantList, oSelectedVariant } = this;
      if (oVariantList === null) {
        let сАбсолютныйАдресСпискаВариантов;
        oPromise = oPromise
          .then(() =>
            м_Twitch.GetAbsoluteVariantListUrl(
              oPromiseCancellation,
              false,
              this._bNoAds
            )
          )
          .then((sResult) => {
            сАбсолютныйАдресСпискаВариантов = sResult;
            return м_Загрузчик.LoadText(
              oPromiseCancellation,
              сАбсолютныйАдресСпискаВариантов,
              LOAD_VARIANT_LIST_NO_LONGER_THAN,
              `список вариантов ${+this._bNoAds}`,
              false
            );
          })
          .then((sResult) => {
            m_Debug.SaveVariantList(sResult);
            oVariantList = РазобратьСписок(
              true,
              сАбсолютныйАдресСпискаВариантов,
              sResult
            );
            if (oVariantList.moVariants.length === 0) {
              throw `Variant list is empty`;
            }
          });
      }
      let чНачалоОбновления;
      oPromise
        .then(() => {
          if (oSelectedVariant === null) {
            oSelectedVariant = this.выбратьВариантТрансляции(
              oVariantList.moVariants
            );
          }
          чНачалоОбновления = performance.now();
          return м_Загрузчик.LoadText(
            oPromiseCancellation,
            oSelectedVariant.sAbsoluteSegmentListUrl,
            LOAD_SEGMENT_LIST_NO_LONGER_THAN,
            `список сегментов ${+this._bNoAds}`,
            false
          );
        })
        .then((sResult) => {
          m_Debug.SaveSegmentList(sResult);
          const oSegmentList = РазобратьСписок(
            false,
            oSelectedVariant.sAbsoluteSegmentListUrl,
            sResult
          );
          let чИнтервалОбновления;
          if (
            this._этоТухлыйСписокСегментов(
              oVariantList,
              oSegmentList,
              oSelectedVariant
            )
          ) {
            m_Statistics.SegmentsQueued(0, 0);
            if (oSegmentList.bEndOfList) {
              throw "КОНЕЦ_СПИСКА";
            }
            чИнтервалОбновления = ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКА_С_РЕКЛАМОЙ;
          } else {
            const bShortenedInterval =
              чЧерез === -Infinity || this.oVariantList === null;
            this.oVariantList = oVariantList;
            this.oSegmentList = oSegmentList;
            this.oSelectedVariant = oSelectedVariant;
            чИнтервалОбновления =
              this._обновленСписокСегментов(bShortenedInterval);
          }
          this._update(
            oPromiseCancellation,
            чНачалоОбновления + чИнтервалОбновления - performance.now()
          );
          м_Загрузчик.LoadNextSegment();
        })
        .catch(
          AddExceptionHandler((pReason) => {
            if (typeof pReason == "string") {
              this._списокНеОбновлен(oPromiseCancellation, pReason);
              м_Загрузчик.LoadNextSegment();
            } else if (pReason === PromiseCancellation.REASON) {
              m_Log.Вот(
                `[Список] Отменено обновление списков ${+this._bNoAds}`
              );
            } else {
              throw pReason;
            }
          })
        );
    }
    _этоТухлыйСписокСегментов(
      oVariantList,
      oSegmentList,
      oSelectedVariant
    ) {
      const ПОРОГ_СМЕНЫ_СЕССИИ = 5;
      Check(
        (this.oVariantList === null) == (this.oSegmentList === null)
      );
      if (oSegmentList.moSegments.length === 0) {
        m_Log.Ой(`[Список] Список сегментов ${+this._bNoAds} пуст`);
        return true;
      }
      if (this.oSegmentList === null) {
        return false;
      }
      Check(
        !(
          this.oVariantList.sBroadcastId !==
          oVariantList.sBroadcastId &&
          this.oVariantList.nSessionId === oVariantList.nSessionId
        )
      );
      if (
        this.oSegmentList.nTargetDuration !==
        oSegmentList.nTargetDuration
      ) {
        m_Log.Ой(
          `[Список] В списке ${+this._bNoAds} изменился target duration ${this.oSegmentList.nTargetDuration
          } ==> ${oSegmentList.nTargetDuration}`
        );
      }
      if (this.oSelectedVariant !== null) {
        const чРазница =
          oSegmentList.nSequenceNumber -
          this.oSegmentList.nSequenceNumber;
        const чНачало = Math.max(-чРазница, 0);
        const чКонец = Math.min(
          this.oSegmentList.moSegments.length - чРазница,
          oSegmentList.moSegments.length
        );
        for (
          let чНовый = чНачало, чСтарый = чНачало + чРазница;
          чНовый < чКонец;
          чНовый++, чСтарый++
        ) {
          if (
            oSegmentList.moSegments[чНовый].sAddress !==
            this.oSegmentList.moSegments[чСтарый].sAddress
          ) {
            m_Log.Ой(
              `[Список] В списке ${+this._bNoAds} у сегмента ${oSegmentList.nSequenceNumber + чНовый
              } изменился адрес ${LimitStringLength(
                this.oSegmentList.moSegments[чСтарый].sAddress,
                100
              )} ==> ${LimitStringLength(
                oSegmentList.moSegments[чНовый].sAddress,
                100
              )}`
            );
            oSegmentList.лХаос = true;
            break;
          }
        }
      }
      const чРазница =
        this.oSegmentList.nSequenceNumber +
        this.oSegmentList.moSegments.length -
        oSegmentList.nSequenceNumber -
        oSegmentList.moSegments.length;
      if (чРазница > 0) {
        if (this.oSelectedVariant === null && чРазница <= ПОРОГ_СМЕНЫ_СЕССИИ) {
          m_Log.Ой(
            `[Список] При переключении варианта в списке ${+this
              ._bNoAds} уменьшился порядковый номер ${this.oSegmentList.nSequenceNumber
            } + ${this.oSegmentList.moSegments.length} ==> ${oSegmentList.nSequenceNumber
            } + ${oSegmentList.moSegments.length}`
          );
          return false;
        }
        if (
          oSegmentList.nSequenceNumber === 0 ||
          чРазница > ПОРОГ_СМЕНЫ_СЕССИИ
        ) {
          m_Log.Ой(
            `[Список] Меняю ИдСессии: в списке ${+this
              ._bNoAds} уменьшился порядковый номер ${this.oSegmentList.nSequenceNumber
            } + ${this.oSegmentList.moSegments.length} ==> ${oSegmentList.nSequenceNumber
            } + ${oSegmentList.moSegments.length}`
          );
          oVariantList.nSessionId = _чИдСессии++;
          return false;
        }
        m_Log.Ой(
          `[Список] Получен протухший список ${+this
            ._bNoAds}: порядковый номер ${this.oSegmentList.nSequenceNumber
          } + ${this.oSegmentList.moSegments.length} ==> ${oSegmentList.nSequenceNumber
          } + ${oSegmentList.moSegments.length}`
        );
        return true;
      }
      if (
        this.oSegmentList.nSequenceNumber >
        oSegmentList.nSequenceNumber
      ) {
        m_Log.Ой(
          `[Список] В списке ${+this
            ._bNoAds} уменьшился порядковый номер ${this.oSegmentList.nSequenceNumber
          } ==> ${oSegmentList.nSequenceNumber}`
        );
      }
      return false;
    }
  }
  class ОбновлениеСписковСРекламой extends ОбновлениеСписков {
    constructor() {
      super(false);
    }
    _обновленСписокСегментов(bShortenedInterval) {
      m_Log.Вот(
        `[AdBlock] Main stream updated. Segments=${this.oSegmentList.moSegments.length} EndOfList=${this.oSegmentList.bEndOfList}`
      );
      if (this.oSegmentList.moSegments.length === 0) {
        // An empty segment list is what leaves the picture frozen.
        m_Log.Ой("[AdBlock] Main stream is empty");
      }
      const лСписокЗаканчиваетсяРекламой = этотСписокЗаканчиваетсяРекламой(
        this.oSegmentList
      );
      м_Twitch.sendAdTrackingData(
        лСписокЗаканчиваетсяРекламой ? this.oSegmentList : null
      );
      if (!_лИдетРеклама || !лСписокЗаканчиваетсяРекламой) {
        bShortenedInterval =
          ДобавитьСегментыВОчередь(
            this.oVariantList,
            this.oSegmentList,
            this.oSelectedVariant
          ) || bShortenedInterval;
      }
      if (this.oSegmentList.bEndOfList) {
        throw "КОНЕЦ_СПИСКА";
      }
      задатьСостояниеРекламы(лСписокЗаканчиваетсяРекламой);
      return лСписокЗаканчиваетсяРекламой
        ? ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКА_С_РЕКЛАМОЙ
        : получитьИнтервалОбновленияСпискаСегментов(
          this.oSegmentList,
          bShortenedInterval
        );
    }
    _списокНеОбновлен(oPromiseCancellation, sReason) {
      if (sReason === "ОТКАЗАНО_В_ДОСТУПЕ") {
        м_Управление.StopWatchingBroadcast();
        m_Notification.ShowAss();
      } else {
        m_Log[sReason === "КОНЕЦ_СПИСКА" ? "Окак" : "Ой"](
          `[Список] Трансляция завершена. ${sReason}`
        );
        ЗавершитьТрансляцию();
        this._update(
          oPromiseCancellation,
          получитьИнтервалОбновленияСпискаВариантов()
        );
      }
    }
  }
  /**
     * **ENGLISH:** AdFreePlaylistUpdate (Class)
     *
     * @alias AdFreePlaylistUpdate
     * @purpose Manages the lifecycle of the "Ad-Free" (clean) backup playlist stream during debugging.
     * @description
     * This class extends the base {@link ОбновлениеСписков} functionality to handle specific checks
     * and behaviors required for the backup stream used to bypass automated Twitch advertisements.
     *
     * **Mechanism:**
     * When the main stream receives an identifying ad-marker, the player switches to this "Ad-Free" stream
     * (requested via `playerType: "picture-by-picture"`).
     *
     * **Critical Logic (Debugging / Investigation):**
     * This class implements aggressive sanitization logic to test the hypothesis that the backup stream
     * contains metadata triggering false-positive ad detection. To attempt to force playback during
     * failure states, this class forcibly sets the `лРеклама` (isAd) flag to `false` for all incoming segments.
     *
     * Additionally, it utilizes **Dynamic Decomposition** to validate the temporal integrity of the stream,
     * logging potential synchronization issues (Clock Skew) that may cause the player to reject segments
     * as invalid or expired.
     *
     * @extends ОбновлениеСписков
     * @dependencies
     * - [`player.js:6480`](./player.js#L6480)
     */

  class ОбновлениеСписковБезРекламы extends ОбновлениеСписков {
    /**
     * Constructor: AdFreePlaylistUpdate
     * Initializes the playlist updater with `isAdFree` (лБезРекламы) set to true.
     */
    constructor() {
      super(true); // true = Ad-Free / Backup stream mode
    }

    /**
     * Method: stop (остановить)
     * Stops the playlist update loop and clears all internal state.
     * This calls the parent `stop` to cancel any pending promises/timers,
     * and then `clean` (очистить) to wipe segment and variant processing data.
     */
    stop() {
      super.stop();
      this.очистить();
    }

    /**
     * Method: onSegmentListUpdated (_обновленСписокСегментов)
     * FIX APPLIED: Force-sanitize backup stream segments. 
     * Twitch is now injecting Ad Metadata into the backup stream, causing the player to reject it.
     * We must strip these flags to force playback.
     */
    _обновленСписокСегментов(bShortenedInterval) {

      // --- FIX START: FORCE CONTENT MODE FOR BACKUP STREAM ---
      // Iterate through all segments in the fetched backup playlist
      if (this.oSegmentList && this.oSegmentList.moSegments) {
        for (let i = 0; i < this.oSegmentList.moSegments.length; i++) {
          // Force the 'isAd' flag to false. 
          // This tricks the queue manager (ДобавитьСегментыВОчередь) into accepting the segments.
          this.oSegmentList.moSegments[i].bAd = false;
        }
      }
      // --- FIX END ---


      // --- REMOVED THE "THROW IF AD FOUND" CHECK ---
      // We process the segments as normal content now.

      bShortenedInterval = // bShortenedInterval
        ДобавитьСегментыВОчередь( // AddSegmentsToQueue
          this.oVariantList, // oVariantList
          this.oSegmentList, // oSegmentList
          this.oSelectedVariant // oSelectedVariant
        ) || bShortenedInterval; // bShortenedInterval

      if (this.oSegmentList.bEndOfList) { // oSegmentList.bEndOfList
        throw "КОНЕЦ_СПИСКА"; // END_OF_LIST
      }

      return получитьИнтервалОбновленияСпискаСегментов( // getSegmentListUpdateInterval
        this.oSegmentList, // oSegmentList
        bShortenedInterval // bShortenedInterval
      );
    }

    /**
     * Method: onListNotUpdated (_списокНеОбновлен)
     * Handles failures when the playlist cannot be refreshed (e.g., 404, network error).
     *
     * **Debug Modification:**
     * Adds explicit console error logging to trace the specific reason for rejection
     * in the console logs for easier correlation with the "Black Screen" state.
     *
     * @param {Object} оОтменаОбещания - The promise cancellation token.
     * @param {string} сПричина - The reason for the update failure.
     */
    _списокНеОбновлен(oPromiseCancellation, sReason) {
      // Code modified to implement debugging
      console.error(`CRITICAL FAILURE: Backup stream rejected! Reason: ${sReason}`);
      m_Log.Ой(`[Список] Список 1 не обновлен. ${sReason}`);
      this.stop();
    }
  }


  //end new code
  const _оСпискиСРекламой = new ОбновлениеСписковСРекламой();
  const _оСпискиБезРекламы = new ОбновлениеСписковБезРекламы();
  let _чСостояние = STATE_STOP;
  let _лИдетРеклама = false;
  let _чИнтервалОбновленияСпискаВариантов = -1;
  let _чИдСессии = 1;
  function РазобратьСписок(
    лЭтоСписокВариантов,
    сАбсолютныйАдресСписка,
    сРазбираемыйСписок
  ) {
    const МАКС_ПОДДЕРЖИВАЕМАЯ_ВЕРСИЯ_HLS = 7;
    if (сРазбираемыйСписок.includes("shelblock.proxy")) {
      m_Debug.FinishWorkAndShowMessage("J0220");
    }
    if (!сРазбираемыйСписок.startsWith("#EXTM3U")) {
      throw `Instead of a playlist, invalid data of length ${сРазбираемыйСписок.length}\n${сРазбираемыйСписок}`;
    }
    let чВерсия = 1;
    let mapRenditionGroups,
      moVariants, // variants
      оНовыйВариант, // newVariant
      sBroadcastId, // broadcast id
      sViewTrackingUrl; // viewingTrackingUrl
    let nTargetDuration,
      nSequenceNumber, // sequence number
      bEndOfList, // endOfList
      kAdSegments, // adSegmentsCount
      // not sure if `adContentType` or `adRollType` is more correct
      // сТипРекламы, // adContentType
      sAdType, // adRollType
      кРоликов, // clipCount
      чНомерРолика, // clipNumber
      чПродолжительностьРолика, // clipDuration
      sAdToken, // adToken
      сИдРолика1, // clipId1
      сИдРолика2, // clipId2
      сИдРолика3, // clipId3
      сИдРолика4, // clipId4
      сИдРолика5, // clipId5
      сИдРолика6, // clipId6
      чНомерКвартеля, // quartileNumber
      moSegments, // segments
      оНовыйСегмент; // newSegment
    let bDiscontinuity, nTime; 
    if (лЭтоСписокВариантов) {
      mapRenditionGroups = new Map();
      moVariants = [];
      оНовыйВариант = null;
      sBroadcastId = "";
      sViewTrackingUrl = "";
    } else {
      nTargetDuration = -1;
      nSequenceNumber = 0;
      bEndOfList = false;
      kAdSegments = 0;
      sAdType = "";
      moSegments = [];
      оНовыйСегмент = null;
      bDiscontinuity = false;
      nTime = NaN;
    }
    // URI of the #EXT-X-MAP initialisation segment. Empty for MPEG-TS playlists.
    let sInitSegmentUrl = "";
    const рвТегИлиАдрес = /^#EXT([^:\r\n]+)(?::(.*))?$|^[^#\r\n].*$/gm;
    рвТегИлиАдрес.lastIndex = 7;
    for (
      let мсТегИлиАдрес;
      (мсТегИлиАдрес = рвТегИлиАдрес.exec(сРазбираемыйСписок));

    ) {
      const [sAddress, сНазваниеТега = "", сЗначениеТега = ""] = мсТегИлиАдрес;
      try {
        switch (сНазваниеТега) {
          case "":
            if (лЭтоСписокВариантов) {
              Check(оНовыйВариант !== null);
              оНовыйВариант.sAbsoluteSegmentListUrl =
                ResolveRelativeUrl(sAddress, сАбсолютныйАдресСписка);
              moVariants.push(оНовыйВариант);
              оНовыйВариант = null;
            } else {
              браковать(оНовыйСегмент !== null);
              оНовыйСегмент.sAddress = ResolveRelativeUrl(
                sAddress,
                сАбсолютныйАдресСписка
              );
              оНовыйСегмент.bDiscontinuity = bDiscontinuity;
              moSegments.push(оНовыйСегмент);
              bDiscontinuity = false;
              kAdSegments += Boolean(оНовыйСегмент.bAd);
              оНовыйСегмент = null;
            }
            break;

          case "INF": {
            Check(!лЭтоСписокВариантов);
            Check(nTargetDuration !== -1);
            Check(оНовыйСегмент === null);
            оНовыйСегмент = Object.create(null);
            const { nDuration, sSegmentName } =
              разобратьEXTINF(сЗначениеТега);
            оНовыйСегмент.nDuration = nDuration;

            // --- ZOMBIE SEGMENT OVERRIDE START ---
            // If the DATERANGE parser identified a Zombie Ad and set the global flag,
            // we force this segment to be treated as CONTENT (False), not AD.
            // This prevents the player from switching to the dead backup stream.
            if (typeof г_лИгнорироватьСегментыРекламы !== 'undefined' && г_лИгнорироватьСегментыРекламы) {
              оНовыйСегмент.bAd = false;
              // If we encounter a standard 'live' segment, the zombie block is likely over.
              // Reset the flag to resume normal ad detection protection.
              if (sSegmentName === "live") {
                г_лИгнорироватьСегментыРекламы = false;
              }
            } else {
              // Standard behavior
              оНовыйСегмент.bAd = м_Twitch.этоРекламныйСегмент(sSegmentName);
            }
            // --- ZOMBIE SEGMENT OVERRIDE END ---


            if (оНовыйСегмент.bAd) {
              nTime = NaN;
            }
            оНовыйСегмент.nTime = nTime;
            nTime++;
            if (оНовыйСегмент.nDuration < 0) {
              m_Log.Ой(
                `[Список] У сегмента ${nSequenceNumber + moSegments.length
                } отрицательная длительность ${сЗначениеТега}`
              );
              оНовыйСегмент.nDuration = 0;
            }
            if (Math.round(оНовыйСегмент.nDuration) > nTargetDuration) {
              m_Log.Ой(
                `[Список] Длительность сегмента ${nSequenceNumber + moSegments.length
                } больше target duration на ${оНовыйСегмент.nDuration - nTargetDuration
                }с`
              );
              if (оНовыйСегмент.nDuration > nTargetDuration * 3) {
                оНовыйСегмент.nDuration = 0;
              }
            }
            break;
          }

          case "-X-DISCONTINUITY":
            Check(!лЭтоСписокВариантов);
            Check(!сЗначениеТега);
            bDiscontinuity = true;
            break;

          // Reconnu sans etre exploite. La branche doit exister : le cas par defaut de cet
          // analyseur fait Проверить(false), donc une balise non citee ferait echouer la lecture
          // de toute playlist qui la porte — c'est-a-dire toutes.
          case "-X-PROGRAM-DATE-TIME":
            Check(!лЭтоСписокВариантов);
            break;

          // #EXT-X-MAP is not encryption. It names the initialisation segment of an
          // fMP4 (CMAF) playlist, the container Twitch is migrating channels to.
          // Only #EXT-X-KEY means the media itself is encrypted.
          case "-X-MAP": {
            Check(!лЭтоСписокВариантов);
            const amMapAttributes = РазобратьСписокАтрибутов(сЗначениеТега);
            const sMapUri = amMapAttributes.get("URI");
            Check(IsNonEmptyString(sMapUri));
            // A byte range would mean the init segment shares a file with the media
            // segments. Twitch does not do that, and honouring it needs range requests.
            Check(!amMapAttributes.has("BYTERANGE"));
            sInitSegmentUrl = ResolveRelativeUrl(sMapUri, сАбсолютныйАдресСписка);
            break;
          }

          case "-X-KEY": {
            Check(!лЭтоСписокВариантов);
            const amKeyAttributes = РазобратьСписокАтрибутов(сЗначениеТега);
            if (amKeyAttributes.get("METHOD") !== "NONE") {
              m_Debug.FinishWorkAndShowMessage(
                "J0219",
                "J0731",
                м_Twitch.GetChannelUrl(true)
              );
            }
            break;
          }

          case "-X-BYTERANGE":
          case "-X-GAP":
            Check(false);
            break;

          case "-X-TARGETDURATION":
            Check(!лЭтоСписокВариантов);
            Check(nTargetDuration === -1);
            nTargetDuration = РазобратьЦелоеПоложительноеЧисло(сЗначениеТега);
            Check(nTargetDuration > 0 && nTargetDuration < 60);
            break;

          case "-X-MEDIA-SEQUENCE":
            Check(!лЭтоСписокВариантов);
            Check(nSequenceNumber === 0);
            nSequenceNumber = РазобратьЦелоеПоложительноеЧисло(сЗначениеТега);
            break;

          case "-X-ENDLIST":
            Check(!лЭтоСписокВариантов);
            Check(!сЗначениеТега);
            bEndOfList = true;
            break;

          case "-X-DISCONTINUITY-SEQUENCE":
            Check(!лЭтоСписокВариантов);
            break;

          case "-X-PLAYLIST-TYPE":
          case "-X-I-FRAMES-ONLY":
            Check(false);
            break;

          case "-X-TWITCH-LIVE-SEQUENCE":
            Check(!лЭтоСписокВариантов);
            nTime = РазобратьЦелоеПоложительноеЧисло(сЗначениеТега);
            break;

          case "-X-DATERANGE": {
            Check(!лЭтоСписокВариантов);
            const amAttributes = РазобратьСписокАтрибутов(сЗначениеТега);

            // --- STRICT AD FILTER FIX (UPDATED DEC 16) ---
            try {
              const sClass = amAttributes.get("CLASS");
              if (sClass === "twitch-stitched-ad") {
                const сДатаНачала = amAttributes.get("START-DATE");
                const сДлительность = amAttributes.get("DURATION");

                if (сДатаНачала && сДлительность) {
                  const чВремяНачалаРекламы = Date.parse(сДатаНачала);
                  const чДлительностьМс = parseFloat(сДлительность) * 1000;
                  const чВремяОкончанияРекламы = чВремяНачалаРекламы + чДлительностьМс;

                  // Calculate current server time. 
                  const nCurrentTime = !Number.isNaN(g_nExactTime)
                    ? performance.now() + g_nExactTime
                    : Date.now();

                  // RULE 1: STRICT EXPIRY. 
                  // If the ad end time is in the past (plus 1s for jitter), KILL IT.
                  // Previous issue: 15s buffer allowed finished ads to block playback.
                  if (чВремяОкончанияРекламы < (nCurrentTime + 1000)) {
                    m_Log.Окак(
                      `[AdBlock] Skipping expired ad. Ends=${new Date(чВремяОкончанияРекламы).toISOString()} Now=${new Date(nCurrentTime).toISOString()}`
                    );
                    break; // EXIT this case immediately
                  }

                  // RULE 2: FUTURE PROTECTION.
                  // If ad starts >60s in the future, ignore it to prevent pre-mature freezing.
                  if (чВремяНачалаРекламы > (nCurrentTime + 60000)) {
                    m_Log.Окак(
                      `[AdBlock] Skipping future ad. Starts=${new Date(чВремяНачалаРекламы).toISOString()}`
                    );
                    break; // EXIT this case immediately
                  }
                }
              }
            } catch (pException) {
              m_Log.Ой(
                `[AdBlock] Filter error: ${ExceptionToString(pException)}`
              );
            }

            try {
              switch (amAttributes.get("CLASS")) {
                case "twitch-stitched-ad":
                  // The raw attribute string of the ad tag, kept whole because the
                  // shape of these tags is what the ad-freeze work turns on.
                  m_Log.Вот(`[AdBlock] Ad tag detected: ${сЗначениеТега}`);

                  // Extract Ad Type (e.g., standard, midroll)
                  sAdType = amAttributes.get("X-TV-TWITCH-AD-ROLL-TYPE");

                  // Extract Total Number of Ads in this break (Pod Length)
                  кРоликов = РазобратьЦелоеПоложительноеЧисло(
                    amAttributes.get("X-TV-TWITCH-AD-POD-LENGTH")
                  );

                  // Extract Current Ad Position (e.g., 2 in a sequence of 4)
                  чНомерРолика = РазобратьЦелоеПоложительноеЧисло(
                    amAttributes.get("X-TV-TWITCH-AD-POD-POSITION")
                  );

                  // Extract Duration of the ad in seconds
                  чПродолжительностьРолика = РазобратьПоложительноеЧисло(
                    amAttributes.get("DURATION") || "0"
                  );

                  // Extract specific Ad Tracking tokens and IDs for analytics
                  // These IDs are NOT used for playback logic. They are only used to construct
                  // the "Proof of View" telemetry packet sent back to Twitch via 'recordAdEvent'.

                  // RADS Token: The unique cryptographic token validating this specific ad impression.
                  sAdToken =
                    amAttributes.get("X-TV-TWITCH-AD-RADS-TOKEN") || "";

                  // Advertiser ID: Identifies the company buying the ad (mapped to 'ad_id' in GQL).
                  сИдРолика1 =
                    amAttributes.get("X-TV-TWITCH-AD-ADVERTISER-ID") || "";

                  // Creative ID: Identifies the specific video asset/commercial (mapped to 'creative_id').
                  сИдРолика2 =
                    amAttributes.get("X-TV-TWITCH-AD-CREATIVE-ID") || "";

                  // Line Item ID: Internal campaign management ID (mapped to 'line_item_id').
                  сИдРолика3 =
                    amAttributes.get("X-TV-TWITCH-AD-LINE-ITEM-ID") || "";

                  // Order ID: Purchase order ID for the ad campaign (mapped to 'order_id').
                  сИдРолика4 = amAttributes.get("X-TV-TWITCH-AD-ORDER-ID") || "";

                  // Ad Session ID: Ties this ad view to the user's viewing session (mapped to 'ad_session_id').
                  сИдРолика5 =
                    amAttributes.get("X-TV-TWITCH-AD-AD-SESSION-ID") || "";

                  // Ad Format: The format of the ad, e.g., 'Video', 'Display' (mapped to 'format_name').
                  сИдРолика6 = amAttributes.get("X-TV-TWITCH-AD-AD-FORMAT") || "";

                  // Validate that we found a valid Ad Type
                  Check(sAdType);
              }
            } catch (pException) {
              // Safety fallback: if parsing fails, reset ad type and log error.
              sAdType = "";
              m_Log.Ой(`[Список] Ошибка разбора рекламы: ${сЗначениеТега}`);
            }
            break;
          }

          case "-X-MEDIA": {
            Check(лЭтоСписокВариантов);
            const amAttributes = РазобратьСписокАтрибутов(сЗначениеТега);
            const sType = amAttributes.get("TYPE");
            Check(sType);
            Check(
              (sType !== "VIDEO" && sType !== "AUDIO") || !amAttributes.has("URI")
            );
            if (sType === "VIDEO") {
              const сГруппа = amAttributes.get("GROUP-ID");
              const sName = amAttributes.get("NAME");
              Check(сГруппа && sName);
              Check(!mapRenditionGroups.has(сГруппа));
              mapRenditionGroups.set(сГруппа, sName);
            } else {
              m_Log.Ой(`[Список] Найден #EXT-X-MEDIA TYPE=${sType}`);
            }
            break;
          }

          case "-X-STREAM-INF": {
            Check(лЭтоСписокВариантов);
            Check(оНовыйВариант === null);
            оНовыйВариант = Object.create(null);
            const amAttributes = РазобратьСписокАтрибутов(сЗначениеТега);
            оНовыйВариант.nBitrate = РазобратьЦелоеПоложительноеЧисло(
              amAttributes.get("BANDWIDTH")
            );
            Check(
              !amAttributes.has("AUDIO") &&
              !amAttributes.has("SUBTITLES") &&
              !amAttributes.has("CLOSED-CAPTIONS")
            );
            оНовыйВариант.sIdentifier = amAttributes.get("VIDEO") || "";
            // Needed to build the SourceBuffer MIME type for fMP4 playlists, where no
            // demuxer runs to derive the codec string from the elementary streams.
            оНовыйВариант.sCodecs = amAttributes.get("CODECS") || "";
            оНовыйВариант.sResolution = amAttributes.get("RESOLUTION") || "";
            break;
          }

          case "-X-I-FRAME-STREAM-INF":
          case "-X-SESSION-DATA":
          case "-X-SESSION-KEY":
            Check(лЭтоСписокВариантов);
            break;

          case "-X-TWITCH-INFO": {
            Check(лЭтоСписокВариантов);
            const amAttributes = РазобратьСписокАтрибутов(сЗначениеТега);
            const чСекунды = РазобратьПоложительноеЧисло(
              amAttributes.get("SERVER-TIME")
            );
            Check(чСекунды > 1531267200 && чСекунды < 1846886400);
            const nMilliseconds = чСекунды * 1e3 + 50;
            g_nExactTime = nMilliseconds - performance.now();
            const чРассинхронизацияВремени = nMilliseconds - Date.now();
            sBroadcastId = amAttributes.get("BROADCAST-ID");
            Check(sBroadcastId);
            try {
              const sAddress = atob(amAttributes.get("C"));
              Check(sAddress.startsWith("https://"));
              sViewTrackingUrl = sAddress;
            } catch (pException) {
              m_Log.Ой(
                `[Список] Не удалось разобрать адрес слежения за просмотром: ${pException}`
              );
            }
            m_Log[Math.abs(чРассинхронизацияВремени) > 5e3 ? "Ой" : "Окак"](
              `[Список] РассинхронизацияВремени=${чРассинхронизацияВремени}мс ИдТрансляции=${sBroadcastId}`
            );
            break;
          }

          case "-X-VERSION":
            Check(чВерсия === 1);
            чВерсия = РазобратьЦелоеПоложительноеЧисло(сЗначениеТега);
            Check(
              чВерсия >= 2 && чВерсия <= МАКС_ПОДДЕРЖИВАЕМАЯ_ВЕРСИЯ_HLS
            );
            break;

          case "-X-START":
            m_Log.Ой(`[Список] Найден #EXT-X-START=${сЗначениеТега}`);
            break;

          case "M3U":
          case "-X-DEFINE":
            Check(false);
        }
      } catch (pException) {
        if (
          pException instanceof Error &&
          pException.message === "БРАКОВАТЬ"
        ) {
          throw `Error parsing playlist line:\n${ExceptionToString(
            pException
          )}\n${sAddress}`;
        }
      }
    }
    if (лЭтоСписокВариантов) {
      Check(оНовыйВариант === null);
      for (let oVariant of moVariants) {
        if (oVariant.sIdentifier) {
          Check(mapRenditionGroups.has(oVariant.sIdentifier));
          oVariant.sLabel = mapRenditionGroups.get(oVariant.sIdentifier);
        } else {
          oVariant.sIdentifier = `CoolCmd${oVariant.nBitrate}`;
          oVariant.sLabel = `${m_i18n.FormatNumber(
            oVariant.nBitrate / 1e6,
            1
          )} ${GetText("J0114")}`;
        }
      }
      m_Log.Вот(
        `[Список] Количество вариантов в списке: ${moVariants.length}`
      );
      return м_Twitch.сортироватьСписокВариантов({
        sBroadcastId,
        nSessionId: _чИдСессии++,
        sViewTrackingUrl,
        moVariants,
      });
    } else {
      Check(оНовыйСегмент === null);
      Check(nTargetDuration !== -1);
      const oSegmentList = {
        nTargetDuration,
        nSequenceNumber,
        bEndOfList,
        лХаос: false,
        kAdSegments,
        sAdType,
        кРоликов,
        чНомерРолика,
        чПродолжительностьРолика,
        sAdToken,
        сИдРолика1,
        сИдРолика2,
        сИдРолика3,
        сИдРолика4,
        сИдРолика5,
        сИдРолика6,
        moSegments,
        sInitSegmentUrl,
      };
      m_Log.Вот(
        `[Список] Разобран список сегментов TargetDuration=${nTargetDuration} ПорядковыйНомер=${nSequenceNumber} КонецСписка=${bEndOfList} КоличествоСегментов=${moSegments.length} РекламныхСегментов=${kAdSegments}`
      );
      if (sAdType) {
        m_Log.Окак(
          `[Список] Найдена реклама ТипРекламы=${sAdType} ТокенРекламы=${sAdToken.slice(
            -10
          )} Роликов=${кРоликов} НомерРолика=${чНомерРолика} ПродолжительностьРолика=${чПродолжительностьРолика} НомерКвартеля=${чНомерКвартеля} ЗаканчиваетсяРекламой=${этотСписокЗаканчиваетсяРекламой(
            oSegmentList
          )}`
        );
      }
      m_Statistics.SegmentListParsed(oSegmentList);
      return oSegmentList;
    }
  }
  function браковать(pCondition) {
    if (!pCondition) {
      throw new Error("БРАКОВАТЬ");
    }
  }
  function РазобратьСписокАтрибутов(sSourceText) {
    const amAttributes = new Map();
    const рвАтрибут = /([A-Z0-9-]+)=(?:"([^"]*)"|([^",]+))(?:,|$)/g;
    while (рвАтрибут.lastIndex !== sSourceText.length) {
      const { lastIndex } = рвАтрибут;
      const мсАтрибут = рвАтрибут.exec(sSourceText);
      Check(мсАтрибут.index === lastIndex);
      Check(!amAttributes.has(мсАтрибут[1]));
      amAttributes.set(мсАтрибут[1], мсАтрибут[3] || мсАтрибут[2]);
    }
    return amAttributes;
  }
  function РазобратьЦелоеПоложительноеЧисло(sSourceText) {
    const nResult = parseFloat(sSourceText);
    Check(Number.isSafeInteger(nResult) && nResult >= 0);
    return nResult;
  }
  function РазобратьПоложительноеЧисло(sSourceText) {
    const nResult = parseFloat(sSourceText);
    Check(Number.isFinite(nResult) && nResult >= 0);
    return nResult;
  }
  function РазобратьЛюбоеЧисло(sSourceText) {
    const nResult = parseFloat(sSourceText);
    Check(Number.isFinite(nResult));
    return nResult;
  }
  function разобратьEXTINF(sSourceText) {
    let чЗапятая = sSourceText.indexOf(",");
    if (чЗапятая === -1) {
      чЗапятая = sSourceText.length;
    }
    return {
      nDuration: РазобратьЛюбоеЧисло(sSourceText.slice(0, чЗапятая)),
      sSegmentName: sSourceText.slice(чЗапятая + 1),
    };
  }
  function этотСписокЗаканчиваетсяРекламой(оСписок) {
    return (
      оСписок !== null &&
      оСписок.moSegments.length !== 0 &&
      оСписок.moSegments[оСписок.moSegments.length - 1].bAd
    );
  }
  function задатьСостояниеРекламы(лИдетРеклама) {
    if (_лИдетРеклама !== лИдетРеклама) {
      m_Log.Окак(`[AdBlock] Ad in progress: ${лИдетРеклама}`);
      _лИдетРеклама = лИдетРеклама;
      if (лИдетРеклама) {
        _оСпискиБезРекламы.start();
        m_Events.SendEvent("список-началорекламы");
      } else {
        _оСпискиБезРекламы.stop();
        m_Events.SendEvent("список-конецрекламы");
      }
    }
    if (!лИдетРеклама) {
      м_Twitch.sendAdTrackingData(null);
    }
  }
  let _сДобавленныйИдТрансляции;
  let _чДобавленныйИдСессии;
  let _сДобавленныйИдВарианта;
  let _чДобавленныйПорядковыйНомер;
  let _чДобавленноеВремя;
  let _лДобавитьРазрыв;
  // URI of the #EXT-X-MAP whose initialisation segment the queue is currently on.
  let _sAddedInitSegmentUrl;
  function очиститьСтатистикуДобавления() {
    _сДобавленныйИдТрансляции = "";
    _чДобавленныйИдСессии = NaN;
    _сДобавленныйИдВарианта = "";
    _чДобавленныйПорядковыйНомер = -1;
    _чДобавленноеВремя = -1;
    _лДобавитьРазрыв = false;
    _sAddedInitSegmentUrl = "";
  }
  очиститьСтатистикуДобавления();
  function ДобавитьСегментыВОчередь(
    оНовыеВарианты,
    оНовыеСегменты,
    oSelectedVariant
  ) {
    Check(
      !(
        _сДобавленныйИдТрансляции !== оНовыеВарианты.sBroadcastId &&
        _чДобавленныйИдСессии === оНовыеВарианты.nSessionId
      )
    );
    if (оНовыеСегменты.лХаос) {
      _лДобавитьРазрыв = true;
      m_Statistics.SegmentsQueued(0, 0);
      return false;
    }
    let кСегментовДобавлено = 0;
    let кСекундДобавлено = 0;
    let чИндексДобавляемогоСегмента = оНовыеСегменты.moSegments.length;
    let кДобавитьСегментов =
      _сДобавленныйИдТрансляции !== оНовыеВарианты.sBroadcastId ? 1 : 3;
    let чДобавитьСекунд = m_Settings.Get("чРазмерБуфера");
    while (--чИндексДобавляемогоСегмента > 0) {
      if (
        !оНовыеСегменты.moSegments[чИндексДобавляемогоСегмента].bAd &&
        оНовыеСегменты.moSegments[чИндексДобавляемогоСегмента].nDuration !==
        0
      ) {
        кДобавитьСегментов--;
        чДобавитьСекунд -=
          оНовыеСегменты.moSegments[чИндексДобавляемогоСегмента].nDuration;
        if (кДобавитьСегментов <= 0 && чДобавитьСекунд <= 0) {
          break;
        }
      }
    }
    if (_сДобавленныйИдТрансляции !== оНовыеВарианты.sBroadcastId) {
      m_Log.Окак(
        `[Список] Изменился ИдТрансляции ${_сДобавленныйИдТрансляции} ==> ${оНовыеВарианты.sBroadcastId}`
      );
      _чДобавленноеВремя = -1;
      _лДобавитьРазрыв = true;
      for (
        let оДобавляемыйСегмент;
        (оДобавляемыйСегмент =
          оНовыеСегменты.moSegments[чИндексДобавляемогоСегмента]);
        чИндексДобавляемогоСегмента++
      ) {
        добавитьСегментВОчередь(
          оДобавляемыйСегмент,
          оНовыеСегменты.nSequenceNumber + чИндексДобавляемогоСегмента
        );
      }
    } else if (_чДобавленныйИдСессии !== оНовыеВарианты.nSessionId) {
      m_Log.Окак(
        `[Список] Изменился ИдСессии ${_чДобавленныйИдСессии} ==> ${оНовыеВарианты.nSessionId}`
      );
      _лДобавитьРазрыв = true;
      for (
        let оДобавляемыйСегмент;
        (оДобавляемыйСегмент =
          оНовыеСегменты.moSegments[чИндексДобавляемогоСегмента]);
        чИндексДобавляемогоСегмента++
      ) {
        if (оДобавляемыйСегмент.nTime > _чДобавленноеВремя) {
          добавитьСегментВОчередь(
            оДобавляемыйСегмент,
            оНовыеСегменты.nSequenceNumber + чИндексДобавляемогоСегмента
          );
        }
      }
    } else {
      if (_сДобавленныйИдВарианта !== oSelectedVariant.sIdentifier) {
        m_Log.Окак(
          `[Список] Изменился ИдВарианта ${_сДобавленныйИдВарианта} ==> ${oSelectedVariant.sIdentifier}`
        );
        _лДобавитьРазрыв = true;
      }
      for (
        let оДобавляемыйСегмент;
        (оДобавляемыйСегмент =
          оНовыеСегменты.moSegments[чИндексДобавляемогоСегмента]);
        чИндексДобавляемогоСегмента++
      ) {
        if (
          оНовыеСегменты.nSequenceNumber + чИндексДобавляемогоСегмента >
          _чДобавленныйПорядковыйНомер
        ) {
          добавитьСегментВОчередь(
            оДобавляемыйСегмент,
            оНовыеСегменты.nSequenceNumber + чИндексДобавляемогоСегмента
          );
        }
      }
    }
    m_Statistics.SegmentsQueued(
      кСегментовДобавлено,
      кСекундДобавлено
    );
    return кСегментовДобавлено === 0;
    function добавитьСегментВОчередь(oSegment, nSequenceNumber) {
      начатьТрансляцию();
      if (oSegment.bAd) {
        m_Log.Вот(
          `[Список] Не добавляю рекламу ПорядковыйНомер=${nSequenceNumber}`
        );
        return;
      }
      if (oSegment.nDuration === 0) {
        m_Log.Ой(
          `[Список] Не добавляю сегмент ПорядковыйНомер=${nSequenceNumber} Время=${oSegment.nTime} Длительность=0`
        );
        return;
      }
      if (
        _чДобавленныйИдСессии === оНовыеВарианты.nSessionId &&
        _чДобавленныйПорядковыйНомер + 1 < nSequenceNumber
      ) {
        m_Log.Ой(
          `[Список] Пропущены сегменты с ${_чДобавленныйПорядковыйНомер + 1
          } по ${nSequenceNumber - 1}`
        );
        m_Statistics.segmentsSkipped(
          nSequenceNumber - _чДобавленныйПорядковыйНомер - 1
        );
        _лДобавитьРазрыв = true;
      }
      // A different #EXT-X-MAP means a different moov box, so the new initialisation
      // segment has to reach the SourceBuffer before any media that depends on it.
      // The ad bypass switches between two fMP4 streams that each ship their own, and
      // that switch does not otherwise always raise a discontinuity: the two playlists
      // can select renditions with the same identifier. Appending media from one
      // encode against the other's moov is what leaves a black picture behind.
      if (оНовыеСегменты.sInitSegmentUrl !== _sAddedInitSegmentUrl) {
        if (_sAddedInitSegmentUrl !== "") {
          m_Log.Окак(
            "[AdBlock] Initialisation segment changed, forcing a discontinuity"
          );
        }
        _лДобавитьРазрыв = true;
      }
      const оДобавлено = g_maQueue.Add(
        new Segment(
          PROCESSING_AWAITING_DOWNLOAD,
          oSegment.sAddress,
          oSegment.nDuration,
          oSegment.bDiscontinuity || _лДобавитьРазрыв
        )
      );
      // fMP4 segments carry their own initialisation segment and codec string, and
      // bypass the MPEG-TS transcoder entirely. See m_InitSegment.
      if (оНовыеСегменты.sInitSegmentUrl) {
        оДобавлено.sInitSegmentUrl = оНовыеСегменты.sInitSegmentUrl;
        оДобавлено.sCodecs = oSelectedVariant.sCodecs || "";
        оДобавлено.sResolution = oSelectedVariant.sResolution || "";
      }
      m_Log[оДобавлено.bDiscontinuity ? "Окак" : "Вот"](
        `[Список] Добавлен сегмент ${оДобавлено.nNumber} ПорядковыйНомер=${nSequenceNumber} Время=${oSegment.nTime} Длительность=${оДобавлено.nDuration} Разрыв=${оДобавлено.bDiscontinuity}`
      );
      кСегментовДобавлено++;
      кСекундДобавлено += оДобавлено.nDuration;
      _сДобавленныйИдТрансляции = оНовыеВарианты.sBroadcastId;
      _чДобавленныйИдСессии = оНовыеВарианты.nSessionId;
      _сДобавленныйИдВарианта = oSelectedVariant.sIdentifier;
      _чДобавленныйПорядковыйНомер = nSequenceNumber;
      _sAddedInitSegmentUrl = оНовыеСегменты.sInitSegmentUrl || "";
      if (!Number.isNaN(oSegment.nTime)) {
        _чДобавленноеВремя = oSegment.nTime;
      }
      _лДобавитьРазрыв = false;
    }
  }
  function получитьИнтервалОбновленияСпискаСегментов(
    oSegmentList,
    bShortenedInterval
  ) {
    let кСегментов = 0,
      чДлительностьСписка = 0;
    let чСредняяДлительностьСегмента,
      чМинДлительностьСегмента = Infinity,
      чМаксДлительностьСегмента = -Infinity;
    for (const { bAd, nDuration } of oSegmentList.moSegments) {
      if (!bAd && nDuration > 0) {
        кСегментов++;
        чДлительностьСписка += nDuration;
        чМинДлительностьСегмента = Math.min(
          чМинДлительностьСегмента,
          nDuration
        );
        чМаксДлительностьСегмента = Math.max(
          чМаксДлительностьСегмента,
          nDuration
        );
      }
    }
    if (кСегментов !== 0) {
      чСредняяДлительностьСегмента = чДлительностьСписка / кСегментов;
      m_Log.Вот(
        `[Список] ДлительностьСегментов=${m_Log.F2(
          чМинДлительностьСегмента
        )}<${m_Log.F2(чСредняяДлительностьСегмента)}<${m_Log.F2(
          чМаксДлительностьСегмента
        )} ДлительностьСписка=${m_Log.F1(чДлительностьСписка)} НеЗагружать=${oSegmentList.moSegments.length - кСегментов
        }`
      );
    } else {
      чСредняяДлительностьСегмента =
        чМинДлительностьСегмента =
        чМаксДлительностьСегмента =
        Math.max(oSegmentList.nTargetDuration / 3, 1);
      m_Log.Ой(
        `[Список] Предполагаемая длительность сегментов ${m_Log.F1(
          чСредняяДлительностьСегмента
        )}`
      );
    }
    return bShortenedInterval
      ? (чСредняяДлительностьСегмента / 2) * 1e3
      : чСредняяДлительностьСегмента * 1e3 - 16;
  }
  function получитьИнтервалОбновленияСпискаВариантов() {
    Check(_чСостояние === STATE_BROADCAST_END);
    if (_чИнтервалОбновленияСпискаВариантов === -1) {
      _чИнтервалОбновленияСпискаВариантов = 1e3;
    } else {
      _чИнтервалОбновленияСпискаВариантов = Math.min(
        _чИнтервалОбновленияСпискаВариантов + 1e3,
        3e4
      );
    }
    return _чИнтервалОбновленияСпискаВариантов;
  }
  function начатьТрансляцию() {
    if (_чСостояние !== STATE_BROADCAST_START) {
      _чСостояние = STATE_BROADCAST_START;
      g_maQueue.Add(
        new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_START)
      );
      m_Events.SendEvent("список-выбранварианттрансляции", [
        _оСпискиСРекламой.oVariantList.moVariants,
        _оСпискиСРекламой.oSelectedVariant,
      ]);
    }
  }
  function ЗавершитьТрансляцию() {
    if (_чСостояние !== STATE_BROADCAST_END) {
      _чСостояние = STATE_BROADCAST_END;
      _чИнтервалОбновленияСпискаВариантов = -1;
      g_maQueue.Add(
        new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_END)
      );
      m_Events.SendEvent("список-выбранварианттрансляции", [null, null]);
    }
    _оСпискиСРекламой.очистить();
    задатьСостояниеРекламы(false);
  }
  function ИзменитьВариантТрансляции(чВыбранныйВариант) {
    if (_оСпискиСРекламой.oVariantList !== null) {
      _оСпискиСРекламой.сохранитьВариантТрансляции(
        _оСпискиСРекламой.oVariantList.moVariants[чВыбранныйВариант]
      );
      _оСпискиСРекламой.oSelectedVariant = null;
      if (_чСостояние === STATE_BROADCAST_START) {
        _оСпискиСРекламой.stop();
        _оСпискиСРекламой.start();
        if (!_лИдетРеклама) {
          очиститьСтатистикуДобавления();
          g_maQueue.Add(
            new Segment(PROCESSING_DOWNLOADED, STATE_VARIANT_CHANGE)
          );
          м_Загрузчик.LoadNextSegment();
        }
      }
    }
  }
  function Stop() {
    _чСостояние = STATE_STOP;
    _оСпискиСРекламой.stop();
    очиститьСтатистикуДобавления();
    задатьСостояниеРекламы(false);
  }
  function Start() {
    Check(_чСостояние === STATE_STOP);
    _оСпискиСРекламой.start();
  }
  return {
    Start,
    Stop,
    ИзменитьВариантТрансляции,
  };
})();

/**
 * Cache of #EXT-X-MAP initialisation segments.
 *
 * An fMP4 (CMAF) playlist ships its `moov` box separately from the media segments,
 * and every run of segments needs it appended to the SourceBuffer first. Twitch
 * reuses one URI for a whole broadcast, so a single download serves the session.
 *
 * A failure here is not fatal: the segment is simply not ready yet, the transcoder
 * leaves its media segments queued, and the next call retries the download.
 */
const m_InitSegment = (() => {
  const REQUEST_TIMEOUT = 20000;

  /** @type {!Map<string, {data: ?Uint8Array}>} */
  const _amCache = new Map();

  /**
   * Returns the initialisation segment for a URI, starting its download the first
   * time it is asked for.
   *
   * @param {string} sUrl
   * @returns {?Uint8Array} The bytes, or null while the download is still running.
   */
  function Get(sUrl) {
    Check(IsNonEmptyString(sUrl));
    const oCached = _amCache.get(sUrl);
    if (oCached !== void 0) {
      return oCached.data;
    }

    const oEntry = { data: null };
    _amCache.set(sUrl, oEntry);
    m_Log.Окак(`[InitSegment] Downloading ${sUrl}`);
    try {
      м_Загрузчик
        .Load(
          new PromiseCancellation(),
          "GET",
          sUrl,
          REQUEST_TIMEOUT,
          null,
          null,
          "initialisation segment",
          false,
          0
        )
        .then((буфДанные) => {
          oEntry.data = new Uint8Array(буфДанные);
          m_Log.Окак(
            `[InitSegment] Downloaded ${oEntry.data.length} bytes`
          );
          // Media segments were parked waiting for this; let them through.
          м_Преобразователь.ConvertNextSegment();
        })
        .catch((pReason) => {
          // Drop the entry so the next segment retries rather than stalling forever.
          _amCache.delete(sUrl);
          m_Log.Ой(
            `[InitSegment] Download failed: ${ExceptionToString(pReason)}`
          );
        });
    } catch (pException) {
      _amCache.delete(sUrl);
      m_Log.Ой(
        `[InitSegment] Could not start download: ${ExceptionToString(
          pException
        )}`
      );
    }
    return null;
  }

  return { Get };
})();

const м_Преобразователь = (() => {
  let _oWorkerThread = null;
  // Media segments handed to the worker and not yet returned. fMP4 passthrough
  // waits for this to reach zero so converted segments cannot overtake them.
  let _nWorkerJobs = 0;
  let _чПоследнийЗагруженный = -1;
  function ConvertNextSegment() {
    let чУдалить,
      кУдалить = 0;
    for (
      let oSegment, чСегмент = 0;
      (oSegment = g_maQueue[чСегмент]);
      ++чСегмент
    ) {
      if (oSegment.nProcessing > PROCESSING_DOWNLOADED) {
        continue;
      }
      if (oSegment.nProcessing < PROCESSING_DOWNLOADED) {
        break;
      }
      if (
        _чПоследнийЗагруженный !== -1 &&
        _чПоследнийЗагруженный + 1 !== oSegment.nNumber
      ) {
        m_Log.Ой(
          `[Преобразование] Не загружены сегменты между ${_чПоследнийЗагруженный} и ${oSegment.nNumber}`
        );
        oSegment.bDiscontinuity = true;
      }
      _чПоследнийЗагруженный = oSegment.nNumber;
      if (typeof oSegment.pData == "number" && _oWorkerThread === null) {
        m_Log.Вот(
          `[Преобразование] Пропускаю сегмент ${oSegment.nNumber} Состояние=${oSegment.pData}`
        );
        oSegment.nProcessing = PROCESSING_CONVERTED;
        if (oSegment.pData === STATE_BROADCAST_START) {
          СоздатьРабочийПоток();
        }
      } else if (
        oSegment.sInitSegmentUrl &&
        typeof oSegment.pData != "number"
      ) {
        // fMP4 passthrough. The bytes are already a fragmented MP4, which is exactly
        // what the worker would have produced from MPEG-TS, so there is nothing to
        // demux. Convert in place: the segment keeps its position in the queue and
        // therefore its position in the stream.
        if (_nWorkerJobs !== 0) {
          // A transport-stream segment is still in the worker. Emitting now would
          // put this one ahead of it in the queue.
          break;
        }
        const mbInitSegment = m_InitSegment.Get(oSegment.sInitSegmentUrl);
        if (mbInitSegment === null) {
          // Still downloading. m_InitSegment calls us back when it lands.
          break;
        }
        m_Statistics.SourceSegmentReceived();
        m_Log.Вот(
          `[Transcoder] Segment ${oSegment.nNumber} is fMP4, no conversion needed`
        );
        oSegment.pData = BuildPassthroughData(oSegment, mbInitSegment);
        oSegment.nProcessing = PROCESSING_CONVERTED;
        m_Statistics.ConvertedSegmentReceived(oSegment);
      } else {
        if (typeof oSegment.pData == "number") {
          m_Log.Вот(
            `[Преобразование] Отсылаю сегмент ${oSegment.nNumber} Состояние=${oSegment.pData}`
          );
          _oWorkerThread.postMessage(oSegment);
        } else {
          m_Debug.SaveTransportStream(oSegment);
          m_Statistics.SourceSegmentReceived();
          m_Log.Вот(`[Преобразование] Отсылаю сегмент ${oSegment.nNumber}`);
          ++_nWorkerJobs;
          _oWorkerThread.postMessage(oSegment, [oSegment.pData]);
        }
        if (++кУдалить == 1) {
          чУдалить = чСегмент;
        }
      }
    }
    if (кУдалить !== 0) {
      g_maQueue.Remove(чУдалить, кУдалить);
    }
    m_Player.AddNextSegment();
  }
  /**
   * Wraps an already-fragmented MP4 segment in the shape the player expects back
   * from the worker, so nothing downstream needs to know where the bytes came from.
   *
   * @param {!Сегмент} оСегмент A downloaded segment whose пДанные is the raw ArrayBuffer.
   * @param {!Uint8Array} mbInitSegment The cached #EXT-X-MAP initialisation segment.
   * @returns {!Object}
   */
  function BuildPassthroughData(oSegment, mbInitSegment) {
    const sCodecs = oSegment.sCodecs;
    const oData = {
      bPassthrough: true,
      мбМедиасегмент: new Uint8Array(oSegment.pData),
      bHasVideo: /avc1|avc3|hvc1|hev1|av01|vp09/.test(sCodecs),
      bHasAudio: /mp4a|ac-3|ec-3|opus|fLaC/.test(sCodecs),
      nConvertedIn: 0,
    };
    if (oSegment.bDiscontinuity) {
      // The player appends this before the media segment and later hands it to the
      // recycler, which neuters the buffer — so every discontinuity gets its own copy.
      oData.mbInitializationSegment = mbInitSegment.slice();
      oData.sCodecs = `video/mp4;codecs="${sCodecs}"`;
      oData.sCodecsDescription = sCodecs;
      oData.sResolution = oSegment.sResolution;
    }
    return oData;
  }

  const ОбработатьОкончаниеПреобразования = AddExceptionHandler(
    (oEvent) => {
      const мДанные = oEvent.data;
      Check(Array.isArray(мДанные));
      switch (мДанные[0]) {
        case 1:
          Check(мДанные.length === 2 && IsObject(мДанные[1]));
          if (_nWorkerJobs !== 0) {
            --_nWorkerJobs;
          }
          const oSegment = new Segment(
            PROCESSING_CONVERTED,
            мДанные[1].pData,
            мДанные[1].nDuration,
            мДанные[1].bDiscontinuity,
            мДанные[1].nNumber
          );
          m_Log.Вот(
            `[Преобразование] Получен сегмент ${oSegment.nNumber
            } ПреобразованЗа=${m_Log.F0(oSegment.pData.nConvertedIn)}мс`
          );
          if (typeof oSegment.pData != "number") {
            m_Statistics.ConvertedSegmentReceived(oSegment);
            if (!oSegment.pData.hasOwnProperty("мбМедиасегмент")) {
              return;
            }
            m_Debug.SaveConvertedSegment(oSegment);
          }
          g_maQueue.Add(oSegment);
          m_Player.AddNextSegment();
          return;

        case 2:
          const мсВажность = мДанные[1],
            мсЗаписи = мДанные[2];
          Check(
            мДанные.length === 3 &&
            Array.isArray(мсВажность) &&
            Array.isArray(мсЗаписи) &&
            мсВажность.length === мсЗаписи.length
          );
          for (let idx = 0; idx < мсВажность.length; ++idx) {
            Check(
              (мсВажность[idx] === "Вот" ||
                мсВажность[idx] === "Окак" ||
                мсВажность[idx] === "Ой") &&
              typeof мсЗаписи[idx] == "string"
            );
            m_Log[мсВажность[idx]](мсЗаписи[idx]);
          }
          return;

        case 3:
          Check(
            мДанные.length === 3 &&
            typeof мДанные[1] == "string" &&
            typeof мДанные[2] == "object"
          );
          m_Debug.TerminateAndSendReport(мДанные[1], мДанные[2]);
          return;

        case 4:
          Check(мДанные.length === 2 && typeof мДанные[1] == "string");
          m_Debug.FinishWorkAndShowMessage(мДанные[1]);
          return;

        case 5:
          Check(мДанные.length === 2 && мДанные[1].byteLength);
          m_GarbageCollector.Discard(мДанные[1]);
          return;

        default:
          Check(false);
      }
    }
  );
  function ОбработатьОшибкуПреобразования(oEvent) {
    m_Debug.TerminateAndSendReport(
      `Event occurred: ${oEvent.type} в рабочем потоке в строке ${oEvent.lineno}. ${oEvent.message}`
    );
  }
  function СоздатьРабочийПоток() {
    m_Log.Вот("[Преобразование] Создаю рабочий поток");
    _nWorkerJobs = 0;
    _oWorkerThread = new Worker("/worker.js");
    _oWorkerThread.addEventListener(
      "message",
      ОбработатьОкончаниеПреобразования
    );
    _oWorkerThread.addEventListener("error", ОбработатьОшибкуПреобразования);
    _oWorkerThread.addEventListener(
      "messageerror",
      ОбработатьОшибкуПреобразования
    );
  }
  function Stop() {
    _чПоследнийЗагруженный = -1;
    if (_oWorkerThread) {
      m_Log.Вот("[Преобразование] Убиваю рабочий поток");
      _oWorkerThread.terminate();
      _oWorkerThread = null;
      _nWorkerJobs = 0;
    }
  }
  return {
    Stop,
    ConvertNextSegment,
  };
})();

const м_Загрузчик = (() => {
  const МАКС_КОЛИЧЕСТВО_ПОПЫТОК = 2;
  function LoadText(
    oPromiseCancellation,
    sAddress,
    чНеДольше,
    sLabel,
    лЖурнал,
    оЗаголовки = null,
    сМетод = "GET"
  ) {
    return Load(
      oPromiseCancellation,
      сМетод,
      sAddress,
      чНеДольше,
      оЗаголовки,
      null,
      sLabel,
      лЖурнал,
      "text"
    );
  }
  function ЗагрузитьJson(
    oPromiseCancellation,
    sAddress,
    чНеДольше,
    sLabel,
    лЖурнал,
    оЗаголовки = null,
    сМетод = "GET"
  ) {
    return Load(
      oPromiseCancellation,
      сМетод,
      sAddress,
      чНеДольше,
      оЗаголовки,
      null,
      sLabel,
      лЖурнал,
      "json"
    );
  }
  function Load(
    oPromiseCancellation,
    сМетод,
    sAddress,
    чНеДольше,
    оЗаголовки,
    пТело,
    sLabel,
    лЖурнал,
    пТипДанных
  ) {
    if (g_bWorkFinished) {
      throw void 0;
    }
    Check(
      сМетод === "GET" ||
      сМетод === "PUT" ||
      сМетод === "DELETE" ||
      сМетод === "POST"
    );
    Check(typeof sAddress == "string");
    Check(
      Number.isFinite(чНеДольше) && (чНеДольше === 0 || чНеДольше > 1e3)
    );
    Check(
      пТело === null ||
      (сМетод !== "GET" &&
        (пТело instanceof URLSearchParams ||
          (typeof пТело == "string" &&
            оЗаголовки &&
            IsNonEmptyString(оЗаголовки["Content-Type"]))))
    );
    Check(
      typeof оЗаголовки == "object" &&
      typeof sLabel == "string" &&
      typeof лЖурнал == "boolean"
    );
    Check(
      пТипДанных === "none" ||
      пТипДанных === "text" ||
      пТипДанных === "json" ||
      Number.isFinite(пТипДанных)
    );
    if (oPromiseCancellation && oPromiseCancellation.bCancelled) {
      return Promise.reject(PromiseCancellation.REASON);
    }
    m_Log.Вот(
      `[Загрузчик] ${сМетод} ${sLabel} не дольше ${m_Log.F0(чНеДольше)}мс`
    );
    м_Twitch.проверитьДоступностьАдреса(sAddress);
    const oRequest = new XMLHttpRequest();
    oRequest._сМетод = сМетод;
    oRequest._sUrl = sAddress;
    oRequest._чНеДольше = чНеДольше;
    oRequest._oHeaders = оЗаголовки;
    oRequest._pBody = пТело;
    oRequest._sName = sLabel;
    oRequest._bLog = лЖурнал;
    oRequest._pDataType = пТипДанных;
    oRequest._кОсталосьПопыток =
      typeof пТипДанных == "number" ? 1 : МАКС_КОЛИЧЕСТВО_ПОПЫТОК;
    oRequest._чВремяОтправкиЗапроса = performance.now();
    oRequest._nResponseWait = NaN;
    oRequest.addEventListener("timeout", ОбработатьОшибку);
    oRequest.addEventListener("error", ОбработатьОшибку);
    oRequest.addEventListener("abort", ОбработатьОшибку);
    oRequest.addEventListener("load", ОбработатьОкончаниеЗагрузки);
    if (лЖурнал && typeof пТипДанных == "number") {
      oRequest.addEventListener("readystatechange", ОбработатьПолучениеОтвета);
    }
    return new Promise((fResolve, fReject) => {
      oRequest._fResolve = fResolve;
      oRequest._fReject = fReject;
      if (oPromiseCancellation) {
        oRequest._oPromiseCancel = oPromiseCancellation;
        oPromiseCancellation.ReplaceHandler(
          ПолучитьОбработчикОтменыОбещания(oRequest)
        );
      }
      ПослатьЗапрос(oRequest, false);
    });
  }
  function ПослатьЗапрос(oRequest, лПовторно) {
    if (oRequest._кОсталосьПопыток === 0) {
      return false;
    }
    if (лПовторно) {
      m_Log.Ой(`[Загрузчик] Повторно загружаю ${oRequest._sName}`);
    }
    oRequest._кОсталосьПопыток--;
    oRequest.open(oRequest._сМетод, oRequest._sUrl);
    oRequest.responseType =
      typeof oRequest._pDataType == "number" ? "arraybuffer" : "text";
    oRequest.timeout = oRequest._чНеДольше;
    if (oRequest._oHeaders) {
      for (let sTitle of Object.keys(oRequest._oHeaders)) {
        oRequest.setRequestHeader(sTitle, oRequest._oHeaders[sTitle]);
      }
    }
    if (oRequest._pBody instanceof URLSearchParams) {
      oRequest.setRequestHeader(
        "Content-Type",
        "application/x-www-form-urlencoded; charset=UTF-8"
      );
      oRequest.send(oRequest._pBody.toString());
    } else {
      oRequest.send(oRequest._pBody);
    }
    return true;
  }
  function ПолучитьОбработчикОтменыОбещания(oRequest) {
    return () => {
      m_Log.Вот(
        `[Загрузчик] Отменяю загрузку ${oRequest._sName} readyState=${oRequest.readyState}`
      );
      oRequest.removeEventListener("abort", ОбработатьОшибку);
      oRequest.abort();
      oRequest._fReject(PromiseCancellation.REASON);
    };
  }
  const ОбработатьПолучениеОтвета = AddExceptionHandler(
    ({ target: oRequest }) => {
      if (oRequest.readyState >= XMLHttpRequest.HEADERS_RECEIVED) {
        oRequest.removeEventListener(
          "readystatechange",
          ОбработатьПолучениеОтвета
        );
        Check(Number.isNaN(oRequest._nResponseWait));
        oRequest._nResponseWait = Math.round(
          performance.now() - oRequest._чВремяОтправкиЗапроса
        );
      }
    }
  );
  const ОбработатьОшибку = AddExceptionHandler(
    ({ target: oRequest, type: сТипСобытия }) => {
      m_Log.Ой(
        `[Загрузчик] Не удалось загрузить ${oRequest._sName}. Event occurred: ${сТипСобытия}` +
        ` readyState=${oRequest.readyState}` +
        (oRequest._bLog && typeof oRequest._pDataType == "number"
          ? ` ОжиданиеОтвета=${oRequest._nResponseWait}мс`
          : ``)
      );
      if (сТипСобытия === "abort" || !ПослатьЗапрос(oRequest, true)) {
        if (oRequest.responseType === "arraybuffer") {
          m_Statistics.SegmentLoaded(NaN, NaN, NaN, oRequest._nResponseWait);
        }
        oRequest._oPromiseCancel &&
          oRequest._oPromiseCancel.ReplaceHandler(null);
        oRequest._fReject(`Event occurred: ${сТипСобытия}`);
      }
    }
  );
  const ОбработатьОкончаниеЗагрузки = AddExceptionHandler(
    ({ target: oRequest }) => {
      Check(oRequest.readyState === XMLHttpRequest.DONE);
      const nCode = oRequest.status;
      if (
        nCode >= 200 &&
        nCode <= 299 &&
        (oRequest._pDataType === "none" || oRequest.response !== null)
      ) {
        const чДлительностьЗагрузки = Math.round(
          performance.now() - oRequest._чВремяОтправкиЗапроса
        );
        oRequest._oPromiseCancel &&
          oRequest._oPromiseCancel.ReplaceHandler(null);
        m_Log.Вот(
          `[Загрузчик] Загрузил ${oRequest._sName} за ${чДлительностьЗагрузки}мс` +
          (oRequest._bLog && typeof oRequest._pDataType == "number"
            ? ` ОжиданиеОтвета=${oRequest._nResponseWait}мс`
            : ``) +
          (typeof oRequest._pDataType == "number"
            ? ` Отношение=${m_Log.F1(
              чДлительностьЗагрузки / oRequest._pDataType / 1e3
            )}`
            : ``) +
          (nCode === 200 ? `` : ` Код=${nCode} ${oRequest.statusText}`) +
          (oRequest._pDataType === "none"
            ? ""
            : oRequest._bLog && IsNonEmptyString(oRequest.response)
              ? `\n${oRequest.response}`
              : oRequest.responseType === "arraybuffer"
                ? ` Размер=${oRequest.response.byteLength}байт`
                : ` Размер=${oRequest.response.length}символов`)
        );
        if (oRequest._чНеДольше !== 0) {
          m_Statistics.SomethingDownloaded(ПолучитьРазмерОтвета(oRequest));
        }
        switch (oRequest._pDataType) {
          case "none":
            oRequest._fResolve();
            break;

          case "text":
            oRequest._fResolve(oRequest.response);
            break;

          case "json":
            try {
              oRequest._fResolve(JSON.parse(oRequest.response));
            } catch (pException) {
              m_Log.Ой(
                `[Загрузчик] Не удалось разобрать ${oRequest._sName}. ${pException}`
              );
              oRequest._fReject("Failed to parse JSON");
            }
            break;

          default:
            m_Statistics.SegmentLoaded(
              oRequest.response.byteLength,
              oRequest._pDataType,
              чДлительностьЗагрузки,
              oRequest._nResponseWait
            );
            oRequest._fResolve(oRequest.response);
        }
      } else {
        m_Log.Ой(
          `[Загрузчик] Не удалось загрузить ${oRequest._sName}. ${КОД_ОТВЕТА + nCode
          } ${oRequest.statusText}` +
          (oRequest._bLog && typeof oRequest._pDataType == "number"
            ? ` ОжиданиеОтвета=${oRequest._nResponseWait}мс`
            : ``) +
          (IsNonEmptyString(oRequest.response)
            ? `\n${oRequest.response}`
            : oRequest.response === null
              ? " response=null"
              : oRequest.responseType === "arraybuffer"
                ? ` Размер=${oRequest.response.byteLength}байт`
                : ` Размер=${oRequest.response.length}символов`)
        );
        if (
          (nCode >= 400 && nCode <= 499) ||
          oRequest.response === null ||
          !ПослатьЗапрос(oRequest, true)
        ) {
          if (oRequest.responseType === "arraybuffer") {
            m_Statistics.SegmentLoaded(
              NaN,
              NaN,
              NaN,
              oRequest._nResponseWait
            );
          }
          oRequest._oPromiseCancel &&
            oRequest._oPromiseCancel.ReplaceHandler(null);
          oRequest._fReject(КОД_ОТВЕТА + nCode);
        }
      }
    }
  );
  function ПолучитьРазмерОтвета(oRequest) {
    let кбРазмерЗаголовков =
      17 + oRequest.statusText.length + oRequest.getAllResponseHeaders().length;
    if (ЭтоHTTP2(oRequest)) {
      кбРазмерЗаголовков = Math.round(кбРазмерЗаголовков * 0.5);
    }
    let кбРазмерТела;
    let sTitle = oRequest.getResponseHeader("Content-Length");
    if (sTitle) {
      кбРазмерТела = Number.parseInt(sTitle, 10);
    } else if (oRequest.responseType === "arraybuffer") {
      кбРазмерТела = oRequest.response.byteLength;
    } else {
      кбРазмерТела = oRequest.response.length;
      sTitle = oRequest.getResponseHeader("Content-Encoding");
      if (sTitle && sTitle !== "identity") {
        кбРазмерТела = Math.round(кбРазмерТела * 0.35);
      }
    }
    return кбРазмерЗаголовков + кбРазмерТела;
  }
  function ЭтоHTTP2(oRequest) {
    return oRequest.statusText.length === 0;
  }
  function LoadNextSegment() {
    let h = g_maQueue.length - 1;
    if (
      h >= 0 &&
      g_maQueue[h].pData === STATE_VARIANT_CHANGE &&
      g_maQueue[h].nProcessing === PROCESSING_DOWNLOADED
    ) {
      g_maQueue.ShowState();
      while (--h >= 0 && g_maQueue[h].nProcessing <= PROCESSING_DOWNLOADED) {
        if (typeof g_maQueue[h].pData != "number") {
          g_maQueue.Remove(h);
        }
      }
      g_maQueue.ShowState();
    } else {
      let кОдновременныхЗагрузок = m_Settings.Get(
        "кОдновременныхЗагрузок"
      );
      let чДлительностьВсехЗагрузок = 0;
      for (let oSegment of g_maQueue) {
        if (oSegment.nProcessing <= PROCESSING_DOWNLOADED) {
          чДлительностьВсехЗагрузок += oSegment.nDuration;
          if (oSegment.nProcessing <= PROCESSING_DOWNLOADING) {
            --кОдновременныхЗагрузок;
            if (
              oSegment.nProcessing === PROCESSING_AWAITING_DOWNLOAD &&
              кОдновременныхЗагрузок >= 0
            ) {
              ЗагрузитьСегмент(oSegment);
            }
          }
        }
      }
      const чПереполнениеОчереди =
        m_Settings.Get("чМаксРазмерБуфера") +
        m_Settings.Get("чРастягиваниеБуфера");
      if (чДлительностьВсехЗагрузок > чПереполнениеОчереди) {
        m_Log.Ой(
          `[Загрузчик] Длительность всех загрузок в очереди ${m_Log.F1(
            чДлительностьВсехЗагрузок
          )}с > ${m_Log.F1(чПереполнениеОчереди)}с`
        );
        ОбработатьНеудачнуюЗагрузкуСегмента(null);
        LoadNextSegment();
        return;
      }
    }
    м_Преобразователь.ConvertNextSegment();
  }
  function ЗагрузитьСегмент(oSegment) {
    const sAddress = oSegment.pData;
    oSegment.pData = new PromiseCancellation();
    oSegment.nProcessing = PROCESSING_DOWNLOADING;
    Load(
      oSegment.pData,
      "GET",
      sAddress,
      ЗагружатьСегментНеДольше(oSegment),
      null,
      null,
      `сегмент ${oSegment.nNumber}`,
      m_Statistics.WindowOpened(),
      oSegment.nDuration
    )
      .then((буфДанные) => {
        Check(g_maQueue.includes(oSegment));
        oSegment.pData = буфДанные;
        oSegment.nProcessing = PROCESSING_DOWNLOADED;
        LoadNextSegment();
      })
      .catch(
        AddExceptionHandler((pReason) => {
          if (
            typeof pReason == "string" &&
            oSegment.nProcessing === PROCESSING_DOWNLOADING
          ) {
            Check(g_maQueue.includes(oSegment));
            ОбработатьНеудачнуюЗагрузкуСегмента(
              pReason.sReason === КОД_ОТВЕТА + 404 ||
                pReason.sReason === КОД_ОТВЕТА + 410
                ? null
                : oSegment
            );
            Check(!g_maQueue.includes(oSegment));
            LoadNextSegment();
          } else if (pReason === PromiseCancellation.REASON) {
            m_Log.Вот(
              `[Загрузчик] Отменена загрузка сегмента ${oSegment.nNumber}`
            );
            Check(!g_maQueue.includes(oSegment));
          } else {
            throw pReason;
          }
        })
      );
  }
  function ЗагружатьСегментНеДольше(oSegment) {
    const чПеременная =
      oSegment.nDuration *
      m_Settings.Get("кОдновременныхЗагрузок") *
      1.15;
    const чПостоянная = 8;
    return (чПеременная + чПостоянная) * 1e3;
  }
  function ОбработатьНеудачнуюЗагрузкуСегмента(оНезагруженныйСегмент) {
    g_maQueue.ShowState();
    const кВОчереди = g_maQueue.length;
    if (оНезагруженныйСегмент) {
      g_maQueue.Remove(оНезагруженныйСегмент);
    } else {
      let чРазмерБуфера = m_Settings.Get("чРазмерБуфера");
      for (let oSegment, idx = кВОчереди; (oSegment = g_maQueue[--idx]);) {
        if (oSegment.nProcessing === PROCESSING_AWAITING_DOWNLOAD) {
          if (чРазмерБуфера > 0) {
            чРазмерБуфера -= oSegment.nDuration;
          } else {
            g_maQueue.Remove(idx);
          }
        } else if (oSegment.nProcessing === PROCESSING_DOWNLOADING) {
          g_maQueue.Remove(idx);
        }
      }
    }
    g_maQueue.ShowState();
    m_Statistics.SegmentsNotLoaded(кВОчереди - g_maQueue.length);
  }
  const обработатьИзменениеСети = AddExceptionHandler((oEvent) => {
    m_Log.Ой(
      `[Загрузчик] Событие ${oEvent.type} navigator.onLine=${navigator.onLine
      } connection.type=${navigator.connection && navigator.connection.type}`
    );
  });
  if (navigator.connection) {
    navigator.connection.addEventListener(
      "onchange" in navigator.connection ? "change" : "typechange",
      обработатьИзменениеСети
    );
  } else {
    window.addEventListener("online", обработатьИзменениеСети);
    window.addEventListener("offline", обработатьИзменениеСети);
  }
  if (!navigator.onLine) {
    m_Log.Ой("[Загрузчик] navigator.onLine=false");
  }
  return {
    Load,
    LoadText,
    ЗагрузитьJson,
    LoadNextSegment,
  };
})();

const м_Twitch = (() => {
  const ИНТЕРВАЛ_ОБНОВЛЕНИЯ_МЕТАДАННЫХ_ТРАНСЛЯЦИИ = 6e4;
  const ИНТЕРВАЛ_СЛЕЖЕНИЯ_ЗА_ПРОСМОТРОМ = 6e4;
  let _сАдресСлеженияЗаПросмотром = "https://spade.twitch.tv/track";
  let _сКодКанала = "";
  let _сИдКанала = "";
  let _сИдТрансляции = "";
  let _сАдресЗаписи = "";
  let _сИдУстройства = "";
  let _сИдЗрителя = "";
  let _сКодЗрителя = "";
  let _сТокенЗрителя = "";
  let _сИмяЗрителя = "";
  let _сТокенGql = "";
  let _чТокенGqlПротухнетПосле = 0;
  let _sPlaySessionID = "";
  let _оОтменаОбновленияМетаданных = null;
  let _чТаймерСлеженияЗаПросмотром = 0;
  function ОчиститьДанныеТрансляции() {
    _сИдТрансляции = _сАдресЗаписи = "";
  }
  function GetChannelUrl(лНеПеренаправлять) {
    return лНеПеренаправлять
      ? `https://www.twitch.tv/${encodeURIComponent(
        _сКодКанала
      )}?${DO_NOT_REDIRECT_ADDRESS}`
      : `https://www.twitch.tv/${encodeURIComponent(_сКодКанала)}`;
  }
  function ПолучитьАдресПанелиЧата() {
    if (m_Settings.Get("лПолноценныйЧат")) {
      return `https://www.twitch.tv/popout/${encodeURIComponent(
        _сКодКанала
      )}/chat?no-mobile-redirect=true&popout=`;
    }
    return `https://www.twitch.tv/embed/${encodeURIComponent(
      _сКодКанала
    )}/chat?${m_Settings.Get("лЗатемнитьЧат") ? "darkpopout&" : ""
      }parent=localhost`;
  }
  function ПолучитьАдресЗаписи(сИдЗаписи) {
    Check(IsNonEmptyString(сИдЗаписи));
    return `https://www.twitch.tv/videos/${encodeURIComponent(сИдЗаписи)}`;
  }
  function получитьАдресКатегории(сИмяКатегории) {
    Check(IsNonEmptyString(сИмяКатегории));
    return `https://www.twitch.tv/directory/category/${encodeURIComponent(
      сИмяКатегории
    )}`;
  }
  function получитьАдресКоманды(сИмяКоманды) {
    Check(IsNonEmptyString(сИмяКоманды));
    return `https://www.twitch.tv/team/${encodeURIComponent(сИмяКоманды)}`;
  }
  function проверитьДоступностьАдреса(sAddress) {
    if (
      !/^https?:\/\/(?:[^/]+\.)?(?:twitch\.tv|twitchcdn\.net|ttvnw\.net|jtvnw\.net|live-video\.net|akamaized\.net|cloudfront\.net)\//.test(
        sAddress
      )
    ) {
      throw new Error(`Unknown address: ${sAddress}`);
    }
  }
  function создатьУникальныйИдентификатор(кДлина) {
    Check(Number.isInteger(кДлина) && кДлина > 0);
    const сДопустимыеСимволы =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let sResult = "";
    while (sResult.length !== кДлина) {
      sResult +=
        сДопустимыеСимволы[
        Math.floor(Math.random() * сДопустимыеСимволы.length)
        ];
    }
    return sResult;
  }
  получитьТокенGql._oPromise = null;
  получитьТокенGql.fGqlTokenChanged = null;
  function получитьТокенGql() {
    const ЖДАТЬ_ПОЛУЧЕНИЯ_ТОКЕНА = 3e4;
    if (получитьТокенGql._oPromise === null) {
      получитьТокенGql._oPromise = new Promise((fResolve, fReject) => {
        m_Log.Окак("[Twitch] Вставляю фрейм для перехвата токена GQL");
        const элФрейм = document.createElement("iframe");
        элФрейм.src = "https://www.twitch.tv/popout/";
        элФрейм.id = "токенgql";
        элФрейм.hidden = true;
        Check(!document.getElementById(элФрейм.id));
        document.body.appendChild(элФрейм);
        const nTimer = setTimeout(
          AddExceptionHandler(() => {
            m_Log.Ой("[Twitch] Истекло время получения токена GQL");
            элФрейм.remove();
            получитьТокенGql._oPromise = получитьТокенGql.fGqlTokenChanged =
              null;
            fReject("ОТКАЗАНО_В_ДОСТУПЕ");
          }),
          ЖДАТЬ_ПОЛУЧЕНИЯ_ТОКЕНА
        );
        получитьТокенGql.fGqlTokenChanged = () => {
          if (_сТокенGql !== "") {
            clearTimeout(nTimer);
            элФрейм.remove();
            получитьТокенGql._oPromise = получитьТокенGql.fGqlTokenChanged =
              null;
            fResolve(_сТокенGql);
          }
        };
      });
    }
    return получитьТокенGql._oPromise;
  }
  function отправитьЗапросGql(
    oPromiseCancellation,
    sQuery,
    oVariables,
    лПосылатьТокенЗрителя,
    лПосылатьТокенGql,
    лПовторятьЗапрос,
    сНазваниеЗагрузки,
    чЗагружатьНеДольше = LOAD_METADATA_NO_LONGER_THAN
  ) {
    const ПОВТОРЯТЬ_ЗАПРОС_ЧЕРЕЗ = 5e3;
    Check(IsNonEmptyString(_сИдУстройства));
    if (oVariables !== null) {
      sQuery = createGqlRequestBody(sQuery, oVariables);
    }
    const оЗаголовкиЗапроса = {
      "Accept-Language": "en-US",
      "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      "Content-Type": "text/plain; charset=UTF-8",
      "X-Device-ID": _сИдУстройства,
    };
    if (лПосылатьТокенЗрителя && _сТокенЗрителя) {
      оЗаголовкиЗапроса.Authorization = `OAuth ${_сТокенЗрителя}`;
    }
    let лСвежийТокен = false;
    let oPromise;
    if (лПосылатьТокенGql) {
      if (_сТокенGql !== "" && _чТокенGqlПротухнетПосле > Date.now()) {
        m_Log.Вот(
          `[Twitch] Токен GQL протухнет через ${m_Log.F0(
            (_чТокенGqlПротухнетПосле - Date.now()) / 1e3
          )}с`
        );
        оЗаголовкиЗапроса["Client-Integrity"] = _сТокенGql;
        oPromise = Promise.resolve();
      } else {
        лСвежийТокен = true;
        oPromise = получитьТокенGql().then((sToken) => {
          оЗаголовкиЗапроса["Client-Integrity"] = sToken;
        });
      }
    } else {
      oPromise = Promise.resolve();
    }
    return oPromise
      .then(() =>
        м_Загрузчик.Load(
          oPromiseCancellation,
          "POST",
          "https://gql.twitch.tv/gql",
          чЗагружатьНеДольше,
          оЗаголовкиЗапроса,
          sQuery,
          сНазваниеЗагрузки,
          true,
          "json"
        )
      )
      .then((oResult) => {
        if (!oResult.errors) {
          return oResult;
        }
        let oPromise;
        if (
          oResult.errors.some(
            ({ message }) => message === "failed integrity check"
          )
        ) {
          m_Log.Ой("[Twitch] Серверу не понравился токен GQL");
          if (
            оЗаголовкиЗапроса["Client-Integrity"] === _сТокенGql &&
            _сТокенGql !== ""
          ) {
            очиститьТокенGql();
          }
          if (!лПосылатьТокенGql || лСвежийТокен) {
            throw "ОТКАЗАНО_В_ДОСТУПЕ";
          }
          if (
            оЗаголовкиЗапроса["Client-Integrity"] !== _сТокенGql &&
            _сТокенGql !== ""
          ) {
            оЗаголовкиЗапроса["Client-Integrity"] = _сТокенGql;
            oPromise = Promise.resolve();
          } else {
            oPromise = получитьТокенGql().then((sToken) => {
              оЗаголовкиЗапроса["Client-Integrity"] = sToken;
            });
          }
        } else if (
          oResult.errors.some(({ message }) => message === "service timeout")
        ) {
          if (!лПовторятьЗапрос) {
            m_Log.Ой("[Twitch] Сервер GQL занят");
            return oResult;
          }
          const повторитьЧерез =
            ПОВТОРЯТЬ_ЗАПРОС_ЧЕРЕЗ +
            (ПОВТОРЯТЬ_ЗАПРОС_ЧЕРЕЗ / 2) * Math.random();
          m_Log.Ой(
            `[Twitch] Сервер GQL занят. Запрос будет повторно отправлен через ${повторитьЧерез.toFixed()}мс`
          );
          oPromise = Wait(oPromiseCancellation, повторитьЧерез);
        } else {
          m_Log.Ой("[Twitch] В ответе GQL есть неизвестные ошибки");
          return oResult;
        }
        return oPromise
          .then(() =>
            м_Загрузчик.Load(
              oPromiseCancellation,
              "POST",
              "https://gql.twitch.tv/gql",
              чЗагружатьНеДольше,
              оЗаголовкиЗапроса,
              sQuery,
              сНазваниеЗагрузки,
              true,
              "json"
            )
          )
          .then((oResult) => {
            if (oResult.errors) {
              if (
                oResult.errors.some(
                  ({ message }) => message === "failed integrity check"
                )
              ) {
                m_Log.Ой("[Twitch] Серверу не понравился токен GQL");
                if (
                  оЗаголовкиЗапроса["Client-Integrity"] === _сТокенGql &&
                  _сТокенGql !== ""
                ) {
                  очиститьТокенGql();
                }
                throw "ОТКАЗАНО_В_ДОСТУПЕ";
              }
              m_Log.Ой(
                oResult.errors.some(
                  ({ message }) => message === "service timeout"
                )
                  ? "[Twitch] Сервер GQL занят"
                  : "[Twitch] В ответе GQL есть неизвестные ошибки"
              );
            }
            return oResult;
          });
      });
  }
  function ChangeViewerChannelSubscription(nSubscription) {
    Check(_сИдКанала && _сИдЗрителя && _сТокенЗрителя);
    Check(_сИдКанала !== _сИдЗрителя);
    switch (nSubscription) {
      case SUBSCRIPTION_NOT_SUBSCRIBED:
        неОтслеживатьКанал();
        break;

      case SUBSCRIPTION_DO_NOT_NOTIFY:
      case SUBSCRIPTION_NOTIFY:
        отслеживатьКанал(nSubscription);
        break;

      default:
        Check(false);
    }
  }
  function неОтслеживатьКанал() {
    отправитьЗапросGql(
      null,
      `mutation($input: UnfollowUserInput!) {\n\t\t\t\tunfollowUser(input: $input) {\n\t\t\t\t\t__typename\n\t\t\t\t}\n\t\t\t}`,
      {
        input: {
          targetID: _сИдКанала,
        },
      },
      true,
      true,
      true,
      "не отслеживать канал"
    )
      .then((oResult) => {
        if (
          oResult.errors ||
          !oResult.data ||
          !oResult.data.unfollowUser
        ) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-полученыметаданныезрителя", {
          nSubscription: SUBSCRIPTION_NOT_SUBSCRIBED,
        });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Ой(`[Twitch] Не удалось не отслеживать канал. ${pReason}`);
          m_Notification.ShowAss();
          m_Events.SendEvent("twitch-полученыметаданныезрителя", {
            nSubscription: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function отслеживатьКанал(nSubscription) {
    отправитьЗапросGql(
      null,
      `mutation($input: FollowUserInput!) {
				followUser(input: $input) {
					error {
						code
					}
					follow {
						user {
							id
						}
					}
				}
			}`,
      {
        input: {
          disableNotifications: nSubscription === SUBSCRIPTION_DO_NOT_NOTIFY,
          targetID: _сИдКанала,
        },
      },
      true,
      true,
      true,
      "отслеживать канал"
    )
      .then((oResult) => {
        if (
          oResult.errors ||
          !oResult.data ||
          !oResult.data.followUser ||
          !oResult.data.followUser.follow ||
          !oResult.data.followUser.follow.user ||
          oResult.data.followUser.error
        ) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-полученыметаданныезрителя", {
          nSubscription,
        });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Ой(`[Twitch] Не удалось отслеживать канал. ${pReason}`);
          m_Notification.ShowAss();
          m_Events.SendEvent("twitch-полученыметаданныезрителя", {
            nSubscription: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function этоРекламныйСегмент(sSegmentName) {
    return sSegmentName !== "" && sSegmentName !== "live";
  }
  let _оНужноОтправить = null;
  function sendAdTrackingData(oSegmentList) {
    if (
      _оНужноОтправить !== null &&
      (oSegmentList === null ||
        _оНужноОтправить.sAdToken !== oSegmentList.sAdToken)
    ) {
      отправитьПросмотрРекламногоБлока(_оНужноОтправить);
      _оНужноОтправить = null;
    }
    if (
      _оНужноОтправить === null &&
      oSegmentList !== null &&
      oSegmentList.sAdType
    ) {
      _оНужноОтправить = oSegmentList;
    }
  }
  function отправитьПросмотрРекламногоБлока(oSegmentList) {
    Wait(null, 3e3)
      .then(() => {
        return отправитьЗапросGql(
          null,
          combineGqlRequests([
            создатьСобытиеРекламы("video_ad_impression", oSegmentList),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              oSegmentList,
              1
            ),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              oSegmentList,
              2
            ),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              oSegmentList,
              3
            ),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              oSegmentList,
              4
            ),
            создатьСобытиеРекламы("video_ad_pod_complete", oSegmentList),
          ]),
          null,
          true,
          false,
          false,
          `${oSegmentList.sAdType
          } ${oSegmentList.sAdToken.slice(-10)}`,
          3e4
        );
      })
      .then((моРезультаты) => {
        for (const oResult of моРезультаты) {
          if (
            oResult.errors ||
            !oResult.data ||
            !oResult.data.recordAdEvent ||
            oResult.data.recordAdEvent.error
          ) {
            throw `Server could not complete the operation: ${m_Log.O(
              oResult
            )}`;
          }
        }
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Ой(
            `[Twitch] Не удалось отправить данные слежения за рекламой. ${pReason}`
          );
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function создатьСобытиеРекламы(
    сИмяСобытия,
    oSegmentList,
    чНомерКвартеля
  ) {
    const оДетали = {
      stitched: true,
      player_mute: true,
      player_volume: 0.5,
      visible: true,
      roll_type: oSegmentList.sAdType.toLowerCase(),
    };
    switch (сИмяСобытия) {
      case "video_ad_quartile_complete":
        оДетали.quartile = чНомерКвартеля;

      case "video_ad_impression":
        оДетали.total_ads = oSegmentList.кРоликов;
        оДетали.ad_position = oSegmentList.чНомерРолика + 1;
        оДетали.duration = Math.round(
          oSegmentList.чПродолжительностьРолика
        );
        оДетали.ad_id = oSegmentList.сИдРолика1;
        оДетали.creative_id = oSegmentList.сИдРолика2;
        оДетали.line_item_id = oSegmentList.сИдРолика3;
        оДетали.order_id = oSegmentList.сИдРолика4;
        break;

      case "video_ad_pod_complete":
        оДетали.ad_session_id = oSegmentList.сИдРолика5;
        оДетали.format_name = oSegmentList.сИдРолика6;
        break;

      default:
        Check(false);
    }
    return createGqlRequestBody(
      `mutation($input: RecordAdEventInput!) {
				recordAdEvent(input: $input) {
					error {
						code
					}
				}
			}`,
      {
        input: {
          eventName: сИмяСобытия,
          eventPayload: JSON.stringify(оДетали),
          radToken: oSegmentList.sAdToken,
        },
      }
    );
  }
  GetAbsoluteVariantListUrl._чПротухнетПосле = -1;
  GetAbsoluteVariantListUrl._sUrl = "";
  function GetAbsoluteVariantListUrl(
    oPromiseCancellation,
    лБезHttps,
    bWithoutAds
  ) {
    const ТОКЕН_ПРОТУХНЕТ_ЧЕРЕЗ = 15 * 60 * 1e3;
    if (!bWithoutAds) {
      const чПротухнетЧерез =
        GetAbsoluteVariantListUrl._чПротухнетПосле -
        performance.now();
      if (чПротухнетЧерез > 0) {
        m_Log.Вот(
          `[Twitch] До протухания токена трансляции осталось ${m_Log.F0(
            чПротухнетЧерез / 1e3
          )}с`
        );
        return Promise.resolve(GetAbsoluteVariantListUrl._sUrl);
      }
    }
    return отправитьЗапросGql(
      oPromiseCancellation,
      `query(
				$login: String!
				$playerType: String!
				$disableHTTPS: Boolean!
			) {
				streamPlaybackAccessToken(
					channelName: $login
					params: {
						disableHTTPS: $disableHTTPS
						playerType: $playerType
						platform: "web"
						playerBackend: "mediaplayer"
					}
				) {
					value
					signature
				}
			}`,
      {
        login: _сКодКанала,
        playerType: bWithoutAds ? "picture-by-picture" : "site",
        disableHTTPS: лБезHttps,
      },
      true,
      false,
      true,
      `токен трансляции ${+bWithoutAds}`
    ).then((oResult) => {
      const sToken = chain(
        oResult.data,
        "streamPlaybackAccessToken",
        "value"
      );
      const сПодпись = chain(
        oResult.data,
        "streamPlaybackAccessToken",
        "signature"
      );
      m_Debug.saveBroadcastToken(
        `ИдУстройства=${_сИдУстройства} ТокенЗрителя=${Boolean(
          _сТокенЗрителя
        )}\n${sToken}`,
        bWithoutAds
      );
      if (!IsNonEmptyString(sToken) || !IsNonEmptyString(сПодпись)) {
        if (oResult.errors) {
          throw "Server could not complete the operation";
        }
        m_Debug.FinishWorkAndShowMessage("J0203");
      }
      const оТокен = JSON.parse(sToken);
      Check(оТокен.channel === _сКодКанала);
      if (оТокен.ci_gb) {
        m_Debug.FinishWorkAndShowMessage("J0217");
      }
      if (_сИдКанала === "") {
        Check(оТокен.channel_id);
        _сИдКанала = String(оТокен.channel_id);
        setTimeout(
          AddExceptionHandler(обновитьМетаданныеЗрителяИКанала)
        );
      } else {
        Check(_сИдКанала === String(оТокен.channel_id));
      }
      let sAddress =
        `${лБезHttps ? "http" : "https"
        }://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(
          _сКодКанала
        )}.m3u8` +
        "?allow_source=true" +
        "&allow_audio_only=true" +
        "&cdm=wv" +
        "&fast_bread=true" +
        "&platform=web" +
        "&player_backend=mediaplayer" +
        "&playlist_include_framerate=true" +
        "&reassignments_supported=true" +
        "&supported_codecs=h264" +
        "&transcode_mode=cbr_v1" +
        `&p=${Math.floor(Math.random() * 9999999)}` +
        `&token=${encodeURIComponent(sToken)}` +
        `&sig=${encodeURIComponent(сПодпись)}`;
      if (!bWithoutAds) {
        _sPlaySessionID = создатьУникальныйИдентификатор(32);
        sAddress += `&play_session_id=${_sPlaySessionID}`;
        GetAbsoluteVariantListUrl._sUrl = sAddress;
        GetAbsoluteVariantListUrl._чПротухнетПосле =
          performance.now() + ТОКЕН_ПРОТУХНЕТ_ЧЕРЕЗ;
      }
      return sAddress;
    });
  }
  function очиститьТокенGql() {
    _сТокенGql = "";
    deleteCookie("tw5~gqltoken", "https://www.twitch.tv/tw5~storage/").catch(
      m_Debug.CaughtException
    );
  }
  function получитьУникальныйИдентификаторУстройства() {
    return (
      "0000000000000000" +
      (m_Settings.Get("чСлучайноеЧисло") || 0.1).toFixed(16).slice(2)
    );
  }
  function разобратьПеченькуАвторизации(сПеченька) {
    if (сПеченька) {
      try {
        const o = JSON.parse(decodeURIComponent(сПеченька));
        Check(
          IsObject(o) &&
          IsNonEmptyString(o.id) &&
          IsNonEmptyString(o.login) &&
          IsNonEmptyString(o.authToken)
        );
        return o;
      } catch (_) { }
      m_Log.Ой(
        `[Twitch] Не удалось разобрать печеньку авторизации: ${сПеченька}`
      );
    }
    return {
      id: "",
      login: "",
      authToken: "",
      displayName: "",
    };
  }
  function разобратьПеченькуТокенаGql(сПеченька) {
    if (сПеченька) {
      try {
        const o = JSON.parse(decodeURIComponent(сПеченька));
        Check(
          IsNonEmptyString(o.sToken) && Number.isSafeInteger(o.чПротухнетПосле)
        );
        return [o.sToken, o.чПротухнетПосле];
      } catch (_) {
        m_Log.Ой(
          `[Twitch] Не удалось разобрать печеньку токена GQL: ${сПеченька}`
        );
      }
    }
    return ["", 0];
  }
  function разобратьПеченьку(чДействие, { name, domain, path, value }) {
    if (чДействие === 3 || typeof value != "string") {
      value = "";
    }
    switch (name) {
      case "twilight-user":
        if (domain === ".twitch.tv" && path === "/") {
          const { id, login, authToken, displayName } =
            разобратьПеченькуАвторизации(value);
          if (
            чДействие !== 1 &&
            (_сИдЗрителя !== id ||
              _сКодЗрителя !== login ||
              _сТокенЗрителя !== authToken)
          ) {
            m_Debug.FinishWorkAndShowMessage("J0222");
          }
          _сИдЗрителя = id;
          _сКодЗрителя = login;
          _сТокенЗрителя = authToken;
          _сИмяЗрителя = IsNonEmptyString(displayName) ? displayName : login;
        }
        break;

      case "unique_id":
        if (
          domain === ".twitch.tv" &&
          path === "/" &&
          чДействие === 1 &&
          _сИдУстройства === ""
        ) {
          _сИдУстройства = value;
        }
        break;

      case "tw5~gqltoken":
        if (domain === "www.twitch.tv" && path === "/tw5~storage/") {
          [_сТокенGql, _чТокенGqlПротухнетПосле] =
            разобратьПеченькуТокенаGql(value);
          if (получитьТокенGql.fGqlTokenChanged) {
            получитьТокенGql.fGqlTokenChanged();
          }
        }
    }
  }
  function start(sChannelCode) {
    Check(IsNonEmptyString(sChannelCode));
    _сКодКанала = sChannelCode;
    return getAllCookies("https://www.twitch.tv/tw5~storage/").then(
      (maCookies) => {
        for (const оПеченька of maCookies) {
          разобратьПеченьку(1, оПеченька);
        }
        if (_сИдУстройства === "") {
          m_Log.Ой("[Twitch] Не найден идентификатор устройства");
          _сИдУстройства = получитьУникальныйИдентификаторУстройства();
        }
        chrome.cookies.onChanged.addListener(
          AddExceptionHandler(({ removed, cause, cookie }) => {
            if (!(removed && cause === "overwrite")) {
              разобратьПеченьку(removed ? 3 : 2, cookie);
            }
          })
        );
      }
    );
  }
  function обновитьМетаданныеЗрителяИКанала() {
    Check(_сИдКанала);
    отправитьЗапросGql(
      null,
      `query($login: String!, $skip: Boolean!) {
				user(login: $login) {
					broadcastSettings {
						language
					}
					createdAt
					description
					displayName
					followers {
						totalCount
					}
					id
					lastBroadcast {
						startedAt
					}
					primaryTeam {
						displayName
						name
					}
					profileImageURL(width: 70)
					self @skip(if: $skip) {
						canFollow
						follower {
							disableNotifications
						}
					}
				}
			}`,
      {
        login: _сКодКанала,
        skip: _сКодКанала === _сКодЗрителя,
      },
      true,
      false,
      true,
      "метаданные канала"
    )
      .then((oResult) => {
        if (!oResult.data) {
          throw "Server response contains no metadata";
        }
        const oUser = oResult.data.user;
        if (!oUser) {
          m_Debug.FinishWorkAndShowMessage("J0203");
        }
        Check(oUser.id === _сИдКанала);
        const sLanguageCode = chain(oUser.broadcastSettings, "language");
        const moTeams = [];
        if (oUser.primaryTeam) {
          moTeams.push({
            sAddress: получитьАдресКоманды(oUser.primaryTeam.name),
            sName: oUser.primaryTeam.displayName || oUser.primaryTeam.name,
          });
        }
        const nSubscription = !chain(oUser.self, "canFollow")
          ? SUBSCRIPTION_UNAVAILABLE
          : !oUser.self.follower
            ? SUBSCRIPTION_NOT_SUBSCRIBED
            : oUser.self.follower.disableNotifications
              ? SUBSCRIPTION_DO_NOT_NOTIFY
              : SUBSCRIPTION_NOTIFY;
        m_Events.SendEvent("twitch-полученыметаданныеканала", {
          sName: oUser.displayName || _сКодКанала,
          sAvatar: oUser.profileImageURL || "player.svg#svg-missingavatar",
          sDescription: oUser.description,
          sLanguageCode: sLanguageCode && sLanguageCode !== "OTHER" ? sLanguageCode : null,
          kSubscribers: chain(oUser.followers, "totalCount"),
          nChannelCreated: Date.parse(oUser.createdAt),
          moTeams,
        });
        m_Events.SendEvent("twitch-полученыметаданныезрителя", {
          sName: _сИмяЗрителя,
          nSubscription,
        });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Ой(
            `[Twitch] Не удалось получить метаданные канала. ${pReason}`
          );
          m_Events.SendEvent("twitch-полученыметаданныеканала", {
            sName: _сКодКанала,
            sAvatar: "player.svg#svg-missingavatar",
            sLanguageCode: null,
            kSubscribers: null,
            nChannelCreated: null,
          });
          m_Events.SendEvent("twitch-полученыметаданныезрителя", {
            sName: _сИмяЗрителя,
            nSubscription: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function ОбновитьМетаданныеТрансляции(oPromiseCancellation, чЧерез) {
    Check(_сИдКанала);
    m_Log.Вот(
      `[Twitch] Загрузка метаданных трансляции начнется через ${m_Log.F0(
        чЧерез
      )}мс`
    );
    Wait(oPromiseCancellation, чЧерез)
      .then(() => {
        return отправитьЗапросGql(
          oPromiseCancellation,
          `query($id: ID!, $all: Boolean!) {
					user(id: $id) {
						broadcastSettings {
							game {
								displayName
								slug
							}
							title
						}
						login
						stream {
							archiveVideo @include(if: $all) {
								id
							}
							createdAt
							id
							type
							viewersCount
						}
					}
				}`,
          {
            id: _сИдКанала,
            all: _сИдТрансляции === "",
          },
          false,
          false,
          true,
          "метаданные трансляции"
        );
      })
      .then((oResult) => {
        const oUser = chain(oResult.data, "user");
        const sChannelCode = chain(oUser, "login");
        if (sChannelCode !== _сКодКанала && IsNonEmptyString(sChannelCode)) {
          m_Log.Ой(`[Twitch] Новый код канала ${sChannelCode}`);
          location.replace(`?channel=${encodeURIComponent(sChannelCode)}`);
          return;
        }
        const oMetadata = {
          kViewers: chain(oUser, "stream", "viewersCount"),
        };
        const sBroadcastId = chain(oUser, "stream", "id");
        if (_сИдТрансляции === "" && IsNonEmptyString(sBroadcastId)) {
          m_Log.Окак(`[Twitch] Идентификатор трансляции ${sBroadcastId}`);
          _сИдТрансляции = sBroadcastId;
          начатьСлежениеЗаПросмотром();
          const сИдЗаписи = chain(oUser, "stream", "archiveVideo", "id");
          _сАдресЗаписи = IsNonEmptyString(сИдЗаписи)
            ? ПолучитьАдресЗаписи(сИдЗаписи)
            : "";
          const sBroadcastType = chain(oUser, "stream", "type");
          oMetadata.sBroadcastType =
            sBroadcastType === "live"
              ? "прямая"
              : sBroadcastType === "rerun"
                ? "повтор"
                : null;
        }
        if (_сИдТрансляции === "" || _сИдТрансляции === sBroadcastId) {
          const sBroadcastTitle = chain(
            oUser,
            "broadcastSettings",
            "title"
          );
          if (typeof sBroadcastTitle == "string") {
            oMetadata.sBroadcastTitle =
              sBroadcastTitle.trim() || GetText("J0103");
          }
          oMetadata.sGameName = chain(
            oUser,
            "broadcastSettings",
            "game",
            "displayName"
          );
          const sGameUrl = chain(
            oUser,
            "broadcastSettings",
            "game",
            "slug"
          );
          if (sGameUrl) {
            oMetadata.sGameUrl = получитьАдресКатегории(sGameUrl);
          }
          oMetadata.nBroadcastDuration =
            performance.now() +
            g_nExactTime -
            Date.parse(chain(oUser, "stream", "createdAt"));
        }
        m_Events.SendEvent(
          "twitch-полученыметаданныетрансляции",
          oMetadata
        );
        ОбновитьМетаданныеТрансляции(
          oPromiseCancellation,
          ИНТЕРВАЛ_ОБНОВЛЕНИЯ_МЕТАДАННЫХ_ТРАНСЛЯЦИИ
        );
      })
      .catch(
        AddExceptionHandler((pReason) => {
          if (typeof pReason == "string") {
            m_Log.Ой(
              `[Twitch] Не удалось загрузить метаданные трансляции. ${pReason}`
            );
            ОбновитьМетаданныеТрансляции(
              oPromiseCancellation,
              ИНТЕРВАЛ_ОБНОВЛЕНИЯ_МЕТАДАННЫХ_ТРАНСЛЯЦИИ / 2
            );
          } else if (pReason === PromiseCancellation.REASON) {
            m_Log.Вот("[Twitch] Отменено обновление метаданных трансляции");
          } else {
            throw pReason;
          }
        })
      );
  }
  function НачатьСборМетаданныхТрансляции() {
    ОчиститьДанныеТрансляции();
    Check(!_оОтменаОбновленияМетаданных);
    _оОтменаОбновленияМетаданных = new PromiseCancellation();
    ОбновитьМетаданныеТрансляции(_оОтменаОбновленияМетаданных, 0);
  }
  function FinishCollectingBroadcastMetadata(лТрансляцияЗавершена) {
    if (лТрансляцияЗавершена) {
      ОчиститьДанныеТрансляции();
    }
    if (_оОтменаОбновленияМетаданных) {
      m_Log.Вот(
        `[Twitch] Отменяю цепочку обновления метаданных трансляции ТрансляцияЗавершена=${лТрансляцияЗавершена}`
      );
      _оОтменаОбновленияМетаданных.Cancel();
      _оОтменаОбновленияМетаданных = null;
    }
    завершитьСлежениеЗаПросмотром();
  }
  function начатьСлежениеЗаПросмотром() {
    if (_сИдЗрителя !== "") {
      m_Log.Вот("[Twitch] Начинаю слежение за просмотром");
      Check(_чТаймерСлеженияЗаПросмотром === 0);
      _чТаймерСлеженияЗаПросмотром = setInterval(
        отправитьДанныеСлеженияЗаПросмотром,
        ИНТЕРВАЛ_СЛЕЖЕНИЯ_ЗА_ПРОСМОТРОМ
      );
      отправитьДанныеСлеженияЗаПросмотром();
    }
  }
  function завершитьСлежениеЗаПросмотром() {
    if (_чТаймерСлеженияЗаПросмотром !== 0) {
      m_Log.Вот("[Twitch] Завершаю слежение за просмотром");
      clearInterval(_чТаймерСлеженияЗаПросмотром);
      _чТаймерСлеженияЗаПросмотром = 0;
    }
  }
  const отправитьДанныеСлеженияЗаПросмотром = AddExceptionHandler(
    () => {
      Check(_сИдТрансляции && _сИдКанала && _сИдЗрителя);
      const оОтправить = new URLSearchParams();
      оОтправить.set(
        "data",
        btoa(
          JSON.stringify([
            {
              event: "minute-watched",
              properties: {
                broadcast_id: _сИдТрансляции,
                channel_id: _сИдКанала,
                user_id: Number(_сИдЗрителя),
                player: "site",
              },
            },
          ])
        )
      );
      м_Загрузчик
        .Load(
          null,
          "POST",
          _сАдресСлеженияЗаПросмотром,
          LOAD_METADATA_NO_LONGER_THAN,
          null,
          оОтправить,
          "слежение за просмотром",
          false,
          "none"
        )
        .catch((pReason) => {
          if (typeof pReason == "string") {
            m_Log.Ой(
              `[Twitch] Не удалось отправить данные слежения за просмотром. ${pReason}`
            );
          } else {
            m_Debug.CaughtException(pReason);
          }
        });
    }
  );
  function ПолучитьАдресЗаписиДляТекущейПозиции() {
    if (_сАдресЗаписи === "") {
      m_Log.Ой("[Twitch] Адрес записи не известен");
      return "";
    }
    const чПозиция =
      m_Player.GetBroadcastPlaybackPosition(false);
    if (чПозиция === -1) {
      m_Log.Вот("[Twitch] Адрес записи создан без позиции воспроизведения");
      return _сАдресЗаписи;
    }
    return `${_сАдресЗаписи}?t=${Math.floor(чПозиция / 60 / 60)}h${Math.floor(
      (чПозиция / 60) % 60
    )}m${Math.floor(чПозиция % 60)}s`;
  }
  function CreateClip() {
    const чПозиция =
      m_Player.GetBroadcastPlaybackPosition(true);
    if (_сИдТрансляции === "" || чПозиция <= 0) {
      m_Log.Ой(
        `[Twitch] Недостаточно данных для создания клипа ИдТрансляции=${_сИдТрансляции} Позиция=${чПозиция}`
      );
      m_Notification.ShowAss();
    } else {
      m_Log.Окак(
        `[Twitch] Создаю клип ИдТрансляции=${_сИдТрансляции} Позиция=${чПозиция} ИдЗрителя=${_сИдЗрителя}`
      );
      m_Notification.Show("svg-cut", false);
      OpenAddressInNewTab(
        `https://clips.twitch.tv/create?${new URLSearchParams({
          broadcastID: _сИдТрансляции,
          broadcasterLogin: _сКодКанала,
          offsetSeconds: Math.ceil(чПозиция),
        })}`
      );
    }
  }
  function ПолучитьАбсолютныйАдресСпискаСегментов(
    sAbsoluteSegmentListUrl
  ) {
    return sAbsoluteSegmentListUrl;
  }
  function сортироватьСписокВариантов(oVariantList) {
    if (oVariantList.sViewTrackingUrl) {
      _сАдресСлеженияЗаПросмотром = oVariantList.sViewTrackingUrl;
    }
    return oVariantList;
  }
  const обработатьСообщениеЧата = AddExceptionHandler(
    (оСообщение, оОтправитель, фОтветить) => {
      if (оСообщение.sQuery !== "ВставитьСторонниеРасширения") {
        return false;
      }
      if (
        (оОтправитель.tab ? оОтправитель.tab.id : chrome.tabs.TAB_ID_NONE) !==
        getCurrentTab.nTabId
      ) {
        return false;
      }
      m_Log.Вот("[Twitch] Получен запрос на вставку сторонних расширений");
      chrome.management.getAll(
        AddExceptionHandler((моРасширения) => {
          if (chrome.runtime.lastError) {
            throw new Error(
              `Не удалось получить список расширений: ${chrome.runtime.lastError.message}`
            );
          }
          //! Send to content script a list of known browser extensions that are currently installed and enabled in the browser.
          //! These extensions will be loaded into <iframe>. See вставитьСторонниеРасширения() in content.js.
          //! Chrome itself cannot load installed extensions into another extension.
          //! See https://bugs.chromium.org/p/chromium/issues/detail?id=599167
          оСообщение.sThirdPartyExtensions = "";
          for (let оРасширение of моРасширения) {
            if (оРасширение.enabled) {
              switch (оРасширение.id) {
                case /*! Chrome */ "ajopnjidmegmdimjlfnijceegpefgped":
                case /*! Opera  */ "deofbbdfofnmppcjbhjibgodpcdchjii":
                case /*! Edge   */ "icllegkipkooaicfmdfaloehobmglglb":
                  //! BetterTTV browser extension
                  //! https://betterttv.com/
                  //! https://chrome.google.com/webstore/detail/ajopnjidmegmdimjlfnijceegpefgped
                  оСообщение.sThirdPartyExtensions += "BTTV ";
                  break;

                case /*! Chrome */ "fadndhdgpmmaapbmfcknlfgcflmmmieb":
                case /*! Opera  */ "djkpepcignmpfblhbfpmlhoindhndkdj":
                  //! FrankerFaceZ browser extension
                  //! https://www.frankerfacez.com/
                  //! https://chrome.google.com/webstore/detail/fadndhdgpmmaapbmfcknlfgcflmmmieb
                  оСообщение.sThirdPartyExtensions += "FFZ ";
              }
            }
          }
          m_Log.Вот(
            `[Twitch] Посылаю ответ на вставку сторонних расширений: ${оСообщение.sThirdPartyExtensions}`
          );
          try {
            фОтветить(оСообщение);
          } catch (pException) {
            m_Log.Ой(`[Twitch] Ошибка при посылке ответа: ${pException}`);
          }
        })
      );
      return true;
    }
  );
  function открытьЧат() {
    chrome.runtime.onMessage.addListener(обработатьСообщениеЧата);
    return ПолучитьАдресПанелиЧата();
  }
  function закрытьЧат() {
    chrome.runtime.onMessage.removeListener(обработатьСообщениеЧата);
  }
  return {
    этоРекламныйСегмент,
    sendAdTrackingData,
    GetAbsoluteVariantListUrl,
    ПолучитьАбсолютныйАдресСпискаСегментов,
    GetChannelUrl,
    проверитьДоступностьАдреса,
    НачатьСборМетаданныхТрансляции,
    FinishCollectingBroadcastMetadata,
    ChangeViewerChannelSubscription,
    ПолучитьАдресЗаписиДляТекущейПозиции,
    CreateClip,
    сортироватьСписокВариантов,
    открытьЧат,
    закрытьЧат,
    start,
  };
})();

function Terminate(лБыстро) {
  try {
    g_bWorkFinished = true;
    m_Log.Окак("[Запускалка] Завершаю работу");
    window.stop();
    if (!лБыстро) {
      м_Преобразователь.Stop();
      m_Player.Stop();
      m_GarbageCollector.Burn();
    }
    m_Log.Окак("[Запускалка] Работа завершена");
  } catch (_) { }
}

AddExceptionHandler(() => {
  function ЭтотКаналУжеОткрыт(sChannel) {
    Check(IsNonEmptyString(sChannel));
    chrome.runtime.sendMessage(
      {
        sQuery: "ЭтотКаналУжеОткрыт",
        sChannel,
      },
      (пОтвет) => {
        if (пОтвет === true) {
          m_Debug.FinishWorkAndShowMessage("J0211");
        }
      }
    );
    chrome.runtime.onMessage.addListener(
      AddExceptionHandler((оСообщение, _, фОтветить) => {
        if (оСообщение.sQuery === "ЭтотКаналУжеОткрыт") {
          m_Log.Ой(
            `[Запускалка] В другой вкладке открыт канал ${оСообщение.sChannel}`
          );
          if (оСообщение.sChannel === sChannel) {
            фОтветить(true);
          }
        }
      })
    );
  }
  function ОбработатьВыгрузкуСтраницы(oEvent) {
    m_Log.Окак(`[Запускалка] window.on${oEvent.type}`);
    Terminate(true);
  }
  function НачатьРаботу() {
    Check(!g_bWorkFinished);
    m_Log.Вот(`[Запускалка] Начало работы ${performance.now().toFixed()}мс`);
    window.addEventListener("unload", ОбработатьВыгрузкуСтраницы);
    м_Управление.Start();
    if (m_Player.Start()) {
      м_Список.Start();
    } else {
      м_Управление.StopWatchingBroadcast();
    }
    m_Statistics.Start();
  }
  if (window.top !== window) {
    return;
  }
  if (navigator.userAgent.includes("Gecko/")) {
    m_Debug.FinishWorkAndShowMessage("J0204");
  }
  const sChannel = (
    new URLSearchParams(location.search.slice(1)).get("channel") || "channel"
  ).toLowerCase();
  ЭтотКаналУжеОткрыт(sChannel);
  Promise.all([
    checkExtensionPermissions(),
    m_Settings.Restore(),
    getCurrentTab(),
  ])
    .then(() => м_Twitch.start(sChannel))
    .then(НачатьРаботу)
    .catch(m_Debug.CaughtException);
})();
