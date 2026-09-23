"use strict";
/*
	The chat panel: whether it is there, which side it is on, and how big it is.

	**Three states, not two.** Unloaded removes the iframe; hidden keeps it loaded behind a class.
	The difference is paid on reopening: a hidden chat comes back with its scrollback and its
	connection, an unloaded one reconnects from nothing. Which of the two "closed" means is the
	viewer's choice, kept in its own setting, and the close button honours it.

	**The side in force is read from the layout, not from the setting.** In automatic mode the
	stylesheet decides, from the shape of the window; so the module asks the computed flex-direction
	of #playerandchat rather than guessing. That is also what lets a drag notice that the panel
	changed side underneath it and give up rather than resize the wrong axis.

	**The panel gets borrowed, and given back.** Fullscreen borrows it; so does the videos view,
	where a chat scrolling beside an old video is noise. Whoever borrows first remembers what the
	panel was, and it only comes back once everyone has given it back -- otherwise leaving fullscreen
	from inside the videos view would drop the chat back over the video being watched. The borrowed
	state is never written to storage, or leaving fullscreen once would close the chat for good.

	**The size is stored when the drag ends, never during.** A drag sends dozens of steps; writing
	each one would hammer chrome.storage with values the viewer has not settled on yet.
*/
const m_Chat = (() => {
  const NOT_BORROWED = -1;

  let _elChat = null;
  // Qui tient le panneau emprunte, et ce qu'il etait avant le premier emprunt.
  const _msBorrowers = new Set();
  let _nStateBeforeBorrow = NOT_BORROWED;

  // Le cote reellement en vigueur, tel que la mise en page l'applique.
  function CurrentSide() {
    switch (getComputedStyle(GetNode("playerandchat")).flexDirection) {
    case "column-reverse":
      return TOP_SIDE;
    case "row":
      return RIGHT_SIDE;
    case "column":
      return BOTTOM_SIDE;
    case "row-reverse":
      return LEFT_SIDE;
    default:
      return Check(false);
    }
  }

  function AttachPanel() {
    if (_elChat) {
      return;
    }
    const sAddress = m_Twitch.openChat();
    m_Log.Here(`[Chat] Inserting iframe ${sAddress}`);
    _elChat = document.createElement("iframe");
    _elChat.src = sAddress;
    _elChat.id = "chat";
    _elChat.width = m_Settings.Get("nChatPanelWidth");
    _elChat.height = m_Settings.Get("nChatPanelHeight");
    GetNode("chatsize").insertAdjacentElement("afterend", _elChat);
  }

  function DetachPanel() {
    if (!_elChat) {
      return;
    }
    m_Log.Here(`[Chat] Removing iframe ${_elChat.src}`);
    m_Twitch.closeChat();
    _elChat.remove();
    _elChat = null;
  }

  // Changer l'adresse veut dire changer de chaine : le cadre se refait, il ne se renavigue pas.
  function ApplyUrl() {
    if (_elChat) {
      m_Log.Wow("[Chat] Changing iframe address");
      DetachPanel();
      AttachPanel();
    }
  }

  function ApplyPanelState() {
    const nState = m_Settings.Get("nChatState");
    m_Log.Wow(`[Chat] New panel state: ${nState}`);
    CancelPanelDrag();
    switch (nState) {
    case CHAT_UNLOADED:
      document.body.classList.add("hidechat");
      DetachPanel();
      break;
    case CHAT_HIDDEN:
      AttachPanel();
      document.body.classList.add("hidechat");
      break;
    case CHAT_PANEL:
      AttachPanel();
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
      // La feuille de style choisit selon la forme de la fenetre ; on lui donne ses deux preferences.
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
      const nSide = m_Settings.Get("nChatPanelPosition");
      oClasses.remove("autochatposition");
      oClasses.toggle("chattop", nSide === TOP_SIDE);
      oClasses.toggle("chatright", nSide === RIGHT_SIDE);
      oClasses.toggle("chatbottom", nSide === BOTTOM_SIDE);
      oClasses.toggle("chatleft", nSide === LEFT_SIDE);
    }
    m_MediaQuery.updateSlowly();
  }

  function SaveAndApplyClosedPanelState(nNewState) {
    m_Settings.Change("nClosedChatState", nNewState);
    const nState = m_Settings.Get("nChatState");
    // Si le chat est deja ferme, le nouveau choix s'applique tout de suite plutot qu'a la prochaine fois.
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
      // En plein ecran, l'ouverture est un emprunt : elle ne s'enregistre pas.
      m_Settings.Change("nChatState", CHAT_PANEL, bFullscreen);
      break;
    case CHAT_PANEL:
      m_Settings.Change(
        "nChatState",
        bFullscreen ? CHAT_HIDDEN : m_Settings.Get("nClosedChatState"),
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
    let nSide;
    if (m_Settings.Get("bAutoChatPosition")) {
      // Quitter l'automatique en figeant le cote qu'on voit, pour que le tour parte de la.
      m_Settings.Change("bAutoChatPosition", false);
      nSide = CurrentSide();
    } else {
      nSide = m_Settings.Get("nChatPanelPosition");
    }
    switch (nSide) {
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

  const IsVertical = (nSide) => nSide === RIGHT_SIDE || nSide === LEFT_SIDE;

  // La place qui reste au chat : le conteneur, moins ce que le lecteur exige pour lui.
  function MaxSize(nSide) {
    const sDimension = IsVertical(nSide) ? "width" : "height";
    const sMinimum = IsVertical(nSide) ? "minWidth" : "minHeight";
    return (
      Number.parseInt(getComputedStyle(GetNode("playerandchat"))[sDimension], 10) -
      Number.parseInt(getComputedStyle(GetNode("player"))[sMinimum], 10)
    );
  }

  function PanelSize(nSide) {
    return Number.parseInt(
      getComputedStyle(_elChat)[IsVertical(nSide) ? "width" : "height"],
      10
    );
  }

  /*
    L'etat du glisser est range sur l'objet que le glisseur fait traverser les trois temps. C'est
    son contrat : le meme objet du debut a la fin, et un seul glisser a la fois.
  */
  function HandlePanelDrag(oParameters) {
    if (oParameters.bCancel) {
      return;
    }
    const nSide = CurrentSide();
    if (oParameters.nStep !== 1 && oParameters._nInitialPosition !== nSide) {
      // La mise en page a bouge sous le glisser : on redimensionnerait le mauvais axe.
      m_Log.Oops(
        `[Chat] Dragged panel position changed from ${oParameters._nInitialPosition} to ${nSide}`
      );
      CancelPanelDrag();
      return;
    }
    switch (oParameters.nStep) {
    case 1:
      oParameters._nInitialPosition = nSide;
      oParameters._nInitialSize = PanelSize(nSide);
      break;
    case 2:
      ResizePanel(oParameters, nSide);
      break;
    case 3:
      m_Settings.Change(
        IsVertical(nSide) ? "nChatPanelWidth" : "nChatPanelHeight",
        PanelSize(nSide)
      );
      break;
    default:
      Check(false);
    }
  }

  function ResizePanel(oParameters, nSide) {
    const bVertical = IsVertical(nSide);
    if (bVertical ? !oParameters.bChangedX : !oParameters.bChangedY) {
      return;
    }
    // Le panneau grandit vers le lecteur : a droite et en bas, l'ecart compte a l'envers.
    const nDelta = bVertical ? oParameters.nDeltaX : oParameters.nDeltaY;
    const bGrowsWithDelta = nSide === LEFT_SIDE || nSide === TOP_SIDE;
    const nWanted = bGrowsWithDelta
      ? oParameters._nInitialSize + nDelta
      : oParameters._nInitialSize - nDelta;
    _elChat[bVertical ? "width" : "height"] = Math.max(
      Math.min(nWanted, MaxSize(nSide)),
      0
    );
    m_MediaQuery.updateSlowly();
  }

  function CancelPanelDrag() {
    m_Dragger.CancelDrag("chatsize");
  }

  function BorrowPanel(sWho, bBorrow) {
    if (bBorrow) {
      if (_msBorrowers.size === 0) {
        _nStateBeforeBorrow = m_Settings.Get("nChatState");
        if (_nStateBeforeBorrow === CHAT_PANEL) {
          m_Settings.Change("nChatState", CHAT_HIDDEN, true);
          ApplyPanelState();
        }
      }
      _msBorrowers.add(sWho);
      return;
    }
    // Rendu par un seul : le panneau attend les autres.
    if (!_msBorrowers.delete(sWho) || _msBorrowers.size !== 0) {
      return;
    }
    if (_nStateBeforeBorrow === CHAT_PANEL) {
      m_Settings.Change("nChatState", CHAT_PANEL);
      ApplyPanelState();
    } else if (
      m_Settings.Get("nChatState") === CHAT_HIDDEN &&
      m_Settings.Get("nClosedChatState") === CHAT_UNLOADED
    ) {
      // Le chat a ete ouvert puis referme pendant l'emprunt : on rend le choix du spectateur.
      m_Settings.Change("nChatState", CHAT_UNLOADED);
      ApplyPanelState();
    }
    _nStateBeforeBorrow = NOT_BORROWED;
  }

  const HandleFullscreenChange = (bEnabled) => BorrowPanel("fullscreen", bEnabled);
  const HandleVideosChange = (bOpen) => BorrowPanel("videos", bOpen);

  function Restore() {
    ApplyPanelState();
    ApplyPanelPosition();
    m_Events.AddHandler("dragger-drag-chatsize", HandlePanelDrag);
    m_Events.AddHandler("fullscreen-changed", HandleFullscreenChange);
    m_Events.AddHandler("videos-opened", HandleVideosChange);
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
