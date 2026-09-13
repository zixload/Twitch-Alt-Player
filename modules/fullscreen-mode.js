"use strict";
/*
	Fullscreen: going in, coming out, and telling the rest of the player about it.

	What goes fullscreen is #playerandchat, not the video: the chat has to stay beside it.

	**The module never trusts what it just asked for.** Entering fullscreen is a request the browser
	can refuse — without a user gesture it always does — and the viewer can leave with Escape without
	telling anyone. So nothing is recorded when the request is made: the state is measured from
	document.fullscreenElement when the browser says it changed, and that measurement is what gets
	announced.

	The class `alt-fullscreen` on the body is how the stylesheets know. The sidebar is a sibling of
	the fullscreen element, so in principle the browser stops painting it — but its backdrop-filter
	promotes it to a layer of its own, and that layer survives on top of the video. This is the one
	place that knows the real state, so it also covers entering fullscreen first and showing the chat
	afterwards.

	Fullscreen and picture-in-picture cannot both hold, so entering here ends the other one. Entering
	also hides the interface without animation: the layout is about to move, and an animation across
	that move looks like a fault.

	**The starting state is set on the next frame, not while the module is being built.** Update goes
	through ChangeButton, which reads a translated tooltip, which is a call into m_i18n — and a module
	may only call into m_Log and m_Events while it is built (REPARTITION.md, section 3). It was the
	one exception left, and deferring one frame removes it: at load the player is never already
	fullscreen, so there is nothing to see in between.
*/
const m_FullscreenMode = (() => {
  // Le meme geste sous deux noms : la norme, et le vieux WebKit.
  const bStandard = Boolean(document.exitFullscreen);
  const REQUEST = bStandard ? "requestFullscreen" : "webkitRequestFullscreen";
  const EXIT = bStandard ? "exitFullscreen" : "webkitExitFullscreen";
  const ELEMENT = bStandard ? "fullscreenElement" : "webkitFullscreenElement";
  const CHANGE_EVENT = bStandard
    ? "fullscreenchange"
    : "webkitfullscreenchange";

  function GetElement() {
    return GetNode("playerandchat");
  }

  function Enabled() {
    return Boolean(document[ELEMENT]);
  }

  function Update() {
    const bEnabled = Enabled();
    m_Log.Wow(`[Fullscreen] Mode enabled: ${bEnabled}`);
    ChangeButton("togglefullscreen", bEnabled);
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
    GetElement()[REQUEST]();
    return true;
  }

  function Disable() {
    if (!Enabled()) {
      return false;
    }
    m_Log.Here("[Fullscreen] Disabling mode");
    m_AutoHide.Hide(false);
    document[EXIT]();
    return true;
  }

  function Toggle() {
    Enable() || Disable();
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

  document.addEventListener(CHANGE_EVENT, HandleModeChange);
  GetNode("eye").addEventListener("dblclick", HandleDoubleClick);
  requestAnimationFrame(Update);

  return {
    Enabled,
    Disable,
    Toggle,
    GetElement,
  };
})();
