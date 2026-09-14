"use strict";
/*
	How the player dies, and what it says when it does.

	Three ways out, and they differ by what the viewer can do about it:
	  - **a message**: the player knows why it stopped and there is nothing to report — a browser too
	    old, an encrypted broadcast, the same channel already open in another tab. A translation key,
	    optionally a link, and that is all;
	  - **a report**: something went wrong that nobody expected. The page is replaced by a form
	    holding everything a diagnosis needs;
	  - **feedback**: the viewer asked to write to us. Same form, same contents, minus the crash.

	All three end the player first. They also throw, deliberately, so the code that called them stops
	where it stands instead of carrying on into a player that is no longer running.

	**The page is dismantled before it is replaced.** Stylesheets removed, classes and inline styles
	stripped from the root and the body, then a full-window iframe with its own document. Half of the
	player's stylesheet applied to a report form makes it unreadable, and the report is the last
	thing the viewer sees — it has to be legible.

	**What leaves the machine is nobody's business but the viewer's.** The Twitch playback token
	carries their public IP address, their account id and their device id. Dropping the two token
	fields is not enough: the token is echoed back inside the log as well, wrapped in another JSON
	string where its quotes are backslash-escaped. So the whole report is walked, both forms are
	matched, and what is left says `[removed]` rather than vanishing — a reader has to be able to
	tell a scrubbed field from a missing one.

	Nothing is uploaded. The report used to be POSTed to the original author's shared hosting over
	plain HTTP; that is gone, along with the progress bar and the status-code handling that served
	it. The report is written to a local file, and only if the viewer presses the button.

	Long strings are cut, because a report nobody can open helps nobody: a variant list is hundreds
	of kilobytes of URLs, and only the last ten segment lists explain anything.
*/
const m_Debug = (() => {
  const MAX_REPORT_STRING_LENGTH = 15e4;
  const URL_LENGTH_IN_LIST = 100;
  const SEGMENT_LISTS_KEPT = 10;
  const REDACTED_TOKEN = "[removed: playback token]";
  const FEEDBACK_REASON = "SEND FEEDBACK";

  let _sBroadcastToken = "";
  let _sBroadcastTokenWithoutAds = "";
  let _sVariantList = "";
  const _asSegmentLists = [];

  // ------------------------------------------------------------------------------------------
  // Ce qui s'accumule en chemin, pour le jour ou ca tourne mal

  function saveBroadcastToken(sBroadcastToken, bWithoutAds) {
    const sToken = LimitStringLength(sBroadcastToken, MAX_REPORT_STRING_LENGTH);
    if (bWithoutAds) {
      _sBroadcastTokenWithoutAds = sToken;
    } else {
      _sBroadcastToken = sToken;
    }
  }

  function SaveVariantList(sVariantList) {
    _sVariantList = sVariantList;
  }

  // Un anneau de dix : trois heures de lecture en produiraient des milliers.
  function SaveSegmentList(sSegmentList) {
    if (_asSegmentLists.length === SEGMENT_LISTS_KEPT) {
      _asSegmentLists.shift();
    }
    _asSegmentLists.push(sSegmentList);
  }

  /*
    Le flux transporte et le segment converti ne sont plus joints au rapport : l'envoi qui les
    portait a ete retire, et un fichier local de plusieurs mega-octets n'aide personne. Les deux
    entrees restent parce que le chemin media les appelle a chaque segment.
  */
  function SaveTransportStream(oSegment) {}

  function SaveConvertedSegment(oSegment) {}

  // Les adresses d'une liste sont coupees une a une, puis la liste entiere.
  function CompressList(sList) {
    return LimitStringLength(
      sList.replace(/^(?:https?:\/\/|#EXT-X-TWITCH-PREFETCH:).+$/gm, (sLine) =>
        LimitStringLength(sLine, URL_LENGTH_IN_LIST)
      ),
      MAX_REPORT_STRING_LENGTH
    );
  }

  // ------------------------------------------------------------------------------------------
  // La page qui remplace le lecteur

  function ShowPage() {
    try {
      m_FullscreenMode.Disable();
    } catch (_) {}
    document.body.textContent = "";
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      node.remove();
    }
    for (const node of [document.documentElement, document.body]) {
      node.removeAttribute("class");
      node.removeAttribute("style");
      node.removeAttribute("hidden");
    }
    return new Promise((fResolve) => {
      const elFrame = document.createElement("iframe");
      elFrame.src = "report.html";
      elFrame.style.position = "fixed";
      elFrame.style.top = "0";
      elFrame.style.left = "0";
      elFrame.style.width = "100%";
      elFrame.style.height = "100%";
      elFrame.style.zIndex = "100500";
      elFrame.style.border = "0";
      elFrame.addEventListener("load", () => {
        m_i18n.TranslateDocument(elFrame.contentDocument);
        fResolve(elFrame.contentDocument);
      });
      document.body.appendChild(elFrame);
    });
  }

  /*
    Le nom du formulaire montre est aussi pose en classe sur la racine : c'est ainsi que report.css
    peint un fond different selon qu'on montre un message, une erreur ou une demande d'avis.
  */
  function ShowForm(oDocument, sFormId, bPaintBackground) {
    if (bPaintBackground) {
      oDocument.documentElement.classList.add(sFormId);
    }
    for (const elForm of oDocument.forms) {
      if (elForm.id !== sFormId) {
        ShowElement(elForm, false);
        continue;
      }
      ShowElement(elForm, true);
      const elFocus = elForm.querySelector("[autofocus]");
      if (elFocus) {
        elFocus.focus();
      }
    }
  }

  function ShowMessage(sMessage, sLinkCode, sLinkAddress) {
    ShowPage().then((oDocument) => {
      oDocument.getElementById("debug-messagetext").textContent = sMessage;
      if (sLinkCode) {
        const elLink = oDocument.getElementById("debug-messagelink");
        elLink.textContent = GetText(sLinkCode);
        elLink.href = sLinkAddress;
      }
      ShowForm(oDocument, "debug-message", true);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Ce qui ne doit pas sortir

  /*
    Le jeton est renvoye en echo dans le journal, a l'interieur d'une autre chaine JSON : ses
    guillemets y sont echappes par une barre oblique inverse. Les deux formes doivent etre prises.
  */
  const RE_PERSONAL_DATA =
    /\\?"(user_ip|user_id|device_id)\\?"\s*:\s*(?:\\?"(?:[^"\\]|\\.)*?\\?"|-?\d+|null)/g;

  function ScrubPersonalData(pValue) {
    if (typeof pValue == "string") {
      return pValue.replace(RE_PERSONAL_DATA, '"$1":"[removed]"');
    }
    if (Array.isArray(pValue)) {
      return pValue.map(ScrubPersonalData);
    }
    if (IsObject(pValue)) {
      const oScrubbed = {};
      for (const sKey of Object.keys(pValue)) {
        oScrubbed[sKey] = ScrubPersonalData(pValue[sKey]);
      }
      return oScrubbed;
    }
    return pValue;
  }

  function ReportForFile(oReport, elForm) {
    const oScrubbed = ScrubPersonalData(
      Object.assign({}, oReport, {
        BroadcastToken: REDACTED_TOKEN,
        BroadcastTokenWithoutAds: REDACTED_TOKEN,
      })
    );
    const elMessage = elForm.elements["debug-message"];
    if (elMessage && elMessage.value) {
      oScrubbed.Message = elMessage.value;
    }
    return oScrubbed;
  }

  function ShowAndSendReport(oReport) {
    ShowPage().then((oDocument) => {
      const elForm = oDocument.getElementById(
        oReport.TerminationReason === FEEDBACK_REASON
          ? "debug-feedback"
          : "debug-error"
      );
      elForm.elements["debug-report"].value = JSON.stringify(oReport);
      ShowForm(oDocument, elForm.id, true);

      // Le bouton « annuler » du formulaire recharge la page plutot que de vider les champs.
      oDocument.addEventListener("reset", (oEvent) => {
        oEvent.preventDefault();
        window.location.reload(true);
      });

      oDocument.addEventListener("submit", (oEvent) => {
        oEvent.preventDefault();
        WriteTextToLocalFile(
          JSON.stringify(ReportForFile(oReport, elForm), null, "\t"),
          "application/json",
          `tw5-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
        );
      });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Ce que la machine veut bien dire d'elle-meme

  /*
    Trois sources, de la moins fiable a la plus fiable, chacune pouvant manquer : les indications du
    navigateur, puis la memoire vue par chrome.system, puis le processeur. Chaque etage rappelle le
    suivant et tout echec se contente de ce qui a ete rassemble -- un rapport partiel vaut mieux que
    pas de rapport du tout.
  */
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
          oProcessorAndRAM.capacity = Round(oRAM.capacity / 1024 / 1024 / 1024, 1);
          oProcessorAndRAM.availableCapacity = Round(
            oRAM.availableCapacity / 1024 / 1024 / 1024,
            1
          );
          chrome.system.cpu.getInfo((oProcessor) => {
            try {
              oProcessorAndRAM.numOfProcessors = oProcessor.numOfProcessors;
              oProcessorAndRAM.modelName = oProcessor.modelName;
              oProcessorAndRAM.archName = oProcessor.archName;
            } catch (_) {}
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
    } catch (_) {}
    return undefined;
  }

  function ConnectionParameters() {
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

  function Languages() {
    try {
      return `${navigator.language} | ${navigator.languages} | ${GetText("J0103")}`;
    } catch (_) {}
    return undefined;
  }

  function DateSettings() {
    try {
      const oSettings = new Intl.DateTimeFormat().resolvedOptions();
      oSettings.timezoneOffset = new Date().getTimezoneOffset();
      return oSettings;
    } catch (_) {}
    return undefined;
  }

  function DisplayParameters() {
    return {
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
    };
  }

  function CreateShowAndSendReport(sTerminationReason) {
    SniffProcessorAndRAM((oProcessorAndRAM) => {
      ShowAndSendReport({
        TerminationReason: sTerminationReason,
        ExtensionVersion: EXTENSION_VERSION,
        Browser: navigator.userAgent,
        Time: new Date().toISOString(),
        Address: window.location.href,
        Incognito: chrome.extension.inIncognitoContext,
        // L'ecart entre l'horloge murale et l'horloge monotone depuis le chargement.
        Desync: Date.now() - performance.now() - g_nExactTime,
        FocusManager: m_FocusManager.GetState(),
        Heartbeat: m_Heartbeat.GetDataForReport(),
        Settings: m_Settings.GetDataForReport(),
        Statistics: m_Statistics.GetDataForReport(),
        Languages: Languages(),
        DateSettings: DateSettings(),
        Connection: ConnectionParameters(),
        GPU: SniffGPU(),
        ProcessorAndRAM: oProcessorAndRAM,
        TouchPoints: navigator.maxTouchPoints,
        Display: DisplayParameters(),
        BroadcastToken: _sBroadcastToken,
        BroadcastTokenWithoutAds: _sBroadcastTokenWithoutAds,
        VariantList: CompressList(_sVariantList),
        SegmentLists: _asSegmentLists.map(CompressList),
        Log: m_Log.GetDataForReport(),
      });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Les trois sorties. Toutes levent : l'appelant ne doit pas continuer dans un lecteur arrete.

  function FinishWorkAndShowMessage(sMessageCode, sLinkCode, sLinkAddress) {
    if (!g_bWorkFinished) {
      console.error(sMessageCode);
      Terminate(false);
      ShowMessage(GetText(sMessageCode), sLinkCode, sLinkAddress);
    }
    throw void 0;
  }

  /*
    Le second argument vient du fil de conversion, qui joint le segment fautif. Il n'est plus mis
    dans le rapport depuis que l'envoi a ete retire ; la signature le garde parce que l'appel, lui,
    le passe toujours.
  */
  function TerminateAndSendReport(sTerminationReason, bufSegment) {
    if (!g_bWorkFinished) {
      console.error(sTerminationReason);
      const sReason = LimitStringLength(
        String(sTerminationReason),
        MAX_REPORT_STRING_LENGTH
      );
      // Plus de memoire : rien ne garantit qu'on puisse encore batir un rapport. On se contente
      // d'un message.
      if (sReason.includes("out of memory")) {
        FinishWorkAndShowMessage("J0200");
      }
      try {
        m_Player.ShowState("Here", "Shutting down");
        g_maQueue.ShowState();
      } catch (_) {}
      Terminate(false);
      CreateShowAndSendReport(sReason);
    }
    throw void 0;
  }

  function CaughtException(pException) {
    TerminateAndSendReport(ExceptionToString(pException));
  }

  // Demande par le spectateur : rien n'a casse, donc on rattrape la levee et on rend la main.
  function TerminateAndSendFeedback() {
    try {
      TerminateAndSendReport(FEEDBACK_REASON);
    } catch (_) {}
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
