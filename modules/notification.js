"use strict";
/*
	The badge that flashes in the corner of the player to acknowledge an action.

	One icon from the page's SVG sprite, in a fixed box at the top right of the video, for two
	seconds. Two flavours: the ordinary one in the accent colour, and the red "trouble" one for
	something that failed. Almost every caller wants one of those two, so they have a name of their
	own — a clip created, a setting refused, a request that came back empty.

	**Nothing is ever queued.** A second notification inside those two seconds replaces the icon and
	restarts the countdown; the first one is simply gone. That is the point of the thing: it
	acknowledges the last action, it does not keep a history. The log does that.

	The markup contract is a single <use> inside #notification, pointed at a symbol of the sprite by
	its id. The red flavour is the class `trouble` on the same element, and the box is shown and
	hidden by the `hidden` attribute, like every other panel of the player.

	Two things are deliberate and easy to undo by accident:
	  - an icon id the sprite does not carry, or a flavour that is not a boolean, trips Check. An
	    empty box would otherwise flash with nothing in it, and nobody would know why;
	  - hiding runs from a timer, so it goes through AddExceptionHandler: an exception raised there
	    belongs to no call stack the player can see, and would never reach the bug report.

	The zoom animation is the stylesheet's, and it plays when the box goes from hidden to shown —
	so a notification that lands while another is still up swaps the icon without re-animating.
*/
const m_Notification = (() => {
  const VISIBLE_TIME = 2e3;
  const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

  let _nHideTimer = 0;

  const Hide = AddExceptionHandler(() => {
    _nHideTimer = 0;
    ShowElement("notification", false);
  });

  function Show(sIconId, bTrouble) {
    Check(typeof bTrouble == "boolean" && document.getElementById(sIconId));
    const nodeBadge = GetNode("notification");
    // L'icone et la couleur avant l'affichage : sinon la precedente se voit le temps d'une image.
    nodeBadge.firstElementChild.setAttributeNS(
      XLINK_NAMESPACE,
      "href",
      `#${sIconId}`
    );
    nodeBadge.classList.toggle("trouble", bTrouble);
    ShowElement(nodeBadge, true);
    clearTimeout(_nHideTimer);
    _nHideTimer = setTimeout(Hide, VISIBLE_TIME);
  }

  function ShowHappiness() {
    Show("svg-success", false);
  }

  function ShowAss() {
    Show("svg-fail", true);
  }

  return {
    Show,
    ShowHappiness,
    ShowAss,
  };
})();
