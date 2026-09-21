"use strict";
/*
	Le lecteur : MediaSource, l'element video, le direct et la rediffusion.

	**Le bout de la chaine.** Les segments arrivent ici convertis, dans l'ordre, par la file ; ce
	module les empile dans le SourceBuffer et decide quand l'element video joue, attend, saute ou
	s'arrete. Rien en aval : ce qui sort d'ici, c'est l'image.

	**Deux comportements, un seul element video.** En direct (_oLiveBroadcast), le module empile,
	attend d'avoir assez de tampon pour demarrer, saute par-dessus les trous et se rapproche du direct
	quand le tampon deborde. En rediffusion (_oReplay), il cesse d'empiler et laisse le spectateur se
	deplacer dans ce qui est deja la. Les evenements de l'element video sont les memes ; c'est
	_oBehaviour qui decide quoi en faire, et la bascule ne recharge rien.

	**Une discontinuite recharge MediaSource.** Un autre encodage -- autre qualite, autre session,
	segment perdu -- ne peut pas s'empiler dans le meme SourceBuffer : ses horodatages et ses
	parametres ne suivent pas. On termine le flux, on laisse jouer ce qui reste, puis on recree
	MediaSource et on repart du chargement.

	**Chaque ligne de journal porte l'etat complet.** ShowState ecrit la position, les plages en
	tampon, l'etat de l'element et de MediaSource. C'est long, et c'est ce qui permet de lire un
	rapport de bug sans rien reproduire : une image figee se lit dans l'ecart entre deux lignes.
*/
const m_Player = (() => {
  // Au-dela de dix secondes de video vue en trop, on la retire du tampon.
  const VIDEO_REMOVAL_INTERVAL = 10;
  // Sept images a 25 im/s : en dessous, la lecture va s'arreter d'elle-meme.
  const BUFFER_EXHAUSTION = (1 / 25) * 7;
  // La rediffusion n'est proposee qu'apres au moins une seconde vue.
  const REPLAY_AVAILABLE_IF_WATCHED = 1;
  // Sans reglage de duree de rediffusion, un flux audio seul garde un peu plus de dix minutes.
  const MAX_AUDIO_REPLAY_DURATION = 640;
  // Un ajout ou un retrait qui prend plus longtemps est signale dans le journal.
  const SLOW_BUFFER_OPERATION = 100;

  // D'ou vient la verification de la position de lecture. Les valeurs positives sont des positions.
  const CHECK_SEGMENT_ADDITION = -1;
  const CHECK_PLAYBACK_START = -2;
  const CHECK_PLAYBACK = -3;
  const CHECK_PLAYBACK_STOP = -4;

  // Ce que la verification conclut.
  const PLAYBACK_IMPOSSIBLE = 0;
  const PLAYBACK_POSSIBLE = 1;
  const PLAYBACK_POSSIBLE_AFTER_SEEK = 2;

  // Ou en est le tout premier demarrage : MediaSource jamais ouvert, ouvert, lecture partie.
  const NEVER_OPENED = 0;
  const SOURCE_OPENED = 1;
  const PLAYBACK_STARTED = 2;

  const MEDIA_ELEMENT_EVENTS = [
    "progress",
    "error",
    "playing",
    "seeking",
    "seeked",
    "ended",
    "timeupdate",
    "waiting",
    "loadstart",
    "suspend",
    "abort",
    "emptied",
    "stalled",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "canplaythrough",
    "durationchange",
    "play",
    "pause",
    "ratechange",
    "resize",
  ];

  let _oMediaElement;
  let _oMediaSource;
  let _oMediaSourceBuffer = null;
  let _bHasVideoTrack = false;
  let _nPlaybackStarted = NEVER_OPENED;
  // Un ajout ou un retrait est en cours dans le SourceBuffer : le suivant attend.
  let _bAsyncOperation = false;
  // Le reglage de tampon a atteindre avant de jouer : celui du demarrage, puis, apres le premier
  // epuisement, celui de la reprise -- plus long, pour ne pas s'arreter de nouveau aussitot.
  let _sBufferSize = "nPlaybackStart";
  let _bWaitForBufferFill = true;
  // L'ecart entre l'horloge de l'element video et la position dans la diffusion.
  let _nBroadcastOffset = NaN;
  let _bSeekNeeded = false;
  /*
    Le DVR du direct. Suit-on le bord (true) ou le spectateur a-t-il rembobine dans le tampon deja
    telecharge (false) ? Un rembobinage ne coupe rien : les segments continuent d'arriver et de
    s'empiler ; on cesse seulement de se recaler sur le bord. La fenetre en arriere est ce que le
    tampon retient deja -- la duree de rediffusion reglee -- si bien que rien de neuf n'est garde en
    memoire pour l'obtenir.
  */
  let _bFollowingLive = true;
  /*
    La pause demandee par le spectateur pendant le direct. Sans ce drapeau, StartPlayback relancerait
    la lecture des le segment suivant -- il ne s'active justement que sur un element en pause -- et
    la pause ne tiendrait pas trois secondes.
  */
  let _bLivePaused = false;

  // ------------------------------------------------------------------------------------------
  // Les deux comportements

  const _oLiveBroadcast = {
    HandleSourceOpen() {
      Check(_oMediaElement.paused);
      _nPlaybackStarted = Math.max(_nPlaybackStarted, SOURCE_OPENED);
      AddNextSegment();
    },
    // Des donnees sont arrivees : peut-etre assez pour demarrer, ou trop.
    HandleProgress() {
      if (!_bAsyncOperation) {
        StartPlayback(CheckPlaybackPosition(CHECK_SEGMENT_ADDITION));
      }
      UpdateLiveScale();
    },
    HandleWaiting() {},
    HandlePlaying() {
      if (m_Controls.GetState() === STATE_PLAYBACK_START && !_oMediaElement.paused) {
        m_Controls.ChangeState(STATE_PLAYING);
      }
    },
    HandleSeeking: STUB,
    HandleSeeked: StartPlayback,
    // En direct, la fin veut dire qu'on a tout joue : on recharge et on attend la suite.
    HandleEnded() {
      ReloadPlayer(STATE_LOADING);
    },
    HandleTimeUpdate() {
      if (!_oMediaElement.seeking && !_oMediaElement.paused && !_oMediaElement.ended) {
        CheckPlaybackPosition(CHECK_PLAYBACK);
      }
      UpdateLiveScale();
    },
  };

  const _oReplay = {
    bPause: true,
    HandleSourceOpen() {
      Check(_oMediaElement.paused);
      _nPlaybackStarted = Math.max(_nPlaybackStarted, SOURCE_OPENED);
    },
    HandleProgress: STUB,
    HandleWaiting: STUB,
    HandlePlaying: STUB,
    HandleSeeked: STUB,
    HandleSeeking() {
      m_Scale.SetWatched(_oMediaElement.currentTime);
    },
    // Arrivee a la fin de l'enregistrement pendant la lecture : on reprend, et la verification de
    // position ramene au debut. La rediffusion boucle.
    HandleEnded() {
      if (!this.bPause) {
        _oMediaElement.play();
      }
    },
    HandleTimeUpdate() {
      if (!this.bPause && !_oMediaElement.seeking) {
        this.CheckPlaybackPosition(CHECK_PLAYBACK);
      }
      m_Scale.SetWatched(_oMediaElement.currentTime);
    },
    /*
      En rediffusion : sauter les trous, et en lecture, repartir du debut une fois arrive au bout.
      Un deuxieme tour sans trouver de quoi jouer serait une boucle sans fin : on s'arrete.
    */
    CheckPlaybackPosition(nTime) {
      Check(Number.isFinite(nTime));
      Check(nTime === CHECK_PLAYBACK_START || nTime === CHECK_PLAYBACK || nTime >= 0);
      const oBuffer = _oMediaElement.buffered;
      const nLastRegion = oBuffer.length - 1;
      const nCurrentTime = _oMediaElement.currentTime + 1e-4;
      let nSeekTo = nTime >= 0 ? nTime : nCurrentTime;
      let sSeekReason = "";
      for (let bStartFromBeginning = false; ; ) {
        let nNeededForPlayback =
          nTime === CHECK_PLAYBACK ? BUFFER_EXHAUSTION : MIN_BUFFER_SIZE;
        for (let nRegion = 0; nRegion <= nLastRegion; ++nRegion) {
          if (nSeekTo < oBuffer.start(nRegion)) {
            nNeededForPlayback = MIN_BUFFER_SIZE;
            sSeekReason += "Jumping over gap. ";
            nSeekTo = oBuffer.start(nRegion);
          }
          if (oBuffer.end(nRegion) - nSeekTo >= nNeededForPlayback) {
            break;
          }
        }
        if (this.bPause || nSeekTo < m_Scale.GetEnd()) {
          break;
        }
        if (bStartFromBeginning) {
          ShowState("Oops", `Endless seek Time=${nTime}`);
          return;
        }
        nSeekTo = m_Scale.GetStart();
        sSeekReason += "Starting from beginning. ";
        bStartFromBeginning = true;
      }
      if (nSeekTo !== nCurrentTime) {
        ShowState("Wow", `${sSeekReason}Seeking to ${nSeekTo}`);
        _oMediaElement.currentTime = nSeekTo;
      }
    },
  };

  let _oBehaviour = _oLiveBroadcast;

  // ------------------------------------------------------------------------------------------
  // Le journal

  /*
    Une ligne de journal avec l'etat complet du lecteur. L'importance monte d'elle-meme quand
    quelque chose cloche : plusieurs plages en tampon (un trou), une erreur de l'element video, ou
    un desaccord entre ce que MediaSource et l'element video croient avoir en tampon.

    Les marqueurs entre crochets n'apparaissent que s'ils sont vrais : [U]pdating, [P]aused,
    [S]eeking, [E]nded. Le reste n'est ecrit que s'il s'ecarte de l'etat normal.
  */
  function ShowState(sImportance, sRecord) {
    const oBuffer =
      _oMediaSource.sourceBuffers.length !== 0 ? _oMediaSource.sourceBuffers[0] : null;
    const sBufferRanges = RangesToString(oBuffer ? oBuffer.buffered : null);
    const sRanges = RangesToString(_oMediaElement.buffered);
    const bRangesEqual = sBufferRanges === sRanges;
    if (
      sImportance === "Here" &&
      ((oBuffer && oBuffer.buffered.length > 1) || _oMediaElement.buffered.length > 1)
    ) {
      sImportance = "Wow";
    }
    if (_oMediaElement.error || !bRangesEqual) {
      sImportance = "Oops";
    }
    m_Log[sImportance](
      `${sRecord.charAt(0) === "[" ? "" : "[Player] "}${sRecord} •••` +
        (oBuffer && oBuffer.updating ? " [U]" : "") +
        (_oMediaElement.paused ? " [P]" : "") +
        (_oMediaElement.seeking ? " [S]" : "") +
        (_oMediaElement.ended ? " [E]" : "") +
        (_oMediaElement.error ? ` error=${_oMediaElement.error.code}` : "") +
        (_oMediaElement.src.startsWith("blob:") ||
        _oMediaElement.src.startsWith("mediasource:")
          ? ""
          : ` src=${_oMediaElement.src}`) +
        (_oMediaSource.readyState === "open"
          ? ""
          : ` MSE.readyState=${_oMediaSource.readyState}`) +
        (_oMediaSource.sourceBuffers.length === 1
          ? ""
          : ` MSE.buffers=${_oMediaSource.sourceBuffers.length}`) +
        (_oMediaElement.networkState === HTMLMediaElement.NETWORK_LOADING
          ? ""
          : ` networkState=${_oMediaElement.networkState}`) +
        ` readyState=${_oMediaElement.readyState}` +
        ` currentTime=${_oMediaElement.currentTime}` +
        (bRangesEqual
          ? ` buffered=${sRanges}`
          : ` MSE.buffered=${sBufferRanges} buffered=${sRanges}`) +
        (_oMediaElement.duration === Infinity
          ? ""
          : ` duration=${_oMediaElement.duration}`) +
        ` seekable=${RangesToString(_oMediaElement.seekable)}` +
        ` played=${RangesToString(_oMediaElement.played)}`
    );
  }

  // Les cinq dernieres plages seulement, avec l'ecart entre elles ; « [n] » dit combien ont ete omises.
  function RangesToString(oRanges) {
    let sResult = "";
    if (oRanges && oRanges.length !== 0) {
      let nRegion = Math.max(oRanges.length - 5, 0);
      if (nRegion !== 0) {
        sResult = `[${nRegion}]`;
      }
      for (; nRegion < oRanges.length; ++nRegion) {
        if (nRegion !== 0) {
          sResult += `(${(oRanges.start(nRegion) - oRanges.end(nRegion - 1)).toFixed(3)})`;
        }
        sResult += `${oRanges.start(nRegion)}-${oRanges.end(nRegion)}`;
      }
    }
    return sResult;
  }

  // ------------------------------------------------------------------------------------------
  // Ce que les autres modules demandent

  // Ce qui a ete vu et ce qui reste a voir, de la premiere plage a la derniere, trous compris.
  function GetBufferFill(oBuffer = _oMediaElement.buffered) {
    let nWatched = 0;
    let nUnwatched = 0;
    if (oBuffer.length !== 0) {
      const nStart = oBuffer.start(0);
      const nEnd = oBuffer.end(oBuffer.length - 1);
      const nCurrentTime = Clamp(_oMediaElement.currentTime, nStart, nEnd);
      nWatched = nCurrentTime - nStart;
      nUnwatched = nEnd - nCurrentTime;
    }
    return { nWatched, nUnwatched };
  }

  function GetDroppedFrameCount() {
    return _oMediaElement.getVideoPlaybackQuality
      ? _oMediaElement.getVideoPlaybackQuality()
      : {
          totalVideoFrames: _oMediaElement.webkitDecodedFrameCount,
          droppedVideoFrames: _oMediaElement.webkitDroppedFrameCount,
        };
  }

  /*
    La position de lecture dans la diffusion, en secondes depuis son debut, ou -1 si on ne la
    connait pas. Pour un clip en rediffusion, c'est la fin de l'enregistrement qui compte -- le clip
    se cree sur les dernieres secondes de Twitch, pas sur la position du spectateur.
  */
  /*
    Le retard du spectateur sur le bord du direct, en secondes ; -1 hors direct ou sans tampon.
    C'est tout ce que le lecteur peut dire de sur : ou ce retard se place dans la diffusion, seul
    m_Twitch le sait, qui connait l'heure a laquelle elle a commence.
  */
  function GetSecondsBehindLiveEdge() {
    if (m_Controls.GetState() !== STATE_PLAYING) {
      return -1;
    }
    const oBuffer = _oMediaElement.buffered;
    if (oBuffer.length === 0) {
      return -1;
    }
    return Math.max(oBuffer.end(oBuffer.length - 1) - _oMediaElement.currentTime, 0);
  }

  function GetBroadcastPlaybackPosition(bForClip) {
    if (Number.isNaN(_nBroadcastOffset)) {
      return -1;
    }
    WatchForErrors();
    let nPlaybackPosition = _oMediaElement.currentTime;
    if (bForClip && m_Controls.GetState() === STATE_REPEAT) {
      nPlaybackPosition = m_Scale.GetEnd();
    }
    // Avant la premiere image, l'element est a zero : le debut du tampon dit mieux ou on en est.
    if (!bForClip && nPlaybackPosition === 0 && _oMediaSourceBuffer !== null) {
      if (_oMediaSourceBuffer.buffered.length !== 0) {
        nPlaybackPosition = _oMediaSourceBuffer.buffered.start(0);
      }
    }
    return nPlaybackPosition === 0 ? -1 : Math.max(nPlaybackPosition + _nBroadcastOffset, 0);
  }

  // Le convertisseur lit dans les segments leur position d'encodage et leur position dans la
  // diffusion ; leur ecart est constant tant que l'encodeur ne redemarre pas.
  function CalculateBroadcastOffset(oSegment) {
    if (
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.nBroadcastPosition)
    ) {
      const nBroadcastOffset =
        oSegment.pData.nBroadcastPosition - oSegment.pData.nEncodingPosition;
      m_Log[Math.abs(nBroadcastOffset - _nBroadcastOffset) > 2 ? "Oops" : "Here"](
        `[Player] Broadcast offset: ${m_Log.F1(nBroadcastOffset)}s`
      );
      _nBroadcastOffset = nBroadcastOffset;
    }
  }

  /*
    Le retard sur le direct, en deux temps : le temps entre l'encodage chez Twitch et l'arrivee
    ici, puis le temps que le segment attend dans le tampon avant d'etre joue. Affiche seulement
    quand les statistiques sont ouvertes.
  */
  function ShowBroadcastLatency(oSegment) {
    if (
      m_Statistics.WindowOpened() &&
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.nEncodingTime) &&
      _oMediaElement.currentTime !== 0
    ) {
      const nFetch = (performance.now() + g_nExactTime - oSegment.pData.nEncodingTime) / 1e3;
      const nPlayback = oSegment.pData.nEncodingPosition - _oMediaElement.currentTime;
      const sLatency = `${nFetch.toFixed(1)} + ${nPlayback.toFixed(1)} = ${(
        nFetch + nPlayback
      ).toFixed(1)}`;
      m_Log[nFetch > 0 && nPlayback > -0.1 ? "Here" : "Oops"](
        `[Player] Broadcast latency: ${sLatency}s`
      );
      GetNode("statistics-broadcastlatency").textContent = sLatency;
    }
  }

  function ApplyVolume() {
    _oMediaElement.volume = m_Settings.Get("nVolume2") / MAX_VOLUME;
    _oMediaElement.muted = m_Settings.Get("bMute");
  }

  // ------------------------------------------------------------------------------------------
  // Recharger, et surveiller

  function ReloadAndWaitForBufferFill(nNewState) {
    _bWaitForBufferFill = true;
    ReloadPlayer(nNewState);
  }

  // Un nouveau MediaSource sur le meme element : l'ancien SourceBuffer, et ce qu'il contenait, part.
  function ReloadPlayer(nNewState) {
    ShowState("Wow", "Reloading player");
    m_Controls.ChangeState(nNewState);
    _oBehaviour = _oLiveBroadcast;
    _bFollowingLive = true;
    _bLivePaused = false;
    _oMediaSourceBuffer = null;
    _bSeekNeeded = false;
    attachMediaSourceToMediaElement();
  }

  // Une erreur de l'element video ne se rattrape pas : le decodeur a refuse, et le dire vaut mieux
  // qu'une image figee.
  function WatchForErrors() {
    if (_oMediaElement.error) {
      m_Debug.FinishWorkAndShowMessage("J0206");
    }
  }

  const WatchMediaSourceEvents = AddExceptionHandler((oEvent) => {
    WatchForErrors();
    const sRecord = `[MediaSource] ${oEvent.type}`;
    switch (oEvent.type) {
    case "sourceopen":
      ShowState("Here", sRecord);
      _oBehaviour.HandleSourceOpen();
      break;

    case "sourceended":
    case "sourceclose":
      ShowState("Here", sRecord);
      break;

    default:
      m_Log.Here(sRecord);
    }
  });

  const WatchMediaElementEvents = AddExceptionHandler((oEvent) => {
    WatchForErrors();
    const sRecord = `[MediaElement] ${oEvent.type}`;
    switch (oEvent.type) {
    case "loadstart":
      ShowState(
        "Here",
        `${sRecord} src=${_oMediaElement.src} currentSrc=${_oMediaElement.currentSrc}`
      );
      break;

    case "progress":
      ShowState("Here", sRecord);
      _oBehaviour.HandleProgress();
      break;

    case "abort":
      ShowState("Here", sRecord);
      break;

    case "waiting":
      ShowState("Wow", sRecord);
      _oBehaviour.HandleWaiting();
      break;

    case "playing":
      ShowState("Here", sRecord);
      _oBehaviour.HandlePlaying();
      break;

    case "seeking":
      ShowState("Here", sRecord);
      _oBehaviour.HandleSeeking();
      break;

    case "seeked":
      ShowState("Here", sRecord);
      _oBehaviour.HandleSeeked();
      break;

    case "ended":
      ShowState("Here", sRecord);
      _oBehaviour.HandleEnded();
      break;

    // Plusieurs fois par seconde : une ligne courte, sans l'etat complet.
    case "timeupdate":
      m_Log.Here(
        `${sRecord} readyState=${_oMediaElement.readyState} currentTime=${
          _oMediaElement.currentTime
        } Unwatched=${m_Log.F2(GetBufferFill().nUnwatched)}`
      );
      _oBehaviour.HandleTimeUpdate();
      break;

    default:
      m_Log.Here(sRecord);
    }
  });

  // ------------------------------------------------------------------------------------------
  // Le direct : ou jouer, et quand

  /*
    Ou doit etre la lecture, et peut-elle continuer ? Selon d'ou vient la question :
      - apres un ajout de segment, le tampon peut deborder : trop de retard sur le direct, on saute
        vers la fin en gardant un tampon normal ;
      - au demarrage, on accepte au plus le tampon maximal plus une demi-duree de segment de retard ;
      - en lecture, il faut juste de quoi tenir sept images ; a l'arret, rien ne suffit.
    Un trou dans le tampon se saute toujours, et exige ensuite un tampon minimal complet.

    Rend l'une des trois conclusions PLAYBACK_*, ou rien quand un ajout n'a pas fait deborder.
  */
  function CheckPlaybackPosition(nCheckSource, nWillBeAdded = 0) {
    const oBuffer = _oMediaElement.buffered;
    const nLastRegion = oBuffer.length - 1;
    if (nLastRegion === -1) {
      return false;
    }
    const nCurrentTime = _oMediaElement.currentTime + 1e-4;
    let nSeekTo = Math.max(nCurrentTime, oBuffer.start(0));
    let sSeekReason = "";
    const nUnwatched = oBuffer.end(nLastRegion) - nSeekTo;

    if (nCheckSource === CHECK_SEGMENT_ADDITION) {
      const nBufferSize = m_Settings.Get("nMaxBufferSize");
      const nOverflow = nBufferSize + m_Settings.Get("nBufferStretch");
      /*
        Le spectateur a rembobine (DVR) : on ne le ramene pas au bord. Les segments continuent de
        s'empiler, il reste ou il regarde. On borne seulement la fenetre pour que le tampon devant lui
        ne grossisse pas sans fin, et on se remet a suivre le bord des qu'il l'a rejoint vers l'avant.
      */
      if (!_bFollowingLive) {
        const nWindow = Math.max(GetDvrWindow(), nOverflow);
        if (nUnwatched <= nBufferSize) {
          SetFollowingLive(true);
        } else if (nUnwatched <= nWindow) {
          return;
        } else {
          sSeekReason += `DVR window ${nUnwatched.toFixed(2)}s > ${nWindow}s, sliding. `;
          nSeekTo = oBuffer.end(nLastRegion) - nWindow;
        }
      } else if (nUnwatched <= nOverflow) {
        return;
      } else {
        // Avant le premier demarrage, sauter n'est pas un incident : on ne le signale pas.
        if (_nPlaybackStarted === PLAYBACK_STARTED) {
          m_Events.SendEvent("player-bufferoverflow", nUnwatched - nBufferSize);
        }
        sSeekReason += `Player buffer overflow ${nUnwatched.toFixed(2)}s > ${nOverflow}s. `;
        nSeekTo = oBuffer.end(nLastRegion) - nBufferSize - 0.1;
      }
    }

    if (nCheckSource === CHECK_PLAYBACK_START && _nPlaybackStarted !== PLAYBACK_STARTED) {
      _nPlaybackStarted = PLAYBACK_STARTED;
      const nOverflow = m_Settings.Get("nMaxBufferSize") + m_Statistics.GetTargetDuration() / 2;
      if (nUnwatched > nOverflow) {
        sSeekReason += `Broadcast latency exceeded ${nUnwatched.toFixed(2)}s > ${nOverflow}s. `;
        nSeekTo = oBuffer.end(nLastRegion) - nOverflow;
      }
    }

    Check(BUFFER_EXHAUSTION < MIN_BUFFER_SIZE);
    let nNeededForPlayback =
      nCheckSource === CHECK_PLAYBACK
        ? BUFFER_EXHAUSTION
        : nCheckSource === CHECK_PLAYBACK_STOP
          ? Infinity
          : MIN_BUFFER_SIZE;
    // Un flux termine joue jusqu'au bout, quel que soit ce qui reste.
    let bPlaybackPossible = _oMediaSource.readyState === "ended";
    let nToRangeEnd;
    for (let nRegion = 0; nRegion <= nLastRegion; ++nRegion) {
      if (nSeekTo < oBuffer.start(nRegion)) {
        nNeededForPlayback = MIN_BUFFER_SIZE;
        sSeekReason += "Jumping over gap. ";
        nSeekTo = oBuffer.start(nRegion);
      }
      nToRangeEnd = oBuffer.end(nRegion) - nSeekTo;
      if (nToRangeEnd >= nNeededForPlayback) {
        bPlaybackPossible = true;
        break;
      }
    }

    if (!bPlaybackPossible && !_oMediaElement.paused) {
      BufferExhausted(nToRangeEnd, nUnwatched, nWillBeAdded);
    }
    if (
      (bPlaybackPossible || nCheckSource === CHECK_SEGMENT_ADDITION) &&
      (nSeekTo !== nCurrentTime || _bSeekNeeded)
    ) {
      // Un saut demande sans deplacement : on se replace a la position exacte, pas a +1e-4.
      if (nSeekTo === nCurrentTime) {
        nSeekTo = _oMediaElement.currentTime;
      }
      ShowState(sSeekReason ? "Oops" : "Wow", `${sSeekReason}Seeking to ${nSeekTo}`);
      _bSeekNeeded = false;
      _oMediaElement.currentTime = nSeekTo;
      return PLAYBACK_POSSIBLE_AFTER_SEEK;
    }
    return bPlaybackPossible ? PLAYBACK_POSSIBLE : PLAYBACK_IMPOSSIBLE;
  }

  /*
    Demarrer si tout est pret. Un saut en cours, deja en lecture, ou arrive au bout : rien. Sinon on
    attend que le tampon atteigne le reglage en vigueur -- sauf si le flux est termine, ou il n'y
    aura rien de plus a attendre.
  */
  function StartPlayback(nCheck) {
    if (
      _bLivePaused ||
      _oMediaElement.seeking ||
      nCheck === PLAYBACK_POSSIBLE_AFTER_SEEK ||
      !_oMediaElement.paused ||
      _oMediaElement.ended
    ) {
      return;
    }
    if (_bWaitForBufferFill && _oMediaSource.readyState !== "ended") {
      const { nUnwatched } = GetBufferFill();
      const nBufferSize = m_Settings.Get(_sBufferSize);
      if (nUnwatched < nBufferSize) {
        m_Log.Here(`[Player] Unwatched in buffer ${m_Log.F3(nUnwatched)}s < ${nBufferSize}s`);
        return;
      }
      m_Log.Wow(`[Player] Unwatched in buffer ${m_Log.F3(nUnwatched)}s >= ${nBufferSize}s`);
    } else {
      m_Log.Wow("[Player] No need to wait for the buffer to fill");
    }
    switch (CheckPlaybackPosition(CHECK_PLAYBACK_START)) {
    case PLAYBACK_IMPOSSIBLE:
      ShowState("Oops", `No range >= ${MIN_BUFFER_SIZE}s found to start playback`);
      _bWaitForBufferFill = true;
      break;

    case PLAYBACK_POSSIBLE:
      ShowState("Wow", "Playback start");
      _bWaitForBufferFill = true;
      _oMediaElement.play();
      m_Controls.ChangeState(STATE_PLAYBACK_START);
    }
  }

  function StopPlayback(nNewState) {
    if (nNewState !== void 0) {
      m_Controls.ChangeState(nNewState);
    }
    _oMediaElement.pause();
  }

  /*
    Le tampon ne tient plus. Si ce qui arrive suffira a repartir, on laisse jouer ; sinon on met en
    pause et on attend le tampon de reprise -- plus long que celui du demarrage, pour ne pas
    retomber dans le meme trou. « Tot » : il restait plus d'une seconde en tampon, mais derriere un
    trou ; c'est une autre panne qu'un tampon simplement vide.
  */
  function BufferExhausted(nToLastRangeEnd, nUnwatched, nWillBeAdded) {
    Check(_oMediaSource.readyState !== "ended");
    Check(nToLastRangeEnd < MIN_BUFFER_SIZE);
    const bEarly = nUnwatched > 1;
    m_Statistics.PlayerBufferExhausted(bEarly);
    _sBufferSize = "nMaxBufferSize";
    const nBufferSize = m_Settings.Get(_sBufferSize);
    if (
      nToLastRangeEnd + nWillBeAdded >= MIN_BUFFER_SIZE &&
      nUnwatched + nWillBeAdded >= nBufferSize
    ) {
      ShowState(
        bEarly ? "Oops" : "Wow",
        `Buffer exhausted, no stop needed WillBeAdded=${m_Log.F3(
          nWillBeAdded
        )}s ToLastRangeEnd=${m_Log.F3(nToLastRangeEnd)}s Unwatched=${m_Log.F3(
          nUnwatched
        )}s BufferSize=${nBufferSize}s`
      );
    } else {
      ShowState(
        bEarly ? "Oops" : "Wow",
        `Pausing playback to fill the buffer ToLastRangeEnd=${m_Log.F3(
          nToLastRangeEnd
        )}s Unwatched=${m_Log.F3(nUnwatched)}s BufferSize=${nBufferSize}s`
      );
      _bSeekNeeded = true;
      StopPlayback(STATE_LOADING);
    }
  }

  /*
    Une discontinuite arrive. S'il ne reste presque rien a jouer, on recharge tout de suite. Sinon on
    declare la fin du flux : l'element video joue ce qui reste, et son evenement « ended »
    declenchera le rechargement.
  */
  function EndStream(oSegment) {
    ShowState("Wow", `Segment ${oSegment.nNumber} caused end of stream`);
    if (
      _oMediaElement.buffered.length === 0 ||
      (_oMediaElement.paused && GetBufferFill().nUnwatched < BUFFER_EXHAUSTION + 0.1)
    ) {
      ReloadAndWaitForBufferFill(STATE_LOADING);
    } else {
      _bWaitForBufferFill =
        typeof oSegment.pData == "number" ||
        (!_oMediaElement.seeking && _oMediaElement.paused);
      _oMediaSource.endOfStream();
      StartPlayback();
    }
  }

  // ------------------------------------------------------------------------------------------
  // Le SourceBuffer : retirer, ajouter

  /*
    Ce qui a ete vu au-dela de la duree de rediffusion reglee est retire, par tranches de dix
    secondes pour ne pas retirer a chaque segment. En mode automatique, une piste video n'est jamais
    retiree ici, et un flux audio seul garde un peu plus de dix minutes.
  */
  function RemoveWatchedVideo(oSegment) {
    WatchForErrors();
    let nReplayDuration = m_Settings.Get("nReplayDuration2");
    if (nReplayDuration === AUTO_SETTING) {
      if (_bHasVideoTrack) {
        return Promise.resolve(oSegment);
      }
      nReplayDuration = MAX_AUDIO_REPLAY_DURATION;
    }
    const { nWatched } = GetBufferFill(_oMediaSourceBuffer.buffered);
    if (nWatched < nReplayDuration + VIDEO_REMOVAL_INTERVAL) {
      return Promise.resolve(oSegment);
    }
    const nRemoveUntil = _oMediaElement.currentTime - nReplayDuration;
    return new Promise((fResolve, fReject) => {
      ShowState(
        "Here",
        `Removing watched video Watched=${m_Log.F3(nWatched)}s RemoveUntil=${m_Log.F3(
          nRemoveUntil
        )}s`
      );
      _oMediaSourceBuffer.addEventListener("updateend", Removed);
      let nElapsedTime = -performance.now();
      _oMediaSourceBuffer.remove(0, nRemoveUntil);
      function Removed() {
        try {
          // Le lecteur a ete recharge pendant le retrait : ce SourceBuffer n'existe plus.
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
            return;
          }
          nElapsedTime += performance.now();
          _oMediaSourceBuffer.removeEventListener("updateend", Removed);
          const { nWatched } = GetBufferFill(_oMediaSourceBuffer.buffered);
          ShowState(
            nElapsedTime > SLOW_BUFFER_OPERATION || nWatched < MIN_BUFFER_SIZE ? "Oops" : "Here",
            `Watched video removed in ${m_Log.F0(nElapsedTime)}ms Watched=${m_Log.F0(nWatched)}s`
          );
          fResolve(oSegment);
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }

  function AppendInitSegment(oSegment) {
    return AppendSegment(oSegment, oSegment.pData.mbInitializationSegment, "initialisation segment");
  }

  function AppendMediaSegment(oSegment) {
    return AppendSegment(oSegment, oSegment.pData.mbMediaSegment, "mediasegment");
  }

  function AppendSegment(oSegment, mbAppend, sAppend) {
    WatchForErrors();
    return new Promise((fResolve, fReject) => {
      ShowState("Here", `Appending ${sAppend} ${oSegment.nNumber}`);
      _oMediaSourceBuffer.addEventListener("updateend", Appended);
      let nElapsedTime = -performance.now();
      _oMediaSourceBuffer.appendBuffer(mbAppend);
      function Appended() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
            return;
          }
          nElapsedTime += performance.now();
          _oMediaSourceBuffer.removeEventListener("updateend", Appended);
          ShowState(
            nElapsedTime > SLOW_BUFFER_OPERATION ? "Oops" : "Here",
            `Appended ${sAppend} ${oSegment.nNumber} in ${m_Log.F0(nElapsedTime)}ms`
          );
          fResolve(oSegment);
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }

  // Avant d'ajouter : le tampon tiendra-t-il jusqu'a ce que ce segment arrive ?
  function CheckBufferExhaustion(oSegment) {
    if (!_oMediaElement.seeking && !_oMediaElement.paused && !_oMediaElement.ended) {
      CheckPlaybackPosition(CHECK_PLAYBACK, oSegment.nDuration);
    }
    if (_oMediaElement.played.length !== 0) {
      m_Statistics.updateBufferFill(GetBufferFill().nUnwatched);
    }
    return oSegment;
  }

  function SegmentWasAppended(oSegment) {
    _bAsyncOperation = false;
    g_maQueue.Remove(oSegment);
    CalculateBroadcastOffset(oSegment);
    // Une rediffusion attend en tete de file : inutile de verifier la lecture du direct.
    if (!(g_maQueue[0] && g_maQueue[0].pData === STATE_REPEAT)) {
      const nCheck = CheckPlaybackPosition(CHECK_SEGMENT_ADDITION);
      // Un autre segment deja converti suit : on l'ajoute d'abord, on demarrera apres.
      if (!(g_maQueue[0] && g_maQueue[0].nProcessing === PROCESSING_CONVERTED)) {
        StartPlayback(nCheck);
        ShowBroadcastLatency(oSegment);
      }
    }
    AddNextSegment();
  }

  const SegmentWasNotAppended = AddExceptionHandler((pReason) => {
    _bAsyncOperation = false;
    if (pReason !== PromiseCancellation.REASON) {
      throw pReason;
    }
    m_Log.Here("[Player] Segment append cancelled");
  });

  /*
    MediaSource ne s'est jamais ouvert, et les segments convertis s'accumulent sans pouvoir etre
    empiles. Au-dela du debordement maximal, on arrete le direct
    plutot que de remplir la memoire.
  */
  function PreventQueueOverflow() {
    const { nDuration } = g_maQueue.CountConvertedSegments();
    if (nDuration >= BUFFER_OVERFLOW) {
      m_Log.Oops(`[Player] MediaSource closed for too long ${nDuration}s >= ${BUFFER_OVERFLOW}s`);
      Check(
        m_Controls.GetState() === STATE_START ||
          m_Controls.GetState() === STATE_BROADCAST_START
      );
      m_Controls.StopWatchingBroadcast();
    }
  }

  /*
    Un changement de qualite converti est arrive : tout ce qui le precede dans la file appartient a
    l'ancienne qualite. On le jette avec le marqueur, en gardant les autres marqueurs d'etat, et on
    recharge le lecteur pour la nouvelle.
  */
  function DetectAndHandleBroadcastVariantChange() {
    for (let idx = g_maQueue.length; --idx >= 0; ) {
      if (
        g_maQueue[idx].pData === STATE_VARIANT_CHANGE &&
        g_maQueue[idx].nProcessing === PROCESSING_CONVERTED
      ) {
        g_maQueue.ShowState();
        do {
          if (
            g_maQueue[idx].pData === STATE_VARIANT_CHANGE ||
            typeof g_maQueue[idx].pData != "number"
          ) {
            g_maQueue.Remove(idx);
          }
        } while (--idx >= 0);
        g_maQueue.ShowState();
        ReloadAndWaitForBufferFill(STATE_LOADING);
        break;
      }
    }
  }

  /*
    Le coeur du direct : prendre le segment en tete de file et en faire quelque chose. Un marqueur
    change l'etat ; un segment media est empile -- apres avoir retire la video trop ancienne, verifie
    que le tampon tient, et ajoute l'en-tete d'initialisation s'il en porte un. Un seul ajout a la
    fois ; le suivant part quand celui-ci est fini.
  */
  function AddNextSegment() {
    WatchForErrors();
    DetectAndHandleBroadcastVariantChange();
    const oSegment = g_maQueue[0];
    if (!oSegment || oSegment.nProcessing !== PROCESSING_CONVERTED) {
      return;
    }
    Check(_oBehaviour === _oLiveBroadcast);

    if (oSegment.pData === STATE_BROADCAST_START) {
      Check(_oMediaSource.sourceBuffers.length === 0);
      _nBroadcastOffset = NaN;
      m_Controls.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_bAsyncOperation) {
      return;
    }
    if (oSegment.pData === STATE_REPEAT) {
      Check(
        m_Controls.GetState() !== STATE_STOP && m_Controls.GetState() !== STATE_REPEAT
      );
      StartReplay();
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }

    const sReadyState = _oMediaSource.readyState;
    if (sReadyState !== "open") {
      m_Log.Here(
        `[Player] Appending segment ${oSegment.nNumber} postponed MediaSource.readyState=${sReadyState} MediaElement.src=${_oMediaElement.src}`
      );
      if (sReadyState === "closed" && _nPlaybackStarted === NEVER_OPENED) {
        PreventQueueOverflow();
      }
      return;
    }
    if (oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length !== 0) {
      EndStream(oSegment);
      return;
    }
    if (oSegment.pData === STATE_BROADCAST_END) {
      Check(oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length === 0);
      m_Controls.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }

    if (_oMediaSource.sourceBuffers.length === 0) {
      AddSourceBuffers(oSegment);
      m_Controls.UpdateTrackCount(oSegment.pData.bHasVideo, oSegment.pData.bHasAudio);
    }
    _bAsyncOperation = true;
    let oPromise = RemoveWatchedVideo(oSegment).then(CheckBufferExhaustion);
    if (oSegment.pData.mbInitializationSegment) {
      oPromise = oPromise.then(AppendInitSegment);
    }
    oPromise
      .then(AppendMediaSegment)
      .then(SegmentWasAppended)
      .catch(SegmentWasNotAppended);
  }

  // ------------------------------------------------------------------------------------------
  // Le DVR du direct : rembobiner sans couper, revenir au bord

  // La profondeur du DVR en arriere : ce que le tampon retient deja derriere la lecture. En mode
  // automatique (une piste video n'est jamais retiree), tout est garde, donc rien ne borne la fenetre.
  function GetDvrWindow() {
    const nReplayDuration = m_Settings.Get("nReplayDuration2");
    return nReplayDuration === AUTO_SETTING ? Infinity : nReplayDuration;
  }

  function IsFollowingLive() {
    return _bFollowingLive;
  }

  function SetFollowingLive(bFollowing) {
    if (_bFollowingLive === bFollowing) {
      return;
    }
    _bFollowingLive = bFollowing;
    m_Events.SendEvent("player-followinglive", bFollowing);
  }

  /*
    Tenir la barre a jour pendant le direct : la fenetre va du debut du tampon au bord. Tant qu'on
    suit le bord, la barre reste pleine et immobile -- peindre la position reelle la ferait osciller a
    chaque petit recalage. Elle ne se deplace qu'une fois le spectateur en arriere (DVR). Sans tampon
    encore, il n'y a rien a peindre.
  */
  function UpdateLiveScale() {
    const oBuffer = _oMediaElement.buffered;
    if (oBuffer.length === 0) {
      return;
    }
    const nEdge = oBuffer.end(oBuffer.length - 1);
    m_Scale.SetStartAndEnd(oBuffer.start(0), nEdge);
    m_Scale.SetWatched(_bFollowingLive ? nEdge : _oMediaElement.currentTime);
  }

  /*
    Rembobiner dans le tampon du direct. Le telechargement continue ; on cesse seulement de suivre le
    bord. Un point tout au bord -- a moins d'un tampon du direct -- est un retour au direct.
  */
  function SeekLiveTo(nSeekTo) {
    Check(m_Controls.GetState() === STATE_PLAYING);
    const oBuffer = _oMediaElement.buffered;
    if (oBuffer.length === 0) {
      return;
    }
    const nEdge = oBuffer.end(oBuffer.length - 1);
    nSeekTo = Clamp(nSeekTo, oBuffer.start(0), nEdge);
    if (nEdge - nSeekTo <= m_Settings.Get("nMaxBufferSize")) {
      JumpToLive();
      return;
    }
    SetFollowingLive(false);
    _bLivePaused = false;
    ShowState("Wow", `DVR seeking to ${nSeekTo}`);
    _oMediaElement.currentTime = nSeekTo;
    if (_oMediaElement.paused) {
      _oMediaElement.play().catch(STUB);
    }
    UpdateLiveScale();
  }

  // Sauter au bord du direct et s'y recaler. Le tampon normal de latence nous en separe.
  function JumpToLive() {
    Check(m_Controls.GetState() === STATE_PLAYING);
    SetFollowingLive(true);
    _bLivePaused = false;
    const oBuffer = _oMediaElement.buffered;
    if (oBuffer.length !== 0) {
      const nEdge = oBuffer.end(oBuffer.length - 1);
      const nSeekTo = Math.max(nEdge - m_Settings.Get("nMaxBufferSize"), oBuffer.start(0));
      ShowState("Wow", `Returning to live edge, seeking to ${nSeekTo}`);
      _oMediaElement.currentTime = nSeekTo;
    }
    if (_oMediaElement.paused) {
      _oMediaElement.play().catch(STUB);
    }
    UpdateLiveScale();
  }

  // ------------------------------------------------------------------------------------------
  // La rediffusion

  function SeekReplayTo(nSeekTo) {
    Check(m_Controls.GetState() === STATE_REPEAT);
    _oReplay.CheckPlaybackPosition(nSeekTo);
  }

  // En secondes, ou en images quand bFrames : la plus courte duree d'image mesuree.
  function SeekReplayBy(bFrames, nSeekBy) {
    Check(m_Controls.GetState() === STATE_REPEAT);
    Check(Number.isFinite(nSeekBy));
    if (bFrames) {
      nSeekBy *= m_Statistics.GetFrameDurationInSeconds().nMinimum;
    }
    if (nSeekBy !== 0) {
      SeekReplayTo(
        Clamp(_oMediaElement.currentTime + nSeekBy, m_Scale.GetStart(), m_Scale.GetEnd())
      );
    }
  }

  /*
    Mettre un direct en pause, c'est cesser de suivre le bord. Les segments continuent d'arriver et
    de s'empiler ; l'image reste ou le spectateur l'a laissee. Sans cela le lecteur le ramenerait de
    lui-meme au bord des que le tampon deborde, et la pause ne tiendrait pas.

    Reprendre ne ramene pas au direct : la lecture repart d'ou elle s'etait arretee, et le bouton
    du direct est la pour revenir au bord quand il le veut.

    Jusqu'ou il peut rester en arriere, c'est la fenetre du DVR qui le dit -- le reglage de duree de
    rediffusion, « Auto » pour ne rien jeter. Au-dela, le lecteur avance la fenetre pour que le
    tampon ne grossisse pas sans fin.
  */
  function TogglePauseLive() {
    if (_bLivePaused) {
      m_Log.Wow("[Player] Resuming the live where it was paused");
      _bLivePaused = false;
      _oMediaElement.play().catch(STUB);
    } else {
      m_Log.Wow("[Player] Pausing the live");
      _bLivePaused = true;
      SetFollowingLive(false);
      _oMediaElement.pause();
    }
    UpdateLiveScale();
    m_Events.SendEvent("player-paused", _oMediaElement.paused);
  }

  function TogglePause() {
    const nState = m_Controls.GetState();
    Check(nState === STATE_REPEAT || nState === STATE_PLAYING);
    if (nState === STATE_PLAYING) {
      TogglePauseLive();
      return;
    }
    _oReplay.bPause = !_oReplay.bPause;
    if (_oReplay.bPause) {
      m_Log.Wow("[Player] Pausing replay");
      _oMediaElement.pause();
    } else {
      m_Log.Wow("[Player] Resuming replay");
      _oReplay.CheckPlaybackPosition(CHECK_PLAYBACK_START);
      _oMediaElement.play();
    }
    m_Events.SendEvent("player-paused", _oReplay.bPause);
  }

  function SetReplaySpeed(nSpeed) {
    Check(nSpeed > 0);
    Check(m_Controls.GetState() === STATE_REPEAT);
    m_Log.Wow(`[Player] Speed set to ${nSpeed}`);
    _oMediaElement.playbackRate = nSpeed;
  }

  /*
    Le direct s'arrete, ce qui est en tampon devient la rediffusion. Le flux est declare termine pour
    que l'element video puisse jouer jusqu'au bout. Pas assez vu pour qu'une rediffusion ait un
    sens : on s'arrete tout court.
  */
  function StartReplay() {
    _oReplay.bPause = true;
    _oBehaviour = _oReplay;
    StopPlayback();
    if (_oMediaSource.sourceBuffers.length !== 0 && _oMediaSource.readyState === "open") {
      _oMediaSource.endOfStream();
    }
    if (
      _oMediaElement.played.length === 0 ||
      GetBufferFill().nWatched < REPLAY_AVAILABLE_IF_WATCHED
    ) {
      ShowState("Wow", "Nothing to replay");
      m_Controls.ChangeState(STATE_STOP);
      return;
    }
    ShowState("Wow", "Starting replay");
    m_Events.SendEvent("player-paused", _oReplay.bPause);
    m_Scale.SetStartAndEnd(
      _oMediaElement.buffered.start(0),
      _oMediaElement.buffered.end(_oMediaElement.buffered.length - 1)
    );
    m_Scale.SetWatched(_oMediaElement.currentTime);
    m_Controls.ChangeState(STATE_REPEAT);
    SetReplaySpeed(m_Controls.getReplaySpeed());
  }

  // ------------------------------------------------------------------------------------------
  // MediaSource

  // Le SourceBuffer se cree au premier segment, parce que c'est lui qui porte les codecs.
  function AddSourceBuffers(oSegment) {
    m_Log.Wow(`[Player] Adding buffer ${oSegment.pData.sCodecs}`);
    Check(oSegment.bDiscontinuity && oSegment.pData.sCodecs);
    try {
      _oMediaSourceBuffer = _oMediaSource.addSourceBuffer(oSegment.pData.sCodecs);
    } catch (pException) {
      // Un codec que ce navigateur ne sait pas decoder : on le dit plutot que d'afficher du noir.
      if (IsObject(pException) && pException.name === "NotSupportedError") {
        m_Debug.FinishWorkAndShowMessage("J0201");
      } else {
        m_Debug.CaughtException(pException);
      }
    }
    _bHasVideoTrack = oSegment.pData.bHasVideo;
    for (const sEvent of ["updatestart", "update", "updateend", "abort", "error"]) {
      _oMediaSourceBuffer.addEventListener(sEvent, WatchMediaSourceEvents);
    }
  }

  function attachMediaSourceToMediaElement() {
    if (_oMediaElement.src) {
      URL.revokeObjectURL(_oMediaElement.src);
    }
    _oMediaElement.src = URL.createObjectURL(_oMediaSource);
    m_AudioDevice.start(_oMediaElement);
  }

  function Start() {
    Check(!_oMediaElement);
    try {
      _oMediaSource = new MediaSource();
    } catch (pException) {
      console.error(`MediaSource ${pException}`);
      m_Debug.FinishWorkAndShowMessage("J0221");
    }
    _oMediaSource.addEventListener("sourceopen", WatchMediaSourceEvents);
    _oMediaSource.addEventListener("sourceended", WatchMediaSourceEvents);
    _oMediaSource.addEventListener("sourceclose", WatchMediaSourceEvents);
    _oMediaSource.sourceBuffers.addEventListener("addsourcebuffer", WatchMediaSourceEvents);
    _oMediaSource.sourceBuffers.addEventListener("removesourcebuffer", WatchMediaSourceEvents);
    _oMediaElement = document.getElementById("eye");
    ApplyVolume();
    m_PictureInPicture.start(_oMediaElement);
    for (const sEvent of MEDIA_ELEMENT_EVENTS) {
      _oMediaElement.addEventListener(sEvent, WatchMediaElementEvents);
    }
    attachMediaSourceToMediaElement();
    return true;
  }

  // Liberer le flux et vider l'element, pour que le navigateur relache le decodeur tout de suite.
  function Stop() {
    if (_oMediaElement) {
      URL.revokeObjectURL(_oMediaElement.src);
      _oMediaElement.removeAttribute("src");
      _oMediaElement.load();
    }
  }

  return {
    Start,
    Stop,
    GetBufferFill,
    GetDroppedFrameCount,
    GetBroadcastPlaybackPosition,
    GetSecondsBehindLiveEdge,
    ShowState,
    Reload: ReloadAndWaitForBufferFill,
    ApplyVolume,
    AddNextSegment,
    IsFollowingLive,
    SeekLiveTo,
    JumpToLive,
    SeekReplayTo,
    SeekReplayBy,
    TogglePause,
    SetReplaySpeed,
  };
})();
