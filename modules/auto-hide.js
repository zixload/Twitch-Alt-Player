"use strict";
/*
	The interface fades out when the mouse stops, and comes back when it moves.

	All this module does is put the class `autohide` on the body, or take it off. What disappears,
	and under which conditions — playing, no window open, not picking a speed — is the stylesheet's
	business. Keeping that split is what lets the rules change without touching this code.

	**A deadline, not a timer.** A mouse crossing the player fires hundreds of moves, and each one
	means "stay up a little longer". Re-arming a timeout each time would do hundreds of clearTimeout
	and setTimeout calls for one intent. Instead the pending timer is left alone and the deadline is
	pushed back; when the timer fires it looks at the deadline, and either hides or re-arms itself
	for what is left. A slack of fifty milliseconds keeps it from re-arming for almost nothing.

	**Two coordinate systems, and both must change.** A page that scrolls moves under a still mouse:
	the page coordinates change, the screen ones do not. A window dragged by its title bar moves the
	screen under the mouse: the reverse. Neither is a user coming back, so a move counts only when
	both change — and by at least a few pixels, because a trackpad reports drift that nobody made.

	**Hiding without animation is followed by half a second of silence.** That hide accompanies
	something else — going fullscreen, opening a window — and the layout it causes moves the page
	under the mouse. The move that follows is the page's, not the user's, and taking it seriously
	would bring straight back what was just hidden.

	The move listener itself is removed after each move it handles and put back a moment later. It is
	cheaper than a flag: while it is off, the browser has nothing to call.
*/
const m_AutoHide = (() => {
  const MIN_MOVE_INTERVAL = 150;
  const MOVE_THRESHOLD = 3;
  const SILENCE_AFTER_INSTANT_HIDE = 500;
  const TIMER_SLACK = 50;
  const SPEED_PICK_TIME = 5e3;

  const _elPlayer = document.getElementById("player");

  // Zero : l'interface est effacee. Sinon, l'identifiant du minuteur qui l'effacera.
  let _nHideTimer = 0;
  let _nHideDeadline = 0;
  let _nIgnoreMovesUntil = 0;
  let _nSpeedPickTimer = 0;
  let _nLastScreenX = 0;
  let _nLastScreenY = 0;
  let _nLastPageX = 0;
  let _nLastPageY = 0;

  function Show() {
    const nDelay = m_Settings.Get("nAutoHideInterval") * 1e3;
    if (_nHideTimer !== 0) {
      _nHideDeadline = performance.now() + nDelay;
      return;
    }
    document.body.classList.remove("autohide");
    document.body.classList.add("panelanimation");
    _nHideTimer = setTimeout(HandleHideTimer, nDelay);
    _nHideDeadline = 0;
    _nIgnoreMovesUntil = 0;
  }

  function Hide(bWithAnimation = true) {
    if (_nHideTimer !== 0) {
      clearTimeout(_nHideTimer);
      _nHideTimer = 0;
      document.body.classList.add("autohide");
    }
    document.body.classList.toggle("panelanimation", bWithAnimation);
    if (!bWithAnimation) {
      /*
        Retirer la classe, lire une valeur de mise en page, la remettre. Sans cette lecture, le
        navigateur regrouperait les deux changements dans le meme calcul et l'animation jouerait
        quand meme : la classe n'aurait jamais ete absente pour lui.
      */
      document.body.clientTop;
      document.body.classList.add("panelanimation");
      _nIgnoreMovesUntil = performance.now() + SILENCE_AFTER_INSTANT_HIDE;
    }
  }

  const HandleHideTimer = AddExceptionHandler(() => {
    Check(_nHideTimer !== 0);
    const nRemaining = _nHideDeadline - performance.now();
    if (nRemaining > TIMER_SLACK) {
      _nHideTimer = setTimeout(HandleHideTimer, nRemaining);
      _nHideDeadline = 0;
      return;
    }
    Hide();
  });

  function IsRealMove(nScreenX, nScreenY, nPageX, nPageY) {
    if (performance.now() < _nIgnoreMovesUntil) {
      return false;
    }
    if (_nLastScreenX === nScreenX && _nLastScreenY === nScreenY) {
      return false;
    }
    if (_nLastPageX === nPageX && _nLastPageY === nPageY) {
      return false;
    }
    return (
      Math.abs(_nLastPageX - nPageX) >= MOVE_THRESHOLD ||
      Math.abs(_nLastPageY - nPageY) >= MOVE_THRESHOLD
    );
  }

  const HandlePointerMove = AddExceptionHandler(
    ({ screenX, screenY, clientX, clientY }) => {
      _elPlayer.removeEventListener(
        "pointermove",
        HandlePointerMove,
        PASSIVE_HANDLER
      );
      setTimeout(ListenForPointerMove, MIN_MOVE_INTERVAL);
      if (IsRealMove(screenX, screenY, clientX, clientY)) {
        Show();
      }
      _nLastScreenX = screenX;
      _nLastScreenY = screenY;
      _nLastPageX = clientX;
      _nLastPageY = clientY;
    }
  );

  const ListenForPointerMove = AddExceptionHandler(() => {
    _elPlayer.addEventListener(
      "pointermove",
      HandlePointerMove,
      PASSIVE_HANDLER
    );
  });

  const HandleClick = AddExceptionHandler(() => {
    Show();
  });

  const HandleMouseLeave = AddExceptionHandler(() => {
    Hide();
  });

  // Choisir une vitesse tient l'interface en place : la liste deroulante est dedans.
  const HandleSpeedPick = AddExceptionHandler((oEvent) => {
    if (oEvent.button !== LEFT_BUTTON) {
      return;
    }
    clearTimeout(_nSpeedPickTimer);
    _nSpeedPickTimer = setTimeout(
      () => document.body.classList.remove("speedpick"),
      SPEED_PICK_TIME
    );
    document.body.classList.add("speedpick");
  });

  function Start() {
    ListenForPointerMove();
    _elPlayer.addEventListener("click", HandleClick);
    _elPlayer.addEventListener("mouseleave", HandleMouseLeave);
    GetNode("speed").addEventListener("pointerdown", HandleSpeedPick);
  }

  return {
    Start,
    Show,
    Hide,
  };
})();
