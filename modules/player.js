"use strict";

const m_Player = (() => {
  const VIDEO_REMOVAL_INTERVAL = 10;
  const BUFFER_EXHAUSTION = (1 / 25) * 7;
  const REPLAY_AVAILABLE_IF_WATCHED = 1;
  const CHECK_SEGMENT_ADDITION = -1;
  const CHECK_PLAYBACK_START = -2;
  const CHECK_PLAYBACK = -3;
  const CHECK_PLAYBACK_STOP = -4;
  const PLAYBACK_IMPOSSIBLE = 0;
  const PLAYBACK_POSSIBLE = 1;
  const PLAYBACK_POSSIBLE_AFTER_SEEK = 2;
  let _oMediaElement;
  let _oMediaSource;
  let _oMediaSourceBuffer = null;
  let _bHasVideoTrack = false;
  let _nPlaybackStarted = 0;
  let _bAsyncOperation = false;
  let _sBufferSize = "nPlaybackStart";
  let _bWaitForBufferFill = true;
  let _nBroadcastOffset = NaN;
  let _bSeekNeeded = false;
  const _oLiveBroadcast = {
    HandleSourceOpen() {
      Check(_oMediaElement.paused);
      _nPlaybackStarted = Math.max(_nPlaybackStarted, 1);
      AddNextSegment();
    },
    HandleProgress() {
      if (!_bAsyncOperation) {
        StartPlayback(
          CheckPlaybackPosition(CHECK_SEGMENT_ADDITION)
        );
      }
    },
    HandleWaiting() { },
    HandlePlaying() {
      if (
        m_Controls.GetState() === STATE_PLAYBACK_START &&
        !_oMediaElement.paused
      ) {
        m_Controls.ChangeState(STATE_PLAYING);
      }
    },
    HandleSeeking: STUB,
    HandleSeeked: StartPlayback,
    HandleEnded() {
      ReloadPlayer(STATE_LOADING);
    },
    HandleTimeUpdate() {
      if (
        !_oMediaElement.seeking &&
        !_oMediaElement.paused &&
        !_oMediaElement.ended
      ) {
        CheckPlaybackPosition(CHECK_PLAYBACK);
      }
    },
  };
  const _oReplay = {
    bPause: true,
    HandleSourceOpen() {
      Check(_oMediaElement.paused);
      _nPlaybackStarted = Math.max(_nPlaybackStarted, 1);
    },
    HandleProgress: STUB,
    HandleWaiting: STUB,
    HandlePlaying: STUB,
    HandleSeeked: STUB,
    HandleSeeking() {
      m_Scale.SetWatched(_oMediaElement.currentTime);
    },
    HandleEnded() {
      if (!this.bPause) {
        _oMediaElement.play();
      }
    },
    HandleTimeUpdate() {
      if (!this.bPause && !_oMediaElement.seeking) {
        this.CheckPlaybackPosition(CHECK_PLAYBACK);
      }
      m_Scale.SetWatched(_oMediaElement.currentTime);
    },
    CheckPlaybackPosition(nTime) {
      Check(Number.isFinite(nTime));
      Check(
        nTime === CHECK_PLAYBACK_START ||
        nTime === CHECK_PLAYBACK ||
        nTime >= 0
      );
      const oBuffer = _oMediaElement.buffered;
      const nLastRegion = oBuffer.length - 1;
      const nCurrentTime = _oMediaElement.currentTime + 1e-4;
      let nSeekTo = nTime >= 0 ? nTime : nCurrentTime;
      let sSeekReason = "";
      for (let bStartFromBeginning = false; ;) {
        let nNeededForPlayback =
          nTime === CHECK_PLAYBACK
            ? BUFFER_EXHAUSTION
            : MIN_BUFFER_SIZE;
        for (let nRegion = 0; nRegion <= nLastRegion; ++nRegion) {
          if (nSeekTo < oBuffer.start(nRegion)) {
            nNeededForPlayback = MIN_BUFFER_SIZE;
            sSeekReason += "Jumping over gap. ";
            nSeekTo = oBuffer.start(nRegion);
          }
          if (
            oBuffer.end(nRegion) - nSeekTo >=
            nNeededForPlayback
          ) {
            break;
          }
        }
        if (this.bPause || nSeekTo < m_Scale.GetEnd()) {
          break;
        }
        if (bStartFromBeginning) {
          ShowState("Oops", `Endless seek Time=${nTime}`);
          return;
        }
        nSeekTo = m_Scale.GetStart();
        sSeekReason += "Starting from beginning. ";
        bStartFromBeginning = true;
      }
      if (nSeekTo !== nCurrentTime) {
        ShowState(
          "Wow",
          `${sSeekReason}Seeking to ${nSeekTo}`
        );
        _oMediaElement.currentTime = nSeekTo;
      }
    },
  };
  let _oBehaviour = _oLiveBroadcast;
  function ShowState(sImportance, sRecord) {
    const oBuffer =
      _oMediaSource.sourceBuffers.length !== 0
        ? _oMediaSource.sourceBuffers[0]
        : null;
    const sBufferRanges = RangesToString(
      oBuffer ? oBuffer.buffered : null
    );
    const sRanges = RangesToString(_oMediaElement.buffered);
    const bRangesEqual = sBufferRanges === sRanges;
    if (
      sImportance === "Here" &&
      ((oBuffer && oBuffer.buffered.length > 1) ||
        _oMediaElement.buffered.length > 1)
    ) {
      sImportance = "Wow";
    }
    if (_oMediaElement.error || !bRangesEqual) {
      sImportance = "Oops";
    }
    m_Log[sImportance](
      `${sRecord.charAt(0) === "[" ? "" : "[Player] "}${sRecord} •••` +
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
      (bRangesEqual
        ? ` buffered=${sRanges}`
        : ` MSE.buffered=${sBufferRanges} buffered=${sRanges}`) +
      (_oMediaElement.duration === Infinity
        ? ""
        : ` duration=${_oMediaElement.duration}`) +
      ` seekable=${RangesToString(_oMediaElement.seekable)}` +
      ` played=${RangesToString(_oMediaElement.played)}`
    );
  }
  function RangesToString(oRanges) {
    let sResult = "";
    if (oRanges && oRanges.length !== 0) {
      let nRegion = Math.max(oRanges.length - 5, 0);
      if (nRegion !== 0) {
        sResult = `[${nRegion}]`;
      }
      for (; nRegion < oRanges.length; ++nRegion) {
        if (nRegion !== 0) {
          sResult += `(${(
            oRanges.start(nRegion) - oRanges.end(nRegion - 1)
          ).toFixed(3)})`;
        }
        sResult += `${oRanges.start(nRegion)}-${oRanges.end(nRegion)}`;
      }
    }
    return sResult;
  }
  function GetBufferFill(oBuffer = _oMediaElement.buffered) {
    let nWatched = 0;
    let nUnwatched = 0;
    if (oBuffer.length !== 0) {
      const nStart = oBuffer.start(0);
      const nEnd = oBuffer.end(oBuffer.length - 1);
      const nCurrentTime = Clamp(
        _oMediaElement.currentTime,
        nStart,
        nEnd
      );
      nWatched = nCurrentTime - nStart;
      nUnwatched = nEnd - nCurrentTime;
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
  function GetBroadcastPlaybackPosition(bForClip) {
    if (Number.isNaN(_nBroadcastOffset)) {
      return -1;
    }
    WatchForErrors();
    let nPlaybackPosition = _oMediaElement.currentTime;
    if (bForClip && m_Controls.GetState() === STATE_REPEAT) {
      nPlaybackPosition = m_Scale.GetEnd();
    }
    if (!bForClip && nPlaybackPosition === 0 && _oMediaSourceBuffer !== null) {
      if (_oMediaSourceBuffer.buffered.length !== 0) {
        nPlaybackPosition = _oMediaSourceBuffer.buffered.start(0);
      }
    }
    return nPlaybackPosition === 0 ? -1 : Math.max(nPlaybackPosition + _nBroadcastOffset, 0);
  }
  function CalculateBroadcastOffset(oSegment) {
    if (
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.nBroadcastPosition)
    ) {
      const nBroadcastOffset =
        oSegment.pData.nBroadcastPosition -
        oSegment.pData.nEncodingPosition;
      m_Log[
        Math.abs(nBroadcastOffset - _nBroadcastOffset) > 2 ? "Oops" : "Here"
      ](
        `[Player] Broadcast offset: ${m_Log.F1(
          nBroadcastOffset
        )}s`
      );
      _nBroadcastOffset = nBroadcastOffset;
    }
  }
  function ShowBroadcastLatency(oSegment) {
    if (
      m_Statistics.WindowOpened() &&
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.nEncodingTime) &&
      _oMediaElement.currentTime !== 0
    ) {
      const nFetch =
        (performance.now() +
          g_nExactTime -
          oSegment.pData.nEncodingTime) /
        1e3;
      const nPlayback =
        oSegment.pData.nEncodingPosition - _oMediaElement.currentTime;
      const sLatency = `${nFetch.toFixed(1)} + ${nPlayback.toFixed(
        1
      )} = ${(nFetch + nPlayback).toFixed(1)}`;
      m_Log[nFetch > 0 && nPlayback > -0.1 ? "Here" : "Oops"](
        `[Player] Broadcast latency: ${sLatency}s`
      );
      GetNode("statistics-broadcastlatency").textContent = sLatency;
    }
  }
  function ApplyVolume() {
    _oMediaElement.volume =
      m_Settings.Get("nVolume2") / MAX_VOLUME;
    _oMediaElement.muted = m_Settings.Get("bMute");
  }
  function ReloadAndWaitForBufferFill(nNewState) {
    _bWaitForBufferFill = true;
    ReloadPlayer(nNewState);
  }
  function ReloadPlayer(nNewState) {
    ShowState("Wow", "Reloading player");
    m_Controls.ChangeState(nNewState);
    _oBehaviour = _oLiveBroadcast;
    _oMediaSourceBuffer = null;
    _bSeekNeeded = false;
    attachMediaSourceToMediaElement();
  }
  function WatchForErrors() {
    if (_oMediaElement.error) {
      m_Debug.FinishWorkAndShowMessage("J0206");
    }
  }
  const WatchMediaSourceEvents = AddExceptionHandler(
    (oEvent) => {
      WatchForErrors();
      const sRecord = `[MediaSource] ${oEvent.type}`;
      switch (oEvent.type) {
        case "sourceopen":
          ShowState("Here", sRecord);
          _oBehaviour.HandleSourceOpen();
          break;

        case "sourceended":
        case "sourceclose":
          ShowState("Here", sRecord);
          break;

        default:
          m_Log.Here(sRecord);
      }
    }
  );
  const WatchMediaElementEvents = AddExceptionHandler(
    (oEvent) => {
      WatchForErrors();
      const sRecord = `[MediaElement] ${oEvent.type}`;
      switch (oEvent.type) {
        case "loadstart":
          ShowState(
            "Here",
            `${sRecord} src=${_oMediaElement.src} currentSrc=${_oMediaElement.currentSrc}`
          );
          break;

        case "progress":
          ShowState("Here", sRecord);
          _oBehaviour.HandleProgress();
          break;

        case "abort":
          ShowState("Here", sRecord);
          break;

        case "waiting":
          ShowState("Wow", sRecord);
          _oBehaviour.HandleWaiting();
          break;

        case "playing":
          ShowState("Here", sRecord);
          _oBehaviour.HandlePlaying();
          break;

        case "seeking":
          ShowState("Here", sRecord);
          _oBehaviour.HandleSeeking();
          break;

        case "seeked":
          ShowState("Here", sRecord);
          _oBehaviour.HandleSeeked();
          break;

        case "ended":
          ShowState("Here", sRecord);
          _oBehaviour.HandleEnded();
          break;

        case "timeupdate":
          m_Log.Here(
            `${sRecord} readyState=${_oMediaElement.readyState} currentTime=${_oMediaElement.currentTime
            } Unwatched=${m_Log.F2(
              GetBufferFill().nUnwatched
            )}`
          );
          _oBehaviour.HandleTimeUpdate();
          break;

        default:
          m_Log.Here(sRecord);
      }
    }
  );
  function CheckPlaybackPosition(
    nCheckSource,
    nWillBeAdded = 0
  ) {
    const oBuffer = _oMediaElement.buffered;
    const nLastRegion = oBuffer.length - 1;
    if (nLastRegion === -1) {
      return false;
    }
    const nCurrentTime = _oMediaElement.currentTime + 1e-4;
    let nSeekTo = Math.max(nCurrentTime, oBuffer.start(0));
    let sSeekReason = "";
    const nUnwatched = oBuffer.end(nLastRegion) - nSeekTo;
    if (nCheckSource === CHECK_SEGMENT_ADDITION) {
      const nBufferSize = m_Settings.Get("nMaxBufferSize");
      const nOverflow =
        nBufferSize + m_Settings.Get("nBufferStretch");
      if (nUnwatched <= nOverflow) {
        return;
      }
      if (_nPlaybackStarted === 2) {
        m_Events.SendEvent(
          "player-bufferoverflow",
          nUnwatched - nBufferSize
        );
      }
      sSeekReason += `Player buffer overflow ${nUnwatched.toFixed(
        2
      )}s > ${nOverflow}s. `;
      nSeekTo = oBuffer.end(nLastRegion) - nBufferSize - 0.1;
    }
    if (
      nCheckSource === CHECK_PLAYBACK_START &&
      _nPlaybackStarted !== 2
    ) {
      _nPlaybackStarted = 2;
      const nOverflow =
        m_Settings.Get("nMaxBufferSize") +
        m_Statistics.GetTargetDuration() / 2;
      if (nUnwatched > nOverflow) {
        sSeekReason += `Broadcast latency exceeded ${nUnwatched.toFixed(
          2
        )}s > ${nOverflow}s. `;
        nSeekTo = oBuffer.end(nLastRegion) - nOverflow;
      }
    }
    Check(BUFFER_EXHAUSTION < MIN_BUFFER_SIZE);
    let nNeededForPlayback =
      nCheckSource === CHECK_PLAYBACK
        ? BUFFER_EXHAUSTION
        : nCheckSource === CHECK_PLAYBACK_STOP
          ? Infinity
          : MIN_BUFFER_SIZE;
    let bPlaybackPossible = _oMediaSource.readyState === "ended";
    let nToRangeEnd;
    for (let nRegion = 0; nRegion <= nLastRegion; ++nRegion) {
      if (nSeekTo < oBuffer.start(nRegion)) {
        nNeededForPlayback = MIN_BUFFER_SIZE;
        sSeekReason += "Jumping over gap. ";
        nSeekTo = oBuffer.start(nRegion);
      }
      nToRangeEnd = oBuffer.end(nRegion) - nSeekTo;
      if (nToRangeEnd >= nNeededForPlayback) {
        bPlaybackPossible = true;
        break;
      }
    }
    if (!bPlaybackPossible && !_oMediaElement.paused) {
      BufferExhausted(nToRangeEnd, nUnwatched, nWillBeAdded);
    }
    if (
      (bPlaybackPossible ||
        nCheckSource === CHECK_SEGMENT_ADDITION) &&
      (nSeekTo !== nCurrentTime || _bSeekNeeded)
    ) {
      if (nSeekTo === nCurrentTime) {
        nSeekTo = _oMediaElement.currentTime;
      }
      ShowState(
        sSeekReason ? "Oops" : "Wow",
        `${sSeekReason}Seeking to ${nSeekTo}`
      );
      _bSeekNeeded = false;
      _oMediaElement.currentTime = nSeekTo;
      return PLAYBACK_POSSIBLE_AFTER_SEEK;
    }
    return bPlaybackPossible
      ? PLAYBACK_POSSIBLE
      : PLAYBACK_IMPOSSIBLE;
  }
  function StartPlayback(nCheck) {
    if (
      _oMediaElement.seeking ||
      nCheck === PLAYBACK_POSSIBLE_AFTER_SEEK ||
      !_oMediaElement.paused ||
      _oMediaElement.ended
    ) {
      return;
    }
    if (_bWaitForBufferFill && _oMediaSource.readyState !== "ended") {
      const { nUnwatched } = GetBufferFill();
      const nBufferSize = m_Settings.Get(_sBufferSize);
      if (nUnwatched < nBufferSize) {
        m_Log.Here(
          `[Player] Unwatched in buffer ${m_Log.F3(
            nUnwatched
          )}s < ${nBufferSize}s`
        );
        return;
      }
      m_Log.Wow(
        `[Player] Unwatched in buffer ${m_Log.F3(
          nUnwatched
        )}s >= ${nBufferSize}s`
      );
    } else {
      m_Log.Wow("[Player] No need to wait for the buffer to fill");
    }
    switch (CheckPlaybackPosition(CHECK_PLAYBACK_START)) {
      case PLAYBACK_IMPOSSIBLE:
        ShowState(
          "Oops",
          `No range >= ${MIN_BUFFER_SIZE}s found to start playback`
        );
        _bWaitForBufferFill = true;
        break;

      case PLAYBACK_POSSIBLE:
        ShowState("Wow", "Playback start");
        _bWaitForBufferFill = true;
        _oMediaElement.play();
        m_Controls.ChangeState(STATE_PLAYBACK_START);
    }
  }
  function StopPlayback(nNewState) {
    if (nNewState !== void 0) {
      m_Controls.ChangeState(nNewState);
    }
    _oMediaElement.pause();
  }
  function BufferExhausted(
    nToLastRangeEnd,
    nUnwatched,
    nWillBeAdded
  ) {
    Check(_oMediaSource.readyState !== "ended");
    Check(nToLastRangeEnd < MIN_BUFFER_SIZE);
    const bEarly = nUnwatched > 1;
    m_Statistics.PlayerBufferExhausted(bEarly);
    _sBufferSize = "nMaxBufferSize";
    const nBufferSize = m_Settings.Get(_sBufferSize);
    if (
      nToLastRangeEnd + nWillBeAdded >= MIN_BUFFER_SIZE &&
      nUnwatched + nWillBeAdded >= nBufferSize
    ) {
      ShowState(
        bEarly ? "Oops" : "Wow",
        `Buffer exhausted, no stop needed WillBeAdded=${m_Log.F3(
          nWillBeAdded
        )}s ToLastRangeEnd=${m_Log.F3(
          nToLastRangeEnd
        )}s Unwatched=${m_Log.F3(
          nUnwatched
        )}s BufferSize=${nBufferSize}s`
      );
    } else {
      ShowState(
        bEarly ? "Oops" : "Wow",
        `Pausing playback to fill the buffer ToLastRangeEnd=${m_Log.F3(
          nToLastRangeEnd
        )}s Unwatched=${m_Log.F3(
          nUnwatched
        )}s BufferSize=${nBufferSize}s`
      );
      _bSeekNeeded = true;
      StopPlayback(STATE_LOADING);
    }
  }
  function EndStream(oSegment) {
    ShowState(
      "Wow",
      `Segment ${oSegment.nNumber} caused end of stream`
    );
    if (
      _oMediaElement.buffered.length === 0 ||
      (_oMediaElement.paused &&
        GetBufferFill().nUnwatched < BUFFER_EXHAUSTION + 0.1)
    ) {
      ReloadAndWaitForBufferFill(STATE_LOADING);
    } else {
      _bWaitForBufferFill =
        typeof oSegment.pData == "number" ||
        (!_oMediaElement.seeking && _oMediaElement.paused);
      _oMediaSource.endOfStream();
      StartPlayback();
    }
  }
  function RemoveWatchedVideo(oSegment) {
    const MAX_AUDIO_REPLAY_DURATION = 640;
    WatchForErrors();
    let nReplayDuration = m_Settings.Get("nReplayDuration2");
    if (nReplayDuration === AUTO_SETTING) {
      if (_bHasVideoTrack) {
        return Promise.resolve(oSegment);
      }
      nReplayDuration = MAX_AUDIO_REPLAY_DURATION;
    }
    const { nWatched } = GetBufferFill(
      _oMediaSourceBuffer.buffered
    );
    if (nWatched < nReplayDuration + VIDEO_REMOVAL_INTERVAL) {
      return Promise.resolve(oSegment);
    }
    const nRemoveUntil = _oMediaElement.currentTime - nReplayDuration;
    return new Promise((fResolve, fReject) => {
      ShowState(
        "Here",
        `Removing watched video Watched=${m_Log.F3(
          nWatched
        )}s RemoveUntil=${m_Log.F3(nRemoveUntil)}s`
      );
      _oMediaSourceBuffer.addEventListener("updateend", Removed);
      let nElapsedTime = -performance.now();
      _oMediaSourceBuffer.remove(0, nRemoveUntil);
      function Removed() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
          } else {
            nElapsedTime += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Removed);
            const { nWatched } = GetBufferFill(
              _oMediaSourceBuffer.buffered
            );
            ShowState(
              nElapsedTime > 100 || nWatched < MIN_BUFFER_SIZE
                ? "Oops"
                : "Here",
              `Watched video removed in ${m_Log.F0(
                nElapsedTime
              )}ms Watched=${m_Log.F0(nWatched)}s`
            );
            fResolve(oSegment);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function AppendInitSegment(oSegment) {
    return AppendSegment(
      oSegment,
      oSegment.pData.mbInitializationSegment,
      "initialisation segment"
    );
  }
  function AppendMediaSegment(oSegment) {
    return AppendSegment(
      oSegment,
      oSegment.pData.mbMediaSegment,
      "mediasegment"
    );
  }
  function AppendSegment(oSegment, mbAppend, sAppend) {
    WatchForErrors();
    return new Promise((fResolve, fReject) => {
      ShowState("Here", `Appending ${sAppend} ${oSegment.nNumber}`);
      _oMediaSourceBuffer.addEventListener("updateend", Appended);
      let nElapsedTime = -performance.now();
      _oMediaSourceBuffer.appendBuffer(mbAppend);
      function Appended() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
          } else {
            nElapsedTime += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Appended);
            ShowState(
              nElapsedTime > 100 ? "Oops" : "Here",
              `Appended ${sAppend} ${oSegment.nNumber} in ${m_Log.F0(
                nElapsedTime
              )}ms`
            );
            fResolve(oSegment);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function CheckBufferExhaustion(oSegment) {
    if (
      !_oMediaElement.seeking &&
      !_oMediaElement.paused &&
      !_oMediaElement.ended
    ) {
      CheckPlaybackPosition(
        CHECK_PLAYBACK,
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
  function SegmentWasAppended(oSegment) {
    _bAsyncOperation = false;
    g_maQueue.Remove(oSegment);
    CalculateBroadcastOffset(oSegment);
    if (!(g_maQueue[0] && g_maQueue[0].pData === STATE_REPEAT)) {
      const nCheck = CheckPlaybackPosition(
        CHECK_SEGMENT_ADDITION
      );
      if (
        !(
          g_maQueue[0] && g_maQueue[0].nProcessing === PROCESSING_CONVERTED
        )
      ) {
        StartPlayback(nCheck);
        ShowBroadcastLatency(oSegment);
      }
    }
    AddNextSegment();
  }
  const SegmentWasNotAppended = AddExceptionHandler((pReason) => {
    _bAsyncOperation = false;
    if (pReason === PromiseCancellation.REASON) {
      m_Log.Here("[Player] Segment append cancelled");
    } else {
      throw pReason;
    }
  });
  function PreventQueueOverflow() {
    const { nDuration } = g_maQueue.CountConvertedSegments();
    if (nDuration >= BUFFER_OVERFLOW) {
      m_Log.Oops(
        `[Player] MediaSource closed for too long ${nDuration}s >= ${BUFFER_OVERFLOW}s`
      );
      Check(
        m_Controls.GetState() === STATE_START ||
        m_Controls.GetState() === STATE_BROADCAST_START
      );
      m_Controls.StopWatchingBroadcast();
    }
  }
  function DetectAndHandleBroadcastVariantChange() {
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
        ReloadAndWaitForBufferFill(STATE_LOADING);
        break;
      }
    }
  }
  function AddNextSegment() {
    WatchForErrors();
    DetectAndHandleBroadcastVariantChange();
    const oSegment = g_maQueue[0];
    if (!oSegment || oSegment.nProcessing !== PROCESSING_CONVERTED) {
      return;
    }
    Check(_oBehaviour === _oLiveBroadcast);
    if (oSegment.pData === STATE_BROADCAST_START) {
      Check(_oMediaSource.sourceBuffers.length === 0);
      _nBroadcastOffset = NaN;
      m_Controls.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_bAsyncOperation) {
      return;
    }
    if (oSegment.pData === STATE_REPEAT) {
      Check(
        m_Controls.GetState() !== STATE_STOP &&
        m_Controls.GetState() !== STATE_REPEAT
      );
      StartReplay();
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    const sReadyState = _oMediaSource.readyState;
    if (sReadyState !== "open") {
      m_Log.Here(
        `[Player] Appending segment ${oSegment.nNumber} postponed MediaSource.readyState=${sReadyState} MediaElement.src=${_oMediaElement.src}`
      );
      if (sReadyState === "closed" && _nPlaybackStarted === 0) {
        PreventQueueOverflow();
      }
      return;
    }
    if (oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length !== 0) {
      EndStream(oSegment);
      return;
    }
    if (oSegment.pData === STATE_BROADCAST_END) {
      Check(oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length === 0);
      m_Controls.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_oMediaSource.sourceBuffers.length === 0) {
      AddSourceBuffers(oSegment);
      m_Controls.UpdateTrackCount(
        oSegment.pData.bHasVideo,
        oSegment.pData.bHasAudio
      );
    }
    _bAsyncOperation = true;
    let oPromise = RemoveWatchedVideo(oSegment).then(
      CheckBufferExhaustion
    );
    if (oSegment.pData.mbInitializationSegment) {
      oPromise = oPromise.then(AppendInitSegment);
    }
    oPromise
      .then(AppendMediaSegment)
      .then(SegmentWasAppended)
      .catch(SegmentWasNotAppended);
  }
  function SeekReplayTo(nSeekTo) {
    Check(m_Controls.GetState() === STATE_REPEAT);
    _oReplay.CheckPlaybackPosition(nSeekTo);
  }
  function SeekReplayBy(bFrames, nSeekBy) {
    Check(m_Controls.GetState() === STATE_REPEAT);
    Check(Number.isFinite(nSeekBy));
    if (bFrames) {
      nSeekBy *=
        m_Statistics.GetFrameDurationInSeconds().nMinimum;
    }
    if (nSeekBy !== 0) {
      SeekReplayTo(
        Clamp(
          _oMediaElement.currentTime + nSeekBy,
          m_Scale.GetStart(),
          m_Scale.GetEnd()
        )
      );
    }
  }
  function TogglePause() {
    Check(m_Controls.GetState() === STATE_REPEAT);
    if ((_oReplay.bPause = !_oReplay.bPause)) {
      m_Log.Wow("[Player] Pausing replay");
      _oMediaElement.pause();
    } else {
      m_Log.Wow("[Player] Resuming replay");
      _oReplay.CheckPlaybackPosition(
        CHECK_PLAYBACK_START
      );
      _oMediaElement.play();
    }
    m_Events.SendEvent("player-paused", _oReplay.bPause);
  }
  function SetReplaySpeed(nSpeed) {
    Check(nSpeed > 0);
    Check(m_Controls.GetState() === STATE_REPEAT);
    m_Log.Wow(`[Player] Speed set to ${nSpeed}`);
    _oMediaElement.playbackRate = nSpeed;
  }
  function StartReplay() {
    _oReplay.bPause = true;
    _oBehaviour = _oReplay;
    StopPlayback();
    if (
      _oMediaSource.sourceBuffers.length !== 0 &&
      _oMediaSource.readyState === "open"
    ) {
      _oMediaSource.endOfStream();
    }
    if (
      _oMediaElement.played.length === 0 ||
      GetBufferFill().nWatched <
      REPLAY_AVAILABLE_IF_WATCHED
    ) {
      ShowState("Wow", "Nothing to replay");
      m_Controls.ChangeState(STATE_STOP);
      return;
    }
    ShowState("Wow", "Starting replay");
    m_Events.SendEvent("player-paused", _oReplay.bPause);
    m_Scale.SetStartAndEnd(
      _oMediaElement.buffered.start(0),
      _oMediaElement.buffered.end(_oMediaElement.buffered.length - 1)
    );
    m_Scale.SetWatched(_oMediaElement.currentTime);
    m_Controls.ChangeState(STATE_REPEAT);
    SetReplaySpeed(m_Controls.getReplaySpeed());
  }
  function AddSourceBuffers(oSegment) {
    m_Log.Wow(`[Player] Adding buffer ${oSegment.pData.sCodecs}`);
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
    _bHasVideoTrack = oSegment.pData.bHasVideo;
    _oMediaSourceBuffer.addEventListener(
      "updatestart",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "update",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "updateend",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "abort",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "error",
      WatchMediaSourceEvents
    );
  }
  function attachMediaSourceToMediaElement() {
    if (_oMediaElement.src) {
      URL.revokeObjectURL(_oMediaElement.src);
    }
    _oMediaElement.src = URL.createObjectURL(_oMediaSource);
    m_AudioDevice.start(_oMediaElement);
  }
  function Start() {
    Check(!_oMediaElement);
    try {
      _oMediaSource = new MediaSource();
    } catch (pException) {
      console.error(`MediaSource ${pException}`);
      m_Debug.FinishWorkAndShowMessage("J0221");
    }
    _oMediaSource.addEventListener("sourceopen", WatchMediaSourceEvents);
    _oMediaSource.addEventListener(
      "sourceended",
      WatchMediaSourceEvents
    );
    _oMediaSource.addEventListener(
      "sourceclose",
      WatchMediaSourceEvents
    );
    _oMediaSource.sourceBuffers.addEventListener(
      "addsourcebuffer",
      WatchMediaSourceEvents
    );
    _oMediaSource.sourceBuffers.addEventListener(
      "removesourcebuffer",
      WatchMediaSourceEvents
    );
    _oMediaElement = document.getElementById("eye");
    ApplyVolume();
    m_PictureInPicture.start(_oMediaElement);
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
      _oMediaElement.addEventListener(sEvent, WatchMediaElementEvents);
    }
    attachMediaSourceToMediaElement();
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
    Reload: ReloadAndWaitForBufferFill,
    ApplyVolume,
    AddNextSegment,
    SeekReplayTo,
    SeekReplayBy,
    TogglePause,
    SetReplaySpeed,
  };
})();
