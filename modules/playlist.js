"use strict";

const m_Playlist = (() => {
  const AD_LIST_UPDATE_INTERVAL = 2e3;
  const MIN_LIST_UPDATE_INTERVAL = 500;
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
      this._update(this._oPromiseCancel, -Infinity);
    }
    stop() {
      if (this._oPromiseCancel) {
        m_Log.Here(
          `[Playlist] Stopping list updates ${+this._bNoAds}`
        );
        this._oPromiseCancel.Cancel();
        this._oPromiseCancel = null;
      }
    }
    saveBroadcastVariant(oVariant) {
      m_Settings.Change("sVariantLabel", oVariant.sIdentifier);
      m_Settings.Change("nVariantBitrate", oVariant.nBitrate);
    }
    selectBroadcastVariant(moVariants) {
      const sSavedId = m_Settings.Get("sVariantLabel");
      const nSavedBitrate = m_Settings.Get("nVariantBitrate");
      let oSelectedVariant = moVariants.find(
        ({ sIdentifier }) => sIdentifier === sSavedId
      );
      if (!oSelectedVariant) {
        if (sSavedId === "chunked" || sSavedId === "audio_only") {
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
        `[Playlist] For list ${+this._bNoAds} broadcast variant selected ${oSelectedVariant.sIdentifier
        }/${oSelectedVariant.nBitrate
        }. Saved ${sSavedId}/${nSavedBitrate}`
      );
      return oSelectedVariant;
    }
    _update(oPromiseCancellation, nAfter) {
      Check(IsNumber(nAfter));
      if (nAfter >= MIN_LIST_UPDATE_INTERVAL || nAfter === -Infinity) {
        m_Log.Here(
          `[Playlist] List update ${+this
            ._bNoAds} will start in ${m_Log.F0(nAfter)}ms`
        );
      } else {
        m_Log.Oops(
          `[Playlist] List update ${+this
            ._bNoAds} will start in ${MIN_LIST_UPDATE_INTERVAL}ms instead of ${m_Log.F0(
              nAfter
            )}ms`
        );
        nAfter = MIN_LIST_UPDATE_INTERVAL;
      }
      let oPromise = Wait(oPromiseCancellation, nAfter);
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
            oVariantList = ParseList(
              true,
              sAbsoluteVariantListUrl,
              sResult
            );
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
          const oSegmentList = ParseList(
            false,
            oSelectedVariant.sAbsoluteSegmentListUrl,
            sResult
          );
          let nUpdateInterval;
          if (
            this._isStaleSegmentList(
              oVariantList,
              oSegmentList,
              oSelectedVariant
            )
          ) {
            m_Statistics.SegmentsQueued(0, 0);
            if (oSegmentList.bEndOfList) {
              throw "END_OF_LIST";
            }
            nUpdateInterval = AD_LIST_UPDATE_INTERVAL;
          } else {
            const bShortenedInterval =
              nAfter === -Infinity || this.oVariantList === null;
            this.oVariantList = oVariantList;
            this.oSegmentList = oSegmentList;
            this.oSelectedVariant = oSelectedVariant;
            nUpdateInterval =
              this._segmentListUpdated(bShortenedInterval);
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
              this._listNotUpdated(oPromiseCancellation, pReason);
              m_Downloader.LoadNextSegment();
            } else if (pReason === PromiseCancellation.REASON) {
              m_Log.Here(
                `[Playlist] List update cancelled ${+this._bNoAds}`
              );
            } else {
              throw pReason;
            }
          })
        );
    }
    _isStaleSegmentList(
      oVariantList,
      oSegmentList,
      oSelectedVariant
    ) {
      const SESSION_CHANGE_THRESHOLD = 5;
      Check(
        (this.oVariantList === null) == (this.oSegmentList === null)
      );
      if (oSegmentList.moSegments.length === 0) {
        m_Log.Oops(`[Playlist] Segment list ${+this._bNoAds} is empty`);
        return true;
      }
      if (this.oSegmentList === null) {
        return false;
      }
      Check(
        !(
          this.oVariantList.sBroadcastId !==
          oVariantList.sBroadcastId &&
          this.oVariantList.nSessionId === oVariantList.nSessionId
        )
      );
      if (
        this.oSegmentList.nTargetDuration !==
        oSegmentList.nTargetDuration
      ) {
        m_Log.Oops(
          `[Playlist] In list ${+this._bNoAds} target duration changed ${this.oSegmentList.nTargetDuration
          } ==> ${oSegmentList.nTargetDuration}`
        );
      }
      if (this.oSelectedVariant !== null) {
        const nDifference =
          oSegmentList.nSequenceNumber -
          this.oSegmentList.nSequenceNumber;
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
              `[Playlist] In list ${+this._bNoAds} for segment ${oSegmentList.nSequenceNumber + nNew
              } address changed ${LimitStringLength(
                this.oSegmentList.moSegments[nOld].sAddress,
                100
              )} ==> ${LimitStringLength(
                oSegmentList.moSegments[nNew].sAddress,
                100
              )}`
            );
            oSegmentList.bChaos = true;
            break;
          }
        }
      }
      const nDifference =
        this.oSegmentList.nSequenceNumber +
        this.oSegmentList.moSegments.length -
        oSegmentList.nSequenceNumber -
        oSegmentList.moSegments.length;
      if (nDifference > 0) {
        if (this.oSelectedVariant === null && nDifference <= SESSION_CHANGE_THRESHOLD) {
          m_Log.Oops(
            `[Playlist] While switching variant in list ${+this
              ._bNoAds} sequence number decreased ${this.oSegmentList.nSequenceNumber
            } + ${this.oSegmentList.moSegments.length} ==> ${oSegmentList.nSequenceNumber
            } + ${oSegmentList.moSegments.length}`
          );
          return false;
        }
        if (
          oSegmentList.nSequenceNumber === 0 ||
          nDifference > SESSION_CHANGE_THRESHOLD
        ) {
          m_Log.Oops(
            `[Playlist] Changing SessionId: in list ${+this
              ._bNoAds} sequence number decreased ${this.oSegmentList.nSequenceNumber
            } + ${this.oSegmentList.moSegments.length} ==> ${oSegmentList.nSequenceNumber
            } + ${oSegmentList.moSegments.length}`
          );
          oVariantList.nSessionId = _nSessionId++;
          return false;
        }
        m_Log.Oops(
          `[Playlist] Stale list received ${+this
            ._bNoAds}: sequence number ${this.oSegmentList.nSequenceNumber
          } + ${this.oSegmentList.moSegments.length} ==> ${oSegmentList.nSequenceNumber
          } + ${oSegmentList.moSegments.length}`
        );
        return true;
      }
      if (
        this.oSegmentList.nSequenceNumber >
        oSegmentList.nSequenceNumber
      ) {
        m_Log.Oops(
          `[Playlist] In list ${+this
            ._bNoAds} sequence number decreased ${this.oSegmentList.nSequenceNumber
          } ==> ${oSegmentList.nSequenceNumber}`
        );
      }
      return false;
    }
  }
  class ListUpdatesWithAds extends ListUpdates {
    constructor() {
      super(false);
    }
    _segmentListUpdated(bShortenedInterval) {
      m_Log.Here(
        `[AdBlock] Main stream updated. Segments=${this.oSegmentList.moSegments.length} EndOfList=${this.oSegmentList.bEndOfList}`
      );
      if (this.oSegmentList.moSegments.length === 0) {
        // An empty segment list is what leaves the picture frozen.
        m_Log.Oops("[AdBlock] Main stream is empty");
      }
      const bListEndsWithAd = thisListEndsWithAd(
        this.oSegmentList
      );
      m_Twitch.sendAdTrackingData(
        bListEndsWithAd ? this.oSegmentList : null
      );
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
        : getSegmentListUpdateInterval(
          this.oSegmentList,
          bShortenedInterval
        );
    }
    _listNotUpdated(oPromiseCancellation, sReason) {
      if (sReason === "ACCESS_DENIED") {
        m_Controls.StopWatchingBroadcast();
        m_Notification.ShowAss();
      } else {
        m_Log[sReason === "END_OF_LIST" ? "Wow" : "Oops"](
          `[Playlist] Broadcast ended. ${sReason}`
        );
        EndBroadcast();
        this._update(
          oPromiseCancellation,
          getVariantListUpdateInterval()
        );
      }
    }
  }
  /**
     * **ENGLISH:** AdFreePlaylistUpdate (Class)
     *
     * @alias AdFreePlaylistUpdate
     * @purpose Manages the lifecycle of the "Ad-Free" (clean) backup playlist stream during debugging.
     * @description
     * This class extends the base {@link ListUpdates} functionality to handle specific checks
     * and behaviors required for the backup stream used to bypass automated Twitch advertisements.
     *
     * **Mechanism:**
     * When the main stream receives an identifying ad-marker, the player switches to this "Ad-Free" stream
     * (requested via `playerType: "picture-by-picture"`).
     *
     * **Critical Logic (Debugging / Investigation):**
     * This class implements aggressive sanitization logic to test the hypothesis that the backup stream
     * contains metadata triggering false-positive ad detection. To attempt to force playback during
     * failure states, this class forcibly sets the `bAd` (isAd) flag to `false` for all incoming segments.
     *
     * Additionally, it utilizes **Dynamic Decomposition** to validate the temporal integrity of the stream,
     * logging potential synchronization issues (Clock Skew) that may cause the player to reject segments
     * as invalid or expired.
     *
     * @extends ListUpdates
     * @dependencies
     * - [`player.js:6480`](./player.js#L6480)
     */

  class ListUpdatesWithoutAds extends ListUpdates {
    /**
     * Constructor: AdFreePlaylistUpdate
     * Initializes the playlist updater with `isAdFree` (bNoAds) set to true.
     */
    constructor() {
      super(true); // true = Ad-Free / Backup stream mode
    }

    /**
     * Method: stop (stop)
     * Stops the playlist update loop and clears all internal state.
     * This calls the parent `stop` to cancel any pending promises/timers,
     * and then `clean` (clear) to wipe segment and variant processing data.
     */
    stop() {
      super.stop();
      this.clear();
    }

    /**
     * Method: onSegmentListUpdated (_segmentListUpdated)
     * FIX APPLIED: Force-sanitize backup stream segments. 
     * Twitch is now injecting Ad Metadata into the backup stream, causing the player to reject it.
     * We must strip these flags to force playback.
     */
    _segmentListUpdated(bShortenedInterval) {

      // --- FIX START: FORCE CONTENT MODE FOR BACKUP STREAM ---
      // Iterate through all segments in the fetched backup playlist
      if (this.oSegmentList && this.oSegmentList.moSegments) {
        for (let i = 0; i < this.oSegmentList.moSegments.length; i++) {
          // Force the 'isAd' flag to false. 
          // This tricks the queue manager (QueueSegments) into accepting the segments.
          this.oSegmentList.moSegments[i].bAd = false;
        }
      }
      // --- FIX END ---


      // --- REMOVED THE "THROW IF AD FOUND" CHECK ---
      // We process the segments as normal content now.

      bShortenedInterval = // bShortenedInterval
        QueueSegments( // AddSegmentsToQueue
          this.oVariantList, // oVariantList
          this.oSegmentList, // oSegmentList
          this.oSelectedVariant // oSelectedVariant
        ) || bShortenedInterval; // bShortenedInterval

      if (this.oSegmentList.bEndOfList) { // oSegmentList.bEndOfList
        throw "END_OF_LIST"; // END_OF_LIST
      }

      return getSegmentListUpdateInterval( // getSegmentListUpdateInterval
        this.oSegmentList, // oSegmentList
        bShortenedInterval // bShortenedInterval
      );
    }

    /**
     * Method: onListNotUpdated (_listNotUpdated)
     * Handles failures when the playlist cannot be refreshed (e.g., 404, network error).
     *
     * **Debug Modification:**
     * Adds explicit console error logging to trace the specific reason for rejection
     * in the console logs for easier correlation with the "Black Screen" state.
     *
     * @param {Object} oPromiseCancel - The promise cancellation token.
     * @param {string} sReason - The reason for the update failure.
     */
    _listNotUpdated(oPromiseCancellation, sReason) {
      // Code modified to implement debugging
      console.error(`CRITICAL FAILURE: Backup stream rejected! Reason: ${sReason}`);
      m_Log.Oops(`[Playlist] List 1 not updated. ${sReason}`);
      this.stop();
    }
  }


  //end new code
  const _oListsWithAds = new ListUpdatesWithAds();
  const _oListsWithoutAds = new ListUpdatesWithoutAds();
  let _nState = STATE_STOP;
  let _bAdInProgress = false;
  let _nVariantListUpdateInterval = -1;
  let _nSessionId = 1;
  function ParseList(
    bIsVariantList,
    sAbsoluteListUrl,
    sListBeingParsed
  ) {
    const MAX_SUPPORTED_HLS_VERSION = 7;
    if (sListBeingParsed.includes("shelblock.proxy")) {
      m_Debug.FinishWorkAndShowMessage("J0220");
    }
    if (!sListBeingParsed.startsWith("#EXTM3U")) {
      throw `Instead of a playlist, invalid data of length ${sListBeingParsed.length}\n${sListBeingParsed}`;
    }
    let nVersion = 1;
    let mapRenditionGroups,
      moVariants, // variants
      oNewVariant, // newVariant
      sBroadcastId, // broadcast id
      sViewTrackingUrl; // viewingTrackingUrl
    let nTargetDuration,
      nSequenceNumber, // sequence number
      bEndOfList, // endOfList
      kAdSegments, // adSegmentsCount
      // not sure if `adContentType` or `adRollType` is more correct
      // sAdType, // adContentType
      sAdType, // adRollType
      kAdClips, // clipCount
      nAdClipNumber, // clipNumber
      nAdClipDuration, // clipDuration
      sAdToken, // adToken
      sAdClipId1, // clipId1
      sAdClipId2, // clipId2
      sAdClipId3, // clipId3
      sAdClipId4, // clipId4
      sAdClipId5, // clipId5
      sAdClipId6, // clipId6
      nQuartileNumber, // quartileNumber
      moSegments, // segments
      oNewSegment; // newSegment
    let bDiscontinuity, nTime; 
    if (bIsVariantList) {
      mapRenditionGroups = new Map();
      moVariants = [];
      oNewVariant = null;
      sBroadcastId = "";
      sViewTrackingUrl = "";
    } else {
      nTargetDuration = -1;
      nSequenceNumber = 0;
      bEndOfList = false;
      kAdSegments = 0;
      sAdType = "";
      moSegments = [];
      oNewSegment = null;
      bDiscontinuity = false;
      nTime = NaN;
    }
    // URI of the #EXT-X-MAP initialisation segment. Empty for MPEG-TS playlists.
    let sInitSegmentUrl = "";
    const reTagOrUrl = /^#EXT([^:\r\n]+)(?::(.*))?$|^[^#\r\n].*$/gm;
    reTagOrUrl.lastIndex = 7;
    for (
      let msTagOrUrl;
      (msTagOrUrl = reTagOrUrl.exec(sListBeingParsed));

    ) {
      const [sAddress, sTagName = "", sTagValue = ""] = msTagOrUrl;
      try {
        switch (sTagName) {
          case "":
            if (bIsVariantList) {
              Check(oNewVariant !== null);
              oNewVariant.sAbsoluteSegmentListUrl =
                ResolveRelativeUrl(sAddress, sAbsoluteListUrl);
              moVariants.push(oNewVariant);
              oNewVariant = null;
            } else {
              reject(oNewSegment !== null);
              oNewSegment.sAddress = ResolveRelativeUrl(
                sAddress,
                sAbsoluteListUrl
              );
              oNewSegment.bDiscontinuity = bDiscontinuity;
              moSegments.push(oNewSegment);
              bDiscontinuity = false;
              kAdSegments += Boolean(oNewSegment.bAd);
              oNewSegment = null;
            }
            break;

          case "INF": {
            Check(!bIsVariantList);
            Check(nTargetDuration !== -1);
            Check(oNewSegment === null);
            oNewSegment = Object.create(null);
            const { nDuration, sSegmentName } =
              parseEXTINF(sTagValue);
            oNewSegment.nDuration = nDuration;

            oNewSegment.bAd = m_Twitch.isAdSegment(sSegmentName);

            if (oNewSegment.bAd) {
              nTime = NaN;
            }
            oNewSegment.nTime = nTime;
            nTime++;
            if (oNewSegment.nDuration < 0) {
              m_Log.Oops(
                `[Playlist] Segment ${nSequenceNumber + moSegments.length
                } has a negative duration ${sTagValue}`
              );
              oNewSegment.nDuration = 0;
            }
            if (Math.round(oNewSegment.nDuration) > nTargetDuration) {
              m_Log.Oops(
                `[Playlist] Duration of segment ${nSequenceNumber + moSegments.length
                } exceeds target duration by ${oNewSegment.nDuration - nTargetDuration
                }s`
              );
              if (oNewSegment.nDuration > nTargetDuration * 3) {
                oNewSegment.nDuration = 0;
              }
            }
            break;
          }

          case "-X-DISCONTINUITY":
            Check(!bIsVariantList);
            Check(!sTagValue);
            bDiscontinuity = true;
            break;

          // Reconnu sans etre exploite. La branche doit exister : le cas par defaut de cet
          // parser runs Check(false), so an unlisted tag would make playback fail
          // de toute playlist qui la porte — c'est-a-dire toutes.
          case "-X-PROGRAM-DATE-TIME":
            Check(!bIsVariantList);
            break;

          // #EXT-X-MAP is not encryption. It names the initialisation segment of an
          // fMP4 (CMAF) playlist, the container Twitch is migrating channels to.
          // Only #EXT-X-KEY means the media itself is encrypted.
          case "-X-MAP": {
            Check(!bIsVariantList);
            const amMapAttributes = ParseAttributeList(sTagValue);
            const sMapUri = amMapAttributes.get("URI");
            Check(IsNonEmptyString(sMapUri));
            // A byte range would mean the init segment shares a file with the media
            // segments. Twitch does not do that, and honouring it needs range requests.
            Check(!amMapAttributes.has("BYTERANGE"));
            sInitSegmentUrl = ResolveRelativeUrl(sMapUri, sAbsoluteListUrl);
            break;
          }

          case "-X-KEY": {
            Check(!bIsVariantList);
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

          case "-X-BYTERANGE":
          case "-X-GAP":
            Check(false);
            break;

          case "-X-TARGETDURATION":
            Check(!bIsVariantList);
            Check(nTargetDuration === -1);
            nTargetDuration = ParsePositiveInteger(sTagValue);
            Check(nTargetDuration > 0 && nTargetDuration < 60);
            break;

          case "-X-MEDIA-SEQUENCE":
            Check(!bIsVariantList);
            Check(nSequenceNumber === 0);
            nSequenceNumber = ParsePositiveInteger(sTagValue);
            break;

          case "-X-ENDLIST":
            Check(!bIsVariantList);
            Check(!sTagValue);
            bEndOfList = true;
            break;

          case "-X-DISCONTINUITY-SEQUENCE":
            Check(!bIsVariantList);
            break;

          case "-X-PLAYLIST-TYPE":
          case "-X-I-FRAMES-ONLY":
            Check(false);
            break;

          case "-X-TWITCH-LIVE-SEQUENCE":
            Check(!bIsVariantList);
            nTime = ParsePositiveInteger(sTagValue);
            break;

          case "-X-DATERANGE": {
            Check(!bIsVariantList);
            const amAttributes = ParseAttributeList(sTagValue);

            // --- STRICT AD FILTER FIX (UPDATED DEC 16) ---
            try {
              const sClass = amAttributes.get("CLASS");
              if (sClass === "twitch-stitched-ad") {
                const sStartDate = amAttributes.get("START-DATE");
                const sDuration = amAttributes.get("DURATION");

                if (sStartDate && sDuration) {
                  const nAdStartTime = Date.parse(sStartDate);
                  const nDurationMs = parseFloat(sDuration) * 1000;
                  const nAdEndTime = nAdStartTime + nDurationMs;

                  // Calculate current server time. 
                  const nCurrentTime = !Number.isNaN(g_nExactTime)
                    ? performance.now() + g_nExactTime
                    : Date.now();

                  // RULE 1: STRICT EXPIRY. 
                  // If the ad end time is in the past (plus 1s for jitter), KILL IT.
                  // Previous issue: 15s buffer allowed finished ads to block playback.
                  if (nAdEndTime < (nCurrentTime + 1000)) {
                    m_Log.Wow(
                      `[AdBlock] Skipping expired ad. Ends=${new Date(nAdEndTime).toISOString()} Now=${new Date(nCurrentTime).toISOString()}`
                    );
                    break; // EXIT this case immediately
                  }

                  // RULE 2: FUTURE PROTECTION.
                  // If ad starts >60s in the future, ignore it to prevent pre-mature freezing.
                  if (nAdStartTime > (nCurrentTime + 60000)) {
                    m_Log.Wow(
                      `[AdBlock] Skipping future ad. Starts=${new Date(nAdStartTime).toISOString()}`
                    );
                    break; // EXIT this case immediately
                  }
                }
              }
            } catch (pException) {
              m_Log.Oops(
                `[AdBlock] Filter error: ${ExceptionToString(pException)}`
              );
            }

            try {
              switch (amAttributes.get("CLASS")) {
                case "twitch-stitched-ad":
                  // The raw attribute string of the ad tag, kept whole because the
                  // shape of these tags is what the ad-freeze work turns on.
                  m_Log.Here(`[AdBlock] Ad tag detected: ${sTagValue}`);

                  // Extract Ad Type (e.g., standard, midroll)
                  sAdType = amAttributes.get("X-TV-TWITCH-AD-ROLL-TYPE");

                  // Extract Total Number of Ads in this break (Pod Length)
                  kAdClips = ParsePositiveInteger(
                    amAttributes.get("X-TV-TWITCH-AD-POD-LENGTH")
                  );

                  // Extract Current Ad Position (e.g., 2 in a sequence of 4)
                  nAdClipNumber = ParsePositiveInteger(
                    amAttributes.get("X-TV-TWITCH-AD-POD-POSITION")
                  );

                  // Extract Duration of the ad in seconds
                  nAdClipDuration = ParsePositiveNumber(
                    amAttributes.get("DURATION") || "0"
                  );

                  // Extract specific Ad Tracking tokens and IDs for analytics
                  // These IDs are NOT used for playback logic. They are only used to construct
                  // the "Proof of View" telemetry packet sent back to Twitch via 'recordAdEvent'.

                  // RADS Token: The unique cryptographic token validating this specific ad impression.
                  sAdToken =
                    amAttributes.get("X-TV-TWITCH-AD-RADS-TOKEN") || "";

                  // Advertiser ID: Identifies the company buying the ad (mapped to 'ad_id' in GQL).
                  sAdClipId1 =
                    amAttributes.get("X-TV-TWITCH-AD-ADVERTISER-ID") || "";

                  // Creative ID: Identifies the specific video asset/commercial (mapped to 'creative_id').
                  sAdClipId2 =
                    amAttributes.get("X-TV-TWITCH-AD-CREATIVE-ID") || "";

                  // Line Item ID: Internal campaign management ID (mapped to 'line_item_id').
                  sAdClipId3 =
                    amAttributes.get("X-TV-TWITCH-AD-LINE-ITEM-ID") || "";

                  // Order ID: Purchase order ID for the ad campaign (mapped to 'order_id').
                  sAdClipId4 = amAttributes.get("X-TV-TWITCH-AD-ORDER-ID") || "";

                  // Ad Session ID: Ties this ad view to the user's viewing session (mapped to 'ad_session_id').
                  sAdClipId5 =
                    amAttributes.get("X-TV-TWITCH-AD-AD-SESSION-ID") || "";

                  // Ad Format: The format of the ad, e.g., 'Video', 'Display' (mapped to 'format_name').
                  sAdClipId6 = amAttributes.get("X-TV-TWITCH-AD-AD-FORMAT") || "";

                  // Validate that we found a valid Ad Type
                  Check(sAdType);
              }
            } catch (pException) {
              // Safety fallback: if parsing fails, reset ad type and log error.
              sAdType = "";
              m_Log.Oops(`[Playlist] Ad parse error: ${sTagValue}`);
            }
            break;
          }

          case "-X-MEDIA": {
            Check(bIsVariantList);
            const amAttributes = ParseAttributeList(sTagValue);
            const sType = amAttributes.get("TYPE");
            Check(sType);
            Check(
              (sType !== "VIDEO" && sType !== "AUDIO") || !amAttributes.has("URI")
            );
            if (sType === "VIDEO") {
              const sGroup = amAttributes.get("GROUP-ID");
              const sName = amAttributes.get("NAME");
              Check(sGroup && sName);
              Check(!mapRenditionGroups.has(sGroup));
              mapRenditionGroups.set(sGroup, sName);
            } else {
              m_Log.Oops(`[Playlist] Found #EXT-X-MEDIA TYPE=${sType}`);
            }
            break;
          }

          case "-X-STREAM-INF": {
            Check(bIsVariantList);
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
            // Needed to build the SourceBuffer MIME type for fMP4 playlists, where no
            // demuxer runs to derive the codec string from the elementary streams.
            oNewVariant.sCodecs = amAttributes.get("CODECS") || "";
            oNewVariant.sResolution = amAttributes.get("RESOLUTION") || "";
            break;
          }

          case "-X-I-FRAME-STREAM-INF":
          case "-X-SESSION-DATA":
          case "-X-SESSION-KEY":
            Check(bIsVariantList);
            break;

          case "-X-TWITCH-INFO": {
            Check(bIsVariantList);
            const amAttributes = ParseAttributeList(sTagValue);
            const nSeconds = ParsePositiveNumber(
              amAttributes.get("SERVER-TIME")
            );
            Check(nSeconds > 1531267200 && nSeconds < 1846886400);
            const nMilliseconds = nSeconds * 1e3 + 50;
            g_nExactTime = nMilliseconds - performance.now();
            const nTimeDrift = nMilliseconds - Date.now();
            sBroadcastId = amAttributes.get("BROADCAST-ID");
            Check(sBroadcastId);
            try {
              const sAddress = atob(amAttributes.get("C"));
              Check(sAddress.startsWith("https://"));
              sViewTrackingUrl = sAddress;
            } catch (pException) {
              m_Log.Oops(
                `[Playlist] Could not parse the view tracking address: ${pException}`
              );
            }
            m_Log[Math.abs(nTimeDrift) > 5e3 ? "Oops" : "Wow"](
              `[Playlist] TimeDrift=${nTimeDrift}ms BroadcastId=${sBroadcastId}`
            );
            break;
          }

          case "-X-VERSION":
            Check(nVersion === 1);
            nVersion = ParsePositiveInteger(sTagValue);
            Check(
              nVersion >= 2 && nVersion <= MAX_SUPPORTED_HLS_VERSION
            );
            break;

          case "-X-START":
            m_Log.Oops(`[Playlist] Found #EXT-X-START=${sTagValue}`);
            break;

          case "M3U":
          case "-X-DEFINE":
            Check(false);
        }
      } catch (pException) {
        if (
          pException instanceof Error &&
          pException.message === "REJECT"
        ) {
          throw `Error parsing playlist line:\n${ExceptionToString(
            pException
          )}\n${sAddress}`;
        }
      }
    }
    if (bIsVariantList) {
      Check(oNewVariant === null);
      for (let oVariant of moVariants) {
        if (oVariant.sIdentifier) {
          Check(mapRenditionGroups.has(oVariant.sIdentifier));
          oVariant.sLabel = mapRenditionGroups.get(oVariant.sIdentifier);
        } else {
          oVariant.sIdentifier = `CoolCmd${oVariant.nBitrate}`;
          oVariant.sLabel = `${m_i18n.FormatNumber(
            oVariant.nBitrate / 1e6,
            1
          )} ${GetText("J0114")}`;
        }
      }
      m_Log.Here(
        `[Playlist] Number of variants in list: ${moVariants.length}`
      );
      return m_Twitch.sortVariantList({
        sBroadcastId,
        nSessionId: _nSessionId++,
        sViewTrackingUrl,
        moVariants,
      });
    } else {
      Check(oNewSegment === null);
      Check(nTargetDuration !== -1);
      const oSegmentList = {
        nTargetDuration,
        nSequenceNumber,
        bEndOfList,
        bChaos: false,
        kAdSegments,
        sAdType,
        kAdClips,
        nAdClipNumber,
        nAdClipDuration,
        sAdToken,
        sAdClipId1,
        sAdClipId2,
        sAdClipId3,
        sAdClipId4,
        sAdClipId5,
        sAdClipId6,
        moSegments,
        sInitSegmentUrl,
      };
      m_Log.Here(
        `[Playlist] Segment list parsed TargetDuration=${nTargetDuration} SequenceNumber=${nSequenceNumber} EndOfList=${bEndOfList} SegmentCount=${moSegments.length} AdSegments=${kAdSegments}`
      );
      if (sAdType) {
        m_Log.Wow(
          `[Playlist] Advert found AdType=${sAdType} AdToken=${sAdToken.slice(
            -10
          )} Clips=${kAdClips} ClipNumber=${nAdClipNumber} ClipDuration=${nAdClipDuration} QuartileNumber=${nQuartileNumber} EndsWithAd=${thisListEndsWithAd(
            oSegmentList
          )}`
        );
      }
      m_Statistics.SegmentListParsed(oSegmentList);
      return oSegmentList;
    }
  }
  function reject(pCondition) {
    if (!pCondition) {
      throw new Error("REJECT");
    }
  }
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
      m_Twitch.sendAdTrackingData(null);
    }
  }
  let _sAppendedBroadcastId;
  let _nAppendedSessionId;
  let _sAppendedVariantId;
  let _nAppendedSequenceNumber;
  let _nAppendedTime;
  let _bAppendDiscontinuity;
  // URI of the #EXT-X-MAP whose initialisation segment the queue is currently on.
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
  function QueueSegments(
    oNewVariants,
    oNewSegments,
    oSelectedVariant
  ) {
    Check(
      !(
        _sAppendedBroadcastId !== oNewVariants.sBroadcastId &&
        _nAppendedSessionId === oNewVariants.nSessionId
      )
    );
    if (oNewSegments.bChaos) {
      _bAppendDiscontinuity = true;
      m_Statistics.SegmentsQueued(0, 0);
      return false;
    }
    let kSegmentsAdded = 0;
    let kSecondsAdded = 0;
    let nQueuedSegmentIndex = oNewSegments.moSegments.length;
    let kSegmentsToQueue =
      _sAppendedBroadcastId !== oNewVariants.sBroadcastId ? 1 : 3;
    let nSecondsToQueue = m_Settings.Get("nBufferSize");
    while (--nQueuedSegmentIndex > 0) {
      if (
        !oNewSegments.moSegments[nQueuedSegmentIndex].bAd &&
        oNewSegments.moSegments[nQueuedSegmentIndex].nDuration !==
        0
      ) {
        kSegmentsToQueue--;
        nSecondsToQueue -=
          oNewSegments.moSegments[nQueuedSegmentIndex].nDuration;
        if (kSegmentsToQueue <= 0 && nSecondsToQueue <= 0) {
          break;
        }
      }
    }
    if (_sAppendedBroadcastId !== oNewVariants.sBroadcastId) {
      m_Log.Wow(
        `[Playlist] BroadcastId changed ${_sAppendedBroadcastId} ==> ${oNewVariants.sBroadcastId}`
      );
      _nAppendedTime = -1;
      _bAppendDiscontinuity = true;
      for (
        let oSegmentBeingAdded;
        (oSegmentBeingAdded =
          oNewSegments.moSegments[nQueuedSegmentIndex]);
        nQueuedSegmentIndex++
      ) {
        queueSegment(
          oSegmentBeingAdded,
          oNewSegments.nSequenceNumber + nQueuedSegmentIndex
        );
      }
    } else if (_nAppendedSessionId !== oNewVariants.nSessionId) {
      m_Log.Wow(
        `[Playlist] SessionId changed ${_nAppendedSessionId} ==> ${oNewVariants.nSessionId}`
      );
      _bAppendDiscontinuity = true;
      for (
        let oSegmentBeingAdded;
        (oSegmentBeingAdded =
          oNewSegments.moSegments[nQueuedSegmentIndex]);
        nQueuedSegmentIndex++
      ) {
        if (oSegmentBeingAdded.nTime > _nAppendedTime) {
          queueSegment(
            oSegmentBeingAdded,
            oNewSegments.nSequenceNumber + nQueuedSegmentIndex
          );
        }
      }
    } else {
      if (_sAppendedVariantId !== oSelectedVariant.sIdentifier) {
        m_Log.Wow(
          `[Playlist] VariantId changed ${_sAppendedVariantId} ==> ${oSelectedVariant.sIdentifier}`
        );
        _bAppendDiscontinuity = true;
      }
      for (
        let oSegmentBeingAdded;
        (oSegmentBeingAdded =
          oNewSegments.moSegments[nQueuedSegmentIndex]);
        nQueuedSegmentIndex++
      ) {
        if (
          oNewSegments.nSequenceNumber + nQueuedSegmentIndex >
          _nAppendedSequenceNumber
        ) {
          queueSegment(
            oSegmentBeingAdded,
            oNewSegments.nSequenceNumber + nQueuedSegmentIndex
          );
        }
      }
    }
    m_Statistics.SegmentsQueued(
      kSegmentsAdded,
      kSecondsAdded
    );
    return kSegmentsAdded === 0;
    function queueSegment(oSegment, nSequenceNumber) {
      startBroadcast();
      if (oSegment.bAd) {
        m_Log.Here(
          `[Playlist] Not adding ad SequenceNumber=${nSequenceNumber}`
        );
        return;
      }
      if (oSegment.nDuration === 0) {
        m_Log.Oops(
          `[Playlist] Not adding segment SequenceNumber=${nSequenceNumber} Time=${oSegment.nTime} Duration=0`
        );
        return;
      }
      if (
        _nAppendedSessionId === oNewVariants.nSessionId &&
        _nAppendedSequenceNumber + 1 < nSequenceNumber
      ) {
        m_Log.Oops(
          `[Playlist] Segments skipped from ${_nAppendedSequenceNumber + 1
          } to ${nSequenceNumber - 1}`
        );
        m_Statistics.segmentsSkipped(
          nSequenceNumber - _nAppendedSequenceNumber - 1
        );
        _bAppendDiscontinuity = true;
      }
      // A different #EXT-X-MAP means a different moov box, so the new initialisation
      // segment has to reach the SourceBuffer before any media that depends on it.
      // The ad bypass switches between two fMP4 streams that each ship their own, and
      // that switch does not otherwise always raise a discontinuity: the two playlists
      // can select renditions with the same identifier. Appending media from one
      // encode against the other's moov is what leaves a black picture behind.
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
      // fMP4 segments carry their own initialisation segment and codec string, and
      // bypass the MPEG-TS transcoder entirely. See m_InitSegment.
      if (oNewSegments.sInitSegmentUrl) {
        oQueued.sInitSegmentUrl = oNewSegments.sInitSegmentUrl;
        oQueued.sCodecs = oSelectedVariant.sCodecs || "";
        oQueued.sResolution = oSelectedVariant.sResolution || "";
      }
      m_Log[oQueued.bDiscontinuity ? "Wow" : "Here"](
        `[Playlist] Segment added ${oQueued.nNumber} SequenceNumber=${nSequenceNumber} Time=${oSegment.nTime} Duration=${oQueued.nDuration} Discontinuity=${oQueued.bDiscontinuity}`
      );
      kSegmentsAdded++;
      kSecondsAdded += oQueued.nDuration;
      _sAppendedBroadcastId = oNewVariants.sBroadcastId;
      _nAppendedSessionId = oNewVariants.nSessionId;
      _sAppendedVariantId = oSelectedVariant.sIdentifier;
      _nAppendedSequenceNumber = nSequenceNumber;
      _sAddedInitSegmentUrl = oNewSegments.sInitSegmentUrl || "";
      if (!Number.isNaN(oSegment.nTime)) {
        _nAppendedTime = oSegment.nTime;
      }
      _bAppendDiscontinuity = false;
    }
  }
  function getSegmentListUpdateInterval(
    oSegmentList,
    bShortenedInterval
  ) {
    let kSegments = 0,
      nListDuration = 0;
    let nAvgSegmentDuration,
      nMinSegmentDuration = Infinity,
      nMaxSegmentDuration = -Infinity;
    for (const { bAd, nDuration } of oSegmentList.moSegments) {
      if (!bAd && nDuration > 0) {
        kSegments++;
        nListDuration += nDuration;
        nMinSegmentDuration = Math.min(
          nMinSegmentDuration,
          nDuration
        );
        nMaxSegmentDuration = Math.max(
          nMaxSegmentDuration,
          nDuration
        );
      }
    }
    if (kSegments !== 0) {
      nAvgSegmentDuration = nListDuration / kSegments;
      m_Log.Here(
        `[Playlist] SegmentsDuration=${m_Log.F2(
          nMinSegmentDuration
        )}<${m_Log.F2(nAvgSegmentDuration)}<${m_Log.F2(
          nMaxSegmentDuration
        )} ListDuration=${m_Log.F1(nListDuration)} DoNotLoad=${oSegmentList.moSegments.length - kSegments
        }`
      );
    } else {
      nAvgSegmentDuration =
        nMinSegmentDuration =
        nMaxSegmentDuration =
        Math.max(oSegmentList.nTargetDuration / 3, 1);
      m_Log.Oops(
        `[Playlist] Estimated segment duration ${m_Log.F1(
          nAvgSegmentDuration
        )}`
      );
    }
    return bShortenedInterval
      ? (nAvgSegmentDuration / 2) * 1e3
      : nAvgSegmentDuration * 1e3 - 16;
  }
  function getVariantListUpdateInterval() {
    Check(_nState === STATE_BROADCAST_END);
    if (_nVariantListUpdateInterval === -1) {
      _nVariantListUpdateInterval = 1e3;
    } else {
      _nVariantListUpdateInterval = Math.min(
        _nVariantListUpdateInterval + 1e3,
        3e4
      );
    }
    return _nVariantListUpdateInterval;
  }
  function startBroadcast() {
    if (_nState !== STATE_BROADCAST_START) {
      _nState = STATE_BROADCAST_START;
      g_maQueue.Add(
        new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_START)
      );
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
      g_maQueue.Add(
        new Segment(PROCESSING_DOWNLOADED, STATE_BROADCAST_END)
      );
      m_Events.SendEvent("playlist-broadcastvariantselected", [null, null]);
    }
    _oListsWithAds.clear();
    setAdState(false);
  }
  function ChangeBroadcastVariant(nSelectedVariant) {
    if (_oListsWithAds.oVariantList !== null) {
      _oListsWithAds.saveBroadcastVariant(
        _oListsWithAds.oVariantList.moVariants[nSelectedVariant]
      );
      _oListsWithAds.oSelectedVariant = null;
      if (_nState === STATE_BROADCAST_START) {
        _oListsWithAds.stop();
        _oListsWithAds.start();
        if (!_bAdInProgress) {
          clearAppendStatistics();
          g_maQueue.Add(
            new Segment(PROCESSING_DOWNLOADED, STATE_VARIANT_CHANGE)
          );
          m_Downloader.LoadNextSegment();
        }
      }
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
