"use strict";
/*
	Le petit en-tete que reclame le chemin fMP4.

	Une liste de segments fMP4 annonce, par `#EXT-X-MAP`, l'adresse d'un segment d'initialisation :
	quelques kilooctets de parametres -- codecs, resolution, tables de decodage -- sans lesquels les
	segments media qui suivent ne veulent rien dire. Il ne change qu'a une discontinuite, et vingt
	segments d'affilee reclament le meme. On le garde donc, par adresse.

	**`Get` rend des octets ou null, jamais une promesse.** Le convertisseur l'appelle depuis une
	boucle qui parcourt la file et doit rester synchrone : lui rendre une promesse l'obligerait a
	rendre la main au milieu de la file, et l'ordre des segments ne survivrait pas. Quand les octets
	manquent, il gare la file et s'arrete ; c'est ce module qui le rappelle une fois la descente
	finie.

	**Un echec efface l'entree.** C'est la seule chose a ne pas oublier ici : une entree laissee en
	place apres une descente ratee marque l'adresse « en cours » pour toujours, et le flux se gele
	sans que rien ne leve. Mieux vaut redescendre le meme en-tete deux fois.
*/
const m_InitSegment = (() => {
  const REQUEST_TIMEOUT = 20000;

  /*
    Une entree par adresse. `data` reste null tant que les octets ne sont pas la : c'est la presence
    de l'entree, pas celle des octets, qui dit qu'une descente est deja lancee.

    @type {!Map<string, {data: ?Uint8Array}>}
  */
  const _amCache = new Map();

  /**
   * Rend le segment d'initialisation d'une adresse, et lance sa descente a la premiere demande.
   *
   * @param {string} sUrl
   * @returns {?Uint8Array} Les octets, ou null tant que la descente n'est pas finie.
   */
  function Get(sUrl) {
    Check(IsNonEmptyString(sUrl));
    const oCached = _amCache.get(sUrl);
    if (oCached !== void 0) {
      return oCached.data;
    }

    const oEntry = { data: null };
    _amCache.set(sUrl, oEntry);
    m_Log.Wow(`[InitSegment] Downloading ${sUrl}`);
    try {
      m_Downloader
        .Load(
          new PromiseCancellation(),
          "GET",
          sUrl,
          REQUEST_TIMEOUT,
          null,
          null,
          "initialisation segment",
          false,
          // Une duree de zero : recu en octets, comme un segment, mais sans peser sur les
          // mesures de debit, qui n'ont rien a apprendre d'un en-tete de quelques kilooctets.
          0
        )
        .then((bufData) => {
          oEntry.data = new Uint8Array(bufData);
          m_Log.Wow(`[InitSegment] Downloaded ${oEntry.data.length} bytes`);
          // Des segments media attendaient ces octets pour etre convertis : on les libere.
          m_Transcoder.ConvertNextSegment();
        })
        .catch((pReason) => {
          ForgetAddress(sUrl, "Download failed", pReason);
        });
    } catch (pException) {
      // Le telechargeur a refuse avant meme de partir -- adresse hors des domaines de Twitch,
      // travail termine. La distinction vaut la peine d'etre gardee : elle dit, dans un rapport,
      // si la requete a seulement rate ou si elle n'est jamais partie.
      ForgetAddress(sUrl, "Could not start download", pException);
    }
    return null;
  }

  // L'adresse redevient neuve : le prochain segment qui la reclame relancera une descente, au
  // lieu d'attendre indefiniment celle qui vient d'echouer.
  function ForgetAddress(sUrl, sWhat, pReason) {
    _amCache.delete(sUrl);
    m_Log.Oops(`[InitSegment] ${sWhat}: ${ExceptionToString(pReason)}`);
  }

  return { Get };
})();
