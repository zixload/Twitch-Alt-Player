"use strict";
/*
	Picture-in-picture: the video leaves for a window of its own, the rest of the player stays here.

	**Nothing exists until the video does.** The player hands its media element over once it has one;
	before that, and on a browser that cannot do this — or a video that forbids it — the button stays
	hidden and the player behaves exactly as if the feature had never been built. That is deliberate:
	a button that does nothing is worse than no button.

	Fullscreen and picture-in-picture cannot both hold, so entering here ends fullscreen first.

	**The button's state comes from the browser, never from what was asked.** Entering is a request
	that can be refused — no user gesture, no metadata yet — and the viewer can close the little
	window from its own controls, where nothing in this page is involved. So the only things that
	repaint the button are the browser's own enterpictureinpicture and leavepictureinpicture.
*/
const m_PictureInPicture = (() => {
  const BUTTON_ID = "togglepictureinpicture";

  let _elVideo = null;

  function Enabled() {
    return Boolean(document.pictureInPictureElement);
  }

  function Update() {
    const bEnabled = Enabled();
    m_Log.Wow(`[PictureInPicture] Mode enabled: ${bEnabled}`);
    ChangeButton(BUTTON_ID, bEnabled);
  }

  const HandleModeChange = AddExceptionHandler(() => {
    Update();
  });

  function Enter() {
    if (Enabled()) {
      return false;
    }
    m_Log.Here("[PictureInPicture] Enabling mode");
    m_FullscreenMode.Disable();
    _elVideo.requestPictureInPicture();
    return true;
  }

  function disable() {
    if (!Enabled()) {
      return false;
    }
    m_Log.Here("[PictureInPicture] Disabling mode");
    document.exitPictureInPicture();
    return true;
  }

  function toggle() {
    // Pas de video connue, ou rien a l'ecran : il n'y a rien a faire sortir.
    if (_elVideo === null || document.body.classList.contains("novideo")) {
      return;
    }
    Enter() || disable();
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
    _elVideo = oMediaElement;
    oMediaElement.addEventListener("enterpictureinpicture", HandleModeChange);
    oMediaElement.addEventListener("leavepictureinpicture", HandleModeChange);
    Update();
    ShowElement(BUTTON_ID, true);
  }

  return {
    start,
    disable,
    toggle,
  };
})();
