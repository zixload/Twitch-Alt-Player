"use strict";
/*
	Tout ce qui arrive par le reseau passe par ici : listes de segments, reponses GraphQL, et les
	segments video eux-memes.

	**Un segment n'est jamais redemande.** Une liste ou une reponse GraphQL a droit a une seconde
	tentative, parce qu'une demi-seconde de retard ne se voit pas. Un segment, si : il doit etre
	joue a une heure precise, et une seconde tentative arriverait apres cette heure. Mieux vaut
	l'abandonner tout de suite et laisser le lecteur sauter par-dessus.

	**Une reponse 4xx n'est jamais redemandee non plus**, quelle que soit la sorte de telechargement.
	Le serveur a repondu, et il repondra la meme chose. Seuls le silence, l'expiration et les erreurs
	serveur valent une seconde tentative.

	**La taille rendue aux statistiques est une estimation, pas une mesure.** Le navigateur ne dit
	pas combien d'octets sont reellement passes sur le fil : il rend un corps decompresse et des
	en-tetes reconstruits. On recompose donc au plus pres -- les en-tetes comptent, moities en HTTP/2
	ou ils voyagent comprimes, et un corps annonce compresse est ramene a 35 %. C'est faux de quelques
	pour cent, et c'est tres suffisant pour un compteur de megaoctets.

	**L'etat d'un telechargement vit dans un objet, pas sur la requete.** Chaque telechargement porte
	ses parametres, ses deux resolveurs et son compte de tentatives.

	La file de segments et l'ordre dans lequel on la descend sont ici aussi : c'est le telechargeur
	qui decide combien de segments partent a la fois, et qui elague quand la liaison ne suit plus.
*/
const m_Downloader = (() => {
  const MAX_ATTEMPTS = 2;

  /*
    La marge d'un segment. On accepte qu'il mette plus longtemps que sa propre duree -- plusieurs
    descendent en meme temps et se partagent le lien -- mais pas indefiniment : huit secondes de
    constante couvrent l'etablissement de la connexion, le reste suit la duree du segment.
  */
  const SEGMENT_TIMEOUT_SLACK = 1.15;
  const SEGMENT_TIMEOUT_CONSTANT = 8;

  // La reponse d'un serveur HTTP/2 n'a plus de phrase de statut, et ses en-tetes sont comprimes.
  const HTTP2_HEADER_RATIO = 0.5;
  // Un corps annonce compresse : le rapport habituel d'un texte HLS ou JSON gzippe.
  const COMPRESSED_BODY_RATIO = 0.35;
  // « HTTP/1.1 200 \r\n » plus la ligne de statut : ce que les en-tetes coutent avant de commencer.
  const STATUS_LINE_SIZE = 17;

  // ------------------------------------------------------------------------------------------
  // Un telechargement

  class Download {
    constructor(
      oCancellation,
      sMethod,
      sUrl,
      nNoLongerThan,
      oHeaders,
      pBody,
      sLabel,
      bLog,
      pDataType
    ) {
      this.sMethod = sMethod;
      this.sUrl = sUrl;
      this.nNoLongerThan = nNoLongerThan;
      this.oHeaders = oHeaders;
      this.pBody = pBody;
      this.sLabel = sLabel;
      this.bLog = bLog;
      this.pDataType = pDataType;
      this.oCancellation = oCancellation || null;
      this.kAttemptsLeft = this.bIsSegment ? 1 : MAX_ATTEMPTS;
      this.nRequestSentTime = performance.now();
      this.nResponseWait = NaN;
      this.fResolve = null;
      this.fReject = null;

      this.oRequest = new XMLHttpRequest();
      /*
        Les trois pannes se traitent de la meme facon, donc une seule fonction -- mais son identite
        compte : l'annulation la retire avant d'abandonner la requete, sinon l'abandon qu'elle
        provoque passerait pour une panne reseau et declencherait la tentative suivante.
      */
      this._fFailed = AddExceptionHandler((oEvent) => this._Failed(oEvent.type));
      this._fFinished = AddExceptionHandler(() => this._Finished());
      this.oRequest.addEventListener("timeout", this._fFailed);
      this.oRequest.addEventListener("error", this._fFailed);
      this.oRequest.addEventListener("abort", this._fFailed);
      this.oRequest.addEventListener("load", this._fFinished);
      // L'attente de reponse n'interesse que les segments, et seulement quand on journalise.
      if (bLog && this.bIsSegment) {
        this._fHeaders = AddExceptionHandler(() => this._HeadersReceived());
        this.oRequest.addEventListener("readystatechange", this._fHeaders);
      }
    }

    // Un segment se reconnait a son type de donnees : c'est sa duree, en secondes.
    get bIsSegment() {
      return typeof this.pDataType == "number";
    }

    Start() {
      return new Promise((fResolve, fReject) => {
        this.fResolve = fResolve;
        this.fReject = fReject;
        if (this.oCancellation) {
          this.oCancellation.ReplaceHandler(() => this._Cancelled());
        }
        this._Send(false);
      });
    }

    _Send(bRetry) {
      if (this.kAttemptsLeft === 0) {
        return false;
      }
      if (bRetry) {
        m_Log.Oops(`[Downloader] Reloading ${this.sLabel}`);
      }
      this.kAttemptsLeft--;
      this.oRequest.open(this.sMethod, this.sUrl);
      this.oRequest.responseType = this.bIsSegment ? "arraybuffer" : "text";
      this.oRequest.timeout = this.nNoLongerThan;
      if (this.oHeaders) {
        for (const sTitle of Object.keys(this.oHeaders)) {
          this.oRequest.setRequestHeader(sTitle, this.oHeaders[sTitle]);
        }
      }
      if (this.pBody instanceof URLSearchParams) {
        this.oRequest.setRequestHeader(
          "Content-Type",
          "application/x-www-form-urlencoded; charset=UTF-8"
        );
        this.oRequest.send(this.pBody.toString());
      } else {
        this.oRequest.send(this.pBody);
      }
      return true;
    }

    // Plus personne n'attend la reponse : on la coupe, et on le dit au demandeur.
    _Cancelled() {
      m_Log.Here(
        `[Downloader] Cancelling download ${this.sLabel} readyState=${this.oRequest.readyState}`
      );
      this.oRequest.removeEventListener("abort", this._fFailed);
      this.oRequest.abort();
      this.fReject(PromiseCancellation.REASON);
    }

    // Les en-tetes sont la : le temps ecoule jusqu'ici est le temps de reaction du serveur, avant
    // que le debit n'entre en jeu. C'est lui qui distingue un serveur lent d'un lien lent.
    _HeadersReceived() {
      if (this.oRequest.readyState >= XMLHttpRequest.HEADERS_RECEIVED) {
        this.oRequest.removeEventListener("readystatechange", this._fHeaders);
        Check(Number.isNaN(this.nResponseWait));
        this.nResponseWait = Math.round(
          performance.now() - this.nRequestSentTime
        );
      }
    }

    // Le suffixe de journal commun aux trois issues.
    get sResponseWaitSuffix() {
      return this.bLog && this.bIsSegment
        ? ` ResponseWait=${this.nResponseWait}ms`
        : "";
    }

    _Failed(sEventType) {
      m_Log.Oops(
        `[Downloader] Could not load ${this.sLabel}. Event occurred: ${sEventType}` +
          ` readyState=${this.oRequest.readyState}` +
          this.sResponseWaitSuffix
      );
      // Un abandon est voulu : il ne se retente pas.
      if (sEventType === "abort" || !this._Send(true)) {
        this._Give(`Event occurred: ${sEventType}`);
      }
    }

    _Finished() {
      Check(this.oRequest.readyState === XMLHttpRequest.DONE);
      const nCode = this.oRequest.status;
      const bAccepted =
        nCode >= 200 &&
        nCode <= 299 &&
        (this.pDataType === "none" || this.oRequest.response !== null);
      if (!bAccepted) {
        this._Refused(nCode);
        return;
      }

      const nDownloadDuration = Math.round(
        performance.now() - this.nRequestSentTime
      );
      this._ReleaseCancellation();
      m_Log.Here(
        `[Downloader] Loaded ${this.sLabel} in ${nDownloadDuration}ms` +
          this.sResponseWaitSuffix +
          (this.bIsSegment
            ? ` Ratio=${m_Log.F1(nDownloadDuration / this.pDataType / 1e3)}`
            : ``) +
          (nCode === 200 ? `` : ` Code=${nCode} ${this.oRequest.statusText}`) +
          this._DescribeBodyLoaded()
      );
      // Un delai nul veut dire « ceci ne compte pas » : les sondes de disponibilite n'entrent
      // pas dans le total telecharge.
      if (this.nNoLongerThan !== 0) {
        m_Statistics.SomethingDownloaded(this._EstimateSize());
      }

      switch (this.pDataType) {
      case "none":
        this.fResolve();
        return;

      case "text":
        this.fResolve(this.oRequest.response);
        return;

      case "json":
        try {
          this.fResolve(JSON.parse(this.oRequest.response));
        } catch (pException) {
          // Le serveur a repondu, et mal : redemander donnerait le meme texte.
          m_Log.Oops(
            `[Downloader] Could not parse ${this.sLabel}. ${pException}`
          );
          this.fReject("Failed to parse JSON");
        }
        return;

      default:
        m_Statistics.SegmentLoaded(
          this.oRequest.response.byteLength,
          this.pDataType,
          nDownloadDuration,
          this.nResponseWait
        );
        this.fResolve(this.oRequest.response);
      }
    }

    _Refused(nCode) {
      m_Log.Oops(
        `[Downloader] Could not load ${this.sLabel}. ${RESPONSE_CODE}${nCode}` +
          ` ${this.oRequest.statusText}` +
          this.sResponseWaitSuffix +
          this._DescribeBodyRefused()
      );
      /*
        Une reponse 4xx est definitive : le serveur nous a compris et a dit non. Une reponse vide
        l'est aussi -- il n'y a rien a relire. Le reste (5xx, passerelle en panne) vaut une seconde
        tentative, s'il en reste une.
      */
      if (
        (nCode >= 400 && nCode <= 499) ||
        this.oRequest.response === null ||
        !this._Send(true)
      ) {
        this._Give(`${RESPONSE_CODE}${nCode}`);
      }
    }

    // Abandonner pour de bon. Un segment signale quand meme son attente de reponse : c'est elle qui
    // dira, dans le rapport, si le serveur repondait encore ou s'etait tu.
    _Give(sReason) {
      if (this.bIsSegment) {
        m_Statistics.SegmentLoaded(NaN, NaN, NaN, this.nResponseWait);
      }
      this._ReleaseCancellation();
      this.fReject(sReason);
    }

    // Plus rien a annuler : on retire le gestionnaire pour ne pas retenir la requete.
    _ReleaseCancellation() {
      if (this.oCancellation) {
        this.oCancellation.ReplaceHandler(null);
      }
    }

    // Ce qui est arrive, en clair si on journalise cette requete, en taille sinon.
    _DescribeBodyLoaded() {
      if (this.pDataType === "none") {
        return "";
      }
      if (this.bLog && IsNonEmptyString(this.oRequest.response)) {
        return `\n${this.oRequest.response}`;
      }
      return this._DescribeSize();
    }

    /*
      En echec, le corps est ecrit en clair meme sans journal : c'est la que le serveur explique
      pourquoi il refuse, et un rapport de bug sans cette phrase ne sert a rien.
    */
    _DescribeBodyRefused() {
      if (IsNonEmptyString(this.oRequest.response)) {
        return `\n${this.oRequest.response}`;
      }
      if (this.oRequest.response === null) {
        return " response=null";
      }
      return this._DescribeSize();
    }

    _DescribeSize() {
      return this.bIsSegment
        ? ` Size=${this.oRequest.response.byteLength}bytes`
        : ` Size=${this.oRequest.response.length}characters`;
    }

    /*
      Ce que la reponse a probablement coute sur le fil. Le navigateur ne le dit pas, alors on le
      recompose : la ligne de statut et les en-tetes tels qu'ils nous sont rendus, moities si la
      connexion est en HTTP/2 -- qui les transporte comprimes --, plus le corps, annonce par
      Content-Length quand il est la, sinon mesure et rabattu si le serveur dit l'avoir compresse.
    */
    _EstimateSize() {
      let kbHeaders =
        STATUS_LINE_SIZE +
        this.oRequest.statusText.length +
        this.oRequest.getAllResponseHeaders().length;
      // Une phrase de statut vide : HTTP/2 n'en transporte plus.
      if (this.oRequest.statusText.length === 0) {
        kbHeaders = Math.round(kbHeaders * HTTP2_HEADER_RATIO);
      }

      let kbBody;
      const sLength = this.oRequest.getResponseHeader("Content-Length");
      if (sLength) {
        kbBody = Number.parseInt(sLength, 10);
      } else if (this.bIsSegment) {
        kbBody = this.oRequest.response.byteLength;
      } else {
        kbBody = this.oRequest.response.length;
        const sEncoding = this.oRequest.getResponseHeader("Content-Encoding");
        if (sEncoding && sEncoding !== "identity") {
          kbBody = Math.round(kbBody * COMPRESSED_BODY_RATIO);
        }
      }
      return kbHeaders + kbBody;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Les trois portes d'entree

  function LoadText(
    oCancellation,
    sAddress,
    nNoLongerThan,
    sLabel,
    bLog,
    oHeaders = null,
    sMethod = "GET"
  ) {
    return Load(
      oCancellation,
      sMethod,
      sAddress,
      nNoLongerThan,
      oHeaders,
      null,
      sLabel,
      bLog,
      "text"
    );
  }

  function LoadJson(
    oCancellation,
    sAddress,
    nNoLongerThan,
    sLabel,
    bLog,
    oHeaders = null,
    sMethod = "GET"
  ) {
    return Load(
      oCancellation,
      sMethod,
      sAddress,
      nNoLongerThan,
      oHeaders,
      null,
      sLabel,
      bLog,
      "json"
    );
  }

  /*
    pDataType dit a la fois ce qu'on attend et comment le rendre : "none", "text", "json", ou -- pour
    un segment -- sa duree en secondes, qui sert ensuite a juger le debit.
  */
  function Load(
    oCancellation,
    sMethod,
    sAddress,
    nNoLongerThan,
    oHeaders,
    pBody,
    sLabel,
    bLog,
    pDataType
  ) {
    if (g_bWorkFinished) {
      // Le lecteur s'arrete. On remonte la pile sans rien dire : ce n'est pas une erreur, c'est
      // le seul moyen de rompre une chaine de promesses que plus personne n'attend.
      throw void 0;
    }
    Check(
      sMethod === "GET" ||
        sMethod === "PUT" ||
        sMethod === "DELETE" ||
        sMethod === "POST"
    );
    Check(typeof sAddress == "string");
    // Zero veut dire « sans delai » ; en dessous d'une seconde, c'est une erreur d'unite.
    Check(
      Number.isFinite(nNoLongerThan) &&
        (nNoLongerThan === 0 || nNoLongerThan > 1e3)
    );
    Check(
      pBody === null ||
        (sMethod !== "GET" &&
          (pBody instanceof URLSearchParams ||
            (typeof pBody == "string" &&
              oHeaders &&
              IsNonEmptyString(oHeaders["Content-Type"]))))
    );
    Check(
      typeof oHeaders == "object" &&
        typeof sLabel == "string" &&
        typeof bLog == "boolean"
    );
    Check(
      pDataType === "none" ||
        pDataType === "text" ||
        pDataType === "json" ||
        Number.isFinite(pDataType)
    );
    if (oCancellation && oCancellation.bCancelled) {
      return Promise.reject(PromiseCancellation.REASON);
    }
    m_Log.Here(
      `[Downloader] ${sMethod} ${sLabel} no longer than ${m_Log.F0(
        nNoLongerThan
      )}ms`
    );
    // Aucune adresse hors des domaines de Twitch ne doit partir d'ici : c'est la seule barriere
    // entre une liste de segments trafiquee et une requete vers n'importe ou.
    m_Twitch.checkUrlAvailability(sAddress);
    return new Download(
      oCancellation,
      sMethod,
      sAddress,
      nNoLongerThan,
      oHeaders,
      pBody,
      sLabel,
      bLog,
      pDataType
    ).Start();
  }

  // ------------------------------------------------------------------------------------------
  // La file de segments

  /*
    Combien de segments descendent en meme temps, et lesquels. Appelee chaque fois que la file
    bouge : un segment arrive, un autre echoue, une nouvelle liste est analysee.
  */
  function LoadNextSegment() {
    let idxLast = g_maQueue.length - 1;
    if (
      idxLast >= 0 &&
      g_maQueue[idxLast].pData === STATE_VARIANT_CHANGE &&
      g_maQueue[idxLast].nProcessing === PROCESSING_DOWNLOADED
    ) {
      /*
        Un changement de variante attend en bout de file. Tout ce qui le precede appartient a
        l'ancienne qualite : le telecharger serait du trafic pour des images qu'on ne montrera pas.
        Les marqueurs, eux, restent -- ils portent l'etat du lecteur, pas des octets.
      */
      g_maQueue.ShowState();
      while (--idxLast >= 0 && g_maQueue[idxLast].nProcessing <= PROCESSING_DOWNLOADED) {
        if (typeof g_maQueue[idxLast].pData != "number") {
          g_maQueue.Remove(idxLast);
        }
      }
      g_maQueue.ShowState();
    } else {
      let nBudget = m_Settings.Get("nConcurrentDownloads");
      let nAllDownloadsDuration = 0;
      for (const oSegment of g_maQueue) {
        if (oSegment.nProcessing > PROCESSING_DOWNLOADED) {
          continue;
        }
        nAllDownloadsDuration += oSegment.nDuration;
        if (oSegment.nProcessing > PROCESSING_DOWNLOADING) {
          continue;
        }
        // Ce qui descend deja occupe une place, qu'on le lance ici ou non.
        --nBudget;
        if (oSegment.nProcessing === PROCESSING_AWAITING_DOWNLOAD && nBudget >= 0) {
          LoadSegment(oSegment);
        }
      }

      /*
        Si ce qui reste a telecharger represente plus de temps que le tampon ne peut en contenir,
        attendre ne sert plus a rien : quand le dernier arrivera, le premier sera perime. La
        liaison est trop lente pour cette qualite -- on elague et on repart d'un cran plus haut.
      */
      const nQueueOverflow =
        m_Settings.Get("nMaxBufferSize") + m_Settings.Get("nBufferStretch");
      if (nAllDownloadsDuration > nQueueOverflow) {
        m_Log.Oops(
          `[Downloader] Duration of all downloads in the queue ${m_Log.F1(
            nAllDownloadsDuration
          )}s > ${m_Log.F1(nQueueOverflow)}s`
        );
        HandleFailedSegmentDownload(null);
        LoadNextSegment();
        return;
      }
    }
    m_Transcoder.ConvertNextSegment();
  }

  function LoadSegment(oSegment) {
    const sAddress = oSegment.pData;
    // pData porte tour a tour l'adresse, le moyen d'annuler, puis les octets.
    oSegment.pData = new PromiseCancellation();
    oSegment.nProcessing = PROCESSING_DOWNLOADING;
    Load(
      oSegment.pData,
      "GET",
      sAddress,
      SegmentTimeout(oSegment),
      null,
      null,
      `segment ${oSegment.nNumber}`,
      m_Statistics.WindowOpened(),
      oSegment.nDuration
    )
      .then((bufData) => {
        Check(g_maQueue.includes(oSegment));
        oSegment.pData = bufData;
        oSegment.nProcessing = PROCESSING_DOWNLOADED;
        LoadNextSegment();
      })
      .catch(
        AddExceptionHandler((pReason) => {
          if (
            typeof pReason == "string" &&
            oSegment.nProcessing === PROCESSING_DOWNLOADING
          ) {
            Check(g_maQueue.includes(oSegment));
            /*
              Le segment fautif part seul ; le reste de la file garde sa chance.

              L'original testait ici un 404 ou un 410 pour elaguer la file entiere -- un segment
              que le serveur a oublie est rarement le seul --, mais il lisait `pReason.sReason`
              alors que le rejet est une chaine nue : la condition n'a jamais ete vraie. Le
              comportement est garde tel qu'il tourne ; le remettre en marche se decide a part.
            */
            HandleFailedSegmentDownload(oSegment);
            Check(!g_maQueue.includes(oSegment));
            LoadNextSegment();
          } else if (pReason === PromiseCancellation.REASON) {
            // La file l'a deja retire : c'est elle qui a annule.
            m_Log.Here(
              `[Downloader] Segment download cancelled ${oSegment.nNumber}`
            );
            Check(!g_maQueue.includes(oSegment));
          } else {
            throw pReason;
          }
        })
      );
  }

  function SegmentTimeout(oSegment) {
    return (
      (oSegment.nDuration *
        m_Settings.Get("nConcurrentDownloads") *
        SEGMENT_TIMEOUT_SLACK +
        SEGMENT_TIMEOUT_CONSTANT) *
      1e3
    );
  }

  /*
    Un segment donne, ou -- quand on passe null -- tout ce qui ne tiendra pas dans le tampon.

    Dans le second cas on garde les plus anciens, ceux dont la lecture a besoin tout de suite, et on
    jette la fin de la file : c'est elle qu'on aura le temps de redemander.
  */
  function HandleFailedSegmentDownload(oUnloadedSegment) {
    g_maQueue.ShowState();
    const kInQueue = g_maQueue.length;
    if (oUnloadedSegment) {
      g_maQueue.Remove(oUnloadedSegment);
    } else {
      let nKeep = m_Settings.Get("nBufferSize");
      for (let oSegment, idx = kInQueue; (oSegment = g_maQueue[--idx]); ) {
        if (oSegment.nProcessing === PROCESSING_AWAITING_DOWNLOAD) {
          if (nKeep > 0) {
            nKeep -= oSegment.nDuration;
          } else {
            g_maQueue.Remove(idx);
          }
        } else if (oSegment.nProcessing === PROCESSING_DOWNLOADING) {
          g_maQueue.Remove(idx);
        }
      }
    }
    g_maQueue.ShowState();
    m_Statistics.SegmentsNotLoaded(kInQueue - g_maQueue.length);
  }

  // ------------------------------------------------------------------------------------------
  // Le lien lui-meme

  /*
    Rien a faire quand le reseau change -- le telechargement en cours echouera ou non de lui-meme --
    mais la trace vaut de l'or dans un rapport : elle explique une rafale d'echecs qui, sans elle,
    ressemble a une panne du lecteur.
  */
  const handleNetworkChange = AddExceptionHandler((oEvent) => {
    m_Log.Oops(
      `[Downloader] Event ${oEvent.type} navigator.onLine=${navigator.onLine}` +
        ` connection.type=${navigator.connection && navigator.connection.type}`
    );
  });

  if (navigator.connection) {
    navigator.connection.addEventListener(
      "onchange" in navigator.connection ? "change" : "typechange",
      handleNetworkChange
    );
  } else {
    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);
  }
  if (!navigator.onLine) {
    m_Log.Oops("[Downloader] navigator.onLine=false");
  }

  return {
    Load,
    LoadText,
    LoadJson,
    LoadNextSegment,
  };
})();
