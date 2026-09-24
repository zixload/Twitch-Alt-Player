"use strict";
/*
	The channel's videos: browse and play them without losing the live broadcast.

	**The live broadcast never stops.** Opening the view does not touch the playback pipeline at all:
	the stylesheet shrinks the live video element into a corner (body.videosopen), and a transparent
	layer over that miniature brings it back when clicked. Nothing is reloaded, nothing rebuffers.

	**What is chosen plays in a second video element**, above the list. Chrome plays Twitch's video
	playlists natively and clips are plain MP4 files, so there is no second pipeline to run. While it
	plays, the live broadcast is muted; closing the view restores the viewer's own volume setting.

	**The chat panel steps aside too.** It belongs to the live broadcast, which is now a thumbnail in
	the corner; a chat scrolling beside a two-year-old video is noise, and it takes width the list
	needs. The view borrows the panel on the way in and gives it back on the way out, the same way
	fullscreen does -- and the viewer's own setting is never written over.

	**While the view is open, the live shortcuts step aside.** m_Controls asks IsOpen() and lets every
	key but Escape through, and leaves the wheel alone: space belongs to the video being watched, not
	to the live broadcast in the corner. The view takes only the two it needs, the left and right
	arrows, which move the video being watched by five seconds.

	Four tabs, four lists: past broadcasts, highlights, uploads and clips. Pages come from m_Twitch in
	one shape; a response that arrives after the viewer changed tab is dropped.
*/
const m_Videos = (() => {
  const TABS = ["ARCHIVE", "HIGHLIGHT", "UPLOAD", "CLIPS"];
  // The miniature stays this far inside the player, whichever way it is dragged.
  const MINI_MARGIN = 8;
  const MINI_MIN_WIDTH = 160;

  let _bOpen = false;
  let _sTab = TABS[0];
  let _sCursor = null;
  let _bLoaded = false;
  // Increases with every new list or new video: a late answer to an older request is ignored.
  let _nListGeneration = 0;
  let _nVideoGeneration = 0;
  // The qualities of the video currently playing, best first, and the one chosen.
  let _aoQualities = [];
  let _sQualityKey = "";
  // Les adresses de listes refermees qu'on a fabriquees, a liberer quand on change de video.
  let _asClosedPlaylistUrls = [];
  // What is playing, so its position can be remembered under its id.
  let _oNowPlaying = null;
  let _bResumePending = false;
  let _nLastSaved = 0;
  let _bScrubbing = false;
  let _nHideTimer = 0;

  // How long a position is worth resuming: not the first seconds, not the last.
  const RESUME_MIN = 10;
  const RESUME_TAIL = 15;
  // The controls fade out this long after the pointer stops, while playing.
  const CONTROLS_IDLE = 2600;
  const POSITION_KEY = "tw5-vod-position";

  let _elView = null;
  let _elGrid = null;
  let _elStatus = null;
  let _elMore = null;
  let _elStage = null;
  let _elVideo = null;
  let _elNowPlaying = null;
  let _elQuality = null;
  let _elMini = null;
  let _elPlayer = null;
  let _elControls = null;
  let _elSeek = null;
  let _elBuffered = null;
  let _elPlayed = null;
  let _elHead = null;
  let _elTime = null;
  let _elPlayPause = null;
  let _elVolume = null;
  let _elMute = null;
  let _elSpeed = null;
  let _elMenu = null;
  let _elQualityRow = null;
  let _elPreview = null;
  let _elPreviewImg = null;
  let _elPreviewTime = null;
  // The hover-preview thumbnails of the video currently playing, or null while none.
  let _oStoryboard = null;

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
    document.body.classList.remove("videos-mini-closed");
    ShowElement(_elView, true);
    ShowElement(_elMini, true);
    if (!_bLoaded) {
      SelectTab(_sTab);
    }
    m_Events.SendEvent("videos-opened", true);
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
    document.body.classList.remove("videosopen", "videos-mini-closed");
    m_Events.SendEvent("videos-opened", false);
  }

  // Echap referme d'abord ce qui est pose par-dessus : le panneau des reglages, puis la vue.
  function CloseTopmost() {
    if (MenuIsOpen()) {
      CloseMenu();
      return;
    }
    Close();
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
    _oNowPlaying = oItem;
    // A broadcast is long enough to resume; a clip is not. Watching the live from its start opts out:
    // the whole point is to begin at the beginning, not where a past visit left off.
    _bResumePending = oItem.sKind === "video" && !oItem.bFromStart;
    ShowElement(_elStage, true);
    ShowElement(_elNowPlaying, true);
    // Une rediffusion a son chat d'epoque ; un clip, morceau d'une autre, n'en a pas.
    if (oItem.sKind === "video") {
      m_VodChat.Open(oItem.sId);
    }
    // La miniature change de coin : son decalage de glisser se mesurait depuis l'autre.
    document.body.classList.add("videosplaying");
    SetMiniOffset(0, 0);
    _elNowPlaying.textContent = oItem.sTitle;
    _elNowPlaying.classList.remove("videos-error");
    _elView.scrollTop = 0;
    ShowControls();

    if (oItem.sKind === "clip") {
      m_Twitch.GetClipPlaybackUrl(oItem.sId).then(WhenReady(nGeneration, PlayAddress), WhenFailed(nGeneration, oItem));
      return;
    }

    // The seek-bar thumbnails, loaded alongside; the bar works without them.
    LoadStoryboard(oItem.sId, nGeneration);

    /*
      A past broadcast. TwitchNoSub (videos-twitchnosub.js) resolves every quality of the broadcast
      from its storyboards path, which also reaches the ones reserved for subscribers, so it is tried
      first: it gives the quality menu and the subscriber-only unlock at once. Usher, Twitch's own
      signed playlist, is the fallback -- and the only path if the port is ever removed.
    */
    if (typeof TwitchNoSub !== "undefined") {
      TwitchNoSub.resolveVodQualities(oItem.sId).then(
        WhenReady(nGeneration, (aoQualities) => {
          if (aoQualities.length !== 0) {
            _aoQualities = aoQualities;
            BuildQualityMenu();
            PlayQuality(aoQualities[0].sKey);
          } else {
            PlayThroughUsher(oItem, nGeneration);
          }
        }),
        WhenFailed(nGeneration, oItem)
      );
    } else {
      PlayThroughUsher(oItem, nGeneration);
    }
  }

  function PlayThroughUsher(oItem, nGeneration) {
    m_Twitch.GetVideoPlaybackUrl(oItem.sId).then(WhenReady(nGeneration, PlayAddress), WhenFailed(nGeneration, oItem));
  }

  // Wraps a success handler so a stale answer, or one that arrives after the view closed, is dropped.
  function WhenReady(nGeneration, fHandle) {
    return AddExceptionHandler((pValue) => {
      if (nGeneration === _nVideoGeneration && _bOpen) {
        fHandle(pValue);
      }
    });
  }

  // A refusal, shown in place of the video: subscriber-only broadcasts say so, the rest is generic.
  function WhenFailed(nGeneration, oItem) {
    return AddExceptionHandler((pReason) => {
      if (typeof pReason != "string") {
        throw pReason;
      }
      if (nGeneration !== _nVideoGeneration) {
        return;
      }
      m_Log.Oops(`[Videos] Could not play ${oItem.sKind} ${oItem.sId}. ${pReason}`);
      _elNowPlaying.textContent = GetText(pReason === "SUBSCRIBERS_ONLY" ? "F1929" : "F1930");
      _elNowPlaying.classList.add("videos-error");
    });
  }

  /*
    Les adresses fabriquees pour cette video sont a nous : personne d'autre ne les libere, et le
    navigateur les garde tant qu'on ne le lui dit pas.
  */
  function ReleaseClosedPlaylists() {
    for (const sUrl of _asClosedPlaylistUrls) {
      URL.revokeObjectURL(sUrl);
    }
    _asClosedPlaylistUrls = [];
  }

  // Referme la liste si besoin, et retient l'adresse fabriquee pour la liberer plus tard.
  function ResolvePlayableUrl(sUrl) {
    return makeSeekablePlaylist(sUrl).then((sPlayable) => {
      if (sPlayable !== sUrl) {
        _asClosedPlaylistUrls.push(sPlayable);
      }
      return sPlayable;
    });
  }

  function PlayAddress(sAddress) {
    const nGeneration = _nVideoGeneration;
    ResolvePlayableUrl(sAddress).then(
      AddExceptionHandler((sPlayable) => {
        if (nGeneration !== _nVideoGeneration || !_bOpen) {
          return;
        }
        // The live broadcast keeps playing in its corner, silently.
        document.getElementById("eye").muted = true;
        _elVideo.src = sPlayable;
        _elVideo.play().catch((pReason) => {
          m_Log.Oops(`[Videos] Playback did not start. ${pReason}`);
        });
      })
    );
  }

  // ------------------------------------------------------------------------------------------
  // Quality

  function BuildQualityMenu() {
    _elQuality.textContent = "";
    for (const oQuality of _aoQualities) {
      const elOption = _elQuality.appendChild(document.createElement("option"));
      elOption.value = oQuality.sKey;
      elOption.textContent = oQuality.sName;
    }
    _elQuality.value = _aoQualities[0].sKey;
    // Nothing to choose between one quality: no menu.
    ShowElement(_elQualityRow, _aoQualities.length > 1);
  }

  // Switching quality keeps the position: the new playlist is a different encode of the same video.
  function PlayQuality(sKey) {
    const oQuality = _aoQualities.find((o) => o.sKey === sKey);
    if (!oQuality) {
      return;
    }
    _sQualityKey = sKey;
    _elQuality.value = sKey;
    const nTime = _elVideo.currentTime;
    const bWasPlaying = !_elVideo.paused && !_elVideo.ended;
    const nGeneration = _nVideoGeneration;
    ResolvePlayableUrl(oQuality.sUrl).then(
      AddExceptionHandler((sPlayable) => {
        if (nGeneration !== _nVideoGeneration || !_bOpen) {
          return;
        }
        document.getElementById("eye").muted = true;
        _elVideo.src = sPlayable;
        _elVideo.play().catch((pReason) => {
          m_Log.Oops(`[Videos] Playback did not start. ${pReason}`);
        });
      })
    );
    _elVideo.addEventListener("loadedmetadata", function AtMetadata() {
      _elVideo.removeEventListener("loadedmetadata", AtMetadata);
      if (nTime > 0 && Number.isFinite(_elVideo.duration) && nTime < _elVideo.duration) {
        _elVideo.currentTime = nTime;
      }
      if (bWasPlaying) {
        _elVideo.play().catch(() => {});
      }
    });
  }

  const HandleQualityChange = AddExceptionHandler(() => {
    PlayQuality(_elQuality.value);
  });

  function StopVideo() {
    ++_nVideoGeneration;
    if (_elVideo.getAttribute("src")) {
      SavePosition();
      _elVideo.pause();
      _elVideo.removeAttribute("src");
      // Without load(), the element keeps the last stream open and keeps downloading it.
      _elVideo.load();
    }
    m_Preview.Close();
    ReleaseClosedPlaylists();
    _aoQualities = [];
    _sQualityKey = "";
    _oNowPlaying = null;
    HidePreview();
    ShowElement(_elQualityRow, false);
    m_VodChat.Close();
    CloseMenu();
    document.body.classList.remove("videosplaying");
    SetMiniOffset(0, 0);
    ShowElement(_elStage, false);
    ShowElement(_elNowPlaying, false);
    _elNowPlaying.textContent = "";
    m_Player.ApplyVolume();
  }

  // ------------------------------------------------------------------------------------------
  // The controls -- the alternate player's own look, without the live-only parts

  // mm:ss, or h:mm:ss past an hour. Same shape as the thumbnails.
  const TogglePlay = AddExceptionHandler(() => {
    if (_elVideo.paused || _elVideo.ended) {
      _elVideo.play().catch(() => {});
    } else {
      _elVideo.pause();
    }
  });

  // The play/pause glyph follows the real state, wherever the state changed from.
  const HandlePlayState = AddExceptionHandler(() => {
    _elPlayPause.classList.toggle("videos-playing", !_elVideo.paused && !_elVideo.ended);
    if (_elVideo.paused) {
      ShowControls(true);
    } else {
      ShowControls();
    }
  });

  const HandleTimeUpdate = AddExceptionHandler(() => {
    UpdateProgress();
    UpdateTime();
    // Resume once, when the position is finally seekable.
    if (_bResumePending) {
      _bResumePending = false;
      RestorePosition();
    } else {
      SavePositionThrottled();
    }
  });

  const HandleProgress = AddExceptionHandler(UpdateProgress);

  function UpdateProgress() {
    const nDuration = _elVideo.duration;
    if (!Number.isFinite(nDuration) || nDuration <= 0) {
      return;
    }
    _elPlayed.style.width = `${(_elVideo.currentTime / nDuration) * 100}%`;
    _elHead.style.left = `${(_elVideo.currentTime / nDuration) * 100}%`;
    // The furthest buffered range that covers the current position.
    let nBufferedEnd = 0;
    for (let idx = 0; idx < _elVideo.buffered.length; ++idx) {
      if (_elVideo.buffered.start(idx) <= _elVideo.currentTime) {
        nBufferedEnd = Math.max(nBufferedEnd, _elVideo.buffered.end(idx));
      }
    }
    _elBuffered.style.width = `${(nBufferedEnd / nDuration) * 100}%`;
  }

  function UpdateTime() {
    _elTime.textContent = `${formatTimecode(_elVideo.currentTime)} / ${formatTimecode(_elVideo.duration)}`;
  }

  // --- The seek bar

  function SeekRatioFromEvent(oEvent) {
    const oRect = _elSeek.getBoundingClientRect();
    return Clamp((oEvent.clientX - oRect.left) / oRect.width, 0, 1);
  }

  const HandleSeekDown = AddExceptionHandler((oEvent) => {
    if (oEvent.button !== LEFT_BUTTON || !Number.isFinite(_elVideo.duration)) {
      return;
    }
    oEvent.preventDefault();
    _bScrubbing = true;
    SeekToRatio(SeekRatioFromEvent(oEvent));
    const AtMove = AddExceptionHandler((oMove) => {
      SeekToRatio(SeekRatioFromEvent(oMove));
      ShowPreview(oMove);
    });
    const AtUp = AddExceptionHandler(() => {
      _bScrubbing = false;
      document.removeEventListener("pointermove", AtMove);
      document.removeEventListener("pointerup", AtUp);
    });
    document.addEventListener("pointermove", AtMove);
    document.addEventListener("pointerup", AtUp);
  });

  function SeekToRatio(nRatio) {
    if (Number.isFinite(_elVideo.duration)) {
      _elVideo.currentTime = nRatio * _elVideo.duration;
      UpdateProgress();
      UpdateTime();
    }
  }

  const HandleSeekHover = AddExceptionHandler((oEvent) => {
    ShowPreview(oEvent);
  });

  const HandleSeekLeave = AddExceptionHandler(() => {
    if (!_bScrubbing) {
      HidePreview();
    }
  });

  // --- Volume, speed, fullscreen, picture-in-picture

  const HandleVolume = AddExceptionHandler(() => {
    _elVideo.volume = _elVolume.valueAsNumber / 100;
    _elVideo.muted = _elVolume.valueAsNumber === 0;
    ReflectVolume();
  });

  const HandleMute = AddExceptionHandler(() => {
    _elVideo.muted = !_elVideo.muted;
    ReflectVolume();
  });

  function ReflectVolume() {
    _elMute.classList.toggle("videos-muted", _elVideo.muted || _elVideo.volume === 0);
    if (!_elVideo.muted) {
      _elVolume.value = Math.round(_elVideo.volume * 100);
    } else {
      _elVolume.value = 0;
    }
  }

  const HandleSpeed = AddExceptionHandler(() => {
    _elVideo.playbackRate = Number(_elSpeed.value);
  });

  // Fullscreen wraps the stage, not the video, so the custom controls come with it.
  const HandleFullscreen = AddExceptionHandler(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      _elStage.requestFullscreen().catch((pReason) => {
        m_Log.Oops(`[Videos] Fullscreen refused. ${pReason}`);
      });
    }
  });

