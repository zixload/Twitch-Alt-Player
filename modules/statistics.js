"use strict";

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
  function HighlightUnwatched(nCount) {
    return (
      nCount < HIGHLIGHT_UNWATCHED_MIN ||
      nCount >=
      m_Settings.Get("nMaxBufferSize") +
      m_Settings.Get("nBufferStretch") *
      HIGHLIGHT_UNWATCHED_MAX
    );
  }
  class Analysis {
    constructor(sNodeId, nHistorySize, nPrecision) {
      Check(nHistorySize > 0 && nPrecision >= 0);
      this._nodeTable = GetNode(sNodeId);
      this._mnHistory = new Array(nHistorySize);
      this._mlHighlight = new Array(nHistorySize);
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
    GetLastNumber(nStub) {
      return this._kFilled === 0
        ? nStub
        : this._mnHistory[this._nIndex];
    }
    AddNumber(nCount, pHighlight, pHighlightAverage) {
      const HISTORY_START = 5;
      const bHighlight = Boolean(
        typeof pHighlight == "function" ? pHighlight(nCount) : pHighlight
      );
      if (this._kFilled !== 0) {
        this._nodeTable.children[HISTORY_START + this._nIndex].classList.add(
          "statistics-detailed"
        );
      }
      if (this._kFilled !== this._mnHistory.length) {
        ++this._kFilled;
      }
      if (++this._nIndex === this._mnHistory.length) {
        this._nIndex = 0;
      }
      this._mnHistory[this._nIndex] = nCount;
      this._mlHighlight[this._nIndex] = bHighlight;
      let nMinimumNumber = Infinity,
        bHighlightMinimum = false;
      let nMaximumNumber = -Infinity,
        bHighlightMaximum = false;
      let nAverageNumber = 0,
        kNumbers = 0;
      for (let idx = 0; idx < this._kFilled; ++idx) {
        if (Number.isFinite(this._mnHistory[idx])) {
          if (
            this._mnHistory[idx] < nMinimumNumber ||
            (this._mnHistory[idx] === nMinimumNumber && this._mlHighlight[idx])
          ) {
            nMinimumNumber = this._mnHistory[idx];
            bHighlightMinimum = this._mlHighlight[idx];
          }
          if (
            this._mnHistory[idx] > nMaximumNumber ||
            (this._mnHistory[idx] === nMaximumNumber && this._mlHighlight[idx])
          ) {
            nMaximumNumber = this._mnHistory[idx];
            bHighlightMaximum = this._mlHighlight[idx];
          }
          nAverageNumber += this._mnHistory[idx];
          ++kNumbers;
        }
      }
      let bHighlightAverage;
      if (kNumbers === 0) {
        nAverageNumber = NaN;
        bHighlightAverage = false;
      } else {
        nAverageNumber /= kNumbers;
        bHighlightAverage = Boolean(
          typeof pHighlightAverage == "function"
            ? pHighlightAverage(nAverageNumber)
            : pHighlightAverage
        );
      }
      UpdateValue(
        this._nodeTable.children[0],
        this._ToString(nMinimumNumber),
        bHighlightMinimum
      );
      UpdateValue(
        this._nodeTable.children[2],
        this._ToString(nAverageNumber),
        bHighlightAverage
      );
      UpdateValue(
        this._nodeTable.children[4],
        this._ToString(nMaximumNumber),
        bHighlightMaximum
      );
      UpdateValue(
        this._nodeTable.children[HISTORY_START + this._nIndex],
        this._ToString(nCount),
        bHighlight
      ).classList.remove("statistics-detailed");
      return nAverageNumber;
    }
    _Clear() {
      this._kFilled = 0;
      this._nIndex = -1;
      const nodeFragment = document.createDocumentFragment();
      nodeFragment.appendChild(document.createElement("td")).className =
        "analysis-minimum";
      nodeFragment.appendChild(document.createElement("td")).textContent = " < ";
      nodeFragment.lastChild.className = "statistics-symbol";
      nodeFragment.appendChild(document.createElement("td")).className =
        "analysis-average";
      nodeFragment.appendChild(document.createElement("td")).textContent = " < ";
      nodeFragment.lastChild.className = "statistics-symbol";
      nodeFragment.appendChild(document.createElement("td")).className =
        "analysis-maximum";
      for (let idx = this._mnHistory.length; --idx >= 0;) {
        nodeFragment.appendChild(document.createElement("td")).className =
          "analysis-history statistics-detailed";
      }
      this._nodeTable.textContent = "";
      this._nodeTable.appendChild(nodeFragment);
    }
    _ToString(nCount) {
      return Number.isFinite(nCount)
        ? nCount.toFixed(nCount < 100 ? this._nPrecision : 0)
        : " ";
    }
  }
  function UpdateValue(pElement, pValue, bHighlight) {
    const nodeElement = GetNode(pElement);
    nodeElement.classList.toggle("statistics-highlight", bHighlight);
    nodeElement.textContent = pValue;
    return nodeElement;
  }
  function GetH264ProfileName(nProfileIndication, nConstraintSetFlag) {
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
    m_Log.Oops(
      `[Statistics] Unknown H.264 profile ProfileIndication=${nProfileIndication} ConstraintSetFlag=${nConstraintSetFlag}`
    );
    return `P${nProfileIndication}C${nConstraintSetFlag}`;
  }
  function UpdateStatistics() { // function UpdateStatistics() {
    document.getElementById("statistics-viewingduration").textContent = // document.getElementById("statistics-viewingduration").textContent =
      m_i18n.SecondsToString(performance.now() / 1e3, true); // m_i18n.ConvertSecondsToString(performance.now() / 1e3, true);
    const { droppedVideoFrames, totalVideoFrames } =
      m_Player.GetDroppedFrameCount(); // m_Player.GetDroppedFramesCount();
    UpdateValue( // UpdateValue(
      "statistics-skipped", // "statistics-dropped",
      droppedVideoFrames,
      droppedVideoFrames >= HIGHLIGHT_DROPPED_FRAMES // droppedVideoFrames >= HIGHLIGHT_DROPPED_FRAMES
    ).nextElementSibling.nextElementSibling.textContent = totalVideoFrames;
    let nAwaitingDownload = 0, // let nWaitingForDownload = 0,
      nDownloading = 0, // nDownloading = 0,
      kConverted = 0, // nConvertedCount = 0,
      nConverted = 0; // nConvertedDuration = 0;
    for (let oSegment of g_maQueue) { // for (let oSegment of g_aoQueue) {
      switch (oSegment.nProcessing) { // switch (oSegment.nProcessing) {
        case PROCESSING_AWAITING_DOWNLOAD: // case PROCESSING_WAITING_FOR_DOWNLOAD:
          nAwaitingDownload += oSegment.nDuration; // nWaitingForDownload += oSegment.nDuration;
          break;

        case PROCESSING_DOWNLOADING: // case PROCESSING_DOWNLOADING:
        case PROCESSING_DOWNLOADED: // case PROCESSING_DOWNLOADED:
          nDownloading += oSegment.nDuration; // nDownloading += oSegment.nDuration;
          break;

        case PROCESSING_CONVERTED: // case PROCESSING_CONVERTED:
          kConverted++;
          nConverted += oSegment.nDuration; // nConvertedDuration += oSegment.nDuration;
          break;

        default:
          Check(false); // Check(false);
      }
    }
    const { nWatched, nUnwatched } = // const { nWatched, nNotWatched } =
      m_Player.GetBufferFill(); // m_Player.GetBufferFullness();
    let node = UpdateValue( // let node = UpdateValue(
      "statistics-queue", // "statistics-queue",
      nAwaitingDownload.toFixed(1), // nWaitingForDownload.toFixed(1),
      nAwaitingDownload > m_Settings.Get("nMaxBufferSize") // nWaitingForDownload > m_Settings.Get("nMaxBufferSize")
    );
    node = node.nextElementSibling.nextElementSibling;
    node.textContent = nDownloading.toFixed(1); // node.textContent = nDownloading.toFixed(1);
    node = node.nextElementSibling;
    UpdateValue( // UpdateValue(
      node, // node,
      nConverted.toFixed(1), // nConvertedDuration.toFixed(1),
      kConverted >= HIGHLIGHT_CONVERTED // nConvertedCount >= HIGHLIGHT_CONVERTED
    );
    node = node.nextElementSibling;
    UpdateValue( // UpdateValue(
      node, // node,
      nUnwatched.toFixed(1), // nNotWatched.toFixed(1),
      HighlightUnwatched(nUnwatched) // HighlightNotWatched(nNotWatched)
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
    _oUpdateInterval = new Analysis(
      "statistics-updateinterval",
      LIST_HISTORY_SIZE,
      1
    );
    _oSegmentsAdded = new Analysis(
      "statistics-segmentsadded",
      LIST_HISTORY_SIZE,
      0
    );
    _oSecondsAdded = new Analysis(
      "statistics-secondsadded",
      LIST_HISTORY_SIZE,
      1
    );
    _oSegmentThickness = new Analysis(
      "statistics-segmentthickness",
      DOWNLOAD_HISTORY_SIZE,
      1
    );
    _oChannelThickness = new Analysis(
      "statistics-channelthickness",
      DOWNLOAD_HISTORY_SIZE,
      1
    );
    _oResponseWait = new Analysis(
      "statistics-responsewait",
      DOWNLOAD_HISTORY_SIZE,
      1
    );
    _oUnwatched = new Analysis(
      "statistics-unwatched",
      BUFFER_HISTORY_SIZE,
      1
    );
    _nLastUpdateTime = NaN;
    GetNode("statistics-adcount").textContent = _nAdCount;
    GetNode("statistics-adfrequency").textContent = getAdFrequency();
    GetNode("statistics-source").textContent = _nInitialSegments;
    UpdateValue(
      "statistics-rejected",
      _nRejectedSegments,
      _nRejectedSegments !== 0
    );
    UpdateValue(
      "statistics-downloaderrors",
      _nDownloadErrors,
      _nDownloadErrors !== 0
    );
    UpdateValue(
      "statistics-skippedsegments",
      _nSkippedSegments,
      _nSkippedSegments !== 0
    );
    GetNode("statistics-unloadedsegments").textContent =
      _nUndownloadedSegments;
    UpdateValue(
      "statistics-videolosses",
      _nVideoLosses,
      _nVideoLosses !== 0
    );
    UpdateValue(
      "statistics-audiolosses",
      _nAudioLosses,
      _nAudioLosses !== 0
    );
    UpdateValue(
      "statistics-exhausted",
      _nBufferExhaustions,
      _nBufferExhaustions >= HIGHLIGHT_BUFFER_EXHAUSTION
    );
    UpdateValue(
      "statistics-overflowed",
      _nBufferOverflows,
      _nBufferOverflows !== 0
    ).nextElementSibling.nextElementSibling.textContent =
      _nSkippedInBuffer.toFixed(1);
    _nTimer = setInterval(
      AddExceptionHandler(UpdateStatistics),
      1e3 / STATISTICS_UPDATE_FREQUENCY
    );
    UpdateStatistics();
    m_Events.AddHandler(
      "dragger-drag-statistics",
      HandleWindowDrag
    );
    ShowElement("statistics", true);
    m_Settings.Change("bShowStatistics", true);
  }
  function CloseWindow() {
    if (!WindowOpened()) {
      return;
    }
    ShowElement("statistics", false);
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
    for (let node of document.querySelectorAll("[data-clear]")) {
      node.textContent = "";
    }
    clearInterval(_nTimer);
    _nTimer = 0;
    m_Settings.Change("bShowStatistics", false);
  }
  function HandleWindowDrag(oParameters) {
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
    if (m_Settings.Get("bShowStatistics")) {
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
    UpdateValue(
      "statistics-downloaderrors",
      (_nDownloadErrors = 0),
      false
    );
    UpdateValue(
      "statistics-skippedsegments",
      (_nSkippedSegments = 0),
      false
    );
    GetNode("statistics-unloadedsegments").textContent =
      _nUndownloadedSegments = 0;
    UpdateValue("statistics-exhausted", (_nBufferExhaustions = 0), false);
    UpdateValue(
      "statistics-overflowed",
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
      nMinimum: Math.max(17, _nMinVideoSampleDuration) / 1e3,
      nMaximum: Math.min(1e3 / 25, _nMaxVideoSampleDuration) / 1e3,
    };
  }
  function GetDataForReport() {
    return {
      VideoParameters:
        GetNode("statistics-videoresolution").textContent +
        " " +
        GetNode("statistics-videocompression").textContent,
      AudioParameters: GetNode("statistics-audiocompression").textContent,
      RejectedSegments: _nRejectedSegments,
      SkippedSegments: _nSkippedSegments,
      DownloadErrors: _nDownloadErrors,
      UnloadedSegments: _nUndownloadedSegments,
      VideoLosses: _nVideoLosses,
      AudioLosses: _nAudioLosses,
      BufferExhaustions: _nBufferExhaustions,
      EarlyBufferExhaustions: _nEarlyBufferExhaustions,
      BufferOverflows: _nBufferOverflows,
      SkippedInBuffer: _nSkippedInBuffer,
      Ads: `${_nAdCount} ${getAdFrequency()}`,
    };
  }
  function SegmentListParsed(oList) {
    _nTargetDuration = oList.nTargetDuration;
    if (WindowOpened()) {
      if (oList.moSegments.length !== 0) {
        GetNode("statistics-server").textContent = new URL(
          oList.moSegments[oList.moSegments.length - 1].sAddress
        ).host;
      }
      const nListDuration = oList.moSegments.reduce(
        (nSum, { nDuration }) => nSum + nDuration,
        0
      );
      GetNode("statistics-list").textContent = `${oList.moSegments.length
        } × ${(nListDuration / oList.moSegments.length).toFixed(
          1
        )} = ${nListDuration.toFixed(1)} − ${oList.kAdSegments}`;
      GetNode("statistics-targetduration").textContent = oList.nTargetDuration;
    }
  }
  function SegmentsQueued(kSegmentsAdded, kSecondsAdded) {
    if (WindowOpened()) {
      const nTime = performance.now();
      _oUpdateInterval.AddNumber(
        (nTime - _nLastUpdateTime) / 1e3
      );
      _nLastUpdateTime = nTime;
      _oSegmentsAdded.AddNumber(
        kSegmentsAdded,
        HighlightSegmentsAdded,
        HighlightSegmentsAdded
      );
      _oSecondsAdded.AddNumber(kSecondsAdded);
    }
  }
  function SourceSegmentReceived() {
    ++_nInitialSegments;
    if (WindowOpened()) {
      document.getElementById("statistics-source").textContent =
        _nInitialSegments;
    }
  }
  function SegmentRejected() {
    ++_nRejectedSegments;
    if (WindowOpened()) {
      UpdateValue(
        "statistics-rejected",
        _nRejectedSegments,
        true
      );
    }
  }
  function SomethingDownloaded(kbDownloaded) {
    if (Number.isFinite(kbDownloaded)) {
      _kbTotalDownloaded += kbDownloaded;
      if (WindowOpened()) {
        document.getElementById("statistics-downloaded").textContent = (
          _kbTotalDownloaded /
          1024 /
          1024
        ).toFixed();
      }
    }
  }
  function SegmentLoaded(
    nSegmentSize,
    nSegmentDuration,
    nDownloadDuration,
    nResponseWait
  ) {
    if (WindowOpened()) {
      const nAvgSegmentThickness = _oSegmentThickness.AddNumber(
        (nSegmentSize * 8) / 1e6 / nSegmentDuration
      );
      nDownloadDuration /= 1e3;
      _oChannelThickness.AddNumber(
        (nSegmentSize * 8) / 1e6 / nDownloadDuration,
        nDownloadDuration > nSegmentDuration,
        (nCount) => nCount < nAvgSegmentThickness
      );
      _oResponseWait.AddNumber(
        nResponseWait / 1e3,
        HighlightResponseWait,
        HighlightResponseWait
      );
    }
  }
  function SegmentsNotLoaded(kUnloadedSegments) {
    Check(kUnloadedSegments > 0);
    _nDownloadErrors++;
    _nUndownloadedSegments += kUnloadedSegments;
    if (WindowOpened()) {
      UpdateValue("statistics-downloaderrors", _nDownloadErrors, true);
      GetNode("statistics-unloadedsegments").textContent =
        _nUndownloadedSegments;
    }
  }
  function segmentsSkipped(kSkippedSegments) {
    Check(kSkippedSegments > 0);
    _nSkippedSegments++;
    _nUndownloadedSegments += kSkippedSegments;
    if (WindowOpened()) {
      UpdateValue(
        "statistics-skippedsegments",
        _nSkippedSegments,
        true
      );
      GetNode("statistics-unloadedsegments").textContent =
        _nUndownloadedSegments;
    }
  }
  function ConvertedSegmentReceived(oSegment) {
    const bWindowOpen = WindowOpened();
    const oData = oSegment.pData;
    if (oData.bPassthrough) {
      // fMP4 arrives already muxed, so none of the values the MPEG-TS demuxer
      // derives exist here. Report what the playlist itself declares and leave the
      // rest blank rather than printing NaN.
      if (oSegment.bDiscontinuity && bWindowOpen) {
        GetNode("statistics-videocompression").textContent = oData.bHasVideo
          ? oData.sCodecsDescription || "fMP4"
          : "—";
        GetNode("statistics-videoresolution").textContent =
          oData.sResolution || "—";
        GetNode("statistics-framerate").textContent = "";
        GetNode("statistics-audiocompression").textContent = oData.bHasAudio
          ? "fMP4"
          : "—";
        GetNode("statistics-audiobitrate").textContent = "";
        GetNode("statistics-convertedin").textContent = "—";
      }
      return;
    }
    if (oData.hasOwnProperty("mbMediaSegment")) {
      if (oSegment.bDiscontinuity) {
        if (oData.bHasVideo) {
          let sVideoCompression =
            "H.264" +
            ` ${GetH264ProfileName(
              oData.nProfileIndication,
              oData.nConstraintSetFlag
            )}` +
            ` L${(oData.nLevelIndication / 10).toFixed(1)}` +
            ` RF${oData.nMaxNumberReferenceFrames}`;
          if (oData.nRange !== -1) {
            sVideoCompression += oData.nRange === 0 ? " 16-235" : " 0-255";
          }
          if (oData.bInterlaced) {
            sVideoCompression += " interlaced";
          }
          if (oData.nFrameRate !== 0) {
            sVideoCompression += ` ${oData.nFrameRate < 0 ? "≈" : ""
              }${Math.abs(oData.nFrameRate).toFixed(2)} ${GetText("J0140")}`;
          }
          GetNode("statistics-videocompression").textContent = sVideoCompression;
          GetNode(
            "statistics-videoresolution"
          ).textContent = `${oData.nPictureWidth}x${oData.nPictureHeight}`;
        } else {
          GetNode("statistics-videocompression").textContent = "—";
          GetNode("statistics-videoresolution").textContent = "—";
        }
        GetNode("statistics-framerate").textContent = "";
        if (oData.bHasAudio) {
          GetNode("statistics-audiocompression").textContent =
            ["AAC-Main", "AAC-LC", "AAC-SSR", "AAC-LTP"][
            oData.nAudioObjectType - 1
            ] +
            ` ${oData.nSampleRate} ${GetText("J0141")}` +
            ` ${oData.nChannelCount} ${GetText("J0142")}`;
        } else {
          GetNode("statistics-audiocompression").textContent = "—";
        }
        GetNode("statistics-audiobitrate").textContent = "";
      }
      if (Number.isFinite(oData.nAvgVideoSampleDuration)) {
        _nMinVideoSampleDuration = oData.nMinVideoSampleDuration;
        _nMaxVideoSampleDuration = oData.nMaxVideoSampleDuration;
        Check(
          _nMinVideoSampleDuration <= _nMaxVideoSampleDuration
        );
        const nRelativeDeviation =
          oData.nAvgVideoSampleDuration /
          oData.nMaxVideoSampleDuration;
        const nAbsoluteDeviation =
          oData.nMaxVideoSampleDuration -
          oData.nAvgVideoSampleDuration;
        if (
          nRelativeDeviation <= HIGHLIGHT_VIDEO_LOSS_REL &&
          nAbsoluteDeviation >= HIGHLIGHT_VIDEO_LOSS_ABS
        ) {
          m_Log.Oops(
            `[Statistics] Frame duration deviation exceeded in segment ${oSegment.nNumber}` +
            ` AvgFrameDuration=${m_Log.F0(
              oData.nAvgVideoSampleDuration
            )}ms` +
            ` AbsoluteDeviation=${m_Log.F0(nAbsoluteDeviation)}ms` +
            ` RelativeDeviation=${m_Log.F2(
              nRelativeDeviation
            )}`
          );
          oData.bVideoLoss = true;
        }
        if (bWindowOpen) {
          let sDeviation = `@${(
            1e3 / oData.nAvgVideoSampleDuration
          ).toFixed(1)}`;
          if (
            oData.nMaxVideoSampleDuration -
            oData.nMinVideoSampleDuration >
            2
          ) {
            sDeviation +=
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
          UpdateValue(
            "statistics-framerate",
            sDeviation,
            nRelativeDeviation <= HIGHLIGHT_FRAME_RATE
          );
        }
      }
      if (Number.isFinite(oData.nAudioBitrate) && bWindowOpen) {
        GetNode(
          "statistics-audiobitrate"
        ).textContent = `${oData.nAudioBitrate.toFixed()} ${GetText("J0143")}`;
      }
    }
    if (IsNumber(oData.nConvertedIn) && bWindowOpen) {
      GetNode("statistics-convertedin").textContent =
        oData.nConvertedIn.toFixed();
    }
    if (oData.bRejected) {
      SegmentRejected();
    }
    if (oData.bVideoLoss) {
      ++_nVideoLosses;
      if (bWindowOpen) {
        UpdateValue("statistics-videolosses", _nVideoLosses, true);
      }
    }
    if (oData.bAudioLoss) {
      ++_nAudioLosses;
      if (bWindowOpen) {
        UpdateValue("statistics-audiolosses", _nAudioLosses, true);
      }
    }
  }
  function updateBufferFill(nUnwatched) {
    if (WindowOpened()) {
      _oUnwatched.AddNumber(
        nUnwatched,
        HighlightUnwatched,
        HighlightUnwatched
      );
    }
  }
  function PlayerBufferExhausted(bEarly) {
    ++_nBufferExhaustions;
    if (bEarly) {
      ++_nEarlyBufferExhaustions;
    }
    if (WindowOpened()) {
      UpdateValue(
        "statistics-exhausted",
        _nBufferExhaustions,
        _nBufferExhaustions >= HIGHLIGHT_BUFFER_EXHAUSTION
      );
    }
  }
  function getAdFrequency() {
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
  m_Events.AddHandler("playlist-adstart", () => {
    Check(_nAdStartTimes.length === _nAdEndTimes.length);
    _nAdCount++;
    _nAdStartTimes.push(performance.now());
    if (WindowOpened()) {
      GetNode("statistics-adcount").textContent = _nAdCount;
      GetNode("statistics-adfrequency").textContent = getAdFrequency();
    }
  });
  m_Events.AddHandler("playlist-adend", () => {
    if (_nAdStartTimes.length !== _nAdEndTimes.length) {
      if (_nAdEndTimes.length === AD_HISTORY_SIZE) {
        _nAdStartTimes.shift();
        _nAdEndTimes.shift();
      }
      _nAdEndTimes.push(performance.now());
      if (WindowOpened()) {
        GetNode("statistics-adfrequency").textContent =
          getAdFrequency();
      }
    }
  });
  m_Events.AddHandler(
    "player-bufferoverflow",
    (nSkipped) => {
      ++_nBufferOverflows;
      _nSkippedInBuffer += nSkipped;
      if (WindowOpened()) {
        UpdateValue(
          "statistics-overflowed",
          _nBufferOverflows,
          true
        ).nextElementSibling.nextElementSibling.textContent =
          _nSkippedInBuffer.toFixed(1);
      }
    }
  );
  m_Events.AddHandler(
    "controls-statechanged",
    (nState) => {
      if (nState === STATE_START) {
        ClearHistory();
      }
    }
  );
  m_Events.AddHandler(
    "playlist-broadcastvariantselected",
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
    UpdateValue,
    ClearHistory,
    GetTargetDuration,
    GetFrameDurationInSeconds,
    GetDataForReport,
    SegmentListParsed,
    SegmentsQueued,
    SourceSegmentReceived,
    SegmentRejected,
    SomethingDownloaded,
    SegmentLoaded,
    SegmentsNotLoaded,
    segmentsSkipped,
    ConvertedSegmentReceived,
    updateBufferFill,
    PlayerBufferExhausted,
  };
})();
