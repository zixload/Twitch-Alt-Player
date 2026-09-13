"use strict";

const m_MediaQuery = (() => {
  let _nTimer = -2;
  const update = AddExceptionHandler(() => {
    Check(_nTimer !== 0);
    _nTimer = 0;
    const elPlayer = GetNode("player");
    const nPlayerHeight =
      (elPlayer.clientHeight * 100) /
      m_Settings.Get("nInterfaceSize");
    Check(nPlayerHeight > 0);
    elPlayer.classList.toggle(
      "collapsemainmenu",
      nPlayerHeight <= 460
    );
    elPlayer.classList.toggle(
      "collapsesettings",
      nPlayerHeight <= 412
    );
    const FONT_SIZE_MIN = 100;
    const FONT_SIZE_MAX = 124;
    const FONT_SIZE_STEP = 8;
    const oPanelStyle = GetNode("toppanel").style;
    const elFiller = GetNode("filler");
    for (
      let nFontSize = FONT_SIZE_MAX;
      ;
      nFontSize -= FONT_SIZE_STEP
    ) {
      oPanelStyle.fontSize = `${nFontSize}%`;
      if (
        nFontSize === FONT_SIZE_MIN ||
        elFiller.clientWidth > 0
      ) {
        break;
      }
    }
  });
  function updateQuickly() {
    if (_nTimer !== -1) {
      if (_nTimer > 0) {
        clearTimeout(_nTimer);
      }
      _nTimer = -1;
      requestAnimationFrame(update);
    }
  }
  function updateSlowly() {
    if (_nTimer === -2 || _nTimer === 0) {
      _nTimer = setTimeout(update, 200);
      Check(_nTimer > 0);
    }
  }
  window.addEventListener(
    "resize",
    AddExceptionHandler(() => {
      if (_nTimer !== -2) {
        updateSlowly();
      }
    })
  );
  return {
    updateQuickly,
    updateSlowly,
  };
})();
