"use strict";

const m_PictureInPicture = (() => {
  let _oMediaElement = null;
  const handleModeChange = AddExceptionHandler(() => {
    update();
  });
  function enabled() {
    return Boolean(document.pictureInPictureElement);
  }
  function update() {
    const bEnabled = enabled();
    m_Log.Wow(`[PictureInPicture] Mode enabled: ${bEnabled}`);
    ChangeButton("togglepictureinpicture", bEnabled);
  }
  function enable() {
    if (enabled()) {
      return false;
    }
    m_Log.Here("[PictureInPicture] Enabling mode");
    m_FullscreenMode.Disable();
    _oMediaElement.requestPictureInPicture();
    return true;
  }
  function disable() {
    if (!enabled()) {
      return false;
    }
    m_Log.Here("[PictureInPicture] Disabling mode");
    document.exitPictureInPicture();
    return true;
  }
  function toggle() {
    _oMediaElement &&
      !document.body.classList.contains("novideo") &&
      (enable() || disable());
  }
  function start(oMediaElement) {
    if (
      !document.pictureInPictureEnabled ||
      oMediaElement.disablePictureInPicture
    ) {
      m_Log.Oops(
        `[PictureInPicture] pictureInPictureEnabled=${document.pictureInPictureEnabled} disablePictureInPicture=${oMediaElement.disablePictureInPicture}`
      );
      return;
    }
    _oMediaElement = oMediaElement;
    oMediaElement.addEventListener(
      "enterpictureinpicture",
      handleModeChange
    );
    oMediaElement.addEventListener(
      "leavepictureinpicture",
      handleModeChange
    );
    update();
    ShowElement("togglepictureinpicture", true);
  }
  return {
    start,
    disable,
    toggle,
  };
})();
