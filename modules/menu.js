"use strict";

const m_Menu = (() => {
  function setItemAvailability(pItem, bAvailable) {
    GetNode(pItem).tabIndex = bAvailable ? 0 : -1;
  }
  GetNode("eye").addEventListener("contextmenu", (oEvent) => {
    oEvent.preventDefault();
    m_Window.toggle("mainmenu");
  });
  m_Events.AddHandler("controls-leftclick", (oEvent) => {
    if (oEvent.target.classList.contains("menu-item")) {
      m_Window.close(false);
    }
  });
  return {
    setItemAvailability,
  };
})();
