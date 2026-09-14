"use strict";
/*
	Les listes HLS, et le contournement de publicite.

	Trois fonctions publiques -- Start, Stop, ChangeBroadcastVariant -- et tout le reste du module
	sert une seule idee : lire en boucle la liste des segments disponibles, et n'en mettre en file
	que ce qui est du direct.

	**Le contournement en une phrase.** Twitch coud les publicites dans le flux lui-meme : ce ne
	sont pas des annonces a cote de la video, ce sont des segments video comme les autres, au milieu
	de la meme liste. Mais Twitch sert aussi la meme chaine sous un autre pretexte -- une requete
	qui se presente comme un apercu -- et cette liste-la n'a pas les coutures. Des qu'une liste se
	termine par un segment de publicite, on ouvre la seconde boucle et on ne met plus en file que ce
	qu'elle rapporte. D'ou deux `ListUpdates` vivant en parallele, et un `+this._bNoAds` dans chaque
	ligne de journal pour savoir laquelle parle.

	**La file n'est pas remplie depuis le debut de la liste.** Une liste porte une vingtaine de
	segments, soit une demi-minute de direct deja passee. On remonte depuis la fin jusqu'a avoir de
	quoi tenir le tampon reglé, et on part de la : commencer au debut ferait demarrer la lecture
	loin derriere, et le spectateur ne rattraperait jamais.

	**Ce qui force une discontinuite.** Le decodeur doit etre reinitialise chaque fois que les
	images cessent d'etre la suite des precedentes : changement de transmission, de session, de
	variante, saut de numero de sequence -- et changement de segment d'initialisation, qui est le
	cas le moins evident et le plus couteux quand on l'oublie. Les deux flux du contournement ont
	chacun le leur, et la bascule de l'un a l'autre ne change pas toujours autre chose : les deux
	listes peuvent nommer leurs variantes pareil. Empiler les images d'un encodage contre l'en-tete
	de l'autre laisse une image noire que rien ne signale.

	**Un Check qui echoue ici n'arrete rien.** Chaque ligne est analysee sous un try, et seul un
	rejet explicite -- `reject()`, qui leve un REJECT reconnaissable -- rend la liste inutilisable.
	Tout le reste est avale : une balise inconnue ou mal formee est ignoree et la lecture continue,
	ce qui est le bon arbitrage face a un serveur qui change son format sans prevenir. Le revers
	est que les `Check(false)` poses pour remarquer une balise non geree ne remarquent rien.
*/
const m_Playlist = (() => {
  // Pendant une coupure, on redemande la liste moins souvent : elle ne bougera pas d'ici la.
  const AD_LIST_UPDATE_INTERVAL = 2e3;
  const MIN_LIST_UPDATE_INTERVAL = 500;
  const MAX_SUPPORTED_HLS_VERSION = 7;
  const MAX_VARIANT_LIST_UPDATE_INTERVAL = 3e4;

  // Un ecart de numero de sequence plus grand que ca n'est pas un retard : c'est une autre session.
  const SESSION_CHANGE_THRESHOLD = 5;

  // Une publicite finie depuis plus d'une seconde est finie ; une qui commence dans plus d'une
  // minute ne nous concerne pas encore.
  const AD_EXPIRY_JITTER = 1e3;
  const AD_FUTURE_HORIZON = 6e4;

  // Bornes de vraisemblance de l'heure annoncee par le serveur : 2018 et 2028.
  const MIN_SERVER_TIME = 1531267200;
  const MAX_SERVER_TIME = 1846886400;

  let _nState = STATE_STOP;
  let _bAdInProgress = false;
  let _nVariantListUpdateInterval = -1;
  // Numerote les sessions : deux listes de la meme transmission mais de sessions differentes ne se
  // recouvrent pas, et c'est ce numero qui le dit a la mise en file.
  let _nSessionId = 1;

  // ------------------------------------------------------------------------------------------
  // La boucle de mise a jour

  /*
    Une boucle par flux. Elle se rappelle elle-meme : chaque tour programme le suivant a partir de
    la duree moyenne d'un segment, pour redemander la liste juste apres qu'elle ait change.
  */
  class ListUpdates {
    constructor(bWithoutAds) {
      this._bNoAds = bWithoutAds;
      this._oPromiseCancel = null;
      this.clear();
    }

    clear() {
      this.oVariantList = null;
      this.oSegmentList = null;
      this.oSelectedVariant = null;
    }

    start() {
      Check(!this._oPromiseCancel);
      this._oPromiseCancel = new PromiseCancellation();
      // -Infinity : tout de suite, sans passer par un minuteur.
      this._update(this._oPromiseCancel, -Infinity);
    }

    stop() {
      if (this._oPromiseCancel) {
        m_Log.Here(`[Playlist] Stopping list updates ${+this._bNoAds}`);
        this._oPromiseCancel.Cancel();
        this._oPromiseCancel = null;
      }
    }

    saveBroadcastVariant(oVariant) {
      m_Settings.Change("sVariantLabel", oVariant.sIdentifier);
      m_Settings.Change("nVariantBitrate", oVariant.nBitrate);
    }

    /*
      La qualite gardee d'une fois sur l'autre, ou la plus proche. Le nom de variante ne survit pas
      toujours d'une transmission a l'autre -- un streameur qui change d'encodeur change ses
      libelles --, alors on retombe sur le debit : la meilleure qualite qui ne depasse pas celle
      qu'on regardait. En dernier recours, la moins bonne qui ne soit pas le son seul, parce que
      choisir le son seul par defaut donnerait un ecran noir sans que personne comprenne pourquoi.
    */
    selectBroadcastVariant(moVariants) {
      const sSavedId = m_Settings.Get("sVariantLabel");
      const nSavedBitrate = m_Settings.Get("nVariantBitrate");
      let oSelectedVariant = moVariants.find(
        ({ sIdentifier }) => sIdentifier === sSavedId
      );
      if (!oSelectedVariant) {
        if (sSavedId === "chunked" || sSavedId === "audio_only") {
          // Deux noms que Twitch garde stables : la source, et le son seul. Le premier de la
          // liste est la meilleure qualite -- parce que m_Twitch.sortVariantList l'a triee par
          // debit decroissant, pas parce que le serveur l'envoie ainsi : il ne le fait plus.
          oSelectedVariant = moVariants[0];
        } else {
          oSelectedVariant = moVariants.find(
            ({ sIdentifier, nBitrate }) =>
              sIdentifier !== "audio_only" && nBitrate <= nSavedBitrate
          );
          if (!oSelectedVariant) {
            oSelectedVariant = moVariants.reduceRight((oResult, oVariant) =>
              oResult.sIdentifier === "audio_only" ? oVariant : oResult
            );
          }
        }
      }
      m_Log.Here(
        `[Playlist] For list ${+this._bNoAds} broadcast variant selected` +
          ` ${oSelectedVariant.sIdentifier}/${oSelectedVariant.nBitrate}.` +
          ` Saved ${sSavedId}/${nSavedBitrate}`
      );
      return oSelectedVariant;
    }

    _update(oPromiseCancellation, nAfter) {
      Check(IsNumber(nAfter));
      if (nAfter >= MIN_LIST_UPDATE_INTERVAL || nAfter === -Infinity) {
        m_Log.Here(
          `[Playlist] List update ${+this._bNoAds} will start in ${m_Log.F0(
            nAfter
          )}ms`
        );
      } else {
        /*
          Un intervalle trop court veut dire qu'on court derriere : le tour precedent a mis plus
          longtemps que la duree d'un segment. On plafonne quand meme, sinon la boucle se mettrait
          a marteler le serveur sans jamais rattraper.
        */
        m_Log.Oops(
          `[Playlist] List update ${+this._bNoAds} will start in` +
            ` ${MIN_LIST_UPDATE_INTERVAL}ms instead of ${m_Log.F0(nAfter)}ms`
        );
        nAfter = MIN_LIST_UPDATE_INTERVAL;
      }

      let oPromise = Wait(oPromiseCancellation, nAfter);
      // Copies locales : un autre tour peut remplacer celles de l'objet pendant l'attente.
      let { oVariantList, oSelectedVariant } = this;

      if (oVariantList === null) {
        let sAbsoluteVariantListUrl;
        oPromise = oPromise
          .then(() =>
            m_Twitch.GetAbsoluteVariantListUrl(
              oPromiseCancellation,
              false,
              this._bNoAds
            )
          )
          .then((sResult) => {
            sAbsoluteVariantListUrl = sResult;
            return m_Downloader.LoadText(
              oPromiseCancellation,
              sAbsoluteVariantListUrl,
              LOAD_VARIANT_LIST_NO_LONGER_THAN,
              `variant list ${+this._bNoAds}`,
              false
            );
          })
          .then((sResult) => {
            m_Debug.SaveVariantList(sResult);
            oVariantList = ParseVariantList(sAbsoluteVariantListUrl, sResult);
            if (oVariantList.moVariants.length === 0) {
              throw `Variant list is empty`;
            }
          });
      }

      let nUpdateStart;
      oPromise
        .then(() => {
          if (oSelectedVariant === null) {
            oSelectedVariant = this.selectBroadcastVariant(
              oVariantList.moVariants
            );
          }
          // L'heure du depart, pas celle de l'arrivee : l'intervalle vise le rythme du serveur,
          // et le temps passe a telecharger ne doit pas s'y ajouter.
          nUpdateStart = performance.now();
          return m_Downloader.LoadText(
            oPromiseCancellation,
            oSelectedVariant.sAbsoluteSegmentListUrl,
            LOAD_SEGMENT_LIST_NO_LONGER_THAN,
            `segment list ${+this._bNoAds}`,
            false
          );
        })
        .then((sResult) => {
          m_Debug.SaveSegmentList(sResult);
          const oSegmentList = ParseSegmentList(
            oSelectedVariant.sAbsoluteSegmentListUrl,
            sResult
          );
          let nUpdateInterval;
          if (
            this._isStaleSegmentList(oVariantList, oSegmentList, oSelectedVariant)
          ) {
            // Rien de neuf : on le dit quand meme aux statistiques, sinon l'intervalle de mise a
            // jour qu'elles affichent aurait l'air regulier alors qu'il ne l'est pas.
            m_Statistics.SegmentsQueued(0, 0);
            if (oSegmentList.bEndOfList) {
              throw "END_OF_LIST";
            }
            nUpdateInterval = AD_LIST_UPDATE_INTERVAL;
          } else {
            // Au tout premier tour, et chaque fois qu'on vient de decouvrir la liste des
            // variantes, on redemande deux fois plus vite : on ne sait pas encore ou en est le
            // serveur dans son cycle.
            const bShortenedInterval =
              nAfter === -Infinity || this.oVariantList === null;
            this.oVariantList = oVariantList;
            this.oSegmentList = oSegmentList;
            this.oSelectedVariant = oSelectedVariant;
            nUpdateInterval = this._segmentListUpdated(bShortenedInterval);
          }
          this._update(
            oPromiseCancellation,
            nUpdateStart + nUpdateInterval - performance.now()
          );
          m_Downloader.LoadNextSegment();
        })
        .catch(
          AddExceptionHandler((pReason) => {
            if (typeof pReason == "string") {
              // Une chaine est un motif d'arret prevu -- END_OF_LIST, ACCESS_DENIED, un code
              // HTTP. Tout le reste est un vrai defaut et remonte.
              this._listNotUpdated(oPromiseCancellation, pReason);
              m_Downloader.LoadNextSegment();
            } else if (pReason === PromiseCancellation.REASON) {
              m_Log.Here(`[Playlist] List update cancelled ${+this._bNoAds}`);
            } else {
              throw pReason;
            }
          })
        );
    }

    /*
      La meme liste qu'avant, ou une liste en retard ? Les serveurs de Twitch ne sont pas tous au
      meme point : on tombe regulierement sur un noeud qui rend une liste plus ancienne que la
      derniere vue. La rejouer ferait reculer la lecture.

      Rend true quand il n'y a rien a en tirer.
    */
    _isStaleSegmentList(oVariantList, oSegmentList, oSelectedVariant) {
      Check((this.oVariantList === null) == (this.oSegmentList === null));

      if (oSegmentList.moSegments.length === 0) {
        m_Log.Oops(`[Playlist] Segment list ${+this._bNoAds} is empty`);
        return true;
      }
      if (this.oSegmentList === null) {
        // Rien a comparer : c'est la premiere.
        return false;
      }
      Check(
        !(
          this.oVariantList.sBroadcastId !== oVariantList.sBroadcastId &&
          this.oVariantList.nSessionId === oVariantList.nSessionId
        )
      );
      if (this.oSegmentList.nTargetDuration !== oSegmentList.nTargetDuration) {
        m_Log.Oops(
          `[Playlist] In list ${+this._bNoAds} target duration changed` +
            ` ${this.oSegmentList.nTargetDuration} ==> ${oSegmentList.nTargetDuration}`
        );
      }

      if (this.oSelectedVariant !== null) {
        this._checkAddressesHaveNotMoved(oSegmentList);
      }

      /*
        Le bout de la liste, ancienne et nouvelle. S'il a recule, trois lectures sont possibles :
        une bascule de variante en cours (on l'accepte), une nouvelle session du serveur (on la
        numerote et on repart), ou un simple noeud en retard (on jette).
      */
      const nDifference =
        this.oSegmentList.nSequenceNumber +
        this.oSegmentList.moSegments.length -
        oSegmentList.nSequenceNumber -
        oSegmentList.moSegments.length;
      if (nDifference > 0) {
        const sMovement =
          `${this.oSegmentList.nSequenceNumber} + ${this.oSegmentList.moSegments.length}` +
          ` ==> ${oSegmentList.nSequenceNumber} + ${oSegmentList.moSegments.length}`;
        if (
          this.oSelectedVariant === null &&
          nDifference <= SESSION_CHANGE_THRESHOLD
        ) {
          m_Log.Oops(
            `[Playlist] While switching variant in list ${+this
              ._bNoAds} sequence number decreased ${sMovement}`
          );
          return false;
        }
        if (
          oSegmentList.nSequenceNumber === 0 ||
          nDifference > SESSION_CHANGE_THRESHOLD
        ) {
          m_Log.Oops(
            `[Playlist] Changing SessionId: in list ${+this
              ._bNoAds} sequence number decreased ${sMovement}`
          );
          oVariantList.nSessionId = _nSessionId++;
          return false;
        }
        m_Log.Oops(
          `[Playlist] Stale list received ${+this
            ._bNoAds}: sequence number ${sMovement}`
        );
        return true;
      }

      if (this.oSegmentList.nSequenceNumber > oSegmentList.nSequenceNumber) {
        m_Log.Oops(
          `[Playlist] In list ${+this._bNoAds} sequence number decreased` +
            ` ${this.oSegmentList.nSequenceNumber} ==> ${oSegmentList.nSequenceNumber}`
        );
      }
      return false;
    }

    /*
      Un meme numero de sequence doit designer le meme segment d'une liste a l'autre. Quand ce
      n'est pas le cas, on ne sait plus de quoi la liste parle : c'est marque comme chaos, et la
      mise en file n'y touchera pas.
    */
    _checkAddressesHaveNotMoved(oSegmentList) {
      const nDifference =
        oSegmentList.nSequenceNumber - this.oSegmentList.nSequenceNumber;
      const nStart = Math.max(-nDifference, 0);
      const nEnd = Math.min(
        this.oSegmentList.moSegments.length - nDifference,
        oSegmentList.moSegments.length
      );
      for (
        let nNew = nStart, nOld = nStart + nDifference;
        nNew < nEnd;
        nNew++, nOld++
      ) {
        if (
          oSegmentList.moSegments[nNew].sAddress !==
          this.oSegmentList.moSegments[nOld].sAddress
        ) {
          m_Log.Oops(
            `[Playlist] In list ${+this._bNoAds} for segment` +
              ` ${oSegmentList.nSequenceNumber + nNew} address changed` +
              ` ${LimitStringLength(
                this.oSegmentList.moSegments[nOld].sAddress,
                100
              )} ==> ${LimitStringLength(
                oSegmentList.moSegments[nNew].sAddress,
                100
              )}`
          );
          oSegmentList.bChaos = true;
          return;
        }
      }
    }
  }

  // Le flux principal : celui qui porte les publicites, et qui decide quand basculer.
  class ListUpdatesWithAds extends ListUpdates {
    constructor() {
      super(false);
    }

    _segmentListUpdated(bShortenedInterval) {
      m_Log.Here(
        `[AdBlock] Main stream updated. Segments=${this.oSegmentList.moSegments.length}` +
          ` EndOfList=${this.oSegmentList.bEndOfList}`
      );
      if (this.oSegmentList.moSegments.length === 0) {
        // Une liste de segments vide est exactement ce qui laisse l'image figee.
        m_Log.Oops("[AdBlock] Main stream is empty");
      }

      const bListEndsWithAd = thisListEndsWithAd(this.oSegmentList);
      m_Twitch.sendAdTrackingData(bListEndsWithAd ? this.oSegmentList : null);

      // Pendant une coupure, ce flux-ci ne fournit plus rien : c'est le flux de secours qui
      // alimente la file. Mais on continue a le lire, pour savoir quand la coupure finit.
      if (!_bAdInProgress || !bListEndsWithAd) {
        bShortenedInterval =
          QueueSegments(
            this.oVariantList,
            this.oSegmentList,
            this.oSelectedVariant
          ) || bShortenedInterval;
      }
      if (this.oSegmentList.bEndOfList) {
        throw "END_OF_LIST";
      }
      setAdState(bListEndsWithAd);
      return bListEndsWithAd
        ? AD_LIST_UPDATE_INTERVAL
        : getSegmentListUpdateInterval(this.oSegmentList, bShortenedInterval);
    }

    _listNotUpdated(oPromiseCancellation, sReason) {
      if (sReason === "ACCESS_DENIED") {
        // Chaine reservee aux abonnes, ou region bloquee : on arrete et on explique.
        m_Controls.StopWatchingBroadcast();
        m_Notification.ShowAss();
        return;
      }
      // Une transmission finie n'est pas un defaut ; le reste si. On continue a interroger la
      // liste des variantes, de plus en plus lentement, au cas ou elle reprendrait.
      m_Log[sReason === "END_OF_LIST" ? "Wow" : "Oops"](
        `[Playlist] Broadcast ended. ${sReason}`
      );
      EndBroadcast();
      this._update(oPromiseCancellation, getVariantListUpdateInterval());
    }
  }

  /*
    Le flux de secours : la meme chaine demandee sous un autre pretexte, sans les coutures.

    Cette sous-classe porte encore la forme d'une enquete plutot que celle d'un correctif arrete.
    Deux choses y sont a decider, pas a deduire du code :
      - elle efface `bAd` sur tous les segments recus, parce que Twitch a commence a marquer aussi
        le flux de secours et que la mise en file refusait alors tout ce qui en venait. C'est un
        contournement du contournement, et il rendra la main le jour ou le marquage changera ;
      - son echec ecrit dans la console du navigateur en plus du journal, ce qui n'a sa place nulle
        part ailleurs dans le lecteur.
    Le comportement est garde tel quel ; ces deux points sont a trancher a part.
  */
  class ListUpdatesWithoutAds extends ListUpdates {
    constructor() {
      super(true);
    }

    stop() {
      super.stop();
      // Contrairement au flux principal, celui-ci repart de zero a chaque coupure : garder la
      // liste d'une coupure a l'autre ferait comparer deux sessions sans rapport.
      this.clear();
    }

    _segmentListUpdated(bShortenedInterval) {
      for (const oSegment of this.oSegmentList.moSegments) {
        oSegment.bAd = false;
      }
      bShortenedInterval =
        QueueSegments(
          this.oVariantList,
          this.oSegmentList,
          this.oSelectedVariant
        ) || bShortenedInterval;
      if (this.oSegmentList.bEndOfList) {
        throw "END_OF_LIST";
      }
      return getSegmentListUpdateInterval(this.oSegmentList, bShortenedInterval);
    }

    _listNotUpdated(oPromiseCancellation, sReason) {
      console.error(`CRITICAL FAILURE: Backup stream rejected! Reason: ${sReason}`);
      m_Log.Oops(`[Playlist] List 1 not updated. ${sReason}`);
      // Pas de reprise : le flux principal tourne toujours, et la lecture reprendra par lui des
      // que la coupure sera finie.
      this.stop();
    }
  }

  const _oListsWithAds = new ListUpdatesWithAds();
  const _oListsWithoutAds = new ListUpdatesWithoutAds();

  // ------------------------------------------------------------------------------------------
  // L'analyse des listes

  /*
    Un rejet, par opposition a un Check. Il leve une erreur reconnaissable, seule a traverser
    l'analyse ligne par ligne : elle dit « cette liste est inutilisable », pas « tiens, c'est
    inattendu ».
  */
  function reject(pCondition) {
    if (!pCondition) {
      throw new Error("REJECT");
    }
  }

  /*
    Tout ce qui echoue pendant l'analyse d'une ligne est avale, sauf un rejet. Un serveur qui
    ajoute une balise ou en change le format ne doit pas arreter la lecture.
  */
  function RethrowRejection(pException, sLine) {
    if (pException instanceof Error && pException.message === "REJECT") {
      throw `Error parsing playlist line:\n${ExceptionToString(
        pException
      )}\n${sLine}`;
    }
  }

  // Les lignes qui comptent : une balise `#EXT...`, ou une adresse. Tout le reste est saute.
  function* TagsAndUrls(sListBeingParsed) {
    const reTagOrUrl = /^#EXT([^:\r\n]+)(?::(.*))?$|^[^#\r\n].*$/gm;
    // La premiere ligne est `#EXTM3U`, deja verifiee par l'appelant.
    reTagOrUrl.lastIndex = "#EXTM3U".length;
    for (let msTagOrUrl; (msTagOrUrl = reTagOrUrl.exec(sListBeingParsed)); ) {
      const [sLine, sTagName = "", sTagValue = ""] = msTagOrUrl;
      yield { sLine, sTagName, sTagValue };
    }
  }

  function CheckListHeader(sListBeingParsed) {
    if (sListBeingParsed.includes("shelblock.proxy")) {
      // Un proxy tiers s'est interpose : ce n'est pas Twitch qui repond.
      m_Debug.FinishWorkAndShowMessage("J0220");
    }
    if (!sListBeingParsed.startsWith("#EXTM3U")) {
      throw `Instead of a playlist, invalid data of length ${sListBeingParsed.length}\n${sListBeingParsed}`;
    }
  }

  function ReadVersion(nCurrentVersion, sTagValue) {
    Check(nCurrentVersion === 1);
    const nVersion = ParsePositiveInteger(sTagValue);
    Check(nVersion >= 2 && nVersion <= MAX_SUPPORTED_HLS_VERSION);
    return nVersion;
  }

  // ------------------------------------------------------------------------------------------
  // La liste des variantes : les qualites disponibles

  function ParseVariantList(sAbsoluteListUrl, sListBeingParsed) {
    CheckListHeader(sListBeingParsed);

    const mapRenditionGroups = new Map();
    const moVariants = [];
    let oNewVariant = null;
    // Rempli au fil de la lecture de `#EXT-X-TWITCH-INFO`, pas d'un bloc : voir ReadTwitchInfo.
    const oInfo = { sBroadcastId: "", sViewTrackingUrl: "" };
    let nVersion = 1;

    for (const { sLine, sTagName, sTagValue } of TagsAndUrls(sListBeingParsed)) {
      try {
        switch (sTagName) {
        case "":
          // Une adresse clot la variante ouverte par le `#EXT-X-STREAM-INF` precedent.
          Check(oNewVariant !== null);
          oNewVariant.sAbsoluteSegmentListUrl = ResolveRelativeUrl(
            sLine,
            sAbsoluteListUrl
          );
          moVariants.push(oNewVariant);
          oNewVariant = null;
          break;

        case "-X-MEDIA": {
          const amAttributes = ParseAttributeList(sTagValue);
          const sType = amAttributes.get("TYPE");
          Check(sType);
          // Une piste servie a part demanderait un second telechargement et un second
          // demultiplexage : Twitch n'en sert pas, et on ne saurait pas quoi en faire.
          Check((sType !== "VIDEO" && sType !== "AUDIO") || !amAttributes.has("URI"));
          if (sType !== "VIDEO") {
            m_Log.Oops(`[Playlist] Found #EXT-X-MEDIA TYPE=${sType}`);
            break;
          }
          const sGroup = amAttributes.get("GROUP-ID");
          const sName = amAttributes.get("NAME");
          Check(sGroup && sName);
          Check(!mapRenditionGroups.has(sGroup));
          // Le nom lisible d'une qualite vit ici, pas sur la variante elle-meme.
          mapRenditionGroups.set(sGroup, sName);
          break;
        }

        case "-X-STREAM-INF": {
          Check(oNewVariant === null);
          oNewVariant = Object.create(null);
          const amAttributes = ParseAttributeList(sTagValue);
          oNewVariant.nBitrate = ParsePositiveInteger(
            amAttributes.get("BANDWIDTH")
          );
          Check(
            !amAttributes.has("AUDIO") &&
              !amAttributes.has("SUBTITLES") &&
              !amAttributes.has("CLOSED-CAPTIONS")
          );
          oNewVariant.sIdentifier = amAttributes.get("VIDEO") || "";
          // Nécessaires pour composer le type MIME du SourceBuffer sur une liste fMP4, ou aucun
          // demultiplexeur ne tourne pour deduire les codecs des flux elementaires.
          oNewVariant.sCodecs = amAttributes.get("CODECS") || "";
          oNewVariant.sResolution = amAttributes.get("RESOLUTION") || "";
          break;
        }

        case "-X-TWITCH-INFO":
          ReadTwitchInfo(oInfo, sTagValue);
          break;

        case "-X-VERSION":
          nVersion = ReadVersion(nVersion, sTagValue);
          break;

        case "-X-START":
          m_Log.Oops(`[Playlist] Found #EXT-X-START=${sTagValue}`);
          break;

        // Reconnues sans etre exploitees : elles decrivent des pistes d'images fixes et des
        // donnees de session dont le lecteur n'a pas l'usage.
        case "-X-I-FRAME-STREAM-INF":
        case "-X-SESSION-DATA":
        case "-X-SESSION-KEY":
          break;

        // Une liste ne peut pas contenir sa propre en-tete, ni de substitution de variables --
        // cette derniere demanderait de resoudre les adresses autrement. Le Check est ici pour
        // la trace ; il est avale, comme tous les autres.
        case "M3U":
        case "-X-DEFINE":
          Check(false);
        }
      } catch (pException) {
        RethrowRejection(pException, sLine);
      }
    }

    Check(oNewVariant === null);
    for (const oVariant of moVariants) {
      if (oVariant.sIdentifier) {
        Check(mapRenditionGroups.has(oVariant.sIdentifier));
        oVariant.sLabel = mapRenditionGroups.get(oVariant.sIdentifier);
      } else {
        // Une variante sans groupe n'a ni nom ni libelle : on lui en fabrique a partir de son
        // debit, sinon elle serait indiscernable de ses voisines dans le menu.
        oVariant.sIdentifier = `CoolCmd${oVariant.nBitrate}`;
        oVariant.sLabel = `${m_i18n.FormatNumber(
          oVariant.nBitrate / 1e6,
          1
        )} ${GetText("J0114")}`;
      }
    }
    m_Log.Here(`[Playlist] Number of variants in list: ${moVariants.length}`);
    return m_Twitch.sortVariantList({
      sBroadcastId: oInfo.sBroadcastId,
      nSessionId: _nSessionId++,
      sViewTrackingUrl: oInfo.sViewTrackingUrl,
      moVariants,
    });
  }

  /*
    L'heure du serveur, l'identifiant de transmission, et l'adresse de suivi d'audience.

    L'heure sert a dater les coupures publicitaires. Elle est prise sur le serveur et pas sur la
    machine du spectateur, parce qu'une horloge locale en avance ou en retard ferait passer une
    coupure en cours pour une coupure finie, ou l'inverse.
  */
  /*
    oInfo est rempli au fil de la lecture, et l'ordre compte : l'identifiant est ecrit avant d'etre
    verifie. S'il manque, le Check echoue apres coup et laisse `undefined` -- ce qui, a la mise en
    file, fait passer la liste pour une nouvelle transmission. Le verifier d'abord laisserait "",
    que la mise en file prendrait pour la suite de rien.
  */
  function ReadTwitchInfo(oInfo, sTagValue) {
    const amAttributes = ParseAttributeList(sTagValue);
    const nSeconds = ParsePositiveNumber(amAttributes.get("SERVER-TIME"));
    Check(nSeconds > MIN_SERVER_TIME && nSeconds < MAX_SERVER_TIME);
    // Cinquante millisecondes pour le trajet : l'heure annoncee date deja un peu.
    const nMilliseconds = nSeconds * 1e3 + 50;
    g_nExactTime = nMilliseconds - performance.now();
    const nTimeDrift = nMilliseconds - Date.now();

    oInfo.sBroadcastId = amAttributes.get("BROADCAST-ID");
    Check(oInfo.sBroadcastId);

    try {
      const sAddress = atob(amAttributes.get("C"));
      Check(sAddress.startsWith("https://"));
      oInfo.sViewTrackingUrl = sAddress;
    } catch (pException) {
      m_Log.Oops(
        `[Playlist] Could not parse the view tracking address: ${pException}`
      );
    }
    m_Log[Math.abs(nTimeDrift) > 5e3 ? "Oops" : "Wow"](
      `[Playlist] TimeDrift=${nTimeDrift}ms BroadcastId=${oInfo.sBroadcastId}`
    );
  }

  // ------------------------------------------------------------------------------------------
  // La liste des segments : ce qui est disponible maintenant

  function ParseSegmentList(sAbsoluteListUrl, sListBeingParsed) {
    CheckListHeader(sListBeingParsed);

    const oList = {
      nTargetDuration: -1,
      nSequenceNumber: 0,
      bEndOfList: false,
      bChaos: false,
      kAdSegments: 0,
      sAdType: "",
      kAdClips: undefined,
      nAdClipNumber: undefined,
      nAdClipDuration: undefined,
      sAdToken: undefined,
      sAdClipId1: undefined,
      sAdClipId2: undefined,
      sAdClipId3: undefined,
      sAdClipId4: undefined,
      sAdClipId5: undefined,
      sAdClipId6: undefined,
      moSegments: [],
      // Adresse du segment d'initialisation `#EXT-X-MAP`. Vide sur une liste MPEG-TS.
      sInitSegmentUrl: "",
    };
    let oNewSegment = null;
    let bDiscontinuity = false;
    let nTime = NaN;
    let nVersion = 1;

    for (const { sLine, sTagName, sTagValue } of TagsAndUrls(sListBeingParsed)) {
      try {
        switch (sTagName) {
        case "":
          /*
            Une adresse clot le segment ouvert par le `#EXTINF` precedent. Une adresse sans
            `#EXTINF` rend la liste inutilisable -- contrairement a une balise inconnue, on ne
            peut pas simplement continuer : on ne saurait pas combien de temps dure ce segment.
          */
          reject(oNewSegment !== null);
          oNewSegment.sAddress = ResolveRelativeUrl(sLine, sAbsoluteListUrl);
          oNewSegment.bDiscontinuity = bDiscontinuity;
          oList.moSegments.push(oNewSegment);
          bDiscontinuity = false;
          oList.kAdSegments += Boolean(oNewSegment.bAd);
          oNewSegment = null;
          break;

        case "INF":
          Check(oList.nTargetDuration !== -1);
          Check(oNewSegment === null);
          /*
            Le segment existe avant d'etre lu. Si sa duree est illisible, la lecture echoue mais
            le segment reste ouvert, et l'adresse qui suit l'ajoute quand meme -- sans duree.
            L'inverse ferait rejeter la liste entiere pour un seul `#EXTINF` mal forme.
          */
          oNewSegment = Object.create(null);
          ReadSegmentHeader(oList, oNewSegment, sTagValue, nTime);
          /*
            Une publicite fait perdre la position dans la chronologie, et pas seulement pour
            elle : NaN + 1 reste NaN, donc les segments qui la suivent n'en ont plus non plus,
            jusqu'a la prochaine balise `#EXT-X-TWITCH-LIVE-SEQUENCE`.
          */
          nTime = oNewSegment.bAd ? NaN : nTime + 1;
          break;

        case "-X-DISCONTINUITY":
          Check(!sTagValue);
          // Elle appartient au segment qui suit, pas a celui qui precede.
          bDiscontinuity = true;
          break;

        case "-X-MAP": {
          const amMapAttributes = ParseAttributeList(sTagValue);
          const sMapUri = amMapAttributes.get("URI");
          Check(IsNonEmptyString(sMapUri));
          // Une plage d'octets voudrait dire que l'en-tete partage un fichier avec les segments
          // media. Twitch ne le fait pas, et l'honorer demanderait des requetes par plage.
          Check(!amMapAttributes.has("BYTERANGE"));
          oList.sInitSegmentUrl = ResolveRelativeUrl(sMapUri, sAbsoluteListUrl);
          break;
        }

        case "-X-KEY": {
          /*
            `#EXT-X-MAP` n'est pas du chiffrement : il nomme le segment d'initialisation d'une
            liste fMP4. Seul `#EXT-X-KEY` avec une methode autre que NONE dit que les images
            elles-memes sont chiffrees -- et la, il n'y a rien a faire, on s'arrete en le disant.
          */
          const amKeyAttributes = ParseAttributeList(sTagValue);
          if (amKeyAttributes.get("METHOD") !== "NONE") {
            m_Debug.FinishWorkAndShowMessage(
              "J0219",
              "J0731",
              m_Twitch.GetChannelUrl(true)
            );
          }
          break;
        }

        case "-X-TARGETDURATION":
          Check(oList.nTargetDuration === -1);
          oList.nTargetDuration = ParsePositiveInteger(sTagValue);
          // Au-dela d'une minute ce n'est plus du direct, et zero ne veut rien dire.
          Check(oList.nTargetDuration > 0 && oList.nTargetDuration < 60);
          break;

        case "-X-MEDIA-SEQUENCE":
          Check(oList.nSequenceNumber === 0);
          oList.nSequenceNumber = ParsePositiveInteger(sTagValue);
          break;

        case "-X-ENDLIST":
          Check(!sTagValue);
          oList.bEndOfList = true;
          break;

        case "-X-TWITCH-LIVE-SEQUENCE":
          // La position dans la chronologie de la transmission, publicites exclues. C'est elle
          // qui permet de recoller les deux flux du contournement.
          nTime = ParsePositiveInteger(sTagValue);
          break;

        case "-X-DATERANGE":
          ReadDateRange(oList, sTagValue);
          break;

        case "-X-VERSION":
          nVersion = ReadVersion(nVersion, sTagValue);
          break;

        case "-X-START":
          m_Log.Oops(`[Playlist] Found #EXT-X-START=${sTagValue}`);
          break;

        // Reconnue sans etre exploitee. La branche doit exister pour la trace ; sans elle la
        // balise serait simplement ignoree, ce qui est deja ce qui se passe.
        case "-X-PROGRAM-DATE-TIME":
        case "-X-DISCONTINUITY-SEQUENCE":
          break;

        // Des segments qui partagent un fichier, des trous annonces, une liste a la demande,
        // une piste d'images fixes : rien de tout ca n'existe dans un direct Twitch, et chacun
        // demanderait un chemin de telechargement different.
        case "-X-BYTERANGE":
        case "-X-GAP":
        case "-X-PLAYLIST-TYPE":
        case "-X-I-FRAMES-ONLY":
        case "M3U":
        case "-X-DEFINE":
          Check(false);
        }
      } catch (pException) {
        RethrowRejection(pException, sLine);
      }
    }

    Check(oNewSegment === null);
    Check(oList.nTargetDuration !== -1);
    m_Log.Here(
      `[Playlist] Segment list parsed TargetDuration=${oList.nTargetDuration}` +
        ` SequenceNumber=${oList.nSequenceNumber} EndOfList=${oList.bEndOfList}` +
        ` SegmentCount=${oList.moSegments.length} AdSegments=${oList.kAdSegments}`
    );
    if (oList.sAdType) {
      // QuartileNumber n'a jamais ete renseigne nulle part : la ligne l'ecrit « undefined »
      // depuis toujours, et les rapports existants ont cette forme.
      m_Log.Wow(
        `[Playlist] Advert found AdType=${oList.sAdType}` +
          ` AdToken=${oList.sAdToken.slice(-10)} Clips=${oList.kAdClips}` +
          ` ClipNumber=${oList.nAdClipNumber} ClipDuration=${oList.nAdClipDuration}` +
          ` QuartileNumber=${undefined} EndsWithAd=${thisListEndsWithAd(oList)}`
      );
    }
    m_Statistics.SegmentListParsed(oList);
    return oList;
  }

  /*
    Un `#EXTINF` : la duree du segment, et son nom -- d'ou l'on deduit s'il s'agit d'une publicite.

    Une duree aberrante est ramenee a zero plutot que rejetee, et zero veut dire « ne pas
    telecharger » : un segment qu'on saute vaut mieux qu'une liste entiere perdue.
  */
  function ReadSegmentHeader(oList, oSegment, sTagValue, nTime) {
    const { nDuration, sSegmentName } = parseEXTINF(sTagValue);
    oSegment.nDuration = nDuration;
    oSegment.bAd = m_Twitch.isAdSegment(sSegmentName);
    oSegment.nTime = oSegment.bAd ? NaN : nTime;

    const nNumber = oList.nSequenceNumber + oList.moSegments.length;
    if (oSegment.nDuration < 0) {
      m_Log.Oops(
        `[Playlist] Segment ${nNumber} has a negative duration ${sTagValue}`
      );
      oSegment.nDuration = 0;
    }
    if (Math.round(oSegment.nDuration) > oList.nTargetDuration) {
      m_Log.Oops(
        `[Playlist] Duration of segment ${nNumber} exceeds target duration by` +
          ` ${oSegment.nDuration - oList.nTargetDuration}s`
      );
      // Un depassement modere arrive ; le triple de la duree cible n'est plus un segment.
      if (oSegment.nDuration > oList.nTargetDuration * 3) {
        oSegment.nDuration = 0;
      }
    }
  }

  /*
    La balise qui annonce une coupure publicitaire cousue dans le flux.

    Deux coupures ne nous concernent pas : celle qui est deja finie et celle qui n'a pas commence.
    Les retenir gele l'image pour une publicite qui ne passera pas -- c'est le defaut que la regle
    d'expiration corrige, et il faut la garder stricte : une marge genereuse laissait des coupures
    terminees bloquer la lecture.
  */
  function ReadDateRange(oList, sTagValue) {
    const amAttributes = ParseAttributeList(sTagValue);

    try {
      if (AdBreakIsOutOfScope(amAttributes)) {
        return;
      }
    } catch (pException) {
      m_Log.Oops(`[AdBlock] Filter error: ${ExceptionToString(pException)}`);
    }

    if (amAttributes.get("CLASS") !== "twitch-stitched-ad") {
      return;
    }
    try {
      // La chaine brute de la balise, gardee entiere : c'est sa forme qui compte quand on
      // enquete sur une image figee.
      m_Log.Here(`[AdBlock] Ad tag detected: ${sTagValue}`);
      ReadAdAttributes(oList, amAttributes);
      Check(oList.sAdType);
    } catch (pException) {
      oList.sAdType = "";
      m_Log.Oops(`[Playlist] Ad parse error: ${sTagValue}`);
    }
  }

  function AdBreakIsOutOfScope(amAttributes) {
    if (amAttributes.get("CLASS") !== "twitch-stitched-ad") {
      return false;
    }
    const sStartDate = amAttributes.get("START-DATE");
    const sDuration = amAttributes.get("DURATION");
    if (!sStartDate || !sDuration) {
      return false;
    }
    const nAdStartTime = Date.parse(sStartDate);
    const nAdEndTime = nAdStartTime + parseFloat(sDuration) * 1e3;
    // L'heure du serveur quand on l'a ; celle de la machine sinon, faute de mieux.
    const nCurrentTime = !Number.isNaN(g_nExactTime)
      ? performance.now() + g_nExactTime
      : Date.now();

    if (nAdEndTime < nCurrentTime + AD_EXPIRY_JITTER) {
      m_Log.Wow(
        `[AdBlock] Skipping expired ad. Ends=${new Date(
          nAdEndTime
        ).toISOString()} Now=${new Date(nCurrentTime).toISOString()}`
      );
      return true;
    }
    if (nAdStartTime > nCurrentTime + AD_FUTURE_HORIZON) {
      m_Log.Wow(
        `[AdBlock] Skipping future ad. Starts=${new Date(
          nAdStartTime
        ).toISOString()}`
      );
      return true;
    }
    return false;
  }

  /*
    Les identifiants de la coupure. Aucun ne sert a la lecture : ils composent le paquet de
    telemetrie « preuve de visionnage » renvoye a Twitch, qui est ce qui fait que la coupure est
    comptee comme vue et ne se represente pas en boucle.
  */
  function ReadAdAttributes(oList, amAttributes) {
    oList.sAdType = amAttributes.get("X-TV-TWITCH-AD-ROLL-TYPE");
    // Combien de publicites dans cette coupure, et la place de celle-ci.
    oList.kAdClips = ParsePositiveInteger(
      amAttributes.get("X-TV-TWITCH-AD-POD-LENGTH")
    );
    oList.nAdClipNumber = ParsePositiveInteger(
      amAttributes.get("X-TV-TWITCH-AD-POD-POSITION")
    );
    oList.nAdClipDuration = ParsePositiveNumber(
      amAttributes.get("DURATION") || "0"
    );
    // Le jeton qui valide cette impression precise.
    oList.sAdToken = amAttributes.get("X-TV-TWITCH-AD-RADS-TOKEN") || "";
    // L'annonceur, la video, la campagne, la commande, la session, le format.
    oList.sAdClipId1 = amAttributes.get("X-TV-TWITCH-AD-ADVERTISER-ID") || "";
    oList.sAdClipId2 = amAttributes.get("X-TV-TWITCH-AD-CREATIVE-ID") || "";
    oList.sAdClipId3 = amAttributes.get("X-TV-TWITCH-AD-LINE-ITEM-ID") || "";
    oList.sAdClipId4 = amAttributes.get("X-TV-TWITCH-AD-ORDER-ID") || "";
    oList.sAdClipId5 = amAttributes.get("X-TV-TWITCH-AD-AD-SESSION-ID") || "";
    oList.sAdClipId6 = amAttributes.get("X-TV-TWITCH-AD-AD-FORMAT") || "";
  }

  // ------------------------------------------------------------------------------------------
  // Les analyseurs elementaires

  /*
    `CLE=valeur` ou `CLE="valeur"`, separes par des virgules. La boucle exige que chaque couple
    commence exactement ou le precedent finit : une liste d'attributs a moitie comprise vaut
    mieux rejetee, parce qu'un attribut saute passe autrement inapercu.
  */
  function ParseAttributeList(sSourceText) {
    const amAttributes = new Map();
    const reAttribute = /([A-Z0-9-]+)=(?:"([^"]*)"|([^",]+))(?:,|$)/g;
    while (reAttribute.lastIndex !== sSourceText.length) {
      const { lastIndex } = reAttribute;
      const msAttribute = reAttribute.exec(sSourceText);
      Check(msAttribute.index === lastIndex);
      Check(!amAttributes.has(msAttribute[1]));
      amAttributes.set(msAttribute[1], msAttribute[3] || msAttribute[2]);
    }
    return amAttributes;
  }

  function ParsePositiveInteger(sSourceText) {
    const nResult = parseFloat(sSourceText);
    Check(Number.isSafeInteger(nResult) && nResult >= 0);
    return nResult;
  }

  function ParsePositiveNumber(sSourceText) {
    const nResult = parseFloat(sSourceText);
    Check(Number.isFinite(nResult) && nResult >= 0);
    return nResult;
  }

  function ParseAnyNumber(sSourceText) {
    const nResult = parseFloat(sSourceText);
    Check(Number.isFinite(nResult));
    return nResult;
  }

  // `#EXTINF:<duree>,<nom>`. Le nom est ce qui trahit une publicite.
  function parseEXTINF(sSourceText) {
    let nComma = sSourceText.indexOf(",");
    if (nComma === -1) {
      nComma = sSourceText.length;
    }
    return {
      nDuration: ParseAnyNumber(sSourceText.slice(0, nComma)),
      sSegmentName: sSourceText.slice(nComma + 1),
    };
  }

  // ------------------------------------------------------------------------------------------
  // L'etat de la coupure publicitaire

  /*
    C'est le dernier segment qui decide, pas le premier ni le nombre. Une liste dont la publicite
    est au milieu a deja repris le direct ; une liste qui se termine par de la publicite est une
    liste dont la suite sera encore de la publicite.
  */
  function thisListEndsWithAd(oList) {
    return (
      oList !== null &&
      oList.moSegments.length !== 0 &&
      oList.moSegments[oList.moSegments.length - 1].bAd
    );
  }

  function setAdState(bAdInProgress) {
    if (_bAdInProgress !== bAdInProgress) {
      m_Log.Wow(`[AdBlock] Ad in progress: ${bAdInProgress}`);
      _bAdInProgress = bAdInProgress;
      if (bAdInProgress) {
        _oListsWithoutAds.start();
        m_Events.SendEvent("playlist-adstart");
      } else {
        _oListsWithoutAds.stop();
        m_Events.SendEvent("playlist-adend");
      }
    }
    if (!bAdInProgress) {
      // Hors coupure, il n'y a rien a declarer vu : le dire explicitement evite qu'un ancien
      // paquet de suivi reparte au tour suivant.
      m_Twitch.sendAdTrackingData(null);
    }
  }

  // ------------------------------------------------------------------------------------------
  // La mise en file

  /*
    Ou en est la file. Ces sept valeurs sont la memoire de ce qui a deja ete ajoute : elles disent
    si le segment suivant est la suite de ce qu'on joue, ou le debut d'autre chose.
  */
  let _sAppendedBroadcastId;
  let _nAppendedSessionId;
  let _sAppendedVariantId;
  let _nAppendedSequenceNumber;
  let _nAppendedTime;
  let _bAppendDiscontinuity;
  // Adresse du `#EXT-X-MAP` dont la file porte actuellement le segment d'initialisation.
  let _sAddedInitSegmentUrl;

  function clearAppendStatistics() {
    _sAppendedBroadcastId = "";
    _nAppendedSessionId = NaN;
    _sAppendedVariantId = "";
    _nAppendedSequenceNumber = -1;
    _nAppendedTime = -1;
    _bAppendDiscontinuity = false;
    _sAddedInitSegmentUrl = "";
  }
  clearAppendStatistics();

  /*
    Ajoute a la file ce que cette liste apporte de nouveau. Rend true quand elle n'a rien apporte,
    ce qui fait raccourcir l'intervalle du tour suivant : si le serveur n'a rien de neuf, c'est
    peut-etre qu'on l'interroge decale, et se rapprocher est le seul moyen de le savoir.
  */
  function QueueSegments(oNewVariants, oNewSegments, oSelectedVariant) {
    Check(
      !(
        _sAppendedBroadcastId !== oNewVariants.sBroadcastId &&
        _nAppendedSessionId === oNewVariants.nSessionId
      )
    );
    if (oNewSegments.bChaos) {
      // Les adresses ont bouge sous les memes numeros : on ne sait plus de quoi cette liste
      // parle. On n'y touche pas, et le prochain segment ajoute rompra la continuite.
      _bAppendDiscontinuity = true;
      m_Statistics.SegmentsQueued(0, 0);
      return false;
    }

    let kSegmentsAdded = 0;
    let kSecondsAdded = 0;
    const nFirstIndex = FindQueueStart(oNewVariants, oNewSegments);

    if (_sAppendedBroadcastId !== oNewVariants.sBroadcastId) {
      // Une autre transmission : rien de ce qui precede ne vaut plus, on prend tout depuis le
      // point de depart calcule.
      m_Log.Wow(
        `[Playlist] BroadcastId changed ${_sAppendedBroadcastId} ==> ${oNewVariants.sBroadcastId}`
      );
      _nAppendedTime = -1;
      _bAppendDiscontinuity = true;
      queueFrom(nFirstIndex, () => true);
    } else if (_nAppendedSessionId !== oNewVariants.nSessionId) {
      /*
        Meme transmission, autre session : les numeros de sequence repartent, donc ils ne
        distinguent plus rien. C'est la position dans la chronologie -- nTime -- qui dit ce qu'on
        a deja vu, et c'est pour ca qu'elle existe.
      */
      m_Log.Wow(
        `[Playlist] SessionId changed ${_nAppendedSessionId} ==> ${oNewVariants.nSessionId}`
      );
      _bAppendDiscontinuity = true;
      queueFrom(nFirstIndex, (oSegment) => oSegment.nTime > _nAppendedTime);
    } else {
      if (_sAppendedVariantId !== oSelectedVariant.sIdentifier) {
        // Une autre qualite : d'autres images, d'autres parametres d'encodage.
        m_Log.Wow(
          `[Playlist] VariantId changed ${_sAppendedVariantId} ==> ${oSelectedVariant.sIdentifier}`
        );
        _bAppendDiscontinuity = true;
      }
      queueFrom(
        nFirstIndex,
        (oSegment, nSequenceNumber) =>
          nSequenceNumber > _nAppendedSequenceNumber
      );
    }

    m_Statistics.SegmentsQueued(kSegmentsAdded, kSecondsAdded);
    return kSegmentsAdded === 0;

    function queueFrom(nIndex, fAccept) {
      for (
        let oSegmentBeingAdded;
        (oSegmentBeingAdded = oNewSegments.moSegments[nIndex]);
        nIndex++
      ) {
        const nSequenceNumber = oNewSegments.nSequenceNumber + nIndex;
        if (fAccept(oSegmentBeingAdded, nSequenceNumber)) {
          queueSegment(oSegmentBeingAdded, nSequenceNumber);
        }
      }
    }

    function queueSegment(oSegment, nSequenceNumber) {
      startBroadcast();
      if (oSegment.bAd) {
        m_Log.Here(`[Playlist] Not adding ad SequenceNumber=${nSequenceNumber}`);
        return;
      }
      if (oSegment.nDuration === 0) {
        // Duree aberrante reperee a l'analyse : le segment existe, mais on ne sait pas le placer.
        m_Log.Oops(
          `[Playlist] Not adding segment SequenceNumber=${nSequenceNumber}` +
            ` Time=${oSegment.nTime} Duration=0`
        );
        return;
      }
      if (
        _nAppendedSessionId === oNewVariants.nSessionId &&
        _nAppendedSequenceNumber + 1 < nSequenceNumber
      ) {
        // Des segments ont disparu entre le dernier ajoute et celui-ci : la liste a defile plus
        // vite qu'on ne la lisait.
        m_Log.Oops(
          `[Playlist] Segments skipped from ${_nAppendedSequenceNumber + 1} to ${
            nSequenceNumber - 1
          }`
        );
        m_Statistics.segmentsSkipped(
          nSequenceNumber - _nAppendedSequenceNumber - 1
        );
        _bAppendDiscontinuity = true;
      }
      /*
        Un autre `#EXT-X-MAP` veut dire une autre boite moov, donc un nouvel en-tete a empiler
        avant toute image qui en depend. Le contournement bascule entre deux flux fMP4 qui ont
        chacun le leur, et cette bascule ne leve pas toujours autre chose : les deux listes
        peuvent nommer leurs variantes pareil. Empiler les images d'un encodage contre la moov de
        l'autre est ce qui laisse une image noire derriere, sans que rien ne leve.
      */
      if (oNewSegments.sInitSegmentUrl !== _sAddedInitSegmentUrl) {
        if (_sAddedInitSegmentUrl !== "") {
          m_Log.Wow(
            "[AdBlock] Initialisation segment changed, forcing a discontinuity"
          );
        }
        _bAppendDiscontinuity = true;
      }

      const oQueued = g_maQueue.Add(
        new Segment(
          PROCESSING_AWAITING_DOWNLOAD,
          oSegment.sAddress,
          oSegment.nDuration,
          oSegment.bDiscontinuity || _bAppendDiscontinuity
        )
      );
      // Un segment fMP4 emporte de quoi etre joue sans passer par le demultiplexeur.
      if (oNewSegments.sInitSegmentUrl) {
        oQueued.sInitSegmentUrl = oNewSegments.sInitSegmentUrl;
        oQueued.sCodecs = oSelectedVariant.sCodecs || "";
        oQueued.sResolution = oSelectedVariant.sResolution || "";
      }
      m_Log[oQueued.bDiscontinuity ? "Wow" : "Here"](
        `[Playlist] Segment added ${oQueued.nNumber}` +
          ` SequenceNumber=${nSequenceNumber} Time=${oSegment.nTime}` +
          ` Duration=${oQueued.nDuration} Discontinuity=${oQueued.bDiscontinuity}`
      );

      kSegmentsAdded++;
      kSecondsAdded += oQueued.nDuration;
      _sAppendedBroadcastId = oNewVariants.sBroadcastId;
      _nAppendedSessionId = oNewVariants.nSessionId;
      _sAppendedVariantId = oSelectedVariant.sIdentifier;
      _nAppendedSequenceNumber = nSequenceNumber;
      _sAddedInitSegmentUrl = oNewSegments.sInitSegmentUrl || "";
      // Une publicite n'a pas de position dans la chronologie : elle ne doit pas ecraser la
      // derniere position connue du direct.
      if (!Number.isNaN(oSegment.nTime)) {
        _nAppendedTime = oSegment.nTime;
      }
      _bAppendDiscontinuity = false;
    }
  }

  /*
    Depuis ou remplir la file. On remonte depuis la fin de la liste jusqu'a avoir de quoi tenir le
    tampon reglé -- en secondes et en nombre de segments a la fois --, et on part de la.

    Au tout premier remplissage on ne prend qu'un segment : demarrer au plus pres du direct, quitte
    a se laisser rattraper ensuite. Sur une transmission deja en cours on en prend trois, pour
    absorber un telechargement lent sans bafouiller.
  */
  function FindQueueStart(oNewVariants, oNewSegments) {
    let idx = oNewSegments.moSegments.length;
    let kSegmentsToQueue =
      _sAppendedBroadcastId !== oNewVariants.sBroadcastId ? 1 : 3;
    let nSecondsToQueue = m_Settings.Get("nBufferSize");
    // On s'arrete a l'indice 1 : le premier segment de la liste est le plus ancien, et prendre
    // toute la liste ferait demarrer la lecture trop loin derriere.
    while (--idx > 0) {
      const oSegment = oNewSegments.moSegments[idx];
      // La publicite et les segments de duree nulle ne seront pas telecharges : ils ne comptent
      // pas dans ce qu'on a de quoi jouer.
      if (!oSegment.bAd && oSegment.nDuration !== 0) {
        kSegmentsToQueue--;
        nSecondsToQueue -= oSegment.nDuration;
        if (kSegmentsToQueue <= 0 && nSecondsToQueue <= 0) {
          break;
        }
      }
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------------
  // Les intervalles

  /*
    Quand redemander la liste. La bonne reponse est « juste apres que le serveur l'ait changee »,
    et le serveur la change au rythme d'un segment : on vise donc la duree moyenne d'un segment,
    seize millisecondes plus tot pour ne pas arriver systematiquement en retard d'un tour.

    La publicite et les segments de duree nulle sont exclus de la moyenne : ils ne suivent pas le
    rythme du direct et la fausseraient.
  */
  function getSegmentListUpdateInterval(oSegmentList, bShortenedInterval) {
    const RACE_MARGIN = 16;
    let kSegments = 0;
    let nListDuration = 0;
    let nMinSegmentDuration = Infinity;
    let nMaxSegmentDuration = -Infinity;
    for (const { bAd, nDuration } of oSegmentList.moSegments) {
      if (!bAd && nDuration > 0) {
        kSegments++;
        nListDuration += nDuration;
        nMinSegmentDuration = Math.min(nMinSegmentDuration, nDuration);
        nMaxSegmentDuration = Math.max(nMaxSegmentDuration, nDuration);
      }
    }

    let nAvgSegmentDuration;
    if (kSegments !== 0) {
      nAvgSegmentDuration = nListDuration / kSegments;
      m_Log.Here(
        `[Playlist] SegmentsDuration=${m_Log.F2(nMinSegmentDuration)}<${m_Log.F2(
          nAvgSegmentDuration
        )}<${m_Log.F2(nMaxSegmentDuration)} ListDuration=${m_Log.F1(
          nListDuration
        )} DoNotLoad=${oSegmentList.moSegments.length - kSegments}`
      );
    } else {
      // Que de la publicite, ou que du vide : on n'a plus de rythme mesure, alors on en devine
      // un a partir de la duree cible. Jamais moins d'une seconde.
      nAvgSegmentDuration = Math.max(oSegmentList.nTargetDuration / 3, 1);
      m_Log.Oops(
        `[Playlist] Estimated segment duration ${m_Log.F1(nAvgSegmentDuration)}`
      );
    }

    return bShortenedInterval
      ? (nAvgSegmentDuration / 2) * 1e3
      : nAvgSegmentDuration * 1e3 - RACE_MARGIN;
  }

  /*
    Une transmission finie : on continue a interroger, de plus en plus lentement. Une seconde de
    plus a chaque tour jusqu'a trente secondes -- assez reactif pour rattraper un streameur qui
    revient tout de suite, assez lent pour ne pas marteler un serveur pendant des heures.
  */
  function getVariantListUpdateInterval() {
    Check(_nState === STATE_BROADCAST_END);
    if (_nVariantListUpdateInterval === -1) {
      _nVariantListUpdateInterval = 1e3;
    } else {
      _nVariantListUpdateInterval = Math.min(
        _nVariantListUpdateInterval + 1e3,
        MAX_VARIANT_LIST_UPDATE_INTERVAL
      );
    }
    return _nVariantListUpdateInterval;
  }

  // ------------------------------------------------------------------------------------------
  // Le debut, la fin, et le changement de qualite

  /*
    Les marqueurs poses dans la file ne portent pas d'octets : ils traversent tout le chemin media
    a leur place dans l'ordre, et arrivent au lecteur au moment exact ou l'image correspondante
    aurait du etre jouee. C'est ce qui fait que « la transmission a commence » s'affiche quand
    l'image apparait, et pas dix secondes plus tot.
  */
  function startBroadcast() {
    if (_nState !== STATE_BROADCAST_START) {
      _nState = STATE_BROADCAST_START;
      g_maQueue.Add(new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_START));
      m_Events.SendEvent("playlist-broadcastvariantselected", [
        _oListsWithAds.oVariantList.moVariants,
        _oListsWithAds.oSelectedVariant,
      ]);
    }
  }

  function EndBroadcast() {
    if (_nState !== STATE_BROADCAST_END) {
      _nState = STATE_BROADCAST_END;
      _nVariantListUpdateInterval = -1;
      g_maQueue.Add(new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_END));
      // Plus de variantes a proposer : le menu de qualite se vide.
      m_Events.SendEvent("playlist-broadcastvariantselected", [null, null]);
    }
    _oListsWithAds.clear();
    setAdState(false);
  }

  function ChangeBroadcastVariant(nSelectedVariant) {
    if (_oListsWithAds.oVariantList === null) {
      return;
    }
    _oListsWithAds.saveBroadcastVariant(
      _oListsWithAds.oVariantList.moVariants[nSelectedVariant]
    );
    // null : au prochain tour, la boucle rechoisira -- et trouvera ce qu'on vient d'enregistrer.
    _oListsWithAds.oSelectedVariant = null;
    if (_nState !== STATE_BROADCAST_START) {
      return;
    }
    _oListsWithAds.stop();
    _oListsWithAds.start();
    /*
      Pendant une coupure on ne touche pas a la file : elle est alimentee par le flux de secours,
      qui n'a pas change de qualite. Le changement prendra effet a la fin de la coupure.
    */
    if (!_bAdInProgress) {
      clearAppendStatistics();
      g_maQueue.Add(new Segment(PROCESSING_DOWNLOADED, STATE_VARIANT_CHANGE));
      m_Downloader.LoadNextSegment();
    }
  }

  function Stop() {
    _nState = STATE_STOP;
    _oListsWithAds.stop();
    clearAppendStatistics();
    setAdState(false);
  }

  function Start() {
    Check(_nState === STATE_STOP);
    _oListsWithAds.start();
  }

  return {
    Start,
    Stop,
    ChangeBroadcastVariant,
  };
})();
