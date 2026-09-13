"use strict";

const m_GarbageCollector = (() => {
  class MessageChannelGarbageCollector {
    constructor() {
      this._oMessageChannel = null;
    }
    Discard(pJunk) {
      if (IsObject(pJunk)) {
        const bufJunk = pJunk.buffer ? pJunk.buffer : pJunk;
        if (bufJunk.byteLength) {
          m_Log.Here(`[Recycler] Discarding ${bufJunk.byteLength} bytes`);
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
        "controls-statechanged",
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
          m_Log.Here(`[Recycler] Discarding ${bufJunk.byteLength} bytes`);
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
        m_Log.Here(`[Recycler] Burning ${this._kbInGarbage} bytes`);
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
