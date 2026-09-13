"use strict";
/*
	The player's pop-over windows: main menu, settings, channel card, news, update notice.

	One at a time, and the DOM says which one. `document.body` carries `data-window-opened=<id>` for
	as long as a window is up, and that attribute is not bookkeeping: the stylesheet keys the
	auto-hide rules on it (`.autohide:not([data-window-opened])`), so dropping it would fade the
	controls out from under an open window without raising anything. The module therefore keeps no
	copy of what is open — it reads it back where the stylesheet reads it.

	Opening announces itself, `window-opened-<id>`, because other modules have work to do then
	(m_Controls fills the main menu). Closing announces nothing: nobody has ever needed it.

	A left click anywhere in the player reaches this module through m_Controls. An element carrying
	`data-window-toggle=<id>` toggles that window; a click inside the player but outside the open
	window closes it; a click in the sidebar or the chat leaves it alone.

	Only an element of class `window` can be opened. Anything else is a programming error and trips
	Check rather than putting the page in a state where a window is "open" but invisible.

	The scroll indicator is the small "there is more below" mark inside a window. Its id is built by
	prefix — `scrollindicator-` followed by the id of the scrolling box — which is the pattern that
	has broken this repository three times: a rename that only sees whole names leaves the prefix
	behind, and GetNode then returns null at the worst moment. The scroll listener lives exactly as
	long as the indicator: once the box is fully scrolled, both go, and scrolling back up does not
	bring them back until configureScrollIndicator is called again. That is the original behaviour,
	kept on purpose.
*/
const m_Window = (() => {
  const OPEN_ATTRIBUTE = "data-window-opened";
  const TOGGLE_ATTRIBUTE = "data-window-toggle";
  const INDICATOR_PREFIX = "scrollindicator-";

  function OpenWindowId() {
    return document.body.getAttribute(OPEN_ATTRIBUTE) || "";
  }

  function WindowNode(pWindow) {
    const elWindow = GetNode(pWindow);
    Check(elWindow.classList.contains("window"));
    return elWindow;
  }

  function Show(sWindowId) {
    WindowNode(sWindowId).classList.add("windowopen", "windowanimation");
    document.body.setAttribute(OPEN_ATTRIBUTE, sWindowId);
    m_Events.SendEvent(`window-opened-${sWindowId}`);
  }

  function Hide(sWindowId, bWithAnimation) {
    const elWindow = WindowNode(sWindowId);
    elWindow.classList.remove("windowopen");
    elWindow.classList.toggle("windowanimation", bWithAnimation);
    document.body.removeAttribute(OPEN_ATTRIBUTE);
  }

  function open(sWindowId) {
    Check(IsNonEmptyString(sWindowId));
    const sOpenWindowId = OpenWindowId();
    if (sOpenWindowId === sWindowId) {
      return false;
    }
    if (sOpenWindowId) {
      Hide(sOpenWindowId, true);
    }
    Show(sWindowId);
    return true;
  }

  function close(bWithAnimation = true) {
    const sOpenWindowId = OpenWindowId();
    if (sOpenWindowId) {
      Hide(sOpenWindowId, bWithAnimation);
    }
  }

  function toggle(sWindowId) {
    if (!open(sWindowId)) {
      Hide(sWindowId, true);
    }
  }

  function configureScrollIndicator(pScroll) {
    const elScroll = GetNode(pScroll);
    elScroll.scrollTop = 0;
    UpdateScrollIndicator(elScroll);
  }

  function UpdateScrollIndicator(elScroll) {
    const bMoreBelow = !thisElementIsFullyScrolled(elScroll);
    ShowElement(GetNode(INDICATOR_PREFIX + elScroll.id), bMoreBelow);
    // L'ecouteur ne vit que tant que l'indicateur : en bas, les deux partent ensemble.
    if (bMoreBelow) {
      elScroll.addEventListener("scroll", HandleScroll);
    } else {
      elScroll.removeEventListener("scroll", HandleScroll);
    }
  }

  const HandleScroll = AddExceptionHandler((oEvent) => {
    UpdateScrollIndicator(oEvent.target);
  });

  m_Events.AddHandler("controls-leftclick", ({ target: elClick }) => {
    const sToggleId = elClick.getAttribute(TOGGLE_ATTRIBUTE);
    if (sToggleId) {
      toggle(sToggleId);
      return;
    }
    const sOpenWindowId = OpenWindowId();
    if (
      sOpenWindowId &&
      !GetNode(sOpenWindowId).contains(elClick) &&
      GetNode("player").contains(elClick)
    ) {
      Hide(sOpenWindowId, true);
    }
  });

  return {
    open,
    close,
    toggle,
    configureScrollIndicator,
  };
})();
