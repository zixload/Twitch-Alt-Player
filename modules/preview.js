"use strict";
/*
	Les vignettes du survol, pour les deux barres de lecture.

	Twitch ne fabrique sa planche de vignettes qu'une fois la diffusion terminee : sur le VOD d'un
	direct en cours -- statut RECORDING -- elle repond 403. Sans elle, survoler une barre de trois
	heures ne dit rien d'autre qu'une heure. Les images sont donc rendues ici.

	Un lecteur cache joue la qualite LA PLUS BASSE de l'enregistrement, 160p, des segments de
	quelques dizaines de kilo-octets : une vignette ne merite pas de telecharger la source. Chaque
	arret est capture dans un canevas et garde en JPEG.

	Deux facons de remplir ce cache, et c'est ce qui rend le survol vif :

	  - a la demande, quand le curseur se pose : le point exact, en 65 a 140 ms d'apres les mesures ;
	  - de fond, une marche qui parcourt la diffusion de deux minutes en deux minutes, pour que la
	    bulle ait toujours quelque chose a montrer tout de suite, au pire a une minute du point vise.

	Le spectateur passe devant : tant qu'il survole, la marche attend.

	La capture exige que la video soit lisible depuis un autre domaine, faute de quoi le canevas est
	teint et toDataURL leve. Le lecteur demande donc l'autorisation ; si elle manque, la capture
	s'arrete d'elle-meme et la bulle se contente de l'heure.
*/
const m_Preview = (() => {
  const CACHE_STEP = 120;
  const SEEK_MIN_INTERVAL = 60;
  const WALK_PAUSE = 250;

  let _elVideo = null;
  let _elCanvas = null;
  let _sRecordingId = "";
  let _sPlaylistUrl = "";
  let _mFrames = new Map();
  let _nDuration = 0;
  let _nGeneration = 0;
  // La position voulue, la cadence des recherches, et la marche de fond.
  let _nWanted = -1;
  let _nLastSeek = 0;
  // Quand le curseur a demande quelque chose pour la derniere fois : la marche de fond s'efface
  // devant lui, sans quoi elle ecraserait sa position avant que l'image exacte n'arrive.
  let _nLastHover = 0;
  let _nSeekTimer = 0;
  let _nWalkTimer = 0;
  let _kWalk = 0;
  let _bCanCapture = true;
  // De quoi repeindre la meme bulle quand l'image exacte arrive.
  let _elLastImage = null;
  let _nLastTime = -1;

  const Slice = (nTime) => Math.round(nTime / CACHE_STEP);

  /*
    Prepare les vignettes d'un enregistrement. Rappelee a chaque survol : elle ne fait rien tant
    qu'il s'agit du meme, sinon la duree connue, qui grandit avec la diffusion.
  */
  function Open(sRecordingId, nDuration) {
    if (Number.isFinite(nDuration)) {
      _nDuration = nDuration;
    }
    if (sRecordingId === _sRecordingId && _elVideo !== null) {
      return;
    }
    Close();
    _sRecordingId = sRecordingId;
    const nGeneration = ++_nGeneration;
    _elVideo = document.createElement("video");
    _elVideo.muted = true;
    _elVideo.playsInline = true;
    _elVideo.preload = "auto";
    _elVideo.crossOrigin = "anonymous";
    _elVideo.hidden = true;
    _elVideo.addEventListener("seeked", AddExceptionHandler(HandleSeeked));
    document.body.appendChild(_elVideo);
    ResolveLowestQuality(sRecordingId).then(
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
            m_Log.Here(`[Preview] Thumbnails of ${sRecordingId} from the lowest quality`);
            _elVideo.src = sPlayable;
            ScheduleWalk(WALK_PAUSE);
          })
        );
      })
    );
  }

  function ResolveLowestQuality(sId) {
    if (typeof TwitchNoSub === "undefined") {
      return Promise.resolve("");
    }
    return TwitchNoSub.resolveVodQualities(sId).then((aoQualities) =>
      aoQualities.length === 0 ? "" : aoQualities[aoQualities.length - 1].sUrl
    );
  }

  function Close() {
    ++_nGeneration;
    clearTimeout(_nSeekTimer);
    clearTimeout(_nWalkTimer);
    _nSeekTimer = _nWalkTimer = 0;
    _nWanted = _nLastTime = -1;
    _nLastSeek = 0;
    _kWalk = 0;
    _bCanCapture = true;
    _elLastImage = null;
    _mFrames = new Map();
    if (_elVideo !== null) {
      _elVideo.removeAttribute("src");
      _elVideo.load();
      _elVideo.remove();
      _elVideo = null;
    }
    if (_sPlaylistUrl !== "") {
      URL.revokeObjectURL(_sPlaylistUrl);
      _sPlaylistUrl = "";
    }
    _sRecordingId = "";
  }

  /*
    Peint dans elImage la vignette la plus proche de nTime, et demande l'exacte. Rend false quand
    rien n'est encore garde : la bulle se contente alors de l'heure.
  */
  function Paint(elImage, nTime) {
    _elLastImage = elImage;
    _nLastTime = nTime;
    WantAt(nTime);
    const sImage = _mFrames.get(Slice(nTime));
    if (sImage === void 0) {
      return false;
    }
    elImage.style.backgroundImage = `url("${sImage}")`;
    elImage.style.backgroundSize = "cover";
    elImage.style.backgroundPosition = "0 0";
    return true;
  }

  /*
    A cadence, pas a l'arret du curseur : le premier mouvement cherche tout de suite, les suivants
    au plus une fois par SEEK_MIN_INTERVAL. Un ecart de moins d'une seconde ne declenche rien, la
    recherche couterait un segment pour rien.
  */
  function WantAt(nTime) {
    if (_elVideo === null) {
      return;
    }
    _nWanted = nTime;
    _nLastHover = performance.now();
    if (_nSeekTimer !== 0) {
      return;
    }
    const nSince = performance.now() - _nLastSeek;
    if (nSince >= SEEK_MIN_INTERVAL) {
      Seek();
    } else {
      _nSeekTimer = setTimeout(AddExceptionHandler(Seek), SEEK_MIN_INTERVAL - nSince);
    }
  }

  function Seek() {
    _nSeekTimer = 0;
    _nLastSeek = performance.now();
    if (_elVideo !== null && _elVideo.readyState !== 0 && Math.abs(_elVideo.currentTime - _nWanted) > 1) {
      _elVideo.currentTime = _nWanted;
    }
  }

  function HandleSeeked() {
    Capture();
    // L'image exacte vient d'arriver : la bulle qui n'avait que l'heure la montre enfin.
    if (_elLastImage !== null && _nLastTime >= 0) {
      const sImage = _mFrames.get(Slice(_nLastTime));
      if (sImage !== void 0) {
        _elLastImage.style.backgroundImage = `url("${sImage}")`;
        _elLastImage.style.backgroundSize = "cover";
        _elLastImage.style.backgroundPosition = "0 0";
        _elLastImage.hidden = false;
      }
    }
    ScheduleWalk(WALK_PAUSE);
  }

  function Capture() {
    if (!_bCanCapture || _elVideo === null || _elVideo.readyState < 2) {
      return;
    }
    if (_elCanvas === null) {
      _elCanvas = document.createElement("canvas");
    }
    _elCanvas.width = _elVideo.videoWidth;
    _elCanvas.height = _elVideo.videoHeight;
    try {
      _elCanvas.getContext("2d").drawImage(_elVideo, 0, 0);
      _mFrames.set(Slice(_elVideo.currentTime), _elCanvas.toDataURL("image/jpeg", 0.6));
    } catch (pException) {
      // Video servie sans en-tete d'autorisation : le canevas est teint, on s'en passe.
      _bCanCapture = false;
      m_Log.Oops(`[Preview] Frames cannot be kept. ${pException}`);
    }
  }

  function ScheduleWalk(nDelay) {
    if (_nWalkTimer === 0 && _bCanCapture) {
      _nWalkTimer = setTimeout(AddExceptionHandler(Walk), nDelay);
    }
  }

  function Walk() {
    _nWalkTimer = 0;
    if (_elVideo === null || !_bCanCapture || !(_nDuration > 0)) {
      return;
    }
    // Le spectateur passe devant : tant qu'il survole, la marche attend.
    if (performance.now() - _nLastHover < 500 || _nSeekTimer !== 0) {
      ScheduleWalk(500);
      return;
    }
    const kLast = Math.floor(_nDuration / CACHE_STEP);
    while (_kWalk <= kLast && _mFrames.has(_kWalk)) {
      _kWalk++;
    }
    if (_kWalk > kLast) {
      return;
    }
    _nWanted = Math.min(_kWalk * CACHE_STEP, _nDuration - 1);
    Seek();
  }

  return {
    Open,
    Close,
    Paint,
  };
})();
