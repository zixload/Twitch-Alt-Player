"use strict";
/*
	Watching together: several viewers on the same frame, through a room on a small relay
	(sync-relay/, a Cloudflare Worker).

	**One clock every viewer receives identically.** The playlist dates each segment
	(#EXT-X-PROGRAM-DATE-TIME) and carries Twitch's server time; the broadcast's start time comes
	with its metadata. A position in the broadcast is the real time of the frame on screen minus that
	start, the same sum for everyone, in MPEG-TS or fMP4. So a room never sends positions back and
	forth to keep in step: it holds one instruction, the anchor, and every member works out for
	itself where it should be now.

	  { k: "live", d }                 hold the frame encoded d seconds ago -- the room at live
	  { k: "at", p, s, r, z }          broadcast position p at server time s, playing at rate r,
	                                   or paused when z -- the room after a pause or a seek

	**Only a viewer's own gesture changes the anchor.** A click or a key in the player, or a speed
	picked in the bar under the picture, opens a short window; once it has settled, if what is on
	screen moved more than the clock explains -- a pause, a jump, a return to live, a new speed --
	the new state becomes the room's anchor. What the synchroniser does itself never counts.

	**Keeping in step is steering, not jumping.** Past a second and a half, a seek; under it, a speed
	a few per cent off until the gap closes. Near the live edge the room holds one delay for all: a
	member whose stream arrives later than that cannot reach it, so after a few seconds of trying it
	raises the room's delay to what it can hold. The room settles on its slowest member, with nobody
	having to set anything.

	**Inside the live buffer or in the recording.** A target the live buffer still holds is played
	there; earlier than that, from the recording, which counts from the start of the broadcast too.
*/
const m_Sync = (() => {
  // The deployed relay (sync-relay/, Cloudflare free plan). chrome.storage.local "tw5SyncRelay"
  // overrides it, which is how a test points at a local `wrangler dev` on ws://127.0.0.1:8787.
  const RELAY_DEFAULT = "wss://tw5-sync.tw5-sync-relay.workers.dev";
  const RELAY_STORE = "tw5SyncRelay";
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CODE_LENGTH = 6;
  const TICK = 250;
  const SETTLE = 0.7;
  const SETTLE_LIMIT = 10;
  const JUMP = 1.5;
  const CLOSE_ENOUGH = 0.06;
  const MAX_NUDGE = 0.08;
  const EDGE_MARGIN = 1;
  const DELAY_DEFAULT = 6;
  const DELAY_MIN = 2;
  const DELAY_MAX = 60;
  const RECONNECT_MAX = 15e3;
  // Combien de temps un membre essaie de tenir le retard avant de le relever pour tout le salon.
  const BEHIND_PATIENCE = 4;

  let _sRelay = RELAY_DEFAULT;
  let _sChannel = "";
  let _sRoom = "";
  let _oSocket = null;
  let _nReconnect = 0;
  let _nReconnectDelay = 1e3;
  let _nTimer = 0;
  let _nMembers = 0;
  let _oAnchor = null;
  let _nDelay = DELAY_DEFAULT;
  let _sStatus = "";
  let _nGap = NaN;
  let _nBehindSince = NaN;
  // Le geste local en cours : ce qu'on voyait avant, et quand regarder ce qu'il a change.
  let _oGesture = null;

  function serverNow() {
    return (Number.isNaN(g_nExactTime) ? Date.now() : performance.now() + g_nExactTime) / 1e3;
  }

  // Le debut de la diffusion sur la meme horloge, NaN tant que ses metadonnees ne sont pas la.
  function broadcastStart() {
    return serverNow() - m_Twitch.GetBroadcastElapsed();
  }

  // Les bornes et la position du tampon du direct, en secondes de diffusion ; null sans heure.
  function livePositions(oClocks) {
    const nShift = oClocks.nCaptureOffset - broadcastStart();
    if (!Number.isFinite(nShift)) {
      return null;
    }
    return {
      nCurrent: oClocks.nCurrent + nShift,
      nStart: oClocks.nStart + nShift,
      nEnd: oClocks.nEnd + nShift,
      nShift,
    };
  }

  function makeCode() {
    const auBytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    return Array.from(auBytes, (u) => CODE_ALPHABET[u % CODE_ALPHABET.length]).join("");
  }

  // ------------------------------------------------------------------------------------------
  // Ce qui est a l'ecran

  function nominalRate() {
    return m_Rewind.IsShown() ? Number.parseFloat(GetNode("speed").value) || 1 : 1;
  }

  // Ou l'on en est, dans l'une ou l'autre source ; null tant qu'on ne peut pas le dire.
  function readLocal() {
    if (m_Controls.GetState() !== STATE_PLAYING) {
      return null;
    }
    if (m_Rewind.IsShown()) {
      const elVideo = GetNode("rewind");
      if (elVideo.readyState === 0) {
        return null;
      }
      return { sSource: "rewind", nPosition: elVideo.currentTime, bPaused: elVideo.paused, nRate: nominalRate() };
    }
    const oClocks = m_Player.GetLiveClocks();
    if (oClocks === null) {
      return null;
    }
    const oPositions = livePositions(oClocks);
    return {
      sSource: "live",
      nPosition: oPositions === null ? NaN : oPositions.nCurrent,
      bPaused: oClocks.bPaused,
      nRate: 1,
      bFollowing: m_Player.IsFollowingLive(),
      oClocks,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Les gestes du spectateur

  function NoteGesture() {
    if (_sRoom === "") {
      return;
    }
    const nNow = serverNow();
    if (_oGesture === null) {
      _oGesture = { oBefore: readLocal(), nSince: nNow, nCheckAt: nNow + SETTLE };
    } else {
      _oGesture.nCheckAt = nNow + SETTLE;
    }
  }

  function gestureMoved(oBefore, oAfter, nElapsed) {
    if (oBefore === null) {
      return true;
    }
    if (oAfter.bPaused !== oBefore.bPaused || oAfter.sSource !== oBefore.sSource || oAfter.nRate !== oBefore.nRate) {
      return true;
    }
    if (oAfter.bFollowing && !oBefore.bFollowing) {
      return true;
    }
    const nExpected = oBefore.nPosition + (oBefore.bPaused ? 0 : nElapsed * oBefore.nRate);
    return Math.abs(oAfter.nPosition - nExpected) > 1;
  }

  // Le geste a eu le temps d'agir : s'il a deplace l'image, l'etat devient la consigne du salon.
  function settleGesture() {
    const nNow = serverNow();
    if (nNow < _oGesture.nCheckAt) {
      return;
    }
    const oAfter = readLocal();
    if (oAfter === null) {
      // L'enregistrement charge encore : on lui laisse un peu de temps.
      if (nNow - _oGesture.nSince > SETTLE_LIMIT) {
        _oGesture = null;
      }
      return;
    }
    const { oBefore, nSince } = _oGesture;
    _oGesture = null;
    if (!gestureMoved(oBefore, oAfter, nNow - nSince)) {
      return;
    }
    if (oAfter.sSource === "live" && oAfter.bFollowing && !oAfter.bPaused) {
      announce({ k: "live", d: _nDelay });
    } else if (Number.isFinite(oAfter.nPosition)) {
      announce({ k: "at", p: oAfter.nPosition, s: nNow, r: oAfter.nRate, z: oAfter.bPaused });
    }
  }

  function announce(oAnchor) {
    oAnchor.c = _sChannel;
    m_Log.Wow(`[Sync] Announcing ${JSON.stringify(oAnchor)}`);
    _oAnchor = oAnchor;
    send({ t: "anchor", a: oAnchor });
  }

  // ------------------------------------------------------------------------------------------
  // Suivre la consigne

  function validAnchor(o) {
    if (!IsObject(o) || typeof o.c != "string") {
      return false;
    }
    if (o.k === "live") {
      return Number.isFinite(o.d) && o.d >= DELAY_MIN && o.d <= DELAY_MAX;
    }
    return o.k === "at" && Number.isFinite(o.p) && o.p >= 0 && Number.isFinite(o.s) &&
      Number.isFinite(o.r) && o.r > 0 && o.r <= 3 && typeof o.z == "boolean";
  }

  // Un petit ecart se rattrape en vitesse, un grand en sautant.
  function steer(nCurrent, nTarget, fSeek, fRate, nRate, bPaused) {
    const nGap = nCurrent - nTarget;
    _nGap = nGap;
    if (Math.abs(nGap) > JUMP || (bPaused && Math.abs(nGap) > 0.25)) {
      fSeek(nTarget);
      fRate(nRate);
      return;
    }
    if (bPaused || Math.abs(nGap) < CLOSE_ENOUGH) {
      fRate(nRate);
    } else {
      fRate(nRate * (1 - Clamp(nGap * 0.3, -MAX_NUDGE, MAX_NUDGE)));
    }
  }

  function setStatus(sStatus) {
    _sStatus = sStatus;
  }

  function steerLive(oLocal, nTarget, bPaused) {
    const { oClocks } = oLocal;
    const nEdge = oClocks.nEnd - EDGE_MARGIN;
    if (nTarget > nEdge) {
      // Le flux de ce spectateur arrive trop tard pour tenir ce retard : il colle au bord, et s'il
      // n'y arrive toujours pas, il releve le retard du salon a ce qu'il peut tenir.
      steer(oClocks.nCurrent, nEdge, m_Player.SeekLiveExactly, m_Player.SetLiveRate, 1, bPaused);
      _nGap = nEdge - nTarget;
      setStatus("behind");
      const nNow = serverNow();
      if (Number.isNaN(_nBehindSince)) {
        _nBehindSince = nNow;
      } else if (nNow - _nBehindSince > BEHIND_PATIENCE && _oAnchor.k === "live") {
        _nBehindSince = NaN;
        SetDelay(_oAnchor.d + Math.ceil(nTarget - nEdge) + 1);
      }
      return;
    }
    _nBehindSince = NaN;
    steer(oClocks.nCurrent, nTarget, m_Player.SeekLiveExactly, m_Player.SetLiveRate, 1, bPaused);
    setStatus(Math.abs(_nGap) < 0.3 ? "synced" : "adjusting");
  }

  function followLive(oLocal) {
    if (oLocal.sSource === "rewind") {
      m_Rewind.Stop();
      return;
    }
    if (oLocal.bPaused) {
      m_Player.TogglePause();
      return;
    }
    const nCaptureOffset = oLocal.oClocks.nCaptureOffset;
    if (!Number.isFinite(nCaptureOffset)) {
      // Pas d'heure d'encodage dans ce flux : chacun suit son bord, sans precision.
      if (!m_Player.IsFollowingLive()) {
        m_Player.JumpToLive();
      }
      _nGap = NaN;
      setStatus("imprecise");
      return;
    }
    steerLive(oLocal, serverNow() - _oAnchor.d - nCaptureOffset, false);
  }

  function followPosition(oLocal) {
    const a = _oAnchor;
    const nTarget = a.p + (a.z ? 0 : (serverNow() - a.s) * a.r);
    if (oLocal.sSource === "live") {
      const oPositions = livePositions(oLocal.oClocks);
      if (oPositions === null) {
        _nGap = NaN;
        setStatus("imprecise");
        return;
      }
      if (nTarget < oPositions.nStart + EDGE_MARGIN || a.r !== 1) {
        // Plus loin que le tampon du direct, ou a une vitesse que le direct ne joue pas.
        setStatus("loading");
        if (!m_Rewind.PlayAt(nTarget)) {
          setStatus("norecording");
        }
        return;
      }
      if (a.z !== oLocal.bPaused) {
        m_Player.TogglePause();
      }
      steerLive(oLocal, nTarget - oPositions.nShift, a.z);
      return;
    }
    // Dans l'enregistrement. Si le tampon du direct tient la cible, on y retourne.
    const oClocks = m_Player.GetLiveClocks();
    const oPositions = oClocks === null ? null : livePositions(oClocks);
    if (
      a.r === 1 && oPositions !== null &&
      nTarget > oPositions.nStart + EDGE_MARGIN &&
      nTarget < oPositions.nEnd - EDGE_MARGIN
    ) {
      m_Rewind.Stop();
      return;
    }
    const elVideo = GetNode("rewind");
    if (a.z !== elVideo.paused) {
      m_Rewind.TogglePause();
    }
    steer(
      elVideo.currentTime, nTarget,
      (n) => m_Rewind.SeekTo(n, !a.z),
      (n) => m_Rewind.SetSpeed(n),
      a.r, a.z
    );
    setStatus(Math.abs(_nGap) < 0.3 ? "synced" : "adjusting");
  }

  const Tick = AddExceptionHandler(() => {
    if (_sRoom === "") {
      return;
    }
    if (_oGesture !== null) {
      settleGesture();
      return;
    }
    if (_oAnchor === null || _oSocket === null || _oSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (_oAnchor.c !== _sChannel) {
      setStatus("channel");
      return;
    }
    const oLocal = readLocal();
    if (oLocal === null) {
      setStatus("loading");
      return;
    }
    if (_oAnchor.k === "live") {
      followLive(oLocal);
    } else {
      followPosition(oLocal);
    }
  });

  // ------------------------------------------------------------------------------------------
  // Le relais

  function send(oMessage) {
    if (_oSocket !== null && _oSocket.readyState === WebSocket.OPEN) {
      _oSocket.send(JSON.stringify(oMessage));
    }
  }

  const HandleSocketMessage = AddExceptionHandler(({ data }) => {
    let oMessage;
    try {
      oMessage = JSON.parse(data);
    } catch (_) {
      return;
    }
    if (!IsObject(oMessage)) {
      return;
    }
    if (Number.isSafeInteger(oMessage.n) && oMessage.n > 0) {
      _nMembers = oMessage.n;
    }
    if (oMessage.t === "welcome") {
      _nReconnectDelay = 1e3;
      if (validAnchor(oMessage.a)) {
        acceptAnchor(oMessage.a);
      } else {
        // Un salon neuf : il part de ce qu'on regarde.
        const oLocal = readLocal();
        if (oLocal === null || (oLocal.sSource === "live" && oLocal.bFollowing && !oLocal.bPaused)) {
          announce({ k: "live", d: _nDelay });
        } else {
          announce({ k: "at", p: oLocal.nPosition, s: serverNow(), r: oLocal.nRate, z: oLocal.bPaused });
        }
      }
    } else if (oMessage.t === "anchor" && validAnchor(oMessage.a)) {
      acceptAnchor(oMessage.a);
    }
  });

  function acceptAnchor(oAnchor) {
    m_Log.Wow(`[Sync] Anchor ${JSON.stringify(oAnchor)}`);
    _oAnchor = oAnchor;
    if (oAnchor.k === "live") {
      _nDelay = oAnchor.d;
    }
    // Une consigne recue l'emporte sur un geste local pas encore annonce.
    _oGesture = null;
  }

  function connect() {
    clearTimeout(_nReconnect);
    _nReconnect = 0;
    setStatus("connecting");
    m_Log.Here(`[Sync] Connecting to room ${_sRoom}`);
    const oSocket = new WebSocket(`${_sRelay}/room/${_sRoom}`);
    _oSocket = oSocket;
    oSocket.addEventListener("message", HandleSocketMessage);
    oSocket.addEventListener("close", AddExceptionHandler(() => {
      if (_oSocket !== oSocket) {
        return;
      }
      _oSocket = null;
      if (_sRoom !== "") {
        setStatus("offline");
        _nReconnect = setTimeout(AddExceptionHandler(connect), _nReconnectDelay);
        _nReconnectDelay = Math.min(_nReconnectDelay * 2, RECONNECT_MAX);
      }
    }));
  }

  function resetRates() {
    if (m_Controls.GetState() === STATE_PLAYING) {
      m_Player.SetLiveRate(1);
      m_Rewind.SetSpeed(nominalRate());
    }
  }

  // ------------------------------------------------------------------------------------------
  // Ce que pilote la barre sous l'image

  function Join(sRoom) {
    const sCode = String(sRoom || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (sCode.length !== CODE_LENGTH || [...sCode].some((s) => !CODE_ALPHABET.includes(s))) {
      setStatus("badcode");
      return;
    }
    Leave();
    _sRoom = sCode;
    _oAnchor = null;
    _nMembers = 1;
    connect();
    if (_nTimer === 0) {
      _nTimer = setInterval(Tick, TICK);
    }
  }

  function Create() {
    Join(makeCode());
  }

  function Leave() {
    if (_sRoom === "") {
      return;
    }
    m_Log.Here(`[Sync] Leaving room ${_sRoom}`);
    _sRoom = "";
    clearTimeout(_nReconnect);
    clearInterval(_nTimer);
    _nTimer = 0;
    const oSocket = _oSocket;
    _oSocket = null;
    if (oSocket !== null) {
      oSocket.close();
    }
    _oAnchor = null;
    _oGesture = null;
    _nGap = NaN;
    setStatus("");
    resetRates();
  }

  // Le retard que le salon tient au direct. Il devient la consigne si le salon est au direct.
  function SetDelay(nDelay) {
    if (!Number.isFinite(nDelay)) {
      return;
    }
    _nDelay = Clamp(Math.round(nDelay), DELAY_MIN, DELAY_MAX);
    if (_sRoom !== "" && _oAnchor !== null && _oAnchor.k === "live") {
      announce({ k: "live", d: _nDelay });
    }
  }

  function GetState() {
    return {
      sRoom: _sRoom,
      nMembers: _nMembers,
      sStatus: _sStatus,
      nGap: Number.isFinite(_nGap) ? Math.round(_nGap * 10) / 10 : null,
      nDelay: _nDelay,
      sRoomChannel: _oAnchor !== null ? _oAnchor.c : "",
    };
  }

  function Start(sChannel) {
    _sChannel = sChannel;
    document.addEventListener("click", NoteGesture, true);
    document.addEventListener("keydown", NoteGesture, true);
    chrome.storage.local.get(RELAY_STORE, AddExceptionHandler((oItems) => {
      if (!chrome.runtime.lastError && typeof oItems[RELAY_STORE] == "string") {
        _sRelay = oItems[RELAY_STORE];
      }
    }));
  }

  return {
    Start,
    Create,
    Join,
    Leave,
    NoteGesture,
    GetState,
  };
})();
