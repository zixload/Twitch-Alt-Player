"use strict";
/*
	Everything the player says to Twitch, and everything it learns back.

	Who is watching and from which device, read from Twitch's own cookies. Which channel this is,
	and the address of its stream. The title, the game and the viewer count, refreshed every minute.
	Following and unfollowing, clips, the address of the recording at the current position, and the
	third-party chat extensions the content script may insert.

	Almost all of it goes through one door: Twitch's GraphQL endpoint, by sendGqlRequest. That door
	has two ways of saying no, and the rules for them are the part of this module most worth
	reading, because a mistake there crashes nothing. It surfaces days later as a player that stops
	on a channel that plays fine in the browser, or one that hammers the server.

    - "failed integrity check": the Client-Integrity token was refused. It is forgotten, and the
      request is sent again ONCE with a new one -- unless no token was asked for, or the refused
      one had just been obtained, in which case the answer is ACCESS_DENIED. If another tab has
      already replaced the refused token in the meantime, that one is used rather than capturing
      yet another. A refusal on the second attempt is final.
    - "service timeout": the server is busy. When the caller allows it, the request is sent again
      once, after five seconds plus up to half as much again, so that many players do not return
      at the same instant. Busy twice, the response is handed back with its errors.

	Any other error is handed back as it came.

	The integrity token itself cannot be computed here. The page Twitch serves computes it. So a
	hidden frame is pointed at a Twitch page, where gql_injection.js catches the token Twitch's own
	code obtains and writes it to a cookie; the cookie change is what wakes the waiting request.
	After thirty seconds without one, the answer is ACCESS_DENIED.

	The address of the main stream is kept for fifteen minutes, the lifetime of the playback token
	inside it. The ad-free stream, requested under another player type, is never kept.

	Three functions further down are not part of this rewrite; the comment above them says why.
*/
const m_Twitch = (() => {
  const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
  const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
  const INTEGRITY_REFUSED = "failed integrity check";
  const SERVER_BUSY = "service timeout";
  const RESEND_AFTER = 5e3;
  const GQL_TOKEN_WAIT = 3e4;
  const GQL_TOKEN_COOKIE = "tw5~gqltoken";
  const COOKIE_STORE = "https://www.twitch.tv/tw5~storage/";
  const STREAM_TOKEN_LIFETIME = 15 * 60 * 1e3;
  const BROADCAST_METADATA_INTERVAL = 6e4;
  const VIEW_TRACKING_INTERVAL = 6e4;
  const MISSING_AVATAR = "player.svg#svg-missingavatar";

  // How a cookie reached parseCookie: read once at start, written later, or removed later.
  const COOKIE_READ_AT_START = 1;
  const COOKIE_WRITTEN = 2;
  const COOKIE_REMOVED = 3;

  let _sChannelLogin = "";
  let _sChannelId = "";

  // The broadcast being watched. Both are forgotten when it ends.
  let _sBroadcastId = "";
  let _sRecordingUrl = "";
  // L'identifiant du VOD que Twitch enregistre du direct en cours, quand la chaine garde ses VODs.
  // Il sert a rejouer la diffusion depuis son vrai debut dans le lecteur (m_Videos).
  let _sRecordingId = "";
  // L'heure a laquelle la diffusion a commence, telle que Twitch l'annonce. C'est elle qui donne
  // une position dans la diffusion, quel que soit le format du flux.
  let _nBroadcastStart = NaN;

  let _sViewerId = "";
  let _sViewerLogin = "";
  let _sViewerToken = "";
  let _sViewerName = "";
  let _sDeviceId = "";

  let _sGqlToken = "";
  let _nGqlTokenExpiresAfter = 0;
  // While a capture frame is out: the promise every waiting request shares, and what the cookie
  // listener calls when a token arrives.
  let _oGqlTokenPromise = null;
  let _fGqlTokenArrived = null;

  let _sStreamUrl = "";
  let _nStreamUrlExpiresAfter = -1;

  let _sViewTrackingUrl = "https://spade.twitch.tv/track";
  let _nViewTrackingTimer = 0;
  let _oMetadataUpdateCancel = null;

  // --- Addresses ---

  function GetChannelUrl(bDoNotRedirect) {
    const sUrl = `https://www.twitch.tv/${encodeURIComponent(_sChannelLogin)}`;
    return bDoNotRedirect ? `${sUrl}?${DO_NOT_REDIRECT_ADDRESS}` : sUrl;
  }

  function getChatPanelUrl() {
    const sChannel = encodeURIComponent(_sChannelLogin);
    if (m_Settings.Get("bFullChat")) {
      return `https://www.twitch.tv/popout/${sChannel}/chat?no-mobile-redirect=true&popout=`;
    }
    const sDim = m_Settings.Get("bDimChat") ? "darkpopout&" : "";
    return `https://www.twitch.tv/embed/${sChannel}/chat?${sDim}parent=localhost`;
  }

  function getRecordingUrl(sRecordingId) {
    Check(IsNonEmptyString(sRecordingId));
    return `https://www.twitch.tv/videos/${encodeURIComponent(sRecordingId)}`;
  }

  function getCategoryUrl(sCategoryName) {
    Check(IsNonEmptyString(sCategoryName));
    return `https://www.twitch.tv/directory/category/${encodeURIComponent(sCategoryName)}`;
  }

  function getTeamUrl(sTeamName) {
    Check(IsNonEmptyString(sTeamName));
    return `https://www.twitch.tv/team/${encodeURIComponent(sTeamName)}`;
  }

  // The only hosts the downloader may fetch from. Anything else is a bug or an attack.
  function checkUrlAvailability(sAddress) {
    if (!/^https?:\/\/(?:[^/]+\.)?(?:twitch\.tv|twitchcdn\.net|ttvnw\.net|jtvnw\.net|live-video\.net|akamaized\.net|cloudfront\.net)\//.test(sAddress)) {
      throw new Error(`Unknown address: ${sAddress}`);
    }
  }

  function createUniqueIdentifier(kLength) {
    Check(Number.isInteger(kLength) && kLength > 0);
    const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let sResult = "";
    while (sResult.length !== kLength) {
      sResult += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return sResult;
  }

  // --- The integrity token ---

  function captureGqlToken() {
    if (_oGqlTokenPromise === null) {
      _oGqlTokenPromise = new Promise((fResolve, fReject) => {
        m_Log.Wow("[Twitch] Inserting frame to capture the GQL token");
        const elFrame = document.createElement("iframe");
        elFrame.src = "https://www.twitch.tv/popout/";
        elFrame.id = "gqltoken";
        elFrame.hidden = true;
        Check(!document.getElementById(elFrame.id));
        document.body.appendChild(elFrame);
        const nTimer = setTimeout(
          AddExceptionHandler(() => {
            m_Log.Oops("[Twitch] GQL token wait timed out");
            elFrame.remove();
            _oGqlTokenPromise = _fGqlTokenArrived = null;
            fReject("ACCESS_DENIED");
          }),
          GQL_TOKEN_WAIT
        );
        _fGqlTokenArrived = () => {
          if (_sGqlToken !== "") {
            clearTimeout(nTimer);
            elFrame.remove();
            _oGqlTokenPromise = _fGqlTokenArrived = null;
            fResolve(_sGqlToken);
          }
        };
      });
    }
    return _oGqlTokenPromise;
  }

  function clearGqlToken() {
    _sGqlToken = "";
    deleteCookie(GQL_TOKEN_COOKIE, COOKIE_STORE).catch(m_Debug.CaughtException);
  }

  // --- The GraphQL door ---

  function classifyErrors(oResult) {
    if (!oResult.errors) {
      return "";
    }
    const hasError = (sMessage) => oResult.errors.some(({ message }) => message === sMessage);
    return hasError(INTEGRITY_REFUSED) ? INTEGRITY_REFUSED : hasError(SERVER_BUSY) ? SERVER_BUSY : "unknown";
  }

  function logUnresolvedError(sError) {
    m_Log.Oops(sError === SERVER_BUSY ? "[Twitch] GQL server busy" : "[Twitch] GQL response contains unknown errors");
  }

  /*
    oVariables === null means sQuery is already a complete request body -- a batch built with
    combineGqlRequests, for instance. The positional signature is kept as it was: the three
    unrewritten functions below call it this way.
  */
  function sendGqlRequest(
    oPromiseCancellation,
    sQuery,
    oVariables,
    bSendViewerToken,
    bSendGqlToken,
    bRetryRequest,
    sDownloadName,
    nDownloadNoLongerThan = LOAD_METADATA_NO_LONGER_THAN
  ) {
    Check(IsNonEmptyString(_sDeviceId));
    const sBody = oVariables === null ? sQuery : createGqlRequestBody(sQuery, oVariables);
    const oHeaders = {
      "Accept-Language": "en-US",
      "Client-ID": CLIENT_ID,
      "Content-Type": "text/plain; charset=UTF-8",
      "X-Device-ID": _sDeviceId,
    };
    if (bSendViewerToken && _sViewerToken) {
      oHeaders.Authorization = `OAuth ${_sViewerToken}`;
    }
    const useToken = (sToken) => {
      oHeaders["Client-Integrity"] = sToken;
    };
    const post = () => m_Downloader.Load(
      oPromiseCancellation, "POST", GQL_ENDPOINT, nDownloadNoLongerThan, oHeaders, sBody, sDownloadName, true, "json"
    );
    // The refused token is forgotten only if it is still the one held: another tab may have
    // replaced it while the request was out.
    const forgetRefusedToken = () => {
      m_Log.Oops("[Twitch] Server rejected the GQL token");
      if (_sGqlToken !== "" && oHeaders["Client-Integrity"] === _sGqlToken) {
        clearGqlToken();
      }
    };
    const settleSecondAttempt = (oResult) => {
      const sError = classifyErrors(oResult);
      if (sError === INTEGRITY_REFUSED) {
        forgetRefusedToken();
        throw "ACCESS_DENIED";
      }
      if (sError !== "") {
        logUnresolvedError(sError);
      }
      return oResult;
    };

    let bFreshToken = false;
    let oReady = Promise.resolve();
    if (bSendGqlToken) {
      if (_sGqlToken !== "" && _nGqlTokenExpiresAfter > Date.now()) {
        m_Log.Here(`[Twitch] GQL token expires in ${m_Log.F0((_nGqlTokenExpiresAfter - Date.now()) / 1e3)}s`);
        useToken(_sGqlToken);
      } else {
        bFreshToken = true;
        oReady = captureGqlToken().then(useToken);
      }
    }

    return oReady.then(post).then((oResult) => {
      const sError = classifyErrors(oResult);
      if (sError === "") {
        return oResult;
      }
      if (sError === INTEGRITY_REFUSED) {
        forgetRefusedToken();
        if (!bSendGqlToken || bFreshToken) {
          throw "ACCESS_DENIED";
        }
        const oNewToken = _sGqlToken !== "" && oHeaders["Client-Integrity"] !== _sGqlToken
          ? Promise.resolve(useToken(_sGqlToken))
          : captureGqlToken().then(useToken);
        return oNewToken.then(post).then(settleSecondAttempt);
      }
      if (sError === SERVER_BUSY && bRetryRequest) {
        const nAfter = RESEND_AFTER + (RESEND_AFTER / 2) * Math.random();
        m_Log.Oops(`[Twitch] GQL server busy. Request will be resent in ${nAfter.toFixed()}ms`);
        return Wait(oPromiseCancellation, nAfter).then(post).then(settleSecondAttempt);
      }
      logUnresolvedError(sError);
      return oResult;
    });
  }

  // --- Following ---

  function ChangeViewerChannelSubscription(nSubscription) {
    Check(_sChannelId && _sViewerId && _sViewerToken);
    Check(_sChannelId !== _sViewerId);
    switch (nSubscription) {
      case SUBSCRIPTION_NOT_SUBSCRIBED:
        sendSubscriptionChange(
          "unfollow",
          `mutation($input: UnfollowUserInput!) {
            unfollowUser(input: $input) {
              __typename
            }
          }`,
          { targetID: _sChannelId },
          (oData) => Boolean(chain(oData, "unfollowUser")),
          nSubscription
        );
        break;

      case SUBSCRIPTION_DO_NOT_NOTIFY:
      case SUBSCRIPTION_NOTIFY:
        sendSubscriptionChange(
          "follow",
          `mutation($input: FollowUserInput!) {
            followUser(input: $input) {
              error {
                code
              }
              follow {
                user {
                  id
                }
              }
            }
          }`,
          { disableNotifications: nSubscription === SUBSCRIPTION_DO_NOT_NOTIFY, targetID: _sChannelId },
          (oData) => Boolean(chain(oData, "followUser", "follow", "user")) && !chain(oData, "followUser", "error"),
          nSubscription
        );
        break;

      default:
        Check(false);
    }
  }

  // Whatever the outcome, the interface is told the subscription state it should now show.
  function sendSubscriptionChange(sAction, sMutation, oInput, fSucceeded, nSubscription) {
    sendGqlRequest(null, sMutation, { input: oInput }, true, true, true, `${sAction} channel`)
      .then((oResult) => {
        if (oResult.errors || !fSucceeded(oResult.data)) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-viewermetadatareceived", { nSubscription });
      })
      .catch((pReason) => {
        if (typeof pReason != "string") {
          m_Debug.CaughtException(pReason);
          return;
        }
        m_Log.Oops(`[Twitch] Could not ${sAction} channel. ${pReason}`);
        m_Notification.ShowAss();
        m_Events.SendEvent("twitch-viewermetadatareceived", { nSubscription: SUBSCRIPTION_UNAVAILABLE });
      });
  }

  // --- Ads ---

  // Content segments are unnamed or named "live"; every other name marks an ad.
  function isAdSegment(sSegmentName) {
    return sSegmentName !== "" && sSegmentName !== "live";
  }

  /*
    Carried over unchanged from the original player, by decision, and not part of this rewrite.
    After each ad break the player skipped, these report an impression and a completed viewing of
    that ad to Twitch. Everything between this comment and the next one is the original text.
  */
  let _oPendingToSend = null;
  function sendAdTrackingData(oSegmentList) {
    if (
      _oPendingToSend !== null &&
      (oSegmentList === null ||
        _oPendingToSend.sAdToken !== oSegmentList.sAdToken)
    ) {
      sendAdPodImpression(_oPendingToSend);
      _oPendingToSend = null;
    }
    if (
      _oPendingToSend === null &&
      oSegmentList !== null &&
      oSegmentList.sAdType
    ) {
      _oPendingToSend = oSegmentList;
    }
  }
  function sendAdPodImpression(oSegmentList) {
    Wait(null, 3e3)
      .then(() => {
        return sendGqlRequest(
          null,
          combineGqlRequests([
            createAdEvent("video_ad_impression", oSegmentList),
            createAdEvent(
              "video_ad_quartile_complete",
              oSegmentList,
              1
            ),
            createAdEvent(
              "video_ad_quartile_complete",
              oSegmentList,
              2
            ),
            createAdEvent(
              "video_ad_quartile_complete",
              oSegmentList,
              3
            ),
            createAdEvent(
              "video_ad_quartile_complete",
              oSegmentList,
              4
            ),
            createAdEvent("video_ad_pod_complete", oSegmentList),
          ]),
          null,
          true,
          false,
          false,
          `${oSegmentList.sAdType
          } ${oSegmentList.sAdToken.slice(-10)}`,
          3e4
        );
      })
      .then((moResults) => {
        for (const oResult of moResults) {
          if (
            oResult.errors ||
            !oResult.data ||
            !oResult.data.recordAdEvent ||
            oResult.data.recordAdEvent.error
          ) {
            throw `Server could not complete the operation: ${m_Log.O(
              oResult
            )}`;
          }
        }
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Oops(
            `[Twitch] Could not send ad tracking data. ${pReason}`
          );
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function createAdEvent(
    sEventName,
    oSegmentList,
    nQuartileNumber
  ) {
    const oDetails = {
      stitched: true,
      player_mute: true,
      player_volume: 0.5,
      visible: true,
      roll_type: oSegmentList.sAdType.toLowerCase(),
    };
    switch (sEventName) {
      case "video_ad_quartile_complete":
        oDetails.quartile = nQuartileNumber;

      case "video_ad_impression":
        oDetails.total_ads = oSegmentList.kAdClips;
        oDetails.ad_position = oSegmentList.nAdClipNumber + 1;
        oDetails.duration = Math.round(
          oSegmentList.nAdClipDuration
        );
        oDetails.ad_id = oSegmentList.sAdClipId1;
        oDetails.creative_id = oSegmentList.sAdClipId2;
        oDetails.line_item_id = oSegmentList.sAdClipId3;
        oDetails.order_id = oSegmentList.sAdClipId4;
        break;

      case "video_ad_pod_complete":
        oDetails.ad_session_id = oSegmentList.sAdClipId5;
        oDetails.format_name = oSegmentList.sAdClipId6;
        break;

      default:
        Check(false);
    }
    return createGqlRequestBody(
      `mutation($input: RecordAdEventInput!) {
				recordAdEvent(input: $input) {
					error {
						code
					}
				}
			}`,
      {
        input: {
          eventName: sEventName,
          eventPayload: JSON.stringify(oDetails),
          radToken: oSegmentList.sAdToken,
        },
      }
    );
  }
  /*
    End of the unchanged part.
  */

  // --- The stream address ---

  function GetAbsoluteVariantListUrl(oPromiseCancellation, bWithoutHttps, bWithoutAds) {
    if (!bWithoutAds) {
      const nLeft = _nStreamUrlExpiresAfter - performance.now();
      if (nLeft > 0) {
        m_Log.Here(`[Twitch] Time left before the broadcast token expires: ${m_Log.F0(nLeft / 1e3)}s`);
        return Promise.resolve(_sStreamUrl);
      }
    }
    return sendGqlRequest(
      oPromiseCancellation,
      `query(
        $login: String!
        $playerType: String!
        $disableHTTPS: Boolean!
      ) {
        streamPlaybackAccessToken(
          channelName: $login
          params: {
            disableHTTPS: $disableHTTPS
            playerType: $playerType
            platform: "web"
            playerBackend: "mediaplayer"
          }
        ) {
          value
          signature
        }
      }`,
      {
        login: _sChannelLogin,
        // Twitch serves this player type without ads: it is the source of the ad-free stream.
        playerType: bWithoutAds ? "picture-by-picture" : "site",
        disableHTTPS: bWithoutHttps,
      },
      true,
      false,
      true,
      `broadcast token ${+bWithoutAds}`
    ).then((oResult) => {
      const sToken = chain(oResult.data, "streamPlaybackAccessToken", "value");
      const sSignature = chain(oResult.data, "streamPlaybackAccessToken", "signature");
      m_Debug.saveBroadcastToken(`DeviceId=${_sDeviceId} ViewerToken=${Boolean(_sViewerToken)}\n${sToken}`, bWithoutAds);
      if (!IsNonEmptyString(sToken) || !IsNonEmptyString(sSignature)) {
        if (oResult.errors) {
          throw "Server could not complete the operation";
        }
        // No token and no error: there is no such channel.
        m_Debug.FinishWorkAndShowMessage("J0203");
      }
      const oToken = JSON.parse(sToken);
      Check(oToken.channel === _sChannelLogin);
      if (oToken.ci_gb) {
        m_Debug.FinishWorkAndShowMessage("J0217");
      }
      // The first token is where the channel's identifier is learnt, and the channel metadata
      // cannot be asked for before it.
      if (_sChannelId === "") {
        Check(oToken.channel_id);
        _sChannelId = String(oToken.channel_id);
        setTimeout(AddExceptionHandler(updateViewerAndChannelMetadata));
      } else {
        Check(_sChannelId === String(oToken.channel_id));
      }
      const asParameters = [
        "allow_source=true",
        "allow_audio_only=true",
        "cdm=wv",
        "fast_bread=true",
        "platform=web",
        "player_backend=mediaplayer",
        "playlist_include_framerate=true",
        "reassignments_supported=true",
        "supported_codecs=h264",
        "transcode_mode=cbr_v1",
        `p=${Math.floor(Math.random() * 9999999)}`,
        `token=${encodeURIComponent(sToken)}`,
        `sig=${encodeURIComponent(sSignature)}`,
      ];
      if (!bWithoutAds) {
        asParameters.push(`play_session_id=${createUniqueIdentifier(32)}`);
      }
      const sScheme = bWithoutHttps ? "http" : "https";
      const sAddress = `${sScheme}://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(_sChannelLogin)}.m3u8?${asParameters.join("&")}`;
      if (!bWithoutAds) {
        _sStreamUrl = sAddress;
        _nStreamUrlExpiresAfter = performance.now() + STREAM_TOKEN_LIFETIME;
      }
      return sAddress;
    });
  }

  /*
    Despite its name, sorts nothing: it notes the view-tracking address a variant list may carry
    and hands the list back. The name goes when m_Playlist, its only caller, is rewritten.
  */
  /*
    Twitch ne sert plus ses variantes dans un ordre fixe : d'une requete a l'autre la meme liste
    arrive tournee, tantot la source en tete, tantot le 360p. Or tout ce qui suit suppose un debit
    decroissant -- le choix par defaut prend « la premiere sous le debit garde », le repli sur un
    nom connu prend la premiere, et le menu de qualite s'affiche dans cet ordre. Sans ce tri, un
    nouveau spectateur recevait une qualite tiree au sort, et le menu changeait d'ordre a chaque
    ouverture.

    Le tri est stable : a debit egal, l'ordre du serveur est garde. Une variante sans debit lu
    passe en dernier plutot que de rendre la comparaison incoherente.
  */
  function sortVariantList(oVariantList) {
    if (oVariantList.sViewTrackingUrl) {
      _sViewTrackingUrl = oVariantList.sViewTrackingUrl;
    }
    if (Array.isArray(oVariantList.moVariants)) {
      oVariantList.moVariants.sort(
        (oA, oB) => (oB.nBitrate || 0) - (oA.nBitrate || 0)
      );
    }
    return oVariantList;
  }

  // --- Cookies: who is watching, from which device ---

  function parseViewerCookie(sCookie) {
    if (sCookie) {
      try {
        const o = JSON.parse(decodeURIComponent(sCookie));
        Check(IsObject(o) && IsNonEmptyString(o.id) && IsNonEmptyString(o.login) && IsNonEmptyString(o.authToken));
        return o;
      } catch (_) { }
      m_Log.Oops(`[Twitch] Could not parse the auth cookie: ${sCookie}`);
    }
    return { id: "", login: "", authToken: "", displayName: "" };
  }

  function parseGqlTokenCookie(sCookie) {
    if (sCookie) {
      try {
        const o = JSON.parse(decodeURIComponent(sCookie));
        Check(IsNonEmptyString(o.sToken) && Number.isSafeInteger(o.nExpiresAfter));
        return [o.sToken, o.nExpiresAfter];
      } catch (_) {
        m_Log.Oops(`[Twitch] Could not parse the GQL token cookie: ${sCookie}`);
      }
    }
    return ["", 0];
  }

  function parseCookie(nHow, { name, domain, path, value }) {
    if (nHow === COOKIE_REMOVED || typeof value != "string") {
      value = "";
    }
    switch (name) {
      case "twilight-user": {
        if (domain !== ".twitch.tv" || path !== "/") {
          break;
        }
        const { id, login, authToken, displayName } = parseViewerCookie(value);
        // Someone else logging in, or logging out, mid-session: everything learnt so far about
        // the viewer is wrong, and the player stops rather than carry on under the wrong account.
        if (nHow !== COOKIE_READ_AT_START && (_sViewerId !== id || _sViewerLogin !== login || _sViewerToken !== authToken)) {
          m_Debug.FinishWorkAndShowMessage("J0222");
        }
        _sViewerId = id;
        _sViewerLogin = login;
        _sViewerToken = authToken;
        _sViewerName = IsNonEmptyString(displayName) ? displayName : login;
        break;
      }

      case "unique_id":
        // Read once. A device identifier that changed mid-session would split one viewer in two.
        if (domain === ".twitch.tv" && path === "/" && nHow === COOKIE_READ_AT_START && _sDeviceId === "") {
          _sDeviceId = value;
        }
        break;

      case GQL_TOKEN_COOKIE:
        if (domain === "www.twitch.tv" && path === "/tw5~storage/") {
          [_sGqlToken, _nGqlTokenExpiresAfter] = parseGqlTokenCookie(value);
          if (_fGqlTokenArrived) {
            _fGqlTokenArrived();
          }
        }
    }
  }

  function start(sChannelCode) {
    Check(IsNonEmptyString(sChannelCode));
    _sChannelLogin = sChannelCode;
    return getAllCookies(COOKIE_STORE).then((maCookies) => {
      for (const oCookie of maCookies) {
        parseCookie(COOKIE_READ_AT_START, oCookie);
      }
      if (_sDeviceId === "") {
        m_Log.Oops("[Twitch] Device identifier not found");
        _sDeviceId = "0000000000000000" + (m_Settings.Get("nRandomNumber") || 0.1).toFixed(16).slice(2);
      }
      chrome.cookies.onChanged.addListener(
        AddExceptionHandler(({ removed, cause, cookie }) => {
          // An overwrite is reported as a removal followed by a write: only the write counts.
          if (!(removed && cause === "overwrite")) {
            parseCookie(removed ? COOKIE_REMOVED : COOKIE_WRITTEN, cookie);
          }
        })
      );
    });
  }

  // --- Channel and viewer metadata ---

  function subscriptionOf(oSelf) {
    if (!chain(oSelf, "canFollow")) {
      return SUBSCRIPTION_UNAVAILABLE;
    }
    if (!oSelf.follower) {
      return SUBSCRIPTION_NOT_SUBSCRIBED;
    }
    return oSelf.follower.disableNotifications ? SUBSCRIPTION_DO_NOT_NOTIFY : SUBSCRIPTION_NOTIFY;
  }

  function updateViewerAndChannelMetadata() {
    Check(_sChannelId);
    sendGqlRequest(
      null,
      `query($login: String!, $skip: Boolean!) {
        user(login: $login) {
          broadcastSettings {
            language
          }
          createdAt
          description
          displayName
          followers {
            totalCount
          }
          id
          lastBroadcast {
            startedAt
          }
          primaryTeam {
            displayName
            name
          }
          profileImageURL(width: 70)
          self @skip(if: $skip) {
            canFollow
            follower {
              disableNotifications
            }
          }
        }
      }`,
      {
        login: _sChannelLogin,
        // On one's own channel there is nothing to follow.
        skip: _sChannelLogin === _sViewerLogin,
      },
      true,
      false,
      true,
      "channel metadata"
    )
      .then((oResult) => {
        if (!oResult.data) {
          throw "Server response contains no metadata";
        }
        const oUser = oResult.data.user;
        if (!oUser) {
          m_Debug.FinishWorkAndShowMessage("J0203");
        }
        Check(oUser.id === _sChannelId);
        const sLanguageCode = chain(oUser.broadcastSettings, "language");
        const moTeams = [];
        if (oUser.primaryTeam) {
          moTeams.push({
            sAddress: getTeamUrl(oUser.primaryTeam.name),
            sName: oUser.primaryTeam.displayName || oUser.primaryTeam.name,
          });
        }
        m_Events.SendEvent("twitch-channelmetadatareceived", {
          sName: oUser.displayName || _sChannelLogin,
          sAvatar: oUser.profileImageURL || MISSING_AVATAR,
          sDescription: oUser.description,
          sLanguageCode: sLanguageCode && sLanguageCode !== "OTHER" ? sLanguageCode : null,
          kSubscribers: chain(oUser.followers, "totalCount"),
          nChannelCreated: Date.parse(oUser.createdAt),
          moTeams,
        });
        m_Events.SendEvent("twitch-viewermetadatareceived", {
          sName: _sViewerName,
          nSubscription: subscriptionOf(oUser.self),
        });
      })
      .catch((pReason) => {
        if (typeof pReason != "string") {
          m_Debug.CaughtException(pReason);
          return;
        }
        m_Log.Oops(`[Twitch] Could not get channel metadata. ${pReason}`);
        m_Events.SendEvent("twitch-channelmetadatareceived", {
          sName: _sChannelLogin,
          sAvatar: MISSING_AVATAR,
          sLanguageCode: null,
          kSubscribers: null,
          nChannelCreated: null,
        });
        m_Events.SendEvent("twitch-viewermetadatareceived", {
          sName: _sViewerName,
          nSubscription: SUBSCRIPTION_UNAVAILABLE,
        });
      });
  }

  // --- Broadcast metadata and view tracking ---

  /*
    One link of a chain that reschedules itself: every minute after a success, every half-minute
    after a failure, until FinishCollectingBroadcastMetadata cancels it.
  */
  function updateBroadcastMetadata(oPromiseCancellation, nAfter) {
    Check(_sChannelId);
    m_Log.Here(`[Twitch] Broadcast metadata loading will start in ${m_Log.F0(nAfter)}ms`);
    Wait(oPromiseCancellation, nAfter)
      .then(() => sendGqlRequest(
        oPromiseCancellation,
        `query($id: ID!, $all: Boolean!) {
          user(id: $id) {
            broadcastSettings {
              game {
                displayName
                slug
              }
              title
            }
            login
            stream {
              archiveVideo @include(if: $all) {
                id
              }
              createdAt
              id
              type
              viewersCount
            }
          }
        }`,
        {
          id: _sChannelId,
          // The recording is asked for only until the broadcast is known.
          all: _sBroadcastId === "",
        },
        false,
        false,
        true,
        "broadcast metadata"
      ))
      .then((oResult) => {
        const oUser = chain(oResult.data, "user");
        const sLogin = chain(oUser, "login");
        // The channel was renamed: reload under the new name, and let that page carry on.
        if (sLogin !== _sChannelLogin && IsNonEmptyString(sLogin)) {
          m_Log.Oops(`[Twitch] New channel code ${sLogin}`);
          location.replace(`?channel=${encodeURIComponent(sLogin)}`);
          return;
        }
        const oMetadata = {
          kViewers: chain(oUser, "stream", "viewersCount"),
        };
        const sBroadcastId = chain(oUser, "stream", "id");
        if (_sBroadcastId === "" && IsNonEmptyString(sBroadcastId)) {
          m_Log.Wow(`[Twitch] Broadcast identifier ${sBroadcastId}`);
          _sBroadcastId = sBroadcastId;
          startViewTracking();
          const sRecordingId = chain(oUser, "stream", "archiveVideo", "id");
          _sRecordingId = IsNonEmptyString(sRecordingId) ? sRecordingId : "";
          _sRecordingUrl = _sRecordingId ? getRecordingUrl(_sRecordingId) : "";
          const sType = chain(oUser, "stream", "type");
          oMetadata.sBroadcastType = sType === "live" ? "live" : sType === "rerun" ? "replay" : null;
        }
        // A different broadcast id means the one being watched has been replaced; its title and
        // duration would describe something else.
        if (_sBroadcastId === "" || _sBroadcastId === sBroadcastId) {
          const sTitle = chain(oUser, "broadcastSettings", "title");
          if (typeof sTitle == "string") {
            oMetadata.sBroadcastTitle = sTitle.trim() || GetText("J0103");
          }
          oMetadata.sGameName = chain(oUser, "broadcastSettings", "game", "displayName");
          const sGameSlug = chain(oUser, "broadcastSettings", "game", "slug");
          if (sGameSlug) {
            oMetadata.sGameUrl = getCategoryUrl(sGameSlug);
          }
          _nBroadcastStart = Date.parse(chain(oUser, "stream", "createdAt"));
          oMetadata.nBroadcastDuration = performance.now() + g_nExactTime - _nBroadcastStart;
        }
        m_Events.SendEvent("twitch-broadcastmetadatareceived", oMetadata);
        updateBroadcastMetadata(oPromiseCancellation, BROADCAST_METADATA_INTERVAL);
      })
      .catch(
        AddExceptionHandler((pReason) => {
          if (typeof pReason == "string") {
            m_Log.Oops(`[Twitch] Could not load broadcast metadata. ${pReason}`);
            updateBroadcastMetadata(oPromiseCancellation, BROADCAST_METADATA_INTERVAL / 2);
          } else if (pReason === PromiseCancellation.REASON) {
            m_Log.Here("[Twitch] Broadcast metadata update cancelled");
          } else {
            throw pReason;
          }
        })
      );
  }

  function StartCollectingBroadcastMetadata() {
    _sBroadcastId = _sRecordingUrl = _sRecordingId = "";
    Check(!_oMetadataUpdateCancel);
    _oMetadataUpdateCancel = new PromiseCancellation();
    updateBroadcastMetadata(_oMetadataUpdateCancel, 0);
  }

  // A pause keeps the broadcast known, so a clip can still be made; an end forgets it.
  function FinishCollectingBroadcastMetadata(bBroadcastEnded) {
    if (bBroadcastEnded) {
      _nBroadcastStart = NaN;
      _sBroadcastId = _sRecordingUrl = _sRecordingId = "";
    }
    if (_oMetadataUpdateCancel) {
      m_Log.Here(`[Twitch] Cancelling broadcast metadata update chain BroadcastEnded=${bBroadcastEnded}`);
      _oMetadataUpdateCancel.Cancel();
      _oMetadataUpdateCancel = null;
    }
    stopViewTracking();
  }

  // A real viewing, reported: one "minute watched" per minute, for a logged-in viewer only.
  const sendViewTrackingData = AddExceptionHandler(() => {
    Check(_sBroadcastId && _sChannelId && _sViewerId);
    const oToSend = new URLSearchParams();
    oToSend.set("data", btoa(JSON.stringify([{
      event: "minute-watched",
      properties: {
        broadcast_id: _sBroadcastId,
        channel_id: _sChannelId,
        user_id: Number(_sViewerId),
        player: "site",
      },
    }])));
    m_Downloader
      .Load(null, "POST", _sViewTrackingUrl, LOAD_METADATA_NO_LONGER_THAN, null, oToSend, "view tracking", false, "none")
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Oops(`[Twitch] Could not send view tracking data. ${pReason}`);
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  });

  function startViewTracking() {
    if (_sViewerId === "") {
      return;
    }
    m_Log.Here("[Twitch] Starting view tracking");
    Check(_nViewTrackingTimer === 0);
    _nViewTrackingTimer = setInterval(() => {
      sendViewTrackingData();
      claimBonusChest();
    }, VIEW_TRACKING_INTERVAL);
    sendViewTrackingData();
    claimBonusChest();
  }

  // --- Channel points ---

  /*
    Watching earns channel points, and every so often a bonus chest appears. On twitch.tv it sits in
    the chat and waits for a click (autoclaim.js clicks it there). In this player the chat may be
    closed, or the embedded kind that has no chest at all, so the chest is claimed through GraphQL
    instead: once a minute, alongside the minute-watched report, for as long as a logged-in viewer
    watches someone else's live broadcast. A refusal is logged and never shown: the viewer did not
    ask for anything.
  */
  let _bClaimCheckInProgress = false;

  const claimBonusChest = AddExceptionHandler(() => {
    if (_bClaimCheckInProgress || _sViewerId === "" || _sViewerId === _sChannelId) {
      return;
    }
    _bClaimCheckInProgress = true;
    sendGqlRequest(null, `query($login: String!) {
        user(login: $login) {
          channel {
            self {
              communityPoints {
                availableClaim {
                  id
                }
              }
            }
          }
        }
      }`, { login: _sChannelLogin }, true, false, false, "channel points")
      .then((oResult) => {
        const sClaimId = chain(oResult, "data", "user", "channel", "self", "communityPoints", "availableClaim", "id");
        if (!IsNonEmptyString(sClaimId)) {
          return;
        }
        m_Log.Wow(`[Twitch] Bonus chest available ClaimId=${sClaimId}`);
        return sendGqlRequest(null, `mutation($input: ClaimCommunityPointsInput!) {
            claimCommunityPoints(input: $input) {
              claim {
                id
              }
              currentPoints
              error {
                code
              }
            }
          }`, { input: { channelID: _sChannelId, claimID: sClaimId } }, true, true, true, "claim channel points")
          .then((oClaim) => {
            const sError = chain(oClaim, "data", "claimCommunityPoints", "error", "code");
            if (oClaim.errors || sError || !chain(oClaim, "data", "claimCommunityPoints", "claim")) {
              throw `Server refused the claim ${sError || JSON.stringify(oClaim.errors || null)}`;
            }
            m_Log.Wow(`[Twitch] Bonus chest claimed CurrentPoints=${chain(oClaim, "data", "claimCommunityPoints", "currentPoints")}`);
          });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Oops(`[Twitch] Could not claim the bonus chest. ${pReason}`);
        } else {
          m_Debug.CaughtException(pReason);
        }
      })
      .finally(() => {
        _bClaimCheckInProgress = false;
      });
  });

  function stopViewTracking() {
    if (_nViewTrackingTimer !== 0) {
      m_Log.Here("[Twitch] Stopping view tracking");
      clearInterval(_nViewTrackingTimer);
      _nViewTrackingTimer = 0;
    }
  }

  // --- Recording and clips ---

  // L'identifiant du VOD en cours du direct, ou "" si la chaine ne garde pas ses VODs. m_Videos s'en
  // sert pour rejouer la diffusion depuis le debut dans le lecteur.
  /*
    Ou en est le spectateur dans la diffusion, en secondes depuis son debut.

    Le lecteur le deduisait d'un decalage lu dans les segments MPEG-TS, stream_offset. Deux ennuis :
    sur les chaines servies en fMP4 le convertisseur n'est pas sur le chemin, le decalage n'existe
    pas, et l'adresse de l'enregistrement partait sans position du tout ; sur les autres, il
    annoncait deux secondes pour une diffusion de quatre heures.

    On part donc de l'heure de debut annoncee par Twitch -- deja connue, elle sert a afficher la
    duree -- moins le retard du spectateur sur le bord. Vrai quel que soit le conteneur.

    Hors direct, ou tant que la diffusion n'est pas connue, l'ancien calcul reste le seul possible.
  */
  // Depuis combien de secondes la diffusion dure, ou NaN tant qu'on ne la connait pas.
  function GetBroadcastElapsed() {
    return Number.isNaN(_nBroadcastStart)
      ? NaN
      : (performance.now() + g_nExactTime - _nBroadcastStart) / 1e3;
  }

  function GetBroadcastPosition(bForClip) {
    if (!Number.isNaN(_nBroadcastStart)) {
      const nBehind = m_Player.GetSecondsBehindLiveEdge();
      if (nBehind >= 0) {
        return Math.max((performance.now() + g_nExactTime - _nBroadcastStart) / 1e3 - nBehind, 0);
      }
    }
    return m_Player.GetBroadcastPlaybackPosition(bForClip);
  }

  function GetCurrentRecordingId() {
    return _sRecordingId;
  }

  function GetRecordingUrlForCurrentPosition() {
    if (_sRecordingUrl === "") {
      m_Log.Oops("[Twitch] Recording address unknown");
      return "";
    }
    const nPosition = GetBroadcastPosition(false);
    if (nPosition === -1) {
      m_Log.Here("[Twitch] Recording address created without a playback position");
      return _sRecordingUrl;
    }
    const kHours = Math.floor(nPosition / 3600);
    const kMinutes = Math.floor((nPosition / 60) % 60);
    const kSeconds = Math.floor(nPosition % 60);
    return `${_sRecordingUrl}?t=${kHours}h${kMinutes}m${kSeconds}s`;
  }

  function CreateClip() {
    const nPosition = GetBroadcastPosition(true);
    if (_sBroadcastId === "" || nPosition <= 0) {
      m_Log.Oops(`[Twitch] Not enough data to create a clip BroadcastId=${_sBroadcastId} Position=${nPosition}`);
      m_Notification.ShowAss();
      return;
    }
    m_Log.Wow(`[Twitch] Creating clip BroadcastId=${_sBroadcastId} Position=${nPosition} ViewerId=${_sViewerId}`);
    m_Notification.Show("svg-cut", false);
    OpenAddressInNewTab(`https://clips.twitch.tv/create?${new URLSearchParams({
      broadcastID: _sBroadcastId,
      broadcasterLogin: _sChannelLogin,
      offsetSeconds: Math.ceil(nPosition),
    })}`);
  }

  // --- The channel's videos ---

  /*
    What the Videos view lists and plays. Every item comes out in one shape, whatever Twitch called
    its fields: { sKind: "video" | "clip", sId (video id or clip slug), sTitle, nDuration in seconds,
    kViews, nDate in milliseconds, sThumbnail, sGame, bRecording }.

    The first page of a list needs no integrity token; every following page does, so the token is
    only fetched when the viewer actually asks for more.
  */
  const VIDEOS_PER_PAGE = 24;
  // An archive that is still being recorded has no thumbnail yet: Twitch sends a placeholder image.
  const PROCESSING_THUMBNAIL = /\/_404\/404_processing/;

  function GetChannelVideos(sType, sCursor) {
    Check(sType === "ARCHIVE" || sType === "HIGHLIGHT" || sType === "UPLOAD");
    return sendGqlRequest(null, `query($login: String!, $first: Int!, $after: Cursor, $type: BroadcastType!) {
        user(login: $login) {
          videos(first: $first, after: $after, type: $type, sort: TIME) {
            edges {
              cursor
              node {
                id
                title
                lengthSeconds
                viewCount
                publishedAt
                status
                previewThumbnailURL(width: 320, height: 180)
                game {
                  displayName
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }`, { login: _sChannelLogin, first: VIDEOS_PER_PAGE, after: sCursor || null, type: sType },
    true, Boolean(sCursor), true, `channel videos ${sType}`)
      .then((oResult) => readVideoPage(oResult, "videos", (o) => ({
        sKind: "video",
        sId: String(o.id),
        sTitle: o.title || "",
        nDuration: Number(o.lengthSeconds) || 0,
        kViews: Number(o.viewCount) || 0,
        nDate: Date.parse(o.publishedAt) || NaN,
        sThumbnail: PROCESSING_THUMBNAIL.test(o.previewThumbnailURL || "") ? "" : o.previewThumbnailURL || "",
        sGame: chain(o, "game", "displayName") || "",
        bRecording: o.status === "RECORDING",
      })));
  }

  // The channel's most watched clips of all time, the way twitch.tv lists them by default.
  function GetChannelClips(sCursor) {
    return sendGqlRequest(null, `query($login: String!, $first: Int!, $after: Cursor) {
        user(login: $login) {
          clips(first: $first, after: $after, criteria: { period: ALL_TIME, sort: VIEWS_DESC }) {
            edges {
              cursor
              node {
                slug
                title
                durationSeconds
                viewCount
                createdAt
                thumbnailURL(width: 480, height: 272)
                game {
                  displayName
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }`, { login: _sChannelLogin, first: VIDEOS_PER_PAGE, after: sCursor || null },
    true, Boolean(sCursor), true, "channel clips")
      .then((oResult) => readVideoPage(oResult, "clips", (o) => ({
        sKind: "clip",
        sId: String(o.slug),
        sTitle: o.title || "",
        nDuration: Number(o.durationSeconds) || 0,
        kViews: Number(o.viewCount) || 0,
        nDate: Date.parse(o.createdAt) || NaN,
        sThumbnail: o.thumbnailURL || "",
        sGame: chain(o, "game", "displayName") || "",
        bRecording: false,
      })));
  }

  function readVideoPage(oResult, sList, fItem) {
    const oList = chain(oResult, "data", "user", sList);
    if (!IsObject(oList)) {
      throw oResult.errors ? "Server could not complete the operation" : "No such channel";
    }
    const aoEdges = Array.isArray(oList.edges) ? oList.edges.filter((o) => IsObject(chain(o, "node"))) : [];
    return {
      aoItems: aoEdges.map((o) => fItem(o.node)),
      sCursor: chain(oList, "pageInfo", "hasNextPage") && aoEdges.length !== 0 ? aoEdges[aoEdges.length - 1].cursor : null,
    };
  }

  /*
    The playlist address of a past broadcast, highlight or upload. The token is asked for in the
    viewer's name, so a subscriber gets the subscriber-only ones; Chrome plays the playlist natively.
    The playlist is requested once here: a refusal would otherwise reach the page as a black player
    with a decoding error, when it simply means subscribers only.
  */
  function GetVideoPlaybackUrl(sVideoId) {
    Check(IsNonEmptyString(sVideoId));
    return sendGqlRequest(null, `query($id: ID!) {
        videoPlaybackAccessToken(id: $id, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) {
          value
          signature
        }
      }`, { id: sVideoId }, true, false, true, "video playback token")
      .then((oResult) => {
        const sToken = chain(oResult, "data", "videoPlaybackAccessToken", "value");
        const sSignature = chain(oResult, "data", "videoPlaybackAccessToken", "signature");
        if (!IsNonEmptyString(sToken) || !IsNonEmptyString(sSignature)) {
          throw "No playback token for this video";
        }
        const sAddress = `https://usher.ttvnw.net/vod/${encodeURIComponent(sVideoId)}.m3u8?${new URLSearchParams({
          allow_source: "true",
          allow_audio_only: "true",
          player_backend: "mediaplayer",
          playlist_include_framerate: "true",
          p: String(Math.floor(Math.random() * 9999999)),
          sig: sSignature,
          token: sToken,
        })}`;
        return m_Downloader.Load(null, "GET", sAddress, LOAD_METADATA_NO_LONGER_THAN, null, null, "video playlist", false, "text")
          .then(() => sAddress, (pReason) => {
            throw pReason === `${RESPONSE_CODE}403` ? "SUBSCRIBERS_ONLY" : pReason;
          });
      });
  }

  /*
    Les messages du chat d'une rediffusion, autour d'une position.

    Twitch garde le chat d'un VOD et le rend par tranches : on demande une position en secondes
    depuis le debut, et il rend la cinquantaine de messages qui l'entourent, tries. Mesure sur un
    direct de huit heures : demander 3600 s rend 57 messages de 3588 a 3639 s, pour 26 ko et
    350 ms. Une tranche couvre donc quelques dizaines de secondes de lecture.

    LA SUITE SE DEMANDE PAR POSITION, JAMAIS PAR CURSEUR. Chaque message porte un curseur, et la
    requete accepte un « after » -- mais cette forme-la est refusee sans jeton d'integrite, alors
    que la position ne l'est pas. Redemander une position, c'est le meme resultat sans la dette.

    Rend les messages deja mis en forme : le temps, l'auteur, sa couleur, et le texte decoupe en
    morceaux dont certains sont des emotes.
  */
  function GetVideoComments(sVideoId, nOffsetSeconds) {
    Check(IsNonEmptyString(sVideoId));
    return sendGqlRequest(null, `query($id: ID!, $offset: Int!) {
        video(id: $id) {
          comments(contentOffsetSeconds: $offset) {
            edges {
              node {
                id
                contentOffsetSeconds
                commenter {
                  displayName
                  login
                }
                message {
                  userColor
                  fragments {
                    text
                    emote {
                      emoteID
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }`, { id: String(sVideoId), offset: Math.max(0, Math.floor(nOffsetSeconds)) },
    false, false, true, `video comments ${sVideoId}`)
      .then((oResult) => {
        const aoEdges = chain(oResult, "data", "video", "comments", "edges") || [];
        const aoMessages = [];
        for (const oEdge of aoEdges) {
          const oNode = oEdge && oEdge.node;
          const aoFragments = chain(oNode, "message", "fragments") || [];
          if (!oNode || !Number.isFinite(Number(oNode.contentOffsetSeconds))) {
            continue;
          }
          aoMessages.push({
            sId: String(oNode.id || `${oNode.contentOffsetSeconds}-${aoMessages.length}`),
            nOffset: Number(oNode.contentOffsetSeconds),
            sAuthor: chain(oNode, "commenter", "displayName")
              || chain(oNode, "commenter", "login") || "",
            sColour: chain(oNode, "message", "userColor") || "",
            aoParts: aoFragments.map((oFragment) => ({
              sText: oFragment.text || "",
              sEmoteId: chain(oFragment, "emote", "emoteID") || "",
            })),
          });
        }
        // Tries : la tranche arrive dans l'ordre, mais rien ne le promet.
        aoMessages.sort((oLeft, oRight) => oLeft.nOffset - oRight.nOffset);
        return {
          aoMessages,
          bMore: Boolean(chain(oResult, "data", "video", "comments", "pageInfo", "hasNextPage")),
        };
      });
  }

  // A clip is a plain MP4 file; the best quality comes first.
  function GetClipPlaybackUrl(sSlug) {
    Check(IsNonEmptyString(sSlug));
    return sendGqlRequest(null, `query($slug: ID!) {
        clip(slug: $slug) {
          playbackAccessToken(params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) {
            value
            signature
          }
          videoQualities {
            quality
            sourceURL
          }
        }
      }`, { slug: sSlug }, true, false, true, "clip playback token")
      .then((oResult) => {
        const sToken = chain(oResult, "data", "clip", "playbackAccessToken", "value");
        const sSignature = chain(oResult, "data", "clip", "playbackAccessToken", "signature");
        const aoQualities = chain(oResult, "data", "clip", "videoQualities");
        if (!IsNonEmptyString(sToken) || !IsNonEmptyString(sSignature) || !Array.isArray(aoQualities) || aoQualities.length === 0
          || !IsNonEmptyString(aoQualities[0].sourceURL)) {
          throw "No playback address for this clip";
        }
        return `${aoQualities[0].sourceURL}?${new URLSearchParams({ sig: sSignature, token: sToken })}`;
      });
  }

  /*
    The seek-bar thumbnails of a past broadcast. Twitch publishes them as a mosaic: `seekPreviewsURL`
    points to a small JSON listing, per quality, the mosaic images, their grid (rows x cols), the
    thumbnail size, and the seconds between two thumbnails. The Videos view reads one thumbnail out
    of a mosaic to show where the pointer is on the bar. The high-quality set is preferred.
  */
  function GetVideoStoryboards(sVideoId) {
    Check(IsNonEmptyString(sVideoId));
    return sendGqlRequest(null, `query($id: ID!) {
        video(id: $id) {
          seekPreviewsURL
        }
      }`, { id: sVideoId }, true, false, true, "video storyboards")
      .then((oResult) => {
        const sUrl = chain(oResult, "data", "video", "seekPreviewsURL");
        if (!IsNonEmptyString(sUrl)) {
          throw "No storyboard for this video";
        }
        return m_Downloader.LoadJson(null, sUrl, LOAD_METADATA_NO_LONGER_THAN, "storyboard info", false)
          .then((aoSpecs) => {
            if (!Array.isArray(aoSpecs) || aoSpecs.length === 0) {
              throw "Empty storyboard";
            }
            const oSpec = aoSpecs.find((o) => o.quality === "high") || aoSpecs[aoSpecs.length - 1];
            return {
              sBaseUrl: sUrl.slice(0, sUrl.lastIndexOf("/") + 1),
              nInterval: oSpec.interval,
              nWidth: oSpec.width,
              nHeight: oSpec.height,
              nCols: oSpec.cols,
              nRows: oSpec.rows,
              kCount: oSpec.count,
              asImages: oSpec.images,
            };
          });
      });
  }

  // --- Third-party chat extensions ---

  /*
    Chrome cannot load an installed extension into another extension's page
    (https://bugs.chromium.org/p/chromium/issues/detail?id=599167), so content.js inserts these
    into the chat frame itself. This only tells it which ones are installed and enabled.
  */
  const CHAT_EXTENSIONS = new Map([
    ["ajopnjidmegmdimjlfnijceegpefgped", "BTTV"], // BetterTTV, Chrome Web Store
    ["deofbbdfofnmppcjbhjibgodpcdchjii", "BTTV"], // BetterTTV, Opera
    ["icllegkipkooaicfmdfaloehobmglglb", "BTTV"], // BetterTTV, Edge
    ["fadndhdgpmmaapbmfcknlfgcflmmmieb", "FFZ"], // FrankerFaceZ, Chrome Web Store
    ["djkpepcignmpfblhbfpmlhoindhndkdj", "FFZ"], // FrankerFaceZ, Opera
  ]);

  const handleChatMessage = AddExceptionHandler((oMessage, oSender, fRespond) => {
    if (oMessage.sQuery !== "InsertThirdPartyExtensions") {
      return false;
    }
    // Only the chat frame of this tab may ask.
    if ((oSender.tab ? oSender.tab.id : chrome.tabs.TAB_ID_NONE) !== getCurrentTab.nTabId) {
      return false;
    }
    m_Log.Here("[Twitch] Request received to insert third-party extensions");
    chrome.management.getAll(
      AddExceptionHandler((moExtensions) => {
        if (chrome.runtime.lastError) {
          throw new Error(`Could not get the extension list: ${chrome.runtime.lastError.message}`);
        }
        oMessage.sThirdPartyExtensions = "";
        for (const { id, enabled } of moExtensions) {
          if (enabled && CHAT_EXTENSIONS.has(id)) {
            oMessage.sThirdPartyExtensions += `${CHAT_EXTENSIONS.get(id)} `;
          }
        }
        m_Log.Here(`[Twitch] Sending response to the third-party extension insertion: ${oMessage.sThirdPartyExtensions}`);
        try {
          fRespond(oMessage);
        } catch (pException) {
          m_Log.Oops(`[Twitch] Error sending response: ${pException}`);
        }
      })
    );
    // The answer comes asynchronously.
    return true;
  });

  function openChat() {
    chrome.runtime.onMessage.addListener(handleChatMessage);
    return getChatPanelUrl();
  }

  function closeChat() {
    chrome.runtime.onMessage.removeListener(handleChatMessage);
  }

  return {
    isAdSegment,
    sendAdTrackingData,
    GetAbsoluteVariantListUrl,
    GetChannelUrl,
    checkUrlAvailability,
    StartCollectingBroadcastMetadata,
    FinishCollectingBroadcastMetadata,
    ChangeViewerChannelSubscription,
    GetRecordingUrlForCurrentPosition,
    GetCurrentRecordingId,
    GetBroadcastPosition,
    GetBroadcastElapsed,
    CreateClip,
    GetChannelVideos,
    GetChannelClips,
    GetVideoPlaybackUrl,
    GetVideoComments,
    GetClipPlaybackUrl,
    GetVideoStoryboards,
    sortVariantList,
    openChat,
    closeChat,
    start,
  };
})();
