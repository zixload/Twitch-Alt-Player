"use strict";

const m_Downloader = (() => {
  const MAX_ATTEMPTS = 2;
  function LoadText(
    oPromiseCancellation,
    sAddress,
    nNoLongerThan,
    sLabel,
    bLog,
    oHeaders = null,
    sMethod = "GET"
  ) {
    return Load(
      oPromiseCancellation,
      sMethod,
      sAddress,
      nNoLongerThan,
      oHeaders,
      null,
      sLabel,
      bLog,
      "text"
    );
  }
  function LoadJson(
    oPromiseCancellation,
    sAddress,
    nNoLongerThan,
    sLabel,
    bLog,
    oHeaders = null,
    sMethod = "GET"
  ) {
    return Load(
      oPromiseCancellation,
      sMethod,
      sAddress,
      nNoLongerThan,
      oHeaders,
      null,
      sLabel,
      bLog,
      "json"
    );
  }
  function Load(
    oPromiseCancellation,
    sMethod,
    sAddress,
    nNoLongerThan,
    oHeaders,
    pBody,
    sLabel,
    bLog,
    pDataType
  ) {
    if (g_bWorkFinished) {
      throw void 0;
    }
    Check(
      sMethod === "GET" ||
      sMethod === "PUT" ||
      sMethod === "DELETE" ||
      sMethod === "POST"
    );
    Check(typeof sAddress == "string");
    Check(
      Number.isFinite(nNoLongerThan) && (nNoLongerThan === 0 || nNoLongerThan > 1e3)
    );
    Check(
      pBody === null ||
      (sMethod !== "GET" &&
        (pBody instanceof URLSearchParams ||
          (typeof pBody == "string" &&
            oHeaders &&
            IsNonEmptyString(oHeaders["Content-Type"]))))
    );
    Check(
      typeof oHeaders == "object" &&
      typeof sLabel == "string" &&
      typeof bLog == "boolean"
    );
    Check(
      pDataType === "none" ||
      pDataType === "text" ||
      pDataType === "json" ||
      Number.isFinite(pDataType)
    );
    if (oPromiseCancellation && oPromiseCancellation.bCancelled) {
      return Promise.reject(PromiseCancellation.REASON);
    }
    m_Log.Here(
      `[Downloader] ${sMethod} ${sLabel} no longer than ${m_Log.F0(nNoLongerThan)}ms`
    );
    m_Twitch.checkUrlAvailability(sAddress);
    const oRequest = new XMLHttpRequest();
    oRequest._sMethod = sMethod;
    oRequest._sUrl = sAddress;
    oRequest._nNoLongerThan = nNoLongerThan;
    oRequest._oHeaders = oHeaders;
    oRequest._pBody = pBody;
    oRequest._sName = sLabel;
    oRequest._bLog = bLog;
    oRequest._pDataType = pDataType;
    oRequest._kAttemptsLeft =
      typeof pDataType == "number" ? 1 : MAX_ATTEMPTS;
    oRequest._nRequestSentTime = performance.now();
    oRequest._nResponseWait = NaN;
    oRequest.addEventListener("timeout", HandleError);
    oRequest.addEventListener("error", HandleError);
    oRequest.addEventListener("abort", HandleError);
    oRequest.addEventListener("load", HandleDownloadFinished);
    if (bLog && typeof pDataType == "number") {
      oRequest.addEventListener("readystatechange", HandleResponseReceived);
    }
    return new Promise((fResolve, fReject) => {
      oRequest._fResolve = fResolve;
      oRequest._fReject = fReject;
      if (oPromiseCancellation) {
        oRequest._oPromiseCancel = oPromiseCancellation;
        oPromiseCancellation.ReplaceHandler(
          GetPromiseCancelHandler(oRequest)
        );
      }
      SendRequest(oRequest, false);
    });
  }
  function SendRequest(oRequest, bRetry) {
    if (oRequest._kAttemptsLeft === 0) {
      return false;
    }
    if (bRetry) {
      m_Log.Oops(`[Downloader] Reloading ${oRequest._sName}`);
    }
    oRequest._kAttemptsLeft--;
    oRequest.open(oRequest._sMethod, oRequest._sUrl);
    oRequest.responseType =
      typeof oRequest._pDataType == "number" ? "arraybuffer" : "text";
    oRequest.timeout = oRequest._nNoLongerThan;
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
  function GetPromiseCancelHandler(oRequest) {
    return () => {
      m_Log.Here(
        `[Downloader] Cancelling download ${oRequest._sName} readyState=${oRequest.readyState}`
      );
      oRequest.removeEventListener("abort", HandleError);
      oRequest.abort();
      oRequest._fReject(PromiseCancellation.REASON);
    };
  }
  const HandleResponseReceived = AddExceptionHandler(
    ({ target: oRequest }) => {
      if (oRequest.readyState >= XMLHttpRequest.HEADERS_RECEIVED) {
        oRequest.removeEventListener(
          "readystatechange",
          HandleResponseReceived
        );
        Check(Number.isNaN(oRequest._nResponseWait));
        oRequest._nResponseWait = Math.round(
          performance.now() - oRequest._nRequestSentTime
        );
      }
    }
  );
  const HandleError = AddExceptionHandler(
    ({ target: oRequest, type: sEventType }) => {
      m_Log.Oops(
        `[Downloader] Could not load ${oRequest._sName}. Event occurred: ${sEventType}` +
        ` readyState=${oRequest.readyState}` +
        (oRequest._bLog && typeof oRequest._pDataType == "number"
          ? ` ResponseWait=${oRequest._nResponseWait}ms`
          : ``)
      );
      if (sEventType === "abort" || !SendRequest(oRequest, true)) {
        if (oRequest.responseType === "arraybuffer") {
          m_Statistics.SegmentLoaded(NaN, NaN, NaN, oRequest._nResponseWait);
        }
        oRequest._oPromiseCancel &&
          oRequest._oPromiseCancel.ReplaceHandler(null);
        oRequest._fReject(`Event occurred: ${sEventType}`);
      }
    }
  );
  const HandleDownloadFinished = AddExceptionHandler(
    ({ target: oRequest }) => {
      Check(oRequest.readyState === XMLHttpRequest.DONE);
      const nCode = oRequest.status;
      if (
        nCode >= 200 &&
        nCode <= 299 &&
        (oRequest._pDataType === "none" || oRequest.response !== null)
      ) {
        const nDownloadDuration = Math.round(
          performance.now() - oRequest._nRequestSentTime
        );
        oRequest._oPromiseCancel &&
          oRequest._oPromiseCancel.ReplaceHandler(null);
        m_Log.Here(
          `[Downloader] Loaded ${oRequest._sName} in ${nDownloadDuration}ms` +
          (oRequest._bLog && typeof oRequest._pDataType == "number"
            ? ` ResponseWait=${oRequest._nResponseWait}ms`
            : ``) +
          (typeof oRequest._pDataType == "number"
            ? ` Ratio=${m_Log.F1(
              nDownloadDuration / oRequest._pDataType / 1e3
            )}`
            : ``) +
          (nCode === 200 ? `` : ` Code=${nCode} ${oRequest.statusText}`) +
          (oRequest._pDataType === "none"
            ? ""
            : oRequest._bLog && IsNonEmptyString(oRequest.response)
              ? `\n${oRequest.response}`
              : oRequest.responseType === "arraybuffer"
                ? ` Size=${oRequest.response.byteLength}bytes`
                : ` Size=${oRequest.response.length}characters`)
        );
        if (oRequest._nNoLongerThan !== 0) {
          m_Statistics.SomethingDownloaded(GetResponseSize(oRequest));
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
              m_Log.Oops(
                `[Downloader] Could not parse ${oRequest._sName}. ${pException}`
              );
              oRequest._fReject("Failed to parse JSON");
            }
            break;

          default:
            m_Statistics.SegmentLoaded(
              oRequest.response.byteLength,
              oRequest._pDataType,
              nDownloadDuration,
              oRequest._nResponseWait
            );
            oRequest._fResolve(oRequest.response);
        }
      } else {
        m_Log.Oops(
          `[Downloader] Could not load ${oRequest._sName}. ${RESPONSE_CODE + nCode
          } ${oRequest.statusText}` +
          (oRequest._bLog && typeof oRequest._pDataType == "number"
            ? ` ResponseWait=${oRequest._nResponseWait}ms`
            : ``) +
          (IsNonEmptyString(oRequest.response)
            ? `\n${oRequest.response}`
            : oRequest.response === null
              ? " response=null"
              : oRequest.responseType === "arraybuffer"
                ? ` Size=${oRequest.response.byteLength}bytes`
                : ` Size=${oRequest.response.length}characters`)
        );
        if (
          (nCode >= 400 && nCode <= 499) ||
          oRequest.response === null ||
          !SendRequest(oRequest, true)
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
          oRequest._fReject(RESPONSE_CODE + nCode);
        }
      }
    }
  );
  function GetResponseSize(oRequest) {
    let kbHeadersSize =
      17 + oRequest.statusText.length + oRequest.getAllResponseHeaders().length;
    if (IsHTTP2(oRequest)) {
      kbHeadersSize = Math.round(kbHeadersSize * 0.5);
    }
    let kbBodySize;
    let sTitle = oRequest.getResponseHeader("Content-Length");
    if (sTitle) {
      kbBodySize = Number.parseInt(sTitle, 10);
    } else if (oRequest.responseType === "arraybuffer") {
      kbBodySize = oRequest.response.byteLength;
    } else {
      kbBodySize = oRequest.response.length;
      sTitle = oRequest.getResponseHeader("Content-Encoding");
      if (sTitle && sTitle !== "identity") {
        kbBodySize = Math.round(kbBodySize * 0.35);
      }
    }
    return kbHeadersSize + kbBodySize;
  }
  function IsHTTP2(oRequest) {
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
      let nConcurrentDownloads = m_Settings.Get(
        "nConcurrentDownloads"
      );
      let nAllDownloadsDuration = 0;
      for (let oSegment of g_maQueue) {
        if (oSegment.nProcessing <= PROCESSING_DOWNLOADED) {
          nAllDownloadsDuration += oSegment.nDuration;
          if (oSegment.nProcessing <= PROCESSING_DOWNLOADING) {
            --nConcurrentDownloads;
            if (
              oSegment.nProcessing === PROCESSING_AWAITING_DOWNLOAD &&
              nConcurrentDownloads >= 0
            ) {
              LoadSegment(oSegment);
            }
          }
        }
      }
      const nQueueOverflow =
        m_Settings.Get("nMaxBufferSize") +
        m_Settings.Get("nBufferStretch");
      if (nAllDownloadsDuration > nQueueOverflow) {
        m_Log.Oops(
          `[Downloader] Duration of all downloads in the queue ${m_Log.F1(
            nAllDownloadsDuration
          )}s > ${m_Log.F1(nQueueOverflow)}s`
        );
        HandleFailedSegmentDownload(null);
        LoadNextSegment();
        return;
      }
    }
    m_Transcoder.ConvertNextSegment();
  }
  function LoadSegment(oSegment) {
    const sAddress = oSegment.pData;
    oSegment.pData = new PromiseCancellation();
    oSegment.nProcessing = PROCESSING_DOWNLOADING;
    Load(
      oSegment.pData,
      "GET",
      sAddress,
      LoadSegmentNoLongerThan(oSegment),
      null,
      null,
      `segment ${oSegment.nNumber}`,
      m_Statistics.WindowOpened(),
      oSegment.nDuration
    )
      .then((bufData) => {
        Check(g_maQueue.includes(oSegment));
        oSegment.pData = bufData;
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
            HandleFailedSegmentDownload(
              pReason.sReason === RESPONSE_CODE + 404 ||
                pReason.sReason === RESPONSE_CODE + 410
                ? null
                : oSegment
            );
            Check(!g_maQueue.includes(oSegment));
            LoadNextSegment();
          } else if (pReason === PromiseCancellation.REASON) {
            m_Log.Here(
              `[Downloader] Segment download cancelled ${oSegment.nNumber}`
            );
            Check(!g_maQueue.includes(oSegment));
          } else {
            throw pReason;
          }
        })
      );
  }
  function LoadSegmentNoLongerThan(oSegment) {
    const nVariable =
      oSegment.nDuration *
      m_Settings.Get("nConcurrentDownloads") *
      1.15;
    const nConstant = 8;
    return (nVariable + nConstant) * 1e3;
  }
  function HandleFailedSegmentDownload(oUnloadedSegment) {
    g_maQueue.ShowState();
    const kInQueue = g_maQueue.length;
    if (oUnloadedSegment) {
      g_maQueue.Remove(oUnloadedSegment);
    } else {
      let nBufferSize = m_Settings.Get("nBufferSize");
      for (let oSegment, idx = kInQueue; (oSegment = g_maQueue[--idx]);) {
        if (oSegment.nProcessing === PROCESSING_AWAITING_DOWNLOAD) {
          if (nBufferSize > 0) {
            nBufferSize -= oSegment.nDuration;
          } else {
            g_maQueue.Remove(idx);
          }
        } else if (oSegment.nProcessing === PROCESSING_DOWNLOADING) {
          g_maQueue.Remove(idx);
        }
      }
    }
    g_maQueue.ShowState();
    m_Statistics.SegmentsNotLoaded(kInQueue - g_maQueue.length);
  }
  const handleNetworkChange = AddExceptionHandler((oEvent) => {
    m_Log.Oops(
      `[Downloader] Event ${oEvent.type} navigator.onLine=${navigator.onLine
      } connection.type=${navigator.connection && navigator.connection.type}`
    );
  });
  if (navigator.connection) {
    navigator.connection.addEventListener(
      "onchange" in navigator.connection ? "change" : "typechange",
      handleNetworkChange
    );
  } else {
    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);
  }
  if (!navigator.onLine) {
    m_Log.Oops("[Downloader] navigator.onLine=false");
  }
  return {
    Load,
    LoadText,
    LoadJson,
    LoadNextSegment,
  };
})();