/*
    Les fleches deplacent la lecture de cinq secondes, comme dans la rediffusion du direct, et la
    repetition compte : tenir la touche fait defiler. La barre se montre au passage, sans quoi on
    avancerait a l'aveugle.

    Une frappe dans un champ ou un menu lui appartient -- le curseur du son, le choix de qualite,
    celui de la vitesse sont tous dans cette barre, et une fleche y change la valeur.
  */
  const SEEK_STEP = 5;
  const KEY_LEFT = 37;
  const KEY_RIGHT = 39;

  function IsFieldEvent(pTarget) {
    return (
      pTarget instanceof HTMLElement &&
      (/^(INPUT|SELECT|TEXTAREA)$/.test(pTarget.tagName) || pTarget.isContentEditable)
    );
  }

  function SeekBy(nSeconds) {
    const nDuration = _elVideo.duration;
    const nWanted = _elVideo.currentTime + nSeconds;
    _elVideo.currentTime = Number.isFinite(nDuration)
      ? Clamp(nWanted, 0, nDuration)
      : Math.max(0, nWanted);
    ShowControls();
  }

  const HandleKeyDown = AddExceptionHandler((oEvent) => {
    if (
      !_bOpen ||
      _elStage.hidden ||
      oEvent.shiftKey ||
      oEvent.ctrlKey ||
      oEvent.altKey ||
      oEvent.metaKey ||
      IsFieldEvent(oEvent.target)
    ) {
      return;
    }
    const nDirection =
      oEvent.keyCode === KEY_LEFT ? -1 : oEvent.keyCode === KEY_RIGHT ? 1 : 0;
    if (nDirection === 0) {
      return;
    }
    oEvent.preventDefault();
    SeekBy(nDirection * SEEK_STEP);
  });

  /*
    L'engrenage et son panneau. Tant qu'il est ouvert la barre ne s'efface pas : elle emporterait le
    panneau avec elle au milieu d'un choix. Un clic ailleurs le referme, comme tout menu.
  */
  function MenuIsOpen() {
    return !_elMenu.hidden;
  }

  function CloseMenu() {
    if (MenuIsOpen()) {
      ShowElement(_elMenu, false);
      ShowControls();
    }
  }

  const HandleSettings = AddExceptionHandler((oEvent) => {
    oEvent.stopPropagation();
    if (MenuIsOpen()) {
      CloseMenu();
      return;
    }
    ShowElement(_elMenu, true);
    ShowControls(true);
  });

  // Un clic hors du panneau le referme ; a l'interieur, il appartient au choix en cours.
  const HandleClickAway = AddExceptionHandler((oEvent) => {
    if (MenuIsOpen() && !_elMenu.contains(oEvent.target)) {
      CloseMenu();
    }
  });

  // Le mode studio enveloppe le lecteur ET le chat : la feuille de style donne le reste de la
  // hauteur a l'image, et la liste s'efface le temps qu'il dure.
  const HandleStudio = AddExceptionHandler(() => {
    m_FullscreenMode.ToggleStudio();
  });

  const HandlePip = AddExceptionHandler(() => {
    if (document.pictureInPictureElement === _elVideo) {
      document.exitPictureInPicture();
    } else if (_elVideo.getAttribute("src")) {
      _elVideo.requestPictureInPicture().catch((pReason) => {
        m_Log.Oops(`[Videos] Picture-in-picture refused. ${pReason}`);
      });
    }
  });

  // --- Auto-hide, like the live interface

  const HandleStageMove = AddExceptionHandler(() => ShowControls());

  function ShowControls(bKeep) {
    _elStage.classList.add("videos-controls-shown");
    clearTimeout(_nHideTimer);
    _nHideTimer = 0;
    // Paused, scrubbing or hovering: the bar stays. Otherwise it fades after a pause in movement.
    if (bKeep || _elVideo.paused || _bScrubbing) {
      return;
    }
    _nHideTimer = setTimeout(
      AddExceptionHandler(() => {
        if (!_elVideo.paused && !_bScrubbing) {
          _elStage.classList.remove("videos-controls-shown");
        }
      }),
      CONTROLS_IDLE
    );
  }

  // --- Resume where the viewer left off

  function ReadPositions() {
    try {
      return JSON.parse(localStorage.getItem(POSITION_KEY)) || {};
    } catch (_) {
      return {};
    }
  }

  function SavePosition() {
    if (!_oNowPlaying || _oNowPlaying.sKind !== "video" || !Number.isFinite(_elVideo.duration)) {
      return;
    }
    const nTime = _elVideo.currentTime;
    try {
      const oPositions = ReadPositions();
      // Near the end, the video is finished: forget it rather than resume at the credits.
      if (nTime < RESUME_MIN || nTime > _elVideo.duration - RESUME_TAIL) {
        delete oPositions[_oNowPlaying.sId];
      } else {
        oPositions[_oNowPlaying.sId] = Math.floor(nTime);
      }
      localStorage.setItem(POSITION_KEY, JSON.stringify(oPositions));
    } catch (_) {
      // A viewer with storage blocked simply gets no memory; not worth a fuss.
    }
    _nLastSaved = nTime;
  }

  function SavePositionThrottled() {
    if (Math.abs(_elVideo.currentTime - _nLastSaved) >= 5) {
      SavePosition();
    }
  }

  function RestorePosition() {
    _nLastSaved = _elVideo.currentTime;
    if (!_oNowPlaying || _oNowPlaying.sKind !== "video" || !Number.isFinite(_elVideo.duration)) {
      return;
    }
    const nSaved = ReadPositions()[_oNowPlaying.sId];
    if (Number.isFinite(nSaved) && nSaved >= RESUME_MIN && nSaved < _elVideo.duration - RESUME_TAIL) {
      m_Log.Here(`[Videos] Resuming ${_oNowPlaying.sId} at ${formatTimecode(nSaved)}`);
      _elVideo.currentTime = nSaved;
    }
  }

  // --- Hover preview, from Twitch's own seek thumbnails (storyboards)

  function LoadStoryboard(sVideoId, nGeneration) {
    _oStoryboard = null;
    m_Twitch.GetVideoStoryboards(sVideoId).then(
      AddExceptionHandler((oStoryboard) => {
        // Ignore an answer for a video the viewer has already left.
        if (nGeneration === _nVideoGeneration && oStoryboard) {
          _oStoryboard = oStoryboard;
          _elPreview.style.setProperty("--preview-w", `${oStoryboard.nWidth}px`);
          _elPreview.style.setProperty("--preview-h", `${oStoryboard.nHeight}px`);
        }
      }),
      AddExceptionHandler((pReason) => {
        // No thumbnails is not a failure: the preview just shows the time.
        m_Log.Here(`[Videos] No storyboard: ${pReason}`);
      })
    );
  }

  function ShowPreview(oEvent) {
    if (!Number.isFinite(_elVideo.duration)) {
      return;
    }
    const oRect = _elSeek.getBoundingClientRect();
    const nRatio = Clamp((oEvent.clientX - oRect.left) / oRect.width, 0, 1);
    _elPreviewTime.textContent = formatTimecode(nRatio * _elVideo.duration);
    // Centre the preview on the cursor, kept inside the seek bar's width.
    const nLeft = Clamp(oEvent.clientX - oRect.left, 60, oRect.width - 60);
    _elPreview.style.left = `${nLeft}px`;

    if (_oStoryboard) {
      const o = _oStoryboard;
      const kPerImage = o.nRows * o.nCols;
      const kIndex = Math.min(Math.floor((nRatio * _elVideo.duration) / o.nInterval), o.kCount - 1);
      const kImage = Math.floor(kIndex / kPerImage);
      const kCell = kIndex % kPerImage;
      if (kImage < o.asImages.length) {
        _elPreviewImg.style.backgroundImage = `url("${o.sBaseUrl}${o.asImages[kImage]}")`;
        _elPreviewImg.style.backgroundSize = `${o.nCols * o.nWidth}px ${o.nRows * o.nHeight}px`;
        _elPreviewImg.style.backgroundPosition =
          `-${(kCell % o.nCols) * o.nWidth}px -${Math.floor(kCell / o.nCols) * o.nHeight}px`;
        _elPreviewImg.hidden = false;
      } else {
        _elPreviewImg.hidden = true;
      }
    } else {
      // Sans planche chez Twitch, les vignettes viennent de m_Preview, partage avec la barre du
      // direct : le meme enregistrement, la meme echelle.
      m_Preview.Open(_oNowPlaying.sId, _elVideo.duration);
      _elPreviewImg.hidden = !m_Preview.Paint(_elPreviewImg, nRatio * _elVideo.duration);
    }
    ShowElement(_elPreview, true);
  }

  function HidePreview() {
    if (_elPreview) {
      ShowElement(_elPreview, false);
    }
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
        nLeft: _elMini.offsetLeft,
        nTop: _elMini.offsetTop,
        nRight: _elPlayer.clientWidth - _elMini.offsetLeft - _elMini.offsetWidth,
        nBottom: _elPlayer.clientHeight - _elMini.offsetTop - _elMini.offsetHeight,
      };
      break;
    case 2: {
      const b = oParameters._oBounds;
      /*
        La miniature part de sa place au repos et va jusqu'au bord oppose, dans les deux sens : elle
        se repose en bas a droite devant la liste, en haut a droite pendant qu'une video joue, et le
        meme calcul vaut pour les deux -- ce qu'elle a devant elle d'un cote, ce qu'elle a derriere
        de l'autre.
      */
      const nMinX = -Math.max(0, b.nLeft - MINI_MARGIN);
      const nMaxX = Math.max(0, b.nRight - MINI_MARGIN);
      const nMinY = -Math.max(0, b.nTop - MINI_MARGIN);
      const nMaxY = Math.max(0, b.nBottom - MINI_MARGIN);
      SetMiniOffset(
        Clamp(oParameters._nInitialX + oParameters.nDeltaX, nMinX, nMaxX),
        Clamp(oParameters._nInitialY + oParameters.nDeltaY, nMinY, nMaxY)
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
    // The move handle, the close button and the resize grip have their own jobs; the rest of the
    // miniature brings the live broadcast back to full size.
    if (
      oEvent.button === LEFT_BUTTON &&
      !oEvent.target.closest("[data-dragger]") &&
      !oEvent.target.closest(".videos-mini-close") &&
      !oEvent.target.closest(".videos-mini-resize")
    ) {
      Close();
    }
  });

  // Closing the corner hides both the miniature and the live video behind it; it keeps decoding,
  // muted and out of sight. "Back to live" brings everything back.
  const HandleMiniClose = AddExceptionHandler((oEvent) => {
    oEvent.stopPropagation();
    document.body.classList.add("videos-mini-closed");
  });

  /*
    A resize grip on the corner facing the video. The miniature is anchored bottom-right, so pulling
    the grip left widens it. The width lives in one custom property; height follows from the 16:9 box.
  */
  const HandleResizeDown = AddExceptionHandler((oEvent) => {
    if (oEvent.button !== LEFT_BUTTON) {
      return;
    }
    oEvent.preventDefault();
    oEvent.stopPropagation();
    const nStartX = oEvent.clientX;
    const nStartWidth = _elMini.offsetWidth;
    const nMaxWidth = _elPlayer.clientWidth - 2 * MINI_MARGIN;
    const AtMove = AddExceptionHandler((oMove) => {
      const nWidth = Clamp(nStartWidth + (nStartX - oMove.clientX), MINI_MIN_WIDTH, nMaxWidth);
      _elPlayer.style.setProperty("--videos-mini-width", `${nWidth}px`);
    });
    const AtUp = AddExceptionHandler(() => {
      document.removeEventListener("pointermove", AtMove);
      document.removeEventListener("pointerup", AtUp);
    });
    document.addEventListener("pointermove", AtMove);
    document.addEventListener("pointerup", AtUp);
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
    _elQuality = GetNode("videos-quality");
    _elMenu = GetNode("videos-menu");
    _elQualityRow = GetNode("videos-menu-quality");
    _elMini = GetNode("videos-mini");
    _elControls = GetNode("videos-controls");
    _elSeek = GetNode("videos-seek");
    _elBuffered = GetNode("videos-buffered");
    _elPlayed = GetNode("videos-played");
    _elHead = GetNode("videos-head");
    _elTime = GetNode("videos-time");
    _elPlayPause = GetNode("videos-playpause");
    _elVolume = GetNode("videos-volume");
    _elMute = GetNode("videos-mute");
    _elSpeed = GetNode("videos-speed");
    _elPreview = GetNode("videos-preview");
    _elPreviewImg = GetNode("videos-preview-image");
    _elPreviewTime = GetNode("videos-preview-time");

    GetNode("alt-cb-videos").addEventListener("click", AddExceptionHandler(Toggle));
    GetNode("videos-close").addEventListener("click", AddExceptionHandler(Close));
    _elMore.addEventListener("click", AddExceptionHandler(LoadPage));
    for (const el of _elView.querySelectorAll("[data-videos-tab]")) {
      el.addEventListener("click", AddExceptionHandler(() => SelectTab(el.dataset.videosTab)));
    }
    _elQuality.addEventListener("change", HandleQualityChange);
    _elMini.addEventListener("click", HandleMiniClick);
    GetNode("videos-mini-close").addEventListener("click", HandleMiniClose);
    GetNode("videos-mini-resize").addEventListener("pointerdown", HandleResizeDown);
    _elVideo.addEventListener("error", HandleVideoError);
    m_Events.AddHandler("dragger-drag-videos-mini", HandleMiniDrag);

    // The controls: play/pause, progress, time, volume, speed, fullscreen, picture-in-picture.
    _elVideo.addEventListener("timeupdate", HandleTimeUpdate);
    _elVideo.addEventListener("progress", HandleProgress);
    _elVideo.addEventListener("play", HandlePlayState);
    _elVideo.addEventListener("pause", HandlePlayState);
    _elVideo.addEventListener("ended", HandlePlayState);
    _elVideo.addEventListener("click", TogglePlay);
    _elVideo.addEventListener("dblclick", HandleFullscreen);
    _elPlayPause.addEventListener("click", TogglePlay);
    _elSeek.addEventListener("pointerdown", HandleSeekDown);
    // Prepare le lecteur-vignette des que le curseur entre sur la barre, et seulement quand Twitch
    // n'a pas de planche : le premier survol ne paie plus le chargement.
    _elSeek.addEventListener(
      "pointerenter",
      AddExceptionHandler(() => {
        if (!_oStoryboard && _oNowPlaying && _oNowPlaying.sKind === "video") {
          m_Preview.Open(_oNowPlaying.sId, _elVideo.duration);
        }
      })
    );
    _elSeek.addEventListener("pointermove", HandleSeekHover);
    _elSeek.addEventListener("pointerleave", HandleSeekLeave);
    _elVolume.addEventListener("input", HandleVolume);
    _elMute.addEventListener("click", HandleMute);
    _elSpeed.addEventListener("change", HandleSpeed);
    GetNode("videos-fullscreen").addEventListener("click", HandleFullscreen);
    GetNode("videos-settings").addEventListener("click", HandleSettings);
    document.addEventListener("click", HandleClickAway);
    GetNode("videos-studio").addEventListener("click", HandleStudio);
    GetNode("videos-pip").addEventListener("click", HandlePip);
    _elStage.addEventListener("pointermove", HandleStageMove);
    document.addEventListener("keydown", HandleKeyDown);
  }

  /*
    Rejouer le direct depuis son vrai debut. On ouvre la vue sur le VOD que Twitch enregistre du direct
    en cours -- le meme lecteur que les autres videos, avec la barre complete -- pendant que le direct se
    reduit dans le coin. Sans enregistrement (la chaine ne garde pas ses VODs), il n'y a rien a jouer.
  */
  function PlayRecordingFromStart(sId, sTitle) {
    Check(IsNonEmptyString(sId));
    Open();
    PlayItem({ sKind: "video", sId: sId, sTitle: sTitle || "", bFromStart: true });
  }

  return {
    Start,
    IsOpen,
    Open,
    Close,
    CloseTopmost,
    Toggle,
    PlayRecordingFromStart,
  };
})();
