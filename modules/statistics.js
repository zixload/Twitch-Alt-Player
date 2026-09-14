"use strict";
/*
	The diagnostics panel: what the player counts, what it shows, and what it underlines.

	**Counting never stops; only writing does.** Every incident counter runs whether the panel is
	open or not, because they end up in the bug report and a viewer who hits a problem has usually
	not been watching the panel for the previous two hours. What the panel being closed saves is the
	DOM work — and that is why every display path asks first.

	**A single number means nothing.** Seven measurements keep a ring of their recent values and
	derive a minimum, an average and a maximum from it; the newest value is the one read large, the
	other three say whether it is normal. A download speed of 3 Mbit/s is fine or alarming depending
	entirely on what the last thirty were.

	**Underlining is a signal, not decoration.** It means "look at this", and every threshold here
	was chosen against something real: two segments per playlist refresh is the normal rhythm, three
	is a server catching up; a second of waiting for the first byte is a server in trouble; a buffer
	that falls under a second is about to stutter. Underline everything and nothing is underlined.

	**Restarting clears what describes the connection, never what describes the damage.** Changing
	variant or starting again resets the download counters, because they measure a link that no
	longer exists. Losses, rejections and ad counts stay: they happened, and the report needs them.

	Ad breaks are kept as fifteen start/end pairs and read as `duration <gap> duration`, with a `?`
	while one is still running. An end with no start is dropped — Twitch sends them.
*/
const m_Statistics = (() => {
  const STATISTICS_UPDATE_FREQUENCY = 3;
  const LIST_HISTORY_SIZE = 30;
  const DOWNLOAD_HISTORY_SIZE = 30;
  const BUFFER_HISTORY_SIZE = 30;
  const AD_HISTORY_SIZE = 15;

  // Les seuils de soulignement, chacun mesure contre quelque chose de reel.
  const HIGHLIGHT_RESPONSE_WAIT = 1;
  const HIGHLIGHT_CONVERTED = 2;
  const HIGHLIGHT_UNWATCHED_MIN = 1;
  const HIGHLIGHT_UNWATCHED_MAX = 0.5;
  const HIGHLIGHT_DROPPED_FRAMES = 100;
  const HIGHLIGHT_FRAME_RATE = 0.85;
  const HIGHLIGHT_VIDEO_LOSS_REL = 1 / 5;
  const HIGHLIGHT_VIDEO_LOSS_ABS = 300;
  const HIGHLIGHT_BUFFER_EXHAUSTION = 5;

  // Les bornes de duree d'image : 17 ms (59 im/s) et 40 ms (25 im/s).
  const MIN_FRAME_DURATION = 17;
  const MAX_FRAME_DURATION = 1e3 / 25;

  let _nTimer = 0;
  let _nTargetDuration = 0;
  let _nMinVideoSampleDuration = -Infinity;
  let _nMaxVideoSampleDuration = +Infinity;
  let _nLastUpdateTime = NaN;

  // Les sept mesures suivies. Elles n'existent que pendant que le panneau est ouvert.
  let _oUpdateInterval = null;
  let _oSegmentsAdded = null;
  let _oSecondsAdded = null;
  let _oSegmentThickness = null;
  let _oChannelThickness = null;
  let _oResponseWait = null;
  let _oUnwatched = null;

  // Les compteurs, eux, comptent toujours.
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
  const _anAdStartTimes = [];
  const _anAdEndTimes = [];

  // ------------------------------------------------------------------------------------------
  // Ce qui merite un soulignement

  // Une liste apporte un ou deux segments. Trois, c'est un serveur qui rattrape son retard.
  function HighlightSegmentsAdded(nCount) {
    return nCount !== 1 && nCount !== 2;
  }

  function HighlightResponseWait(nSeconds) {
    return nSeconds >= HIGHLIGHT_RESPONSE_WAIT;
  }

  /*
    Trop peu de tampon : la lecture va bafouiller. Trop : on regarde loin derriere le direct, et le
    reglage d'etirement dit de combien on accepte de deriver.
  */
  function HighlightUnwatched(nSeconds) {
    return (
      nSeconds < HIGHLIGHT_UNWATCHED_MIN ||
      nSeconds >=
        m_Settings.Get("nMaxBufferSize") +
          m_Settings.Get("nBufferStretch") * HIGHLIGHT_UNWATCHED_MAX
    );
  }

  // ------------------------------------------------------------------------------------------
  // Une mesure suivie : son historique, et ce qu'on en tire

  class Analysis {
    constructor(sNodeId, nHistorySize, nPrecision) {
      Check(nHistorySize > 0 && nPrecision >= 0);
      this._nodeTable = GetNode(sNodeId);
      this._anHistory = new Array(nHistorySize);
      this._abHighlight = new Array(nHistorySize);
      this._nPrecision = nPrecision;
      this._Build();
    }

    // Le panneau se ferme : les cases partent avec lui.
    Free() {
      this._nodeTable.textContent = "";
      this._nodeTable = null;
    }

    Clear() {
      if (this._kFilled !== 0) {
        this._Build();
      }
    }

    GetLastNumber(nStub) {
      return this._kFilled === 0 ? nStub : this._anHistory[this._nIndex];
    }

    /*
      Ajoute une valeur, fait tourner l'anneau, et recalcule les trois resumes. Rend la moyenne :
      l'epaisseur du canal s'y compare pour savoir si le telechargement suit le flux.

      pHighlight et pHighlightAverage sont un booleen ou une fonction : selon la mesure, ce qui
      merite un soulignement se decide sur la valeur, ou ne se decide pas du tout.
    */
    AddNumber(nCount, pHighlight, pHighlightAverage) {
      const HISTORY_START = 5;
      const bHighlight = Boolean(
        typeof pHighlight == "function" ? pHighlight(nCount) : pHighlight
      );
      // L'ancienne derniere case redevient une case d'historique, en petit.
      if (this._kFilled !== 0) {
        this._nodeTable.children[HISTORY_START + this._nIndex].classList.add(
          "statistics-detailed"
        );
      }
      if (this._kFilled !== this._anHistory.length) {
        ++this._kFilled;
      }
      if (++this._nIndex === this._anHistory.length) {
        this._nIndex = 0;
      }
      this._anHistory[this._nIndex] = nCount;
      this._abHighlight[this._nIndex] = bHighlight;

      let nMinimum = Infinity;
      let bHighlightMinimum = false;
      let nMaximum = -Infinity;
      let bHighlightMaximum = false;
      let nSum = 0;
      let kNumbers = 0;
      for (let idx = 0; idx < this._kFilled; ++idx) {
        const nValue = this._anHistory[idx];
        if (!Number.isFinite(nValue)) {
          continue;
        }
        // A egalite, la valeur soulignee l'emporte : c'est elle qu'il faut voir.
        if (nValue < nMinimum || (nValue === nMinimum && this._abHighlight[idx])) {
          nMinimum = nValue;
          bHighlightMinimum = this._abHighlight[idx];
        }
        if (nValue > nMaximum || (nValue === nMaximum && this._abHighlight[idx])) {
          nMaximum = nValue;
          bHighlightMaximum = this._abHighlight[idx];
        }
        nSum += nValue;
        ++kNumbers;
      }

      let nAverage = NaN;
      let bHighlightAverage = false;
      if (kNumbers !== 0) {
        nAverage = nSum / kNumbers;
        bHighlightAverage = Boolean(
          typeof pHighlightAverage == "function"
            ? pHighlightAverage(nAverage)
            : pHighlightAverage
        );
      }

      UpdateValue(this._nodeTable.children[0], this._ToString(nMinimum), bHighlightMinimum);
      UpdateValue(this._nodeTable.children[2], this._ToString(nAverage), bHighlightAverage);
      UpdateValue(this._nodeTable.children[4], this._ToString(nMaximum), bHighlightMaximum);
      UpdateValue(
        this._nodeTable.children[HISTORY_START + this._nIndex],
        this._ToString(nCount),
        bHighlight
      ).classList.remove("statistics-detailed");
      return nAverage;
    }

    // « min < moyenne < max », puis une case par valeur gardee.
    _Build() {
      this._kFilled = 0;
      this._nIndex = -1;
      const nodeFragment = document.createDocumentFragment();
      const cell = (sClass, sText) => {
        const node = nodeFragment.appendChild(document.createElement("td"));
        node.className = sClass;
        if (sText !== undefined) {
          node.textContent = sText;
        }
      };
      cell("analysis-minimum");
      cell("statistics-symbol", " < ");
      cell("analysis-average");
      cell("statistics-symbol", " < ");
      cell("analysis-maximum");
      for (let idx = this._anHistory.length; --idx >= 0; ) {
        cell("analysis-history statistics-detailed");
      }
      this._nodeTable.textContent = "";
      this._nodeTable.appendChild(nodeFragment);
    }

    // Au-dela de cent, les decimales ne disent plus rien. Rien du tout si ce n'est pas un nombre.
    _ToString(nCount) {
      return Number.isFinite(nCount)
        ? nCount.toFixed(nCount < 100 ? this._nPrecision : 0)
        : " ";
    }
  }

  function UpdateValue(pElement, pValue, bHighlight) {
    const nodeElement = GetNode(pElement);
    nodeElement.classList.toggle("statistics-highlight", bHighlight);
    nodeElement.textContent = pValue;
    return nodeElement;
  }

  // ------------------------------------------------------------------------------------------
  // Le rafraichissement, trois fois par seconde

  function UpdateStatistics() {
    GetNode("statistics-viewingduration").textContent = m_i18n.SecondsToString(
      performance.now() / 1e3,
      true
    );

    const { droppedVideoFrames, totalVideoFrames } = m_Player.GetDroppedFrameCount();
    UpdateValue(
      "statistics-skipped",
      droppedVideoFrames,
      droppedVideoFrames >= HIGHLIGHT_DROPPED_FRAMES
    ).nextElementSibling.nextElementSibling.textContent = totalVideoFrames;

    // La file, vue par etat : ce qui attend, ce qui descend, ce qui est pret a jouer.
    let nAwaitingDownload = 0;
    let nDownloading = 0;
    let kConverted = 0;
    let nConverted = 0;
    for (const oSegment of g_maQueue) {
      switch (oSegment.nProcessing) {
      case PROCESSING_AWAITING_DOWNLOAD:
        nAwaitingDownload += oSegment.nDuration;
        break;
      case PROCESSING_DOWNLOADING:
      case PROCESSING_DOWNLOADED:
        nDownloading += oSegment.nDuration;
        break;
      case PROCESSING_CONVERTED:
        kConverted++;
        nConverted += oSegment.nDuration;
        break;
      default:
        Check(false);
      }
    }

    const { nWatched, nUnwatched } = m_Player.GetBufferFill();

    /*
      Les cinq valeurs de cette ligne sont des cases voisines, separees par des symboles. Le
      balisage les met dans cet ordre et le script les suit de frere en frere : renommer un
      identifiant ne suffirait pas a casser ca, mais inserer une case si.
    */
    let node = UpdateValue(
      "statistics-queue",
      nAwaitingDownload.toFixed(1),
      nAwaitingDownload > m_Settings.Get("nMaxBufferSize")
    );
    node = node.nextElementSibling.nextElementSibling;
    node.textContent = nDownloading.toFixed(1);
    node = node.nextElementSibling;
    UpdateValue(node, nConverted.toFixed(1), kConverted >= HIGHLIGHT_CONVERTED);
    node = node.nextElementSibling;
    UpdateValue(node, nUnwatched.toFixed(1), HighlightUnwatched(nUnwatched));
    node = node.nextElementSibling.nextElementSibling;
    node.textContent = nWatched.toFixed(1);
  }

  // ------------------------------------------------------------------------------------------
  // Ouvrir, fermer, deplacer

  function WindowOpened() {
    return _nTimer !== 0;
  }

  function OpenWindow() {
    if (WindowOpened()) {
      return;
    }
    _oUpdateInterval = new Analysis("statistics-updateinterval", LIST_HISTORY_SIZE, 1);
    _oSegmentsAdded = new Analysis("statistics-segmentsadded", LIST_HISTORY_SIZE, 0);
    _oSecondsAdded = new Analysis("statistics-secondsadded", LIST_HISTORY_SIZE, 1);
    _oSegmentThickness = new Analysis("statistics-segmentthickness", DOWNLOAD_HISTORY_SIZE, 1);
    _oChannelThickness = new Analysis("statistics-channelthickness", DOWNLOAD_HISTORY_SIZE, 1);
    _oResponseWait = new Analysis("statistics-responsewait", DOWNLOAD_HISTORY_SIZE, 1);
    _oUnwatched = new Analysis("statistics-unwatched", BUFFER_HISTORY_SIZE, 1);
    _nLastUpdateTime = NaN;

    // Ce qui a ete compte pendant que le panneau etait ferme s'affiche d'un coup.
    GetNode("statistics-adcount").textContent = _nAdCount;
    GetNode("statistics-adfrequency").textContent = AdFrequency();
    GetNode("statistics-source").textContent = _nInitialSegments;
    UpdateValue("statistics-rejected", _nRejectedSegments, _nRejectedSegments !== 0);
    UpdateValue("statistics-downloaderrors", _nDownloadErrors, _nDownloadErrors !== 0);
    UpdateValue("statistics-skippedsegments", _nSkippedSegments, _nSkippedSegments !== 0);
    GetNode("statistics-unloadedsegments").textContent = _nUndownloadedSegments;
    UpdateValue("statistics-videolosses", _nVideoLosses, _nVideoLosses !== 0);
    UpdateValue("statistics-audiolosses", _nAudioLosses, _nAudioLosses !== 0);
    UpdateValue(
      "statistics-exhausted",
      _nBufferExhaustions,
      _nBufferExhaustions >= HIGHLIGHT_BUFFER_EXHAUSTION
    );
    UpdateValue(
      "statistics-overflowed",
      _nBufferOverflows,
      _nBufferOverflows !== 0
    ).nextElementSibling.nextElementSibling.textContent = _nSkippedInBuffer.toFixed(1);

    _nTimer = setInterval(
      AddExceptionHandler(UpdateStatistics),
      1e3 / STATISTICS_UPDATE_FREQUENCY
    );
    UpdateStatistics();
    m_Events.AddHandler("dragger-drag-statistics", HandleWindowDrag);
    ShowElement("statistics", true);
    m_Settings.Change("bShowStatistics", true);
  }

  function CloseWindow() {
    if (!WindowOpened()) {
      return;
    }
    ShowElement("statistics", false);
    for (const oAnalysis of [
      _oUpdateInterval,
      _oSegmentsAdded,
      _oSecondsAdded,
      _oSegmentThickness,
      _oChannelThickness,
      _oResponseWait,
      _oUnwatched,
    ]) {
      oAnalysis.Free();
    }
    _oUpdateInterval = null;
    _oSegmentsAdded = null;
    _oSecondsAdded = null;
    _oSegmentThickness = null;
    _oChannelThickness = null;
    _oResponseWait = null;
    _oUnwatched = null;
    // Les cases marquees gardent une valeur d'une session a l'autre si on ne les vide pas.
    for (const node of document.querySelectorAll("[data-clear]")) {
      node.textContent = "";
    }
    clearInterval(_nTimer);
    _nTimer = 0;
    m_Settings.Change("bShowStatistics", false);
  }

  /*
    Le panneau se deplace par deux variables de style, pas par « left » et « top » : la feuille de
    style compose ensuite comme elle veut, et la position survit a un changement de mise en page.
  */
  function HandleWindowDrag(oParameters) {
    switch (oParameters.nStep) {
    case 1: {
      const oStyle = getComputedStyle(oParameters.nodeDragging);
      oParameters._nInitialX = Number.parseInt(oStyle.left, 10);
      oParameters._nInitialY = Number.parseInt(oStyle.top, 10);
      break;
    }
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

  /*
    Ce qui decrit la liaison repart de zero ; ce qui compte des degats reste. Une variante qui
    change, c'est un autre serveur et un autre debit -- mais les pertes ont bien eu lieu.
  */
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
    _nDownloadErrors = 0;
    _nSkippedSegments = 0;
    _nUndownloadedSegments = 0;
    _nBufferExhaustions = 0;
    _nBufferOverflows = 0;
    _nSkippedInBuffer = 0;
    if (!WindowOpened()) {
      return;
    }
    UpdateValue("statistics-downloaderrors", _nDownloadErrors, false);
    UpdateValue("statistics-skippedsegments", _nSkippedSegments, false);
    GetNode("statistics-unloadedsegments").textContent = _nUndownloadedSegments;
    UpdateValue("statistics-exhausted", _nBufferExhaustions, false);
    UpdateValue(
      "statistics-overflowed",
      _nBufferOverflows,
      false
    ).nextElementSibling.nextElementSibling.textContent = _nSkippedInBuffer.toFixed(1);
  }

  // ------------------------------------------------------------------------------------------
  // Ce que le reste du lecteur vient demander

  function GetTargetDuration() {
    return _nTargetDuration;
  }

  // Bornees : un flux qui annonce mieux que 59 im/s ou moins de 25 ment, ou s'est trompe.
  function GetFrameDurationInSeconds() {
    return {
      nMinimum: Math.max(MIN_FRAME_DURATION, _nMinVideoSampleDuration) / 1e3,
      nMaximum: Math.min(MAX_FRAME_DURATION, _nMaxVideoSampleDuration) / 1e3,
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
      Ads: `${_nAdCount} ${AdFrequency()}`,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Ce que le chemin media vient signaler

  function SegmentListParsed(oList) {
    _nTargetDuration = oList.nTargetDuration;
    if (!WindowOpened()) {
      return;
    }
    if (oList.moSegments.length !== 0) {
      // Le serveur qui sert la liste : utile quand un seul noeud du reseau va mal.
      GetNode("statistics-server").textContent = new URL(
        oList.moSegments[oList.moSegments.length - 1].sAddress
      ).host;
    }
    const nListDuration = oList.moSegments.reduce(
      (nSum, { nDuration }) => nSum + nDuration,
      0
    );
    GetNode("statistics-list").textContent = `${oList.moSegments.length} × ${(
      nListDuration / oList.moSegments.length
    ).toFixed(1)} = ${nListDuration.toFixed(1)} − ${oList.kAdSegments}`;
    GetNode("statistics-targetduration").textContent = oList.nTargetDuration;
  }

  function SegmentsQueued(kSegmentsAdded, kSecondsAdded) {
    if (!WindowOpened()) {
      return;
    }
    const nTime = performance.now();
    // Le premier intervalle vaut NaN : il n'y a rien avant lui, et l'analyse l'ignore.
    _oUpdateInterval.AddNumber((nTime - _nLastUpdateTime) / 1e3);
    _nLastUpdateTime = nTime;
    _oSegmentsAdded.AddNumber(
      kSegmentsAdded,
      HighlightSegmentsAdded,
      HighlightSegmentsAdded
    );
    _oSecondsAdded.AddNumber(kSecondsAdded);
  }

  function SourceSegmentReceived() {
    ++_nInitialSegments;
    if (WindowOpened()) {
      GetNode("statistics-source").textContent = _nInitialSegments;
    }
  }

  function SegmentRejected() {
    ++_nRejectedSegments;
    if (WindowOpened()) {
      UpdateValue("statistics-rejected", _nRejectedSegments, true);
    }
  }

  function SomethingDownloaded(kbDownloaded) {
    if (!Number.isFinite(kbDownloaded)) {
      return;
    }
    _kbTotalDownloaded += kbDownloaded;
    if (WindowOpened()) {
      GetNode("statistics-downloaded").textContent = (
        _kbTotalDownloaded /
        1024 /
        1024
      ).toFixed();
    }
  }

  /*
    Deux debits, et c'est leur rapport qui parle. L'epaisseur du segment est celle du flux lui-meme ;
    celle du canal est la vitesse a laquelle on l'a recu. Recevoir moins vite que le flux ne se
    produit, c'est prendre du retard a chaque segment.
  */
  function SegmentLoaded(nSegmentSize, nSegmentDuration, nDownloadDuration, nResponseWait) {
    if (!WindowOpened()) {
      return;
    }
    const nAvgSegmentThickness = _oSegmentThickness.AddNumber(
      (nSegmentSize * 8) / 1e6 / nSegmentDuration
    );
    const nDownloadSeconds = nDownloadDuration / 1e3;
    _oChannelThickness.AddNumber(
      (nSegmentSize * 8) / 1e6 / nDownloadSeconds,
      nDownloadSeconds > nSegmentDuration,
      (nAverage) => nAverage < nAvgSegmentThickness
    );
    _oResponseWait.AddNumber(
      nResponseWait / 1e3,
      HighlightResponseWait,
      HighlightResponseWait
    );
  }

  function SegmentsNotLoaded(kUnloadedSegments) {
    Check(kUnloadedSegments > 0);
    _nDownloadErrors++;
    _nUndownloadedSegments += kUnloadedSegments;
    if (WindowOpened()) {
      UpdateValue("statistics-downloaderrors", _nDownloadErrors, true);
      GetNode("statistics-unloadedsegments").textContent = _nUndownloadedSegments;
    }
  }

  function segmentsSkipped(kSkippedSegments) {
    Check(kSkippedSegments > 0);
    _nSkippedSegments++;
    _nUndownloadedSegments += kSkippedSegments;
    if (WindowOpened()) {
      UpdateValue("statistics-skippedsegments", _nSkippedSegments, true);
      GetNode("statistics-unloadedsegments").textContent = _nUndownloadedSegments;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Ce qu'un segment converti raconte de lui-meme

  /*
    Le chemin fMP4 passe la video telle quelle : on ne l'a pas demultiplexee, donc on ne connait
    d'elle que ce que la liste annoncait. Les cases que le demultiplexeur remplissait restent vides
    plutot que de montrer une valeur d'un autre segment.
  */
  function DescribePassthroughSegment(oData) {
    GetNode("statistics-videocompression").textContent = oData.bHasVideo
      ? oData.sCodecsDescription || "fMP4"
      : "—";
    GetNode("statistics-videoresolution").textContent = oData.sResolution || "—";
    GetNode("statistics-framerate").textContent = "";
    GetNode("statistics-audiocompression").textContent = oData.bHasAudio ? "fMP4" : "—";
    GetNode("statistics-audiobitrate").textContent = "";
    GetNode("statistics-convertedin").textContent = "—";
  }

  function H264ProfileName(nProfileIndication, nConstraintSetFlag) {
    switch (nProfileIndication) {
    case 66:
      return (nConstraintSetFlag & 64) == 0 ? "Baseline" : "Constrained Baseline";
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
      return (nConstraintSetFlag & 16) == 0 ? "High 4:2:2" : "High 4:2:2 Intra";
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

  function DescribeVideo(oData) {
    if (!oData.bHasVideo) {
      GetNode("statistics-videocompression").textContent = "—";
      GetNode("statistics-videoresolution").textContent = "—";
      return;
    }
    let sDescription =
      "H.264" +
      ` ${H264ProfileName(oData.nProfileIndication, oData.nConstraintSetFlag)}` +
      ` L${(oData.nLevelIndication / 10).toFixed(1)}` +
      ` RF${oData.nMaxNumberReferenceFrames}`;
    if (oData.nRange !== -1) {
      sDescription += oData.nRange === 0 ? " 16-235" : " 0-255";
    }
    if (oData.bInterlaced) {
      sDescription += " interlaced";
    }
    if (oData.nFrameRate !== 0) {
      // Une cadence negative est une cadence deduite, pas declaree : le « ≈ » le dit.
      sDescription += ` ${oData.nFrameRate < 0 ? "≈" : ""}${Math.abs(
        oData.nFrameRate
      ).toFixed(2)} ${GetText("J0140")}`;
    }
    GetNode("statistics-videocompression").textContent = sDescription;
    GetNode(
      "statistics-videoresolution"
    ).textContent = `${oData.nPictureWidth}x${oData.nPictureHeight}`;
  }

  function DescribeAudio(oData) {
    if (!oData.bHasAudio) {
      GetNode("statistics-audiocompression").textContent = "—";
      return;
    }
    GetNode("statistics-audiocompression").textContent =
      ["AAC-Main", "AAC-LC", "AAC-SSR", "AAC-LTP"][oData.nAudioObjectType - 1] +
      ` ${oData.nSampleRate} ${GetText("J0141")}` +
      ` ${oData.nChannelCount} ${GetText("J0142")}`;
  }

  /*
    La duree des images d'un segment dit s'il manque des images. Un flux regulier a une duree
    moyenne proche de sa duree maximale ; quand la moyenne s'effondre par rapport au maximum -- au
    cinquieme, et d'au moins trois cents millisecondes en absolu --, c'est qu'une image longue cache
    des images manquantes. Le segment est alors marque, et c'est cette marque qui sera comptee plus
    bas comme une perte video.
  */
  function TrackFrameDuration(oSegment, oData, bWindowOpen) {
    if (!Number.isFinite(oData.nAvgVideoSampleDuration)) {
      return;
    }
    _nMinVideoSampleDuration = oData.nMinVideoSampleDuration;
    _nMaxVideoSampleDuration = oData.nMaxVideoSampleDuration;
    Check(_nMinVideoSampleDuration <= _nMaxVideoSampleDuration);

    const nRelativeDeviation =
      oData.nAvgVideoSampleDuration / oData.nMaxVideoSampleDuration;
    const nAbsoluteDeviation =
      oData.nMaxVideoSampleDuration - oData.nAvgVideoSampleDuration;
    if (
      nRelativeDeviation <= HIGHLIGHT_VIDEO_LOSS_REL &&
      nAbsoluteDeviation >= HIGHLIGHT_VIDEO_LOSS_ABS
    ) {
      m_Log.Oops(
        `[Statistics] Frame duration deviation exceeded in segment ${oSegment.nNumber}` +
          ` AvgFrameDuration=${m_Log.F0(oData.nAvgVideoSampleDuration)}ms` +
          ` AbsoluteDeviation=${m_Log.F0(nAbsoluteDeviation)}ms` +
          ` RelativeDeviation=${m_Log.F2(nRelativeDeviation)}`
      );
      oData.bVideoLoss = true;
    }
    if (!bWindowOpen) {
      return;
    }
    let sDeviation = `@${(1e3 / oData.nAvgVideoSampleDuration).toFixed(1)}`;
    // Deux millisecondes d'ecart sont du bruit de mesure ; au-dela, on montre de combien ca varie.
    if (oData.nMaxVideoSampleDuration - oData.nMinVideoSampleDuration > 2) {
      sDeviation +=
        ` −${(
          100 -
          (oData.nAvgVideoSampleDuration / oData.nMaxVideoSampleDuration) * 100
        ).toFixed()}%` +
        ` +${(
          (oData.nAvgVideoSampleDuration / oData.nMinVideoSampleDuration) * 100 -
          100
        ).toFixed()}%`;
    }
    UpdateValue(
      "statistics-framerate",
      sDeviation,
      nRelativeDeviation <= HIGHLIGHT_FRAME_RATE
    );
  }

  function ConvertedSegmentReceived(oSegment) {
    const bWindowOpen = WindowOpened();
    const oData = oSegment.pData;

    if (oData.bPassthrough) {
      // Les parametres ne peuvent changer qu'a une discontinuite : ailleurs, rien a redire.
      if (oSegment.bDiscontinuity && bWindowOpen) {
        DescribePassthroughSegment(oData);
      }
      return;
    }

    if (oData.hasOwnProperty("mbMediaSegment")) {
      if (oSegment.bDiscontinuity) {
        DescribeVideo(oData);
        GetNode("statistics-framerate").textContent = "";
        DescribeAudio(oData);
        GetNode("statistics-audiobitrate").textContent = "";
      }
      TrackFrameDuration(oSegment, oData, bWindowOpen);
      if (Number.isFinite(oData.nAudioBitrate) && bWindowOpen) {
        GetNode(
          "statistics-audiobitrate"
        ).textContent = `${oData.nAudioBitrate.toFixed()} ${GetText("J0143")}`;
      }
    }

    if (IsNumber(oData.nConvertedIn) && bWindowOpen) {
      GetNode("statistics-convertedin").textContent = oData.nConvertedIn.toFixed();
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
      _oUnwatched.AddNumber(nUnwatched, HighlightUnwatched, HighlightUnwatched);
    }
  }

  // Tot : le tampon s'est vide avant meme d'avoir ete rempli une fois. C'est une autre panne.
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

  // ------------------------------------------------------------------------------------------
  // Les coupures publicitaires

  // « duree <intervalle> duree <intervalle> duree », et « ? » pour celle qui court encore.
  function AdFrequency() {
    let sResult = "";
    for (let idx = 0; idx < _anAdStartTimes.length; ++idx) {
      if (idx !== 0) {
        sResult += ` <${(
          (_anAdStartTimes[idx] - _anAdEndTimes[idx - 1]) /
          1e3
        ).toFixed()}> `;
      }
      sResult +=
        idx < _anAdEndTimes.length
          ? ((_anAdEndTimes[idx] - _anAdStartTimes[idx]) / 1e3).toFixed()
          : "?";
    }
    return sResult;
  }

  m_Events.AddHandler("playlist-adstart", () => {
    Check(_anAdStartTimes.length === _anAdEndTimes.length);
    _nAdCount++;
    _anAdStartTimes.push(performance.now());
    if (WindowOpened()) {
      GetNode("statistics-adcount").textContent = _nAdCount;
      GetNode("statistics-adfrequency").textContent = AdFrequency();
    }
  });

  m_Events.AddHandler("playlist-adend", () => {
    // Une fin sans debut : Twitch en envoie. On la laisse tomber plutot que de compter a faux.
    if (_anAdStartTimes.length === _anAdEndTimes.length) {
      return;
    }
    if (_anAdEndTimes.length === AD_HISTORY_SIZE) {
      _anAdStartTimes.shift();
      _anAdEndTimes.shift();
    }
    _anAdEndTimes.push(performance.now());
    if (WindowOpened()) {
      GetNode("statistics-adfrequency").textContent = AdFrequency();
    }
  });

  m_Events.AddHandler("player-bufferoverflow", (nSkipped) => {
    ++_nBufferOverflows;
    _nSkippedInBuffer += nSkipped;
    if (WindowOpened()) {
      UpdateValue(
        "statistics-overflowed",
        _nBufferOverflows,
        true
      ).nextElementSibling.nextElementSibling.textContent = _nSkippedInBuffer.toFixed(1);
    }
  });

  // Repartir de zero, et changer de variante : deux fois la meme liaison qui disparait.
  m_Events.AddHandler("controls-statechanged", (nState) => {
    if (nState === STATE_START) {
      ClearHistory();
    }
  });

  m_Events.AddHandler("playlist-broadcastvariantselected", ([moVariants]) => {
    if (moVariants) {
      ClearHistory();
    }
  });

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
