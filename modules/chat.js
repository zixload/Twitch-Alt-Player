"use strict";

const m_Chat = (() => {
  let _nodeChat = null;
  //! <iframe>
  function GetPanelPosition() {
    switch (
    getComputedStyle(document.getElementById("playerandchat"))
      .flexDirection
    ) {
      case "column-reverse":
        return TOP_SIDE;

      case "row":
        return RIGHT_SIDE;

      case "column":
        return BOTTOM_SIDE;

      case "row-reverse":
        return LEFT_SIDE;

      default:
        Check(false);
    }
  }
  function InsertPanel() {
    if (_nodeChat) {
      return;
    }
    const sAddress = m_Twitch.openChat();
    m_Log.Here(`[Chat] Inserting iframe ${sAddress}`);
    _nodeChat = document.createElement("iframe");
    _nodeChat.src = sAddress;
    _nodeChat.id = "chat";
    _nodeChat.width = m_Settings.Get("nChatPanelWidth");
    _nodeChat.height = m_Settings.Get("nChatPanelHeight");
    GetNode("chatsize").insertAdjacentElement("afterend", _nodeChat);
  }
  function RemovePanel() {
    if (_nodeChat) {
      m_Log.Here(`[Chat] Removing iframe ${_nodeChat.src}`);
      m_Twitch.closeChat();
      _nodeChat.remove();
      _nodeChat = null;
    }
  }
  function ApplyUrl() {
    if (_nodeChat) {
      m_Log.Wow("[Chat] Changing iframe address");
      RemovePanel();
      InsertPanel();
    }
  }
  function ApplyPanelState() {
    const nState = m_Settings.Get("nChatState");
    m_Log.Wow(`[Chat] New panel state: ${nState}`);
    CancelPanelDrag();
    switch (nState) {
      case CHAT_UNLOADED:
        document.body.classList.add("hidechat");
        RemovePanel();
        break;

      case CHAT_HIDDEN:
        InsertPanel();
        document.body.classList.add("hidechat");
        break;

      case CHAT_PANEL:
        InsertPanel();
        document.body.classList.remove("hidechat");
        break;

      default:
        Check(false);
    }
    m_MediaQuery.updateSlowly();
  }
  function ApplyPanelPosition() {
    CancelPanelDrag();
    const oClasses = document.body.classList;
    if (m_Settings.Get("bAutoChatPosition")) {
      oClasses.add("autochatposition");
      oClasses.toggle(
        "chattop",
        m_Settings.Get("nVerticalChatPosition") === TOP_SIDE
      );
      oClasses.toggle(
        "chatleft",
        m_Settings.Get("nHorizontalChatPosition") === LEFT_SIDE
      );
    } else {
      const nPosition = m_Settings.Get("nChatPanelPosition");
      oClasses.remove("autochatposition");
      oClasses.toggle("chattop", nPosition === TOP_SIDE);
      oClasses.toggle("chatright", nPosition === RIGHT_SIDE);
      oClasses.toggle("chatbottom", nPosition === BOTTOM_SIDE);
      oClasses.toggle("chatleft", nPosition === LEFT_SIDE);
    }
    m_MediaQuery.updateSlowly();
  }
  function SaveAndApplyClosedPanelState(nNewState) {
    m_Settings.Change("nClosedChatState", nNewState);
    const nState = m_Settings.Get("nChatState");
    if (
      (nState === CHAT_UNLOADED || nState === CHAT_HIDDEN) &&
      nState !== nNewState
    ) {
      m_Settings.Change("nChatState", nNewState);
      ApplyPanelState();
    }
  }
  function TogglePanelState() {
    const bFullscreen = m_FullscreenMode.Enabled();
    switch (m_Settings.Get("nChatState")) {
      case CHAT_UNLOADED:
      case CHAT_HIDDEN:
        m_Settings.Change("nChatState", CHAT_PANEL, bFullscreen);
        break;

      case CHAT_PANEL:
        m_Settings.Change(
          "nChatState",
          bFullscreen
            ? CHAT_HIDDEN
            : m_Settings.Get("nClosedChatState"),
          bFullscreen
        );
        break;

      default:
        Check(false);
    }
    ApplyPanelState();
  }
  function TogglePanelPosition() {
    if (m_Settings.Get("nChatState") !== CHAT_PANEL) {
      return;
    }
    let nPosition;
    if (m_Settings.Get("bAutoChatPosition")) {
      m_Settings.Change("bAutoChatPosition", false);
      nPosition = GetPanelPosition();
    } else {
      nPosition = m_Settings.Get("nChatPanelPosition");
    }
    switch (nPosition) {
      case TOP_SIDE:
        m_Settings.Change("nChatPanelPosition", RIGHT_SIDE);
        break;

      case RIGHT_SIDE:
        m_Settings.Change("nChatPanelPosition", BOTTOM_SIDE);
        break;

      case BOTTOM_SIDE:
        m_Settings.Change("nChatPanelPosition", LEFT_SIDE);
        break;

      case LEFT_SIDE:
        m_Settings.Change("nChatPanelPosition", TOP_SIDE);
        break;

      default:
        Check(false);
    }
    ApplyPanelPosition();
  }
  function HandlePanelDrag(oParameters) {
    if (oParameters.bCancel) {
      return;
    }
    const nPosition = GetPanelPosition();
    if (
      oParameters.nStep !== 1 &&
      oParameters._nInitialPosition !== nPosition
    ) {
      m_Log.Oops(
        `[Chat] Dragged panel position changed from ${oParameters._nInitialPosition} to ${nPosition}`
      );
      CancelPanelDrag();
      return;
    }
    switch (oParameters.nStep) {
      case 1:
        oParameters._nInitialPosition = nPosition;
        if (nPosition === RIGHT_SIDE || nPosition === LEFT_SIDE) {
          oParameters._nInitialSize = Number.parseInt(
            getComputedStyle(_nodeChat).width,
            10
          );
        } else {
          oParameters._nInitialSize = Number.parseInt(
            getComputedStyle(_nodeChat).height,
            10
          );
        }
        break;

      case 2:
        if (nPosition === RIGHT_SIDE || nPosition === LEFT_SIDE) {
          if (oParameters.bChangedX) {
            const nMaxSize =
              Number.parseInt(
                getComputedStyle(GetNode("playerandchat")).width,
                10
              ) -
              Number.parseInt(
                getComputedStyle(GetNode("player")).minWidth,
                10
              );
            _nodeChat.width = Math.max(
              Math.min(
                nPosition === LEFT_SIDE
                  ? oParameters._nInitialSize + oParameters.nDeltaX
                  : oParameters._nInitialSize - oParameters.nDeltaX,
                nMaxSize
              ),
              0
            );
            m_MediaQuery.updateSlowly();
          }
        } else if (oParameters.bChangedY) {
          const nMaxSize =
            Number.parseInt(
              getComputedStyle(GetNode("playerandchat")).height,
              10
            ) -
            Number.parseInt(
              getComputedStyle(GetNode("player")).minHeight,
              10
            );
          _nodeChat.height = Math.max(
            Math.min(
              nPosition === TOP_SIDE
                ? oParameters._nInitialSize + oParameters.nDeltaY
                : oParameters._nInitialSize - oParameters.nDeltaY,
              nMaxSize
            ),
            0
          );
          m_MediaQuery.updateSlowly();
        }
        break;

      case 3:
        if (nPosition === RIGHT_SIDE || nPosition === LEFT_SIDE) {
          m_Settings.Change(
            "nChatPanelWidth",
            Number.parseInt(getComputedStyle(_nodeChat).width, 10)
          );
        } else {
          m_Settings.Change(
            "nChatPanelHeight",
            Number.parseInt(getComputedStyle(_nodeChat).height, 10)
          );
        }
        break;

      default:
        Check(false);
    }
  }
  function CancelPanelDrag() {
    m_Dragger.CancelDrag("chatsize");
  }
  HandleFullscreenChange.nStateInNormalMode = -1;
  function HandleFullscreenChange(bEnabled) {
    if (bEnabled) {
      if (
        HandleFullscreenChange.nStateInNormalMode === -1
      ) {
        HandleFullscreenChange.nStateInNormalMode =
          m_Settings.Get("nChatState");
        if (
          HandleFullscreenChange.nStateInNormalMode ===
          CHAT_PANEL
        ) {
          m_Settings.Change("nChatState", CHAT_HIDDEN, true);
          ApplyPanelState();
        }
      }
    } else if (
      HandleFullscreenChange.nStateInNormalMode !== -1
    ) {
      if (
        HandleFullscreenChange.nStateInNormalMode ===
        CHAT_PANEL
      ) {
        m_Settings.Change("nChatState", CHAT_PANEL);
        ApplyPanelState();
      } else if (
        m_Settings.Get("nChatState") === CHAT_HIDDEN &&
        m_Settings.Get("nClosedChatState") === CHAT_UNLOADED
      ) {
        m_Settings.Change("nChatState", CHAT_UNLOADED);
        ApplyPanelState();
      }
      HandleFullscreenChange.nStateInNormalMode = -1;
    }
  }
  function Restore() {
    ApplyPanelState();
    ApplyPanelPosition();
    m_Events.AddHandler(
      "dragger-drag-chatsize",
      HandlePanelDrag
    );
    m_Events.AddHandler(
      "fullscreen-changed",
      HandleFullscreenChange
    );
  }
  return {
    Restore,
    ApplyPanelPosition,
    ApplyUrl,
    SaveAndApplyClosedPanelState,
    TogglePanelState,
    TogglePanelPosition,
  };
})();
