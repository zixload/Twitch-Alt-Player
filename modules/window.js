"use strict";

const m_Window = (() => {
  function getOpen() {
    return document.body.getAttribute("data-window-opened") || "";
  }
  function openWindow(sWindowId) {
    const elWindow = GetNode(sWindowId);
    Check(elWindow.classList.contains("window"));
    elWindow.classList.add("windowopen", "windowanimation");
    document.body.setAttribute("data-window-opened", sWindowId);
    m_Events.SendEvent(`window-opened-${sWindowId}`);
  }
  function closeWindow(sWindowId, bWithAnimation = true) {
    const elWindow = GetNode(sWindowId);
    Check(elWindow.classList.contains("window"));
    elWindow.classList.remove("windowopen");
    elWindow.classList.toggle("windowanimation", bWithAnimation);
    document.body.removeAttribute("data-window-opened");
  }
  function open(sWindowId) {
    Check(IsNonEmptyString(sWindowId));
    const sOpenWindowId = getOpen();
    if (sWindowId === sOpenWindowId) {
      return false;
    }
    if (sOpenWindowId) {
      closeWindow(sOpenWindowId);
    }
    openWindow(sWindowId);
    return true;
  }
  function close(bWithAnimation = true) {
    const sOpenWindowId = getOpen();
    if (sOpenWindowId) {
      closeWindow(sOpenWindowId, bWithAnimation);
    }
  }
  function toggle(sWindowId) {
    open(sWindowId) || closeWindow(sWindowId);
  }
  function configureScrollIndicator(pScroll) {
    const elScroll = GetNode(pScroll);
    elScroll.scrollTop = 0;
    updateScrollIndicator(elScroll);
  }
  function updateScrollIndicator(elScroll) {
    const bShow = !thisElementIsFullyScrolled(elScroll);
    // Identifiant construit par prefixe : « scrollindicator- » suivi de l'id de la zone
    // defilante. Un renommage qui ne voit que les noms entiers laisse ce prefixe derriere lui,
    // et GetNode rend null sans que rien ne le signale avant l'execution.
    ShowElement(GetNode(`scrollindicator-${elScroll.id}`), bShow);
    elScroll[bShow ? "addEventListener" : "removeEventListener"](
      "scroll",
      handleScroll
    );
  }
  const handleScroll = AddExceptionHandler((oEvent) => {
    updateScrollIndicator(oEvent.target);
  });
  m_Events.AddHandler(
    "controls-leftclick",
    ({ target: elClick }) => {
      const sWindowId = elClick.getAttribute("data-window-toggle");
      if (sWindowId) {
        toggle(sWindowId);
        return;
      }
      const sOpenWindowId = getOpen();
      if (
        sOpenWindowId &&
        !GetNode(sOpenWindowId).contains(elClick) &&
        GetNode("player").contains(elClick)
      ) {
        closeWindow(sOpenWindowId);
      }
    }
  );
  return {
    open,
    close,
    toggle,
    configureScrollIndicator,
  };
})();
