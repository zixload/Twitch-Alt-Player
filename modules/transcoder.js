"use strict";

const m_Transcoder = (() => {
  let _oWorkerThread = null;
  // Media segments handed to the worker and not yet returned. fMP4 passthrough
  // waits for this to reach zero so converted segments cannot overtake them.
  let _nWorkerJobs = 0;
  let _nLastLoaded = -1;
  function ConvertNextSegment() {
    let nRemove,
      kRemove = 0;
    for (
      let oSegment, nSegment = 0;
      (oSegment = g_maQueue[nSegment]);
      ++nSegment
    ) {
      if (oSegment.nProcessing > PROCESSING_DOWNLOADED) {
        continue;
      }
      if (oSegment.nProcessing < PROCESSING_DOWNLOADED) {
        break;
      }
      if (
        _nLastLoaded !== -1 &&
        _nLastLoaded + 1 !== oSegment.nNumber
      ) {
        m_Log.Oops(
          `[Transcoder] Segments not loaded between ${_nLastLoaded} and ${oSegment.nNumber}`
        );
        oSegment.bDiscontinuity = true;
      }
      _nLastLoaded = oSegment.nNumber;
      if (typeof oSegment.pData == "number" && _oWorkerThread === null) {
        m_Log.Here(
          `[Transcoder] Skipping segment ${oSegment.nNumber} State=${oSegment.pData}`
        );
        oSegment.nProcessing = PROCESSING_CONVERTED;
        if (oSegment.pData === STATE_BROADCAST_START) {
          CreateWorkerThread();
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
        m_Log.Here(
          `[Transcoder] Segment ${oSegment.nNumber} is fMP4, no conversion needed`
        );
        oSegment.pData = BuildPassthroughData(oSegment, mbInitSegment);
        oSegment.nProcessing = PROCESSING_CONVERTED;
        m_Statistics.ConvertedSegmentReceived(oSegment);
      } else {
        if (typeof oSegment.pData == "number") {
          m_Log.Here(
            `[Transcoder] Sending segment ${oSegment.nNumber} State=${oSegment.pData}`
          );
          _oWorkerThread.postMessage(oSegment);
        } else {
          m_Debug.SaveTransportStream(oSegment);
          m_Statistics.SourceSegmentReceived();
          m_Log.Here(`[Transcoder] Sending segment ${oSegment.nNumber}`);
          ++_nWorkerJobs;
          _oWorkerThread.postMessage(oSegment, [oSegment.pData]);
        }
        if (++kRemove == 1) {
          nRemove = nSegment;
        }
      }
    }
    if (kRemove !== 0) {
      g_maQueue.Remove(nRemove, kRemove);
    }
    m_Player.AddNextSegment();
  }
  /**
   * Wraps an already-fragmented MP4 segment in the shape the player expects back
   * from the worker, so nothing downstream needs to know where the bytes came from.
   *
   * @param {!Segment} oSegment A downloaded segment whose pData is the raw ArrayBuffer.
   * @param {!Uint8Array} mbInitSegment The cached #EXT-X-MAP initialisation segment.
   * @returns {!Object}
   */
  function BuildPassthroughData(oSegment, mbInitSegment) {
    const sCodecs = oSegment.sCodecs;
    const oData = {
      bPassthrough: true,
      mbMediaSegment: new Uint8Array(oSegment.pData),
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

  const HandleConversionFinished = AddExceptionHandler(
    (oEvent) => {
      const mData = oEvent.data;
      Check(Array.isArray(mData));
      switch (mData[0]) {
        case 1:
          Check(mData.length === 2 && IsObject(mData[1]));
          if (_nWorkerJobs !== 0) {
            --_nWorkerJobs;
          }
          const oSegment = new Segment(
            PROCESSING_CONVERTED,
            mData[1].pData,
            mData[1].nDuration,
            mData[1].bDiscontinuity,
            mData[1].nNumber
          );
          m_Log.Here(
            `[Transcoder] Segment received ${oSegment.nNumber
            } ConvertedIn=${m_Log.F0(oSegment.pData.nConvertedIn)}ms`
          );
          if (typeof oSegment.pData != "number") {
            m_Statistics.ConvertedSegmentReceived(oSegment);
            if (!oSegment.pData.hasOwnProperty("mbMediaSegment")) {
              return;
            }
            m_Debug.SaveConvertedSegment(oSegment);
          }
          g_maQueue.Add(oSegment);
          m_Player.AddNextSegment();
          return;

        case 2:
          const msSeverity = mData[1],
            msRecords = mData[2];
          Check(
            mData.length === 3 &&
            Array.isArray(msSeverity) &&
            Array.isArray(msRecords) &&
            msSeverity.length === msRecords.length
          );
          for (let idx = 0; idx < msSeverity.length; ++idx) {
            Check(
              (msSeverity[idx] === "Here" ||
                msSeverity[idx] === "Wow" ||
                msSeverity[idx] === "Oops") &&
              typeof msRecords[idx] == "string"
            );
            m_Log[msSeverity[idx]](msRecords[idx]);
          }
          return;

        case 3:
          Check(
            mData.length === 3 &&
            typeof mData[1] == "string" &&
            typeof mData[2] == "object"
          );
          m_Debug.TerminateAndSendReport(mData[1], mData[2]);
          return;

        case 4:
          Check(mData.length === 2 && typeof mData[1] == "string");
          m_Debug.FinishWorkAndShowMessage(mData[1]);
          return;

        case 5:
          Check(mData.length === 2 && mData[1].byteLength);
          m_GarbageCollector.Discard(mData[1]);
          return;

        default:
          Check(false);
      }
    }
  );
  function HandleConversionError(oEvent) {
    m_Debug.TerminateAndSendReport(
      `Event occurred: ${oEvent.type} in the worker thread at line ${oEvent.lineno}. ${oEvent.message}`
    );
  }
  function CreateWorkerThread() {
    m_Log.Here("[Transcoder] Creating worker thread");
    _nWorkerJobs = 0;
    _oWorkerThread = new Worker("/worker.js");
    _oWorkerThread.addEventListener(
      "message",
      HandleConversionFinished
    );
    _oWorkerThread.addEventListener("error", HandleConversionError);
    _oWorkerThread.addEventListener(
      "messageerror",
      HandleConversionError
    );
  }
  function Stop() {
    _nLastLoaded = -1;
    if (_oWorkerThread) {
      m_Log.Here("[Transcoder] Killing worker thread");
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
