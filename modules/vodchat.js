"use strict";
/*
	Le chat d'une rediffusion, rejoue a l'heure de ce qu'on regarde.

	Le chat du direct n'a rien a dire d'une diffusion d'hier : il parle de maintenant. Twitch garde
	pourtant le chat de chaque rediffusion, et chaque message y porte sa position depuis le debut.
	De quoi le derouler au rythme de la lecture -- a 12h00 d'une diffusion, les messages de 12h00.

	**On demande par position, jamais par curseur.** Chaque message porte un curseur, et la requete
	accepte un « after » -- mais cette forme-la est refusee sans jeton d'integrite, quand la position
	ne l'est pas. Redemander une position donne le meme resultat sans cette dette. Le module tient
	donc un seul nombre : jusqu'ou il a demande. Quand la lecture s'en approche, il demande la suite.

	**Une tranche vide ne veut pas dire la fin.** Elle veut dire qu'il n'y a rien ici : un quart
	d'heure sans un message arrive, et redemander la meme position en boucle ne le remplirait pas.
	On avance alors de trente secondes et on regarde plus loin.

	**Un saut n'est pas le fil de la lecture.** Au-dela de cinq secondes d'ecart entre deux mesures,
	le spectateur s'est deplace : ce qui est affiche ne raconte plus ce qu'il voit, et tout est
	repris a la nouvelle position. La meme chose vaut quand il change de video.

	**Le texte des autres n'entre jamais dans du HTML.** Chaque morceau devient un noeud de texte ou
	une image d'emote dont l'identifiant est verifie. Un pseudonyme est un texte, une couleur doit
	ressembler a une couleur.
*/
const m_VodChat = (() => {
  // Au-dela, entre deux mesures, ce n'est plus la lecture qui avance : c'est un deplacement.
  const SEEK_JUMP = 5;
  // Il reste moins que ca de demande devant la lecture : on va chercher la suite.
  const FETCH_AHEAD = 20;
  // Rien a cette position : de combien avancer avant de regarder a nouveau.
  const EMPTY_STRETCH = 30;
  // Ce que le panneau garde a l'ecran, et le nombre d'identifiants retenus contre les doublons.
  const MAX_LINES = 200;
  const MAX_REMEMBERED = 1000;
  // Colle au bas tant que le spectateur n'a pas remonte de plus que ca.
  const NEAR_BOTTOM = 40;

  const COLOUR = /^#[0-9a-f]{6}$/i;
  const EMOTE_ID = /^[\w-]{1,64}$/;
  const EMOTE_ADDRESS = "https://static-cdn.jtvnw.net/emoticons/v2";

  let _elPanel = null;
  let _elLines = null;
  let _elVideo = null;

  let _sVideoId = "";
  // Monte a chaque video et a chaque saut : une reponse d'avant ne s'affiche pas.
  let _nGeneration = 0;
  // Recus, pas encore affiches : ils attendent que la lecture les rattrape.
  let _aoPending = [];
  let _msSeen = new Set();
  let _nFetchedUpTo = -1;
  let _bFetching = false;
  let _nLastPosition = -1;
  let _bPinned = true;

  // ------------------------------------------------------------------------------------------
  // Le panneau

  function ApplySize() {
    // La meme taille que le panneau du chat, dont il prend la place. Par proprietes, pour que la
    // feuille de style garde le dernier mot sur le cote qui touche le bord.
    _elPanel.style.setProperty("--chatreplay-width", `${m_Settings.Get("nChatPanelWidth")}px`);
    _elPanel.style.setProperty("--chatreplay-height", `${m_Settings.Get("nChatPanelHeight")}px`);
  }

  function Forget() {
    _nGeneration++;
    _aoPending = [];
    _msSeen.clear();
    _nFetchedUpTo = -1;
    _nLastPosition = -1;
    _bFetching = false;
    _bPinned = true;
    _elLines.textContent = "";
  }

  function IsShown() {
    return _sVideoId !== "";
  }

  /*
    S'ouvre sur une rediffusion, et seulement si le spectateur veut un chat : celui qui regarde sans
    panneau ne demande pas qu'on lui en pose un. Les clips n'ont pas de chat a rejouer.
  */
  function Open(sVideoId) {
    Close();
    if (!IsNonEmptyString(sVideoId) || !m_Chat.PanelWanted()) {
      return;
    }
    m_Log.Wow(`[VodChat] Replaying the chat of ${sVideoId}`);
    _sVideoId = sVideoId;
    ApplySize();
    ShowElement(_elPanel, true);
    document.body.classList.add("chatreplaying");
    Fetch(Math.max(0, _elVideo.currentTime || 0));
  }

  function Close() {
    if (_elPanel === null) {
      return;
    }
    _sVideoId = "";
    Forget();
    ShowElement(_elPanel, false);
    document.body.classList.remove("chatreplaying");
  }

  // ------------------------------------------------------------------------------------------
  // Les messages

  function BuildLine(oMessage) {
    const elLine = document.createElement("div");
    elLine.className = "chatreplay-line";

    const elTime = elLine.appendChild(document.createElement("span"));
    elTime.className = "chatreplay-time";
    elTime.textContent = formatTimecode(oMessage.nOffset);

    const elAuthor = elLine.appendChild(document.createElement("span"));
    elAuthor.className = "chatreplay-author";
    elAuthor.textContent = oMessage.sAuthor;
    if (COLOUR.test(oMessage.sColour)) {
      elAuthor.style.color = oMessage.sColour;
    }
    elLine.appendChild(document.createTextNode(": "));

    for (const oPart of oMessage.aoParts) {
      if (oPart.sEmoteId !== "" && EMOTE_ID.test(oPart.sEmoteId)) {
        const elEmote = elLine.appendChild(document.createElement("img"));
        elEmote.className = "chatreplay-emote";
        elEmote.src = `${EMOTE_ADDRESS}/${oPart.sEmoteId}/default/dark/1.0`;
        elEmote.alt = oPart.sText;
        elEmote.title = oPart.sText;
        elEmote.loading = "lazy";
      } else if (oPart.sText !== "") {
        elLine.appendChild(document.createTextNode(oPart.sText));
      }
    }
    return elLine;
  }

  // Ce que la lecture a rattrape s'affiche ; le reste attend.
  function Show(nPosition) {
    let kAdded = 0;
    while (_aoPending.length !== 0 && _aoPending[0].nOffset <= nPosition) {
      _elLines.appendChild(BuildLine(_aoPending.shift()));
      kAdded++;
    }
    if (kAdded === 0) {
      return;
    }
    while (_elLines.childElementCount > MAX_LINES) {
      _elLines.removeChild(_elLines.firstElementChild);
    }
    if (_bPinned) {
      _elLines.scrollTop = _elLines.scrollHeight;
    }
  }

  function Fetch(nOffset) {
    if (_bFetching || !IsShown()) {
      return;
    }
    _bFetching = true;
    const nGeneration = _nGeneration;
    m_Twitch.GetVideoComments(_sVideoId, nOffset).then(
      AddExceptionHandler((oPage) => {
        _bFetching = false;
        if (nGeneration !== _nGeneration) {
          return;
        }
        let nLast = nOffset;
        for (const oMessage of oPage.aoMessages) {
          nLast = Math.max(nLast, oMessage.nOffset);
          if (!_msSeen.has(oMessage.sId)) {
            _msSeen.add(oMessage.sId);
            _aoPending.push(oMessage);
          }
        }
        _aoPending.sort((oLeft, oRight) => oLeft.nOffset - oRight.nOffset);
        /*
          Les identifiants ne servent qu'a ne pas afficher deux fois un message pris dans deux
          tranches qui se recouvrent. Passe un millier, ceux du debut ne recouvrent plus rien : on
          repart de ceux qui attendent encore.
        */
        if (_msSeen.size > MAX_REMEMBERED) {
          _msSeen = new Set(_aoPending.map((oMessage) => oMessage.sId));
        }
        _nFetchedUpTo = oPage.aoMessages.length === 0 ? nOffset + EMPTY_STRETCH : nLast;
        Show(_elVideo.currentTime);
      }),
      AddExceptionHandler((pReason) => {
        _bFetching = false;
        if (nGeneration !== _nGeneration) {
          return;
        }
        m_Log.Oops(`[VodChat] Comments not loaded. ${pReason}`);
        // Ne pas repartir aussitot sur la meme position : ce serait boucler sur la meme erreur.
        _nFetchedUpTo = Math.max(_nFetchedUpTo, nOffset + EMPTY_STRETCH);
      })
    );
  }

  // ------------------------------------------------------------------------------------------
  // Le fil de la lecture

  const HandleTimeUpdate = AddExceptionHandler(() => {
    if (!IsShown()) {
      return;
    }
    const nPosition = _elVideo.currentTime;
    if (_nLastPosition >= 0 && Math.abs(nPosition - _nLastPosition) > SEEK_JUMP) {
      m_Log.Wow(`[VodChat] Following a jump to ${nPosition.toFixed(0)}s`);
      Forget();
      _nLastPosition = nPosition;
      Fetch(nPosition);
      return;
    }
    _nLastPosition = nPosition;
    Show(nPosition);
    if (_nFetchedUpTo - nPosition < FETCH_AHEAD) {
      Fetch(Math.max(nPosition, _nFetchedUpTo));
    }
  });

  // Colle au bas, sauf quand le spectateur est remonte lire quelque chose.
  const HandleScroll = AddExceptionHandler(() => {
    _bPinned =
      _elLines.scrollHeight - _elLines.scrollTop - _elLines.clientHeight < NEAR_BOTTOM;
  });

  function Start() {
    _elPanel = GetNode("chatreplay");
    _elLines = GetNode("chatreplay-lines");
    _elVideo = GetNode("videos-video");
    _elLines.addEventListener("scroll", HandleScroll);
    _elVideo.addEventListener("timeupdate", HandleTimeUpdate);
    GetNode("chatreplay-close").addEventListener("click", AddExceptionHandler(Close));
  }

  return {
    Start,
    Open,
    Close,
    IsShown,
  };
})();
