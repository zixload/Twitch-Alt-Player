"use strict";
/*
	Entre les octets descendus et les octets jouables.

	Twitch sert deux sortes de segments. La plupart des chaines envoient du MPEG-TS, un format de
	diffusion que le navigateur ne sait pas jouer : il faut le demultiplexer et le remultiplexer en
	fMP4. C'est du travail d'octet, assez lourd pour figer l'affichage s'il se faisait ici, donc il
	part dans un fil d'execution separe -- worker.js. Une minorite croissante de chaines sert deja du
	fMP4 : il n'y a alors rien a convertir, et le segment traverse ce module sans toucher au fil.

	**Un segment fMP4 attend que le fil soit vide.** C'est la seule regle delicate du module. Le
	passage direct est instantane ; un aller-retour par le fil prend quelques dizaines de
	millisecondes. Emettre un fMP4 pendant qu'un segment MPEG-TS est encore au fil le placerait,
	dans la file, avant un segment qui le precede dans le flux -- et l'image sauterait en arriere.

	**Un trou dans la numerotation vaut discontinuite.** Si le segment 41 suit le 39, le 40 s'est
	perdu : le decodeur doit repartir de zero, sinon il decodera par rapport a une image qu'il n'a
	jamais vue et rendra une bouillie qui ne leve rien.

	**Les segments partent par transfert, pas par copie.** Quelques megaoctets plusieurs fois par
	seconde : les copier se verrait a l'ecran.

	La file est un ordre, pas un ensemble. La boucle la descend depuis le debut et s'arrete au
	premier segment pas encore telecharge, meme si les suivants le sont.
*/
const m_Transcoder = (() => {
  /*
    Ce que le fil peut renvoyer. Un tableau dont la premiere case dit de quoi il s'agit : les
    messages entre fils n'ont pas de type, seulement une forme convenue de part et d'autre.
  */
  const WORKER_SEGMENT = 1;
  const WORKER_LOG = 2;
  const WORKER_REPORT = 3;
  const WORKER_MESSAGE = 4;
  const WORKER_DISCARD = 5;

  const LOG_SEVERITIES = ["Here", "Wow", "Oops"];

  let _oWorkerThread = null;
  // Les segments confies au fil et pas encore revenus. C'est ce compteur, et rien d'autre, qui
  // autorise ou non un fMP4 a passer.
  let _nWorkerJobs = 0;
  let _nLastLoaded = -1;

  // ------------------------------------------------------------------------------------------
  // La descente de la file

  function ConvertNextSegment() {
    /*
      Ce qui part au fil quitte la file, mais on ne retire rien pendant qu'on la parcourt. On note
      l'index du premier et combien suivent : ils se touchent, puisque la boucle s'arrete au
      premier segment pas encore telecharge.
    */
    let nRemove;
    let kRemove = 0;

    for (let oSegment, idx = 0; (oSegment = g_maQueue[idx]); ++idx) {
      if (oSegment.nProcessing > PROCESSING_DOWNLOADED) {
        // Deja converti : il attend le lecteur, pas nous.
        continue;
      }
      if (oSegment.nProcessing < PROCESSING_DOWNLOADED) {
        // Pas encore descendu. Tout ce qui suit devra attendre son tour.
        break;
      }

      if (_nLastLoaded !== -1 && _nLastLoaded + 1 !== oSegment.nNumber) {
        m_Log.Oops(
          `[Transcoder] Segments not loaded between ${_nLastLoaded} and ${oSegment.nNumber}`
        );
        oSegment.bDiscontinuity = true;
      }
      _nLastLoaded = oSegment.nNumber;

      if (typeof oSegment.pData == "number" && _oWorkerThread === null) {
        /*
          Un marqueur d'etat avant que le fil existe. Il n'y a rien a convertir : on le laisse
          passer tel quel, et si c'est le debut d'une transmission, c'est lui qui fait naitre le
          fil -- le premier segment media arrivera apres.
        */
        m_Log.Here(
          `[Transcoder] Skipping segment ${oSegment.nNumber} State=${oSegment.pData}`
        );
        oSegment.nProcessing = PROCESSING_CONVERTED;
        if (oSegment.pData === STATE_BROADCAST_START) {
          CreateWorkerThread();
        }
      } else if (oSegment.sInitSegmentUrl && typeof oSegment.pData != "number") {
        if (!ConvertInPlace(oSegment)) {
          break;
        }
      } else {
        SendToWorker(oSegment);
        if (++kRemove === 1) {
          nRemove = idx;
        }
      }
    }

    if (kRemove !== 0) {
      g_maQueue.Remove(nRemove, kRemove);
    }
    m_Player.AddNextSegment();
  }

  /*
    Le chemin fMP4. Les octets sont deja un MP4 fragmente -- exactement ce que le fil aurait
    produit --, donc il n'y a rien a demultiplexer : le segment est converti sur place et garde sa
    position dans la file, donc sa position dans le flux.

    Rend false quand il faut attendre : le module qui manque rappellera.
  */
  function ConvertInPlace(oSegment) {
    if (_nWorkerJobs !== 0) {
      // Un segment MPEG-TS est encore au fil. Emettre maintenant le ferait passer devant.
      return false;
    }
    const mbInitSegment = m_InitSegment.Get(oSegment.sInitSegmentUrl);
    if (mbInitSegment === null) {
      // L'en-tete descend encore. m_InitSegment nous rappelle quand il arrive.
      return false;
    }
    m_Statistics.SourceSegmentReceived();
    m_Log.Here(
      `[Transcoder] Segment ${oSegment.nNumber} is fMP4, no conversion needed`
    );
    oSegment.pData = BuildPassthroughData(oSegment, mbInitSegment);
    oSegment.nProcessing = PROCESSING_CONVERTED;
    m_Statistics.ConvertedSegmentReceived(oSegment);
    return true;
  }

  function SendToWorker(oSegment) {
    if (typeof oSegment.pData == "number") {
      // Un marqueur d'etat : il traverse le fil pour rester a sa place dans l'ordre des segments.
      m_Log.Here(
        `[Transcoder] Sending segment ${oSegment.nNumber} State=${oSegment.pData}`
      );
      _oWorkerThread.postMessage(oSegment);
      return;
    }
    m_Debug.SaveTransportStream(oSegment);
    m_Statistics.SourceSegmentReceived();
    m_Log.Here(`[Transcoder] Sending segment ${oSegment.nNumber}`);
    ++_nWorkerJobs;
    // Par transfert : le tampon est detache ici et appartient au fil.
    _oWorkerThread.postMessage(oSegment, [oSegment.pData]);
  }

  /**
   * Habille un segment deja fragmente de la forme que le lecteur attend en retour du fil, pour que
   * rien en aval n'ait besoin de savoir d'ou viennent les octets.
   *
   * @param {!Segment} oSegment Un segment descendu, dont pData est l'ArrayBuffer brut.
   * @param {!Uint8Array} mbInitSegment L'en-tete `#EXT-X-MAP` garde en cache.
   * @returns {!Object}
   */
  function BuildPassthroughData(oSegment, mbInitSegment) {
    const sCodecs = oSegment.sCodecs;
    const oData = {
      bPassthrough: true,
      mbMediaSegment: new Uint8Array(oSegment.pData),
      bHasVideo: /avc1|avc3|hvc1|hev1|av01|vp09/.test(sCodecs),
      bHasAudio: /mp4a|ac-3|ec-3|opus|fLaC/.test(sCodecs),
      nConvertedIn: 0,
    };
    if (oSegment.bDiscontinuity) {
      /*
        Le lecteur empile cet en-tete avant le segment media, puis le remet au recycleur -- qui
        neutralise le tampon. Partager l'exemplaire du cache reviendrait a le detruire a la
        premiere discontinuite : chacune emporte donc sa copie.
      */
      oData.mbInitializationSegment = mbInitSegment.slice();
      oData.sCodecs = `video/mp4;codecs="${sCodecs}"`;
      oData.sCodecsDescription = sCodecs;
      oData.sResolution = oSegment.sResolution;
    }
    return oData;
  }

  // ------------------------------------------------------------------------------------------
  // Ce que le fil renvoie

  const HandleConversionFinished = AddExceptionHandler((oEvent) => {
    const mData = oEvent.data;
    Check(Array.isArray(mData));
    switch (mData[0]) {
    case WORKER_SEGMENT:
      Check(mData.length === 2 && IsObject(mData[1]));
      ReceiveSegment(mData[1]);
      return;

    case WORKER_LOG:
      ReceiveLogRecords(mData[1], mData[2], mData.length);
      return;

    case WORKER_REPORT:
      Check(
        mData.length === 3 &&
          typeof mData[1] == "string" &&
          typeof mData[2] == "object"
      );
      m_Debug.TerminateAndSendReport(mData[1], mData[2]);
      return;

    case WORKER_MESSAGE:
      Check(mData.length === 2 && typeof mData[1] == "string");
      m_Debug.FinishWorkAndShowMessage(mData[1]);
      return;

    case WORKER_DISCARD:
      Check(mData.length === 2 && mData[1].byteLength);
      m_GarbageCollector.Discard(mData[1]);
      return;

    default:
      Check(false);
    }
  });

  function ReceiveSegment(oResult) {
    if (_nWorkerJobs !== 0) {
      --_nWorkerJobs;
    }
    const oSegment = new Segment(
      PROCESSING_CONVERTED,
      oResult.pData,
      oResult.nDuration,
      oResult.bDiscontinuity,
      oResult.nNumber
    );
    m_Log.Here(
      `[Transcoder] Segment received ${oSegment.nNumber}` +
        ` ConvertedIn=${m_Log.F0(oSegment.pData.nConvertedIn)}ms`
    );
    if (typeof oSegment.pData != "number") {
      m_Statistics.ConvertedSegmentReceived(oSegment);
      if (!oSegment.pData.hasOwnProperty("mbMediaSegment")) {
        /*
          Le fil a lu le segment et n'en a tire que des parametres -- pas une image. Les
          statistiques les ont pris ; il n'y a rien a empiler, et rien a garder.
        */
        return;
      }
      m_Debug.SaveConvertedSegment(oSegment);
    }
    g_maQueue.Add(oSegment);
    m_Player.AddNextSegment();
  }

  // Le fil n'a pas de console a lui : son journal repasse par ici pour finir dans le meme rapport.
  function ReceiveLogRecords(msSeverity, msRecords, kFields) {
    Check(
      kFields === 3 &&
        Array.isArray(msSeverity) &&
        Array.isArray(msRecords) &&
        msSeverity.length === msRecords.length
    );
    for (let idx = 0; idx < msSeverity.length; ++idx) {
      Check(
        LOG_SEVERITIES.includes(msSeverity[idx]) &&
          typeof msRecords[idx] == "string"
      );
      m_Log[msSeverity[idx]](msRecords[idx]);
    }
  }

  function HandleConversionError(oEvent) {
    m_Debug.TerminateAndSendReport(
      `Event occurred: ${oEvent.type} in the worker thread at line ${oEvent.lineno}. ${oEvent.message}`
    );
  }

  // ------------------------------------------------------------------------------------------
  // La vie du fil

  function CreateWorkerThread() {
    m_Log.Here("[Transcoder] Creating worker thread");
    _nWorkerJobs = 0;
    _oWorkerThread = new Worker("/worker.js");
    _oWorkerThread.addEventListener("message", HandleConversionFinished);
    // Une erreur dans le fil, ou un message qu'il n'a pas su lire : dans les deux cas il ne rendra
    // plus rien, et continuer donnerait une image figee sans explication.
    _oWorkerThread.addEventListener("error", HandleConversionError);
    _oWorkerThread.addEventListener("messageerror", HandleConversionError);
  }

  /*
    Le flux qui suivra est un autre flux : la numerotation repart de zero, sinon son premier
    segment passerait pour la suite du precedent.
  */
  function Stop() {
    _nLastLoaded = -1;
    if (_oWorkerThread) {
      m_Log.Here("[Transcoder] Killing worker thread");
      _oWorkerThread.terminate();
      _oWorkerThread = null;
      _nWorkerJobs = 0;
    }
  }

  return {
    Stop,
    ConvertNextSegment,
  };
})();
