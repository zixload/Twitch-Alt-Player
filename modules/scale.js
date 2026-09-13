"use strict";

const m_Scale = (() => {
  let _nStart = 0;
  let _nEnd = 0;
  let _nWatched;
  function ClampTime(nTime) {
    return Clamp(nTime, _nStart, _nEnd);
  }
  function Update() {
    Check(
      Number.isFinite(_nStart) &&
      Number.isFinite(_nEnd) &&
      Number.isFinite(_nWatched)
    );
    GetNode("scale-watched").style.transform = `scaleX(${(
      (_nWatched - _nStart) /
      (_nEnd - _nStart)
    ).toFixed(4)})`;
  }
  const HandleClick = AddExceptionHandler((oEvent) => {
    if (m_Controls.GetState() !== STATE_REPEAT) {
      return;
    }
    const oBorder = oEvent.currentTarget.getBoundingClientRect();
    const oStyle = getComputedStyle(oEvent.currentTarget);
    const nScaleStart = Math.round(
      oBorder.left + Number.parseFloat(oStyle.paddingLeft)
    );
    const nScaleEnd = Math.round(
      oBorder.right - Number.parseFloat(oStyle.paddingRight)
    );
    const nPointer = oEvent.clientX + 1;
    const nSeekTo = ClampTime(
      ((nPointer - nScaleStart) / (nScaleEnd - nScaleStart)) *
      (_nEnd - _nStart) +
      _nStart
    );
    m_Log.Wow(`[Scale] Seeking to ${nSeekTo}`);
    m_Player.SeekReplayTo(nSeekTo);
  });
  function SetStartAndEnd(nStart, nEnd) {
    Check(nStart <= nEnd);
    _nStart = nStart;
    _nEnd = nEnd;
    document
      .getElementById("scale")
      .addEventListener("click", HandleClick);
  }
  function SetWatched(nWatched) {
    _nWatched = ClampTime(nWatched);
    Update();
  }
  function GetStart() {
    return _nStart;
  }
  function GetEnd() {
    return _nEnd;
  }
  return {
    SetStartAndEnd,
    SetWatched,
    GetStart,
    GetEnd,
  };
})();
