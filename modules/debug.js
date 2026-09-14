"use strict";

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
      oDocument.getElementById("debug-messagetext").textContent =
        sMessage;
      if (sLinkCode) {
        const elLink = oDocument.getElementById("debug-messagelink");
        elLink.textContent = GetText(sLinkCode);
        elLink.href = sLinkAddress;
      }
      ShowForm(oDocument, "debug-message", true);
    });
  }
  function ShowAndSendReport(oReport, bufSend) {
    ShowPage().then((oDocument) => {
      let nodeForm;
      if (oReport.TerminationReason === "SEND FEEDBACK") {
        nodeForm = oDocument.getElementById("debug-feedback");
      } else {
        nodeForm = oDocument.getElementById("debug-error");
        InsertFileDownloadLinks(nodeForm);
      }
      nodeForm.elements["debug-report"].value = JSON.stringify(oReport);
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

      oDocument.addEventListener("submit", (oEvent) => {
        oEvent.preventDefault();

        const REDACTED = "[removed: playback token]";
        const oReportForFile = ScrubPersonalData(
          Object.assign({}, oReport, {
            BroadcastToken: REDACTED,
            BroadcastTokenWithoutAds: REDACTED,
          })
        );

        const nodeMessage = nodeForm.elements["debug-message"];
        if (nodeMessage && nodeMessage.value) {
          oReportForFile.Message = nodeMessage.value;
        }

        WriteTextToLocalFile(
          JSON.stringify(oReportForFile, null, "\t"),
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
        m_Player.ShowState("Here", "Shutting down");
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
      TerminateAndSendReport("SEND FEEDBACK");
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
