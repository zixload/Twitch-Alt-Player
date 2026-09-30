"use strict";
/*
	L'image figee au retour sur l'onglet.

	PANNE RAPPORTEE, pas reproduite ici. On quitte l'onglet pendant une rediffusion, on y revient :
	le son continue, l'image reste sur sa derniere vue, et seul un rechargement de la page la ramene.
	Pas a tous les coups. Un navigateur pilote ne le rejoue pas : il ne parvient jamais a l'etat
	« onglet reellement visible », et la mesure ne vaut alors rien.

	D'ou un chien de garde plutot qu'une correction de la cause. Il ne cherche pas a savoir pourquoi
	le decodeur s'arrete ; il constate l'etat decrit, qui ne ressemble a aucun autre : la lecture
	avance -- donc l'element n'est ni en pause ni a court de donnees -- et pas une image nouvelle
	n'est produite. Aucune lecture saine ne donne ca : a trente images par seconde, sept dixiemes de
	seconde en valent une vingtaine, et une lecture qui cale vraiment n'avance pas non plus.

	Le remede est celui du metier : un deplacement d'un millieme de seconde. Il force le decodeur a
	repartir, la ou une pause suivie d'une reprise ne fait souvent que reprendre le meme etat. Si
	l'image reste figee, une pause et une reprise sont tentees ensuite, puis on s'arrete la et on
	l'ecrit dans le journal : un rapport de panne dira au moins que c'est arrive, et ce qui a ete
	essaye.

	NE SURVEILLE QUE LES VIDEOS, pas le direct. Le direct a sa propre mecanique de trous et de
	recalage dans m_Player, et son element porte l'etat du suivi du bord : un deplacement ecrit par
	ici lui ferait croire que le spectateur a recule.
*/
const m_Unfreeze = (() => {
  // Ce qu'on laisse passer avant de juger : assez pour qu'une lecture saine ait produit ses images.
  const LOOK_AFTER = 700;
  // Le temps laisse au deplacement pour agir avant d'essayer la pause.
  const SECOND_CHANCE = 1200;
  // En deca, la lecture n'avance pas assez pour qu'on puisse conclure quoi que ce soit.
  const TIME_MOVED = 0.15;
  // Le deplacement lui-meme : invisible a l'oeil, suffisant pour le decodeur.
  const NUDGE = 0.001;

  const _aoWatched = [];

  function Watch(elVideo) {
    Check(elVideo instanceof HTMLVideoElement);
    _aoWatched.push(elVideo);
  }

  function Frames(elVideo) {
    const oQuality = elVideo.getVideoPlaybackQuality
      ? elVideo.getVideoPlaybackQuality()
      : null;
    return oQuality ? oQuality.totalVideoFrames : NaN;
  }

  // Ni en pause, ni vide, ni sans image : hors de la, la question ne se pose pas.
  function IsPlaying(elVideo) {
    return (
      !elVideo.paused &&
      !elVideo.ended &&
      elVideo.readyState >= 2 &&
      elVideo.videoWidth > 0
    );
  }

  /*
    Rend vrai quand la lecture a avance sans qu'une image soit produite. Le compte d'images peut
    manquer -- un navigateur qui ne le tient pas rend NaN -- et alors on ne conclut rien : mieux
    vaut ne rien faire que deplacer la lecture sur une comparaison qui ne veut rien dire.
  */
  function IsFrozen(elVideo, nFramesBefore, nTimeBefore) {
    const nFrames = Frames(elVideo);
    return (
      IsPlaying(elVideo) &&
      Number.isFinite(nFrames) &&
      Number.isFinite(nFramesBefore) &&
      nFrames === nFramesBefore &&
      elVideo.currentTime - nTimeBefore > TIME_MOVED
    );
  }

  function Nudge(elVideo) {
    const nPosition = elVideo.currentTime;
    m_Log.Oops(
      `[Unfreeze] Frozen picture at ${nPosition.toFixed(1)}s, nudging the decoder`
    );
    elVideo.currentTime = nPosition + NUDGE;
  }

  function PauseAndPlay(elVideo) {
    m_Log.Oops("[Unfreeze] Still frozen, pausing and playing again");
    elVideo.pause();
    elVideo.play().catch(STUB);
  }

  /*
    Une mesure, une attente, une comparaison. Deux fois, parce que le deplacement peut ne pas
    suffire -- et pas trois : au-dela, ce n'est plus un remede, c'est un tic.
  */
  function Examine(elVideo) {
    if (!IsPlaying(elVideo)) {
      return;
    }
    const nFrames = Frames(elVideo);
    const nTime = elVideo.currentTime;
    setTimeout(
      AddExceptionHandler(() => {
        if (!IsFrozen(elVideo, nFrames, nTime)) {
          return;
        }
        Nudge(elVideo);
        const nFramesAfter = Frames(elVideo);
        const nTimeAfter = elVideo.currentTime;
        setTimeout(
          AddExceptionHandler(() => {
            if (IsFrozen(elVideo, nFramesAfter, nTimeAfter)) {
              PauseAndPlay(elVideo);
            }
          }),
          SECOND_CHANCE
        );
      }),
      LOOK_AFTER
    );
  }

  // La page revient sous les yeux du spectateur : c'est la, et seulement la, qu'on regarde.
  const HandleFocusChange = AddExceptionHandler((oState) => {
    if (!oState.bShown) {
      return;
    }
    for (const elVideo of _aoWatched) {
      Examine(elVideo);
    }
  });

  function Start() {
    Watch(GetNode("videos-video"));
    Watch(GetNode("rewind"));
    m_Events.AddHandler("focus-statechanged", HandleFocusChange);
  }

  return {
    Start,
    Watch,
    Examine,
  };
})();
