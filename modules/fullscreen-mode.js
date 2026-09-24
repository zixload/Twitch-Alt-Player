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

	**Studio mode is this same fullscreen, with the chat left in place.** What goes fullscreen already
	holds the chat, so the difference is one thing not happening: the panel is not borrowed. The body
	then wears `alt-studio` as well, which is what lets the videos view drop its list and give the
	whole height to the picture. Leaving fullscreen, whichever way, forgets it -- the flag is read
	from the measurement, never from what was asked.

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
    if (!bEnabled) {
      _bStudio = false;
    }
    m_Log.Wow(`[Fullscreen] Mode enabled: ${bEnabled}${_bStudio ? " (studio)" : ""}`);
    ChangeButton("togglefullscreen", bEnabled);
    document.body.classList.toggle("alt-fullscreen", bEnabled);
    document.body.classList.toggle("alt-studio", _bStudio);
    return bEnabled;
  }

  // Vrai entre la demande de mode studio et la sortie du plein ecran, quelle qu'en soit la facon.
  let _bStudio = false;

  function IsStudio() {
    return _bStudio && Enabled();
  }

  function Enable(bStudio) {
    if (Enabled()) {
      return false;
    }
    _bStudio = Boolean(bStudio);
    m_Log.Here(`[Fullscreen] Enabling mode${_bStudio ? " (studio)" : ""}`);
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
    Enable(false) || Disable();
  }

  /*
    Le mode studio. Depuis le plein ecran ordinaire on y passe sans repasser par la fenetre : sortir
    puis rentrer ferait clignoter l'ecran, et la demande de rentrer, faite hors d'un geste, serait
    refusee.
  */
  function ToggleStudio() {
    if (IsStudio()) {
      Disable();
      return;
    }
    if (Enabled()) {
      _bStudio = true;
      m_Events.SendEvent("fullscreen-changed", Update());
      return;
    }
    Enable(true);
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
    ToggleStudio,
    IsStudio,
    GetElement,
  };
})();
