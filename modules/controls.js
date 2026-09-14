"use strict";

const m_Controls = (() => {
  const SEEK_BY_ARROWS_BY = 5;
  const SEEK_BY_FRAMES_BY = 3;
  const BROADCAST_TITLE_UNKNOWN = "• • •";
  let _nState;
  let _oPlaybackStart,
    _oBufferSize,
    _oBufferStretch,
    _oReplayDuration;
  let _oAutoHideInterval;
  function startWheelVolumeChange() {
    document.removeEventListener("pointerdown", handleWheelPress);
    document.removeEventListener("wheel", handleWheelRotate);
    if (m_Settings.Get("bWheelVolume")) {
      document.addEventListener("pointerdown", handleWheelPress);
      if (m_Settings.Get("nWheelVolumeStep") !== 0) {
        document.addEventListener("wheel", handleWheelRotate, {
          passive: false,
        });
      }
    }
  }
  const handleWheelPress = createElementEventHandler(
    (oEvent) => {
      if (
        !(
          oEvent.button !== MIDDLE_BUTTON ||
          oEvent.shiftKey ||
          oEvent.ctrlKey ||
          oEvent.altKey ||
          oEvent.metaKey ||
          IsLinkEvent(oEvent)
        )
      ) {
        oEvent.preventDefault();
        SaveAndApplyVolume(!m_Settings.Get("bMute"));
      }
    }
  );
  const handleWheelRotate = AddExceptionHandler((oEvent) => {
    if (
      !(
        oEvent.shiftKey ||
        oEvent.ctrlKey ||
        oEvent.altKey ||
        oEvent.metaKey ||
        ElementAtThisPointCanScroll(oEvent.clientX, oEvent.clientY)
      )
    ) {
      oEvent.preventDefault();
      m_Log.Here(
        `[Controls] Wheel movement deltaY=${oEvent.deltaY} deltaMode=${oEvent.deltaMode}`
      );
      if (oEvent.deltaY !== 0) {
        SaveAndApplyVolume(
          void 0,
          Clamp(
            m_Settings.Get("nVolume2") -
            m_Settings.Get("nWheelVolumeStep") *
            Math.sign(oEvent.deltaY),
            MIN_VOLUME,
            MAX_VOLUME
          )
        );
      }
    }
  });
  function ApplyImageScaling() {
    GetNode("eye").classList.toggle(
      "scaled",
      m_Settings.Get("bScaleImage")
    );
  }
  function ApplyInterfaceAnimation() {
    document.body.classList.toggle(
      "interfaceanimation",
      m_Settings.Get("bInterfaceAnimation")
    );
  }
  function StopWatchingBroadcast() {
    if (
      _nState === STATE_STOP ||
      _nState === STATE_REPEAT
    ) {
      return false;
    }
    m_Log.Wow("[Controls] Stopping broadcast viewing");
    m_Playlist.Stop();
    m_Transcoder.Stop();
    g_maQueue.Clear();
    g_maQueue.Add(new Segment(PROCESSING_CONVERTED, STATE_REPEAT));
    m_Player.AddNextSegment();
    return true;
  }
  function ToggleWatchingBroadcast() {
    if (!StopWatchingBroadcast()) {
      m_Log.Wow("[Controls] Starting broadcast viewing");
      g_maQueue.Clear();
      m_Player.Reload(STATE_START);
      m_Playlist.Start();
    }
  }
  function ToggleStatisticsWindow() {
    if (m_Statistics.WindowOpened()) {
      m_Statistics.CloseWindow();
    } else {
      m_Statistics.OpenWindow();
    }
  }
  function ToggleColourCheck(oEvent) {
    if (document.body.classList.toggle("colourcheck")) {
      document.body.classList.toggle("colourcheckbackground", !oEvent.shiftKey);
      m_News.OpenHelp();
    } else {
      document.body.classList.remove("colourcheckbackground");
    }
  }
  function CopyTextToClipboard(sText) {
    Check(typeof sText == "string");
    if (sText === "") {
      m_Notification.ShowAss();
      return;
    }
    navigator.clipboard
      .writeText(sText)
      .then(
        () => {
          m_Log.Here("[Controls] Copy to clipboard finished");
          m_Notification.ShowHappiness();
        },
        (pReason) => {
          m_Log.Oops(
            `[Controls] Error copying to clipboard: ${pReason}`
          );
          m_Notification.ShowAss();
        }
      )
      .catch(m_Debug.CaughtException);
  }
  function CopyBroadcastUrlToClipboard() {
    if (CopyBroadcastUrlToClipboard.bInProgress) {
      return;
    }
    CopyBroadcastUrlToClipboard.bInProgress = true;
    m_Log.Wow("[Controls] Getting broadcast address to copy");
    m_Twitch
      .GetAbsoluteVariantListUrl(null, true, false)
      .then((sResult) => {
        m_Log.Here("[Controls] Copying broadcast address to clipboard");
        return navigator.clipboard.writeText(sResult).then(
          () => {
            CopyBroadcastUrlToClipboard.bInProgress = false;
            m_Log.Here("[Controls] Copy to clipboard finished");
            m_Controls.StopWatchingBroadcast();
            m_Notification.ShowHappiness();
          },
          (pReason) => {
            throw `Error copying to clipboard: ${pReason}`;
          }
        );
      })
      .catch(
        AddExceptionHandler((pReason) => {
          CopyBroadcastUrlToClipboard.bInProgress = false;
          if (typeof pReason == "string") {
            m_Log.Oops(
              `[Controls] Error copying broadcast address to clipboard: ${pReason}`
            );
            m_Notification.ShowAss();
          } else {
            throw pReason;
          }
        })
      );
  }
  const HandleVolumeChange = AddExceptionHandler(
    (oEvent) => {
      SaveAndApplyVolume(false, oEvent.target.valueAsNumber);
    }
  );
  function SaveAndApplyVolume(bMute, nVolume) {
    Check(bMute !== void 0 || nVolume !== void 0);
    if (document.body.classList.contains("noaudio")) {
      return;
    }
    if (bMute !== void 0) {
      m_Settings.Change("bMute", bMute);
    }
    if (nVolume !== void 0) {
      m_Settings.Change("nVolume2", Math.round(nVolume));
    }
    m_Player.ApplyVolume();
    UpdateVolume();
    m_AutoHide.Show();
  }
  function UpdateVolume() {
    const nVolume = m_Settings.Get("nVolume2");
    const nodeVolume = GetNode("volume");
    nodeVolume.value = nVolume;
    nodeVolume.style.setProperty(
      "--width",
      `${((nVolume - MIN_VOLUME) / (100 - MIN_VOLUME)) *
      100
      }%`
    );
    ChangeButton(
      "togglemute",
      m_Settings.Get("bMute")
    );
  }
  function UpdateTrackCount(bHasVideo, bHasAudio) {
    document.body.classList.toggle("novideo", !bHasVideo);
    document.body.classList.toggle("noaudio", !bHasAudio);
  }
  function ChangeViewerChannelSubscription(nSubscription) {
    if (
      !document
        .getElementById("viewer-subscription")
        .classList.contains("updating")
    ) {
      m_Twitch.ChangeViewerChannelSubscription(nSubscription);
    }
  }
  const HandleLeftClick = createElementEventHandler((oEvent) => {
    if (oEvent.button !== LEFT_BUTTON) {
      return;
    }
    const nodeClick = oEvent.target;
    let nodeCallsign = nodeClick;
    let sCallsign = nodeCallsign.id || nodeCallsign.name;
    if (!sCallsign && nodeClick.parentNode) {
      nodeCallsign = nodeClick.parentNode;
      sCallsign = nodeCallsign.id || nodeCallsign.name;
    }
    oEvent.nodeCallsign = nodeCallsign;
    oEvent.sCallsign = sCallsign;
    m_Events.SendEvent("controls-leftclick", oEvent);
    switch (sCallsign) {
      case "togglebroadcast":
        ToggleWatchingBroadcast();
        break;

      case "togglepause":
        if (_nState === STATE_REPEAT) {
          m_Player.TogglePause();
        }
        break;

      case "togglemute":
        SaveAndApplyVolume(!m_Settings.Get("bMute"));
        break;

      case "togglechat":
        m_Chat.TogglePanelState();
        break;

      case "createclip":
        m_Twitch.CreateClip();
        break;

      case "togglepictureinpicture":
        m_PictureInPicture.toggle();
        break;

      case "togglefullscreen":
        m_FullscreenMode.Toggle();
        break;

      case "concurrentdownloads":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nConcurrentDownloads",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Statistics.ClearHistory();
        break;

      case "interfaceanimation":
        m_Settings.Change("bInterfaceAnimation", nodeClick.checked);
        ApplyInterfaceAnimation();
        break;

      case "scaleimage":
        m_Settings.Change("bScaleImage", nodeClick.checked);
        ApplyImageScaling();
        break;

      case "autochatposition":
        m_Settings.Change("bAutoChatPosition", nodeClick.checked);
        UpdateSettingsWindow();
        m_Chat.ApplyPanelPosition();
        break;

      case "horizontalchatposition":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nHorizontalChatPosition",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Chat.ApplyPanelPosition();
        break;

      case "verticalchatposition":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nVerticalChatPosition",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Chat.ApplyPanelPosition();
        break;

      case "chatposition":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nChatPanelPosition",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Chat.ApplyPanelPosition();
        break;

      case "closedchatstate":
        Check(nodeClick.checked);
        m_Chat.SaveAndApplyClosedPanelState(
          Number.parseInt(nodeClick.value, 10)
        );
        break;

      case "togglestatistics":
      case "position":
        ToggleStatisticsWindow();
        break;

      case "opennews":
      case "opennews2":
        m_News.OpenNews();
        break;

      case "openhelp":
        m_News.OpenHelp();
        break;

      case "sendfeedback":
        m_Debug.TerminateAndSendFeedback();
        break;

      case "exportsettings":
        m_Settings.Export();
        break;

      case "importsettings":
        const node = document.getElementById("settingsimportfile");
        node.value = "";
        node.click();
        break;

      case "resetsettings":
        m_Settings.Reset();
        break;

      case "colourcheck":
        ToggleColourCheck(oEvent);
        break;

      case "viewer-follow":
        ChangeViewerChannelSubscription(SUBSCRIPTION_NOTIFY);
        break;

      case "viewer-unfollow":
        ChangeViewerChannelSubscription(SUBSCRIPTION_NOT_SUBSCRIBED);
        break;

      case "viewer-notify":
        ChangeViewerChannelSubscription(
          nodeClick.checked ? SUBSCRIPTION_NOTIFY : SUBSCRIPTION_DO_NOT_NOTIFY
        );
        break;

      case "closestatistics":
        m_Statistics.CloseWindow();
        break;

      case "copychannelurl":
        m_Log.Here("[Controls] Copying channel address to clipboard");
        CopyTextToClipboard(m_Twitch.GetChannelUrl(false));
        break;

      case "copybroadcasturl":
        CopyBroadcastUrlToClipboard();
    }
  });
  const HandleKeyDownAndUp = AddExceptionHandler(
    (oEvent) => {
      const SHIFT_KEY = 1 << 16;
      const CTRL_KEY = 1 << 17;
      const ALT_KEY = 1 << 18;
      const META_KEY = 1 << 19;
      const bPress = oEvent.type === "keydown";
      const bPress1 = bPress && !oEvent.repeat;
      switch (
      oEvent.keyCode +
      oEvent.shiftKey * SHIFT_KEY +
      oEvent.ctrlKey * CTRL_KEY +
      oEvent.altKey * ALT_KEY +
      oEvent.metaKey * META_KEY
      ) {
        case 27:
          oEvent.preventDefault();
          if (bPress1) {
            getSelection().removeAllRanges();
            m_Window.close(false);
            m_AutoHide.Hide(false);
          }
          break;

        case 70:
        case 13:
        case 13 + ALT_KEY:
          if (bPress1) {
            m_FullscreenMode.Toggle();
          }
          break;

        case 13 + SHIFT_KEY:
          if (bPress1) {
            m_PictureInPicture.toggle();
          }
          break;

        case 93:
          if (!bPress) {
            GetNode("eye").focus();
          }
          return;

        case 88:
          if (bPress1) {
            m_Window.toggle("mainmenu");
          }
          break;

        case 67:
          if (bPress1) {
            m_Chat.TogglePanelState();
          }
          break;

        case 86:
          if (bPress1) {
            m_Window.toggle("settings");
          }
          break;

        case 73:
          if (bPress1) {
            m_Window.toggle("channel");
          }
          break;

        case 83:
          if (bPress1) {
            ToggleStatisticsWindow();
          }
          break;

        case 112:
          if (bPress1) {
            m_News.OpenHelp();
          }
          break;

        case 65 + CTRL_KEY:
          break;

        case 85 + CTRL_KEY:
          if (bPress1) {
            m_Chat.TogglePanelPosition();
            UpdateSettingsWindow();
          }
          break;

        case 32:
          if (bPress1) {
            ToggleWatchingBroadcast();
            m_AutoHide.Show();
          }
          break;

        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
        case 48:
          if (bPress1 && _nState === STATE_REPEAT) {
            setReplaySpeed(
              58 - (oEvent.keyCode === 48 ? 58 : oEvent.keyCode)
            );
            m_AutoHide.Show();
          }
          break;

        case 187:
        case 107:
        case 190:
          if (bPress1 && _nState === STATE_REPEAT) {
            setReplaySpeed(-Infinity);
            m_AutoHide.Show();
          }
          break;

        case 189:
        case 109:
        case 188:
          if (bPress1 && _nState === STATE_REPEAT) {
            setReplaySpeed(Infinity);
            m_AutoHide.Show();
          }
          break;

        case 75:
        case 12:
          if (bPress1 && _nState === STATE_REPEAT) {
            m_Player.TogglePause();
            m_AutoHide.Show();
          }
          break;

        case 74:
        case 37:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(
              `[Controls] Seeking by -${SEEK_BY_ARROWS_BY}s`
            );
            m_Player.SeekReplayBy(
              false,
              -SEEK_BY_ARROWS_BY
            );
            m_AutoHide.Show();
          }
          break;

        case 76:
        case 39:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(
              `[Controls] Seeking by +${SEEK_BY_ARROWS_BY}s`
            );
            m_Player.SeekReplayBy(
              false,
              SEEK_BY_ARROWS_BY
            );
            m_AutoHide.Show();
          }
          break;

        case 74 + SHIFT_KEY:
        case 37 + SHIFT_KEY:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(
              `[Controls] Seeking by -${SEEK_BY_FRAMES_BY} frames`
            );
            m_Player.SeekReplayBy(
              true,
              -SEEK_BY_FRAMES_BY
            );
          }
          break;

        case 76 + SHIFT_KEY:
        case 39 + SHIFT_KEY:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(`[Controls] Seeking by +1 frame`);
            m_Player.SeekReplayBy(true, 1);
          }
          break;

        case 38:
          if (bPress) {
            SaveAndApplyVolume(
              false,
              Math.min(
                m_Settings.Get("nVolume2") +
                VOLUME_INCREASE_STEP_BY_KEY,
                MAX_VOLUME
              )
            );
          }
          break;

        case 40:
          if (bPress) {
            SaveAndApplyVolume(
              false,
              Math.max(
                m_Settings.Get("nVolume2") -
                VOLUME_DECREASE_STEP_BY_KEY,
                MIN_VOLUME
              )
            );
          }
          break;

        case 33:
          if (bPress1) {
            SaveAndApplyVolume(false);
          }
          break;

        case 34:
          if (bPress1) {
            SaveAndApplyVolume(true);
          }
          break;

        case 77:
          if (bPress1) {
            SaveAndApplyVolume(!m_Settings.Get("bMute"));
          }
          break;

        case 73 + CTRL_KEY:
          if (bPress1) {
            const bScaleImage = m_Settings.Get(
              "bScaleImage"
            );
            m_Settings.Change(
              "bScaleImage",
              !bScaleImage
            );
            UpdateSettingsWindow();
            ApplyImageScaling();
            m_Notification.Show(
              `svg-fullscreen-${bScaleImage}`,
              false
            );
          }
          break;

        case 88 + ALT_KEY:
          if (bPress1) {
            m_Twitch.CreateClip();
          }
          break;

        default:
          return;
      }
      oEvent.preventDefault();
    }
  );
  function UpdateSettingsWindow() {
    document.querySelector(
      `input[name="concurrentdownloads"][value="${m_Settings.Get(
        "nConcurrentDownloads"
      )}"]`
    ).checked = true;
    document.querySelector(
      `input[name="closedchatstate"][value="${m_Settings.Get(
        "nClosedChatState"
      )}"]`
    ).checked = true;
    GetNode("chaturl").selectedIndex = m_Settings.Get("bFullChat")
      ? 0
      : m_Settings.Get("bDimChat")
        ? 2
        : 1;
    GetNode("scaleimage").checked = m_Settings.Get(
      "bScaleImage"
    );
    GetNode("interfaceanimation").checked = m_Settings.Get(
      "bInterfaceAnimation"
    );
    GetNode("wheelvolume").value = m_Settings.Get(
      "bWheelVolume"
    )
      ? m_Settings.Get("nWheelVolumeStep")
      : "";
    const bAutoPosition = m_Settings.Get("bAutoChatPosition");
    GetNode("autochatposition").checked = bAutoPosition;
    const snodeSides = document.querySelectorAll(".chatposition input");
    if (bAutoPosition) {
      const nHorizontalPosition = m_Settings.Get(
        "nHorizontalChatPosition"
      );
      const nVerticalPosition = m_Settings.Get(
        "nVerticalChatPosition"
      );
      let nodeHorizontalPosition, nodeVerticalPosition;
      for (let nodeSide of snodeSides) {
        const nSide = Number.parseInt(nodeSide.value, 10);
        if (nHorizontalPosition === nSide) {
          nodeHorizontalPosition = nodeSide;
        }
        if (nVerticalPosition === nSide) {
          nodeVerticalPosition = nodeSide;
        }
        nodeSide.name =
          nSide === RIGHT_SIDE || nSide === LEFT_SIDE
            ? "horizontalchatposition"
            : "verticalchatposition";
      }
      nodeHorizontalPosition.checked =
        nodeVerticalPosition.checked = true;
    } else {
      const nPosition = m_Settings.Get("nChatPanelPosition");
      let nodePosition;
      for (let nodeSide of snodeSides) {
        if (nPosition === Number.parseInt(nodeSide.value, 10)) {
          nodePosition = nodeSide;
        }
        nodeSide.name = "chatposition";
      }
      nodePosition.checked = true;
    }
    if (_oPlaybackStart) {
      _oPlaybackStart.Update();
      _oBufferSize.Update();
      _oBufferStretch.Update();
      _oReplayDuration.Update();
      _oAutoHideInterval.Update();
    } else {
      _oPlaybackStart = new NumberInput(
        "nPlaybackStart",
        0.5,
        1,
        "playbackstart"
      );
      _oBufferSize = new NumberInput("nBufferSize", 0.5, 1, "buffersize");
      _oBufferStretch = new NumberInput(
        "nBufferStretch",
        0.5,
        1,
        "bufferstretch"
      );
      _oReplayDuration = new NumberInput(
        "nReplayDuration2",
        30,
        0,
        "replayduration"
      );
      _oPlaybackStart.AfterChange =
        _oBufferSize.AfterChange =
        _oBufferStretch.AfterChange =
        m_Statistics.ClearHistory;
      _oAutoHideInterval = new NumberInput(
        "nAutoHideInterval",
        0.5,
        1,
        "autohideinterval"
      );
    }
  }
  function HandleMainMenuOpen() {
    const elItem = GetNode("recordingurl");
    const sAddress = m_Twitch.GetRecordingUrlForCurrentPosition();
    if (sAddress) {
      elItem.href = sAddress;
      m_Menu.setItemAvailability(elItem, true);
    } else {
      elItem.removeAttribute("href");
      m_Menu.setItemAvailability(elItem, false);
    }
  }
  function HandlePause(bPause) {
    ChangeButton("togglepause", bPause);
  }
  function HandleBufferingPresetChange() {
    UpdateSettingsWindow();
    m_Statistics.ClearHistory();
  }
  function getReplaySpeed() {
    const nodeSpeed = GetNode("speed");
    if (nodeSpeed.options[0].text === "") {
      for (const node of nodeSpeed.options) {
        node.text = node.defaultSelected
          ? "1x"
          : m_i18n.FormatNumber(node.value, 2);
      }
    }
    const nSpeed = Number.parseFloat(nodeSpeed.value);
    Check(nSpeed > 0);
    return nSpeed;
  }
  function setReplaySpeed(nCode) {
    const nodeSpeed = GetNode("speed");
    if (!Number.isSafeInteger(nCode)) {
      Check(
        nodeSpeed.selectedIndex >= 0 &&
        (nCode === -Infinity || nCode === Infinity)
      );
      nCode = nodeSpeed.selectedIndex + Math.sign(nCode);
    }
    if (nCode >= 0 && nCode < nodeSpeed.options.length) {
      nodeSpeed.selectedIndex = nCode;
      m_Player.SetReplaySpeed(getReplaySpeed());
    }
  }
  const HandlePlaybackSpeedChange =
    AddExceptionHandler((oEvent) => {
      if (_nState === STATE_REPEAT) {
        m_Player.SetReplaySpeed(getReplaySpeed());
      }
    });
  const HandleBroadcastVariantChange = AddExceptionHandler(
    ({ target: { selectedIndex } }) => {
      if (selectedIndex !== -1) {
        m_Log.Wow(`[Controls] Variant selected ${selectedIndex}`);
        m_Playlist.ChangeBroadcastVariant(selectedIndex);
      }
    }
  );
  const HandleWheelVolumeChange = AddExceptionHandler(
    (oEvent) => {
      if (oEvent.target.value) {
        m_Settings.Change("bWheelVolume", true);
        m_Settings.Change(
          "nWheelVolumeStep",
          Number(oEvent.target.value)
        );
      } else {
        m_Settings.Change("bWheelVolume", false);
      }
      startWheelVolumeChange();
    }
  );
  const HandleChatUrlChange = AddExceptionHandler(
    (oEvent) => {
      m_Log.Wow(
        `[Controls] Chat address selected ${oEvent.target.selectedIndex}`
      );
      switch (oEvent.target.selectedIndex) {
        case 0:
          m_Settings.Change("bFullChat", true);
          break;

        case 1:
          m_Settings.Change("bFullChat", false);
          m_Settings.Change("bDimChat", false);
          break;

        case 2:
          m_Settings.Change("bFullChat", false);
          m_Settings.Change("bDimChat", true);
          break;

        default:
          Check(false);
      }
      m_Chat.ApplyUrl();
    }
  );
  const HandleSettingsImportFileChoice = AddExceptionHandler(
    (oEvent) => {
      if (oEvent.target.files.length === 1) {
        m_Settings.Import(oEvent.target.files[0]);
      }
    }
  );
  function UpdateBroadcastVariantList([moVariants, oSelectedVariant]) {
    const nodeList = GetNode("broadcastvariant");
    nodeList.length = 0;
    if (moVariants) {
      for (const oVariant of moVariants) {
        let sLabel = oVariant.sLabel;
        if (sLabel === "audio_only") {
          sLabel = GetText("J0144");
        } else if (sLabel.endsWith("(source)")) {
          sLabel = sLabel.slice(0, -8) + GetText("J0139");
        }
        nodeList.add(
          new Option(
            sLabel,
            void 0,
            oVariant === oSelectedVariant,
            oVariant === oSelectedVariant
          )
        );
      }
    }
    nodeList.disabled = nodeList.length < 2;
  }
  function handleAdStart() {
    document.body.classList.add("advert");
  }
  function handleAdEnd() {
    document.body.classList.remove("advert");
  }
  function handleBufferOverflow() {
    m_Notification.Show("svg-cut", true);
  }
  function Start() {
    Check(_nState === void 0);
    GetNode("broadcasttitle").href = m_Twitch.GetChannelUrl(true);
    const nodeVolume = GetNode("volume");
    nodeVolume.min = MIN_VOLUME;
    nodeVolume.addEventListener("input", HandleVolumeChange);
    UpdateVolume();
    UpdateSettingsWindow();
    m_Settings.ConfigurePresetLists();
    m_AutoHide.Start();
    m_AutoHide.Show();
    m_News.Start();
    m_Chat.Restore();
    m_Events.AddHandler(
      "window-opened-mainmenu",
      HandleMainMenuOpen
    );
    m_Events.AddHandler(
      "playlist-broadcastvariantselected",
      UpdateBroadcastVariantList
    );
    m_Events.AddHandler(
      "playlist-adstart",
      handleAdStart
    );
    m_Events.AddHandler("playlist-adend", handleAdEnd);
    m_Events.AddHandler(
      "player-bufferoverflow",
      handleBufferOverflow
    );
    m_Events.AddHandler("player-paused", HandlePause);
    m_Events.AddHandler(
      "settings-presetchanged-buffering",
      HandleBufferingPresetChange
    );
    m_Events.AddHandler(
      "twitch-channelmetadatareceived",
      ShowChannelMetadata
    );
    m_Events.AddHandler(
      "twitch-viewermetadatareceived",
      ShowViewerMetadata
    );
    m_Events.AddHandler(
      "twitch-broadcastmetadatareceived",
      ShowBroadcastMetadata
    );
    document.documentElement.addEventListener("click", HandleLeftClick);
    document.addEventListener("keydown", HandleKeyDownAndUp);
    document.addEventListener("keyup", HandleKeyDownAndUp);
    GetNode("speed").addEventListener(
      "change",
      HandlePlaybackSpeedChange
    );
    GetNode("broadcastvariant").addEventListener(
      "change",
      HandleBroadcastVariantChange
    );
    GetNode("wheelvolume").addEventListener(
      "change",
      HandleWheelVolumeChange
    );
    GetNode("chaturl").addEventListener("change", HandleChatUrlChange);
    GetNode("settingsimportfile").addEventListener(
      "change",
      HandleSettingsImportFileChoice
    );
    startWheelVolumeChange();
    ChangeState(STATE_START);
    ApplyImageScaling();
    ApplyInterfaceAnimation();
    m_Appearance.Start();
  }
  function ChangeState(nNewState) {
    Check(Number.isInteger(nNewState));
    if (_nState === nNewState) {
      return;
    }
    m_Log.Here(
      `[Controls] Broadcast state changed from ${_nState} to ${nNewState}`
    );
    _nState = nNewState;
    document.body.setAttribute("data-state", nNewState);
    ChangeButton(
      "togglebroadcast",
      nNewState === STATE_STOP ||
      nNewState === STATE_REPEAT
    );
    m_Events.SendEvent("controls-statechanged", nNewState);
    switch (nNewState) {
      case STATE_START:
        ShowBroadcastMetadata({
          sBroadcastType: null,
          sBroadcastTitle: BROADCAST_TITLE_UNKNOWN,
          sGameName: null,
          sGameUrl: null,
          kViewers: null,
          nBroadcastDuration: null,
        });
        m_Twitch.FinishCollectingBroadcastMetadata(true);
        break;

      case STATE_BROADCAST_START:
        ShowBroadcastMetadata({
          sBroadcastType: null,
          sBroadcastTitle: BROADCAST_TITLE_UNKNOWN,
          sGameName: null,
          sGameUrl: null,
          kViewers: null,
          nBroadcastDuration: null,
        });
        m_Twitch.StartCollectingBroadcastMetadata();
        break;

      case STATE_BROADCAST_END:
        ShowBroadcastMetadata({
          sBroadcastType: "ended",
          kViewers: null,
          nBroadcastDuration: null,
        });
        m_Twitch.FinishCollectingBroadcastMetadata(true);
        GetNode("statistics-broadcastlatency").textContent = "";
        break;

      case STATE_LOADING:
      case STATE_PLAYBACK_START:
      case STATE_PLAYING:
        break;

      case STATE_STOP:
      case STATE_REPEAT:
        ShowBroadcastMetadata({
          kViewers: null,
        });
        m_Twitch.FinishCollectingBroadcastMetadata(false);
        GetNode("statistics-broadcastlatency").textContent = "";
        break;

      default:
        Check(false);
    }
  }
  function GetState() {
    Check(_nState !== void 0);
    return _nState;
  }
  function ShowChannelMetadata(oMetadata) {
    if (oMetadata.sName !== void 0) {
      ChangeDocumentTitle(
        `${oMetadata.sName} - Alternate Player for Twitch.tv`
      );
      GetNode("channel-name").textContent = oMetadata.sName;
    }
    if (oMetadata.sAvatar !== void 0) {
      Check(oMetadata.sAvatar);
      GetNode("channel-avatar").src = oMetadata.sAvatar;
    }
    if (oMetadata.sDescription !== void 0) {
      GetNode("channel-description").textContent = oMetadata.sDescription || "";
    }
    if (oMetadata.sLanguageCode !== void 0) {
      const node = GetNode("channel-language");
      if (oMetadata.sLanguageCode) {
        node.textContent = m_i18n.GetLanguageName(oMetadata.sLanguageCode);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.kSubscribers !== void 0) {
      const node = GetNode("channel-subscribers");
      if (Number.isFinite(oMetadata.kSubscribers)) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kSubscribers);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.nChannelCreated !== void 0) {
      const node = GetNode("channel-created");
      if (Number.isFinite(oMetadata.nChannelCreated)) {
        node.textContent = m_i18n.FormatDate(oMetadata.nChannelCreated);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.moTeams !== void 0) {
      ShowLinkArray(oMetadata.moTeams, "channel-teams");
    }
  }
  function ShowLinkArray(moLinks, pInsert) {
    const nodeInsert = GetNode(pInsert);
    if (moLinks.length === 0) {
      ShowElement(nodeInsert.parentNode, false);
    } else {
      const oFragment = document.createDocumentFragment();
      for (let oLink, idx = 0; (oLink = moLinks[idx]); ++idx) {
        if (idx !== 0) {
          oFragment.appendChild(document.createTextNode(", "));
        }
        Check(
          IsNonEmptyString(oLink.sAddress) && IsNonEmptyString(oLink.sName)
        );
        const nodeLink = document.createElement("a");
        nodeLink.href = oLink.sAddress;
        nodeLink.rel = "noopener noreferrer";
        nodeLink.target = "_blank";
        if (oLink.sDescription) {
          nodeLink.className = "channel-link";
          nodeLink.title = oLink.sDescription;
        }
        nodeLink.textContent = oLink.sName;
        oFragment.appendChild(nodeLink);
      }
      nodeInsert.textContent = "";
      nodeInsert.appendChild(oFragment);
      ShowElement(nodeInsert.parentNode, true);
    }
  }
  function ShowViewerMetadata(oMetadata) {
    if (oMetadata.sName !== void 0) {
      if (oMetadata.sName !== "") {
        GetNode("viewer-name").textContent = oMetadata.sName;
      } else {
        m_i18n.InsertAdjacentHtmlMessage("viewer-name", "content", "F0590");
      }
    }
    if (oMetadata.nSubscription !== void 0) {
      const node = GetNode("viewer-subscription");
      if (oMetadata.nSubscription === SUBSCRIPTION_UPDATING) {
        node.classList.add("updating");
      } else {
        node.classList.remove("updating");
        node.setAttribute("data-subscription", oMetadata.nSubscription);
        GetNode("viewer-notify").checked =
          oMetadata.nSubscription === SUBSCRIPTION_NOTIFY;
      }
    }
  }
  /*
		Cles de valeurs internes, pas de valeurs de Twitch. Twitch envoie « live » ou « rerun » ;
		le producteur plus bas les traduit en « live », « replay » ou null, et la fin de diffusion
		pose « ended ». Ces trois cles doivent donc suivre le producteur lettre pour lettre --
		elles sont des identifiants d'objet, qu'un renommage de chaines ne voit pas.
	*/
  const _oBroadcastTypes = {
    ended: ["J0145", "J0100", false],
    live: ["J0146", "J0149", true],
    replay: ["J0147", "J0150", false],
  };
  function ShowBroadcastMetadata(oMetadata) {
    if (oMetadata.sBroadcastType !== void 0) {
      const node = GetNode("broadcasttype");
      if (typeof oMetadata.sBroadcastType == "string") {
        Check(_oBroadcastTypes.hasOwnProperty(oMetadata.sBroadcastType));
        node.textContent = GetText(_oBroadcastTypes[oMetadata.sBroadcastType][0]);
        node.parentElement.title = GetText(
          _oBroadcastTypes[oMetadata.sBroadcastType][1]
        );
        node.classList.toggle(
          "livebroadcast",
          _oBroadcastTypes[oMetadata.sBroadcastType][2]
        );
        ShowElement(node.parentElement, true);
      } else {
        ShowElement(node.parentElement, false);
      }
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.sBroadcastTitle !== void 0) {
      Check(oMetadata.sBroadcastTitle !== null);
      const node = GetNode("broadcasttitle");
      node.title = oMetadata.sBroadcastTitle + GetText("J0101");
      node.textContent = oMetadata.sBroadcastTitle;
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.sGameName !== void 0) {
      const node = GetNode("broadcastcategory");
      if (oMetadata.sGameName) {
        node.textContent = oMetadata.sGameName;
        node.title = node.previousElementSibling.title =
          oMetadata.sGameName + GetText("J0102");
        if (oMetadata.sGameUrl) {
          node.href = oMetadata.sGameUrl;
        } else {
          node.removeAttribute("href");
        }
        ShowElement(node, true);
        ShowElement(node.previousElementSibling, true);
      } else {
        ShowElement(node, false);
        ShowElement(node.previousElementSibling, false);
      }
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.kViewers !== void 0) {
      const node = GetNode("viewercount");
      if (
        Number.isFinite(oMetadata.kViewers) &&
        oMetadata.kViewers >= 0
      ) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kViewers);
        ShowElement(node, true);
        ShowElement(node.previousElementSibling, true);
      } else {
        ShowElement(node, false);
        ShowElement(node.previousElementSibling, false);
      }
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.nBroadcastDuration !== void 0) {
      GetNode("position").textContent =
        Number.isFinite(oMetadata.nBroadcastDuration) &&
          oMetadata.nBroadcastDuration >= 0
          ? m_i18n.SecondsToString(
            oMetadata.nBroadcastDuration / 1e3,
            false
          )
          : "";
    }
  }
  return {
    Start,
    GetState,
    ChangeState,
    getReplaySpeed,
    UpdateTrackCount,
    StopWatchingBroadcast,
  };
})();
