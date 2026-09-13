"use strict";

const m_FocusManager = (() => {
  let _oState = GetNewState();
  function GetState() {
    return _oState;
  }
  function GetNewState() {
    const bShown = !document.hidden;
    const bActive = bShown && document.hasFocus();
    return {
      bShown,
      bActive,
    };
  }
  const HandleEvent = AddExceptionHandler((oEvent) => {
    m_Log.Here(
      `[Focus] Event ${oEvent.type}, previous state ${m_Log.O(
        _oState
      )}`
    );
    setTimeout(UpdateState);
  });
  const UpdateState = AddExceptionHandler(() => {
    const oNewState = GetNewState();
    if (
      _oState.bShown !== oNewState.bShown ||
      _oState.bActive !== oNewState.bActive
    ) {
      m_Log.Wow(
        `[Focus] New state ${m_Log.O(oNewState)}`
      );
      _oState = oNewState;
      m_Events.SendEvent("focus-statechanged", oNewState);
    }
  });
  m_Log.Here(`[Focus] Initial state ${m_Log.O(_oState)}`);
  document.addEventListener("visibilitychange", HandleEvent);
  window.addEventListener("focus", HandleEvent);
  window.addEventListener("blur", HandleEvent);
  return {
    GetState,
  };
})();
