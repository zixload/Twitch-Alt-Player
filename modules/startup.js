"use strict";

AddExceptionHandler(() => {
  function checkChannelAlreadyOpen(sChannel) {
    Check(IsNonEmptyString(sChannel));
    chrome.runtime.sendMessage(
      {
        sQuery: "ThisChannelIsAlreadyOpen",
        sChannel,
      },
      (pResponse) => {
        if (pResponse === true) {
          m_Debug.FinishWorkAndShowMessage("J0211");
        }
      }
    );
    chrome.runtime.onMessage.addListener(
      AddExceptionHandler((oMessage, _, fRespond) => {
        if (oMessage.sQuery === "ThisChannelIsAlreadyOpen") {
          m_Log.Oops(
            `[Launcher] Channel already open in another tab ${oMessage.sChannel}`
          );
          if (oMessage.sChannel === sChannel) {
            fRespond(true);
          }
        }
      })
    );
  }
  function HandlePageUnload(oEvent) {
    m_Log.Wow(`[Launcher] window.on${oEvent.type}`);
    Terminate(true);
  }
  function Startup() {
    Check(!g_bWorkFinished);
    m_Log.Here(`[Launcher] Starting ${performance.now().toFixed()}ms`);
    window.addEventListener("unload", HandlePageUnload);
    m_Controls.Start();
    if (m_Player.Start()) {
      m_Playlist.Start();
    } else {
      m_Controls.StopWatchingBroadcast();
    }
    m_Statistics.Start();
    m_Videos.Start();
    m_Rewind.Start();
  }
  if (window.top !== window) {
    return;
  }
  if (navigator.userAgent.includes("Gecko/")) {
    m_Debug.FinishWorkAndShowMessage("J0204");
  }
  const sChannel = (
    new URLSearchParams(location.search.slice(1)).get("channel") || "channel"
  ).toLowerCase();
  checkChannelAlreadyOpen(sChannel);
  Promise.all([
    checkExtensionPermissions(),
    m_Settings.Restore(),
    getCurrentTab(),
  ])
    .then(() => m_Twitch.start(sChannel))
    .then(Startup)
    .catch(m_Debug.CaughtException);
})();
