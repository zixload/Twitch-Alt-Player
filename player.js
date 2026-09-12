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

function Текст(sCode, sSubstitution) {
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

function проверитьРазрешенияРасширения() {
  return new Promise((fResolve) => {
    chrome.permissions.contains(
      {
        origins: chrome.runtime
          .getManifest()
          .permissions.filter((сРазрешение) => сРазрешение.includes(":")),
      },
      (лРазрешено) => {
        if (chrome.runtime.lastError) {
          console.error(
            "permissions.contains",
            chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        if (!лРазрешено) {
          m_Debug.FinishWorkAndShowMessage("J0215");
        }
        fResolve();
      }
    );
  });
}

получитьТекущуюВкладку.чИдВкладки = NaN;

получитьТекущуюВкладку.cХранилищеПеченек = "";

function получитьТекущуюВкладку() {
  return new Promise((fResolve) => {
    chrome.tabs.getCurrent(
      AddExceptionHandler((оВкладка) => {
        if (
          chrome.runtime.lastError ||
          !IsObject(оВкладка) ||
          !Number.isSafeInteger(оВкладка.id) ||
          оВкладка.id === chrome.tabs.TAB_ID_NONE
        ) {
          console.error(
            "tabs.getCurrent",
            chrome.runtime.lastError && chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        получитьТекущуюВкладку.чИдВкладки = оВкладка.id;
        fResolve();
      })
    );
  });
}

function получитьВсеПеченьки(sAddress) {
  return new Promise((fResolve) => {
    const оПараметры = {
      url: sAddress,
    };
    if (получитьТекущуюВкладку.cХранилищеПеченек) {
      оПараметры.storeId = получитьТекущуюВкладку.cХранилищеПеченек;
    }
    chrome.cookies.getAll(
      оПараметры,
      AddExceptionHandler((моПеченьки) => {
        if (!chrome.runtime.lastError && Array.isArray(моПеченьки)) {
          m_Log.Вот(`[API] Количество печенек: ${моПеченьки.length}`);
          fResolve(моПеченьки);
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

function удалитьПеченьку(sName, sAddress) {
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

function ОткрытьАдресВНовойВкладке(sAddress) {
  window.open(sAddress);
}

function WriteTextToLocalFile(sText, сТипДанных, сИмяФайла) {
  Check(
    typeof sText == "string" &&
    IsNonEmptyString(сТипДанных) &&
    IsNonEmptyString(сИмяФайла)
  );
  const nodeLink = document.createElement("a");
  nodeLink.href = URL.createObjectURL(
    new Blob([sText], {
      type: сТипДанных,
    })
  );
  nodeLink.download = сИмяФайла;
  nodeLink.dispatchEvent(new MouseEvent("click"));
}

function создатьОбработчикСобытийЭлемента(фВызвать) {
  return AddExceptionHandler((oEvent) => {
    if (oEvent.target.nodeType === Node.ELEMENT_NODE) {
      фВызвать(oEvent);
    }
  });
}

function ЭтоСобытиеДляСсылки(oEvent) {
  return !!oEvent.target.closest("a[href]");
}

function ЭлементВЭтойТочкеМожноПрокрутить(x, y) {
  for (
    let узЭлемент = document.elementFromPoint(x, y);
    узЭлемент;
    узЭлемент = узЭлемент.parentElement
  ) {
    if (ЭтотЭлементМожноПрокрутить(узЭлемент)) {
      return true;
    }
  }
  return false;
}

function ЭтотЭлементМожноПрокрутить(узЭлемент) {
  const оСтиль = getComputedStyle(узЭлемент);
  return (
    (оСтиль.overflowY === "scroll" || оСтиль.overflowY === "auto") &&
    узЭлемент.clientHeight < узЭлемент.scrollHeight
  );
}

function этотЭлементПолностьюПрокручен(elElement) {
  return (
    elElement.scrollHeight - elElement.scrollTop - elElement.clientHeight < 2
  );
}

function ПоказатьЭлемент(pElement, лПоказать) {
  const узЭлемент = GetNode(pElement);
  if (лПоказать) {
    узЭлемент.removeAttribute("hidden");
  } else {
    узЭлемент.setAttribute("hidden", "");
  }
  return узЭлемент;
}

function ЭлементПоказан(pElement) {
  return !GetNode(pElement).hasAttribute("hidden");
}

function ИзменитьКнопку(пКнопка, пСостояние) {
  const nodeButton = GetNode(пКнопка);
  const чСостояние = Number(пСостояние);
  const сузСостояния = nodeButton.getElementsByTagName("use");
  Check(чСостояние >= 0 && чСостояние < сузСостояния.length);
  for (let ы = 0; ы < сузСостояния.length; ++ы) {
    if (ы === чСостояние) {
      const сПодсказка = сузСостояния[ы].getAttributeNS(
        "http://www.w3.org/1999/xlink",
        "title"
      );
      if (сПодсказка) {
        nodeButton.title = Текст(сПодсказка);
      }
      сузСостояния[ы].removeAttribute("display");
    } else {
      сузСостояния[ы].setAttribute("display", "none");
    }
  }
  return nodeButton;
}

const m_Debug = (() => {
  const МАКС_ДЛИНА_СТРОКИ_ОТЧЕТА = 15e4;
  let _сТокенТрансляции = "";
  let _сТокенТрансляцииБезРекламы = "";
  let _сСписокВариантов = "";
  let _мсСпискиСегментов = [];
  function ВставитьСсылкиДляСкачиванияФайлов(узФорма) { }
  function ПоказатьСтраницу() {
    try {
      м_ПолноэкранныйРежим.Отключить();
    } catch (_) { }
    document.body.textContent = "";
    for (let уз of document.querySelectorAll('link[rel="stylesheet"], style')) {
      уз.remove();
    }
    for (let уз of [document.documentElement, document.body]) {
      уз.removeAttribute("class");
      уз.removeAttribute("style");
      уз.removeAttribute("hidden");
    }
    return new Promise((fResolve) => {
      const уз = document.createElement("iframe");
      уз.src = "report.html";
      уз.style.position = "fixed";
      уз.style.top = "0";
      уз.style.left = "0";
      уз.style.width = "100%";
      уз.style.height = "100%";
      уз.style.zIndex = "100500";
      уз.style.border = "0";
      уз.addEventListener("load", () => {
        m_i18n.TranslateDocument(уз.contentDocument);
        fResolve(уз.contentDocument);
      });
      document.body.appendChild(уз);
    });
  }
  function ПоказатьФорму(oDocument, сИдФормы, лНастроитьФон) {
    if (лНастроитьФон) {
      oDocument.documentElement.classList.add(сИдФормы);
    }
    for (
      let узПоказатьИлиСкрыть, сузПоказатьИлиСкрыть = oDocument.forms, ы = 0;
      (узПоказатьИлиСкрыть = сузПоказатьИлиСкрыть[ы]);
      ++ы
    ) {
      if (узПоказатьИлиСкрыть.id === сИдФормы) {
        ПоказатьЭлемент(узПоказатьИлиСкрыть, true);
        const узФокус = узПоказатьИлиСкрыть.querySelector("[autofocus]");
        if (узФокус) {
          узФокус.focus();
        }
      } else {
        ПоказатьЭлемент(узПоказатьИлиСкрыть, false);
      }
    }
  }
  function ПоказатьСообщение(сСообщение, сКодСсылки, сАдресСсылки) {
    ПоказатьСтраницу().then((oDocument) => {
      oDocument.getElementById("отладка-текстсообщения").textContent =
        сСообщение;
      if (сКодСсылки) {
        const элСсылка = oDocument.getElementById("отладка-ссылкасообщения");
        элСсылка.textContent = Текст(сКодСсылки);
        элСсылка.href = сАдресСсылки;
      }
      ПоказатьФорму(oDocument, "отладка-сообщение", true);
    });
  }
  function ПоказатьИОтправитьОтчет(oReport, буфОтправить) {
    ПоказатьСтраницу().then((oDocument) => {
      let узФорма;
      if (oReport.ПричинаЗавершенияРаботы === "ОТПРАВИТЬ ОТЗЫВ") {
        узФорма = oDocument.getElementById("отладка-отзыв");
      } else {
        узФорма = oDocument.getElementById("отладка-ошибка");
        ВставитьСсылкиДляСкачиванияФайлов(узФорма);
      }
      узФорма.elements["отладка-отчет"].value = JSON.stringify(oReport);
      ПоказатьФорму(oDocument, узФорма.id, true);
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
            ТокенТрансляции: СНЯТО,
            ТокенТрансляцииБезРекламы: СНЯТО,
          })
        );

        const узСообщение = узФорма.elements["отладка-сообщение"];
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
  function сохранитьТокенТрансляции(сТокенТрансляции, лБезРекламы) {
    сТокенТрансляции = LimitStringLength(
      сТокенТрансляции,
      МАКС_ДЛИНА_СТРОКИ_ОТЧЕТА
    );
    if (лБезРекламы) {
      _сТокенТрансляцииБезРекламы = сТокенТрансляции;
    } else {
      _сТокенТрансляции = сТокенТрансляции;
    }
  }
  function СохранитьСписокВариантов(сСписокВариантов) {
    _сСписокВариантов = сСписокВариантов;
  }
  function СохранитьСписокСегментов(сСписокСегментов) {
    if (_мсСпискиСегментов.length === 10) {
      _мсСпискиСегментов.shift();
    }
    _мсСпискиСегментов.push(сСписокСегментов);
  }
  function СохранитьТранспортныйПоток(оСегмент) { }
  function СохранитьПреобразованныйСегмент(оСегмент) { }
  function сжатьСписок(sList) {
    return LimitStringLength(
      sList.replace(
        /^(?:https?:\/\/|#EXT-X-TWITCH-PREFETCH:).+$/gm,
        (sString) => LimitStringLength(sString, 100)
      ),
      МАКС_ДЛИНА_СТРОКИ_ОТЧЕТА
    );
  }
  function ОбнюхатьПроцессорИОперативку(фВызвать) {
    const оПроцессорИОперативка = {
      capacity: navigator.deviceMemory,
      numOfProcessors: navigator.hardwareConcurrency,
    };
    if (performance.memory) {
      оПроцессорИОперативка.jsHeapSizeLimit = Math.round(
        performance.memory.jsHeapSizeLimit / 1024 / 1024
      );
      оПроцессорИОперативка.totalJSHeapSize = Math.round(
        performance.memory.totalJSHeapSize / 1024 / 1024
      );
      оПроцессорИОперативка.usedJSHeapSize = Math.round(
        performance.memory.usedJSHeapSize / 1024 / 1024
      );
    }
    try {
      chrome.system.memory.getInfo((оОперативка) => {
        try {
          оПроцессорИОперативка.capacity = Round(
            оОперативка.capacity / 1024 / 1024 / 1024,
            1
          );
          оПроцессорИОперативка.availableCapacity = Round(
            оОперативка.availableCapacity / 1024 / 1024 / 1024,
            1
          );
          chrome.system.cpu.getInfo((оПроцессор) => {
            try {
              оПроцессорИОперативка.numOfProcessors =
                оПроцессор.numOfProcessors;
              оПроцессорИОперативка.modelName = оПроцессор.modelName;
              оПроцессорИОперативка.archName = оПроцессор.archName;
            } catch (_) { }
            фВызвать(оПроцессорИОперативка);
          });
        } catch (_) {
          фВызвать(оПроцессорИОперативка);
        }
      });
    } catch (_) {
      фВызвать(оПроцессорИОперативка);
    }
  }
  function ОбнюхатьВидюху() {
    try {
      const oContext = document.createElement("canvas").getContext("webgl");
      const oExtension = oContext.getExtension("WEBGL_debug_renderer_info");
      return `${oContext.getParameter(
        oExtension.UNMASKED_VENDOR_WEBGL
      )} | ${oContext.getParameter(oExtension.UNMASKED_RENDERER_WEBGL)}`;
    } catch (_) { }
  }
  function получитьПараметрыСоединения() {
    const оСоединение = navigator.connection || {};
    return {
      online: navigator.onLine,
      effectiveType: оСоединение.effectiveType,
      downlink: оСоединение.downlink,
      rtt: оСоединение.rtt,
      type: оСоединение.type,
      downlinkMax: оСоединение.downlinkMax,
    };
  }
  function ПолучитьЯзыки() {
    try {
      return `${navigator.language} | ${navigator.languages} | ${Текст(
        "J0103"
      )}`;
    } catch (_) { }
  }
  function ПолучитьУстановкиДаты() {
    try {
      const оУстановки = new Intl.DateTimeFormat().resolvedOptions();
      оУстановки.timezoneOffset = new Date().getTimezoneOffset();
      return оУстановки;
    } catch (_) { }
  }
  function СоздатьПоказатьИОтправитьОтчет(
    сПричинаЗавершенияРаботы,
    буфОтправить
  ) {
    ОбнюхатьПроцессорИОперативку((оПроцессорИОперативка) => {
      ПоказатьИОтправитьОтчет(
        {
          ПричинаЗавершенияРаботы: сПричинаЗавершенияРаботы,
          ВерсияРасширения: EXTENSION_VERSION,
          Оборзеватель: navigator.userAgent,
          Время: new Date().toISOString(),
          Адрес: window.location.href,
          Инкогнито: chrome.extension.inIncognitoContext,
          Рассинхронизация: Date.now() - performance.now() - g_nExactTime,
          Фокусник: м_Фокусник.ПолучитьСостояние(),
          Пульс: м_Пульс.GetDataForReport(),
          Настройки: m_Settings.GetDataForReport(),
          Статистика: м_Статистика.GetDataForReport(),
          Языки: ПолучитьЯзыки(),
          УстановкиДаты: ПолучитьУстановкиДаты(),
          Соединение: получитьПараметрыСоединения(),
          Видюха: ОбнюхатьВидюху(),
          ПроцессорИОперативка: оПроцессорИОперативка,
          ТочекКасания: navigator.maxTouchPoints,
          Экран: {
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
          ТокенТрансляции: _сТокенТрансляции,
          ТокенТрансляцииБезРекламы: _сТокенТрансляцииБезРекламы,
          СписокВариантов: сжатьСписок(_сСписокВариантов),
          СпискиСегментов: _мсСпискиСегментов.map(сжатьСписок),
          Log: m_Log.GetDataForReport(),
        },
        буфОтправить
      );
    });
  }
  function FinishWorkAndShowMessage(
    сКодСообщения,
    сКодСсылки,
    сАдресСсылки
  ) {
    if (!g_bWorkFinished) {
      console.error(сКодСообщения);
      ЗавершитьРаботу(false);
      ПоказатьСообщение(Текст(сКодСообщения), сКодСсылки, сАдресСсылки);
    }
    throw void 0;
  }
  function ЗавершитьРаботуИОтправитьОтчет(
    сПричинаЗавершенияРаботы,
    буфОтправить
  ) {
    if (!g_bWorkFinished) {
      console.error(сПричинаЗавершенияРаботы);
      сПричинаЗавершенияРаботы = LimitStringLength(
        String(сПричинаЗавершенияРаботы),
        МАКС_ДЛИНА_СТРОКИ_ОТЧЕТА
      );
      if (сПричинаЗавершенияРаботы.includes("out of memory")) {
        FinishWorkAndShowMessage("J0200");
      }
      try {
        м_Проигрыватель.ПоказатьСостояние("Вот", "Завершаю работу");
        г_моОчередь.ПоказатьСостояние();
      } catch (_) { }
      ЗавершитьРаботу(false);
      СоздатьПоказатьИОтправитьОтчет(сПричинаЗавершенияРаботы, буфОтправить);
    }
    throw void 0;
  }
  function CaughtException(pException) {
    ЗавершитьРаботуИОтправитьОтчет(ExceptionToString(pException));
  }
  function ЗавершитьРаботуИОтправитьОтзыв() {
    try {
      ЗавершитьРаботуИОтправитьОтчет("ОТПРАВИТЬ ОТЗЫВ");
    } catch (_) { }
  }
  return {
    CaughtException,
    FinishWorkAndShowMessage,
    ЗавершитьРаботуИОтправитьОтчет,
    ЗавершитьРаботуИОтправитьОтзыв,
    сохранитьТокенТрансляции,
    СохранитьСписокВариантов,
    СохранитьСписокСегментов,
    СохранитьТранспортныйПоток,
    СохранитьПреобразованныйСегмент,
  };
})();

class ОтменаОбещания {
  constructor() {
    this.лОтменено = false;
    this._фОбработчик = null;
  }
  Отменить() {
    this.лОтменено = true;
    if (this._фОбработчик) {
      this._фОбработчик();
      this._фОбработчик = null;
    }
  }
  ЗаменитьОбработчик(фОбработчик) {
    Check(!this.лОтменено);
    Check(typeof фОбработчик == "function" || фОбработчик === null);
    this._фОбработчик = фОбработчик;
  }
}

ОтменаОбещания.ПРИЧИНА = new Error("ОБЕЩАНИЕ_ОТМЕНЕНО");

function Ждать(оОтменаОбещания, чМиллисекунды) {
  if (оОтменаОбещания && оОтменаОбещания.лОтменено) {
    return Promise.reject(ОтменаОбещания.ПРИЧИНА);
  }
  if (чМиллисекунды === -Infinity) {
    let оОбещание = Promise.resolve();
    if (оОтменаОбещания) {
      оОбещание = оОбещание.then(() => {
        if (оОтменаОбещания.лОтменено) {
          throw ОтменаОбещания.ПРИЧИНА;
        }
      });
    }
    return оОбещание;
  }
  Check(Number.isFinite(чМиллисекунды));
  чМиллисекунды = Math.round(чМиллисекунды);
  Check(чМиллисекунды >= 0 && чМиллисекунды <= 2147483647);
  if (оОтменаОбещания) {
    return new Promise((fResolve, fReject) => {
      const чТаймер = setTimeout(() => {
        оОтменаОбещания.ЗаменитьОбработчик(null);
        fResolve();
      }, чМиллисекунды);
      оОтменаОбещания.ЗаменитьОбработчик(() => {
        clearTimeout(чТаймер);
        fReject(ОтменаОбещания.ПРИЧИНА);
      });
    });
  }
  return new Promise((fResolve) => {
    setTimeout(fResolve, чМиллисекунды);
  });
}

class Сегмент {
  constructor(чОбработка, пДанные, чДлительность, лРазрыв, чНомер) {
    Check(
      typeof чОбработка == "number" &&
      чОбработка >= PROCESSING_AWAITING_DOWNLOAD &&
      чОбработка <= PROCESSING_CONVERTED
    );
    Check(
      (typeof пДанные == "number" && чОбработка >= PROCESSING_DOWNLOADED) ||
      (typeof пДанные == "string" &&
        чОбработка === PROCESSING_AWAITING_DOWNLOAD) ||
      (IsObject(пДанные) && чОбработка > PROCESSING_AWAITING_DOWNLOAD)
    );
    switch (arguments.length) {
      case 2:
        чДлительность = 0;
        лРазрыв = true;

      case 4:
        Check(Number.isFinite(чДлительность) && чДлительность >= 0);
        Check(typeof лРазрыв == "boolean");
        чНомер = ++Сегмент._чНомер;

      case 5:
        Check(Number.isFinite(чНомер));
        break;

      default:
        Check(false);
    }
    if (typeof пДанные == "number") {
      m_Log.Окак(
        `[Очередь] Добавлен сегмент ${чНомер} Состояние=${пДанные} Обработка=${чОбработка}`
      );
    }
    this.чОбработка = чОбработка;
    this.пДанные = пДанные;
    this.чДлительность = чДлительность;
    this.лРазрыв = лРазрыв;
    this.чНомер = чНомер;
  }
  toString() {
    if (typeof this.пДанные == "number") {
      return `${this.чНомер}-${this.чОбработка}-${this.пДанные}`;
    }
    if (this.лРазрыв) {
      return `${this.чНомер}-${this.чОбработка}-Р`;
    }
    return `${this.чНомер}-${this.чОбработка}`;
  }
}

Сегмент._чНомер = 0;

let г_моОчередь = [];

г_моОчередь.ПодсчитатьПреобразованныеСегменты = function () {
  let кКоличество = 0,
    чДлительность = 0;
  for (
    ;
    кКоличество < this.length &&
    this[кКоличество].чОбработка === PROCESSING_CONVERTED;
    ++кКоличество
  ) {
    if (typeof this[кКоличество].пДанные != "number") {
      чДлительность += this[кКоличество].чДлительность;
    }
  }
  return {
    кКоличество,
    чДлительность,
  };
};

г_моОчередь.Add = function (оСегмент) {
  Check(оСегмент instanceof Сегмент);
  for (let о of this) {
    Check(о.чНомер !== оСегмент.чНомер);
  }
  if (оСегмент.чОбработка !== PROCESSING_CONVERTED) {
    this.push(оСегмент);
  } else {
    const { кКоличество, чДлительность } =
      this.ПодсчитатьПреобразованныеСегменты();
    if (чДлительность > BUFFER_OVERFLOW * 1.5) {
      m_Debug.FinishWorkAndShowMessage("J0208");
    }
    this.splice(кКоличество, 0, оСегмент);
  }
  return оСегмент;
};

г_моОчередь.Удалить = function (pElement, кКоличество = 1) {
  if (кКоличество === 0) {
    return;
  }
  Check(Number.isInteger(кКоличество) && кКоличество > 0);
  let чИндекс;
  if (typeof pElement == "number") {
    Check(Number.isInteger(pElement) && pElement >= 0);
    чИндекс = pElement;
  } else if ((чИндекс = this.indexOf(pElement)) === -1) {
    Check(pElement instanceof Сегмент);
    return;
  }
  while (--кКоличество >= 0) {
    Check(чИндекс < this.length);
    switch (this[чИндекс].чОбработка) {
      case PROCESSING_DOWNLOADING:
        if (IsObject(this[чИндекс].пДанные)) {
          m_Log.Вот(`[Очередь] Отменяю загрузку ${this[чИндекс]}`);
          this[чИндекс].пДанные.Отменить();
        }
        break;

      case PROCESSING_DOWNLOADED:
        м_Помойка.Выбросить(this[чИндекс].пДанные);
        break;

      case PROCESSING_CONVERTED:
        if (IsObject(this[чИндекс].пДанные)) {
          м_Помойка.Выбросить(this[чИндекс].пДанные.мбСегментИнициализации);
          м_Помойка.Выбросить(this[чИндекс].пДанные.мбМедиасегмент);
        }
    }
    m_Log.Вот(`[Очередь] Удаляю ${this[чИндекс]}`);
    this.splice(чИндекс, 1);
  }
};

г_моОчередь.Очистить = function () {
  this.Удалить(0, this.length);
};

г_моОчередь.ПоказатьСостояние = function () {
  m_Log.Вот(`[Очередь] ${this.join(" ")}`);
};

class ВводЧисла {
  constructor(сИмяНастройки, чШаг, nPrecision, сИдУзла) {
    Check(nPrecision >= 0 && IsNonEmptyString(сИдУзла));
    this._сИмяНастройки = сИмяНастройки;
    this._чШаг = чШаг;
    this._чТочность = nPrecision;
    this._чДобавить = 0;
    this._кИнтервал = 0;
    this._чТаймер = 0;
    m_Events.ДобавитьОбработчик(
      `тащилка-перетаскивание-${сИдУзла}`,
      (оПараметры) => this._ОбработатьПеретаскивание(оПараметры)
    );
    this._узЧисло = document.querySelector(`#${сИдУзла} > .вводчисла-число`);
    this.Обновить();
  }
  Обновить(nValue = m_Settings.Get(this._сИмяНастройки)) {
    this._узЧисло.value =
      nValue === АВТОНАСТРОЙКА
        ? Текст(
          m_Settings.GetSettingParameters(this._сИмяНастройки)
            .sAutoTune
        )
        : m_i18n.FormatNumber(nValue, this._чТочность);
  }
  _ОбработатьПеретаскивание(оПараметры) {
    const ИНТЕРВАЛ_ИЗМЕНЕНИЯ_ЗНАЧЕНИЯ = 130;
    if (оПараметры.чШаг === 1) {
      this._чДобавить = оПараметры.узНажат.classList.contains("вводчисла-минус")
        ? -this._чШаг
        : this._чШаг;
      this._кИнтервал = 0;
      this._чТаймер = setInterval(
        () => this._ОбработатьТаймер(),
        ИНТЕРВАЛ_ИЗМЕНЕНИЯ_ЗНАЧЕНИЯ
      );
      this._ОбработатьТаймер();
    }
    if (оПараметры.чШаг === 3) {
      clearInterval(this._чТаймер);
    }
  }
}

ВводЧисла.prototype._ОбработатьТаймер = AddExceptionHandler(
  function () {
    const ЗАДЕРЖКА_ИЗМЕНЕНИЯ_ЗНАЧЕНИЯ = 3;
    if (
      ++this._кИнтервал == 1 ||
      this._кИнтервал > ЗАДЕРЖКА_ИЗМЕНЕНИЯ_ЗНАЧЕНИЯ
    ) {
      const оПараметрыНастройки = m_Settings.GetSettingParameters(
        this._сИмяНастройки
      );
      const nValue = m_Settings.Get(this._сИмяНастройки);
      let чНовоеЗначение;
      if (
        (оПараметрыНастройки.sAutoTune &&
          this._чДобавить < 0 &&
          nValue === оПараметрыНастройки.nMinimum) ||
        (оПараметрыНастройки.sAutoTune &&
          this._чДобавить > 0 &&
          nValue === оПараметрыНастройки.nMaximum)
      ) {
        чНовоеЗначение = АВТОНАСТРОЙКА;
      } else if (nValue === АВТОНАСТРОЙКА && this._чДобавить > 0) {
        чНовоеЗначение = оПараметрыНастройки.nMinimum;
      } else if (nValue === АВТОНАСТРОЙКА && this._чДобавить < 0) {
        чНовоеЗначение = оПараметрыНастройки.nMaximum;
      } else {
        чНовоеЗначение = nValue + this._чДобавить;
      }
      if (чНовоеЗначение !== АВТОНАСТРОЙКА) {
        чНовоеЗначение = Clamp(
          Round(чНовоеЗначение, this._чТочность),
          оПараметрыНастройки.nMinimum,
          оПараметрыНастройки.nMaximum
        );
      }
      if (чНовоеЗначение !== nValue) {
        m_Settings.Change(this._сИмяНастройки, чНовоеЗначение);
        this.Обновить(чНовоеЗначение);
        this.ПослеИзменения(чНовоеЗначение);
      }
    }
  }
);

ВводЧисла.prototype.ПослеИзменения = STUB;

const m_Events = (() => {
  let _амОбработчики = new Map();
  function ДобавитьОбработчик(sEvent, фОбработчик) {
    Check(IsNonEmptyString(sEvent));
    Check(typeof фОбработчик == "function" || IsObject(фОбработчик));
    let мноОбработчикиСобытия = _амОбработчики.get(sEvent);
    if (мноОбработчикиСобытия === void 0) {
      мноОбработчикиСобытия = new Set();
      _амОбработчики.set(sEvent, мноОбработчикиСобытия);
    }
    мноОбработчикиСобытия.add(фОбработчик);
  }
  function УдалитьОбработчик(sEvent, фОбработчик) {
    Check(IsNonEmptyString(sEvent));
    Check(typeof фОбработчик == "function" || IsObject(фОбработчик));
    const мноОбработчикиСобытия = _амОбработчики.get(sEvent);
    if (мноОбработчикиСобытия !== void 0) {
      мноОбработчикиСобытия.delete(фОбработчик);
      if (мноОбработчикиСобытия.size === 0) {
        _амОбработчики.delete(sEvent);
      }
    }
  }
  function SendEvent(sEvent, пДанные) {
    Check(IsNonEmptyString(sEvent));
    m_Log.Вот(`[События] Event occurred: ${sEvent}`);
    const мноОбработчикиСобытия = _амОбработчики.get(sEvent);
    if (мноОбработчикиСобытия !== void 0) {
      Check(мноОбработчикиСобытия.size !== 0);
      let oEvent;
      for (let фОбработчик of мноОбработчикиСобытия.values()) {
        if (typeof фОбработчик == "function") {
          фОбработчик(пДанные, sEvent);
        } else {
          if (oEvent === void 0) {
            oEvent = {
              type: sEvent,
              data: пДанные,
            };
          }
          фОбработчик.handleEvent(oEvent);
        }
      }
    }
  }
  return {
    ДобавитьОбработчик,
    УдалитьОбработчик,
    SendEvent,
  };
})();

const м_Помойка = (() => {
  class ПомойкаВКаналеСообщений {
    constructor() {
      this._оКаналСообщений = null;
    }
    Выбросить(пБарахло) {
      if (IsObject(пБарахло)) {
        const буфБарахло = пБарахло.buffer ? пБарахло.buffer : пБарахло;
        if (буфБарахло.byteLength) {
          m_Log.Вот(`[Помойка] Выбрасываю ${буфБарахло.byteLength} байтов`);
          if (this._оКаналСообщений === null) {
            this._оКаналСообщений = new MessageChannel();
            this._оКаналСообщений.port2.close();
          }
          this._оКаналСообщений.port1.postMessage(буфБарахло, [буфБарахло]);
        }
      }
    }
    Сжечь() { }
  }
  class ПомойкаВРабочемПотоке {
    constructor() {
      this._оРабочийПоток = null;
      this._кбВПомойке = 0;
      m_Events.ДобавитьОбработчик(
        "управление-изменилосьсостояние",
        (чСостояние) => {
          if (
            чСостояние === STATE_BROADCAST_END ||
            чСостояние === STATE_STOP ||
            чСостояние === STATE_REPEAT
          ) {
            this.Сжечь();
          }
        }
      );
    }
    Выбросить(пБарахло) {
      const ВМЕСТИМОСТЬ_ПОМОЙКИ = 1e7;
      if (IsObject(пБарахло)) {
        const буфБарахло = пБарахло.buffer ? пБарахло.buffer : пБарахло;
        if (буфБарахло.byteLength) {
          m_Log.Вот(`[Помойка] Выбрасываю ${буфБарахло.byteLength} байтов`);
          if (this._оРабочийПоток === null) {
            this._оРабочийПоток = new Worker("/recycler.js");
          }
          this._кбВПомойке += буфБарахло.byteLength;
          this._оРабочийПоток.postMessage(буфБарахло, [буфБарахло]);
          if (this._кбВПомойке > ВМЕСТИМОСТЬ_ПОМОЙКИ) {
            this.Сжечь();
          }
        }
      }
    }
    Сжечь() {
      if (this._оРабочийПоток !== null) {
        m_Log.Вот(`[Помойка] Сжигаю ${this._кбВПомойке} байтов`);
        this._оРабочийПоток.postMessage(null);
        this._оРабочийПоток = null;
        this._кбВПомойке = 0;
      }
    }
  }
  if (isMobileDevice()) {
    return {
      Выбросить: STUB,
      Сжечь: STUB,
    };
  }
  return getBrowserEngineVersion() < 67
    ? new ПомойкаВРабочемПотоке()
    : new ПомойкаВКаналеСообщений();
})();

const м_Фокусник = (() => {
  let _оСостояние = ПолучитьНовоеСостояние();
  function ПолучитьСостояние() {
    return _оСостояние;
  }
  function ПолучитьНовоеСостояние() {
    const лПоказан = !document.hidden;
    const лАктивен = лПоказан && document.hasFocus();
    return {
      лПоказан,
      лАктивен,
    };
  }
  const ОбработатьСобытие = AddExceptionHandler((oEvent) => {
    m_Log.Вот(
      `[Фокусник] Событие ${oEvent.type}, старое состояние ${m_Log.O(
        _оСостояние
      )}`
    );
    setTimeout(ОбновитьСостояние);
  });
  const ОбновитьСостояние = AddExceptionHandler(() => {
    const оНовоеСостояние = ПолучитьНовоеСостояние();
    if (
      _оСостояние.лПоказан !== оНовоеСостояние.лПоказан ||
      _оСостояние.лАктивен !== оНовоеСостояние.лАктивен
    ) {
      m_Log.Окак(
        `[Фокусник] Новое состояние ${m_Log.O(оНовоеСостояние)}`
      );
      _оСостояние = оНовоеСостояние;
      m_Events.SendEvent("фокусник-изменилосьсостояние", оНовоеСостояние);
    }
  });
  m_Log.Вот(`[Фокусник] Начальное состояние ${m_Log.O(_оСостояние)}`);
  document.addEventListener("visibilitychange", ОбработатьСобытие);
  window.addEventListener("focus", ОбработатьСобытие);
  window.addEventListener("blur", ОбработатьСобытие);
  return {
    ПолучитьСостояние,
  };
})();

const м_Пульс = (() => {
  const ИНТЕРВАЛ_ПРОВЕРКИ = 970;
  const МИН_ОТКЛОНЕНИЕ_ВРЕМЕНИ = -30;
  const МАКС_ОТКЛОНЕНИЕ_ВРЕМЕНИ = 200;
  const МАКС_ОТКЛОНЕНИЕ_ДАТЫ = 40;
  let _чМаксимальноеОтклонение = 0;
  let _чТаймер = 0;
  let _чВремя;
  let _чДата;
  const ПроверитьПульс = AddExceptionHandler(() => {
    const чВремя = performance.now();
    const чДата = Date.now();
    const чОтклонениеВремени = чВремя - _чВремя - ИНТЕРВАЛ_ПРОВЕРКИ;
    const чОтклонениеДаты = чДата - _чДата - (чВремя - _чВремя);
    if (
      чОтклонениеВремени < МИН_ОТКЛОНЕНИЕ_ВРЕМЕНИ ||
      чОтклонениеВремени > МАКС_ОТКЛОНЕНИЕ_ВРЕМЕНИ ||
      Math.abs(чОтклонениеДаты) > МАКС_ОТКЛОНЕНИЕ_ДАТЫ
    ) {
      m_Log.Ой(
        `[Пульс] ${m_Log.F0(чОтклонениеВремени)} ${m_Log.F0(
          чОтклонениеДаты
        )}`
      );
    }
    _чМаксимальноеОтклонение = Math.max(
      _чМаксимальноеОтклонение,
      чОтклонениеВремени
    );
    _чВремя = чВремя;
    _чДата = чДата;
    _чТаймер = setTimeout(ПроверитьПульс, ИНТЕРВАЛ_ПРОВЕРКИ);
  });
  function ОбработатьИзменениеСостояния(чСостояние) {
    if (
      чСостояние === STATE_BROADCAST_END ||
      чСостояние === STATE_STOP ||
      чСостояние === STATE_REPEAT
    ) {
      if (_чТаймер !== 0) {
        m_Log.Вот("[Пульс] Таймер остановлен");
        clearTimeout(_чТаймер);
        _чТаймер = 0;
      }
    } else if (_чТаймер === 0) {
      m_Log.Вот("[Пульс] Таймер запущен");
      _чВремя = performance.now();
      _чДата = Date.now();
      _чТаймер = setTimeout(ПроверитьПульс, ИНТЕРВАЛ_ПРОВЕРКИ);
    }
  }
  function GetDataForReport() {
    return _чМаксимальноеОтклонение;
  }
  m_Events.ДобавитьОбработчик(
    "управление-изменилосьсостояние",
    ОбработатьИзменениеСостояния
  );
  return {
    GetDataForReport,
  };
})();

const м_Статистика = (() => {
  const ЧАСТОТА_ОБНОВЛЕНИЯ_СТАТИСТИКИ = 3;
  const РАЗМЕР_ИСТОРИИ_СПИСКА = 30;
  const РАЗМЕР_ИСТОРИИ_ЗАГРУЗКИ = 30;
  const РАЗМЕР_ИСТОРИИ_БУФЕРА = 30;
  const РАЗМЕР_ИСТОРИИ_РЕКЛАМЫ = 15;
  const ВЫДЕЛИТЬ_ОЖИДАНИЕ_ОТВЕТА = 1;
  const ВЫДЕЛИТЬ_ПРЕОБРАЗОВАНО = 2;
  const ВЫДЕЛИТЬ_НЕ_ПРОСМОТРЕНО_МИН = 1;
  const ВЫДЕЛИТЬ_НЕ_ПРОСМОТРЕНО_МАКС = 0.5;
  const ВЫДЕЛИТЬ_ПРОПУЩЕННЫЕ_КАДРЫ = 100;
  const ВЫДЕЛИТЬ_ЧАСТОТУ_КАДРОВ = 0.85;
  const ВЫДЕЛИТЬ_ПОТЕРЮ_ВИДЕО_ОТН = 1 / 5;
  const ВЫДЕЛИТЬ_ПОТЕРЮ_ВИДЕО_АБС = 300;
  const ВЫДЕЛИТЬ_ИСЧЕРПАНИЕ_БУФЕРА = 5;
  let _чТаймер = 0;
  let _nTargetDuration = 0;
  let _чМинДлительностьВидеосемпла = -Infinity;
  let _чМаксДлительностьВидеосемпла = +Infinity;
  let _оИнтервалОбновления = null;
  let _оСегментовДобавлено = null;
  let _оСекундДобавлено = null;
  let _оТолщинаСегмента = null;
  let _оТолщинаКанала = null;
  let _оОжиданиеОтвета = null;
  let _оНеПросмотрено = null;
  let _кИсходныхСегментов = 0;
  let _кЗабракованныхСегментов = 0;
  let _кбВсегоСкачано = 0;
  let _кОшибокЗагрузки = 0;
  let _кПропущенныхСегментов = 0;
  let _кНезагруженныхСегментов = 0;
  let _кПотерьВидео = 0;
  let _кПотерьЗвука = 0;
  let _кИсчерпанийБуфера = 0;
  let _кИсчерпанийБуфераДосрочно = 0;
  let _кПереполненийБуфера = 0;
  let _чПропущеноВБуфере = 0;
  let _кКоличествоРекламы = 0;
  let _мчНачалоРекламы = [];
  let _мчКонецРекламы = [];
  let _чВремяПоследнегоОбновления;
  function ВыделитьСегментовДобавлено(чЧисло) {
    return чЧисло !== 1 && чЧисло !== 2;
  }
  function ВыделитьОжиданиеОтвета(чЧисло) {
    return чЧисло >= ВЫДЕЛИТЬ_ОЖИДАНИЕ_ОТВЕТА;
  }
  function ВыделитьНеПросмотрено(чЧисло) {
    return (
      чЧисло < ВЫДЕЛИТЬ_НЕ_ПРОСМОТРЕНО_МИН ||
      чЧисло >=
      m_Settings.Get("чМаксРазмерБуфера") +
      m_Settings.Get("чРастягиваниеБуфера") *
      ВЫДЕЛИТЬ_НЕ_ПРОСМОТРЕНО_МАКС
    );
  }
  class Анализ {
    constructor(сИдУзла, чРазмерИстории, nPrecision) {
      Check(чРазмерИстории > 0 && nPrecision >= 0);
      this._узТаблица = GetNode(сИдУзла);
      this._мчИстория = new Array(чРазмерИстории);
      this._млВыделить = new Array(чРазмерИстории);
      this._чТочность = nPrecision;
      this._Очистить();
    }
    Освободить() {
      this._узТаблица.textContent = "";
      this._узТаблица = null;
    }
    Очистить() {
      if (this._кЗаполнено !== 0) {
        this._Очистить();
      }
    }
    ПолучитьПоследнееЧисло(чЗаглушка) {
      return this._кЗаполнено === 0
        ? чЗаглушка
        : this._мчИстория[this._чИндекс];
    }
    ДобавитьЧисло(чЧисло, пВыделить, пВыделитьСреднее) {
      const НАЧАЛО_ИСТОРИИ = 5;
      const лВыделить = Boolean(
        typeof пВыделить == "function" ? пВыделить(чЧисло) : пВыделить
      );
      if (this._кЗаполнено !== 0) {
        this._узТаблица.children[НАЧАЛО_ИСТОРИИ + this._чИндекс].classList.add(
          "статистика-подробно"
        );
      }
      if (this._кЗаполнено !== this._мчИстория.length) {
        ++this._кЗаполнено;
      }
      if (++this._чИндекс === this._мчИстория.length) {
        this._чИндекс = 0;
      }
      this._мчИстория[this._чИндекс] = чЧисло;
      this._млВыделить[this._чИндекс] = лВыделить;
      let чМинимальноеЧисло = Infinity,
        лВыделитьМинимальное = false;
      let чМаксимальноеЧисло = -Infinity,
        лВыделитьМаксимальное = false;
      let чСреднееЧисло = 0,
        кЧисел = 0;
      for (let ы = 0; ы < this._кЗаполнено; ++ы) {
        if (Number.isFinite(this._мчИстория[ы])) {
          if (
            this._мчИстория[ы] < чМинимальноеЧисло ||
            (this._мчИстория[ы] === чМинимальноеЧисло && this._млВыделить[ы])
          ) {
            чМинимальноеЧисло = this._мчИстория[ы];
            лВыделитьМинимальное = this._млВыделить[ы];
          }
          if (
            this._мчИстория[ы] > чМаксимальноеЧисло ||
            (this._мчИстория[ы] === чМаксимальноеЧисло && this._млВыделить[ы])
          ) {
            чМаксимальноеЧисло = this._мчИстория[ы];
            лВыделитьМаксимальное = this._млВыделить[ы];
          }
          чСреднееЧисло += this._мчИстория[ы];
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
        this._узТаблица.children[0],
        this._ВСтроку(чМинимальноеЧисло),
        лВыделитьМинимальное
      );
      ОбновитьЗначение(
        this._узТаблица.children[2],
        this._ВСтроку(чСреднееЧисло),
        лВыделитьСреднее
      );
      ОбновитьЗначение(
        this._узТаблица.children[4],
        this._ВСтроку(чМаксимальноеЧисло),
        лВыделитьМаксимальное
      );
      ОбновитьЗначение(
        this._узТаблица.children[НАЧАЛО_ИСТОРИИ + this._чИндекс],
        this._ВСтроку(чЧисло),
        лВыделить
      ).classList.remove("статистика-подробно");
      return чСреднееЧисло;
    }
    _Очистить() {
      this._кЗаполнено = 0;
      this._чИндекс = -1;
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
      for (let ы = this._мчИстория.length; --ы >= 0;) {
        узФрагмент.appendChild(document.createElement("td")).className =
          "анализ-история статистика-подробно";
      }
      this._узТаблица.textContent = "";
      this._узТаблица.appendChild(узФрагмент);
    }
    _ВСтроку(чЧисло) {
      return Number.isFinite(чЧисло)
        ? чЧисло.toFixed(чЧисло < 100 ? this._чТочность : 0)
        : " ";
    }
  }
  function ОбновитьЗначение(pElement, pValue, лВыделить) {
    const узЭлемент = GetNode(pElement);
    узЭлемент.classList.toggle("статистика-выделить", лВыделить);
    узЭлемент.textContent = pValue;
    return узЭлемент;
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
      м_Проигрыватель.ПолучитьКоличествоПропущенныхКадров(); // m_Player.GetDroppedFramesCount();
    ОбновитьЗначение( // UpdateValue(
      "статистика-пропущено", // "statistics-dropped",
      droppedVideoFrames,
      droppedVideoFrames >= ВЫДЕЛИТЬ_ПРОПУЩЕННЫЕ_КАДРЫ // droppedVideoFrames >= HIGHLIGHT_DROPPED_FRAMES
    ).nextElementSibling.nextElementSibling.textContent = totalVideoFrames;
    let чЖдетЗагрузки = 0, // let nWaitingForDownload = 0,
      чЗагружается = 0, // nDownloading = 0,
      кПреобразовано = 0, // nConvertedCount = 0,
      чПреобразовано = 0; // nConvertedDuration = 0;
    for (let оСегмент of г_моОчередь) { // for (let oSegment of g_aoQueue) {
      switch (оСегмент.чОбработка) { // switch (oSegment.nProcessing) {
        case PROCESSING_AWAITING_DOWNLOAD: // case PROCESSING_WAITING_FOR_DOWNLOAD:
          чЖдетЗагрузки += оСегмент.чДлительность; // nWaitingForDownload += oSegment.nDuration;
          break;

        case PROCESSING_DOWNLOADING: // case PROCESSING_DOWNLOADING:
        case PROCESSING_DOWNLOADED: // case PROCESSING_DOWNLOADED:
          чЗагружается += оСегмент.чДлительность; // nDownloading += oSegment.nDuration;
          break;

        case PROCESSING_CONVERTED: // case PROCESSING_CONVERTED:
          кПреобразовано++;
          чПреобразовано += оСегмент.чДлительность; // nConvertedDuration += oSegment.nDuration;
          break;

        default:
          Check(false); // Check(false);
      }
    }
    const { чПросмотрено, чНеПросмотрено } = // const { nWatched, nNotWatched } =
      м_Проигрыватель.ПолучитьЗаполненностьБуфера(); // m_Player.GetBufferFullness();
    let уз = ОбновитьЗначение( // let node = UpdateValue(
      "статистика-очередь", // "statistics-queue",
      чЖдетЗагрузки.toFixed(1), // nWaitingForDownload.toFixed(1),
      чЖдетЗагрузки > m_Settings.Get("чМаксРазмерБуфера") // nWaitingForDownload > m_Settings.Get("nMaxBufferSize")
    );
    уз = уз.nextElementSibling.nextElementSibling;
    уз.textContent = чЗагружается.toFixed(1); // node.textContent = nDownloading.toFixed(1);
    уз = уз.nextElementSibling;
    ОбновитьЗначение( // UpdateValue(
      уз, // node,
      чПреобразовано.toFixed(1), // nConvertedDuration.toFixed(1),
      кПреобразовано >= ВЫДЕЛИТЬ_ПРЕОБРАЗОВАНО // nConvertedCount >= HIGHLIGHT_CONVERTED
    );
    уз = уз.nextElementSibling;
    ОбновитьЗначение( // UpdateValue(
      уз, // node,
      чНеПросмотрено.toFixed(1), // nNotWatched.toFixed(1),
      ВыделитьНеПросмотрено(чНеПросмотрено) // HighlightNotWatched(nNotWatched)
    );
    уз = уз.nextElementSibling.nextElementSibling;
    уз.textContent = чПросмотрено.toFixed(1); // node.textContent = nWatched.toFixed(1);
  }
  function ОкноОткрыто() {
    return _чТаймер !== 0;
  }
  function ОткрытьОкно() {
    if (ОкноОткрыто()) {
      return;
    }
    _оИнтервалОбновления = new Анализ(
      "statistics-updateinterval",
      РАЗМЕР_ИСТОРИИ_СПИСКА,
      1
    );
    _оСегментовДобавлено = new Анализ(
      "statistics-segmentsadded",
      РАЗМЕР_ИСТОРИИ_СПИСКА,
      0
    );
    _оСекундДобавлено = new Анализ(
      "statistics-secondsadded",
      РАЗМЕР_ИСТОРИИ_СПИСКА,
      1
    );
    _оТолщинаСегмента = new Анализ(
      "statistics-segmentthickness",
      РАЗМЕР_ИСТОРИИ_ЗАГРУЗКИ,
      1
    );
    _оТолщинаКанала = new Анализ(
      "statistics-channelthickness",
      РАЗМЕР_ИСТОРИИ_ЗАГРУЗКИ,
      1
    );
    _оОжиданиеОтвета = new Анализ(
      "statistics-responsewait",
      РАЗМЕР_ИСТОРИИ_ЗАГРУЗКИ,
      1
    );
    _оНеПросмотрено = new Анализ(
      "statistics-unwatched",
      РАЗМЕР_ИСТОРИИ_БУФЕРА,
      1
    );
    _чВремяПоследнегоОбновления = NaN;
    GetNode("статистика-количестворекламы").textContent = _кКоличествоРекламы;
    GetNode("статистика-частотарекламы").textContent = получитьЧастотуРекламы();
    GetNode("статистика-исходных").textContent = _кИсходныхСегментов;
    ОбновитьЗначение(
      "статистика-забракованных",
      _кЗабракованныхСегментов,
      _кЗабракованныхСегментов !== 0
    );
    ОбновитьЗначение(
      "статистика-ошибокзагрузки",
      _кОшибокЗагрузки,
      _кОшибокЗагрузки !== 0
    );
    ОбновитьЗначение(
      "статистика-пропущенныхсегментов",
      _кПропущенныхСегментов,
      _кПропущенныхСегментов !== 0
    );
    GetNode("статистика-незагруженныхсегментов").textContent =
      _кНезагруженныхСегментов;
    ОбновитьЗначение(
      "статистика-потерьвидео",
      _кПотерьВидео,
      _кПотерьВидео !== 0
    );
    ОбновитьЗначение(
      "статистика-потерьзвука",
      _кПотерьЗвука,
      _кПотерьЗвука !== 0
    );
    ОбновитьЗначение(
      "статистика-исчерпано",
      _кИсчерпанийБуфера,
      _кИсчерпанийБуфера >= ВЫДЕЛИТЬ_ИСЧЕРПАНИЕ_БУФЕРА
    );
    ОбновитьЗначение(
      "статистика-переполнено",
      _кПереполненийБуфера,
      _кПереполненийБуфера !== 0
    ).nextElementSibling.nextElementSibling.textContent =
      _чПропущеноВБуфере.toFixed(1);
    _чТаймер = setInterval(
      AddExceptionHandler(ОбновитьСтатистику),
      1e3 / ЧАСТОТА_ОБНОВЛЕНИЯ_СТАТИСТИКИ
    );
    ОбновитьСтатистику();
    m_Events.ДобавитьОбработчик(
      "тащилка-перетаскивание-статистика",
      ОбработатьПеретаскиваниеОкна
    );
    ПоказатьЭлемент("статистика", true);
    m_Settings.Change("лПоказатьСтатистику", true);
  }
  function ЗакрытьОкно() {
    if (!ОкноОткрыто()) {
      return;
    }
    ПоказатьЭлемент("статистика", false);
    _оИнтервалОбновления.Освободить();
    _оИнтервалОбновления = null;
    _оСегментовДобавлено.Освободить();
    _оСегментовДобавлено = null;
    _оСекундДобавлено.Освободить();
    _оСекундДобавлено = null;
    _оТолщинаСегмента.Освободить();
    _оТолщинаСегмента = null;
    _оТолщинаКанала.Освободить();
    _оТолщинаКанала = null;
    _оОжиданиеОтвета.Освободить();
    _оОжиданиеОтвета = null;
    _оНеПросмотрено.Освободить();
    _оНеПросмотрено = null;
    for (let уз of document.querySelectorAll("[data-очистить]")) {
      уз.textContent = "";
    }
    clearInterval(_чТаймер);
    _чТаймер = 0;
    m_Settings.Change("лПоказатьСтатистику", false);
  }
  function ОбработатьПеретаскиваниеОкна(оПараметры) {
    switch (оПараметры.чШаг) {
      case 1:
        const оСтиль = getComputedStyle(оПараметры.узТащится);
        оПараметры._чНачальнаяX = Number.parseInt(оСтиль.left, 10);
        оПараметры._чНачальнаяY = Number.parseInt(оСтиль.top, 10);
        break;

      case 2:
        оПараметры.узТащится.style.setProperty(
          "--x",
          `${оПараметры._чНачальнаяX + оПараметры.чИзменениеX}px`
        );
        оПараметры.узТащится.style.setProperty(
          "--y",
          `${оПараметры._чНачальнаяY + оПараметры.чИзменениеY}px`
        );
        break;

      case 3:
        break;

      default:
        Check(false);
    }
  }
  function Запустить() {
    if (m_Settings.Get("лПоказатьСтатистику")) {
      ОткрытьОкно();
    }
  }
  function ОчиститьИсторию() {
    if (_оИнтервалОбновления !== null) {
      _оИнтервалОбновления.Очистить();
      _оСегментовДобавлено.Очистить();
      _оСекундДобавлено.Очистить();
      _оТолщинаСегмента.Очистить();
      _оТолщинаКанала.Очистить();
      _оОжиданиеОтвета.Очистить();
      _оНеПросмотрено.Очистить();
      _чВремяПоследнегоОбновления = NaN;
    }
    ОбновитьЗначение(
      "статистика-ошибокзагрузки",
      (_кОшибокЗагрузки = 0),
      false
    );
    ОбновитьЗначение(
      "статистика-пропущенныхсегментов",
      (_кПропущенныхСегментов = 0),
      false
    );
    GetNode("статистика-незагруженныхсегментов").textContent =
      _кНезагруженныхСегментов = 0;
    ОбновитьЗначение("статистика-исчерпано", (_кИсчерпанийБуфера = 0), false);
    ОбновитьЗначение(
      "статистика-переполнено",
      (_кПереполненийБуфера = 0),
      false
    ).nextElementSibling.nextElementSibling.textContent =
      (_чПропущеноВБуфере = 0).toFixed(1);
  }
  function ПолучитьTargetDuration() {
    return _nTargetDuration;
  }
  function ПолучитьДлительностьКадраВСекундах() {
    return {
      чМинимальная: Math.max(17, _чМинДлительностьВидеосемпла) / 1e3,
      чМаксимальная: Math.min(1e3 / 25, _чМаксДлительностьВидеосемпла) / 1e3,
    };
  }
  function GetDataForReport() {
    return {
      ПараметрыВидео:
        GetNode("статистика-разрешениевидео").textContent +
        " " +
        GetNode("statistics-videocompression").textContent,
      ПараметрыЗвука: GetNode("статистика-сжатиезвука").textContent,
      ЗабракованныхСегментов: _кЗабракованныхСегментов,
      ПропущенныхСегментов: _кПропущенныхСегментов,
      ОшибокЗагрузки: _кОшибокЗагрузки,
      НезагруженныхСегментов: _кНезагруженныхСегментов,
      ПотерьВидео: _кПотерьВидео,
      ПотерьЗвука: _кПотерьЗвука,
      ИсчерпанийБуфера: _кИсчерпанийБуфера,
      ИсчерпанийБуфераДосрочно: _кИсчерпанийБуфераДосрочно,
      ПереполненийБуфера: _кПереполненийБуфера,
      ПропущеноВБуфере: _чПропущеноВБуфере,
      Реклама: `${_кКоличествоРекламы} ${получитьЧастотуРекламы()}`,
    };
  }
  function РазобранСписокСегментов(оСписок) {
    _nTargetDuration = оСписок.nTargetDuration;
    if (ОкноОткрыто()) {
      if (оСписок.моСегменты.length !== 0) {
        GetNode("statistics-server").textContent = new URL(
          оСписок.моСегменты[оСписок.моСегменты.length - 1].sAddress
        ).host;
      }
      const чДлительностьСписка = оСписок.моСегменты.reduce(
        (чСумма, { чДлительность }) => чСумма + чДлительность,
        0
      );
      GetNode("статистика-список").textContent = `${оСписок.моСегменты.length
        } × ${(чДлительностьСписка / оСписок.моСегменты.length).toFixed(
          1
        )} = ${чДлительностьСписка.toFixed(1)} − ${оСписок.кРекламныхСегментов}`;
      GetNode("статистика-targetduration").textContent = оСписок.nTargetDuration;
    }
  }
  function ДобавленыСегментыВОчередь(кСегментовДобавлено, кСекундДобавлено) {
    if (ОкноОткрыто()) {
      const чВремя = performance.now();
      _оИнтервалОбновления.ДобавитьЧисло(
        (чВремя - _чВремяПоследнегоОбновления) / 1e3
      );
      _чВремяПоследнегоОбновления = чВремя;
      _оСегментовДобавлено.ДобавитьЧисло(
        кСегментовДобавлено,
        ВыделитьСегментовДобавлено,
        ВыделитьСегментовДобавлено
      );
      _оСекундДобавлено.ДобавитьЧисло(кСекундДобавлено);
    }
  }
  function ПолученИсходныйСегмент() {
    ++_кИсходныхСегментов;
    if (ОкноОткрыто()) {
      document.getElementById("статистика-исходных").textContent =
        _кИсходныхСегментов;
    }
  }
  function ЗабракованСегмент() {
    ++_кЗабракованныхСегментов;
    if (ОкноОткрыто()) {
      ОбновитьЗначение(
        "статистика-забракованных",
        _кЗабракованныхСегментов,
        true
      );
    }
  }
  function СкачаноНечто(кбСкачано) {
    if (Number.isFinite(кбСкачано)) {
      _кбВсегоСкачано += кбСкачано;
      if (ОкноОткрыто()) {
        document.getElementById("статистика-скачано").textContent = (
          _кбВсегоСкачано /
          1024 /
          1024
        ).toFixed();
      }
    }
  }
  function ЗагруженСегмент(
    чРазмерСегмента,
    чДлительностьСегмента,
    чДлительностьЗагрузки,
    чОжиданиеОтвета
  ) {
    if (ОкноОткрыто()) {
      const чСредняяТолщинаСегмента = _оТолщинаСегмента.ДобавитьЧисло(
        (чРазмерСегмента * 8) / 1e6 / чДлительностьСегмента
      );
      чДлительностьЗагрузки /= 1e3;
      _оТолщинаКанала.ДобавитьЧисло(
        (чРазмерСегмента * 8) / 1e6 / чДлительностьЗагрузки,
        чДлительностьЗагрузки > чДлительностьСегмента,
        (чЧисло) => чЧисло < чСредняяТолщинаСегмента
      );
      _оОжиданиеОтвета.ДобавитьЧисло(
        чОжиданиеОтвета / 1e3,
        ВыделитьОжиданиеОтвета,
        ВыделитьОжиданиеОтвета
      );
    }
  }
  function НеЗагруженыСегменты(кНезагруженныхСегментов) {
    Check(кНезагруженныхСегментов > 0);
    _кОшибокЗагрузки++;
    _кНезагруженныхСегментов += кНезагруженныхСегментов;
    if (ОкноОткрыто()) {
      ОбновитьЗначение("статистика-ошибокзагрузки", _кОшибокЗагрузки, true);
      GetNode("статистика-незагруженныхсегментов").textContent =
        _кНезагруженныхСегментов;
    }
  }
  function пропущеныСегменты(кПропущенныхСегментов) {
    Check(кПропущенныхСегментов > 0);
    _кПропущенныхСегментов++;
    _кНезагруженныхСегментов += кПропущенныхСегментов;
    if (ОкноОткрыто()) {
      ОбновитьЗначение(
        "статистика-пропущенныхсегментов",
        _кПропущенныхСегментов,
        true
      );
      GetNode("статистика-незагруженныхсегментов").textContent =
        _кНезагруженныхСегментов;
    }
  }
  function ПолученПреобразованныйСегмент(оСегмент) {
    const лОкноОткрыто = ОкноОткрыто();
    const оДанные = оСегмент.пДанные;
    if (оДанные.bPassthrough) {
      // fMP4 arrives already muxed, so none of the values the MPEG-TS demuxer
      // derives exist here. Report what the playlist itself declares and leave the
      // rest blank rather than printing NaN.
      if (оСегмент.лРазрыв && лОкноОткрыто) {
        GetNode("statistics-videocompression").textContent = оДанные.лЕстьВидео
          ? оДанные.sCodecsDescription || "fMP4"
          : "—";
        GetNode("статистика-разрешениевидео").textContent =
          оДанные.sResolution || "—";
        GetNode("статистика-частотакадров").textContent = "";
        GetNode("статистика-сжатиезвука").textContent = оДанные.лЕстьЗвук
          ? "fMP4"
          : "—";
        GetNode("статистика-битрейтзвука").textContent = "";
        GetNode("статистика-преобразованза").textContent = "—";
      }
      return;
    }
    if (оДанные.hasOwnProperty("мбМедиасегмент")) {
      if (оСегмент.лРазрыв) {
        if (оДанные.лЕстьВидео) {
          let сСжатиеВидео =
            "H.264" +
            ` ${ПолучитьНазваниеПрофиляH264(
              оДанные.nProfileIndication,
              оДанные.nConstraintSetFlag
            )}` +
            ` L${(оДанные.nLevelIndication / 10).toFixed(1)}` +
            ` RF${оДанные.nMaxNumberReferenceFrames}`;
          if (оДанные.чДиапазон !== -1) {
            сСжатиеВидео += оДанные.чДиапазон === 0 ? " 16-235" : " 0-255";
          }
          if (оДанные.лЧересстрочное) {
            сСжатиеВидео += " interlaced";
          }
          if (оДанные.чЧастотаКадров !== 0) {
            сСжатиеВидео += ` ${оДанные.чЧастотаКадров < 0 ? "≈" : ""
              }${Math.abs(оДанные.чЧастотаКадров).toFixed(2)} ${Текст("J0140")}`;
          }
          GetNode("statistics-videocompression").textContent = сСжатиеВидео;
          GetNode(
            "статистика-разрешениевидео"
          ).textContent = `${оДанные.чШиринаКартинки}x${оДанные.чВысотаКартинки}`;
        } else {
          GetNode("statistics-videocompression").textContent = "—";
          GetNode("статистика-разрешениевидео").textContent = "—";
        }
        GetNode("статистика-частотакадров").textContent = "";
        if (оДанные.лЕстьЗвук) {
          GetNode("статистика-сжатиезвука").textContent =
            ["AAC-Main", "AAC-LC", "AAC-SSR", "AAC-LTP"][
            оДанные.nAudioObjectType - 1
            ] +
            ` ${оДанные.чЧастотаДискретизации} ${Текст("J0141")}` +
            ` ${оДанные.чКоличествоКаналов} ${Текст("J0142")}`;
        } else {
          GetNode("статистика-сжатиезвука").textContent = "—";
        }
        GetNode("статистика-битрейтзвука").textContent = "";
      }
      if (Number.isFinite(оДанные.чСредняяДлительностьВидеоСемпла)) {
        _чМинДлительностьВидеосемпла = оДанные.чМинДлительностьВидеоСемпла;
        _чМаксДлительностьВидеосемпла = оДанные.чМаксДлительностьВидеоСемпла;
        Check(
          _чМинДлительностьВидеосемпла <= _чМаксДлительностьВидеосемпла
        );
        const чОтносительноеОтклонение =
          оДанные.чСредняяДлительностьВидеоСемпла /
          оДанные.чМаксДлительностьВидеоСемпла;
        const чАбсолютноеОтклонение =
          оДанные.чМаксДлительностьВидеоСемпла -
          оДанные.чСредняяДлительностьВидеоСемпла;
        if (
          чОтносительноеОтклонение <= ВЫДЕЛИТЬ_ПОТЕРЮ_ВИДЕО_ОТН &&
          чАбсолютноеОтклонение >= ВЫДЕЛИТЬ_ПОТЕРЮ_ВИДЕО_АБС
        ) {
          m_Log.Ой(
            `[Статистика] Превышено отклонение длительности кадра в сегменте ${оСегмент.чНомер}` +
            ` СредняяДлительностьКадра=${m_Log.F0(
              оДанные.чСредняяДлительностьВидеоСемпла
            )}мс` +
            ` АбсолютноеОтклонение=${m_Log.F0(чАбсолютноеОтклонение)}мс` +
            ` ОтносительноеОтклонение=${m_Log.F2(
              чОтносительноеОтклонение
            )}`
          );
          оДанные.лПотериВидео = true;
        }
        if (лОкноОткрыто) {
          let сОтклонение = `@${(
            1e3 / оДанные.чСредняяДлительностьВидеоСемпла
          ).toFixed(1)}`;
          if (
            оДанные.чМаксДлительностьВидеоСемпла -
            оДанные.чМинДлительностьВидеоСемпла >
            2
          ) {
            сОтклонение +=
              ` −${(
                100 -
                (оДанные.чСредняяДлительностьВидеоСемпла /
                  оДанные.чМаксДлительностьВидеоСемпла) *
                100
              ).toFixed()}%` +
              ` +${(
                (оДанные.чСредняяДлительностьВидеоСемпла /
                  оДанные.чМинДлительностьВидеоСемпла) *
                100 -
                100
              ).toFixed()}%`;
          }
          ОбновитьЗначение(
            "статистика-частотакадров",
            сОтклонение,
            чОтносительноеОтклонение <= ВЫДЕЛИТЬ_ЧАСТОТУ_КАДРОВ
          );
        }
      }
      if (Number.isFinite(оДанные.чБитрейтЗвука) && лОкноОткрыто) {
        GetNode(
          "статистика-битрейтзвука"
        ).textContent = `${оДанные.чБитрейтЗвука.toFixed()} ${Текст("J0143")}`;
      }
    }
    if (IsNumber(оДанные.чПреобразованЗа) && лОкноОткрыто) {
      GetNode("статистика-преобразованза").textContent =
        оДанные.чПреобразованЗа.toFixed();
    }
    if (оДанные.лЗабраковано) {
      ЗабракованСегмент();
    }
    if (оДанные.лПотериВидео) {
      ++_кПотерьВидео;
      if (лОкноОткрыто) {
        ОбновитьЗначение("статистика-потерьвидео", _кПотерьВидео, true);
      }
    }
    if (оДанные.лПотериЗвука) {
      ++_кПотерьЗвука;
      if (лОкноОткрыто) {
        ОбновитьЗначение("статистика-потерьзвука", _кПотерьЗвука, true);
      }
    }
  }
  function обновитьЗаполненностьБуфера(чНеПросмотрено) {
    if (ОкноОткрыто()) {
      _оНеПросмотрено.ДобавитьЧисло(
        чНеПросмотрено,
        ВыделитьНеПросмотрено,
        ВыделитьНеПросмотрено
      );
    }
  }
  function ИсчерпанБуферПроигрывателя(лДосрочно) {
    ++_кИсчерпанийБуфера;
    if (лДосрочно) {
      ++_кИсчерпанийБуфераДосрочно;
    }
    if (ОкноОткрыто()) {
      ОбновитьЗначение(
        "статистика-исчерпано",
        _кИсчерпанийБуфера,
        _кИсчерпанийБуфера >= ВЫДЕЛИТЬ_ИСЧЕРПАНИЕ_БУФЕРА
      );
    }
  }
  function получитьЧастотуРекламы() {
    let сРезультат = "";
    for (let ы = 0; ы < _мчНачалоРекламы.length; ++ы) {
      if (ы !== 0) {
        сРезультат += ` <${(
          (_мчНачалоРекламы[ы] - _мчКонецРекламы[ы - 1]) /
          1e3
        ).toFixed()}> `;
      }
      if (ы < _мчКонецРекламы.length) {
        сРезультат += (
          (_мчКонецРекламы[ы] - _мчНачалоРекламы[ы]) /
          1e3
        ).toFixed();
      } else {
        сРезультат += "?";
      }
    }
    return сРезультат;
  }
  m_Events.ДобавитьОбработчик("список-началорекламы", () => {
    Check(_мчНачалоРекламы.length === _мчКонецРекламы.length);
    _кКоличествоРекламы++;
    _мчНачалоРекламы.push(performance.now());
    if (ОкноОткрыто()) {
      GetNode("статистика-количестворекламы").textContent = _кКоличествоРекламы;
      GetNode("статистика-частотарекламы").textContent = получитьЧастотуРекламы();
    }
  });
  m_Events.ДобавитьОбработчик("список-конецрекламы", () => {
    if (_мчНачалоРекламы.length !== _мчКонецРекламы.length) {
      if (_мчКонецРекламы.length === РАЗМЕР_ИСТОРИИ_РЕКЛАМЫ) {
        _мчНачалоРекламы.shift();
        _мчКонецРекламы.shift();
      }
      _мчКонецРекламы.push(performance.now());
      if (ОкноОткрыто()) {
        GetNode("статистика-частотарекламы").textContent =
          получитьЧастотуРекламы();
      }
    }
  });
  m_Events.ДобавитьОбработчик(
    "проигрыватель-переполненбуфер",
    (чПропущено) => {
      ++_кПереполненийБуфера;
      _чПропущеноВБуфере += чПропущено;
      if (ОкноОткрыто()) {
        ОбновитьЗначение(
          "статистика-переполнено",
          _кПереполненийБуфера,
          true
        ).nextElementSibling.nextElementSibling.textContent =
          _чПропущеноВБуфере.toFixed(1);
      }
    }
  );
  m_Events.ДобавитьОбработчик(
    "управление-изменилосьсостояние",
    (чСостояние) => {
      if (чСостояние === STATE_START) {
        ОчиститьИсторию();
      }
    }
  );
  m_Events.ДобавитьОбработчик(
    "список-выбранварианттрансляции",
    ([моВарианты]) => {
      if (моВарианты) {
        ОчиститьИсторию();
      }
    }
  );
  return {
    Запустить,
    ОкноОткрыто,
    ОткрытьОкно,
    ЗакрытьОкно,
    ОбновитьЗначение,
    ОчиститьИсторию,
    ПолучитьTargetDuration,
    ПолучитьДлительностьКадраВСекундах,
    GetDataForReport,
    РазобранСписокСегментов,
    ДобавленыСегментыВОчередь,
    ПолученИсходныйСегмент,
    ЗабракованСегмент,
    СкачаноНечто,
    ЗагруженСегмент,
    НеЗагруженыСегменты,
    пропущеныСегменты,
    ПолученПреобразованныйСегмент,
    обновитьЗаполненностьБуфера,
    ИсчерпанБуферПроигрывателя,
  };
})();

const м_Окно = (() => {
  function получитьОткрытое() {
    return document.body.getAttribute("data-окно-открыто") || "";
  }
  function открытьОкно(сИдОкна) {
    const элОкно = GetNode(сИдОкна);
    Check(элОкно.classList.contains("окно"));
    элОкно.classList.add("окнооткрыто", "анимацияокна");
    document.body.setAttribute("data-окно-открыто", сИдОкна);
    m_Events.SendEvent(`окно-открыто-${сИдОкна}`);
  }
  function закрытьОкно(сИдОкна, лСАнимацией = true) {
    const элОкно = GetNode(сИдОкна);
    Check(элОкно.classList.contains("окно"));
    элОкно.classList.remove("окнооткрыто");
    элОкно.classList.toggle("анимацияокна", лСАнимацией);
    document.body.removeAttribute("data-окно-открыто");
  }
  function открыть(сИдОкна) {
    Check(IsNonEmptyString(сИдОкна));
    const сИдОткрытогоОкна = получитьОткрытое();
    if (сИдОкна === сИдОткрытогоОкна) {
      return false;
    }
    if (сИдОткрытогоОкна) {
      закрытьОкно(сИдОткрытогоОкна);
    }
    открытьОкно(сИдОкна);
    return true;
  }
  function закрыть(лСАнимацией = true) {
    const сИдОткрытогоОкна = получитьОткрытое();
    if (сИдОткрытогоОкна) {
      закрытьОкно(сИдОткрытогоОкна, лСАнимацией);
    }
  }
  function переключить(сИдОкна) {
    открыть(сИдОкна) || закрытьОкно(сИдОкна);
  }
  function настроитьИндикаторПрокрутки(пПрокрутка) {
    const элПрокрутка = GetNode(пПрокрутка);
    элПрокрутка.scrollTop = 0;
    обновитьИндикаторПрокрутки(элПрокрутка);
  }
  function обновитьИндикаторПрокрутки(элПрокрутка) {
    const лПоказать = !этотЭлементПолностьюПрокручен(элПрокрутка);
    ПоказатьЭлемент(GetNode(`индикаторпрокрутки-${элПрокрутка.id}`), лПоказать);
    элПрокрутка[лПоказать ? "addEventListener" : "removeEventListener"](
      "scroll",
      обработатьПрокрутку
    );
  }
  const обработатьПрокрутку = AddExceptionHandler((oEvent) => {
    обновитьИндикаторПрокрутки(oEvent.target);
  });
  m_Events.ДобавитьОбработчик(
    "управление-левыйщелчок",
    ({ target: элЩелчок }) => {
      const сИдОкна = элЩелчок.getAttribute("data-окно-переключить");
      if (сИдОкна) {
        переключить(сИдОкна);
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
    открыть,
    закрыть,
    переключить,
    настроитьИндикаторПрокрутки,
  };
})();

const м_Меню = (() => {
  function задатьДоступностьПункта(пПункт, лДоступен) {
    GetNode(пПункт).tabIndex = лДоступен ? 0 : -1;
  }
  GetNode("глаз").addEventListener("contextmenu", (oEvent) => {
    oEvent.preventDefault();
    м_Окно.переключить("главноеменю");
  });
  m_Events.ДобавитьОбработчик("управление-левыйщелчок", (oEvent) => {
    if (oEvent.target.classList.contains("меню-пункт")) {
      м_Окно.закрыть(false);
    }
  });
  return {
    задатьДоступностьПункта,
  };
})();

const м_ПолноэкранныйРежим = (() => {
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
    m_Events.SendEvent("полноэкранныйрежим-изменен", Обновить());
  });
  const ОбработатьДвойнойЩелчок = AddExceptionHandler((oEvent) => {
    if (oEvent.button === LEFT_BUTTON) {
      oEvent.preventDefault();
      Переключить();
    }
  });
  function ПолучитьЭлемент() {
    return GetNode("проигрывательичат");
  }
  function Включен() {
    return !!document[_sFullscreenElement];
  }
  function Обновить() {
    const лВключен = Включен();
    m_Log.Окак(`[ПолноэкранныйРежим] Режим включен: ${лВключен}`);
    ИзменитьКнопку("переключитьполноэкранный", лВключен);
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
    м_Автоскрытие.Скрыть(false);
    м_КартинкаВКартинке.отключить();
    ПолучитьЭлемент()[_sRequestFullscreen]();
    return true;
  }
  function Отключить() {
    if (!Включен()) {
      return false;
    }
    m_Log.Вот("[ПолноэкранныйРежим] Отключаю режим");
    м_Автоскрытие.Скрыть(false);
    document[_sExitFullscreen]();
    return true;
  }
  function Переключить() {
    Включить() || Отключить();
  }
  document.addEventListener(_sFullscreenchange, ОбработатьИзменениеРежима);
  GetNode("глаз").addEventListener("dblclick", ОбработатьДвойнойЩелчок);
  Обновить();
  return {
    Включен,
    Отключить,
    Переключить,
    ПолучитьЭлемент,
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
    ИзменитьКнопку("переключитькартинкавкартинке", лВключен);
  }
  function включить() {
    if (включен()) {
      return false;
    }
    m_Log.Вот("[КартинкаВКартинке] Включаю режим");
    м_ПолноэкранныйРежим.Отключить();
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
  function переключить() {
    _oMediaElement &&
      !document.body.classList.contains("нетвидео") &&
      (включить() || отключить());
  }
  function запустить(oMediaElement) {
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
    ПоказатьЭлемент("переключитькартинкавкартинке", true);
  }
  return {
    запустить,
    отключить,
    переключить,
  };
})();

const м_Тащилка = (() => {
  const МИН_ИНТЕРВАЛ_ПЕРЕТАСКИВАНИЯ = 45;
  let _чИдУказателя = NaN;
  let _оПараметры = null;
  let _чВремяПоследнегоПеретаскивания;
  let _чНачальнаяX, _чНачальнаяY;
  let _чПоследняяX, _чПоследняяY;
  function Параметры(узНажат, узТащится) {
    this.узНажат = узНажат;
    this.узТащится = узТащится;
    this.чШаг = 1;
    this.лОтмена = false;
    this.лИзмениласьX = false;
    this.лИзмениласьY = false;
    this.чИзменениеX = 0;
    this.чИзменениеY = 0;
  }
  const ОбработатьPointerDown = создатьОбработчикСобытийЭлемента((oEvent) => {
    if (!Number.isNaN(_чИдУказателя) || oEvent.button !== LEFT_BUTTON) {
      return;
    }
    const узНажат = oEvent.target.closest("[data-тащилка]");
    if (узНажат === null) {
      return;
    }
    _чИдУказателя = oEvent.pointerId;
    _оПараметры = new Параметры(
      узНажат,
      GetNode(узНажат.getAttribute("data-тащилка"))
    );
    _чВремяПоследнегоПеретаскивания = 0;
    _чНачальнаяX = _чПоследняяX = oEvent.clientX;
    _чНачальнаяY = _чПоследняяY = oEvent.clientY;
    m_Log.Окак(
      `[Тащилка] Начинаю перетаскивать ${_оПараметры.узТащится.id} X=${_чНачальнаяX} Y=${_чНачальнаяY} id=${_чИдУказателя} type=${oEvent.pointerType} primary=${oEvent.isPrimary}`
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
    m_Events.ДобавитьОбработчик(
      "фокусник-изменилосьсостояние",
      ОбработатьПокиданиеВкладки
    );
    м_ПолноэкранныйРежим
      .ПолучитьЭлемент()
      .style.setProperty(
        "cursor",
        getComputedStyle(узНажат).cursor,
        "important"
      );
    м_ПолноэкранныйРежим.ПолучитьЭлемент().classList.add("тащилка-перехват");
    _оПараметры.узТащится.classList.add("тащилка");
    m_Events.SendEvent(
      `тащилка-перетаскивание-${_оПараметры.узТащится.id}`,
      _оПараметры
    );
  });
  const ОбработатьPointerMove = AddExceptionHandler((oEvent) => {
    if (_чИдУказателя === oEvent.pointerId) {
      if ((oEvent.buttons & LEFT_BUTTON_PRESSED) == 0) {
        ЗавершитьПеретаскивание("кнопка отпущена");
      } else {
        const чВремя = performance.now();
        if (
          чВремя - _чВремяПоследнегоПеретаскивания >=
          МИН_ИНТЕРВАЛ_ПЕРЕТАСКИВАНИЯ
        ) {
          _чВремяПоследнегоПеретаскивания = чВремя;
          _оПараметры.лИзмениласьX = _чПоследняяX !== oEvent.clientX;
          _оПараметры.лИзмениласьY = _чПоследняяY !== oEvent.clientY;
          if (_оПараметры.лИзмениласьX || _оПараметры.лИзмениласьY) {
            _чПоследняяX = oEvent.clientX;
            _чПоследняяY = oEvent.clientY;
            _оПараметры.чШаг = 2;
            _оПараметры.чИзменениеX = _чПоследняяX - _чНачальнаяX;
            _оПараметры.чИзменениеY = _чПоследняяY - _чНачальнаяY;
            m_Events.SendEvent(
              `тащилка-перетаскивание-${_оПараметры.узТащится.id}`,
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
  function ОбработатьПокиданиеВкладки({ лАктивен }) {
    if (!лАктивен) {
      ЗавершитьПеретаскивание("вкладка неактивна");
    }
  }
  function ОтменитьПеретаскивание(сИдУзла) {
    Check(сИдУзла === void 0 || IsNonEmptyString(сИдУзла));
    if (
      !Number.isNaN(_чИдУказателя) &&
      (сИдУзла === void 0 || сИдУзла === _оПараметры.узТащится.id)
    ) {
      _оПараметры.лОтмена = true;
      ЗавершитьПеретаскивание("операция отменена");
    }
  }
  function ЗавершитьПеретаскивание(сПричина) {
    if (_оПараметры.чШаг !== 3) {
      m_Log.Окак(
        `[Тащилка] Заканчиваю перетаскивание: ${сПричина} X=${_чПоследняяX} Y=${_чПоследняяY}`
      );
      _оПараметры.чШаг = 3;
      m_Events.SendEvent(
        `тащилка-перетаскивание-${_оПараметры.узТащится.id}`,
        _оПараметры
      );
      м_ПолноэкранныйРежим.ПолучитьЭлемент().style.removeProperty("cursor");
      м_ПолноэкранныйРежим
        .ПолучитьЭлемент()
        .classList.remove("тащилка-перехват");
      _оПараметры.узТащится.classList.remove("тащилка");
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
      m_Events.УдалитьОбработчик(
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
  let _чТаймер = 0;
  let _чСкрытьПосле = 0;
  let _чНеПоказыватьДо = 0;
  let _чЭкранX = 0,
    _чЭкранY = 0;
  let _чКлиентX = 0,
    _чКлиентY = 0;
  let _чИдТаймераВыбораСкорости = 0;
  function Показать() {
    if (_чТаймер === 0) {
      document.body.classList.remove("автоскрытие");
      document.body.classList.add("анимацияпанели");
      _чТаймер = setTimeout(
        обработатьТаймер,
        m_Settings.Get("чИнтервалАвтоскрытия") * 1e3
      );
      _чСкрытьПосле = _чНеПоказыватьДо = 0;
    } else {
      _чСкрытьПосле =
        performance.now() + m_Settings.Get("чИнтервалАвтоскрытия") * 1e3;
    }
  }
  function Скрыть(лСАнимацией = true) {
    if (_чТаймер !== 0) {
      clearTimeout(_чТаймер);
      _чТаймер = 0;
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
    Check(_чТаймер !== 0);
    const чСкрытьЧерез = _чСкрытьПосле - performance.now();
    if (чСкрытьЧерез > 50) {
      _чТаймер = setTimeout(обработатьТаймер, чСкрытьЧерез);
      _чСкрытьПосле = 0;
    } else {
      Скрыть();
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
        Показать();
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
    Показать();
  });
  const обработатьПокиданиеУказателя = AddExceptionHandler(() => {
    Скрыть();
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
  function Запустить() {
    перехватитьДвижениеУказателя();
    _узАвтоскрытие.addEventListener("click", обработатьЩелчок);
    _узАвтоскрытие.addEventListener("mouseleave", обработатьПокиданиеУказателя);
    GetNode("скорость").addEventListener("pointerdown", обработатьВыборСкорости);
  }
  return {
    Запустить,
    Показать,
    Скрыть,
  };
})();

const м_Медиазапрос = (() => {
  let _чТаймер = -2;
  const обновить = AddExceptionHandler(() => {
    Check(_чТаймер !== 0);
    _чТаймер = 0;
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
  function обновитьБыстро() {
    if (_чТаймер !== -1) {
      if (_чТаймер > 0) {
        clearTimeout(_чТаймер);
      }
      _чТаймер = -1;
      requestAnimationFrame(обновить);
    }
  }
  function обновитьМедленно() {
    if (_чТаймер === -2 || _чТаймер === 0) {
      _чТаймер = setTimeout(обновить, 200);
      Check(_чТаймер > 0);
    }
  }
  window.addEventListener(
    "resize",
    AddExceptionHandler(() => {
      if (_чТаймер !== -2) {
        обновитьМедленно();
      }
    })
  );
  return {
    обновитьБыстро,
    обновитьМедленно,
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
    _оПрозрачность.Обновить();
  }
  function ОбновитьСтили() {
    const оСтиль = document.documentElement.style;
    for (let nodeButton of document.querySelectorAll(СЕЛЕКТОР_КНОПКИ_ЦВЕТА)) {
      оСтиль.setProperty(
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
    оСтиль.setProperty("--чНепрозрачность", чНепрозрачность);
    оСтиль.setProperty(
      "--чНепрозрачностьОкна",
      Clamp(чНепрозрачность, 0.85, 1)
    );
  }
  function ПрименитьРазмерИнтерфейса() {
    document.documentElement.style.fontSize = `${(16 * m_Settings.Get("чРазмерИнтерфейса")) / 100
      }px`;
    м_Медиазапрос.обновитьМедленно();
  }
  function Запустить() {
    m_i18n.TranslateDocument(document);
    _оПрозрачность = new ВводЧисла("чПрозрачность", 5, 0, "прозрачность");
    _оПрозрачность.ПослеИзменения = ОбновитьСтили;
    document.addEventListener("input", ОбработатьВводЦвета);
    document.addEventListener("change", ОбработатьИзменениеЦвета);
    m_Events.ДобавитьОбработчик(
      "настройки-измениласьпредустановка-оформление",
      ОбработатьИзменениеПредустановкиОформления
    );
    ОбработатьИзменениеПредустановкиОформления();
    new ВводЧисла(
      "чРазмерИнтерфейса",
      1,
      0,
      "размеринтерфейса"
    ).ПослеИзменения = ПрименитьРазмерИнтерфейса;
    ПрименитьРазмерИнтерфейса();
    ПоказатьЭлемент(document.body, true);
  }
  return {
    Запустить,
  };
})();

const m_Notification = (() => {
  const ПОКАЗЫВАТЬ_УВЕДОМЛЕНИЕ = 2e3;
  let _чТаймер = 0;
  function Показать(сИдЗначка, лЖопа) {
    Check(document.getElementById(сИдЗначка) && typeof лЖопа == "boolean");
    const узУведомление = GetNode("уведомление");
    узУведомление.classList.toggle("жопа", лЖопа);
    ПоказатьЭлемент(узУведомление, true);
    узУведомление.firstElementChild.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "href",
      `#${сИдЗначка}`
    );
    if (_чТаймер !== 0) {
      clearTimeout(_чТаймер);
    }
    _чТаймер = setTimeout(СкрытьУведомление, ПОКАЗЫВАТЬ_УВЕДОМЛЕНИЕ);
  }
  function ПоказатьСчастье() {
    Показать("svg-success", false);
  }
  function ShowAss() {
    Показать("svg-fail", true);
  }
  const СкрытьУведомление = AddExceptionHandler(() => {
    ПоказатьЭлемент("уведомление", false);
    _чТаймер = 0;
  });
  return {
    Показать,
    ПоказатьСчастье,
    ShowAss,
  };
})();

const м_Шкала = (() => {
  let _чНачало = 0;
  let _чКонец = 0;
  let _чПросмотрено;
  function ОграничитьВремя(чВремя) {
    return Clamp(чВремя, _чНачало, _чКонец);
  }
  function Обновить() {
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
    if (м_Управление.ПолучитьСостояние() !== STATE_REPEAT) {
      return;
    }
    const оБордюр = oEvent.currentTarget.getBoundingClientRect();
    const оСтиль = getComputedStyle(oEvent.currentTarget);
    const чНачалоШкалы = Math.round(
      оБордюр.left + Number.parseFloat(оСтиль.paddingLeft)
    );
    const чКонецШкалы = Math.round(
      оБордюр.right - Number.parseFloat(оСтиль.paddingRight)
    );
    const чУказатель = oEvent.clientX + 1;
    const чПеремотатьДо = ОграничитьВремя(
      ((чУказатель - чНачалоШкалы) / (чКонецШкалы - чНачалоШкалы)) *
      (_чКонец - _чНачало) +
      _чНачало
    );
    m_Log.Окак(`[Шкала] Перематываю до ${чПеремотатьДо}`);
    м_Проигрыватель.ПеремотатьПовторДо(чПеремотатьДо);
  });
  function ЗадатьНачалоИКонец(чНачало, чКонец) {
    Check(чНачало <= чКонец);
    _чНачало = чНачало;
    _чКонец = чКонец;
    document
      .getElementById("шкала")
      .addEventListener("click", ОбработатьЩелчок);
  }
  function ЗадатьПросмотрено(чПросмотрено) {
    _чПросмотрено = ОграничитьВремя(чПросмотрено);
    Обновить();
  }
  function ПолучитьНачало() {
    return _чНачало;
  }
  function ПолучитьКонец() {
    return _чКонец;
  }
  return {
    ЗадатьНачалоИКонец,
    ЗадатьПросмотрено,
    ПолучитьНачало,
    ПолучитьКонец,
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
    м_Окно.настроитьИндикаторПрокрутки(элДобавитьВ);
  }
  function ДобавитьНовость(элДобавитьВ, мНовость, чДатаНовости) {
    if (элДобавитьВ.firstElementChild) {
      элДобавитьВ.appendChild(document.createElement("hr"));
    }
    const узЗаголовок = document.createElement("h4");
    if (чДатаНовости === 0) {
      узЗаголовок.textContent = Текст(мНовость[1]);
    } else {
      узЗаголовок.textContent = `${m_i18n.FormatDate(
        чДатаНовости
      )} · ${Текст(мНовость[1])}`;
    }
    элДобавитьВ.appendChild(узЗаголовок);
    if (Текст("M0010") !== "ru") {
      const элСсылка = узЗаголовок.appendChild(document.createElement("a"));
      элСсылка.className = "новость-перевести";
      элСсылка.href = "translate:";
      элСсылка.target = "_blank";
      элСсылка.title = Текст("J0148");
    }
    for (let ы = 2; ы < мНовость.length; ++ы) {
      m_i18n.InsertAdjacentHtmlMessage(элДобавитьВ, "beforeend", мНовость[ы]);
    }
  }
  function ОткрытьОкно(лПодтвердитьПрочтение) {
    if (лПодтвердитьПрочтение) {
      m_i18n.InsertAdjacentHtmlMessage(
        "закрытьновости",
        "content",
        "F0619"
      ).title = Текст("A0620");
      ПоказатьЭлемент("отложитьновости", true);
    } else {
      m_i18n.InsertAdjacentHtmlMessage(
        "закрытьновости",
        "content",
        "F0663"
      ).title = "";
      ПоказатьЭлемент("отложитьновости", false);
    }
    m_Events.ДобавитьОбработчик(
      "управление-левыйщелчок",
      ОбработатьЛевыйЩелчок
    );
    м_Окно.открыть("новости");
  }
  function ОбработатьЛевыйЩелчок(oEvent) {
    if (
      oEvent.сПозывной === "закрытьновости" &&
      ЭлементПоказан("отложитьновости")
    ) {
      ПоказатьЭлемент("открытьновости", false);
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
      oEvent.target.href = `https://translate.google.com/?op=translate&sl=${Текст(
        "M0010"
      )}&text=${encodeURIComponent(sText)}`;
    }
  }
  function ОткрытьСправку() {
    ДобавитьНовости(Infinity, ПОЛНАЯ_СПРАВКА);
    ОткрытьОкно(false);
  }
  function ОткрытьНовости() {
    const { pCurrent: сПредыдущаяВерсия, pInitial: сНачальнаяВерсия } =
      m_Settings.GetSettingParameters("сПредыдущаяВерсия");
    if (сПредыдущаяВерсия === сНачальнаяВерсия) {
      ДобавитьНовости(Infinity, ПОКАЗАТЬ_ОДИН_РАЗ);
      ОткрытьОкно(false);
      ПоказатьЭлемент("открытьновости", false);
      m_Settings.Change("сПредыдущаяВерсия", EXTENSION_VERSION);
    } else if (сПредыдущаяВерсия !== EXTENSION_VERSION) {
      ДобавитьНовости(ПеревестиВерсиюВМиллисекунды(сПредыдущаяВерсия), "");
      ОткрытьОкно(true);
      GetNode("открытьновости").classList.remove("непрочитано");
    } else {
      ДобавитьНовости(0, "");
      ОткрытьОкно(false);
    }
  }
  /*
   * The extension used to poll the original author's website every five days for
   * a version manifest, and offer an update from it. This fork does not ship from
   * there, so the check is gone rather than left pointing at someone else's site.
   */
  function Запустить() {
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
        ПоказатьЭлемент("открытьновости", true).classList.add("непрочитано");
      } else {
        m_Settings.Change("сПредыдущаяВерсия", EXTENSION_VERSION);
      }
    }
  }
  return {
    Запустить,
    ОткрытьНовости,
    ОткрытьСправку,
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
  const обработатьНажатиеКолеса = создатьОбработчикСобытийЭлемента(
    (oEvent) => {
      if (
        !(
          oEvent.button !== MIDDLE_BUTTON ||
          oEvent.shiftKey ||
          oEvent.ctrlKey ||
          oEvent.altKey ||
          oEvent.metaKey ||
          ЭтоСобытиеДляСсылки(oEvent)
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
        ЭлементВЭтойТочкеМожноПрокрутить(oEvent.clientX, oEvent.clientY)
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
  function ОстановитьПросмотрТрансляции() {
    if (
      _чСостояние === STATE_STOP ||
      _чСостояние === STATE_REPEAT
    ) {
      return false;
    }
    m_Log.Окак("[Управление] Останавливаю просмотр трансляции");
    м_Список.Остановить();
    м_Преобразователь.Остановить();
    г_моОчередь.Очистить();
    г_моОчередь.Add(new Сегмент(PROCESSING_CONVERTED, STATE_REPEAT));
    м_Проигрыватель.ДобавитьСледующийСегмент();
    return true;
  }
  function ПереключитьПросмотрТрансляции() {
    if (!ОстановитьПросмотрТрансляции()) {
      m_Log.Окак("[Управление] Начинаю просмотр трансляции");
      г_моОчередь.Очистить();
      м_Проигрыватель.Перезагрузить(STATE_START);
      м_Список.Запустить();
    }
  }
  function ПереключитьОкноСтатистики() {
    if (м_Статистика.ОкноОткрыто()) {
      м_Статистика.ЗакрытьОкно();
    } else {
      м_Статистика.ОткрытьОкно();
    }
  }
  function ПереключитьПроверкуЦвета(oEvent) {
    if (document.body.classList.toggle("проверкацвета")) {
      document.body.classList.toggle("проверкацветафон", !oEvent.shiftKey);
      м_Новости.ОткрытьСправку();
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
          m_Notification.ПоказатьСчастье();
        },
        (пПричина) => {
          m_Log.Ой(
            `[Управление] Error copying to clipboard: ${пПричина}`
          );
          m_Notification.ShowAss();
        }
      )
      .catch(m_Debug.CaughtException);
  }
  function КопироватьАдресТрансляцииВБуферОбмена() {
    if (КопироватьАдресТрансляцииВБуферОбмена.лИдетВыполнение) {
      return;
    }
    КопироватьАдресТрансляцииВБуферОбмена.лИдетВыполнение = true;
    m_Log.Окак("[Управление] Получаю адрес трансляции для копирования");
    м_Twitch
      .ПолучитьАбсолютныйАдресСпискаВариантов(null, true, false)
      .then((сРезультат) => {
        m_Log.Вот("[Управление] Копирую адрес трансляции в буфер обмена");
        return navigator.clipboard.writeText(сРезультат).then(
          () => {
            КопироватьАдресТрансляцииВБуферОбмена.лИдетВыполнение = false;
            m_Log.Вот("[Управление] Копирование в буфер обмена завершено");
            м_Управление.ОстановитьПросмотрТрансляции();
            m_Notification.ПоказатьСчастье();
          },
          (пПричина) => {
            throw `Error copying to clipboard: ${пПричина}`;
          }
        );
      })
      .catch(
        AddExceptionHandler((пПричина) => {
          КопироватьАдресТрансляцииВБуферОбмена.лИдетВыполнение = false;
          if (typeof пПричина == "string") {
            m_Log.Ой(
              `[Управление] Ошибка при копировании адреса трансляции в буфер обмена: ${пПричина}`
            );
            m_Notification.ShowAss();
          } else {
            throw пПричина;
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
    м_Проигрыватель.ПрименитьГромкость();
    ОбновитьГромкость();
    м_Автоскрытие.Показать();
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
    ИзменитьКнопку(
      "переключитьприглушить",
      m_Settings.Get("лПриглушить")
    );
  }
  function ОбновитьКоличествоДорожек(лЕстьВидео, лЕстьЗвук) {
    document.body.classList.toggle("нетвидео", !лЕстьВидео);
    document.body.classList.toggle("нетзвука", !лЕстьЗвук);
  }
  function ИзменитьПодпискуЗрителяНаКанал(чПодписка) {
    if (
      !document
        .getElementById("зритель-подписка")
        .classList.contains("обновляется")
    ) {
      м_Twitch.ИзменитьПодпискуЗрителяНаКанал(чПодписка);
    }
  }
  const ОбработатьЛевыйЩелчок = создатьОбработчикСобытийЭлемента((oEvent) => {
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
          м_Проигрыватель.ПереключитьПаузу();
        }
        break;

      case "переключитьприглушить":
        СохранитьИПрименитьГромкость(!m_Settings.Get("лПриглушить"));
        break;

      case "переключитьчат":
        м_Чат.ПереключитьСостояниеПанели();
        break;

      case "создатьклип":
        м_Twitch.СоздатьКлип();
        break;

      case "переключитькартинкавкартинке":
        м_КартинкаВКартинке.переключить();
        break;

      case "переключитьполноэкранный":
        м_ПолноэкранныйРежим.Переключить();
        break;

      case "одновременныхзагрузок":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "кОдновременныхЗагрузок",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Статистика.ОчиститьИсторию();
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
        м_Чат.ПрименитьПоложениеПанели();
        break;

      case "горизонтальноеположениечата":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "чГоризонтальноеПоложениеЧата",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Чат.ПрименитьПоложениеПанели();
        break;

      case "вертикальноеположениечата":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "чВертикальноеПоложениеЧата",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Чат.ПрименитьПоложениеПанели();
        break;

      case "положениечата":
        Check(узЩелчок.checked);
        m_Settings.Change(
          "чПоложениеПанелиЧата",
          Number.parseInt(узЩелчок.value, 10)
        );
        м_Чат.ПрименитьПоложениеПанели();
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
        м_Новости.ОткрытьСправку();
        break;

      case "отправитьотзыв":
        m_Debug.ЗавершитьРаботуИОтправитьОтзыв();
        break;

      case "экспортнастроек":
        m_Settings.Export();
        break;

      case "импортнастроек":
        const уз = document.getElementById("выборфайладляимпортанастроек");
        уз.value = "";
        уз.click();
        break;

      case "сброситьнастройки":
        m_Settings.Reset();
        break;

      case "проверкацвета":
        ПереключитьПроверкуЦвета(oEvent);
        break;

      case "зритель-подписаться":
        ИзменитьПодпискуЗрителяНаКанал(SUBSCRIPTION_NOTIFY);
        break;

      case "зритель-отписаться":
        ИзменитьПодпискуЗрителяНаКанал(SUBSCRIPTION_NOT_SUBSCRIBED);
        break;

      case "зритель-уведомлять":
        ИзменитьПодпискуЗрителяНаКанал(
          узЩелчок.checked ? SUBSCRIPTION_NOTIFY : SUBSCRIPTION_DO_NOT_NOTIFY
        );
        break;

      case "закрытьстатистику":
        м_Статистика.ЗакрытьОкно();
        break;

      case "копироватьадресканала":
        m_Log.Вот("[Управление] Копирую адрес канала в буфер обмена");
        КопироватьТекстВБуферОбмена(м_Twitch.ПолучитьАдресКанала(false));
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
            м_Окно.закрыть(false);
            м_Автоскрытие.Скрыть(false);
          }
          break;

        case 70:
        case 13:
        case 13 + ALT_KEY:
          if (лНажатие1) {
            м_ПолноэкранныйРежим.Переключить();
          }
          break;

        case 13 + SHIFT_KEY:
          if (лНажатие1) {
            м_КартинкаВКартинке.переключить();
          }
          break;

        case 93:
          if (!лНажатие) {
            GetNode("глаз").focus();
          }
          return;

        case 88:
          if (лНажатие1) {
            м_Окно.переключить("главноеменю");
          }
          break;

        case 67:
          if (лНажатие1) {
            м_Чат.ПереключитьСостояниеПанели();
          }
          break;

        case 86:
          if (лНажатие1) {
            м_Окно.переключить("настройки");
          }
          break;

        case 73:
          if (лНажатие1) {
            м_Окно.переключить("канал");
          }
          break;

        case 83:
          if (лНажатие1) {
            ПереключитьОкноСтатистики();
          }
          break;

        case 112:
          if (лНажатие1) {
            м_Новости.ОткрытьСправку();
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
            м_Автоскрытие.Показать();
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
            м_Автоскрытие.Показать();
          }
          break;

        case 187:
        case 107:
        case 190:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            задатьСкоростьПовтора(-Infinity);
            м_Автоскрытие.Показать();
          }
          break;

        case 189:
        case 109:
        case 188:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            задатьСкоростьПовтора(Infinity);
            м_Автоскрытие.Показать();
          }
          break;

        case 75:
        case 12:
          if (лНажатие1 && _чСостояние === STATE_REPEAT) {
            м_Проигрыватель.ПереключитьПаузу();
            м_Автоскрытие.Показать();
          }
          break;

        case 74:
        case 37:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(
              `[Управление] Перематываю на -${ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА}с`
            );
            м_Проигрыватель.ПеремотатьПовторНа(
              false,
              -ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА
            );
            м_Автоскрытие.Показать();
          }
          break;

        case 76:
        case 39:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(
              `[Управление] Перематываю на +${ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА}с`
            );
            м_Проигрыватель.ПеремотатьПовторНа(
              false,
              ПЕРЕМАТЫВАТЬ_СТРЕЛКАМИ_НА
            );
            м_Автоскрытие.Показать();
          }
          break;

        case 74 + SHIFT_KEY:
        case 37 + SHIFT_KEY:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(
              `[Управление] Перематываю на -${ПЕРЕМАТЫВАТЬ_ПО_КАДРАМ_НА} кадров`
            );
            м_Проигрыватель.ПеремотатьПовторНа(
              true,
              -ПЕРЕМАТЫВАТЬ_ПО_КАДРАМ_НА
            );
          }
          break;

        case 76 + SHIFT_KEY:
        case 39 + SHIFT_KEY:
          if (лНажатие && _чСостояние === STATE_REPEAT) {
            m_Log.Окак(`[Управление] Перематываю на +1 кадр`);
            м_Проигрыватель.ПеремотатьПовторНа(true, 1);
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
            m_Notification.Показать(
              `svg-fullscreen-${лМасштабироватьИзображение}`,
              false
            );
          }
          break;

        case 88 + ALT_KEY:
          if (лНажатие1) {
            м_Twitch.СоздатьКлип();
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
      const чПоложение = m_Settings.Get("чПоложениеПанелиЧата");
      let узПоложение;
      for (let узСторона of сузСтороны) {
        if (чПоложение === Number.parseInt(узСторона.value, 10)) {
          узПоложение = узСторона;
        }
        узСторона.name = "положениечата";
      }
      узПоложение.checked = true;
    }
    if (_оНачалоВоспроизведения) {
      _оНачалоВоспроизведения.Обновить();
      _оРазмерБуфера.Обновить();
      _оРастягиваниеБуфера.Обновить();
      _оДлительностьПовтора.Обновить();
      _оИнтервалАвтоскрытия.Обновить();
    } else {
      _оНачалоВоспроизведения = new ВводЧисла(
        "чНачалоВоспроизведения",
        0.5,
        1,
        "началовоспроизведения"
      );
      _оРазмерБуфера = new ВводЧисла("чРазмерБуфера", 0.5, 1, "размербуфера");
      _оРастягиваниеБуфера = new ВводЧисла(
        "чРастягиваниеБуфера",
        0.5,
        1,
        "растягиваниебуфера"
      );
      _оДлительностьПовтора = new ВводЧисла(
        "чДлительностьПовтора2",
        30,
        0,
        "длительностьповтора"
      );
      _оНачалоВоспроизведения.ПослеИзменения =
        _оРазмерБуфера.ПослеИзменения =
        _оРастягиваниеБуфера.ПослеИзменения =
        м_Статистика.ОчиститьИсторию;
      _оИнтервалАвтоскрытия = new ВводЧисла(
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
      м_Меню.задатьДоступностьПункта(элПункт, true);
    } else {
      элПункт.removeAttribute("href");
      м_Меню.задатьДоступностьПункта(элПункт, false);
    }
  }
  function ОбработатьПаузу(лПауза) {
    ИзменитьКнопку("переключитьпаузу", лПауза);
  }
  function ОбработатьИзменениеПредустановкиБуферизации() {
    ОбновитьОкноНастроек();
    м_Статистика.ОчиститьИсторию();
  }
  function получитьСкоростьПовтора() {
    const узСкорость = GetNode("скорость");
    if (узСкорость.options[0].text === "") {
      for (const уз of узСкорость.options) {
        уз.text = уз.defaultSelected
          ? "1x"
          : m_i18n.FormatNumber(уз.value, 2);
      }
    }
    const чСкорость = Number.parseFloat(узСкорость.value);
    Check(чСкорость > 0);
    return чСкорость;
  }
  function задатьСкоростьПовтора(чКод) {
    const узСкорость = GetNode("скорость");
    if (!Number.isSafeInteger(чКод)) {
      Check(
        узСкорость.selectedIndex >= 0 &&
        (чКод === -Infinity || чКод === Infinity)
      );
      чКод = узСкорость.selectedIndex + Math.sign(чКод);
    }
    if (чКод >= 0 && чКод < узСкорость.options.length) {
      узСкорость.selectedIndex = чКод;
      м_Проигрыватель.ЗадатьСкоростьПовтора(получитьСкоростьПовтора());
    }
  }
  const ОбработатьИзменениеСкоростиВоспроизведения =
    AddExceptionHandler((oEvent) => {
      if (_чСостояние === STATE_REPEAT) {
        м_Проигрыватель.ЗадатьСкоростьПовтора(получитьСкоростьПовтора());
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
  function ОбновитьСписокВариантовТрансляции([моВарианты, оВыбранныйВариант]) {
    const nodeList = GetNode("варианттрансляции");
    nodeList.length = 0;
    if (моВарианты) {
      for (const оВариант of моВарианты) {
        let сНазвание = оВариант.сНазвание;
        if (сНазвание === "audio_only") {
          сНазвание = Текст("J0144");
        } else if (сНазвание.endsWith("(source)")) {
          сНазвание = сНазвание.slice(0, -8) + Текст("J0139");
        }
        nodeList.add(
          new Option(
            сНазвание,
            void 0,
            оВариант === оВыбранныйВариант,
            оВариант === оВыбранныйВариант
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
    m_Notification.Показать("svg-cut", true);
  }
  function Запустить() {
    Check(_чСостояние === void 0);
    GetNode("названиетрансляции").href = м_Twitch.ПолучитьАдресКанала(true);
    const узГромкость = GetNode("громкость");
    узГромкость.min = MIN_VOLUME;
    узГромкость.addEventListener("input", ОбработатьИзменениеГромкости);
    ОбновитьГромкость();
    ОбновитьОкноНастроек();
    m_Settings.ConfigurePresetLists();
    м_Автоскрытие.Запустить();
    м_Автоскрытие.Показать();
    м_Новости.Запустить();
    м_Чат.Restore();
    m_Events.ДобавитьОбработчик(
      "окно-открыто-главноеменю",
      ОбработатьОткрытиеГлавногоМеню
    );
    m_Events.ДобавитьОбработчик(
      "список-выбранварианттрансляции",
      ОбновитьСписокВариантовТрансляции
    );
    m_Events.ДобавитьОбработчик(
      "список-началорекламы",
      обработатьНачалоРекламы
    );
    m_Events.ДобавитьОбработчик("список-конецрекламы", обработатьКонецРекламы);
    m_Events.ДобавитьОбработчик(
      "проигрыватель-переполненбуфер",
      обработатьПереполнениеБуфера
    );
    m_Events.ДобавитьОбработчик("проигрыватель-пауза", ОбработатьПаузу);
    m_Events.ДобавитьОбработчик(
      "настройки-измениласьпредустановка-буферизация",
      ОбработатьИзменениеПредустановкиБуферизации
    );
    m_Events.ДобавитьОбработчик(
      "twitch-полученыметаданныеканала",
      ПоказатьМетаданныеКанала
    );
    m_Events.ДобавитьОбработчик(
      "twitch-полученыметаданныезрителя",
      ПоказатьМетаданныеЗрителя
    );
    m_Events.ДобавитьОбработчик(
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
    ИзменитьСостояние(STATE_START);
    ПрименитьМасштабированиеИзображения();
    ПрименитьАнимациюИнтерфейса();
    м_Оформление.Запустить();
  }
  function ИзменитьСостояние(чНовоеСостояние) {
    Check(Number.isInteger(чНовоеСостояние));
    if (_чСостояние === чНовоеСостояние) {
      return;
    }
    m_Log.Вот(
      `[Управление] Состояние трансляции изменилось с ${_чСостояние} на ${чНовоеСостояние}`
    );
    _чСостояние = чНовоеСостояние;
    document.body.setAttribute("data-состояние", чНовоеСостояние);
    ИзменитьКнопку(
      "переключитьтрансляцию",
      чНовоеСостояние === STATE_STOP ||
      чНовоеСостояние === STATE_REPEAT
    );
    m_Events.SendEvent("управление-изменилосьсостояние", чНовоеСостояние);
    switch (чНовоеСостояние) {
      case STATE_START:
        ПоказатьМетаданныеТрансляции({
          сТипТрансляции: null,
          сНазваниеТрансляции: НАЗВАНИЕ_ТРАНСЛЯЦИИ_НЕИЗВЕСТНО,
          сНазваниеИгры: null,
          сАдресИгры: null,
          кЗрителей: null,
          чДлительностьТрансляции: null,
        });
        м_Twitch.ЗавершитьСборМетаданныхТрансляции(true);
        break;

      case STATE_BROADCAST_START:
        ПоказатьМетаданныеТрансляции({
          сТипТрансляции: null,
          сНазваниеТрансляции: НАЗВАНИЕ_ТРАНСЛЯЦИИ_НЕИЗВЕСТНО,
          сНазваниеИгры: null,
          сАдресИгры: null,
          кЗрителей: null,
          чДлительностьТрансляции: null,
        });
        м_Twitch.НачатьСборМетаданныхТрансляции();
        break;

      case STATE_BROADCAST_END:
        ПоказатьМетаданныеТрансляции({
          сТипТрансляции: "завершена",
          кЗрителей: null,
          чДлительностьТрансляции: null,
        });
        м_Twitch.ЗавершитьСборМетаданныхТрансляции(true);
        GetNode("статистика-задержкатрансляции").textContent = "";
        break;

      case STATE_LOADING:
      case STATE_PLAYBACK_START:
      case STATE_PLAYING:
        break;

      case STATE_STOP:
      case STATE_REPEAT:
        ПоказатьМетаданныеТрансляции({
          кЗрителей: null,
        });
        м_Twitch.ЗавершитьСборМетаданныхТрансляции(false);
        GetNode("статистика-задержкатрансляции").textContent = "";
        break;

      default:
        Check(false);
    }
  }
  function ПолучитьСостояние() {
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
    if (oMetadata.сАватар !== void 0) {
      Check(oMetadata.сАватар);
      GetNode("канал-аватар").src = oMetadata.сАватар;
    }
    if (oMetadata.сОписание !== void 0) {
      GetNode("канал-описание").textContent = oMetadata.сОписание || "";
    }
    if (oMetadata.sLanguageCode !== void 0) {
      const уз = GetNode("канал-язык");
      if (oMetadata.sLanguageCode) {
        уз.textContent = m_i18n.GetLanguageName(oMetadata.sLanguageCode);
        ПоказатьЭлемент(уз.parentNode, true);
      } else {
        ПоказатьЭлемент(уз.parentNode, false);
      }
    }
    if (oMetadata.кПодписчиков !== void 0) {
      const уз = GetNode("канал-подписчиков");
      if (Number.isFinite(oMetadata.кПодписчиков)) {
        уз.textContent = m_i18n.FormatNumber(oMetadata.кПодписчиков);
        ПоказатьЭлемент(уз.parentNode, true);
      } else {
        ПоказатьЭлемент(уз.parentNode, false);
      }
    }
    if (oMetadata.чКаналСоздан !== void 0) {
      const уз = GetNode("канал-создан");
      if (Number.isFinite(oMetadata.чКаналСоздан)) {
        уз.textContent = m_i18n.FormatDate(oMetadata.чКаналСоздан);
        ПоказатьЭлемент(уз.parentNode, true);
      } else {
        ПоказатьЭлемент(уз.parentNode, false);
      }
    }
    if (oMetadata.моКоманды !== void 0) {
      ПоказатьМассивСсылок(oMetadata.моКоманды, "канал-команды");
    }
  }
  function ПоказатьМассивСсылок(моСсылки, пВставить) {
    const узВставить = GetNode(пВставить);
    if (моСсылки.length === 0) {
      ПоказатьЭлемент(узВставить.parentNode, false);
    } else {
      const оФрагмент = document.createDocumentFragment();
      for (let оСсылка, ы = 0; (оСсылка = моСсылки[ы]); ++ы) {
        if (ы !== 0) {
          оФрагмент.appendChild(document.createTextNode(", "));
        }
        Check(
          IsNonEmptyString(оСсылка.sAddress) && IsNonEmptyString(оСсылка.sName)
        );
        const nodeLink = document.createElement("a");
        nodeLink.href = оСсылка.sAddress;
        nodeLink.rel = "noopener noreferrer";
        nodeLink.target = "_blank";
        if (оСсылка.сОписание) {
          nodeLink.className = "канал-ссылка";
          nodeLink.title = оСсылка.сОписание;
        }
        nodeLink.textContent = оСсылка.sName;
        оФрагмент.appendChild(nodeLink);
      }
      узВставить.textContent = "";
      узВставить.appendChild(оФрагмент);
      ПоказатьЭлемент(узВставить.parentNode, true);
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
    if (oMetadata.чПодписка !== void 0) {
      const уз = GetNode("зритель-подписка");
      if (oMetadata.чПодписка === SUBSCRIPTION_UPDATING) {
        уз.classList.add("обновляется");
      } else {
        уз.classList.remove("обновляется");
        уз.setAttribute("data-подписка", oMetadata.чПодписка);
        GetNode("зритель-уведомлять").checked =
          oMetadata.чПодписка === SUBSCRIPTION_NOTIFY;
      }
    }
  }
  const _оТипыТрансляции = {
    завершена: ["J0145", "J0100", false],
    прямая: ["J0146", "J0149", true],
    повтор: ["J0147", "J0150", false],
  };
  function ПоказатьМетаданныеТрансляции(oMetadata) {
    if (oMetadata.сТипТрансляции !== void 0) {
      const уз = GetNode("типтрансляции");
      if (typeof oMetadata.сТипТрансляции == "string") {
        Check(_оТипыТрансляции.hasOwnProperty(oMetadata.сТипТрансляции));
        уз.textContent = Текст(_оТипыТрансляции[oMetadata.сТипТрансляции][0]);
        уз.parentElement.title = Текст(
          _оТипыТрансляции[oMetadata.сТипТрансляции][1]
        );
        уз.classList.toggle(
          "прямаятрансляция",
          _оТипыТрансляции[oMetadata.сТипТрансляции][2]
        );
        ПоказатьЭлемент(уз.parentElement, true);
      } else {
        ПоказатьЭлемент(уз.parentElement, false);
      }
      м_Медиазапрос.обновитьБыстро();
    }
    if (oMetadata.сНазваниеТрансляции !== void 0) {
      Check(oMetadata.сНазваниеТрансляции !== null);
      const уз = GetNode("названиетрансляции");
      уз.title = oMetadata.сНазваниеТрансляции + Текст("J0101");
      уз.textContent = oMetadata.сНазваниеТрансляции;
      м_Медиазапрос.обновитьБыстро();
    }
    if (oMetadata.сНазваниеИгры !== void 0) {
      const уз = GetNode("категориятрансляции");
      if (oMetadata.сНазваниеИгры) {
        уз.textContent = oMetadata.сНазваниеИгры;
        уз.title = уз.previousElementSibling.title =
          oMetadata.сНазваниеИгры + Текст("J0102");
        if (oMetadata.сАдресИгры) {
          уз.href = oMetadata.сАдресИгры;
        } else {
          уз.removeAttribute("href");
        }
        ПоказатьЭлемент(уз, true);
        ПоказатьЭлемент(уз.previousElementSibling, true);
      } else {
        ПоказатьЭлемент(уз, false);
        ПоказатьЭлемент(уз.previousElementSibling, false);
      }
      м_Медиазапрос.обновитьБыстро();
    }
    if (oMetadata.кЗрителей !== void 0) {
      const уз = GetNode("количествозрителей");
      if (
        Number.isFinite(oMetadata.кЗрителей) &&
        oMetadata.кЗрителей >= 0
      ) {
        уз.textContent = m_i18n.FormatNumber(oMetadata.кЗрителей);
        ПоказатьЭлемент(уз, true);
        ПоказатьЭлемент(уз.previousElementSibling, true);
      } else {
        ПоказатьЭлемент(уз, false);
        ПоказатьЭлемент(уз.previousElementSibling, false);
      }
      м_Медиазапрос.обновитьБыстро();
    }
    if (oMetadata.чДлительностьТрансляции !== void 0) {
      GetNode("позиция").textContent =
        Number.isFinite(oMetadata.чДлительностьТрансляции) &&
          oMetadata.чДлительностьТрансляции >= 0
          ? m_i18n.SecondsToString(
            oMetadata.чДлительностьТрансляции / 1e3,
            false
          )
          : "";
    }
  }
  return {
    Запустить,
    ПолучитьСостояние,
    ИзменитьСостояние,
    получитьСкоростьПовтора,
    ОбновитьКоличествоДорожек,
    ОстановитьПросмотрТрансляции,
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
    const чСостояние = m_Settings.Get("чСостояниеЧата");
    m_Log.Окак(`[Чат] Новое состояние панели: ${чСостояние}`);
    ОтменитьПеретаскиваниеПанели();
    switch (чСостояние) {
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
    м_Медиазапрос.обновитьМедленно();
  }
  function ПрименитьПоложениеПанели() {
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
      const чПоложение = m_Settings.Get("чПоложениеПанелиЧата");
      оКлассы.remove("автоположениечата");
      оКлассы.toggle("чатвверху", чПоложение === TOP_SIDE);
      оКлассы.toggle("чатсправа", чПоложение === RIGHT_SIDE);
      оКлассы.toggle("чатвнизу", чПоложение === BOTTOM_SIDE);
      оКлассы.toggle("чатслева", чПоложение === LEFT_SIDE);
    }
    м_Медиазапрос.обновитьМедленно();
  }
  function СохранитьИПрименитьСостояниеЗакрытойПанели(чНовоеСостояние) {
    m_Settings.Change("чСостояниеЗакрытогоЧата", чНовоеСостояние);
    const чСостояние = m_Settings.Get("чСостояниеЧата");
    if (
      (чСостояние === CHAT_UNLOADED || чСостояние === CHAT_HIDDEN) &&
      чСостояние !== чНовоеСостояние
    ) {
      m_Settings.Change("чСостояниеЧата", чНовоеСостояние);
      ПрименитьСостояниеПанели();
    }
  }
  function ПереключитьСостояниеПанели() {
    const лПолноэкранныйРежим = м_ПолноэкранныйРежим.Включен();
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
    let чПоложение;
    if (m_Settings.Get("лАвтоПоложениеЧата")) {
      m_Settings.Change("лАвтоПоложениеЧата", false);
      чПоложение = ПолучитьПоложениеПанели();
    } else {
      чПоложение = m_Settings.Get("чПоложениеПанелиЧата");
    }
    switch (чПоложение) {
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
    ПрименитьПоложениеПанели();
  }
  function ОбработатьПеретаскиваниеПанели(оПараметры) {
    if (оПараметры.лОтмена) {
      return;
    }
    const чПоложение = ПолучитьПоложениеПанели();
    if (
      оПараметры.чШаг !== 1 &&
      оПараметры._чНачальноеПоложение !== чПоложение
    ) {
      m_Log.Ой(
        `[Чат] Положение перетаскиваемой панели изменилось с ${оПараметры._чНачальноеПоложение} на ${чПоложение}`
      );
      ОтменитьПеретаскиваниеПанели();
      return;
    }
    switch (оПараметры.чШаг) {
      case 1:
        оПараметры._чНачальноеПоложение = чПоложение;
        if (чПоложение === RIGHT_SIDE || чПоложение === LEFT_SIDE) {
          оПараметры._чНачальныйРазмер = Number.parseInt(
            getComputedStyle(_узЧат).width,
            10
          );
        } else {
          оПараметры._чНачальныйРазмер = Number.parseInt(
            getComputedStyle(_узЧат).height,
            10
          );
        }
        break;

      case 2:
        if (чПоложение === RIGHT_SIDE || чПоложение === LEFT_SIDE) {
          if (оПараметры.лИзмениласьX) {
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
                чПоложение === LEFT_SIDE
                  ? оПараметры._чНачальныйРазмер + оПараметры.чИзменениеX
                  : оПараметры._чНачальныйРазмер - оПараметры.чИзменениеX,
                чМаксРазмер
              ),
              0
            );
            м_Медиазапрос.обновитьМедленно();
          }
        } else if (оПараметры.лИзмениласьY) {
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
              чПоложение === TOP_SIDE
                ? оПараметры._чНачальныйРазмер + оПараметры.чИзменениеY
                : оПараметры._чНачальныйРазмер - оПараметры.чИзменениеY,
              чМаксРазмер
            ),
            0
          );
          м_Медиазапрос.обновитьМедленно();
        }
        break;

      case 3:
        if (чПоложение === RIGHT_SIDE || чПоложение === LEFT_SIDE) {
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
  ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме = -1;
  function ОбработатьИзменениеПолноэкранногоРежима(лВключен) {
    if (лВключен) {
      if (
        ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме === -1
      ) {
        ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме =
          m_Settings.Get("чСостояниеЧата");
        if (
          ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме ===
          CHAT_PANEL
        ) {
          m_Settings.Change("чСостояниеЧата", CHAT_HIDDEN, true);
          ПрименитьСостояниеПанели();
        }
      }
    } else if (
      ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме !== -1
    ) {
      if (
        ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме ===
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
      ОбработатьИзменениеПолноэкранногоРежима.чСостояниеВОбычномРежиме = -1;
    }
  }
  function Restore() {
    ПрименитьСостояниеПанели();
    ПрименитьПоложениеПанели();
    m_Events.ДобавитьОбработчик(
      "тащилка-перетаскивание-размерчата",
      ОбработатьПеретаскиваниеПанели
    );
    m_Events.ДобавитьОбработчик(
      "полноэкранныйрежим-изменен",
      ОбработатьИзменениеПолноэкранногоРежима
    );
  }
  return {
    Restore,
    ПрименитьПоложениеПанели,
    ПрименитьАдрес,
    СохранитьИПрименитьСостояниеЗакрытойПанели,
    ПереключитьСостояниеПанели,
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
            ПоказатьЭлемент("аудиоустройства", false);
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
              ПоказатьЭлемент("аудиоустройства", false);
            } else {
              ПоказатьЭлемент("аудиоустройства-доступ", true);
              ПоказатьЭлемент(узСписокУстройств, false);
              ПоказатьЭлемент("аудиоустройства", true);
              m_Events.ДобавитьОбработчик(
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
            ПоказатьЭлемент("аудиоустройства-доступ", false);
            ПоказатьЭлемент(узСписокУстройств, true);
            if (кНастоящихУстройств > 1) {
              ПоказатьЭлемент("аудиоустройства", true);
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
                (пПричина) => {
                  m_Log.Ой(
                    `[Аудиоустройства] Не удалось выбрать устройство: ${пПричина}`
                  );
                }
              );
            }
          }
        },
        (пПричина) => {
          m_Log.Ой(
            `[Аудиоустройства] Не удалось получить список медиаустройств: ${пПричина}`
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
          (пПричина) => {
            m_Log.Ой(
              `[Аудиоустройства] Не удалось выбрать устройство: ${пПричина}`
            );
            m_Notification.ShowAss();
            обновитьСписокУстройствИВыбратьУстройство();
          }
        )
        .catch(m_Debug.CaughtException);
    }
  });
  function запустить(oMediaElement) {
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
    запустить,
  };
})();

const м_Проигрыватель = (() => {
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
      ДобавитьСледующийСегмент();
    },
    ОбработатьProgress() {
      if (!_лАсинхроннаяОперация) {
        НачатьВоспроизведение(
          ПроверитьПозициюВоспроизведения(ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА)
        );
      }
    },
    ОбработатьWaiting() { },
    ОбработатьPlaying() {
      if (
        м_Управление.ПолучитьСостояние() === STATE_PLAYBACK_START &&
        !_oMediaElement.paused
      ) {
        м_Управление.ИзменитьСостояние(STATE_PLAYING);
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
        ПроверитьПозициюВоспроизведения(ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ);
      }
    },
  };
  const _оПовтор = {
    лПауза: true,
    ОбработатьSourceOpen() {
      Check(_oMediaElement.paused);
      _чВоспроизведениеНачиналось = Math.max(_чВоспроизведениеНачиналось, 1);
    },
    ОбработатьProgress: STUB,
    ОбработатьWaiting: STUB,
    ОбработатьPlaying: STUB,
    ОбработатьSeeked: STUB,
    ОбработатьSeeking() {
      м_Шкала.ЗадатьПросмотрено(_oMediaElement.currentTime);
    },
    ОбработатьEnded() {
      if (!this.лПауза) {
        _oMediaElement.play();
      }
    },
    ОбработатьTimeUpdate() {
      if (!this.лПауза && !_oMediaElement.seeking) {
        this.ПроверитьПозициюВоспроизведения(ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ);
      }
      м_Шкала.ЗадатьПросмотрено(_oMediaElement.currentTime);
    },
    ПроверитьПозициюВоспроизведения(чВремя) {
      Check(Number.isFinite(чВремя));
      Check(
        чВремя === ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ ||
        чВремя === ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ ||
        чВремя >= 0
      );
      const оБуфер = _oMediaElement.buffered;
      const чПоследняяОбласть = оБуфер.length - 1;
      const чТекущееВремя = _oMediaElement.currentTime + 1e-4;
      let чПеремотатьДо = чВремя >= 0 ? чВремя : чТекущееВремя;
      let сПричинаПеремотки = "";
      for (let лНачатьСначала = false; ;) {
        let чНужноДляВоспроизведения =
          чВремя === ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ
            ? ИСЧЕРПАНИЕ_БУФЕРА
            : MIN_BUFFER_SIZE;
        for (let чОбласть = 0; чОбласть <= чПоследняяОбласть; ++чОбласть) {
          if (чПеремотатьДо < оБуфер.start(чОбласть)) {
            чНужноДляВоспроизведения = MIN_BUFFER_SIZE;
            сПричинаПеремотки += "Jumping over gap. ";
            чПеремотатьДо = оБуфер.start(чОбласть);
          }
          if (
            оБуфер.end(чОбласть) - чПеремотатьДо >=
            чНужноДляВоспроизведения
          ) {
            break;
          }
        }
        if (this.лПауза || чПеремотатьДо < м_Шкала.ПолучитьКонец()) {
          break;
        }
        if (лНачатьСначала) {
          ПоказатьСостояние("Ой", `Бесконечная перемотка Время=${чВремя}`);
          return;
        }
        чПеремотатьДо = м_Шкала.ПолучитьНачало();
        сПричинаПеремотки += "Starting from beginning. ";
        лНачатьСначала = true;
      }
      if (чПеремотатьДо !== чТекущееВремя) {
        ПоказатьСостояние(
          "Окак",
          `${сПричинаПеремотки}Перематываю до ${чПеремотатьДо}`
        );
        _oMediaElement.currentTime = чПеремотатьДо;
      }
    },
  };
  let _оПоведение = _оПрямаяТрансляция;
  function ПоказатьСостояние(sImportance, sRecord) {
    const оБуфер =
      _oMediaSource.sourceBuffers.length !== 0
        ? _oMediaSource.sourceBuffers[0]
        : null;
    const сОбластиБуфера = ПеревестиОбластиВСтроку(
      оБуфер ? оБуфер.buffered : null
    );
    const сОбласти = ПеревестиОбластиВСтроку(_oMediaElement.buffered);
    const лОбластиРавны = сОбластиБуфера === сОбласти;
    if (
      sImportance === "Вот" &&
      ((оБуфер && оБуфер.buffered.length > 1) ||
        _oMediaElement.buffered.length > 1)
    ) {
      sImportance = "Окак";
    }
    if (_oMediaElement.error || !лОбластиРавны) {
      sImportance = "Ой";
    }
    m_Log[sImportance](
      `${sRecord.charAt(0) === "[" ? "" : "[Проигрыватель] "}${sRecord} •••` +
      (оБуфер && оБуфер.updating ? " [U]" : "") +
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
    let сРезультат = "";
    if (оОбласти && оОбласти.length !== 0) {
      let чОбласть = Math.max(оОбласти.length - 5, 0);
      if (чОбласть !== 0) {
        сРезультат = `[${чОбласть}]`;
      }
      for (; чОбласть < оОбласти.length; ++чОбласть) {
        if (чОбласть !== 0) {
          сРезультат += `(${(
            оОбласти.start(чОбласть) - оОбласти.end(чОбласть - 1)
          ).toFixed(3)})`;
        }
        сРезультат += `${оОбласти.start(чОбласть)}-${оОбласти.end(чОбласть)}`;
      }
    }
    return сРезультат;
  }
  function ПолучитьЗаполненностьБуфера(оБуфер = _oMediaElement.buffered) {
    let чПросмотрено = 0;
    let чНеПросмотрено = 0;
    if (оБуфер.length !== 0) {
      const чНачало = оБуфер.start(0);
      const чКонец = оБуфер.end(оБуфер.length - 1);
      const чТекущееВремя = Clamp(
        _oMediaElement.currentTime,
        чНачало,
        чКонец
      );
      чПросмотрено = чТекущееВремя - чНачало;
      чНеПросмотрено = чКонец - чТекущееВремя;
    }
    return {
      чПросмотрено,
      чНеПросмотрено,
    };
  }
  function ПолучитьКоличествоПропущенныхКадров() {
    return _oMediaElement.getVideoPlaybackQuality
      ? _oMediaElement.getVideoPlaybackQuality()
      : {
        totalVideoFrames: _oMediaElement.webkitDecodedFrameCount,
        droppedVideoFrames: _oMediaElement.webkitDroppedFrameCount,
      };
  }
  function ПолучитьПозициюВоспроизведенияТрансляции(лДляКлипа) {
    if (Number.isNaN(_чСмещениеТрансляции)) {
      return -1;
    }
    СледитьЗаОшибками();
    let чПозиция = _oMediaElement.currentTime;
    if (лДляКлипа && м_Управление.ПолучитьСостояние() === STATE_REPEAT) {
      чПозиция = м_Шкала.ПолучитьКонец();
    }
    if (!лДляКлипа && чПозиция === 0 && _oMediaSourceBuffer !== null) {
      if (_oMediaSourceBuffer.buffered.length !== 0) {
        чПозиция = _oMediaSourceBuffer.buffered.start(0);
      }
    }
    return чПозиция === 0 ? -1 : Math.max(чПозиция + _чСмещениеТрансляции, 0);
  }
  function РасчитатьСмещениеТрансляции(оСегмент) {
    if (
      Number.isFinite(оСегмент.пДанные.чПозицияКодирования) &&
      Number.isFinite(оСегмент.пДанные.чПозицияТрансляции)
    ) {
      const чСмещениеТрансляции =
        оСегмент.пДанные.чПозицияТрансляции -
        оСегмент.пДанные.чПозицияКодирования;
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
  function ПоказатьЗадержкуТрансляции(оСегмент) {
    if (
      м_Статистика.ОкноОткрыто() &&
      Number.isFinite(оСегмент.пДанные.чПозицияКодирования) &&
      Number.isFinite(оСегмент.пДанные.чВремяКодирования) &&
      _oMediaElement.currentTime !== 0
    ) {
      const чПолучение =
        (performance.now() +
          g_nExactTime -
          оСегмент.пДанные.чВремяКодирования) /
        1e3;
      const чВоспроизведение =
        оСегмент.пДанные.чПозицияКодирования - _oMediaElement.currentTime;
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
  function ПерезагрузитьИЖдатьЗаполненияБуфера(чНовоеСостояние) {
    _лЖдатьЗаполненияБуфера = true;
    ПерезагрузитьПроигрыватель(чНовоеСостояние);
  }
  function ПерезагрузитьПроигрыватель(чНовоеСостояние) {
    ПоказатьСостояние("Окак", "Перезагрузка проигрывателя");
    м_Управление.ИзменитьСостояние(чНовоеСостояние);
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
          ПоказатьСостояние("Вот", sRecord);
          _оПоведение.ОбработатьSourceOpen();
          break;

        case "sourceended":
        case "sourceclose":
          ПоказатьСостояние("Вот", sRecord);
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
          ПоказатьСостояние(
            "Вот",
            `${sRecord} src=${_oMediaElement.src} currentSrc=${_oMediaElement.currentSrc}`
          );
          break;

        case "progress":
          ПоказатьСостояние("Вот", sRecord);
          _оПоведение.ОбработатьProgress();
          break;

        case "abort":
          ПоказатьСостояние("Вот", sRecord);
          break;

        case "waiting":
          ПоказатьСостояние("Окак", sRecord);
          _оПоведение.ОбработатьWaiting();
          break;

        case "playing":
          ПоказатьСостояние("Вот", sRecord);
          _оПоведение.ОбработатьPlaying();
          break;

        case "seeking":
          ПоказатьСостояние("Вот", sRecord);
          _оПоведение.ОбработатьSeeking();
          break;

        case "seeked":
          ПоказатьСостояние("Вот", sRecord);
          _оПоведение.ОбработатьSeeked();
          break;

        case "ended":
          ПоказатьСостояние("Вот", sRecord);
          _оПоведение.ОбработатьEnded();
          break;

        case "timeupdate":
          m_Log.Вот(
            `${sRecord} readyState=${_oMediaElement.readyState} currentTime=${_oMediaElement.currentTime
            } НеПросмотрено=${m_Log.F2(
              ПолучитьЗаполненностьБуфера().чНеПросмотрено
            )}`
          );
          _оПоведение.ОбработатьTimeUpdate();
          break;

        default:
          m_Log.Вот(sRecord);
      }
    }
  );
  function ПроверитьПозициюВоспроизведения(
    чИсточникПроверки,
    чБудетДобавлено = 0
  ) {
    const оБуфер = _oMediaElement.buffered;
    const чПоследняяОбласть = оБуфер.length - 1;
    if (чПоследняяОбласть === -1) {
      return false;
    }
    const чТекущееВремя = _oMediaElement.currentTime + 1e-4;
    let чПеремотатьДо = Math.max(чТекущееВремя, оБуфер.start(0));
    let сПричинаПеремотки = "";
    const чНеПросмотрено = оБуфер.end(чПоследняяОбласть) - чПеремотатьДо;
    if (чИсточникПроверки === ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА) {
      const чРазмерБуфера = m_Settings.Get("чМаксРазмерБуфера");
      const чПереполнение =
        чРазмерБуфера + m_Settings.Get("чРастягиваниеБуфера");
      if (чНеПросмотрено <= чПереполнение) {
        return;
      }
      if (_чВоспроизведениеНачиналось === 2) {
        m_Events.SendEvent(
          "проигрыватель-переполненбуфер",
          чНеПросмотрено - чРазмерБуфера
        );
      }
      сПричинаПеремотки += `Переполнен буфер проигрывателя ${чНеПросмотрено.toFixed(
        2
      )}с > ${чПереполнение}с. `;
      чПеремотатьДо = оБуфер.end(чПоследняяОбласть) - чРазмерБуфера - 0.1;
    }
    if (
      чИсточникПроверки === ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ &&
      _чВоспроизведениеНачиналось !== 2
    ) {
      _чВоспроизведениеНачиналось = 2;
      const чПереполнение =
        m_Settings.Get("чМаксРазмерБуфера") +
        м_Статистика.ПолучитьTargetDuration() / 2;
      if (чНеПросмотрено > чПереполнение) {
        сПричинаПеремотки += `Превышена задержка трансляции ${чНеПросмотрено.toFixed(
          2
        )}с > ${чПереполнение}с. `;
        чПеремотатьДо = оБуфер.end(чПоследняяОбласть) - чПереполнение;
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
      if (чПеремотатьДо < оБуфер.start(чОбласть)) {
        чНужноДляВоспроизведения = MIN_BUFFER_SIZE;
        сПричинаПеремотки += "Jumping over gap. ";
        чПеремотатьДо = оБуфер.start(чОбласть);
      }
      чДоКонцаОбласти = оБуфер.end(чОбласть) - чПеремотатьДо;
      if (чДоКонцаОбласти >= чНужноДляВоспроизведения) {
        лВоспроизведениеВозможно = true;
        break;
      }
    }
    if (!лВоспроизведениеВозможно && !_oMediaElement.paused) {
      БуферИсчерпан(чДоКонцаОбласти, чНеПросмотрено, чБудетДобавлено);
    }
    if (
      (лВоспроизведениеВозможно ||
        чИсточникПроверки === ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА) &&
      (чПеремотатьДо !== чТекущееВремя || _лНужнаПеремотка)
    ) {
      if (чПеремотатьДо === чТекущееВремя) {
        чПеремотатьДо = _oMediaElement.currentTime;
      }
      ПоказатьСостояние(
        сПричинаПеремотки ? "Ой" : "Окак",
        `${сПричинаПеремотки}Перематываю до ${чПеремотатьДо}`
      );
      _лНужнаПеремотка = false;
      _oMediaElement.currentTime = чПеремотатьДо;
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
      const { чНеПросмотрено } = ПолучитьЗаполненностьБуфера();
      const чРазмерБуфера = m_Settings.Get(_сРазмерБуфера);
      if (чНеПросмотрено < чРазмерБуфера) {
        m_Log.Вот(
          `[Проигрыватель] В буфере не просмотрено ${m_Log.F3(
            чНеПросмотрено
          )}с < ${чРазмерБуфера}с`
        );
        return;
      }
      m_Log.Окак(
        `[Проигрыватель] В буфере не просмотрено ${m_Log.F3(
          чНеПросмотрено
        )}с >= ${чРазмерБуфера}с`
      );
    } else {
      m_Log.Окак("[Проигрыватель] Не нужно ждать заполнения буфера");
    }
    switch (ПроверитьПозициюВоспроизведения(ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ)) {
      case ВОСПРОИЗВЕДЕНИЕ_НЕВОЗМОЖНО:
        ПоказатьСостояние(
          "Ой",
          `Не найдена область >= ${MIN_BUFFER_SIZE}с для начала воспроизведения`
        );
        _лЖдатьЗаполненияБуфера = true;
        break;

      case ВОСПРОИЗВЕДЕНИЕ_ВОЗМОЖНО:
        ПоказатьСостояние("Окак", "Начало воспроизведения");
        _лЖдатьЗаполненияБуфера = true;
        _oMediaElement.play();
        м_Управление.ИзменитьСостояние(STATE_PLAYBACK_START);
    }
  }
  function ОстановитьВоспроизведение(чНовоеСостояние) {
    if (чНовоеСостояние !== void 0) {
      м_Управление.ИзменитьСостояние(чНовоеСостояние);
    }
    _oMediaElement.pause();
  }
  function БуферИсчерпан(
    чДоКонцаПоследнейОбласти,
    чНеПросмотрено,
    чБудетДобавлено
  ) {
    Check(_oMediaSource.readyState !== "ended");
    Check(чДоКонцаПоследнейОбласти < MIN_BUFFER_SIZE);
    const лДосрочно = чНеПросмотрено > 1;
    м_Статистика.ИсчерпанБуферПроигрывателя(лДосрочно);
    _сРазмерБуфера = "чМаксРазмерБуфера";
    const чРазмерБуфера = m_Settings.Get(_сРазмерБуфера);
    if (
      чДоКонцаПоследнейОбласти + чБудетДобавлено >= MIN_BUFFER_SIZE &&
      чНеПросмотрено + чБудетДобавлено >= чРазмерБуфера
    ) {
      ПоказатьСостояние(
        лДосрочно ? "Ой" : "Окак",
        `Буфер исчерпан, остановка не нужна БудетДобавлено=${m_Log.F3(
          чБудетДобавлено
        )}с ДоКонцаПоследнейОбласти=${m_Log.F3(
          чДоКонцаПоследнейОбласти
        )}с НеПросмотрено=${m_Log.F3(
          чНеПросмотрено
        )}с РазмерБуфера=${чРазмерБуфера}с`
      );
    } else {
      ПоказатьСостояние(
        лДосрочно ? "Ой" : "Окак",
        `Приостанавливаю воспроизведение для заполнения буфера ДоКонцаПоследнейОбласти=${m_Log.F3(
          чДоКонцаПоследнейОбласти
        )}с НеПросмотрено=${m_Log.F3(
          чНеПросмотрено
        )}с РазмерБуфера=${чРазмерБуфера}с`
      );
      _лНужнаПеремотка = true;
      ОстановитьВоспроизведение(STATE_LOADING);
    }
  }
  function ЗавершитьПоток(оСегмент) {
    ПоказатьСостояние(
      "Окак",
      `Сегмент ${оСегмент.чНомер} вызвал окончание потока`
    );
    if (
      _oMediaElement.buffered.length === 0 ||
      (_oMediaElement.paused &&
        ПолучитьЗаполненностьБуфера().чНеПросмотрено < ИСЧЕРПАНИЕ_БУФЕРА + 0.1)
    ) {
      ПерезагрузитьИЖдатьЗаполненияБуфера(STATE_LOADING);
    } else {
      _лЖдатьЗаполненияБуфера =
        typeof оСегмент.пДанные == "number" ||
        (!_oMediaElement.seeking && _oMediaElement.paused);
      _oMediaSource.endOfStream();
      НачатьВоспроизведение();
    }
  }
  function УдалитьПросмотренноеВидео(оСегмент) {
    const МАКС_ДЛИТЕЛЬНОСТЬ_ПОВТОРА_ЗВУКА = 640;
    СледитьЗаОшибками();
    let чДлительностьПовтора = m_Settings.Get("чДлительностьПовтора2");
    if (чДлительностьПовтора === АВТОНАСТРОЙКА) {
      if (_лЕстьВидеодорожка) {
        return Promise.resolve(оСегмент);
      }
      чДлительностьПовтора = МАКС_ДЛИТЕЛЬНОСТЬ_ПОВТОРА_ЗВУКА;
    }
    const { чПросмотрено } = ПолучитьЗаполненностьБуфера(
      _oMediaSourceBuffer.buffered
    );
    if (чПросмотрено < чДлительностьПовтора + ИНТЕРВАЛ_УДАЛЕНИЯ_ВИДЕО) {
      return Promise.resolve(оСегмент);
    }
    const чУдалитьДо = _oMediaElement.currentTime - чДлительностьПовтора;
    return new Promise((fResolve, fReject) => {
      ПоказатьСостояние(
        "Вот",
        `Удаляю просмотренное видео Просмотрено=${m_Log.F3(
          чПросмотрено
        )}с УдалитьДо=${m_Log.F3(чУдалитьДо)}с`
      );
      _oMediaSourceBuffer.addEventListener("updateend", Удалено);
      let чПрошлоВремени = -performance.now();
      _oMediaSourceBuffer.remove(0, чУдалитьДо);
      function Удалено() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(ОтменаОбещания.ПРИЧИНА);
          } else {
            чПрошлоВремени += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Удалено);
            const { чПросмотрено } = ПолучитьЗаполненностьБуфера(
              _oMediaSourceBuffer.buffered
            );
            ПоказатьСостояние(
              чПрошлоВремени > 100 || чПросмотрено < MIN_BUFFER_SIZE
                ? "Ой"
                : "Вот",
              `Просмотренное видео удалено за ${m_Log.F0(
                чПрошлоВремени
              )}мс Просмотрено=${m_Log.F0(чПросмотрено)}с`
            );
            fResolve(оСегмент);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function ДобавитьСегментИнициализации(оСегмент) {
    return ДобавитьСегмент(
      оСегмент,
      оСегмент.пДанные.мбСегментИнициализации,
      "сегмент инициализации"
    );
  }
  function ДобавитьМедиасегмент(оСегмент) {
    return ДобавитьСегмент(
      оСегмент,
      оСегмент.пДанные.мбМедиасегмент,
      "медиасегмент"
    );
  }
  function ДобавитьСегмент(оСегмент, мбДобавить, сДобавить) {
    СледитьЗаОшибками();
    return new Promise((fResolve, fReject) => {
      ПоказатьСостояние("Вот", `Добавляю ${сДобавить} ${оСегмент.чНомер}`);
      _oMediaSourceBuffer.addEventListener("updateend", Добавлено);
      let чПрошлоВремени = -performance.now();
      _oMediaSourceBuffer.appendBuffer(мбДобавить);
      function Добавлено() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(ОтменаОбещания.ПРИЧИНА);
          } else {
            чПрошлоВремени += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Добавлено);
            ПоказатьСостояние(
              чПрошлоВремени > 100 ? "Ой" : "Вот",
              `Добавлен ${сДобавить} ${оСегмент.чНомер} за ${m_Log.F0(
                чПрошлоВремени
              )}мс`
            );
            fResolve(оСегмент);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function ПроверитьИсчерпаниеБуфера(оСегмент) {
    if (
      !_oMediaElement.seeking &&
      !_oMediaElement.paused &&
      !_oMediaElement.ended
    ) {
      ПроверитьПозициюВоспроизведения(
        ПРОВЕРИТЬ_ВОСПРОИЗВЕДЕНИЕ,
        оСегмент.чДлительность
      );
    }
    if (_oMediaElement.played.length !== 0) {
      м_Статистика.обновитьЗаполненностьБуфера(
        ПолучитьЗаполненностьБуфера().чНеПросмотрено
      );
    }
    return оСегмент;
  }
  function СегментБылДобавлен(оСегмент) {
    _лАсинхроннаяОперация = false;
    г_моОчередь.Удалить(оСегмент);
    РасчитатьСмещениеТрансляции(оСегмент);
    if (!(г_моОчередь[0] && г_моОчередь[0].пДанные === STATE_REPEAT)) {
      const чПроверка = ПроверитьПозициюВоспроизведения(
        ПРОВЕРИТЬ_ДОБАВЛЕНИЕ_СЕГМЕНТА
      );
      if (
        !(
          г_моОчередь[0] && г_моОчередь[0].чОбработка === PROCESSING_CONVERTED
        )
      ) {
        НачатьВоспроизведение(чПроверка);
        ПоказатьЗадержкуТрансляции(оСегмент);
      }
    }
    ДобавитьСледующийСегмент();
  }
  const СегментНеБылДобавлен = AddExceptionHandler((пПричина) => {
    _лАсинхроннаяОперация = false;
    if (пПричина === "ДОБАВЛЕНИЕ СЕГМЕНТА ОТЛОЖЕНО") {
      return;
    }
    if (пПричина === ОтменаОбещания.ПРИЧИНА) {
      m_Log.Вот("[Проигрыватель] Отменено добавление сегмента");
    } else {
      throw пПричина;
    }
  });
  function ПредотвратитьПереполнениеОчереди() {
    const { чДлительность } = г_моОчередь.ПодсчитатьПреобразованныеСегменты();
    if (чДлительность >= BUFFER_OVERFLOW) {
      m_Log.Ой(
        `[Проигрыватель] MediaSource закрыт слишком долго ${чДлительность}с >= ${BUFFER_OVERFLOW}с`
      );
      Check(
        м_Управление.ПолучитьСостояние() === STATE_START ||
        м_Управление.ПолучитьСостояние() === STATE_BROADCAST_START
      );
      м_Управление.ОстановитьПросмотрТрансляции();
    }
  }
  function НайтиИОбработатьСменуВариантаТрансляции() {
    for (let ы = г_моОчередь.length; --ы >= 0;) {
      if (
        г_моОчередь[ы].пДанные === STATE_VARIANT_CHANGE &&
        г_моОчередь[ы].чОбработка === PROCESSING_CONVERTED
      ) {
        г_моОчередь.ПоказатьСостояние();
        do {
          if (
            г_моОчередь[ы].пДанные === STATE_VARIANT_CHANGE ||
            typeof г_моОчередь[ы].пДанные != "number"
          ) {
            г_моОчередь.Удалить(ы);
          }
        } while (--ы >= 0);
        г_моОчередь.ПоказатьСостояние();
        ПерезагрузитьИЖдатьЗаполненияБуфера(STATE_LOADING);
        break;
      }
    }
  }
  function ДобавитьСледующийСегмент() {
    СледитьЗаОшибками();
    НайтиИОбработатьСменуВариантаТрансляции();
    const оСегмент = г_моОчередь[0];
    if (!оСегмент || оСегмент.чОбработка !== PROCESSING_CONVERTED) {
      return;
    }
    Check(_оПоведение === _оПрямаяТрансляция);
    if (оСегмент.пДанные === STATE_BROADCAST_START) {
      Check(_oMediaSource.sourceBuffers.length === 0);
      _чСмещениеТрансляции = NaN;
      м_Управление.ИзменитьСостояние(оСегмент.пДанные);
      г_моОчередь.Удалить(0);
      ДобавитьСледующийСегмент();
      return;
    }
    if (_лАсинхроннаяОперация) {
      return;
    }
    if (оСегмент.пДанные === STATE_REPEAT) {
      Check(
        м_Управление.ПолучитьСостояние() !== STATE_STOP &&
        м_Управление.ПолучитьСостояние() !== STATE_REPEAT
      );
      ЗапуститьПовтор();
      г_моОчередь.Удалить(0);
      ДобавитьСледующийСегмент();
      return;
    }
    const сГотовность = _oMediaSource.readyState;
    if (сГотовность !== "open") {
      m_Log.Вот(
        `[Проигрыватель] Добавление сегмента ${оСегмент.чНомер} отложено MediaSource.readyState=${сГотовность} MediaElement.src=${_oMediaElement.src}`
      );
      if (сГотовность === "closed" && _чВоспроизведениеНачиналось === 0) {
        ПредотвратитьПереполнениеОчереди();
      }
      return;
    }
    if (оСегмент.лРазрыв && _oMediaSource.sourceBuffers.length !== 0) {
      ЗавершитьПоток(оСегмент);
      return;
    }
    if (оСегмент.пДанные === STATE_BROADCAST_END) {
      Check(оСегмент.лРазрыв && _oMediaSource.sourceBuffers.length === 0);
      м_Управление.ИзменитьСостояние(оСегмент.пДанные);
      г_моОчередь.Удалить(0);
      ДобавитьСледующийСегмент();
      return;
    }
    if (_oMediaSource.sourceBuffers.length === 0) {
      ДобавитьБуферы(оСегмент);
      м_Управление.ОбновитьКоличествоДорожек(
        оСегмент.пДанные.лЕстьВидео,
        оСегмент.пДанные.лЕстьЗвук
      );
    }
    _лАсинхроннаяОперация = true;
    let оОбещание = УдалитьПросмотренноеВидео(оСегмент).then(
      ПроверитьИсчерпаниеБуфера
    );
    if (оСегмент.пДанные.мбСегментИнициализации) {
      оОбещание = оОбещание.then(ДобавитьСегментИнициализации);
    }
    оОбещание
      .then(ДобавитьМедиасегмент)
      .then(СегментБылДобавлен)
      .catch(СегментНеБылДобавлен);
  }
  function ПеремотатьПовторДо(чПеремотатьДо) {
    Check(м_Управление.ПолучитьСостояние() === STATE_REPEAT);
    _оПовтор.ПроверитьПозициюВоспроизведения(чПеремотатьДо);
  }
  function ПеремотатьПовторНа(лКадры, чПеремотатьНа) {
    Check(м_Управление.ПолучитьСостояние() === STATE_REPEAT);
    Check(Number.isFinite(чПеремотатьНа));
    if (лКадры) {
      чПеремотатьНа *=
        м_Статистика.ПолучитьДлительностьКадраВСекундах().чМинимальная;
    }
    if (чПеремотатьНа !== 0) {
      ПеремотатьПовторДо(
        Clamp(
          _oMediaElement.currentTime + чПеремотатьНа,
          м_Шкала.ПолучитьНачало(),
          м_Шкала.ПолучитьКонец()
        )
      );
    }
  }
  function ПереключитьПаузу() {
    Check(м_Управление.ПолучитьСостояние() === STATE_REPEAT);
    if ((_оПовтор.лПауза = !_оПовтор.лПауза)) {
      m_Log.Окак("[Проигрыватель] Ставлю повтор на паузу");
      _oMediaElement.pause();
    } else {
      m_Log.Окак("[Проигрыватель] Снимаю повтор с паузы");
      _оПовтор.ПроверитьПозициюВоспроизведения(
        ПРОВЕРИТЬ_НАЧАЛО_ВОСПРОИЗВЕДЕНИЯ
      );
      _oMediaElement.play();
    }
    m_Events.SendEvent("проигрыватель-пауза", _оПовтор.лПауза);
  }
  function ЗадатьСкоростьПовтора(чСкорость) {
    Check(чСкорость > 0);
    Check(м_Управление.ПолучитьСостояние() === STATE_REPEAT);
    m_Log.Окак(`[Проигрыватель] Задана скорость ${чСкорость}`);
    _oMediaElement.playbackRate = чСкорость;
  }
  function ЗапуститьПовтор() {
    _оПовтор.лПауза = true;
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
      ПолучитьЗаполненностьБуфера().чПросмотрено <
      ПОВТОР_ДОСТУПЕН_ЕСЛИ_ПРОСМОТРЕНО
    ) {
      ПоказатьСостояние("Окак", "Повторять нечего");
      м_Управление.ИзменитьСостояние(STATE_STOP);
      return;
    }
    ПоказатьСостояние("Окак", "Запуск повтора");
    m_Events.SendEvent("проигрыватель-пауза", _оПовтор.лПауза);
    м_Шкала.ЗадатьНачалоИКонец(
      _oMediaElement.buffered.start(0),
      _oMediaElement.buffered.end(_oMediaElement.buffered.length - 1)
    );
    м_Шкала.ЗадатьПросмотрено(_oMediaElement.currentTime);
    м_Управление.ИзменитьСостояние(STATE_REPEAT);
    ЗадатьСкоростьПовтора(м_Управление.получитьСкоростьПовтора());
  }
  function ДобавитьБуферы(оСегмент) {
    m_Log.Окак(`[Проигрыватель] Добавляю буфер ${оСегмент.пДанные.сКодеки}`);
    Check(оСегмент.лРазрыв && оСегмент.пДанные.сКодеки);
    try {
      _oMediaSourceBuffer = _oMediaSource.addSourceBuffer(
        оСегмент.пДанные.сКодеки
      );
    } catch (pException) {
      if (IsObject(pException) && pException.name === "NotSupportedError") {
        m_Debug.FinishWorkAndShowMessage("J0201");
      } else {
        m_Debug.CaughtException(pException);
      }
    }
    _лЕстьВидеодорожка = оСегмент.пДанные.лЕстьВидео;
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
    м_Аудиоустройство.запустить(_oMediaElement);
  }
  function Запустить() {
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
    м_КартинкаВКартинке.запустить(_oMediaElement);
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
  function Остановить() {
    if (_oMediaElement) {
      URL.revokeObjectURL(_oMediaElement.src);
      _oMediaElement.removeAttribute("src");
      _oMediaElement.load();
    }
  }
  return {
    Запустить,
    Остановить,
    ПолучитьЗаполненностьБуфера,
    ПолучитьКоличествоПропущенныхКадров,
    ПолучитьПозициюВоспроизведенияТрансляции,
    ПоказатьСостояние,
    Перезагрузить: ПерезагрузитьИЖдатьЗаполненияБуфера,
    ПрименитьГромкость,
    ДобавитьСледующийСегмент,
    ПеремотатьПовторДо,
    ПеремотатьПовторНа,
    ПереключитьПаузу,
    ЗадатьСкоростьПовтора,
  };
})();

const м_Список = (() => {
  const ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКА_С_РЕКЛАМОЙ = 2e3;
  const МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ = 500;
  class ОбновлениеСписков {
    constructor(лБезРекламы) {
      this._лБезРекламы = лБезРекламы;
      this._оОтменаОбещания = null;
      this.очистить();
    }
    очистить() {
      this.оСписокВариантов = null;
      this.оСписокСегментов = null;
      this.оВыбранныйВариант = null;
    }
    запустить() {
      Check(!this._оОтменаОбещания);
      this._оОтменаОбещания = new ОтменаОбещания();
      this._обновить(this._оОтменаОбещания, -Infinity);
    }
    остановить() {
      if (this._оОтменаОбещания) {
        m_Log.Вот(
          `[Список] Останавливаю обновление списков ${+this._лБезРекламы}`
        );
        this._оОтменаОбещания.Отменить();
        this._оОтменаОбещания = null;
      }
    }
    сохранитьВариантТрансляции(оВариант) {
      m_Settings.Change("сНазваниеВарианта", оВариант.сИдентификатор);
      m_Settings.Change("чБитрейтВарианта", оВариант.чБитрейт);
    }
    выбратьВариантТрансляции(моВарианты) {
      const сСохраненныйИд = m_Settings.Get("сНазваниеВарианта");
      const чСохраненныйБитрейт = m_Settings.Get("чБитрейтВарианта");
      let оВыбранныйВариант = моВарианты.find(
        ({ сИдентификатор }) => сИдентификатор === сСохраненныйИд
      );
      if (!оВыбранныйВариант) {
        if (сСохраненныйИд === "chunked" || сСохраненныйИд === "audio_only") {
          оВыбранныйВариант = моВарианты[0];
        } else {
          оВыбранныйВариант = моВарианты.find(
            ({ сИдентификатор, чБитрейт }) =>
              сИдентификатор !== "audio_only" && чБитрейт <= чСохраненныйБитрейт
          );
          if (!оВыбранныйВариант) {
            оВыбранныйВариант = моВарианты.reduceRight((оРезультат, оВариант) =>
              оРезультат.сИдентификатор === "audio_only" ? оВариант : оРезультат
            );
          }
        }
      }
      m_Log.Вот(
        `[Список] Для списка ${+this._лБезРекламы} выбран вариант трансляции ${оВыбранныйВариант.сИдентификатор
        }/${оВыбранныйВариант.чБитрейт
        }. Сохраненный ${сСохраненныйИд}/${чСохраненныйБитрейт}`
      );
      return оВыбранныйВариант;
    }
    _обновить(оОтменаОбещания, чЧерез) {
      Check(IsNumber(чЧерез));
      if (чЧерез >= МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ || чЧерез === -Infinity) {
        m_Log.Вот(
          `[Список] Обновление списков ${+this
            ._лБезРекламы} начнется через ${m_Log.F0(чЧерез)}мс`
        );
      } else {
        m_Log.Ой(
          `[Список] Обновление списков ${+this
            ._лБезРекламы} начнется через ${МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ}мс вместо ${m_Log.F0(
              чЧерез
            )}мс`
        );
        чЧерез = МИН_ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКОВ;
      }
      let оОбещание = Ждать(оОтменаОбещания, чЧерез);
      let { оСписокВариантов, оВыбранныйВариант } = this;
      if (оСписокВариантов === null) {
        let сАбсолютныйАдресСпискаВариантов;
        оОбещание = оОбещание
          .then(() =>
            м_Twitch.ПолучитьАбсолютныйАдресСпискаВариантов(
              оОтменаОбещания,
              false,
              this._лБезРекламы
            )
          )
          .then((сРезультат) => {
            сАбсолютныйАдресСпискаВариантов = сРезультат;
            return м_Загрузчик.ЗагрузитьТекст(
              оОтменаОбещания,
              сАбсолютныйАдресСпискаВариантов,
              LOAD_VARIANT_LIST_NO_LONGER_THAN,
              `список вариантов ${+this._лБезРекламы}`,
              false
            );
          })
          .then((сРезультат) => {
            m_Debug.СохранитьСписокВариантов(сРезультат);
            оСписокВариантов = РазобратьСписок(
              true,
              сАбсолютныйАдресСпискаВариантов,
              сРезультат
            );
            if (оСписокВариантов.моВарианты.length === 0) {
              throw `Variant list is empty`;
            }
          });
      }
      let чНачалоОбновления;
      оОбещание
        .then(() => {
          if (оВыбранныйВариант === null) {
            оВыбранныйВариант = this.выбратьВариантТрансляции(
              оСписокВариантов.моВарианты
            );
          }
          чНачалоОбновления = performance.now();
          return м_Загрузчик.ЗагрузитьТекст(
            оОтменаОбещания,
            оВыбранныйВариант.сАбсолютныйАдресСпискаСегментов,
            LOAD_SEGMENT_LIST_NO_LONGER_THAN,
            `список сегментов ${+this._лБезРекламы}`,
            false
          );
        })
        .then((сРезультат) => {
          m_Debug.СохранитьСписокСегментов(сРезультат);
          const оСписокСегментов = РазобратьСписок(
            false,
            оВыбранныйВариант.сАбсолютныйАдресСпискаСегментов,
            сРезультат
          );
          let чИнтервалОбновления;
          if (
            this._этоТухлыйСписокСегментов(
              оСписокВариантов,
              оСписокСегментов,
              оВыбранныйВариант
            )
          ) {
            м_Статистика.ДобавленыСегментыВОчередь(0, 0);
            if (оСписокСегментов.лКонецСписка) {
              throw "КОНЕЦ_СПИСКА";
            }
            чИнтервалОбновления = ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКА_С_РЕКЛАМОЙ;
          } else {
            const лУкороченныйИнтервал =
              чЧерез === -Infinity || this.оСписокВариантов === null;
            this.оСписокВариантов = оСписокВариантов;
            this.оСписокСегментов = оСписокСегментов;
            this.оВыбранныйВариант = оВыбранныйВариант;
            чИнтервалОбновления =
              this._обновленСписокСегментов(лУкороченныйИнтервал);
          }
          this._обновить(
            оОтменаОбещания,
            чНачалоОбновления + чИнтервалОбновления - performance.now()
          );
          м_Загрузчик.ЗагрузитьСледующийСегмент();
        })
        .catch(
          AddExceptionHandler((пПричина) => {
            if (typeof пПричина == "string") {
              this._списокНеОбновлен(оОтменаОбещания, пПричина);
              м_Загрузчик.ЗагрузитьСледующийСегмент();
            } else if (пПричина === ОтменаОбещания.ПРИЧИНА) {
              m_Log.Вот(
                `[Список] Отменено обновление списков ${+this._лБезРекламы}`
              );
            } else {
              throw пПричина;
            }
          })
        );
    }
    _этоТухлыйСписокСегментов(
      оСписокВариантов,
      оСписокСегментов,
      оВыбранныйВариант
    ) {
      const ПОРОГ_СМЕНЫ_СЕССИИ = 5;
      Check(
        (this.оСписокВариантов === null) == (this.оСписокСегментов === null)
      );
      if (оСписокСегментов.моСегменты.length === 0) {
        m_Log.Ой(`[Список] Список сегментов ${+this._лБезРекламы} пуст`);
        return true;
      }
      if (this.оСписокСегментов === null) {
        return false;
      }
      Check(
        !(
          this.оСписокВариантов.сИдТрансляции !==
          оСписокВариантов.сИдТрансляции &&
          this.оСписокВариантов.чИдСессии === оСписокВариантов.чИдСессии
        )
      );
      if (
        this.оСписокСегментов.nTargetDuration !==
        оСписокСегментов.nTargetDuration
      ) {
        m_Log.Ой(
          `[Список] В списке ${+this._лБезРекламы} изменился target duration ${this.оСписокСегментов.nTargetDuration
          } ==> ${оСписокСегментов.nTargetDuration}`
        );
      }
      if (this.оВыбранныйВариант !== null) {
        const чРазница =
          оСписокСегментов.чПорядковыйНомер -
          this.оСписокСегментов.чПорядковыйНомер;
        const чНачало = Math.max(-чРазница, 0);
        const чКонец = Math.min(
          this.оСписокСегментов.моСегменты.length - чРазница,
          оСписокСегментов.моСегменты.length
        );
        for (
          let чНовый = чНачало, чСтарый = чНачало + чРазница;
          чНовый < чКонец;
          чНовый++, чСтарый++
        ) {
          if (
            оСписокСегментов.моСегменты[чНовый].sAddress !==
            this.оСписокСегментов.моСегменты[чСтарый].sAddress
          ) {
            m_Log.Ой(
              `[Список] В списке ${+this._лБезРекламы} у сегмента ${оСписокСегментов.чПорядковыйНомер + чНовый
              } изменился адрес ${LimitStringLength(
                this.оСписокСегментов.моСегменты[чСтарый].sAddress,
                100
              )} ==> ${LimitStringLength(
                оСписокСегментов.моСегменты[чНовый].sAddress,
                100
              )}`
            );
            оСписокСегментов.лХаос = true;
            break;
          }
        }
      }
      const чРазница =
        this.оСписокСегментов.чПорядковыйНомер +
        this.оСписокСегментов.моСегменты.length -
        оСписокСегментов.чПорядковыйНомер -
        оСписокСегментов.моСегменты.length;
      if (чРазница > 0) {
        if (this.оВыбранныйВариант === null && чРазница <= ПОРОГ_СМЕНЫ_СЕССИИ) {
          m_Log.Ой(
            `[Список] При переключении варианта в списке ${+this
              ._лБезРекламы} уменьшился порядковый номер ${this.оСписокСегментов.чПорядковыйНомер
            } + ${this.оСписокСегментов.моСегменты.length} ==> ${оСписокСегментов.чПорядковыйНомер
            } + ${оСписокСегментов.моСегменты.length}`
          );
          return false;
        }
        if (
          оСписокСегментов.чПорядковыйНомер === 0 ||
          чРазница > ПОРОГ_СМЕНЫ_СЕССИИ
        ) {
          m_Log.Ой(
            `[Список] Меняю ИдСессии: в списке ${+this
              ._лБезРекламы} уменьшился порядковый номер ${this.оСписокСегментов.чПорядковыйНомер
            } + ${this.оСписокСегментов.моСегменты.length} ==> ${оСписокСегментов.чПорядковыйНомер
            } + ${оСписокСегментов.моСегменты.length}`
          );
          оСписокВариантов.чИдСессии = _чИдСессии++;
          return false;
        }
        m_Log.Ой(
          `[Список] Получен протухший список ${+this
            ._лБезРекламы}: порядковый номер ${this.оСписокСегментов.чПорядковыйНомер
          } + ${this.оСписокСегментов.моСегменты.length} ==> ${оСписокСегментов.чПорядковыйНомер
          } + ${оСписокСегментов.моСегменты.length}`
        );
        return true;
      }
      if (
        this.оСписокСегментов.чПорядковыйНомер >
        оСписокСегментов.чПорядковыйНомер
      ) {
        m_Log.Ой(
          `[Список] В списке ${+this
            ._лБезРекламы} уменьшился порядковый номер ${this.оСписокСегментов.чПорядковыйНомер
          } ==> ${оСписокСегментов.чПорядковыйНомер}`
        );
      }
      return false;
    }
  }
  class ОбновлениеСписковСРекламой extends ОбновлениеСписков {
    constructor() {
      super(false);
    }
    _обновленСписокСегментов(лУкороченныйИнтервал) {
      m_Log.Вот(
        `[AdBlock] Main stream updated. Segments=${this.оСписокСегментов.моСегменты.length} EndOfList=${this.оСписокСегментов.лКонецСписка}`
      );
      if (this.оСписокСегментов.моСегменты.length === 0) {
        // An empty segment list is what leaves the picture frozen.
        m_Log.Ой("[AdBlock] Main stream is empty");
      }
      const лСписокЗаканчиваетсяРекламой = этотСписокЗаканчиваетсяРекламой(
        this.оСписокСегментов
      );
      м_Twitch.отправитьДанныеСлеженияЗаРекламой(
        лСписокЗаканчиваетсяРекламой ? this.оСписокСегментов : null
      );
      if (!_лИдетРеклама || !лСписокЗаканчиваетсяРекламой) {
        лУкороченныйИнтервал =
          ДобавитьСегментыВОчередь(
            this.оСписокВариантов,
            this.оСписокСегментов,
            this.оВыбранныйВариант
          ) || лУкороченныйИнтервал;
      }
      if (this.оСписокСегментов.лКонецСписка) {
        throw "КОНЕЦ_СПИСКА";
      }
      задатьСостояниеРекламы(лСписокЗаканчиваетсяРекламой);
      return лСписокЗаканчиваетсяРекламой
        ? ИНТЕРВАЛ_ОБНОВЛЕНИЯ_СПИСКА_С_РЕКЛАМОЙ
        : получитьИнтервалОбновленияСпискаСегментов(
          this.оСписокСегментов,
          лУкороченныйИнтервал
        );
    }
    _списокНеОбновлен(оОтменаОбещания, сПричина) {
      if (сПричина === "ОТКАЗАНО_В_ДОСТУПЕ") {
        м_Управление.ОстановитьПросмотрТрансляции();
        m_Notification.ShowAss();
      } else {
        m_Log[сПричина === "КОНЕЦ_СПИСКА" ? "Окак" : "Ой"](
          `[Список] Трансляция завершена. ${сПричина}`
        );
        ЗавершитьТрансляцию();
        this._обновить(
          оОтменаОбещания,
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
    остановить() {
      super.остановить();
      this.очистить();
    }

    /**
     * Method: onSegmentListUpdated (_обновленСписокСегментов)
     * FIX APPLIED: Force-sanitize backup stream segments. 
     * Twitch is now injecting Ad Metadata into the backup stream, causing the player to reject it.
     * We must strip these flags to force playback.
     */
    _обновленСписокСегментов(лУкороченныйИнтервал) {

      // --- FIX START: FORCE CONTENT MODE FOR BACKUP STREAM ---
      // Iterate through all segments in the fetched backup playlist
      if (this.оСписокСегментов && this.оСписокСегментов.моСегменты) {
        for (let i = 0; i < this.оСписокСегментов.моСегменты.length; i++) {
          // Force the 'isAd' flag to false. 
          // This tricks the queue manager (ДобавитьСегментыВОчередь) into accepting the segments.
          this.оСписокСегментов.моСегменты[i].лРеклама = false;
        }
      }
      // --- FIX END ---


      // --- REMOVED THE "THROW IF AD FOUND" CHECK ---
      // We process the segments as normal content now.

      лУкороченныйИнтервал = // bShortenedInterval
        ДобавитьСегментыВОчередь( // AddSegmentsToQueue
          this.оСписокВариантов, // oVariantList
          this.оСписокСегментов, // oSegmentList
          this.оВыбранныйВариант // oSelectedVariant
        ) || лУкороченныйИнтервал; // bShortenedInterval

      if (this.оСписокСегментов.лКонецСписка) { // oSegmentList.bEndOfList
        throw "КОНЕЦ_СПИСКА"; // END_OF_LIST
      }

      return получитьИнтервалОбновленияСпискаСегментов( // getSegmentListUpdateInterval
        this.оСписокСегментов, // oSegmentList
        лУкороченныйИнтервал // bShortenedInterval
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
    _списокНеОбновлен(оОтменаОбещания, сПричина) {
      // Code modified to implement debugging
      console.error(`CRITICAL FAILURE: Backup stream rejected! Reason: ${сПричина}`);
      m_Log.Ой(`[Список] Список 1 не обновлен. ${сПричина}`);
      this.остановить();
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
      моВарианты, // variants
      оНовыйВариант, // newVariant
      сИдТрансляции, // broadcast id
      сАдресСлеженияЗаПросмотром; // viewingTrackingUrl
    let nTargetDuration,
      чПорядковыйНомер, // sequence number
      лКонецСписка, // endOfList
      кРекламныхСегментов, // adSegmentsCount
      // not sure if `adContentType` or `adRollType` is more correct
      // сТипРекламы, // adContentType
      сТипРекламы, // adRollType
      кРоликов, // clipCount
      чНомерРолика, // clipNumber
      чПродолжительностьРолика, // clipDuration
      сТокенРекламы, // adToken
      сИдРолика1, // clipId1
      сИдРолика2, // clipId2
      сИдРолика3, // clipId3
      сИдРолика4, // clipId4
      сИдРолика5, // clipId5
      сИдРолика6, // clipId6
      чНомерКвартеля, // quartileNumber
      моСегменты, // segments
      оНовыйСегмент; // newSegment
    let лРазрыв, чВремя; 
    if (лЭтоСписокВариантов) {
      mapRenditionGroups = new Map();
      моВарианты = [];
      оНовыйВариант = null;
      сИдТрансляции = "";
      сАдресСлеженияЗаПросмотром = "";
    } else {
      nTargetDuration = -1;
      чПорядковыйНомер = 0;
      лКонецСписка = false;
      кРекламныхСегментов = 0;
      сТипРекламы = "";
      моСегменты = [];
      оНовыйСегмент = null;
      лРазрыв = false;
      чВремя = NaN;
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
              оНовыйВариант.сАбсолютныйАдресСпискаСегментов =
                ResolveRelativeUrl(sAddress, сАбсолютныйАдресСписка);
              моВарианты.push(оНовыйВариант);
              оНовыйВариант = null;
            } else {
              браковать(оНовыйСегмент !== null);
              оНовыйСегмент.sAddress = ResolveRelativeUrl(
                sAddress,
                сАбсолютныйАдресСписка
              );
              оНовыйСегмент.лРазрыв = лРазрыв;
              моСегменты.push(оНовыйСегмент);
              лРазрыв = false;
              кРекламныхСегментов += Boolean(оНовыйСегмент.лРеклама);
              оНовыйСегмент = null;
            }
            break;

          case "INF": {
            Check(!лЭтоСписокВариантов);
            Check(nTargetDuration !== -1);
            Check(оНовыйСегмент === null);
            оНовыйСегмент = Object.create(null);
            const { чДлительность, сИмяСегмента } =
              разобратьEXTINF(сЗначениеТега);
            оНовыйСегмент.чДлительность = чДлительность;

            // --- ZOMBIE SEGMENT OVERRIDE START ---
            // If the DATERANGE parser identified a Zombie Ad and set the global flag,
            // we force this segment to be treated as CONTENT (False), not AD.
            // This prevents the player from switching to the dead backup stream.
            if (typeof г_лИгнорироватьСегментыРекламы !== 'undefined' && г_лИгнорироватьСегментыРекламы) {
              оНовыйСегмент.лРеклама = false;
              // If we encounter a standard 'live' segment, the zombie block is likely over.
              // Reset the flag to resume normal ad detection protection.
              if (сИмяСегмента === "live") {
                г_лИгнорироватьСегментыРекламы = false;
              }
            } else {
              // Standard behavior
              оНовыйСегмент.лРеклама = м_Twitch.этоРекламныйСегмент(сИмяСегмента);
            }
            // --- ZOMBIE SEGMENT OVERRIDE END ---


            if (оНовыйСегмент.лРеклама) {
              чВремя = NaN;
            }
            оНовыйСегмент.чВремя = чВремя;
            чВремя++;
            if (оНовыйСегмент.чДлительность < 0) {
              m_Log.Ой(
                `[Список] У сегмента ${чПорядковыйНомер + моСегменты.length
                } отрицательная длительность ${сЗначениеТега}`
              );
              оНовыйСегмент.чДлительность = 0;
            }
            if (Math.round(оНовыйСегмент.чДлительность) > nTargetDuration) {
              m_Log.Ой(
                `[Список] Длительность сегмента ${чПорядковыйНомер + моСегменты.length
                } больше target duration на ${оНовыйСегмент.чДлительность - nTargetDuration
                }с`
              );
              if (оНовыйСегмент.чДлительность > nTargetDuration * 3) {
                оНовыйСегмент.чДлительность = 0;
              }
            }
            break;
          }

          case "-X-DISCONTINUITY":
            Check(!лЭтоСписокВариантов);
            Check(!сЗначениеТега);
            лРазрыв = true;
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
                м_Twitch.ПолучитьАдресКанала(true)
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
            Check(чПорядковыйНомер === 0);
            чПорядковыйНомер = РазобратьЦелоеПоложительноеЧисло(сЗначениеТега);
            break;

          case "-X-ENDLIST":
            Check(!лЭтоСписокВариантов);
            Check(!сЗначениеТега);
            лКонецСписка = true;
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
            чВремя = РазобратьЦелоеПоложительноеЧисло(сЗначениеТега);
            break;

          case "-X-DATERANGE": {
            Check(!лЭтоСписокВариантов);
            const амАтрибуты = РазобратьСписокАтрибутов(сЗначениеТега);

            // --- STRICT AD FILTER FIX (UPDATED DEC 16) ---
            try {
              const sClass = амАтрибуты.get("CLASS");
              if (sClass === "twitch-stitched-ad") {
                const сДатаНачала = амАтрибуты.get("START-DATE");
                const сДлительность = амАтрибуты.get("DURATION");

                if (сДатаНачала && сДлительность) {
                  const чВремяНачалаРекламы = Date.parse(сДатаНачала);
                  const чДлительностьМс = parseFloat(сДлительность) * 1000;
                  const чВремяОкончанияРекламы = чВремяНачалаРекламы + чДлительностьМс;

                  // Calculate current server time. 
                  const чТекущееВремя = !Number.isNaN(g_nExactTime)
                    ? performance.now() + g_nExactTime
                    : Date.now();

                  // RULE 1: STRICT EXPIRY. 
                  // If the ad end time is in the past (plus 1s for jitter), KILL IT.
                  // Previous issue: 15s buffer allowed finished ads to block playback.
                  if (чВремяОкончанияРекламы < (чТекущееВремя + 1000)) {
                    m_Log.Окак(
                      `[AdBlock] Skipping expired ad. Ends=${new Date(чВремяОкончанияРекламы).toISOString()} Now=${new Date(чТекущееВремя).toISOString()}`
                    );
                    break; // EXIT this case immediately
                  }

                  // RULE 2: FUTURE PROTECTION.
                  // If ad starts >60s in the future, ignore it to prevent pre-mature freezing.
                  if (чВремяНачалаРекламы > (чТекущееВремя + 60000)) {
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
              switch (амАтрибуты.get("CLASS")) {
                case "twitch-stitched-ad":
                  // The raw attribute string of the ad tag, kept whole because the
                  // shape of these tags is what the ad-freeze work turns on.
                  m_Log.Вот(`[AdBlock] Ad tag detected: ${сЗначениеТега}`);

                  // Extract Ad Type (e.g., standard, midroll)
                  сТипРекламы = амАтрибуты.get("X-TV-TWITCH-AD-ROLL-TYPE");

                  // Extract Total Number of Ads in this break (Pod Length)
                  кРоликов = РазобратьЦелоеПоложительноеЧисло(
                    амАтрибуты.get("X-TV-TWITCH-AD-POD-LENGTH")
                  );

                  // Extract Current Ad Position (e.g., 2 in a sequence of 4)
                  чНомерРолика = РазобратьЦелоеПоложительноеЧисло(
                    амАтрибуты.get("X-TV-TWITCH-AD-POD-POSITION")
                  );

                  // Extract Duration of the ad in seconds
                  чПродолжительностьРолика = РазобратьПоложительноеЧисло(
                    амАтрибуты.get("DURATION") || "0"
                  );

                  // Extract specific Ad Tracking tokens and IDs for analytics
                  // These IDs are NOT used for playback logic. They are only used to construct
                  // the "Proof of View" telemetry packet sent back to Twitch via 'recordAdEvent'.

                  // RADS Token: The unique cryptographic token validating this specific ad impression.
                  сТокенРекламы =
                    амАтрибуты.get("X-TV-TWITCH-AD-RADS-TOKEN") || "";

                  // Advertiser ID: Identifies the company buying the ad (mapped to 'ad_id' in GQL).
                  сИдРолика1 =
                    амАтрибуты.get("X-TV-TWITCH-AD-ADVERTISER-ID") || "";

                  // Creative ID: Identifies the specific video asset/commercial (mapped to 'creative_id').
                  сИдРолика2 =
                    амАтрибуты.get("X-TV-TWITCH-AD-CREATIVE-ID") || "";

                  // Line Item ID: Internal campaign management ID (mapped to 'line_item_id').
                  сИдРолика3 =
                    амАтрибуты.get("X-TV-TWITCH-AD-LINE-ITEM-ID") || "";

                  // Order ID: Purchase order ID for the ad campaign (mapped to 'order_id').
                  сИдРолика4 = амАтрибуты.get("X-TV-TWITCH-AD-ORDER-ID") || "";

                  // Ad Session ID: Ties this ad view to the user's viewing session (mapped to 'ad_session_id').
                  сИдРолика5 =
                    амАтрибуты.get("X-TV-TWITCH-AD-AD-SESSION-ID") || "";

                  // Ad Format: The format of the ad, e.g., 'Video', 'Display' (mapped to 'format_name').
                  сИдРолика6 = амАтрибуты.get("X-TV-TWITCH-AD-AD-FORMAT") || "";

                  // Validate that we found a valid Ad Type
                  Check(сТипРекламы);
              }
            } catch (pException) {
              // Safety fallback: if parsing fails, reset ad type and log error.
              сТипРекламы = "";
              m_Log.Ой(`[Список] Ошибка разбора рекламы: ${сЗначениеТега}`);
            }
            break;
          }

          case "-X-MEDIA": {
            Check(лЭтоСписокВариантов);
            const амАтрибуты = РазобратьСписокАтрибутов(сЗначениеТега);
            const сТип = амАтрибуты.get("TYPE");
            Check(сТип);
            Check(
              (сТип !== "VIDEO" && сТип !== "AUDIO") || !амАтрибуты.has("URI")
            );
            if (сТип === "VIDEO") {
              const сГруппа = амАтрибуты.get("GROUP-ID");
              const sName = амАтрибуты.get("NAME");
              Check(сГруппа && sName);
              Check(!mapRenditionGroups.has(сГруппа));
              mapRenditionGroups.set(сГруппа, sName);
            } else {
              m_Log.Ой(`[Список] Найден #EXT-X-MEDIA TYPE=${сТип}`);
            }
            break;
          }

          case "-X-STREAM-INF": {
            Check(лЭтоСписокВариантов);
            Check(оНовыйВариант === null);
            оНовыйВариант = Object.create(null);
            const амАтрибуты = РазобратьСписокАтрибутов(сЗначениеТега);
            оНовыйВариант.чБитрейт = РазобратьЦелоеПоложительноеЧисло(
              амАтрибуты.get("BANDWIDTH")
            );
            Check(
              !амАтрибуты.has("AUDIO") &&
              !амАтрибуты.has("SUBTITLES") &&
              !амАтрибуты.has("CLOSED-CAPTIONS")
            );
            оНовыйВариант.сИдентификатор = амАтрибуты.get("VIDEO") || "";
            // Needed to build the SourceBuffer MIME type for fMP4 playlists, where no
            // demuxer runs to derive the codec string from the elementary streams.
            оНовыйВариант.sCodecs = амАтрибуты.get("CODECS") || "";
            оНовыйВариант.sResolution = амАтрибуты.get("RESOLUTION") || "";
            break;
          }

          case "-X-I-FRAME-STREAM-INF":
          case "-X-SESSION-DATA":
          case "-X-SESSION-KEY":
            Check(лЭтоСписокВариантов);
            break;

          case "-X-TWITCH-INFO": {
            Check(лЭтоСписокВариантов);
            const амАтрибуты = РазобратьСписокАтрибутов(сЗначениеТега);
            const чСекунды = РазобратьПоложительноеЧисло(
              амАтрибуты.get("SERVER-TIME")
            );
            Check(чСекунды > 1531267200 && чСекунды < 1846886400);
            const чМиллисекунды = чСекунды * 1e3 + 50;
            g_nExactTime = чМиллисекунды - performance.now();
            const чРассинхронизацияВремени = чМиллисекунды - Date.now();
            сИдТрансляции = амАтрибуты.get("BROADCAST-ID");
            Check(сИдТрансляции);
            try {
              const sAddress = atob(амАтрибуты.get("C"));
              Check(sAddress.startsWith("https://"));
              сАдресСлеженияЗаПросмотром = sAddress;
            } catch (pException) {
              m_Log.Ой(
                `[Список] Не удалось разобрать адрес слежения за просмотром: ${pException}`
              );
            }
            m_Log[Math.abs(чРассинхронизацияВремени) > 5e3 ? "Ой" : "Окак"](
              `[Список] РассинхронизацияВремени=${чРассинхронизацияВремени}мс ИдТрансляции=${сИдТрансляции}`
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
      for (let оВариант of моВарианты) {
        if (оВариант.сИдентификатор) {
          Check(mapRenditionGroups.has(оВариант.сИдентификатор));
          оВариант.сНазвание = mapRenditionGroups.get(оВариант.сИдентификатор);
        } else {
          оВариант.сИдентификатор = `CoolCmd${оВариант.чБитрейт}`;
          оВариант.сНазвание = `${m_i18n.FormatNumber(
            оВариант.чБитрейт / 1e6,
            1
          )} ${Текст("J0114")}`;
        }
      }
      m_Log.Вот(
        `[Список] Количество вариантов в списке: ${моВарианты.length}`
      );
      return м_Twitch.сортироватьСписокВариантов({
        сИдТрансляции,
        чИдСессии: _чИдСессии++,
        сАдресСлеженияЗаПросмотром,
        моВарианты,
      });
    } else {
      Check(оНовыйСегмент === null);
      Check(nTargetDuration !== -1);
      const оСписокСегментов = {
        nTargetDuration,
        чПорядковыйНомер,
        лКонецСписка,
        лХаос: false,
        кРекламныхСегментов,
        сТипРекламы,
        кРоликов,
        чНомерРолика,
        чПродолжительностьРолика,
        сТокенРекламы,
        сИдРолика1,
        сИдРолика2,
        сИдРолика3,
        сИдРолика4,
        сИдРолика5,
        сИдРолика6,
        моСегменты,
        sInitSegmentUrl,
      };
      m_Log.Вот(
        `[Список] Разобран список сегментов TargetDuration=${nTargetDuration} ПорядковыйНомер=${чПорядковыйНомер} КонецСписка=${лКонецСписка} КоличествоСегментов=${моСегменты.length} РекламныхСегментов=${кРекламныхСегментов}`
      );
      if (сТипРекламы) {
        m_Log.Окак(
          `[Список] Найдена реклама ТипРекламы=${сТипРекламы} ТокенРекламы=${сТокенРекламы.slice(
            -10
          )} Роликов=${кРоликов} НомерРолика=${чНомерРолика} ПродолжительностьРолика=${чПродолжительностьРолика} НомерКвартеля=${чНомерКвартеля} ЗаканчиваетсяРекламой=${этотСписокЗаканчиваетсяРекламой(
            оСписокСегментов
          )}`
        );
      }
      м_Статистика.РазобранСписокСегментов(оСписокСегментов);
      return оСписокСегментов;
    }
  }
  function браковать(pCondition) {
    if (!pCondition) {
      throw new Error("БРАКОВАТЬ");
    }
  }
  function РазобратьСписокАтрибутов(сИсходныйТекст) {
    const амАтрибуты = new Map();
    const рвАтрибут = /([A-Z0-9-]+)=(?:"([^"]*)"|([^",]+))(?:,|$)/g;
    while (рвАтрибут.lastIndex !== сИсходныйТекст.length) {
      const { lastIndex } = рвАтрибут;
      const мсАтрибут = рвАтрибут.exec(сИсходныйТекст);
      Check(мсАтрибут.index === lastIndex);
      Check(!амАтрибуты.has(мсАтрибут[1]));
      амАтрибуты.set(мсАтрибут[1], мсАтрибут[3] || мсАтрибут[2]);
    }
    return амАтрибуты;
  }
  function РазобратьЦелоеПоложительноеЧисло(сИсходныйТекст) {
    const чРезультат = parseFloat(сИсходныйТекст);
    Check(Number.isSafeInteger(чРезультат) && чРезультат >= 0);
    return чРезультат;
  }
  function РазобратьПоложительноеЧисло(сИсходныйТекст) {
    const чРезультат = parseFloat(сИсходныйТекст);
    Check(Number.isFinite(чРезультат) && чРезультат >= 0);
    return чРезультат;
  }
  function РазобратьЛюбоеЧисло(сИсходныйТекст) {
    const чРезультат = parseFloat(сИсходныйТекст);
    Check(Number.isFinite(чРезультат));
    return чРезультат;
  }
  function разобратьEXTINF(сИсходныйТекст) {
    let чЗапятая = сИсходныйТекст.indexOf(",");
    if (чЗапятая === -1) {
      чЗапятая = сИсходныйТекст.length;
    }
    return {
      чДлительность: РазобратьЛюбоеЧисло(сИсходныйТекст.slice(0, чЗапятая)),
      сИмяСегмента: сИсходныйТекст.slice(чЗапятая + 1),
    };
  }
  function этотСписокЗаканчиваетсяРекламой(оСписок) {
    return (
      оСписок !== null &&
      оСписок.моСегменты.length !== 0 &&
      оСписок.моСегменты[оСписок.моСегменты.length - 1].лРеклама
    );
  }
  function задатьСостояниеРекламы(лИдетРеклама) {
    if (_лИдетРеклама !== лИдетРеклама) {
      m_Log.Окак(`[AdBlock] Ad in progress: ${лИдетРеклама}`);
      _лИдетРеклама = лИдетРеклама;
      if (лИдетРеклама) {
        _оСпискиБезРекламы.запустить();
        m_Events.SendEvent("список-началорекламы");
      } else {
        _оСпискиБезРекламы.остановить();
        m_Events.SendEvent("список-конецрекламы");
      }
    }
    if (!лИдетРеклама) {
      м_Twitch.отправитьДанныеСлеженияЗаРекламой(null);
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
    оВыбранныйВариант
  ) {
    Check(
      !(
        _сДобавленныйИдТрансляции !== оНовыеВарианты.сИдТрансляции &&
        _чДобавленныйИдСессии === оНовыеВарианты.чИдСессии
      )
    );
    if (оНовыеСегменты.лХаос) {
      _лДобавитьРазрыв = true;
      м_Статистика.ДобавленыСегментыВОчередь(0, 0);
      return false;
    }
    let кСегментовДобавлено = 0;
    let кСекундДобавлено = 0;
    let чИндексДобавляемогоСегмента = оНовыеСегменты.моСегменты.length;
    let кДобавитьСегментов =
      _сДобавленныйИдТрансляции !== оНовыеВарианты.сИдТрансляции ? 1 : 3;
    let чДобавитьСекунд = m_Settings.Get("чРазмерБуфера");
    while (--чИндексДобавляемогоСегмента > 0) {
      if (
        !оНовыеСегменты.моСегменты[чИндексДобавляемогоСегмента].лРеклама &&
        оНовыеСегменты.моСегменты[чИндексДобавляемогоСегмента].чДлительность !==
        0
      ) {
        кДобавитьСегментов--;
        чДобавитьСекунд -=
          оНовыеСегменты.моСегменты[чИндексДобавляемогоСегмента].чДлительность;
        if (кДобавитьСегментов <= 0 && чДобавитьСекунд <= 0) {
          break;
        }
      }
    }
    if (_сДобавленныйИдТрансляции !== оНовыеВарианты.сИдТрансляции) {
      m_Log.Окак(
        `[Список] Изменился ИдТрансляции ${_сДобавленныйИдТрансляции} ==> ${оНовыеВарианты.сИдТрансляции}`
      );
      _чДобавленноеВремя = -1;
      _лДобавитьРазрыв = true;
      for (
        let оДобавляемыйСегмент;
        (оДобавляемыйСегмент =
          оНовыеСегменты.моСегменты[чИндексДобавляемогоСегмента]);
        чИндексДобавляемогоСегмента++
      ) {
        добавитьСегментВОчередь(
          оДобавляемыйСегмент,
          оНовыеСегменты.чПорядковыйНомер + чИндексДобавляемогоСегмента
        );
      }
    } else if (_чДобавленныйИдСессии !== оНовыеВарианты.чИдСессии) {
      m_Log.Окак(
        `[Список] Изменился ИдСессии ${_чДобавленныйИдСессии} ==> ${оНовыеВарианты.чИдСессии}`
      );
      _лДобавитьРазрыв = true;
      for (
        let оДобавляемыйСегмент;
        (оДобавляемыйСегмент =
          оНовыеСегменты.моСегменты[чИндексДобавляемогоСегмента]);
        чИндексДобавляемогоСегмента++
      ) {
        if (оДобавляемыйСегмент.чВремя > _чДобавленноеВремя) {
          добавитьСегментВОчередь(
            оДобавляемыйСегмент,
            оНовыеСегменты.чПорядковыйНомер + чИндексДобавляемогоСегмента
          );
        }
      }
    } else {
      if (_сДобавленныйИдВарианта !== оВыбранныйВариант.сИдентификатор) {
        m_Log.Окак(
          `[Список] Изменился ИдВарианта ${_сДобавленныйИдВарианта} ==> ${оВыбранныйВариант.сИдентификатор}`
        );
        _лДобавитьРазрыв = true;
      }
      for (
        let оДобавляемыйСегмент;
        (оДобавляемыйСегмент =
          оНовыеСегменты.моСегменты[чИндексДобавляемогоСегмента]);
        чИндексДобавляемогоСегмента++
      ) {
        if (
          оНовыеСегменты.чПорядковыйНомер + чИндексДобавляемогоСегмента >
          _чДобавленныйПорядковыйНомер
        ) {
          добавитьСегментВОчередь(
            оДобавляемыйСегмент,
            оНовыеСегменты.чПорядковыйНомер + чИндексДобавляемогоСегмента
          );
        }
      }
    }
    м_Статистика.ДобавленыСегментыВОчередь(
      кСегментовДобавлено,
      кСекундДобавлено
    );
    return кСегментовДобавлено === 0;
    function добавитьСегментВОчередь(оСегмент, чПорядковыйНомер) {
      начатьТрансляцию();
      if (оСегмент.лРеклама) {
        m_Log.Вот(
          `[Список] Не добавляю рекламу ПорядковыйНомер=${чПорядковыйНомер}`
        );
        return;
      }
      if (оСегмент.чДлительность === 0) {
        m_Log.Ой(
          `[Список] Не добавляю сегмент ПорядковыйНомер=${чПорядковыйНомер} Время=${оСегмент.чВремя} Длительность=0`
        );
        return;
      }
      if (
        _чДобавленныйИдСессии === оНовыеВарианты.чИдСессии &&
        _чДобавленныйПорядковыйНомер + 1 < чПорядковыйНомер
      ) {
        m_Log.Ой(
          `[Список] Пропущены сегменты с ${_чДобавленныйПорядковыйНомер + 1
          } по ${чПорядковыйНомер - 1}`
        );
        м_Статистика.пропущеныСегменты(
          чПорядковыйНомер - _чДобавленныйПорядковыйНомер - 1
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
      const оДобавлено = г_моОчередь.Add(
        new Сегмент(
          PROCESSING_AWAITING_DOWNLOAD,
          оСегмент.sAddress,
          оСегмент.чДлительность,
          оСегмент.лРазрыв || _лДобавитьРазрыв
        )
      );
      // fMP4 segments carry their own initialisation segment and codec string, and
      // bypass the MPEG-TS transcoder entirely. See m_InitSegment.
      if (оНовыеСегменты.sInitSegmentUrl) {
        оДобавлено.sInitSegmentUrl = оНовыеСегменты.sInitSegmentUrl;
        оДобавлено.sCodecs = оВыбранныйВариант.sCodecs || "";
        оДобавлено.sResolution = оВыбранныйВариант.sResolution || "";
      }
      m_Log[оДобавлено.лРазрыв ? "Окак" : "Вот"](
        `[Список] Добавлен сегмент ${оДобавлено.чНомер} ПорядковыйНомер=${чПорядковыйНомер} Время=${оСегмент.чВремя} Длительность=${оДобавлено.чДлительность} Разрыв=${оДобавлено.лРазрыв}`
      );
      кСегментовДобавлено++;
      кСекундДобавлено += оДобавлено.чДлительность;
      _сДобавленныйИдТрансляции = оНовыеВарианты.сИдТрансляции;
      _чДобавленныйИдСессии = оНовыеВарианты.чИдСессии;
      _сДобавленныйИдВарианта = оВыбранныйВариант.сИдентификатор;
      _чДобавленныйПорядковыйНомер = чПорядковыйНомер;
      _sAddedInitSegmentUrl = оНовыеСегменты.sInitSegmentUrl || "";
      if (!Number.isNaN(оСегмент.чВремя)) {
        _чДобавленноеВремя = оСегмент.чВремя;
      }
      _лДобавитьРазрыв = false;
    }
  }
  function получитьИнтервалОбновленияСпискаСегментов(
    оСписокСегментов,
    лУкороченныйИнтервал
  ) {
    let кСегментов = 0,
      чДлительностьСписка = 0;
    let чСредняяДлительностьСегмента,
      чМинДлительностьСегмента = Infinity,
      чМаксДлительностьСегмента = -Infinity;
    for (const { лРеклама, чДлительность } of оСписокСегментов.моСегменты) {
      if (!лРеклама && чДлительность > 0) {
        кСегментов++;
        чДлительностьСписка += чДлительность;
        чМинДлительностьСегмента = Math.min(
          чМинДлительностьСегмента,
          чДлительность
        );
        чМаксДлительностьСегмента = Math.max(
          чМаксДлительностьСегмента,
          чДлительность
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
        )} ДлительностьСписка=${m_Log.F1(чДлительностьСписка)} НеЗагружать=${оСписокСегментов.моСегменты.length - кСегментов
        }`
      );
    } else {
      чСредняяДлительностьСегмента =
        чМинДлительностьСегмента =
        чМаксДлительностьСегмента =
        Math.max(оСписокСегментов.nTargetDuration / 3, 1);
      m_Log.Ой(
        `[Список] Предполагаемая длительность сегментов ${m_Log.F1(
          чСредняяДлительностьСегмента
        )}`
      );
    }
    return лУкороченныйИнтервал
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
      г_моОчередь.Add(
        new Сегмент(PROCESSING_DOWNLOADED, STATE_BROADCAST_START)
      );
      m_Events.SendEvent("список-выбранварианттрансляции", [
        _оСпискиСРекламой.оСписокВариантов.моВарианты,
        _оСпискиСРекламой.оВыбранныйВариант,
      ]);
    }
  }
  function ЗавершитьТрансляцию() {
    if (_чСостояние !== STATE_BROADCAST_END) {
      _чСостояние = STATE_BROADCAST_END;
      _чИнтервалОбновленияСпискаВариантов = -1;
      г_моОчередь.Add(
        new Сегмент(PROCESSING_DOWNLOADED, STATE_BROADCAST_END)
      );
      m_Events.SendEvent("список-выбранварианттрансляции", [null, null]);
    }
    _оСпискиСРекламой.очистить();
    задатьСостояниеРекламы(false);
  }
  function ИзменитьВариантТрансляции(чВыбранныйВариант) {
    if (_оСпискиСРекламой.оСписокВариантов !== null) {
      _оСпискиСРекламой.сохранитьВариантТрансляции(
        _оСпискиСРекламой.оСписокВариантов.моВарианты[чВыбранныйВариант]
      );
      _оСпискиСРекламой.оВыбранныйВариант = null;
      if (_чСостояние === STATE_BROADCAST_START) {
        _оСпискиСРекламой.остановить();
        _оСпискиСРекламой.запустить();
        if (!_лИдетРеклама) {
          очиститьСтатистикуДобавления();
          г_моОчередь.Add(
            new Сегмент(PROCESSING_DOWNLOADED, STATE_VARIANT_CHANGE)
          );
          м_Загрузчик.ЗагрузитьСледующийСегмент();
        }
      }
    }
  }
  function Остановить() {
    _чСостояние = STATE_STOP;
    _оСпискиСРекламой.остановить();
    очиститьСтатистикуДобавления();
    задатьСостояниеРекламы(false);
  }
  function Запустить() {
    Check(_чСостояние === STATE_STOP);
    _оСпискиСРекламой.запустить();
  }
  return {
    Запустить,
    Остановить,
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
        .Загрузить(
          new ОтменаОбещания(),
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
          м_Преобразователь.ПреобразоватьСледующийСегмент();
        })
        .catch((пПричина) => {
          // Drop the entry so the next segment retries rather than stalling forever.
          _amCache.delete(sUrl);
          m_Log.Ой(
            `[InitSegment] Download failed: ${ExceptionToString(пПричина)}`
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
  let _оРабочийПоток = null;
  // Media segments handed to the worker and not yet returned. fMP4 passthrough
  // waits for this to reach zero so converted segments cannot overtake them.
  let _nWorkerJobs = 0;
  let _чПоследнийЗагруженный = -1;
  function ПреобразоватьСледующийСегмент() {
    let чУдалить,
      кУдалить = 0;
    for (
      let оСегмент, чСегмент = 0;
      (оСегмент = г_моОчередь[чСегмент]);
      ++чСегмент
    ) {
      if (оСегмент.чОбработка > PROCESSING_DOWNLOADED) {
        continue;
      }
      if (оСегмент.чОбработка < PROCESSING_DOWNLOADED) {
        break;
      }
      if (
        _чПоследнийЗагруженный !== -1 &&
        _чПоследнийЗагруженный + 1 !== оСегмент.чНомер
      ) {
        m_Log.Ой(
          `[Преобразование] Не загружены сегменты между ${_чПоследнийЗагруженный} и ${оСегмент.чНомер}`
        );
        оСегмент.лРазрыв = true;
      }
      _чПоследнийЗагруженный = оСегмент.чНомер;
      if (typeof оСегмент.пДанные == "number" && _оРабочийПоток === null) {
        m_Log.Вот(
          `[Преобразование] Пропускаю сегмент ${оСегмент.чНомер} Состояние=${оСегмент.пДанные}`
        );
        оСегмент.чОбработка = PROCESSING_CONVERTED;
        if (оСегмент.пДанные === STATE_BROADCAST_START) {
          СоздатьРабочийПоток();
        }
      } else if (
        оСегмент.sInitSegmentUrl &&
        typeof оСегмент.пДанные != "number"
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
        const mbInitSegment = m_InitSegment.Get(оСегмент.sInitSegmentUrl);
        if (mbInitSegment === null) {
          // Still downloading. m_InitSegment calls us back when it lands.
          break;
        }
        м_Статистика.ПолученИсходныйСегмент();
        m_Log.Вот(
          `[Transcoder] Segment ${оСегмент.чНомер} is fMP4, no conversion needed`
        );
        оСегмент.пДанные = BuildPassthroughData(оСегмент, mbInitSegment);
        оСегмент.чОбработка = PROCESSING_CONVERTED;
        м_Статистика.ПолученПреобразованныйСегмент(оСегмент);
      } else {
        if (typeof оСегмент.пДанные == "number") {
          m_Log.Вот(
            `[Преобразование] Отсылаю сегмент ${оСегмент.чНомер} Состояние=${оСегмент.пДанные}`
          );
          _оРабочийПоток.postMessage(оСегмент);
        } else {
          m_Debug.СохранитьТранспортныйПоток(оСегмент);
          м_Статистика.ПолученИсходныйСегмент();
          m_Log.Вот(`[Преобразование] Отсылаю сегмент ${оСегмент.чНомер}`);
          ++_nWorkerJobs;
          _оРабочийПоток.postMessage(оСегмент, [оСегмент.пДанные]);
        }
        if (++кУдалить == 1) {
          чУдалить = чСегмент;
        }
      }
    }
    if (кУдалить !== 0) {
      г_моОчередь.Удалить(чУдалить, кУдалить);
    }
    м_Проигрыватель.ДобавитьСледующийСегмент();
  }
  /**
   * Wraps an already-fragmented MP4 segment in the shape the player expects back
   * from the worker, so nothing downstream needs to know where the bytes came from.
   *
   * @param {!Сегмент} оСегмент A downloaded segment whose пДанные is the raw ArrayBuffer.
   * @param {!Uint8Array} mbInitSegment The cached #EXT-X-MAP initialisation segment.
   * @returns {!Object}
   */
  function BuildPassthroughData(оСегмент, mbInitSegment) {
    const sCodecs = оСегмент.sCodecs;
    const оДанные = {
      bPassthrough: true,
      мбМедиасегмент: new Uint8Array(оСегмент.пДанные),
      лЕстьВидео: /avc1|avc3|hvc1|hev1|av01|vp09/.test(sCodecs),
      лЕстьЗвук: /mp4a|ac-3|ec-3|opus|fLaC/.test(sCodecs),
      чПреобразованЗа: 0,
    };
    if (оСегмент.лРазрыв) {
      // The player appends this before the media segment and later hands it to the
      // recycler, which neuters the buffer — so every discontinuity gets its own copy.
      оДанные.мбСегментИнициализации = mbInitSegment.slice();
      оДанные.сКодеки = `video/mp4;codecs="${sCodecs}"`;
      оДанные.sCodecsDescription = sCodecs;
      оДанные.sResolution = оСегмент.sResolution;
    }
    return оДанные;
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
          const оСегмент = new Сегмент(
            PROCESSING_CONVERTED,
            мДанные[1].пДанные,
            мДанные[1].чДлительность,
            мДанные[1].лРазрыв,
            мДанные[1].чНомер
          );
          m_Log.Вот(
            `[Преобразование] Получен сегмент ${оСегмент.чНомер
            } ПреобразованЗа=${m_Log.F0(оСегмент.пДанные.чПреобразованЗа)}мс`
          );
          if (typeof оСегмент.пДанные != "number") {
            м_Статистика.ПолученПреобразованныйСегмент(оСегмент);
            if (!оСегмент.пДанные.hasOwnProperty("мбМедиасегмент")) {
              return;
            }
            m_Debug.СохранитьПреобразованныйСегмент(оСегмент);
          }
          г_моОчередь.Add(оСегмент);
          м_Проигрыватель.ДобавитьСледующийСегмент();
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
          for (let ы = 0; ы < мсВажность.length; ++ы) {
            Check(
              (мсВажность[ы] === "Вот" ||
                мсВажность[ы] === "Окак" ||
                мсВажность[ы] === "Ой") &&
              typeof мсЗаписи[ы] == "string"
            );
            m_Log[мсВажность[ы]](мсЗаписи[ы]);
          }
          return;

        case 3:
          Check(
            мДанные.length === 3 &&
            typeof мДанные[1] == "string" &&
            typeof мДанные[2] == "object"
          );
          m_Debug.ЗавершитьРаботуИОтправитьОтчет(мДанные[1], мДанные[2]);
          return;

        case 4:
          Check(мДанные.length === 2 && typeof мДанные[1] == "string");
          m_Debug.FinishWorkAndShowMessage(мДанные[1]);
          return;

        case 5:
          Check(мДанные.length === 2 && мДанные[1].byteLength);
          м_Помойка.Выбросить(мДанные[1]);
          return;

        default:
          Check(false);
      }
    }
  );
  function ОбработатьОшибкуПреобразования(oEvent) {
    m_Debug.ЗавершитьРаботуИОтправитьОтчет(
      `Event occurred: ${oEvent.type} в рабочем потоке в строке ${oEvent.lineno}. ${oEvent.message}`
    );
  }
  function СоздатьРабочийПоток() {
    m_Log.Вот("[Преобразование] Создаю рабочий поток");
    _nWorkerJobs = 0;
    _оРабочийПоток = new Worker("/worker.js");
    _оРабочийПоток.addEventListener(
      "message",
      ОбработатьОкончаниеПреобразования
    );
    _оРабочийПоток.addEventListener("error", ОбработатьОшибкуПреобразования);
    _оРабочийПоток.addEventListener(
      "messageerror",
      ОбработатьОшибкуПреобразования
    );
  }
  function Остановить() {
    _чПоследнийЗагруженный = -1;
    if (_оРабочийПоток) {
      m_Log.Вот("[Преобразование] Убиваю рабочий поток");
      _оРабочийПоток.terminate();
      _оРабочийПоток = null;
      _nWorkerJobs = 0;
    }
  }
  return {
    Остановить,
    ПреобразоватьСледующийСегмент,
  };
})();

const м_Загрузчик = (() => {
  const МАКС_КОЛИЧЕСТВО_ПОПЫТОК = 2;
  function ЗагрузитьТекст(
    оОтменаОбещания,
    sAddress,
    чНеДольше,
    сНазвание,
    лЖурнал,
    оЗаголовки = null,
    сМетод = "GET"
  ) {
    return Загрузить(
      оОтменаОбещания,
      сМетод,
      sAddress,
      чНеДольше,
      оЗаголовки,
      null,
      сНазвание,
      лЖурнал,
      "text"
    );
  }
  function ЗагрузитьJson(
    оОтменаОбещания,
    sAddress,
    чНеДольше,
    сНазвание,
    лЖурнал,
    оЗаголовки = null,
    сМетод = "GET"
  ) {
    return Загрузить(
      оОтменаОбещания,
      сМетод,
      sAddress,
      чНеДольше,
      оЗаголовки,
      null,
      сНазвание,
      лЖурнал,
      "json"
    );
  }
  function Загрузить(
    оОтменаОбещания,
    сМетод,
    sAddress,
    чНеДольше,
    оЗаголовки,
    пТело,
    сНазвание,
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
      typeof сНазвание == "string" &&
      typeof лЖурнал == "boolean"
    );
    Check(
      пТипДанных === "none" ||
      пТипДанных === "text" ||
      пТипДанных === "json" ||
      Number.isFinite(пТипДанных)
    );
    if (оОтменаОбещания && оОтменаОбещания.лОтменено) {
      return Promise.reject(ОтменаОбещания.ПРИЧИНА);
    }
    m_Log.Вот(
      `[Загрузчик] ${сМетод} ${сНазвание} не дольше ${m_Log.F0(чНеДольше)}мс`
    );
    м_Twitch.проверитьДоступностьАдреса(sAddress);
    const oRequest = new XMLHttpRequest();
    oRequest._сМетод = сМетод;
    oRequest._сАдрес = sAddress;
    oRequest._чНеДольше = чНеДольше;
    oRequest._оЗаголовки = оЗаголовки;
    oRequest._пТело = пТело;
    oRequest._сНазвание = сНазвание;
    oRequest._лЖурнал = лЖурнал;
    oRequest._пТипДанных = пТипДанных;
    oRequest._кОсталосьПопыток =
      typeof пТипДанных == "number" ? 1 : МАКС_КОЛИЧЕСТВО_ПОПЫТОК;
    oRequest._чВремяОтправкиЗапроса = performance.now();
    oRequest._чОжиданиеОтвета = NaN;
    oRequest.addEventListener("timeout", ОбработатьОшибку);
    oRequest.addEventListener("error", ОбработатьОшибку);
    oRequest.addEventListener("abort", ОбработатьОшибку);
    oRequest.addEventListener("load", ОбработатьОкончаниеЗагрузки);
    if (лЖурнал && typeof пТипДанных == "number") {
      oRequest.addEventListener("readystatechange", ОбработатьПолучениеОтвета);
    }
    return new Promise((fResolve, fReject) => {
      oRequest._фВыполнить = fResolve;
      oRequest._фОтказаться = fReject;
      if (оОтменаОбещания) {
        oRequest._оОтменаОбещания = оОтменаОбещания;
        оОтменаОбещания.ЗаменитьОбработчик(
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
      m_Log.Ой(`[Загрузчик] Повторно загружаю ${oRequest._сНазвание}`);
    }
    oRequest._кОсталосьПопыток--;
    oRequest.open(oRequest._сМетод, oRequest._сАдрес);
    oRequest.responseType =
      typeof oRequest._пТипДанных == "number" ? "arraybuffer" : "text";
    oRequest.timeout = oRequest._чНеДольше;
    if (oRequest._оЗаголовки) {
      for (let sTitle of Object.keys(oRequest._оЗаголовки)) {
        oRequest.setRequestHeader(sTitle, oRequest._оЗаголовки[sTitle]);
      }
    }
    if (oRequest._пТело instanceof URLSearchParams) {
      oRequest.setRequestHeader(
        "Content-Type",
        "application/x-www-form-urlencoded; charset=UTF-8"
      );
      oRequest.send(oRequest._пТело.toString());
    } else {
      oRequest.send(oRequest._пТело);
    }
    return true;
  }
  function ПолучитьОбработчикОтменыОбещания(oRequest) {
    return () => {
      m_Log.Вот(
        `[Загрузчик] Отменяю загрузку ${oRequest._сНазвание} readyState=${oRequest.readyState}`
      );
      oRequest.removeEventListener("abort", ОбработатьОшибку);
      oRequest.abort();
      oRequest._фОтказаться(ОтменаОбещания.ПРИЧИНА);
    };
  }
  const ОбработатьПолучениеОтвета = AddExceptionHandler(
    ({ target: oRequest }) => {
      if (oRequest.readyState >= XMLHttpRequest.HEADERS_RECEIVED) {
        oRequest.removeEventListener(
          "readystatechange",
          ОбработатьПолучениеОтвета
        );
        Check(Number.isNaN(oRequest._чОжиданиеОтвета));
        oRequest._чОжиданиеОтвета = Math.round(
          performance.now() - oRequest._чВремяОтправкиЗапроса
        );
      }
    }
  );
  const ОбработатьОшибку = AddExceptionHandler(
    ({ target: oRequest, type: сТипСобытия }) => {
      m_Log.Ой(
        `[Загрузчик] Не удалось загрузить ${oRequest._сНазвание}. Event occurred: ${сТипСобытия}` +
        ` readyState=${oRequest.readyState}` +
        (oRequest._лЖурнал && typeof oRequest._пТипДанных == "number"
          ? ` ОжиданиеОтвета=${oRequest._чОжиданиеОтвета}мс`
          : ``)
      );
      if (сТипСобытия === "abort" || !ПослатьЗапрос(oRequest, true)) {
        if (oRequest.responseType === "arraybuffer") {
          м_Статистика.ЗагруженСегмент(NaN, NaN, NaN, oRequest._чОжиданиеОтвета);
        }
        oRequest._оОтменаОбещания &&
          oRequest._оОтменаОбещания.ЗаменитьОбработчик(null);
        oRequest._фОтказаться(`Event occurred: ${сТипСобытия}`);
      }
    }
  );
  const ОбработатьОкончаниеЗагрузки = AddExceptionHandler(
    ({ target: oRequest }) => {
      Check(oRequest.readyState === XMLHttpRequest.DONE);
      const чКод = oRequest.status;
      if (
        чКод >= 200 &&
        чКод <= 299 &&
        (oRequest._пТипДанных === "none" || oRequest.response !== null)
      ) {
        const чДлительностьЗагрузки = Math.round(
          performance.now() - oRequest._чВремяОтправкиЗапроса
        );
        oRequest._оОтменаОбещания &&
          oRequest._оОтменаОбещания.ЗаменитьОбработчик(null);
        m_Log.Вот(
          `[Загрузчик] Загрузил ${oRequest._сНазвание} за ${чДлительностьЗагрузки}мс` +
          (oRequest._лЖурнал && typeof oRequest._пТипДанных == "number"
            ? ` ОжиданиеОтвета=${oRequest._чОжиданиеОтвета}мс`
            : ``) +
          (typeof oRequest._пТипДанных == "number"
            ? ` Отношение=${m_Log.F1(
              чДлительностьЗагрузки / oRequest._пТипДанных / 1e3
            )}`
            : ``) +
          (чКод === 200 ? `` : ` Код=${чКод} ${oRequest.statusText}`) +
          (oRequest._пТипДанных === "none"
            ? ""
            : oRequest._лЖурнал && IsNonEmptyString(oRequest.response)
              ? `\n${oRequest.response}`
              : oRequest.responseType === "arraybuffer"
                ? ` Размер=${oRequest.response.byteLength}байт`
                : ` Размер=${oRequest.response.length}символов`)
        );
        if (oRequest._чНеДольше !== 0) {
          м_Статистика.СкачаноНечто(ПолучитьРазмерОтвета(oRequest));
        }
        switch (oRequest._пТипДанных) {
          case "none":
            oRequest._фВыполнить();
            break;

          case "text":
            oRequest._фВыполнить(oRequest.response);
            break;

          case "json":
            try {
              oRequest._фВыполнить(JSON.parse(oRequest.response));
            } catch (pException) {
              m_Log.Ой(
                `[Загрузчик] Не удалось разобрать ${oRequest._сНазвание}. ${pException}`
              );
              oRequest._фОтказаться("Failed to parse JSON");
            }
            break;

          default:
            м_Статистика.ЗагруженСегмент(
              oRequest.response.byteLength,
              oRequest._пТипДанных,
              чДлительностьЗагрузки,
              oRequest._чОжиданиеОтвета
            );
            oRequest._фВыполнить(oRequest.response);
        }
      } else {
        m_Log.Ой(
          `[Загрузчик] Не удалось загрузить ${oRequest._сНазвание}. ${КОД_ОТВЕТА + чКод
          } ${oRequest.statusText}` +
          (oRequest._лЖурнал && typeof oRequest._пТипДанных == "number"
            ? ` ОжиданиеОтвета=${oRequest._чОжиданиеОтвета}мс`
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
          (чКод >= 400 && чКод <= 499) ||
          oRequest.response === null ||
          !ПослатьЗапрос(oRequest, true)
        ) {
          if (oRequest.responseType === "arraybuffer") {
            м_Статистика.ЗагруженСегмент(
              NaN,
              NaN,
              NaN,
              oRequest._чОжиданиеОтвета
            );
          }
          oRequest._оОтменаОбещания &&
            oRequest._оОтменаОбещания.ЗаменитьОбработчик(null);
          oRequest._фОтказаться(КОД_ОТВЕТА + чКод);
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
  function ЗагрузитьСледующийСегмент() {
    let h = г_моОчередь.length - 1;
    if (
      h >= 0 &&
      г_моОчередь[h].пДанные === STATE_VARIANT_CHANGE &&
      г_моОчередь[h].чОбработка === PROCESSING_DOWNLOADED
    ) {
      г_моОчередь.ПоказатьСостояние();
      while (--h >= 0 && г_моОчередь[h].чОбработка <= PROCESSING_DOWNLOADED) {
        if (typeof г_моОчередь[h].пДанные != "number") {
          г_моОчередь.Удалить(h);
        }
      }
      г_моОчередь.ПоказатьСостояние();
    } else {
      let кОдновременныхЗагрузок = m_Settings.Get(
        "кОдновременныхЗагрузок"
      );
      let чДлительностьВсехЗагрузок = 0;
      for (let оСегмент of г_моОчередь) {
        if (оСегмент.чОбработка <= PROCESSING_DOWNLOADED) {
          чДлительностьВсехЗагрузок += оСегмент.чДлительность;
          if (оСегмент.чОбработка <= PROCESSING_DOWNLOADING) {
            --кОдновременныхЗагрузок;
            if (
              оСегмент.чОбработка === PROCESSING_AWAITING_DOWNLOAD &&
              кОдновременныхЗагрузок >= 0
            ) {
              ЗагрузитьСегмент(оСегмент);
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
        ЗагрузитьСледующийСегмент();
        return;
      }
    }
    м_Преобразователь.ПреобразоватьСледующийСегмент();
  }
  function ЗагрузитьСегмент(оСегмент) {
    const sAddress = оСегмент.пДанные;
    оСегмент.пДанные = new ОтменаОбещания();
    оСегмент.чОбработка = PROCESSING_DOWNLOADING;
    Загрузить(
      оСегмент.пДанные,
      "GET",
      sAddress,
      ЗагружатьСегментНеДольше(оСегмент),
      null,
      null,
      `сегмент ${оСегмент.чНомер}`,
      м_Статистика.ОкноОткрыто(),
      оСегмент.чДлительность
    )
      .then((буфДанные) => {
        Check(г_моОчередь.includes(оСегмент));
        оСегмент.пДанные = буфДанные;
        оСегмент.чОбработка = PROCESSING_DOWNLOADED;
        ЗагрузитьСледующийСегмент();
      })
      .catch(
        AddExceptionHandler((пПричина) => {
          if (
            typeof пПричина == "string" &&
            оСегмент.чОбработка === PROCESSING_DOWNLOADING
          ) {
            Check(г_моОчередь.includes(оСегмент));
            ОбработатьНеудачнуюЗагрузкуСегмента(
              пПричина.сПричина === КОД_ОТВЕТА + 404 ||
                пПричина.сПричина === КОД_ОТВЕТА + 410
                ? null
                : оСегмент
            );
            Check(!г_моОчередь.includes(оСегмент));
            ЗагрузитьСледующийСегмент();
          } else if (пПричина === ОтменаОбещания.ПРИЧИНА) {
            m_Log.Вот(
              `[Загрузчик] Отменена загрузка сегмента ${оСегмент.чНомер}`
            );
            Check(!г_моОчередь.includes(оСегмент));
          } else {
            throw пПричина;
          }
        })
      );
  }
  function ЗагружатьСегментНеДольше(оСегмент) {
    const чПеременная =
      оСегмент.чДлительность *
      m_Settings.Get("кОдновременныхЗагрузок") *
      1.15;
    const чПостоянная = 8;
    return (чПеременная + чПостоянная) * 1e3;
  }
  function ОбработатьНеудачнуюЗагрузкуСегмента(оНезагруженныйСегмент) {
    г_моОчередь.ПоказатьСостояние();
    const кВОчереди = г_моОчередь.length;
    if (оНезагруженныйСегмент) {
      г_моОчередь.Удалить(оНезагруженныйСегмент);
    } else {
      let чРазмерБуфера = m_Settings.Get("чРазмерБуфера");
      for (let оСегмент, ы = кВОчереди; (оСегмент = г_моОчередь[--ы]);) {
        if (оСегмент.чОбработка === PROCESSING_AWAITING_DOWNLOAD) {
          if (чРазмерБуфера > 0) {
            чРазмерБуфера -= оСегмент.чДлительность;
          } else {
            г_моОчередь.Удалить(ы);
          }
        } else if (оСегмент.чОбработка === PROCESSING_DOWNLOADING) {
          г_моОчередь.Удалить(ы);
        }
      }
    }
    г_моОчередь.ПоказатьСостояние();
    м_Статистика.НеЗагруженыСегменты(кВОчереди - г_моОчередь.length);
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
    Загрузить,
    ЗагрузитьТекст,
    ЗагрузитьJson,
    ЗагрузитьСледующийСегмент,
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
  function ПолучитьАдресКанала(лНеПеренаправлять) {
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
    let сРезультат = "";
    while (сРезультат.length !== кДлина) {
      сРезультат +=
        сДопустимыеСимволы[
        Math.floor(Math.random() * сДопустимыеСимволы.length)
        ];
    }
    return сРезультат;
  }
  получитьТокенGql._оОбещание = null;
  получитьТокенGql.фИзменилсяТокенGql = null;
  function получитьТокенGql() {
    const ЖДАТЬ_ПОЛУЧЕНИЯ_ТОКЕНА = 3e4;
    if (получитьТокенGql._оОбещание === null) {
      получитьТокенGql._оОбещание = new Promise((fResolve, fReject) => {
        m_Log.Окак("[Twitch] Вставляю фрейм для перехвата токена GQL");
        const элФрейм = document.createElement("iframe");
        элФрейм.src = "https://www.twitch.tv/popout/";
        элФрейм.id = "токенgql";
        элФрейм.hidden = true;
        Check(!document.getElementById(элФрейм.id));
        document.body.appendChild(элФрейм);
        const чТаймер = setTimeout(
          AddExceptionHandler(() => {
            m_Log.Ой("[Twitch] Истекло время получения токена GQL");
            элФрейм.remove();
            получитьТокенGql._оОбещание = получитьТокенGql.фИзменилсяТокенGql =
              null;
            fReject("ОТКАЗАНО_В_ДОСТУПЕ");
          }),
          ЖДАТЬ_ПОЛУЧЕНИЯ_ТОКЕНА
        );
        получитьТокенGql.фИзменилсяТокенGql = () => {
          if (_сТокенGql !== "") {
            clearTimeout(чТаймер);
            элФрейм.remove();
            получитьТокенGql._оОбещание = получитьТокенGql.фИзменилсяТокенGql =
              null;
            fResolve(_сТокенGql);
          }
        };
      });
    }
    return получитьТокенGql._оОбещание;
  }
  function отправитьЗапросGql(
    оОтменаОбещания,
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
    let оОбещание;
    if (лПосылатьТокенGql) {
      if (_сТокенGql !== "" && _чТокенGqlПротухнетПосле > Date.now()) {
        m_Log.Вот(
          `[Twitch] Токен GQL протухнет через ${m_Log.F0(
            (_чТокенGqlПротухнетПосле - Date.now()) / 1e3
          )}с`
        );
        оЗаголовкиЗапроса["Client-Integrity"] = _сТокенGql;
        оОбещание = Promise.resolve();
      } else {
        лСвежийТокен = true;
        оОбещание = получитьТокенGql().then((сТокен) => {
          оЗаголовкиЗапроса["Client-Integrity"] = сТокен;
        });
      }
    } else {
      оОбещание = Promise.resolve();
    }
    return оОбещание
      .then(() =>
        м_Загрузчик.Загрузить(
          оОтменаОбещания,
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
      .then((оРезультат) => {
        if (!оРезультат.errors) {
          return оРезультат;
        }
        let оОбещание;
        if (
          оРезультат.errors.some(
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
            оОбещание = Promise.resolve();
          } else {
            оОбещание = получитьТокенGql().then((сТокен) => {
              оЗаголовкиЗапроса["Client-Integrity"] = сТокен;
            });
          }
        } else if (
          оРезультат.errors.some(({ message }) => message === "service timeout")
        ) {
          if (!лПовторятьЗапрос) {
            m_Log.Ой("[Twitch] Сервер GQL занят");
            return оРезультат;
          }
          const повторитьЧерез =
            ПОВТОРЯТЬ_ЗАПРОС_ЧЕРЕЗ +
            (ПОВТОРЯТЬ_ЗАПРОС_ЧЕРЕЗ / 2) * Math.random();
          m_Log.Ой(
            `[Twitch] Сервер GQL занят. Запрос будет повторно отправлен через ${повторитьЧерез.toFixed()}мс`
          );
          оОбещание = Ждать(оОтменаОбещания, повторитьЧерез);
        } else {
          m_Log.Ой("[Twitch] В ответе GQL есть неизвестные ошибки");
          return оРезультат;
        }
        return оОбещание
          .then(() =>
            м_Загрузчик.Загрузить(
              оОтменаОбещания,
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
          .then((оРезультат) => {
            if (оРезультат.errors) {
              if (
                оРезультат.errors.some(
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
                оРезультат.errors.some(
                  ({ message }) => message === "service timeout"
                )
                  ? "[Twitch] Сервер GQL занят"
                  : "[Twitch] В ответе GQL есть неизвестные ошибки"
              );
            }
            return оРезультат;
          });
      });
  }
  function ИзменитьПодпискуЗрителяНаКанал(чПодписка) {
    Check(_сИдКанала && _сИдЗрителя && _сТокенЗрителя);
    Check(_сИдКанала !== _сИдЗрителя);
    switch (чПодписка) {
      case SUBSCRIPTION_NOT_SUBSCRIBED:
        неОтслеживатьКанал();
        break;

      case SUBSCRIPTION_DO_NOT_NOTIFY:
      case SUBSCRIPTION_NOTIFY:
        отслеживатьКанал(чПодписка);
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
      .then((оРезультат) => {
        if (
          оРезультат.errors ||
          !оРезультат.data ||
          !оРезультат.data.unfollowUser
        ) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-полученыметаданныезрителя", {
          чПодписка: SUBSCRIPTION_NOT_SUBSCRIBED,
        });
      })
      .catch((пПричина) => {
        if (typeof пПричина == "string") {
          m_Log.Ой(`[Twitch] Не удалось не отслеживать канал. ${пПричина}`);
          m_Notification.ShowAss();
          m_Events.SendEvent("twitch-полученыметаданныезрителя", {
            чПодписка: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(пПричина);
        }
      });
  }
  function отслеживатьКанал(чПодписка) {
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
          disableNotifications: чПодписка === SUBSCRIPTION_DO_NOT_NOTIFY,
          targetID: _сИдКанала,
        },
      },
      true,
      true,
      true,
      "отслеживать канал"
    )
      .then((оРезультат) => {
        if (
          оРезультат.errors ||
          !оРезультат.data ||
          !оРезультат.data.followUser ||
          !оРезультат.data.followUser.follow ||
          !оРезультат.data.followUser.follow.user ||
          оРезультат.data.followUser.error
        ) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-полученыметаданныезрителя", {
          чПодписка,
        });
      })
      .catch((пПричина) => {
        if (typeof пПричина == "string") {
          m_Log.Ой(`[Twitch] Не удалось отслеживать канал. ${пПричина}`);
          m_Notification.ShowAss();
          m_Events.SendEvent("twitch-полученыметаданныезрителя", {
            чПодписка: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(пПричина);
        }
      });
  }
  function этоРекламныйСегмент(сИмяСегмента) {
    return сИмяСегмента !== "" && сИмяСегмента !== "live";
  }
  let _оНужноОтправить = null;
  function отправитьДанныеСлеженияЗаРекламой(оСписокСегментов) {
    if (
      _оНужноОтправить !== null &&
      (оСписокСегментов === null ||
        _оНужноОтправить.сТокенРекламы !== оСписокСегментов.сТокенРекламы)
    ) {
      отправитьПросмотрРекламногоБлока(_оНужноОтправить);
      _оНужноОтправить = null;
    }
    if (
      _оНужноОтправить === null &&
      оСписокСегментов !== null &&
      оСписокСегментов.сТипРекламы
    ) {
      _оНужноОтправить = оСписокСегментов;
    }
  }
  function отправитьПросмотрРекламногоБлока(оСписокСегментов) {
    Ждать(null, 3e3)
      .then(() => {
        return отправитьЗапросGql(
          null,
          combineGqlRequests([
            создатьСобытиеРекламы("video_ad_impression", оСписокСегментов),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              оСписокСегментов,
              1
            ),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              оСписокСегментов,
              2
            ),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              оСписокСегментов,
              3
            ),
            создатьСобытиеРекламы(
              "video_ad_quartile_complete",
              оСписокСегментов,
              4
            ),
            создатьСобытиеРекламы("video_ad_pod_complete", оСписокСегментов),
          ]),
          null,
          true,
          false,
          false,
          `${оСписокСегментов.сТипРекламы
          } ${оСписокСегментов.сТокенРекламы.slice(-10)}`,
          3e4
        );
      })
      .then((моРезультаты) => {
        for (const оРезультат of моРезультаты) {
          if (
            оРезультат.errors ||
            !оРезультат.data ||
            !оРезультат.data.recordAdEvent ||
            оРезультат.data.recordAdEvent.error
          ) {
            throw `Server could not complete the operation: ${m_Log.O(
              оРезультат
            )}`;
          }
        }
      })
      .catch((пПричина) => {
        if (typeof пПричина == "string") {
          m_Log.Ой(
            `[Twitch] Не удалось отправить данные слежения за рекламой. ${пПричина}`
          );
        } else {
          m_Debug.CaughtException(пПричина);
        }
      });
  }
  function создатьСобытиеРекламы(
    сИмяСобытия,
    оСписокСегментов,
    чНомерКвартеля
  ) {
    const оДетали = {
      stitched: true,
      player_mute: true,
      player_volume: 0.5,
      visible: true,
      roll_type: оСписокСегментов.сТипРекламы.toLowerCase(),
    };
    switch (сИмяСобытия) {
      case "video_ad_quartile_complete":
        оДетали.quartile = чНомерКвартеля;

      case "video_ad_impression":
        оДетали.total_ads = оСписокСегментов.кРоликов;
        оДетали.ad_position = оСписокСегментов.чНомерРолика + 1;
        оДетали.duration = Math.round(
          оСписокСегментов.чПродолжительностьРолика
        );
        оДетали.ad_id = оСписокСегментов.сИдРолика1;
        оДетали.creative_id = оСписокСегментов.сИдРолика2;
        оДетали.line_item_id = оСписокСегментов.сИдРолика3;
        оДетали.order_id = оСписокСегментов.сИдРолика4;
        break;

      case "video_ad_pod_complete":
        оДетали.ad_session_id = оСписокСегментов.сИдРолика5;
        оДетали.format_name = оСписокСегментов.сИдРолика6;
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
          radToken: оСписокСегментов.сТокенРекламы,
        },
      }
    );
  }
  ПолучитьАбсолютныйАдресСпискаВариантов._чПротухнетПосле = -1;
  ПолучитьАбсолютныйАдресСпискаВариантов._сАдрес = "";
  function ПолучитьАбсолютныйАдресСпискаВариантов(
    оОтменаОбещания,
    лБезHttps,
    лБезРекламы
  ) {
    const ТОКЕН_ПРОТУХНЕТ_ЧЕРЕЗ = 15 * 60 * 1e3;
    if (!лБезРекламы) {
      const чПротухнетЧерез =
        ПолучитьАбсолютныйАдресСпискаВариантов._чПротухнетПосле -
        performance.now();
      if (чПротухнетЧерез > 0) {
        m_Log.Вот(
          `[Twitch] До протухания токена трансляции осталось ${m_Log.F0(
            чПротухнетЧерез / 1e3
          )}с`
        );
        return Promise.resolve(ПолучитьАбсолютныйАдресСпискаВариантов._сАдрес);
      }
    }
    return отправитьЗапросGql(
      оОтменаОбещания,
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
        playerType: лБезРекламы ? "picture-by-picture" : "site",
        disableHTTPS: лБезHttps,
      },
      true,
      false,
      true,
      `токен трансляции ${+лБезРекламы}`
    ).then((оРезультат) => {
      const сТокен = chain(
        оРезультат.data,
        "streamPlaybackAccessToken",
        "value"
      );
      const сПодпись = chain(
        оРезультат.data,
        "streamPlaybackAccessToken",
        "signature"
      );
      m_Debug.сохранитьТокенТрансляции(
        `ИдУстройства=${_сИдУстройства} ТокенЗрителя=${Boolean(
          _сТокенЗрителя
        )}\n${сТокен}`,
        лБезРекламы
      );
      if (!IsNonEmptyString(сТокен) || !IsNonEmptyString(сПодпись)) {
        if (оРезультат.errors) {
          throw "Server could not complete the operation";
        }
        m_Debug.FinishWorkAndShowMessage("J0203");
      }
      const оТокен = JSON.parse(сТокен);
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
        `&token=${encodeURIComponent(сТокен)}` +
        `&sig=${encodeURIComponent(сПодпись)}`;
      if (!лБезРекламы) {
        _sPlaySessionID = создатьУникальныйИдентификатор(32);
        sAddress += `&play_session_id=${_sPlaySessionID}`;
        ПолучитьАбсолютныйАдресСпискаВариантов._сАдрес = sAddress;
        ПолучитьАбсолютныйАдресСпискаВариантов._чПротухнетПосле =
          performance.now() + ТОКЕН_ПРОТУХНЕТ_ЧЕРЕЗ;
      }
      return sAddress;
    });
  }
  function очиститьТокенGql() {
    _сТокенGql = "";
    удалитьПеченьку("tw5~gqltoken", "https://www.twitch.tv/tw5~storage/").catch(
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
        const о = JSON.parse(decodeURIComponent(сПеченька));
        Check(
          IsObject(о) &&
          IsNonEmptyString(о.id) &&
          IsNonEmptyString(о.login) &&
          IsNonEmptyString(о.authToken)
        );
        return о;
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
        const о = JSON.parse(decodeURIComponent(сПеченька));
        Check(
          IsNonEmptyString(о.сТокен) && Number.isSafeInteger(о.чПротухнетПосле)
        );
        return [о.сТокен, о.чПротухнетПосле];
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
          if (получитьТокенGql.фИзменилсяТокенGql) {
            получитьТокенGql.фИзменилсяТокенGql();
          }
        }
    }
  }
  function запустить(sChannelCode) {
    Check(IsNonEmptyString(sChannelCode));
    _сКодКанала = sChannelCode;
    return получитьВсеПеченьки("https://www.twitch.tv/tw5~storage/").then(
      (моПеченьки) => {
        for (const оПеченька of моПеченьки) {
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
      .then((оРезультат) => {
        if (!оРезультат.data) {
          throw "Server response contains no metadata";
        }
        const oUser = оРезультат.data.user;
        if (!oUser) {
          m_Debug.FinishWorkAndShowMessage("J0203");
        }
        Check(oUser.id === _сИдКанала);
        const sLanguageCode = chain(oUser.broadcastSettings, "language");
        const моКоманды = [];
        if (oUser.primaryTeam) {
          моКоманды.push({
            sAddress: получитьАдресКоманды(oUser.primaryTeam.name),
            sName: oUser.primaryTeam.displayName || oUser.primaryTeam.name,
          });
        }
        const чПодписка = !chain(oUser.self, "canFollow")
          ? SUBSCRIPTION_UNAVAILABLE
          : !oUser.self.follower
            ? SUBSCRIPTION_NOT_SUBSCRIBED
            : oUser.self.follower.disableNotifications
              ? SUBSCRIPTION_DO_NOT_NOTIFY
              : SUBSCRIPTION_NOTIFY;
        m_Events.SendEvent("twitch-полученыметаданныеканала", {
          sName: oUser.displayName || _сКодКанала,
          сАватар: oUser.profileImageURL || "player.svg#svg-missingavatar",
          сОписание: oUser.description,
          sLanguageCode: sLanguageCode && sLanguageCode !== "OTHER" ? sLanguageCode : null,
          кПодписчиков: chain(oUser.followers, "totalCount"),
          чКаналСоздан: Date.parse(oUser.createdAt),
          моКоманды,
        });
        m_Events.SendEvent("twitch-полученыметаданныезрителя", {
          sName: _сИмяЗрителя,
          чПодписка,
        });
      })
      .catch((пПричина) => {
        if (typeof пПричина == "string") {
          m_Log.Ой(
            `[Twitch] Не удалось получить метаданные канала. ${пПричина}`
          );
          m_Events.SendEvent("twitch-полученыметаданныеканала", {
            sName: _сКодКанала,
            сАватар: "player.svg#svg-missingavatar",
            sLanguageCode: null,
            кПодписчиков: null,
            чКаналСоздан: null,
          });
          m_Events.SendEvent("twitch-полученыметаданныезрителя", {
            sName: _сИмяЗрителя,
            чПодписка: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(пПричина);
        }
      });
  }
  function ОбновитьМетаданныеТрансляции(оОтменаОбещания, чЧерез) {
    Check(_сИдКанала);
    m_Log.Вот(
      `[Twitch] Загрузка метаданных трансляции начнется через ${m_Log.F0(
        чЧерез
      )}мс`
    );
    Ждать(оОтменаОбещания, чЧерез)
      .then(() => {
        return отправитьЗапросGql(
          оОтменаОбещания,
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
      .then((оРезультат) => {
        const oUser = chain(оРезультат.data, "user");
        const sChannelCode = chain(oUser, "login");
        if (sChannelCode !== _сКодКанала && IsNonEmptyString(sChannelCode)) {
          m_Log.Ой(`[Twitch] Новый код канала ${sChannelCode}`);
          location.replace(`?channel=${encodeURIComponent(sChannelCode)}`);
          return;
        }
        const oMetadata = {
          кЗрителей: chain(oUser, "stream", "viewersCount"),
        };
        const сИдТрансляции = chain(oUser, "stream", "id");
        if (_сИдТрансляции === "" && IsNonEmptyString(сИдТрансляции)) {
          m_Log.Окак(`[Twitch] Идентификатор трансляции ${сИдТрансляции}`);
          _сИдТрансляции = сИдТрансляции;
          начатьСлежениеЗаПросмотром();
          const сИдЗаписи = chain(oUser, "stream", "archiveVideo", "id");
          _сАдресЗаписи = IsNonEmptyString(сИдЗаписи)
            ? ПолучитьАдресЗаписи(сИдЗаписи)
            : "";
          const сТипТрансляции = chain(oUser, "stream", "type");
          oMetadata.сТипТрансляции =
            сТипТрансляции === "live"
              ? "прямая"
              : сТипТрансляции === "rerun"
                ? "повтор"
                : null;
        }
        if (_сИдТрансляции === "" || _сИдТрансляции === сИдТрансляции) {
          const сНазваниеТрансляции = chain(
            oUser,
            "broadcastSettings",
            "title"
          );
          if (typeof сНазваниеТрансляции == "string") {
            oMetadata.сНазваниеТрансляции =
              сНазваниеТрансляции.trim() || Текст("J0103");
          }
          oMetadata.сНазваниеИгры = chain(
            oUser,
            "broadcastSettings",
            "game",
            "displayName"
          );
          const сАдресИгры = chain(
            oUser,
            "broadcastSettings",
            "game",
            "slug"
          );
          if (сАдресИгры) {
            oMetadata.сАдресИгры = получитьАдресКатегории(сАдресИгры);
          }
          oMetadata.чДлительностьТрансляции =
            performance.now() +
            g_nExactTime -
            Date.parse(chain(oUser, "stream", "createdAt"));
        }
        m_Events.SendEvent(
          "twitch-полученыметаданныетрансляции",
          oMetadata
        );
        ОбновитьМетаданныеТрансляции(
          оОтменаОбещания,
          ИНТЕРВАЛ_ОБНОВЛЕНИЯ_МЕТАДАННЫХ_ТРАНСЛЯЦИИ
        );
      })
      .catch(
        AddExceptionHandler((пПричина) => {
          if (typeof пПричина == "string") {
            m_Log.Ой(
              `[Twitch] Не удалось загрузить метаданные трансляции. ${пПричина}`
            );
            ОбновитьМетаданныеТрансляции(
              оОтменаОбещания,
              ИНТЕРВАЛ_ОБНОВЛЕНИЯ_МЕТАДАННЫХ_ТРАНСЛЯЦИИ / 2
            );
          } else if (пПричина === ОтменаОбещания.ПРИЧИНА) {
            m_Log.Вот("[Twitch] Отменено обновление метаданных трансляции");
          } else {
            throw пПричина;
          }
        })
      );
  }
  function НачатьСборМетаданныхТрансляции() {
    ОчиститьДанныеТрансляции();
    Check(!_оОтменаОбновленияМетаданных);
    _оОтменаОбновленияМетаданных = new ОтменаОбещания();
    ОбновитьМетаданныеТрансляции(_оОтменаОбновленияМетаданных, 0);
  }
  function ЗавершитьСборМетаданныхТрансляции(лТрансляцияЗавершена) {
    if (лТрансляцияЗавершена) {
      ОчиститьДанныеТрансляции();
    }
    if (_оОтменаОбновленияМетаданных) {
      m_Log.Вот(
        `[Twitch] Отменяю цепочку обновления метаданных трансляции ТрансляцияЗавершена=${лТрансляцияЗавершена}`
      );
      _оОтменаОбновленияМетаданных.Отменить();
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
        .Загрузить(
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
        .catch((пПричина) => {
          if (typeof пПричина == "string") {
            m_Log.Ой(
              `[Twitch] Не удалось отправить данные слежения за просмотром. ${пПричина}`
            );
          } else {
            m_Debug.CaughtException(пПричина);
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
      м_Проигрыватель.ПолучитьПозициюВоспроизведенияТрансляции(false);
    if (чПозиция === -1) {
      m_Log.Вот("[Twitch] Адрес записи создан без позиции воспроизведения");
      return _сАдресЗаписи;
    }
    return `${_сАдресЗаписи}?t=${Math.floor(чПозиция / 60 / 60)}h${Math.floor(
      (чПозиция / 60) % 60
    )}m${Math.floor(чПозиция % 60)}s`;
  }
  function СоздатьКлип() {
    const чПозиция =
      м_Проигрыватель.ПолучитьПозициюВоспроизведенияТрансляции(true);
    if (_сИдТрансляции === "" || чПозиция <= 0) {
      m_Log.Ой(
        `[Twitch] Недостаточно данных для создания клипа ИдТрансляции=${_сИдТрансляции} Позиция=${чПозиция}`
      );
      m_Notification.ShowAss();
    } else {
      m_Log.Окак(
        `[Twitch] Создаю клип ИдТрансляции=${_сИдТрансляции} Позиция=${чПозиция} ИдЗрителя=${_сИдЗрителя}`
      );
      m_Notification.Показать("svg-cut", false);
      ОткрытьАдресВНовойВкладке(
        `https://clips.twitch.tv/create?${new URLSearchParams({
          broadcastID: _сИдТрансляции,
          broadcasterLogin: _сКодКанала,
          offsetSeconds: Math.ceil(чПозиция),
        })}`
      );
    }
  }
  function ПолучитьАбсолютныйАдресСпискаСегментов(
    сАбсолютныйАдресСпискаСегментов
  ) {
    return сАбсолютныйАдресСпискаСегментов;
  }
  function сортироватьСписокВариантов(оСписокВариантов) {
    if (оСписокВариантов.сАдресСлеженияЗаПросмотром) {
      _сАдресСлеженияЗаПросмотром = оСписокВариантов.сАдресСлеженияЗаПросмотром;
    }
    return оСписокВариантов;
  }
  const обработатьСообщениеЧата = AddExceptionHandler(
    (оСообщение, оОтправитель, фОтветить) => {
      if (оСообщение.sQuery !== "ВставитьСторонниеРасширения") {
        return false;
      }
      if (
        (оОтправитель.tab ? оОтправитель.tab.id : chrome.tabs.TAB_ID_NONE) !==
        получитьТекущуюВкладку.чИдВкладки
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
          оСообщение.сСторонниеРасширения = "";
          for (let оРасширение of моРасширения) {
            if (оРасширение.enabled) {
              switch (оРасширение.id) {
                case /*! Chrome */ "ajopnjidmegmdimjlfnijceegpefgped":
                case /*! Opera  */ "deofbbdfofnmppcjbhjibgodpcdchjii":
                case /*! Edge   */ "icllegkipkooaicfmdfaloehobmglglb":
                  //! BetterTTV browser extension
                  //! https://betterttv.com/
                  //! https://chrome.google.com/webstore/detail/ajopnjidmegmdimjlfnijceegpefgped
                  оСообщение.сСторонниеРасширения += "BTTV ";
                  break;

                case /*! Chrome */ "fadndhdgpmmaapbmfcknlfgcflmmmieb":
                case /*! Opera  */ "djkpepcignmpfblhbfpmlhoindhndkdj":
                  //! FrankerFaceZ browser extension
                  //! https://www.frankerfacez.com/
                  //! https://chrome.google.com/webstore/detail/fadndhdgpmmaapbmfcknlfgcflmmmieb
                  оСообщение.сСторонниеРасширения += "FFZ ";
              }
            }
          }
          m_Log.Вот(
            `[Twitch] Посылаю ответ на вставку сторонних расширений: ${оСообщение.сСторонниеРасширения}`
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
    отправитьДанныеСлеженияЗаРекламой,
    ПолучитьАбсолютныйАдресСпискаВариантов,
    ПолучитьАбсолютныйАдресСпискаСегментов,
    ПолучитьАдресКанала,
    проверитьДоступностьАдреса,
    НачатьСборМетаданныхТрансляции,
    ЗавершитьСборМетаданныхТрансляции,
    ИзменитьПодпискуЗрителяНаКанал,
    ПолучитьАдресЗаписиДляТекущейПозиции,
    СоздатьКлип,
    сортироватьСписокВариантов,
    открытьЧат,
    закрытьЧат,
    запустить,
  };
})();

function ЗавершитьРаботу(лБыстро) {
  try {
    g_bWorkFinished = true;
    m_Log.Окак("[Запускалка] Завершаю работу");
    window.stop();
    if (!лБыстро) {
      м_Преобразователь.Остановить();
      м_Проигрыватель.Остановить();
      м_Помойка.Сжечь();
    }
    m_Log.Окак("[Запускалка] Работа завершена");
  } catch (_) { }
}

AddExceptionHandler(() => {
  function ЭтотКаналУжеОткрыт(сКанал) {
    Check(IsNonEmptyString(сКанал));
    chrome.runtime.sendMessage(
      {
        sQuery: "ЭтотКаналУжеОткрыт",
        сКанал,
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
            `[Запускалка] В другой вкладке открыт канал ${оСообщение.сКанал}`
          );
          if (оСообщение.сКанал === сКанал) {
            фОтветить(true);
          }
        }
      })
    );
  }
  function ОбработатьВыгрузкуСтраницы(oEvent) {
    m_Log.Окак(`[Запускалка] window.on${oEvent.type}`);
    ЗавершитьРаботу(true);
  }
  function НачатьРаботу() {
    Check(!g_bWorkFinished);
    m_Log.Вот(`[Запускалка] Начало работы ${performance.now().toFixed()}мс`);
    window.addEventListener("unload", ОбработатьВыгрузкуСтраницы);
    м_Управление.Запустить();
    if (м_Проигрыватель.Запустить()) {
      м_Список.Запустить();
    } else {
      м_Управление.ОстановитьПросмотрТрансляции();
    }
    м_Статистика.Запустить();
  }
  if (window.top !== window) {
    return;
  }
  if (navigator.userAgent.includes("Gecko/")) {
    m_Debug.FinishWorkAndShowMessage("J0204");
  }
  const сКанал = (
    new URLSearchParams(location.search.slice(1)).get("channel") || "channel"
  ).toLowerCase();
  ЭтотКаналУжеОткрыт(сКанал);
  Promise.all([
    проверитьРазрешенияРасширения(),
    m_Settings.Restore(),
    получитьТекущуюВкладку(),
  ])
    .then(() => м_Twitch.запустить(сКанал))
    .then(НачатьРаботу)
    .catch(m_Debug.CaughtException);
})();
