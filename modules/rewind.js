"use strict";
/*
	Remonter avant ce que le navigateur garde du direct.

	Le tampon du direct ne retient que quelques minutes : mesure a l'appui, il cesse de grandir vers
	166 secondes meme quand on ne jette rien, Chrome ecartant le plus ancien de lui-meme. Pour
	remonter plus loin il existe une autre source de la meme diffusion, le VOD que Twitch enregistre
	pendant qu'elle passe. Mesure sur trois chaines : il est en retard de zero a cinq secondes sur le
	direct. Aucun trou entre les deux, donc, et plusieurs minutes de recouvrement pour passer de
	l'une a l'autre.

	Ce module tient ce second lecteur, pose sur la meme scene, par-dessus celui du direct. Rien du
	chemin du direct n'est touche -- ni son tampon, ni le convertisseur, ni le contournement de pub.
	Le direct continue derriere, en sourdine : revenir au bord est alors immediat.

	Les positions qu'il recoit et qu'il rend sont des secondes depuis le debut de la diffusion. C'est
	la seule echelle commune aux deux sources, et celle que m_Twitch sait calculer. Elle tombe juste
	ici sans conversion : la liste du VOD commence a zero au debut de la diffusion.
*/
const m_Rewind = (() => {
  let _elVideo = null;
  let _elLive = null;
  // Le VOD dont la liste est chargee, et l'adresse fabriquee pour lui.
  let _sRecordingId = "";
  let _sPlaylistUrl = "";
  // La position demandee tant que la liste n'a pas fini de s'ouvrir.
  let _nWantedPosition = -1;
  let _nGeneration = 0;
  let _bShown = false;

  function Start() {
    _elVideo = GetNode("rewind");
    _elLive = GetNode("eye");
    _elVideo.addEventListener(
      "loadedmetadata",
      AddExceptionHandler(() => {
        if (_nWantedPosition >= 0) {
          _elVideo.currentTime = Math.min(_nWantedPosition, _elVideo.duration || _nWantedPosition);
          _nWantedPosition = -1;
        }
      })
    );
    _elVideo.addEventListener(
      "timeupdate",
      AddExceptionHandler(() => {
        if (_bShown) {
          m_Controls.UpdateBroadcastScale();
        }
      })
    );
    _elVideo.addEventListener(
      "error",
      AddExceptionHandler(() => {
        m_Log.Oops(`[Rewind] Playback failed. ${_elVideo.error && _elVideo.error.message}`);
        Stop();
      })
    );
  }

  function IsShown() {
    return _bShown;
  }

  // La position dans la diffusion, en secondes depuis son debut.
  function GetPosition() {
    return _bShown ? _elVideo.currentTime : -1;
  }

  /*
    Montre la diffusion a la position demandee. Rend false quand il n'y a pas de VOD -- une chaine
    qui ne garde pas ses enregistrements -- auquel cas l'appelant reste sur le direct.
  */
  function PlayAt(nPosition) {
    const sId = m_Twitch.GetCurrentRecordingId();
    if (!IsNonEmptyString(sId)) {
      m_Log.Oops("[Rewind] No recording of this broadcast to rewind into");
      return false;
    }
    Show();
    if (sId === _sRecordingId && _sPlaylistUrl !== "") {
      SeekTo(nPosition);
      return true;
    }
    Load(sId, nPosition);
    return true;
  }

  function SeekTo(nPosition) {
    if (!_bShown) {
      return;
    }
    if (_elVideo.readyState === 0) {
      // La liste n'est pas encore ouverte : la position attend loadedmetadata.
      _nWantedPosition = nPosition;
      return;
    }
    _elVideo.currentTime = Math.max(Math.min(nPosition, _elVideo.duration || nPosition), 0);
    if (_elVideo.paused) {
      _elVideo.play().catch(STUB);
    }
  }

  /*
    Ouvre le VOD. TwitchNoSub en donne toutes les qualites, y compris celles reservees aux abonnes ;
    la premiere est la source. La liste d'un direct en cours grandit encore, donc on la referme pour
    que le navigateur y voie une video finie et la laisse parcourir.
  */
  function Load(sId, nPosition) {
    const nGeneration = ++_nGeneration;
    _sRecordingId = sId;
    _nWantedPosition = nPosition;
    ReleasePlaylist();
    m_Log.Wow(`[Rewind] Opening recording ${sId} at ${m_Log.F0(nPosition)}s`);
    ResolveSource(sId)
      .then(
        AddExceptionHandler((sUrl) => {
          if (nGeneration !== _nGeneration || !IsNonEmptyString(sUrl)) {
            return;
          }
          return makeSeekablePlaylist(sUrl).then(
            AddExceptionHandler((sPlayable) => {
              if (nGeneration !== _nGeneration) {
                return;
              }
              if (sPlayable !== sUrl) {
                _sPlaylistUrl = sPlayable;
              }
              _elVideo.src = sPlayable;
              _elVideo.play().catch(STUB);
            })
          );
        })
      )
      .catch(
        AddExceptionHandler((pReason) => {
          m_Log.Oops(`[Rewind] Could not open the recording. ${pReason}`);
          Stop();
        })
      );
  }

  function ResolveSource(sId) {
    if (typeof TwitchNoSub === "undefined") {
      return m_Twitch.GetVideoPlaybackUrl(sId);
    }
    return TwitchNoSub.resolveVodQualities(sId).then((aoQualities) =>
      aoQualities.length === 0 ? m_Twitch.GetVideoPlaybackUrl(sId) : aoQualities[0].sUrl
    );
  }

  /*
    Le direct passe en sourdine et reste derriere : il continue de telecharger, donc revenir au bord
    ne coute rien. Le son suit le reglage du lecteur, comme sur le direct.
  */
  function Show() {
    if (_bShown) {
      return;
    }
    _bShown = true;
    _elLive.muted = true;
    _elVideo.volume = m_Settings.Get("nVolume2") / MAX_VOLUME;
    _elVideo.muted = m_Settings.Get("bMute");
    _elVideo.hidden = false;
    m_Events.SendEvent("rewind-changed", true);
  }

  function Stop() {
    ++_nGeneration;
    _nWantedPosition = -1;
    if (_elVideo !== null) {
      _elVideo.pause();
      _elVideo.removeAttribute("src");
      // Sans load(), l'element garde le flux ouvert et continue de le telecharger.
      _elVideo.load();
      _elVideo.hidden = true;
    }
    ReleasePlaylist();
    _sRecordingId = "";
    if (!_bShown) {
      return;
    }
    _bShown = false;
    m_Player.ApplyVolume();
    m_Events.SendEvent("rewind-changed", false);
  }

  function ReleasePlaylist() {
    if (_sPlaylistUrl !== "") {
      URL.revokeObjectURL(_sPlaylistUrl);
      _sPlaylistUrl = "";
    }
  }

  // Le son du lecteur a change : il vaut pour la source montree.
  function ApplyVolume() {
    if (_bShown) {
      _elVideo.volume = m_Settings.Get("nVolume2") / MAX_VOLUME;
      _elVideo.muted = m_Settings.Get("bMute");
      _elLive.muted = true;
    }
  }

  return {
    Start,
    PlayAt,
    SeekTo,
    Stop,
    IsShown,
    GetPosition,
    ApplyVolume,
  };
})();
