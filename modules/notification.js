"use strict";

const m_Notification = (() => {
  const SHOW_NOTIFICATION = 2e3;
  let _nTimer = 0;
  function Show(sBadgeId, bTrouble) {
    Check(document.getElementById(sBadgeId) && typeof bTrouble == "boolean");
    const nodeNotification = GetNode("notification");
    nodeNotification.classList.toggle("trouble", bTrouble);
    ShowElement(nodeNotification, true);
    nodeNotification.firstElementChild.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "href",
      `#${sBadgeId}`
    );
    if (_nTimer !== 0) {
      clearTimeout(_nTimer);
    }
    _nTimer = setTimeout(HideNotification, SHOW_NOTIFICATION);
  }
  function ShowHappiness() {
    Show("svg-success", false);
  }
  function ShowAss() {
    Show("svg-fail", true);
  }
  const HideNotification = AddExceptionHandler(() => {
    ShowElement("notification", false);
    _nTimer = 0;
  });
  return {
    Show,
    ShowHappiness,
    ShowAss,
  };
})();
