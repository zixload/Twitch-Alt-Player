"use strict";
/*
	The hinges of the main menu: what opens it, what closes it, what the keyboard can reach.

	Three jobs, and nothing else. The menu's contents belong to m_Controls, its opening and closing
	to m_Window; this module only decides when each happens.

	A right click on the eye toggles the menu and suppresses the browser's own context menu. It is
	the one gesture this module listens for directly, because no other module is in a position to
	report it: m_Controls only carries left clicks.

	A left click on a menu entry closes the menu **without animation**. The entry has just started
	something that is about to appear — a window, fullscreen, a stream reload — and a menu sliding
	shut over it reads as a glitch.

	An entry that cannot be used is taken out of the tab order rather than hidden: the menu keeps
	its shape, and the keyboard walks past what would do nothing.

	Deliberately not wrapped in AddExceptionHandler, unlike the handlers of neighbouring modules:
	that wrapper also stops a handler from running once the player has terminated, and this listener
	was written without it. Wrapping it would be a behaviour change, small but real, and it belongs
	to whoever decides it for the whole player rather than to this rewrite.
*/
const m_Menu = (() => {
  const MENU_ID = "mainmenu";
  const ITEM_CLASS = "menu-item";

  function setItemAvailability(pItem, bAvailable) {
    GetNode(pItem).tabIndex = bAvailable ? 0 : -1;
  }

  GetNode("eye").addEventListener("contextmenu", (oEvent) => {
    oEvent.preventDefault();
    m_Window.toggle(MENU_ID);
  });

  m_Events.AddHandler("controls-leftclick", ({ target: elClick }) => {
    if (elClick.classList.contains(ITEM_CLASS)) {
      m_Window.close(false);
    }
  });

  return {
    setItemAvailability,
  };
})();
