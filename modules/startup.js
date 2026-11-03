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
    m_VodChat.Start();
    m_Unfreeze.Start();
    m_Rewind.Start();
    m_Sync.Start(sChannel);
    m_Embed.Start();
  }
  /*
    Une VOD seule (page twitch.tv/videos/<id>) : la vue des videos la joue en plein cadre, et le
    direct ne demarre pas -- son element existe, rien ne l'alimente. Le salon s'y retrouve sous la
    cle « video:<id> ».
  */
  function StartupVideo(sVideoId, nStart) {
    Check(!g_bWorkFinished);
    m_Log.Here(`[Launcher] Starting on video ${sVideoId} ${performance.now().toFixed()}ms`);
    window.addEventListener("unload", HandlePageUnload);
    m_Controls.Start();
    m_Player.Start();
    m_Videos.Start();
    m_VodChat.Start();
    m_Rewind.Start();
    m_Sync.Start(`video:${sVideoId}`);
    m_Embed.Start();
    // Une tache a part, pas une microtache : tous les scripts du lecteur (window.js compris, que la
    // vue appelle en s'ouvrant) sont alors charges, quel que soit le chemin qui a mene jusqu'ici.
    setTimeout(AddExceptionHandler(() => m_Videos.PlayVideoAlone(sVideoId, nStart)), 0);
  }

  // La chaine d'une VOD, que l'adresse twitch.tv/videos/<id> ne dit pas.
  function fetchVideoOwner(sVideoId) {
    return fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "text/plain; charset=UTF-8" },
      body: createGqlRequestBody("query($id: ID!) { video(id: $id) { owner { login } } }", { id: sVideoId }),
    })
      .then((oResponse) => oResponse.json())
      .then((oResult) => {
        const sLogin = oResult && oResult.data && oResult.data.video && oResult.data.video.owner && oResult.data.video.owner.login;
        return IsNonEmptyString(sLogin) ? sLogin : "channel";
      }, () => "channel");
  }

  if (navigator.userAgent.includes("Gecko/")) {
    m_Debug.FinishWorkAndShowMessage("J0204");
  }
  const oParameters = new URLSearchParams(location.search.slice(1));
  const sVideoId = oParameters.get("video") || "";
  if (/^[0-9]+$/.test(sVideoId)) {
    const nStart = Number(oParameters.get("t")) || 0;
    Promise.all([
      checkExtensionPermissions(),
      m_Settings.Restore(),
      getCurrentTab(),
    ])
      .then(() => fetchVideoOwner(sVideoId))
      .then((sOwner) => m_Twitch.start(sOwner))
      .then(() => StartupVideo(sVideoId, nStart))
      .catch(m_Debug.CaughtException);
    return;
  }
  const sChannel = (
    oParameters.get("channel") || "channel"
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
