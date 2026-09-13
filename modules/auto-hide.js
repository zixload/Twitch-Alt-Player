"use strict";

const m_AutoHide = (() => {
  const MIN_MOVE_INTERVAL = 150;
  const MOVE_THRESHOLD = 3;
  const _nodeAutoHide = document.getElementById("player");
  let _nTimer = 0;
  let _nHideAfter = 0;
  let _nDoNotShowUntil = 0;
  let _nScreenX = 0,
    _nScreenY = 0;
  let _nClientX = 0,
    _nClientY = 0;
  let _nSpeedPickTimerId = 0;
  function Show() {
    if (_nTimer === 0) {
      document.body.classList.remove("autohide");
      document.body.classList.add("panelanimation");
      _nTimer = setTimeout(
        handleTimer,
        m_Settings.Get("nAutoHideInterval") * 1e3
      );
      _nHideAfter = _nDoNotShowUntil = 0;
    } else {
      _nHideAfter =
        performance.now() + m_Settings.Get("nAutoHideInterval") * 1e3;
    }
  }
  function Hide(bWithAnimation = true) {
    if (_nTimer !== 0) {
      clearTimeout(_nTimer);
      _nTimer = 0;
      document.body.classList.add("autohide");
    }
    document.body.classList.toggle("panelanimation", bWithAnimation);
    if (!bWithAnimation) {
      document.body.clientTop;
      document.body.classList.add("panelanimation");
      _nDoNotShowUntil = performance.now() + 500;
    }
  }
  const handleTimer = AddExceptionHandler(() => {
    Check(_nTimer !== 0);
    const nHideAfter = _nHideAfter - performance.now();
    if (nHideAfter > 50) {
      _nTimer = setTimeout(handleTimer, nHideAfter);
      _nHideAfter = 0;
    } else {
      Hide();
    }
  });
  const handlePointerMove = AddExceptionHandler(
    ({ screenX, screenY, clientX, clientY }) => {
      _nodeAutoHide.removeEventListener(
        "pointermove",
        handlePointerMove,
        PASSIVE_HANDLER
      );
      setTimeout(interceptPointerMove, MIN_MOVE_INTERVAL);
      if (
        (_nScreenX !== screenX || _nScreenY !== screenY) &&
        (_nClientX !== clientX || _nClientY !== clientY) &&
        (Math.abs(_nClientX - clientX) >= MOVE_THRESHOLD ||
          Math.abs(_nClientY - clientY) >= MOVE_THRESHOLD) &&
        performance.now() >= _nDoNotShowUntil
      ) {
        Show();
      }
      _nScreenX = screenX;
      _nScreenY = screenY;
      _nClientX = clientX;
      _nClientY = clientY;
    }
  );
  const interceptPointerMove = AddExceptionHandler(() => {
    _nodeAutoHide.addEventListener(
      "pointermove",
      handlePointerMove,
      PASSIVE_HANDLER
    );
  });
  const handleClick = AddExceptionHandler(() => {
    Show();
  });
  const handlePointerLeave = AddExceptionHandler(() => {
    Hide();
  });
  const handleSpeedPick = AddExceptionHandler((oEvent) => {
    if (oEvent.button === LEFT_BUTTON) {
      if (_nSpeedPickTimerId !== 0) {
        clearTimeout(_nSpeedPickTimerId);
      }
      _nSpeedPickTimerId = setTimeout(
        () => document.body.classList.remove("speedpick"),
        5e3
      );
      document.body.classList.add("speedpick");
    }
  });
  function Start() {
    interceptPointerMove();
    _nodeAutoHide.addEventListener("click", handleClick);
    _nodeAutoHide.addEventListener("mouseleave", handlePointerLeave);
    GetNode("speed").addEventListener("pointerdown", handleSpeedPick);
  }
  return {
    Start,
    Show,
    Hide,
  };
})();
