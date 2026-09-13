"use strict";

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
    m_Log.Here(`[Events] Event occurred: ${sEvent}`);
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
