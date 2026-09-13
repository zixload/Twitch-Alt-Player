"use strict";

const m_FullscreenMode = (() => {
  let _sRequestFullscreen = "requestFullscreen";
  let _sExitFullscreen = "exitFullscreen";
  let _sFullscreenElement = "fullscreenElement";
  let _sFullscreenchange = "fullscreenchange";
  if (!document.exitFullscreen) {
    _sRequestFullscreen = "webkitRequestFullscreen";
    _sExitFullscreen = "webkitExitFullscreen";
    _sFullscreenElement = "webkitFullscreenElement";
    _sFullscreenchange = "webkitfullscreenchange";
  }
  const HandleModeChange = AddExceptionHandler(() => {
    m_Events.SendEvent("fullscreen-changed", Update());
  });
  const HandleDoubleClick = AddExceptionHandler((oEvent) => {
    if (oEvent.button === LEFT_BUTTON) {
      oEvent.preventDefault();
      Toggle();
    }
  });
  function GetElement() {
    return GetNode("playerandchat");
  }
  function Enabled() {
    return !!document[_sFullscreenElement];
  }
  function Update() {
    const bEnabled = Enabled();
    m_Log.Wow(`[Fullscreen] Mode enabled: ${bEnabled}`);
    ChangeButton("togglefullscreen", bEnabled);
    // Tell the stylesheets we are fullscreen. The sidebar is a sibling of the fullscreen
    // element, so in principle the browser stops painting it — but its `backdrop-filter`
    // promotes it to its own composited layer, and that layer survives on top of the video.
    // This is the one place that knows the real state, so it also covers entering fullscreen
    // first and only then showing the chat.
    document.body.classList.toggle("alt-fullscreen", bEnabled);
    return bEnabled;
  }
  function Enable() {
    if (Enabled()) {
      return false;
    }
    m_Log.Here("[Fullscreen] Enabling mode");
    m_AutoHide.Hide(false);
    m_PictureInPicture.disable();
    GetElement()[_sRequestFullscreen]();
    return true;
  }
  function Disable() {
    if (!Enabled()) {
      return false;
    }
    m_Log.Here("[Fullscreen] Disabling mode");
    m_AutoHide.Hide(false);
    document[_sExitFullscreen]();
    return true;
  }
  function Toggle() {
    Enable() || Disable();
  }
  document.addEventListener(_sFullscreenchange, HandleModeChange);
  GetNode("eye").addEventListener("dblclick", HandleDoubleClick);
  Update();
  return {
    Enabled,
    Disable,
    Toggle,
    GetElement,
  };
})();
