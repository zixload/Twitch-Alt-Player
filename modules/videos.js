"use strict";
/*
	The channel's videos: browse and play them without losing the live broadcast.

	**The live broadcast never stops.** Opening the view does not touch the playback pipeline at all:
	the stylesheet shrinks the live video element into a corner (body.videosopen), and a transparent
	layer over that miniature brings it back when clicked. Nothing is reloaded, nothing rebuffers.

	**What is chosen plays in a second video element**, above the list. Chrome plays Twitch's video
	playlists natively and clips are plain MP4 files, so there is no second pipeline to run. While it
	plays, the live broadcast is muted; closing the view restores the viewer's own volume setting.

	**While the view is open, the live shortcuts step aside.** m_Controls asks IsOpen() and lets every
	key but Escape through, and leaves the wheel alone: space belongs to the video being watched, not
	to the live broadcast in the corner.

	Four tabs, four lists: past broadcasts, highlights, uploads and clips. Pages come from m_Twitch in
	one shape; a response that arrives after the viewer changed tab is dropped.
*/
const m_Videos = (() => {
  const TABS = ["ARCHIVE", "HIGHLIGHT", "UPLOAD", "CLIPS"];
  // The miniature stays this far inside the player, whichever way it is dragged.
  const MINI_MARGIN = 8;

  let _bOpen = false;
  let _sTab = TABS[0];
  let _sCursor = null;
  let _bLoaded = false;
  // Increases with every new list or new video: a late answer to an older request is ignored.
  let _nListGeneration = 0;
  let _nVideoGeneration = 0;

  let _elView = null;
  let _elGrid = null;
  let _elStatus = null;
  let _elMore = null;
  let _elStage = null;
  let _elVideo = null;
  let _elNowPlaying = null;
  let _elMini = null;
  let _elPlayer = null;

  function IsOpen() {
    return _bOpen;
  }

  function Open() {
    if (_bOpen) {
      return;
    }
    m_Log.Wow("[Videos] Opening");
    _bOpen = true;
    m_Window.close(false);
    document.body.classList.add("videosopen");
    ShowElement(_elView, true);
    ShowElement(_elMini, true);
    if (!_bLoaded) {
      SelectTab(_sTab);
    }
  }

  function Close() {
    if (!_bOpen) {
      return;
    }
    m_Log.Wow("[Videos] Closing");
    _bOpen = false;
    StopVideo();
    ShowElement(_elView, false);
    ShowElement(_elMini, false);
    document.body.classList.remove("videosopen");
  }

  function Toggle() {
    if (_bOpen) {
      Close();
    } else {
      Open();
    }
  }

  // ------------------------------------------------------------------------------------------
  // The lists

  function SelectTab(sTab) {
    Check(TABS.includes(sTab));
    _sTab = sTab;
    for (const el of _elView.querySelectorAll("[data-videos-tab]")) {
      el.setAttribute("aria-selected", String(el.dataset.videosTab === sTab));
    }
    _elGrid.textContent = "";
    _sCursor = null;
    LoadPage();
  }

  function LoadPage() {
    const nGeneration = ++_nListGeneration;
    const sTab = _sTab;
    _bLoaded = true;
    ShowStatus(GetText("F1926"), false);
    ShowElement(_elMore, false);
    const oRequest = sTab === "CLIPS"
      ? m_Twitch.GetChannelClips(_sCursor)
      : m_Twitch.GetChannelVideos(sTab, _sCursor);
    oRequest
      .then(AddExceptionHandler(({ aoItems, sCursor }) => {
        if (nGeneration !== _nListGeneration) {
          return;
        }
        const oFragment = document.createDocumentFragment();
        for (const oItem of aoItems) {
          oFragment.appendChild(CreateCard(oItem));
        }
        _elGrid.appendChild(oFragment);
        _sCursor = sCursor;
        ShowElement(_elMore, Boolean(sCursor));
        if (_elGrid.childElementCount === 0) {
          ShowStatus(GetText("F1927"), false);
        } else {
          ShowElement(_elStatus, false);
        }
      }))
      .catch(AddExceptionHandler((pReason) => {
        if (typeof pReason != "string") {
          throw pReason;
        }
        if (nGeneration !== _nListGeneration) {
          return;
        }
        m_Log.Oops(`[Videos] Could not load ${sTab}. ${pReason}`);
        // Nothing loaded: the next opening of this tab tries again.
        _bLoaded = _elGrid.childElementCount !== 0;
        ShowStatus(GetText("F1928"), true);
      }));
  }

  function ShowStatus(sText, bError) {
    _elStatus.textContent = sText;
    _elStatus.classList.toggle("videos-error", bError);
    ShowElement(_elStatus, true);
  }

  function CreateCard(oItem) {
    const elCard = document.createElement("button");
    elCard.type = "button";
    elCard.className = "videos-card";
    if (oItem.sKind === "clip") {
      elCard.dataset.clipSlug = oItem.sId;
    } else {
      elCard.dataset.videoId = oItem.sId;
    }
    elCard.title = oItem.sTitle;

    const elThumb = elCard.appendChild(document.createElement("span"));
    elThumb.className = "videos-thumb";
    const elImage = elThumb.appendChild(document.createElement("img"));
    elImage.alt = "";
    elImage.loading = "lazy";
    elImage.decoding = "async";
    // Assigning an empty src would request the page itself.
    if (oItem.sThumbnail) {
      elImage.src = oItem.sThumbnail;
    }
    const elDuration = elThumb.appendChild(document.createElement("span"));
    elDuration.className = "videos-duration";
    elDuration.textContent = FormatDuration(oItem.nDuration);
    if (oItem.bRecording) {
      const elLive = elThumb.appendChild(document.createElement("span"));
      elLive.className = "videos-live";
      elLive.textContent = GetText("J0146");
    }

    const elTitle = elCard.appendChild(document.createElement("span"));
    elTitle.className = "videos-title";
    elTitle.textContent = oItem.sTitle;

    const elMeta = elCard.appendChild(document.createElement("span"));
    elMeta.className = "videos-meta";
    const asMeta = [];
    if (Number.isFinite(oItem.nDate)) {
      asMeta.push(m_i18n.FormatDate(oItem.nDate));
    }
    asMeta.push(`${m_i18n.FormatNumber(oItem.kViews)} ${GetText("F1931")}`);
    if (oItem.sGame) {
      asMeta.push(oItem.sGame);
    }
    elMeta.textContent = asMeta.join(" · ");

    elCard.addEventListener("click", AddExceptionHandler(() => PlayItem(oItem)));
    return elCard;
  }

  // Twitch's own way: "1:02:03", "4:05", "0:42".
  function FormatDuration(nSeconds) {
    const kTotal = Math.max(0, Math.floor(nSeconds));
    const kHours = Math.floor(kTotal / 3600);
    const kMinutes = Math.floor(kTotal / 60) % 60;
    const sSeconds = String(kTotal % 60).padStart(2, "0");
    return kHours !== 0
      ? `${kHours}:${String(kMinutes).padStart(2, "0")}:${sSeconds}`
      : `${kMinutes}:${sSeconds}`;
  }

  // ------------------------------------------------------------------------------------------
  // Playing one

  function PlayItem(oItem) {
    m_Log.Wow(`[Videos] Playing ${oItem.sKind} ${oItem.sId}`);
    // Stopping moves the generation on too: the number is taken after, or this request is stale
    // before it even leaves.
    StopVideo();
    const nGeneration = ++_nVideoGeneration;
    ShowElement(_elStage, true);
    _elNowPlaying.textContent = oItem.sTitle;
    _elNowPlaying.classList.remove("videos-error");
    _elView.scrollTop = 0;
    const oAddress = oItem.sKind === "clip"
      ? m_Twitch.GetClipPlaybackUrl(oItem.sId)
      : m_Twitch.GetVideoPlaybackUrl(oItem.sId);
    oAddress
      .then(AddExceptionHandler((sAddress) => {
        if (nGeneration !== _nVideoGeneration || !_bOpen) {
          return;
        }
        // The live broadcast keeps playing in its corner, silently.
        document.getElementById("eye").muted = true;
        _elVideo.src = sAddress;
        _elVideo.play().catch((pReason) => {
          m_Log.Oops(`[Videos] Playback did not start. ${pReason}`);
        });
      }))
      .catch(AddExceptionHandler((pReason) => {
        if (typeof pReason != "string") {
          throw pReason;
        }
        if (nGeneration !== _nVideoGeneration) {
          return;
        }
        m_Log.Oops(`[Videos] Could not play ${oItem.sKind} ${oItem.sId}. ${pReason}`);
        _elNowPlaying.textContent = GetText(pReason === "SUBSCRIBERS_ONLY" ? "F1929" : "F1930");
        _elNowPlaying.classList.add("videos-error");
      }));
  }

  function StopVideo() {
    ++_nVideoGeneration;
    if (_elVideo.getAttribute("src")) {
      _elVideo.pause();
      _elVideo.removeAttribute("src");
      // Without load(), the element keeps the last stream open and keeps downloading it.
      _elVideo.load();
    }
    ShowElement(_elStage, false);
    _elNowPlaying.textContent = "";
    m_Player.ApplyVolume();
  }

  const HandleVideoError = AddExceptionHandler(() => {
    if (!_elVideo.getAttribute("src") || !_elVideo.error) {
      return;
    }
    m_Log.Oops(`[Videos] Video element error ${_elVideo.error.code} ${_elVideo.error.message}`);
    _elNowPlaying.textContent = GetText("F1930");
    _elNowPlaying.classList.add("videos-error");
    m_Player.ApplyVolume();
  });

  // ------------------------------------------------------------------------------------------
  // The miniature

  /*
    Dragged by its handle. The offset lives in two custom properties on the player, which both the
    live video and the layer above it read, so the two can never drift apart. The miniature cannot
    leave the player.
  */
  function HandleMiniDrag(oParameters) {
    const oStyle = _elPlayer.style;
    switch (oParameters.nStep) {
    case 1:
      oParameters._nInitialX = Number.parseFloat(oStyle.getPropertyValue("--videos-mini-x")) || 0;
      oParameters._nInitialY = Number.parseFloat(oStyle.getPropertyValue("--videos-mini-y")) || 0;
      oParameters._oBounds = {
        nPlayerWidth: _elPlayer.clientWidth,
        nPlayerHeight: _elPlayer.clientHeight,
        nMiniWidth: _elMini.offsetWidth,
        nMiniHeight: _elMini.offsetHeight,
        // offsetLeft and offsetTop ignore the transform: this is where the miniature rests.
        nRight: _elPlayer.clientWidth - _elMini.offsetLeft - _elMini.offsetWidth,
        nBottom: _elPlayer.clientHeight - _elMini.offsetTop - _elMini.offsetHeight,
      };
      break;
    case 2: {
      const b = oParameters._oBounds;
      // At rest the miniature sits b.nRight / b.nBottom from the corner; it may travel left and up
      // until it reaches the opposite edge, and not past its resting place.
      const nMinX = -(b.nPlayerWidth - b.nMiniWidth - b.nRight - MINI_MARGIN);
      const nMinY = -(b.nPlayerHeight - b.nMiniHeight - b.nBottom - MINI_MARGIN);
      SetMiniOffset(
        Clamp(oParameters._nInitialX + oParameters.nDeltaX, Math.min(nMinX, 0), 0),
        Clamp(oParameters._nInitialY + oParameters.nDeltaY, Math.min(nMinY, 0), 0)
      );
      break;
    }
    case 3:
      if (oParameters.bCancel) {
        SetMiniOffset(oParameters._nInitialX, oParameters._nInitialY);
      }
      break;
    default:
      Check(false);
    }
  }

  function SetMiniOffset(nX, nY) {
    _elPlayer.style.setProperty("--videos-mini-x", `${nX}px`);
    _elPlayer.style.setProperty("--videos-mini-y", `${nY}px`);
  }

  const HandleMiniClick = AddExceptionHandler((oEvent) => {
    if (oEvent.button === LEFT_BUTTON && !oEvent.target.closest("[data-dragger]")) {
      Close();
    }
  });

  // ------------------------------------------------------------------------------------------
  // Start

  function Start() {
    _elPlayer = GetNode("player");
    _elView = GetNode("videos");
    _elGrid = GetNode("videos-grid");
    _elStatus = GetNode("videos-status");
    _elMore = GetNode("videos-more");
    _elStage = GetNode("videos-stage");
    _elVideo = GetNode("videos-video");
    _elNowPlaying = GetNode("videos-nowplaying");
    _elMini = GetNode("videos-mini");

    GetNode("alt-cb-videos").addEventListener("click", AddExceptionHandler(Toggle));
    GetNode("videos-close").addEventListener("click", AddExceptionHandler(Close));
    _elMore.addEventListener("click", AddExceptionHandler(LoadPage));
    for (const el of _elView.querySelectorAll("[data-videos-tab]")) {
      el.addEventListener("click", AddExceptionHandler(() => SelectTab(el.dataset.videosTab)));
    }
    _elMini.addEventListener("click", HandleMiniClick);
    _elVideo.addEventListener("error", HandleVideoError);
    m_Events.AddHandler("dragger-drag-videos-mini", HandleMiniDrag);
  }

  return {
    Start,
    IsOpen,
    Open,
    Close,
    Toggle,
  };
})();
