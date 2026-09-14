"use strict";

/**
 * Cache of #EXT-X-MAP initialisation segments.
 *
 * An fMP4 (CMAF) playlist ships its `moov` box separately from the media segments,
 * and every run of segments needs it appended to the SourceBuffer first. Twitch
 * reuses one URI for a whole broadcast, so a single download serves the session.
 *
 * A failure here is not fatal: the segment is simply not ready yet, the transcoder
 * leaves its media segments queued, and the next call retries the download.
 */
const m_InitSegment = (() => {
  const REQUEST_TIMEOUT = 20000;

  /** @type {!Map<string, {data: ?Uint8Array}>} */
  const _amCache = new Map();

  /**
   * Returns the initialisation segment for a URI, starting its download the first
   * time it is asked for.
   *
   * @param {string} sUrl
   * @returns {?Uint8Array} The bytes, or null while the download is still running.
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
          0
        )
        .then((bufData) => {
          oEntry.data = new Uint8Array(bufData);
          m_Log.Wow(
            `[InitSegment] Downloaded ${oEntry.data.length} bytes`
          );
          // Media segments were parked waiting for this; let them through.
          m_Transcoder.ConvertNextSegment();
        })
        .catch((pReason) => {
          // Drop the entry so the next segment retries rather than stalling forever.
          _amCache.delete(sUrl);
          m_Log.Oops(
            `[InitSegment] Download failed: ${ExceptionToString(pReason)}`
          );
        });
    } catch (pException) {
      _amCache.delete(sUrl);
      m_Log.Oops(
        `[InitSegment] Could not start download: ${ExceptionToString(
          pException
        )}`
      );
    }
    return null;
  }

  return { Get };
})();
