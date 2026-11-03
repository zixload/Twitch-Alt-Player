"use strict";
/*
	The player inside Twitch's own page: the half of the conversation that lives in the iframe.

	**Embedded means framed.** The player is opened from embedhost.js as an iframe in twitch.tv; opened
	on its own, as the harness does, it is the full page it always was. The class on <html> is set
	while this file loads, before the first paint, so the stylesheet hides the sidebar, the channel
	bar and the chat — Twitch's page has its own — without a flash.

	**The host only asks; the player decides.** The bar under the picture sends a speed or a boost.
	Speed goes through the player's own #speed list, so it obeys the same rule as the button inside:
	it applies when watching the recording or a replay, never at the live edge. The state goes back
	every half second, and only when it changed, so the bar can never show a speed that is not
	playing.

	**The boost goes through Web Audio, and only once asked for.** An element routed into an
	AudioContext cannot be routed back, so nothing is connected until the viewer first goes above
	100 %. From then on the context follows the output device the audio-device setting picked, since
	the element's own sinkId no longer reaches the speakers.
*/
const m_Embed = (() => {
  const EMBEDDED = window.top !== window;
  const HOST_ORIGIN = "https://www.twitch.tv";
  const STATE_INTERVAL = 500;
  const BOOST_MAX = 4;

  let _sLastState = "";
  let _oAudio = null;
  let _oGain = null;
  const _seConnected = new Set();

  if (EMBEDDED) {
    document.documentElement.classList.add("alt-embedded");
  }

  function IsEmbedded() {
    return EMBEDDED;
  }

  function post(oMessage) {
    window.parent.postMessage({ sTw5: "player", ...oMessage }, HOST_ORIGIN);
  }

  // Le mode studio, dans la page de Twitch, c'est son mode cinema : l'image en grand, son chat a cote.
  function ToggleTheatre() {
    post({ sCommand: "theatre" });
  }

  // ------------------------------------------------------------------------------------------
  // Vitesse

  // Sur une VOD seule, la vitesse est celle de la vue des videos, et elle vaut toujours.
  function speedNode() {
    return GetNode(m_Videos.IsSolo() ? "videos-speed" : "speed");
  }

  function speedApplies() {
    return m_Videos.IsSolo() || m_Rewind.IsShown() || m_Controls.GetState() === STATE_REPEAT;
  }

  function setSpeed(nSpeed) {
    const nodeSpeed = speedNode();
    const nodeOption = [...nodeSpeed.options].find((node) => Number.parseFloat(node.value) === nSpeed);
    if (!nodeOption || !speedApplies()) {
      return;
    }
    m_Log.Wow(`[Embed] Speed ${nSpeed}`);
    nodeSpeed.value = nodeOption.value;
    nodeSpeed.dispatchEvent(new Event("change"));
  }

  // ------------------------------------------------------------------------------------------
  // Volume au-dela de 100 %

  function connect(elVideo) {
    if (_seConnected.has(elVideo)) {
      return;
    }
    _oAudio.createMediaElementSource(elVideo).connect(_oGain);
    _seConnected.add(elVideo);
  }

  function setBoost(nBoost) {
    if (!(nBoost >= 1 && nBoost <= BOOST_MAX)) {
      return;
    }
    if (_oAudio === null) {
      if (nBoost === 1) {
        return;
      }
      m_Log.Here("[Embed] Routing audio through Web Audio");
      _oAudio = new AudioContext();
      _oGain = _oAudio.createGain();
      _oGain.connect(_oAudio.destination);
      connect(GetNode("eye"));
      connect(GetNode("rewind"));
      connect(GetNode("videos-video"));
    }
    m_Log.Wow(`[Embed] Boost ${nBoost}`);
    _oGain.gain.value = nBoost;
    _oAudio.resume().catch(STUB);
  }

  function followOutputDevice() {
    const sSinkId = GetNode("eye").sinkId;
    if (_oAudio && typeof _oAudio.setSinkId == "function" && sSinkId !== undefined && _oAudio.sinkId !== sSinkId) {
      _oAudio.setSinkId(sSinkId).catch(STUB);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Etat et messages

  const ReportState = AddExceptionHandler(() => {
    const oState = {
      bSpeedApplies: speedApplies(),
      nSpeed: Number.parseFloat(speedNode().value),
      oSync: m_Sync.GetState(),
    };
    const sState = JSON.stringify(oState);
    if (sState !== _sLastState) {
      _sLastState = sState;
      post({ sCommand: "state", oState });
    }
    followOutputDevice();
  });

  const HandleMessage = AddExceptionHandler((oEvent) => {
    if (oEvent.source !== window.parent || oEvent.origin !== HOST_ORIGIN) {
      return;
    }
    const oMessage = oEvent.data;
    if (!IsObject(oMessage) || oMessage.sTw5 !== "host") {
      return;
    }
    switch (oMessage.sCommand) {
    case "speed":
      // Un geste du spectateur, comme un clic dans le lecteur : le salon le suivra.
      m_Sync.NoteGesture();
      setSpeed(oMessage.nSpeed);
      ReportState();
      break;
    case "sync-create":
      m_Sync.Create();
      ReportState();
      break;
    case "sync-join":
      m_Sync.Join(oMessage.sRoom);
      ReportState();
      break;
    case "sync-leave":
      m_Sync.Leave();
      ReportState();
      break;
    case "boost":
      setBoost(oMessage.nBoost);
      break;
    }
  });

  function Start() {
    if (!EMBEDDED) {
      return;
    }
    window.addEventListener("message", HandleMessage);
    setInterval(ReportState, STATE_INTERVAL);
    post({ sCommand: "ready" });
    ReportState();
  }

  return {
    IsEmbedded,
    ToggleTheatre,
    Start,
  };
})();
