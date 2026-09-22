"use strict";
/*
	Les commandes : le clavier, les clics, la fenetre des reglages, l'etat de la diffusion, et ce
	qu'on affiche de la chaine.

	**Ce module aiguille.** Il ne fait presque rien lui-meme : une touche ou un clic arrive, il decide
	quel module doit agir. D'ou deux grands aiguillages -- HandleKeyDownAndUp et HandleLeftClick --
	qui sont la carte de tout ce que le spectateur peut commander.

	**Une touche maintenue ne repete pas les bascules.** Le clavier repete une touche tenue une
	trentaine de fois par seconde : le plein ecran, les menus, le chat ou la diffusion clignoteraient.
	Ces actions ne partent qu'a la premiere frappe (bFirstPress). Seuls le volume et les deplacements
	dans la rediffusion suivent la repetition, parce que la c'est ce qu'on attend.

	**Une touche prise en charge n'atteint pas la page ; une touche inconnue, si.** Le comportement
	par defaut n'est annule que pour ce que le module gere -- y compris au relachement, pour que
	l'espace ne fasse pas defiler la page apres avoir bascule la diffusion.

	**Les touches de rediffusion ne font rien en direct.** Pause, vitesse et deplacement n'ont de
	sens que sur ce qui est deja enregistre ; en direct, on regarde ce qui arrive.

	**L'etat de la diffusion vit ici.** ChangeState est le seul endroit qui le modifie ; il le pose sur
	le corps de la page (data-state, que la feuille de style lit), l'annonce sur le bus, et remet a
	jour ce que l'etat rend obsolete dans les metadonnees affichees.
*/
const m_Controls = (() => {
  const SEEK_BY_ARROWS_BY = 5;
  const SEEK_BY_FRAMES_BY = 3;
  const BROADCAST_TITLE_UNKNOWN = "• • •";

  // Les codes de touche, et les modificateurs ajoutes au-dessus pour qu'un seul switch les distingue.
  const KEY_CLEAR = 12;
  const KEY_ENTER = 13;
  const KEY_ESCAPE = 27;
  const KEY_SPACE = 32;
  const KEY_PAGE_UP = 33;
  const KEY_PAGE_DOWN = 34;
  const KEY_LEFT = 37;
  const KEY_UP = 38;
  const KEY_RIGHT = 39;
  const KEY_DOWN = 40;
  const KEY_0 = 48;
  const KEY_1 = 49;
  const KEY_9 = 57;
  const KEY_A = 65;
  const KEY_C = 67;
  const KEY_F = 70;
  const KEY_I = 73;
  const KEY_J = 74;
  const KEY_K = 75;
  const KEY_L = 76;
  const KEY_M = 77;
  const KEY_S = 83;
  const KEY_U = 85;
  const KEY_V = 86;
  const KEY_X = 88;
  const KEY_CONTEXT_MENU = 93;
  const KEY_NUMPAD_PLUS = 107;
  const KEY_NUMPAD_MINUS = 109;
  const KEY_F1 = 112;
  const KEY_EQUALS = 187;
  const KEY_COMMA = 188;
  const KEY_MINUS = 189;
  const KEY_PERIOD = 190;
  const SHIFT_KEY = 1 << 16;
  const CTRL_KEY = 1 << 17;
  const ALT_KEY = 1 << 18;
  const META_KEY = 1 << 19;

  let _nState;
  // Les champs numeriques de la fenetre des reglages, crees a son premier affichage.
  let _oPlaybackStart;
  let _oBufferSize;
  let _oBufferStretch;
  let _oReplayDuration;
  let _oAutoHideInterval;
  let _bCopyingBroadcastUrl = false;

  // ------------------------------------------------------------------------------------------
  // La molette et le bouton du milieu

  function startWheelVolumeChange() {
    document.removeEventListener("pointerdown", handleWheelPress);
    document.removeEventListener("wheel", handleWheelRotate);
    if (!m_Settings.Get("bWheelVolume")) {
      return;
    }
    document.addEventListener("pointerdown", handleWheelPress);
    // Un pas nul garde le bouton du milieu pour couper le son, sans prendre la molette.
    if (m_Settings.Get("nWheelVolumeStep") !== 0) {
      // Non passif : sans preventDefault, la page defilerait en meme temps que le volume change.
      document.addEventListener("wheel", handleWheelRotate, { passive: false });
    }
  }

  const handleWheelPress = createElementEventHandler((oEvent) => {
    if (
      // La vue des videos a sa propre video : le bouton du milieu n'y coupe pas le direct.
      m_Videos.IsOpen() ||
      oEvent.button !== MIDDLE_BUTTON ||
      HasModifier(oEvent) ||
      // Le bouton du milieu sur un lien ouvre un onglet : on ne le lui prend pas.
      IsLinkEvent(oEvent)
    ) {
      return;
    }
    oEvent.preventDefault();
    SaveAndApplyVolume(!m_Settings.Get("bMute"));
  });

  const handleWheelRotate = AddExceptionHandler((oEvent) => {
    // Au-dessus d'une liste qui defile -- le chat, les reglages --, la molette defile.
    if (
      m_Videos.IsOpen() ||
      HasModifier(oEvent) ||
      ElementAtThisPointCanScroll(oEvent.clientX, oEvent.clientY)
    ) {
      return;
    }
    oEvent.preventDefault();
    m_Log.Here(
      `[Controls] Wheel movement deltaY=${oEvent.deltaY} deltaMode=${oEvent.deltaMode}`
    );
    if (oEvent.deltaY !== 0) {
      SaveAndApplyVolume(
        void 0,
        Clamp(
          m_Settings.Get("nVolume2") -
            m_Settings.Get("nWheelVolumeStep") * Math.sign(oEvent.deltaY),
          MIN_VOLUME,
          MAX_VOLUME
        )
      );
    }
  });

  function HasModifier(oEvent) {
    return oEvent.shiftKey || oEvent.ctrlKey || oEvent.altKey || oEvent.metaKey;
  }

  // ------------------------------------------------------------------------------------------
  // Les actions

  function ApplyImageScaling() {
    const bScaled = m_Settings.Get("bScaleImage");
    GetNode("eye").classList.toggle("scaled", bScaled);
    GetNode("rewind").classList.toggle("scaled", bScaled);
  }

  function ApplyInterfaceAnimation() {
    document.body.classList.toggle(
      "interfaceanimation",
      m_Settings.Get("bInterfaceAnimation")
    );
  }

  /*
    Arreter le direct ne vide pas l'ecran : la file recoit un marqueur de rediffusion, et le lecteur
    bascule sur ce qu'il a deja en tampon. Rend false quand il n'y avait rien a arreter.
  */
  function StopWatchingBroadcast() {
    if (_nState === STATE_STOP || _nState === STATE_REPEAT) {
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
    if (StopWatchingBroadcast()) {
      return;
    }
    m_Log.Wow("[Controls] Starting broadcast viewing");
    g_maQueue.Clear();
    m_Player.Reload(STATE_START);
    m_Playlist.Start();
  }

  function ToggleStatisticsWindow() {
    if (m_Statistics.WindowOpened()) {
      m_Statistics.CloseWindow();
    } else {
      m_Statistics.OpenWindow();
    }
  }

  // La mire de controle des couleurs. Maj la montre sans le fond, pour juger l'image elle-meme.
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
          m_Log.Oops(`[Controls] Error copying to clipboard: ${pReason}`);
          m_Notification.ShowAss();
        }
      )
      .catch(m_Debug.CaughtException);
  }

  /*
    L'adresse du flux lui-meme, pour l'ouvrir dans un autre lecteur. Le jeton qu'elle porte ne sert
    qu'une fois, et deux lecteurs sur le meme jeton se le disputeraient : une fois l'adresse copiee,
    on arrete de regarder ici. Un second clic pendant la demande n'en lance pas une autre.
  */
  function CopyBroadcastUrlToClipboard() {
    if (_bCopyingBroadcastUrl) {
      return;
    }
    _bCopyingBroadcastUrl = true;
    m_Log.Wow("[Controls] Getting broadcast address to copy");
    m_Twitch
      .GetAbsoluteVariantListUrl(null, true, false)
      .then((sResult) => {
        m_Log.Here("[Controls] Copying broadcast address to clipboard");
        return navigator.clipboard.writeText(sResult).then(
          () => {
            _bCopyingBroadcastUrl = false;
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
          _bCopyingBroadcastUrl = false;
          if (typeof pReason != "string") {
            throw pReason;
          }
          m_Log.Oops(
            `[Controls] Error copying broadcast address to clipboard: ${pReason}`
          );
          m_Notification.ShowAss();
        })
      );
  }

  // ------------------------------------------------------------------------------------------
  // Le volume

  const HandleVolumeChange = AddExceptionHandler((oEvent) => {
    SaveAndApplyVolume(false, oEvent.target.valueAsNumber);
  });

  // L'un ou l'autre, ou les deux. Sans piste audio il n'y a rien a regler, et on ne touche a rien.
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
    m_Rewind.ApplyVolume();
    UpdateVolume();
    m_AutoHide.Show();
  }

  function UpdateVolume() {
    const nVolume = m_Settings.Get("nVolume2");
    const nodeVolume = GetNode("volume");
    nodeVolume.value = nVolume;
    // La partie remplie du curseur est dessinee par la feuille de style a partir de cette largeur.
    nodeVolume.style.setProperty(
      "--width",
      `${((nVolume - MIN_VOLUME) / (100 - MIN_VOLUME)) * 100}%`
    );
    ChangeButton("togglemute", m_Settings.Get("bMute"));
  }

  function UpdateTrackCount(bHasVideo, bHasAudio) {
    document.body.classList.toggle("novideo", !bHasVideo);
    document.body.classList.toggle("noaudio", !bHasAudio);
  }

  // Tant qu'un changement d'abonnement est en route, un second attendrait une reponse perimee.
  function ChangeViewerChannelSubscription(nSubscription) {
    if (
      !document.getElementById("viewer-subscription").classList.contains("updating")
    ) {
      m_Twitch.ChangeViewerChannelSubscription(nSubscription);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Les clics

  /*
    Un clic est reconnu a l'identifiant ou au nom de l'element touche -- ou de son parent immediat,
    parce que les boutons portent une icone et que c'est souvent elle qu'on touche. Le clic est
    annonce sur le bus avant d'etre traite : d'autres modules reagissent aux memes elements.
  */
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

    case "golive":
      if (_nState === STATE_PLAYING) {
        m_Rewind.Stop();
        m_Player.JumpToLive();
      }
      break;

    case "watchfromstart": {
      // Rejouer le direct depuis son vrai debut : le VOD en cours, dans le lecteur Videos. Ouvrir la
      // vue ferme le menu.
      // Sur la page meme, pas dans la vue des videos : on reste devant la diffusion, et le
      // direct continue derriere pour qu'y revenir soit immediat.
      m_Rewind.PlayAt(0);
      break;
    }

    case "togglepause":
      // Ce qui est devant prend la commande : l'enregistrement s'il est la, le lecteur sinon.
      if (m_Rewind.IsShown()) {
        m_Rewind.TogglePause();
      } else if (_nState === STATE_REPEAT || _nState === STATE_PLAYING) {
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

    // --- La fenetre des reglages.
    case "concurrentdownloads":
      Check(nodeClick.checked);
      m_Settings.Change("nConcurrentDownloads", Number.parseInt(nodeClick.value, 10));
      // Les mesures de debit d'avant ne se comparent plus a celles d'apres.
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
      // Les boutons de position changent de sens selon ce reglage : la fenetre doit se refaire.
      UpdateSettingsWindow();
      m_Chat.ApplyPanelPosition();
      break;

    case "horizontalchatposition":
      Check(nodeClick.checked);
      m_Settings.Change("nHorizontalChatPosition", Number.parseInt(nodeClick.value, 10));
      m_Chat.ApplyPanelPosition();
      break;

    case "verticalchatposition":
      Check(nodeClick.checked);
      m_Settings.Change("nVerticalChatPosition", Number.parseInt(nodeClick.value, 10));
      m_Chat.ApplyPanelPosition();
      break;

    case "chatposition":
      Check(nodeClick.checked);
      m_Settings.Change("nChatPanelPosition", Number.parseInt(nodeClick.value, 10));
      m_Chat.ApplyPanelPosition();
      break;

    case "closedchatstate":
      Check(nodeClick.checked);
      m_Chat.SaveAndApplyClosedPanelState(Number.parseInt(nodeClick.value, 10));
      break;

    case "exportsettings":
      m_Settings.Export();
      break;

    case "importsettings": {
      // Le vrai selecteur de fichier est cache ; vide, pour que choisir deux fois le meme fichier
      // declenche quand meme le changement.
      const node = document.getElementById("settingsimportfile");
      node.value = "";
      node.click();
      break;
    }

    case "resetsettings":
      m_Settings.Reset();
      break;

    // --- Le reste de l'interface.
    case "togglestatistics":
    // Cliquer sur la position de lecture ouvre aussi les statistiques : c'est la qu'on la detaille.
    case "position":
      ToggleStatisticsWindow();
      break;

    case "closestatistics":
      m_Statistics.CloseWindow();
      break;

    case "opennews2":
      m_News.OpenNews();
      break;

    case "openhelp":
      m_News.OpenHelp();
      break;

    case "sendfeedback":
      m_Debug.TerminateAndSendFeedback();
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

    case "copychannelurl":
      m_Log.Here("[Controls] Copying channel address to clipboard");
      CopyTextToClipboard(m_Twitch.GetChannelUrl(false));
      break;

    case "copybroadcasturl":
      CopyBroadcastUrlToClipboard();
    }
  });

  // ------------------------------------------------------------------------------------------
  // Le clavier

  const HandleKeyDownAndUp = AddExceptionHandler((oEvent) => {
    const bPress = oEvent.type === "keydown";
    // La premiere frappe, pas la repetition d'une touche tenue.
    const bFirstPress = bPress && !oEvent.repeat;
    const bReplay = _nState === STATE_REPEAT;

    /*
      La vue des videos ouverte, les raccourcis du direct s'effacent : l'espace, les fleches et le
      volume appartiennent a la video qu'on regarde, pas au direct reduit dans le coin. Seul Echap
      reste, pour refermer la vue.
    */
    if (m_Videos.IsOpen()) {
      if (oEvent.keyCode === KEY_ESCAPE && !HasModifier(oEvent)) {
        oEvent.preventDefault();
        if (bFirstPress) {
          m_Videos.Close();
        }
      }
      return;
    }

    switch (
      oEvent.keyCode +
      oEvent.shiftKey * SHIFT_KEY +
      oEvent.ctrlKey * CTRL_KEY +
      oEvent.altKey * ALT_KEY +
      oEvent.metaKey * META_KEY
    ) {
    // --- Fenetres et affichage.
    case KEY_ESCAPE:
      // Annule meme sur une touche tenue : Echap ne doit jamais sortir du plein ecran par defaut
      // avant que le module ait ferme ce qui est ouvert.
      oEvent.preventDefault();
      if (bFirstPress) {
        getSelection().removeAllRanges();
        m_Window.close(false);
        m_AutoHide.Hide(false);
      }
      break;

    case KEY_F:
    case KEY_ENTER:
    case KEY_ENTER + ALT_KEY:
      if (bFirstPress) {
        m_FullscreenMode.Toggle();
      }
      break;

    case KEY_ENTER + SHIFT_KEY:
      if (bFirstPress) {
        m_PictureInPicture.toggle();
      }
      break;

    case KEY_CONTEXT_MENU:
      // La touche menu donne le focus a la video au relachement, pour que le menu contextuel du
      // navigateur s'ouvre sur elle. Le comportement par defaut est garde.
      if (!bPress) {
        GetNode("eye").focus();
      }
      return;

    case KEY_X:
      if (bFirstPress) {
        m_Window.toggle("mainmenu");
      }
      break;

    case KEY_C:
      if (bFirstPress) {
        m_Chat.TogglePanelState();
      }
      break;

    case KEY_V:
      if (bFirstPress) {
        m_Window.toggle("settings");
      }
      break;

    case KEY_I:
      if (bFirstPress) {
        m_Window.toggle("channel");
      }
      break;

    case KEY_S:
      if (bFirstPress) {
        ToggleStatisticsWindow();
      }
      break;

    case KEY_F1:
      if (bFirstPress) {
        m_News.OpenHelp();
      }
      break;

    // Ctrl+A ne fait rien, mais n'atteint pas la page : tout selectionner surlignerait l'interface.
    case KEY_A + CTRL_KEY:
      break;

    case KEY_U + CTRL_KEY:
      if (bFirstPress) {
        m_Chat.TogglePanelPosition();
        UpdateSettingsWindow();
      }
      break;

    case KEY_I + CTRL_KEY:
      if (bFirstPress) {
        const bScaleImage = m_Settings.Get("bScaleImage");
        m_Settings.Change("bScaleImage", !bScaleImage);
        UpdateSettingsWindow();
        ApplyImageScaling();
        m_Notification.Show(`svg-fullscreen-${bScaleImage}`, false);
      }
      break;

    case KEY_X + ALT_KEY:
      if (bFirstPress) {
        m_Twitch.CreateClip();
      }
      break;

    // --- La diffusion.
    case KEY_SPACE:
      if (bFirstPress) {
        ToggleWatchingBroadcast();
        m_AutoHide.Show();
      }
      break;

    // --- La rediffusion : vitesse, pause, deplacement.
    case KEY_1:
    case KEY_1 + 1:
    case KEY_1 + 2:
    case KEY_1 + 3:
    case KEY_1 + 4:
    case KEY_1 + 5:
    case KEY_1 + 6:
    case KEY_1 + 7:
    case KEY_9:
    case KEY_0:
      if (bFirstPress && bReplay) {
        // 0 choisit la premiere vitesse de la liste, puis 9 la deuxieme, jusqu'a 1 la dixieme :
        // la rangee du clavier lue de droite a gauche.
        setReplaySpeed(KEY_9 + 1 - (oEvent.keyCode === KEY_0 ? KEY_9 + 1 : oEvent.keyCode));
        m_AutoHide.Show();
      }
      break;

    case KEY_EQUALS:
    case KEY_NUMPAD_PLUS:
    case KEY_PERIOD:
      if (bFirstPress && bReplay) {
        setReplaySpeed(-Infinity);
        m_AutoHide.Show();
      }
      break;

    case KEY_MINUS:
    case KEY_NUMPAD_MINUS:
    case KEY_COMMA:
      if (bFirstPress && bReplay) {
        setReplaySpeed(Infinity);
        m_AutoHide.Show();
      }
      break;

    case KEY_K:
    case KEY_CLEAR:
      // La pause vaut aussi pour le direct : elle y fige l'image sans couper le telechargement.
      if (bFirstPress && m_Rewind.IsShown()) {
        m_Rewind.TogglePause();
        m_AutoHide.Show();
      } else if (bFirstPress && (bReplay || _nState === STATE_PLAYING)) {
        m_Player.TogglePause();
        m_AutoHide.Show();
      }
      break;

    case KEY_J:
    case KEY_LEFT:
      if (bPress && m_Rewind.IsShown()) {
        m_Log.Wow(`[Controls] Seeking the recording by -${SEEK_BY_ARROWS_BY}s`);
        m_Rewind.SeekBy(-SEEK_BY_ARROWS_BY);
        m_AutoHide.Show();
      } else if (bPress && bReplay) {
        m_Log.Wow(`[Controls] Seeking by -${SEEK_BY_ARROWS_BY}s`);
        m_Player.SeekReplayBy(false, -SEEK_BY_ARROWS_BY);
        m_AutoHide.Show();
      }
      break;

    case KEY_L:
    case KEY_RIGHT:
      if (bPress && m_Rewind.IsShown()) {
        m_Log.Wow(`[Controls] Seeking the recording by +${SEEK_BY_ARROWS_BY}s`);
        m_Rewind.SeekBy(SEEK_BY_ARROWS_BY);
        m_AutoHide.Show();
      } else if (bPress && bReplay) {
        m_Log.Wow(`[Controls] Seeking by +${SEEK_BY_ARROWS_BY}s`);
        m_Player.SeekReplayBy(false, SEEK_BY_ARROWS_BY);
        m_AutoHide.Show();
      }
      break;

    // Image par image : trois en arriere -- revenir d'une seule tombe souvent sur la meme --, une
    // en avant. L'interface ne se montre pas, pour ne pas couvrir l'image qu'on examine.
    case KEY_J + SHIFT_KEY:
    case KEY_LEFT + SHIFT_KEY:
      if (bPress && bReplay) {
        m_Log.Wow(`[Controls] Seeking by -${SEEK_BY_FRAMES_BY} frames`);
        m_Player.SeekReplayBy(true, -SEEK_BY_FRAMES_BY);
      }
      break;

    case KEY_L + SHIFT_KEY:
    case KEY_RIGHT + SHIFT_KEY:
      if (bPress && bReplay) {
        m_Log.Wow(`[Controls] Seeking by +1 frame`);
        m_Player.SeekReplayBy(true, 1);
      }
      break;

    // --- Le volume : les fleches suivent la repetition, les autres non.
    case KEY_UP:
      if (bPress) {
        SaveAndApplyVolume(
          false,
          Math.min(m_Settings.Get("nVolume2") + VOLUME_INCREASE_STEP_BY_KEY, MAX_VOLUME)
        );
      }
      break;

    case KEY_DOWN:
      if (bPress) {
        SaveAndApplyVolume(
          false,
          Math.max(m_Settings.Get("nVolume2") - VOLUME_DECREASE_STEP_BY_KEY, MIN_VOLUME)
        );
      }
      break;

    case KEY_PAGE_UP:
      if (bFirstPress) {
        SaveAndApplyVolume(false);
      }
      break;

    case KEY_PAGE_DOWN:
      if (bFirstPress) {
        SaveAndApplyVolume(true);
      }
      break;

    case KEY_M:
      if (bFirstPress) {
        SaveAndApplyVolume(!m_Settings.Get("bMute"));
      }
      break;

    default:
      return;
    }
    oEvent.preventDefault();
  });

  // ------------------------------------------------------------------------------------------
  // La fenetre des reglages

  // Remet chaque controle d'accord avec le reglage enregistre -- apres une importation, une
  // reinitialisation, ou un changement fait ailleurs qu'ici.
  function UpdateSettingsWindow() {
    document.querySelector(
      `input[name="concurrentdownloads"][value="${m_Settings.Get("nConcurrentDownloads")}"]`
    ).checked = true;
    document.querySelector(
      `input[name="closedchatstate"][value="${m_Settings.Get("nClosedChatState")}"]`
    ).checked = true;
    GetNode("chaturl").selectedIndex = m_Settings.Get("bFullChat")
      ? 0
      : m_Settings.Get("bDimChat")
        ? 2
        : 1;
    GetNode("scaleimage").checked = m_Settings.Get("bScaleImage");
    GetNode("interfaceanimation").checked = m_Settings.Get("bInterfaceAnimation");
    GetNode("wheelvolume").value = m_Settings.Get("bWheelVolume")
      ? m_Settings.Get("nWheelVolumeStep")
      : "";
    UpdateChatPositionButtons();
    UpdateNumberInputs();
  }

  /*
    Les memes huit boutons servent deux reglages. En placement automatique, on choisit un cote
    horizontal ET un cote vertical : les boutons forment deux groupes radio, selon leur valeur. En
    placement fixe, un seul cote en tout : un seul groupe. Le nom du groupe change donc avec le
    reglage, et c'est ce nom que l'aiguillage des clics reconnait.
  */
  function UpdateChatPositionButtons() {
    const bAutoPosition = m_Settings.Get("bAutoChatPosition");
    GetNode("autochatposition").checked = bAutoPosition;
    const snodeSides = document.querySelectorAll(".chatposition input");
    if (bAutoPosition) {
      const nHorizontalPosition = m_Settings.Get("nHorizontalChatPosition");
      const nVerticalPosition = m_Settings.Get("nVerticalChatPosition");
      let nodeHorizontalPosition;
      let nodeVerticalPosition;
      for (const nodeSide of snodeSides) {
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
      nodeHorizontalPosition.checked = nodeVerticalPosition.checked = true;
    } else {
      const nPosition = m_Settings.Get("nChatPanelPosition");
      let nodePosition;
      for (const nodeSide of snodeSides) {
        if (nPosition === Number.parseInt(nodeSide.value, 10)) {
          nodePosition = nodeSide;
        }
        nodeSide.name = "chatposition";
      }
      nodePosition.checked = true;
    }
  }

  function UpdateNumberInputs() {
    if (_oPlaybackStart) {
      _oPlaybackStart.Update();
      _oBufferSize.Update();
      _oBufferStretch.Update();
      _oReplayDuration.Update();
      _oAutoHideInterval.Update();
      return;
    }
    _oPlaybackStart = new NumberInput("nPlaybackStart", 0.5, 1, "playbackstart");
    _oBufferSize = new NumberInput("nBufferSize", 0.5, 1, "buffersize");
    _oBufferStretch = new NumberInput("nBufferStretch", 0.5, 1, "bufferstretch");
    _oReplayDuration = new NumberInput("nReplayDuration2", 30, 0, "replayduration");
    // Changer le tampon change ce que les statistiques de tampon mesurent.
    _oPlaybackStart.AfterChange =
      _oBufferSize.AfterChange =
      _oBufferStretch.AfterChange =
        m_Statistics.ClearHistory;
    _oAutoHideInterval = new NumberInput("nAutoHideInterval", 0.5, 1, "autohideinterval");
  }

  // Le lien vers l'enregistrement n'existe qu'une fois la diffusion connue ; il est recalcule a
  // chaque ouverture du menu, parce qu'il pointe sur la position de lecture du moment.
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
    // « Regarder depuis le début » ne peut jouer que s'il existe un VOD en cours du direct.
    m_Menu.setItemAvailability(
      GetNode("watchfromstart"),
      IsNonEmptyString(m_Twitch.GetCurrentRecordingId())
    );
  }

  function HandlePause(bPause) {
    ChangeButton("togglepause", bPause);
  }

  /*
    La pastille du direct (DVR). Pleine et rouge quand on suit le bord ; creuse et cliquable quand le
    spectateur a rembobine, pour revenir au direct d'un clic. m_Player previent a chaque bascule.
  */
  /*
    La barre du direct va du debut de la diffusion jusqu'a maintenant, pas du seul tampon. Les deux
    sources s'y placent sur la meme graduation : le direct par son retard sur le bord, l'enregistrement
    par sa propre position, qui compte deja depuis le debut de la diffusion.

    Rend false tant que la diffusion n'est pas connue -- au demarrage, ou sur une rediffusion --
    auquel cas le lecteur garde la barre de son tampon.
  */
  function UpdateBroadcastScale() {
    const nElapsed = m_Twitch.GetBroadcastElapsed();
    if (!Number.isFinite(nElapsed) || _nState !== STATE_PLAYING) {
      return false;
    }
    let nWatched = nElapsed;
    if (m_Rewind.IsShown()) {
      nWatched = m_Rewind.GetPosition();
    } else {
      const nBehind = m_Player.GetSecondsBehindLiveEdge();
      if (nBehind >= 0) {
        nWatched = nElapsed - nBehind;
      }
    }
    m_Scale.SetStartAndEnd(0, nElapsed);
    m_Scale.SetLiveWindow((nElapsed - m_Player.GetLiveDepth()) / nElapsed);
    m_Scale.SetWatched(Math.max(nWatched, 0));
    return true;
  }

  /*
    Ou tombe un clic sur la barre pendant le direct. Ce que le tampon retient encore reste au
    direct -- meme flux, meme latence, pub toujours ecartee. Au-dela, c'est l'enregistrement qui
    prend la suite ; il porte toute la diffusion.
  */
  function SeekBroadcastTo(nPosition) {
    const nElapsed = m_Twitch.GetBroadcastElapsed();
    if (!Number.isFinite(nElapsed)) {
      m_Player.SeekLiveTo(nPosition);
      return;
    }
    const nBehind = nElapsed - nPosition;
    // Une marge : le bord du tampon bouge entre le clic et le deplacement.
    if (nBehind < m_Player.GetLiveDepth() - 1) {
      m_Rewind.Stop();
      m_Player.SeekLiveToBehind(Math.max(nBehind, 0));
      return;
    }
    m_Rewind.PlayAt(nPosition);
  }

  /*
    La bulle du rail du direct : l'heure visee dans la diffusion, et la vignette de ce moment-la
    quand un enregistrement existe. La meme que dans la vue des videos, sur la meme echelle.
  */
  function ShowBroadcastPreview(nPosition, nLeftPx) {
    const elBubble = GetNode("scale-preview");
    const nElapsed = m_Twitch.GetBroadcastElapsed();
    if (!Number.isFinite(nElapsed) || _nState !== STATE_PLAYING) {
      ShowElement(elBubble, false);
      return;
    }
    GetNode("scale-preview-time").textContent = m_i18n.SecondsToString(nPosition, false);
    elBubble.style.left = `${Math.round(nLeftPx)}px`;
    const elImage = GetNode("scale-preview-image");
    const sRecordingId = m_Twitch.GetCurrentRecordingId();
    if (IsNonEmptyString(sRecordingId)) {
      m_Preview.Open(sRecordingId, nElapsed);
      elImage.hidden = !m_Preview.Paint(elImage, nPosition);
    } else {
      elImage.hidden = true;
    }
    ShowElement(elBubble, true);
  }

  // Les qualites de l'enregistrement viennent d'etre resolues : la liste s'ouvre au spectateur.
  function HandleRewindQualities(asNames) {
    const nodeList = GetNode("rewindquality");
    nodeList.length = 0;
    for (const sName of asNames) {
      nodeList.add(new Option(sName));
    }
    nodeList.selectedIndex = 0;
    nodeList.disabled = nodeList.length < 2;
  }

  const HandleRewindQualityChange = AddExceptionHandler(({ target: { selectedIndex } }) => {
    if (selectedIndex !== -1) {
      m_Rewind.SetQuality(selectedIndex);
    }
  });

  function HideBroadcastPreview() {
    ShowElement(GetNode("scale-preview"), false);
  }

  function HandleFollowingLive(bFollowing) {
    const elGoLive = GetNode("golive");
    elGoLive.classList.toggle("golive-live", bFollowing);
    elGoLive.title = GetText(bFollowing ? "J0151" : "J0152");
  }

  /*
    Devant l'enregistrement, on n'est plus au bord : la pastille ne doit pas pretendre le contraire.
    La classe ouvre en meme temps les commandes de lecture -- vitesse, pause -- qui ne servaient
    qu'en rediffusion.

    Les statistiques se ferment : elles decrivent le flux du direct, que l'on ne regarde plus.
  */
  function HandleRewindChanged(bShown) {
    document.body.classList.toggle("rewinding", bShown);
    HandleFollowingLive(!bShown && m_Player.IsFollowingLive());
    if (bShown) {
      GetNode("speed").value = "1";
      if (m_Statistics.WindowOpened()) {
        m_Statistics.CloseWindow();
      }
    }
  }

  function HandleBufferingPresetChange() {
    UpdateSettingsWindow();
    m_Statistics.ClearHistory();
  }

  // ------------------------------------------------------------------------------------------
  // La vitesse de rediffusion

  // Les libelles des vitesses sont formates a la premiere lecture, dans la langue de l'interface.
  function getReplaySpeed() {
    const nodeSpeed = GetNode("speed");
    if (nodeSpeed.options[0].text === "") {
      for (const node of nodeSpeed.options) {
        node.text = node.defaultSelected ? "1x" : m_i18n.FormatNumber(node.value, 2);
      }
    }
    const nSpeed = Number.parseFloat(nodeSpeed.value);
    Check(nSpeed > 0);
    return nSpeed;
  }

  // Un indice dans la liste, ou -Infinity / +Infinity pour la precedente / la suivante. Hors de la
  // liste, rien ne change.
  function setReplaySpeed(nCode) {
    const nodeSpeed = GetNode("speed");
    if (!Number.isSafeInteger(nCode)) {
      Check(nodeSpeed.selectedIndex >= 0 && (nCode === -Infinity || nCode === Infinity));
      nCode = nodeSpeed.selectedIndex + Math.sign(nCode);
    }
    if (nCode >= 0 && nCode < nodeSpeed.options.length) {
      nodeSpeed.selectedIndex = nCode;
      m_Player.SetReplaySpeed(getReplaySpeed());
    }
  }

  const HandlePlaybackSpeedChange = AddExceptionHandler((oEvent) => {
    if (m_Rewind.IsShown()) {
      m_Rewind.SetSpeed(getReplaySpeed());
    } else if (_nState === STATE_REPEAT) {
      m_Player.SetReplaySpeed(getReplaySpeed());
    }
  });

  // ------------------------------------------------------------------------------------------
  // Les listes deroulantes et le fichier d'importation

  const HandleBroadcastVariantChange = AddExceptionHandler(
    ({ target: { selectedIndex } }) => {
      if (selectedIndex !== -1) {
        m_Log.Wow(`[Controls] Variant selected ${selectedIndex}`);
        m_Playlist.ChangeBroadcastVariant(selectedIndex);
      }
    }
  );

  // Un pas vide desactive le volume a la molette ; un nombre l'active avec ce pas.
  const HandleWheelVolumeChange = AddExceptionHandler((oEvent) => {
    if (oEvent.target.value) {
      m_Settings.Change("bWheelVolume", true);
      m_Settings.Change("nWheelVolumeStep", Number(oEvent.target.value));
    } else {
      m_Settings.Change("bWheelVolume", false);
    }
    startWheelVolumeChange();
  });

  // Trois choix, deux reglages : chat complet, chat integre, chat integre assombri.
  const HandleChatUrlChange = AddExceptionHandler((oEvent) => {
    m_Log.Wow(`[Controls] Chat address selected ${oEvent.target.selectedIndex}`);
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
  });

  const HandleSettingsImportFileChoice = AddExceptionHandler((oEvent) => {
    if (oEvent.target.files.length === 1) {
      m_Settings.Import(oEvent.target.files[0]);
    }
  });

  // ------------------------------------------------------------------------------------------
  // Ce que le bus annonce

  // Le menu de qualite. Un seul choix le desactive : il n'y a rien a choisir.
  function UpdateBroadcastVariantList([moVariants, oSelectedVariant]) {
    const nodeList = GetNode("broadcastvariant");
    nodeList.length = 0;
    if (moVariants) {
      for (const oVariant of moVariants) {
        nodeList.add(
          new Option(
            TranslateVariantLabel(oVariant.sLabel),
            void 0,
            oVariant === oSelectedVariant,
            oVariant === oSelectedVariant
          )
        );
      }
    }
    nodeList.disabled = nodeList.length < 2;
  }

  // Twitch nomme ses variantes en anglais ; deux de ces noms s'affichent traduits.
  function TranslateVariantLabel(sLabel) {
    if (sLabel === "audio_only") {
      return GetText("J0144");
    }
    if (sLabel.endsWith("(source)")) {
      return sLabel.slice(0, -"(source)".length) + GetText("J0139");
    }
    return sLabel;
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

  // ------------------------------------------------------------------------------------------
  // Le demarrage

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

    m_Events.AddHandler("window-opened-mainmenu", HandleMainMenuOpen);
    m_Events.AddHandler("playlist-broadcastvariantselected", UpdateBroadcastVariantList);
    m_Events.AddHandler("playlist-adstart", handleAdStart);
    m_Events.AddHandler("playlist-adend", handleAdEnd);
    m_Events.AddHandler("player-bufferoverflow", handleBufferOverflow);
    m_Events.AddHandler("player-paused", HandlePause);
    m_Events.AddHandler("player-followinglive", HandleFollowingLive);
    m_Events.AddHandler("rewind-changed", HandleRewindChanged);
    m_Events.AddHandler("rewind-qualitiesready", HandleRewindQualities);
    m_Events.AddHandler("settings-presetchanged-buffering", HandleBufferingPresetChange);
    m_Events.AddHandler("twitch-channelmetadatareceived", ShowChannelMetadata);
    m_Events.AddHandler("twitch-viewermetadatareceived", ShowViewerMetadata);
    m_Events.AddHandler("twitch-broadcastmetadatareceived", ShowBroadcastMetadata);

    document.documentElement.addEventListener("click", HandleLeftClick);
    document.addEventListener("keydown", HandleKeyDownAndUp);
    document.addEventListener("keyup", HandleKeyDownAndUp);
    GetNode("speed").addEventListener("change", HandlePlaybackSpeedChange);
    GetNode("rewindquality").addEventListener("change", HandleRewindQualityChange);
    GetNode("broadcastvariant").addEventListener("change", HandleBroadcastVariantChange);
    GetNode("wheelvolume").addEventListener("change", HandleWheelVolumeChange);
    GetNode("chaturl").addEventListener("change", HandleChatUrlChange);
    GetNode("settingsimportfile").addEventListener("change", HandleSettingsImportFileChoice);

    startWheelVolumeChange();
    ChangeState(STATE_START);
    ApplyImageScaling();
    ApplyInterfaceAnimation();
    m_Appearance.Start();
  }

  // ------------------------------------------------------------------------------------------
  // L'etat de la diffusion

  // Ce qu'on affiche tant qu'on ne sait rien de la diffusion.
  function UnknownBroadcastMetadata() {
    return {
      sBroadcastType: null,
      sBroadcastTitle: BROADCAST_TITLE_UNKNOWN,
      sGameName: null,
      sGameUrl: null,
      kViewers: null,
      nBroadcastDuration: null,
    };
  }

  function ChangeState(nNewState) {
    Check(Number.isInteger(nNewState));
    if (_nState === nNewState) {
      return;
    }
    m_Log.Here(`[Controls] Broadcast state changed from ${_nState} to ${nNewState}`);
    _nState = nNewState;
    document.body.setAttribute("data-state", nNewState);
    ChangeButton(
      "togglebroadcast",
      nNewState === STATE_STOP || nNewState === STATE_REPEAT
    );
    m_Events.SendEvent("controls-statechanged", nNewState);

    switch (nNewState) {
    case STATE_START:
      ShowBroadcastMetadata(UnknownBroadcastMetadata());
      m_Twitch.FinishCollectingBroadcastMetadata(true);
      break;

    case STATE_BROADCAST_START:
      ShowBroadcastMetadata(UnknownBroadcastMetadata());
      m_Twitch.StartCollectingBroadcastMetadata();
      break;

    case STATE_BROADCAST_END:
      // Le titre et la categorie restent : c'est ce qu'on vient de regarder.
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
      break;

    case STATE_PLAYING:
      // On (re)vient au direct : la pastille montre d'emblee qu'on suit le bord.
      HandleFollowingLive(true);
      break;

    case STATE_STOP:
    case STATE_REPEAT:
      // On ne regarde plus le direct : le compte de spectateurs n'est plus le notre.
      ShowBroadcastMetadata({ kViewers: null });
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

  // ------------------------------------------------------------------------------------------
  // Les metadonnees

  /*
    Les trois Show*Metadata recoivent des mises a jour partielles : un champ absent (undefined) ne
    touche a rien, un champ nul ou vide cache sa ligne. C'est ce qui permet a m_Twitch d'envoyer
    seulement ce qui a change.
  */
  function ShowChannelMetadata(oMetadata) {
    if (oMetadata.sName !== void 0) {
      ChangeDocumentTitle(`${oMetadata.sName} - Alternate Player for Twitch.tv`);
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
      ShowOptionalLine(
        "channel-language",
        oMetadata.sLanguageCode,
        () => m_i18n.GetLanguageName(oMetadata.sLanguageCode)
      );
    }
    if (oMetadata.kSubscribers !== void 0) {
      ShowOptionalLine(
        "channel-subscribers",
        Number.isFinite(oMetadata.kSubscribers),
        () => m_i18n.FormatNumber(oMetadata.kSubscribers)
      );
    }
    if (oMetadata.nChannelCreated !== void 0) {
      ShowOptionalLine(
        "channel-created",
        Number.isFinite(oMetadata.nChannelCreated),
        () => m_i18n.FormatDate(oMetadata.nChannelCreated)
      );
    }
    if (oMetadata.moTeams !== void 0) {
      ShowLinkArray(oMetadata.moTeams, "channel-teams");
    }
  }

  // Une ligne du tableau de la chaine : montree avec sa valeur, ou cachee entiere, libelle compris.
  function ShowOptionalLine(sNodeId, bKnown, fText) {
    const node = GetNode(sNodeId);
    if (bKnown) {
      node.textContent = fText();
      ShowElement(node.parentNode, true);
    } else {
      ShowElement(node.parentNode, false);
    }
  }

  function ShowLinkArray(moLinks, pInsert) {
    const nodeInsert = GetNode(pInsert);
    if (moLinks.length === 0) {
      ShowElement(nodeInsert.parentNode, false);
      return;
    }
    const oFragment = document.createDocumentFragment();
    for (let oLink, idx = 0; (oLink = moLinks[idx]); ++idx) {
      if (idx !== 0) {
        // Une virgule suivie d'une espace demi-cadratin, ecrite en echappement : une espace
        // ordinaire lui ressemble a l'oeil et remplace l'autre sans bruit a la moindre copie.
        oFragment.appendChild(document.createTextNode(", "));
      }
      Check(IsNonEmptyString(oLink.sAddress) && IsNonEmptyString(oLink.sName));
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

  function ShowViewerMetadata(oMetadata) {
    if (oMetadata.sName !== void 0) {
      if (oMetadata.sName !== "") {
        GetNode("viewer-name").textContent = oMetadata.sName;
      } else {
        // Un spectateur anonyme : le message porte un lien de connexion, d'ou le HTML.
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
        GetNode("viewer-notify").checked = oMetadata.nSubscription === SUBSCRIPTION_NOTIFY;
      }
    }
  }

  /*
		Cles de valeurs internes, pas de valeurs de Twitch. Twitch envoie « live » ou « rerun » ;
		le producteur, m_Twitch, les traduit en « live », « replay » ou null, et la fin de diffusion
		pose « ended ». Ces trois cles doivent donc suivre le producteur lettre pour lettre --
		elles sont des identifiants d'objet, qu'un renommage de chaines ne voit pas.

		Pour chacune : le libelle, l'infobulle, et si c'est du direct.
	*/
  const _oBroadcastTypes = {
    ended: ["J0145", "J0100", false],
    live: ["J0146", "J0149", true],
    replay: ["J0147", "J0150", false],
  };

  // Chaque champ qui change la largeur de la barre du haut redemande une mise en page rapide.
  function ShowBroadcastMetadata(oMetadata) {
    if (oMetadata.sBroadcastType !== void 0) {
      const node = GetNode("broadcasttype");
      if (typeof oMetadata.sBroadcastType == "string") {
        Check(_oBroadcastTypes.hasOwnProperty(oMetadata.sBroadcastType));
        const [sText, sTooltip, bLive] = _oBroadcastTypes[oMetadata.sBroadcastType];
        node.textContent = GetText(sText);
        node.parentElement.title = GetText(sTooltip);
        node.classList.toggle("livebroadcast", bLive);
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
      // L'element precedent est l'icone de la categorie : elle suit la categorie.
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
      const bKnown = Number.isFinite(oMetadata.kViewers) && oMetadata.kViewers >= 0;
      if (bKnown) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kViewers);
      }
      ShowElement(node, bKnown);
      ShowElement(node.previousElementSibling, bKnown);
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.nBroadcastDuration !== void 0) {
      GetNode("position").textContent =
        Number.isFinite(oMetadata.nBroadcastDuration) && oMetadata.nBroadcastDuration >= 0
          ? m_i18n.SecondsToString(oMetadata.nBroadcastDuration / 1e3, false)
          : "";
    }
  }

  return {
    Start,
    GetState,
    UpdateBroadcastScale,
    SeekBroadcastTo,
    ShowBroadcastPreview,
    HideBroadcastPreview,
    ChangeState,
    getReplaySpeed,
    UpdateTrackCount,
    StopWatchingBroadcast,
  };
})();
