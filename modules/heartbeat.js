"use strict";

const m_Heartbeat = (() => {
  const CHECK_INTERVAL = 970;
  const MIN_TIME_DEVIATION = -30;
  const MAX_TIME_DEVIATION = 200;
  const MAX_DATE_DEVIATION = 40;
  let _nMaximumDeviation = 0;
  let _nTimer = 0;
  let _nTime;
  let _nDate;
  const CheckHeartbeat = AddExceptionHandler(() => {
    const nTime = performance.now();
    const nDate = Date.now();
    const nTimeDeviation = nTime - _nTime - CHECK_INTERVAL;
    const nDateDeviation = nDate - _nDate - (nTime - _nTime);
    if (
      nTimeDeviation < MIN_TIME_DEVIATION ||
      nTimeDeviation > MAX_TIME_DEVIATION ||
      Math.abs(nDateDeviation) > MAX_DATE_DEVIATION
    ) {
      m_Log.Oops(
        `[Heartbeat] ${m_Log.F0(nTimeDeviation)} ${m_Log.F0(
          nDateDeviation
        )}`
      );
    }
    _nMaximumDeviation = Math.max(
      _nMaximumDeviation,
      nTimeDeviation
    );
    _nTime = nTime;
    _nDate = nDate;
    _nTimer = setTimeout(CheckHeartbeat, CHECK_INTERVAL);
  });
  function HandleStateChange(nState) {
    if (
      nState === STATE_BROADCAST_END ||
      nState === STATE_STOP ||
      nState === STATE_REPEAT
    ) {
      if (_nTimer !== 0) {
        m_Log.Here("[Heartbeat] Timer stopped");
        clearTimeout(_nTimer);
        _nTimer = 0;
      }
    } else if (_nTimer === 0) {
      m_Log.Here("[Heartbeat] Timer started");
      _nTime = performance.now();
      _nDate = Date.now();
      _nTimer = setTimeout(CheckHeartbeat, CHECK_INTERVAL);
    }
  }
  function GetDataForReport() {
    return _nMaximumDeviation;
  }
  m_Events.AddHandler(
    "controls-statechanged",
    HandleStateChange
  );
  return {
    GetDataForReport,
  };
})();
