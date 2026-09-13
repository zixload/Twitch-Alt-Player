"use strict";

const m_Twitch = (() => {
  const BROADCAST_METADATA_UPDATE_INTERVAL = 6e4;
  const VIEW_TRACKING_INTERVAL = 6e4;
  let _sViewTrackingUrl = "https://spade.twitch.tv/track";
  let _sChannelLogin = "";
  let _sChannelId = "";
  let _sBroadcastId = "";
  let _sRecordingUrl = "";
  let _sDeviceId = "";
  let _sViewerId = "";
  let _sViewerLogin = "";
  let _sViewerToken = "";
  let _sViewerName = "";
  let _sGqlToken = "";
  let _nGqlTokenExpiresAfter = 0;
  let _sPlaySessionID = "";
  let _oMetadataUpdateCancel = null;
  let _nViewTrackingTimer = 0;
  function ClearBroadcastData() {
    _sBroadcastId = _sRecordingUrl = "";
  }
  function GetChannelUrl(bDoNotRedirect) {
    return bDoNotRedirect
      ? `https://www.twitch.tv/${encodeURIComponent(
        _sChannelLogin
      )}?${DO_NOT_REDIRECT_ADDRESS}`
      : `https://www.twitch.tv/${encodeURIComponent(_sChannelLogin)}`;
  }
  function GetChatPanelUrl() {
    if (m_Settings.Get("bFullChat")) {
      return `https://www.twitch.tv/popout/${encodeURIComponent(
        _sChannelLogin
      )}/chat?no-mobile-redirect=true&popout=`;
    }
    return `https://www.twitch.tv/embed/${encodeURIComponent(
      _sChannelLogin
    )}/chat?${m_Settings.Get("bDimChat") ? "darkpopout&" : ""
      }parent=localhost`;
  }
  function GetRecordingUrl(sRecordingId) {
    Check(IsNonEmptyString(sRecordingId));
    return `https://www.twitch.tv/videos/${encodeURIComponent(sRecordingId)}`;
  }
  function getCategoryUrl(sCategoryName) {
    Check(IsNonEmptyString(sCategoryName));
    return `https://www.twitch.tv/directory/category/${encodeURIComponent(
      sCategoryName
    )}`;
  }
  function getTeamUrl(sTeamName) {
    Check(IsNonEmptyString(sTeamName));
    return `https://www.twitch.tv/team/${encodeURIComponent(sTeamName)}`;
  }
  function checkUrlAvailability(sAddress) {
    if (
      !/^https?:\/\/(?:[^/]+\.)?(?:twitch\.tv|twitchcdn\.net|ttvnw\.net|jtvnw\.net|live-video\.net|akamaized\.net|cloudfront\.net)\//.test(
        sAddress
      )
    ) {
      throw new Error(`Unknown address: ${sAddress}`);
    }
  }
  function createUniqueIdentifier(kLength) {
    Check(Number.isInteger(kLength) && kLength > 0);
    const sAllowedCharacters =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let sResult = "";
    while (sResult.length !== kLength) {
      sResult +=
        sAllowedCharacters[
        Math.floor(Math.random() * sAllowedCharacters.length)
        ];
    }
    return sResult;
  }
  getGqlToken._oPromise = null;
  getGqlToken.fGqlTokenChanged = null;
  function getGqlToken() {
    const WAIT_FOR_TOKEN = 3e4;
    if (getGqlToken._oPromise === null) {
      getGqlToken._oPromise = new Promise((fResolve, fReject) => {
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
            getGqlToken._oPromise = getGqlToken.fGqlTokenChanged =
              null;
            fReject("ACCESS_DENIED");
          }),
          WAIT_FOR_TOKEN
        );
        getGqlToken.fGqlTokenChanged = () => {
          if (_sGqlToken !== "") {
            clearTimeout(nTimer);
            elFrame.remove();
            getGqlToken._oPromise = getGqlToken.fGqlTokenChanged =
              null;
            fResolve(_sGqlToken);
          }
        };
      });
    }
    return getGqlToken._oPromise;
  }
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
    const RETRY_REQUEST_AFTER = 5e3;
    Check(IsNonEmptyString(_sDeviceId));
    if (oVariables !== null) {
      sQuery = createGqlRequestBody(sQuery, oVariables);
    }
    const oRequestHeaders = {
      "Accept-Language": "en-US",
      "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      "Content-Type": "text/plain; charset=UTF-8",
      "X-Device-ID": _sDeviceId,
    };
    if (bSendViewerToken && _sViewerToken) {
      oRequestHeaders.Authorization = `OAuth ${_sViewerToken}`;
    }
    let bFreshToken = false;
    let oPromise;
    if (bSendGqlToken) {
      if (_sGqlToken !== "" && _nGqlTokenExpiresAfter > Date.now()) {
        m_Log.Here(
          `[Twitch] GQL token expires in ${m_Log.F0(
            (_nGqlTokenExpiresAfter - Date.now()) / 1e3
          )}s`
        );
        oRequestHeaders["Client-Integrity"] = _sGqlToken;
        oPromise = Promise.resolve();
      } else {
        bFreshToken = true;
        oPromise = getGqlToken().then((sToken) => {
          oRequestHeaders["Client-Integrity"] = sToken;
        });
      }
    } else {
      oPromise = Promise.resolve();
    }
    return oPromise
      .then(() =>
        m_Downloader.Load(
          oPromiseCancellation,
          "POST",
          "https://gql.twitch.tv/gql",
          nDownloadNoLongerThan,
          oRequestHeaders,
          sQuery,
          sDownloadName,
          true,
          "json"
        )
      )
      .then((oResult) => {
        if (!oResult.errors) {
          return oResult;
        }
        let oPromise;
        if (
          oResult.errors.some(
            ({ message }) => message === "failed integrity check"
          )
        ) {
          m_Log.Oops("[Twitch] Server rejected the GQL token");
          if (
            oRequestHeaders["Client-Integrity"] === _sGqlToken &&
            _sGqlToken !== ""
          ) {
            clearGqlToken();
          }
          if (!bSendGqlToken || bFreshToken) {
            throw "ACCESS_DENIED";
          }
          if (
            oRequestHeaders["Client-Integrity"] !== _sGqlToken &&
            _sGqlToken !== ""
          ) {
            oRequestHeaders["Client-Integrity"] = _sGqlToken;
            oPromise = Promise.resolve();
          } else {
            oPromise = getGqlToken().then((sToken) => {
              oRequestHeaders["Client-Integrity"] = sToken;
            });
          }
        } else if (
          oResult.errors.some(({ message }) => message === "service timeout")
        ) {
          if (!bRetryRequest) {
            m_Log.Oops("[Twitch] GQL server busy");
            return oResult;
          }
          const retryAfter =
            RETRY_REQUEST_AFTER +
            (RETRY_REQUEST_AFTER / 2) * Math.random();
          m_Log.Oops(
            `[Twitch] GQL server busy. Request will be resent in ${retryAfter.toFixed()}ms`
          );
          oPromise = Wait(oPromiseCancellation, retryAfter);
        } else {
          m_Log.Oops("[Twitch] GQL response contains unknown errors");
          return oResult;
        }
        return oPromise
          .then(() =>
            m_Downloader.Load(
              oPromiseCancellation,
              "POST",
              "https://gql.twitch.tv/gql",
              nDownloadNoLongerThan,
              oRequestHeaders,
              sQuery,
              sDownloadName,
              true,
              "json"
            )
          )
          .then((oResult) => {
            if (oResult.errors) {
              if (
                oResult.errors.some(
                  ({ message }) => message === "failed integrity check"
                )
              ) {
                m_Log.Oops("[Twitch] Server rejected the GQL token");
                if (
                  oRequestHeaders["Client-Integrity"] === _sGqlToken &&
                  _sGqlToken !== ""
                ) {
                  clearGqlToken();
                }
                throw "ACCESS_DENIED";
              }
              m_Log.Oops(
                oResult.errors.some(
                  ({ message }) => message === "service timeout"
                )
                  ? "[Twitch] GQL server busy"
                  : "[Twitch] GQL response contains unknown errors"
              );
            }
            return oResult;
          });
      });
  }
  function ChangeViewerChannelSubscription(nSubscription) {
    Check(_sChannelId && _sViewerId && _sViewerToken);
    Check(_sChannelId !== _sViewerId);
    switch (nSubscription) {
      case SUBSCRIPTION_NOT_SUBSCRIBED:
        unfollowChannel();
        break;

      case SUBSCRIPTION_DO_NOT_NOTIFY:
      case SUBSCRIPTION_NOTIFY:
        followChannel(nSubscription);
        break;

      default:
        Check(false);
    }
  }
  function unfollowChannel() {
    sendGqlRequest(
      null,
      `mutation($input: UnfollowUserInput!) {\n\t\t\t\tunfollowUser(input: $input) {\n\t\t\t\t\t__typename\n\t\t\t\t}\n\t\t\t}`,
      {
        input: {
          targetID: _sChannelId,
        },
      },
      true,
      true,
      true,
      "unfollow channel"
    )
      .then((oResult) => {
        if (
          oResult.errors ||
          !oResult.data ||
          !oResult.data.unfollowUser
        ) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-viewermetadatareceived", {
          nSubscription: SUBSCRIPTION_NOT_SUBSCRIBED,
        });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Oops(`[Twitch] Could not unfollow channel. ${pReason}`);
          m_Notification.ShowAss();
          m_Events.SendEvent("twitch-viewermetadatareceived", {
            nSubscription: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function followChannel(nSubscription) {
    sendGqlRequest(
      null,
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
      {
        input: {
          disableNotifications: nSubscription === SUBSCRIPTION_DO_NOT_NOTIFY,
          targetID: _sChannelId,
        },
      },
      true,
      true,
      true,
      "follow channel"
    )
      .then((oResult) => {
        if (
          oResult.errors ||
          !oResult.data ||
          !oResult.data.followUser ||
          !oResult.data.followUser.follow ||
          !oResult.data.followUser.follow.user ||
          oResult.data.followUser.error
        ) {
          throw "Server could not complete the operation";
        }
        m_Events.SendEvent("twitch-viewermetadatareceived", {
          nSubscription,
        });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Oops(`[Twitch] Could not follow channel. ${pReason}`);
          m_Notification.ShowAss();
          m_Events.SendEvent("twitch-viewermetadatareceived", {
            nSubscription: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function isAdSegment(sSegmentName) {
    return sSegmentName !== "" && sSegmentName !== "live";
  }
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
  GetAbsoluteVariantListUrl._nExpiresAfter = -1;
  GetAbsoluteVariantListUrl._sUrl = "";
  function GetAbsoluteVariantListUrl(
    oPromiseCancellation,
    bWithoutHttps,
    bWithoutAds
  ) {
    const TOKEN_EXPIRES_AFTER = 15 * 60 * 1e3;
    if (!bWithoutAds) {
      const nExpiresAfterMs =
        GetAbsoluteVariantListUrl._nExpiresAfter -
        performance.now();
      if (nExpiresAfterMs > 0) {
        m_Log.Here(
          `[Twitch] Time left before the broadcast token expires: ${m_Log.F0(
            nExpiresAfterMs / 1e3
          )}s`
        );
        return Promise.resolve(GetAbsoluteVariantListUrl._sUrl);
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
        playerType: bWithoutAds ? "picture-by-picture" : "site",
        disableHTTPS: bWithoutHttps,
      },
      true,
      false,
      true,
      `broadcast token ${+bWithoutAds}`
    ).then((oResult) => {
      const sToken = chain(
        oResult.data,
        "streamPlaybackAccessToken",
        "value"
      );
      const sSignature = chain(
        oResult.data,
        "streamPlaybackAccessToken",
        "signature"
      );
      m_Debug.saveBroadcastToken(
        `DeviceId=${_sDeviceId} ViewerToken=${Boolean(
          _sViewerToken
        )}\n${sToken}`,
        bWithoutAds
      );
      if (!IsNonEmptyString(sToken) || !IsNonEmptyString(sSignature)) {
        if (oResult.errors) {
          throw "Server could not complete the operation";
        }
        m_Debug.FinishWorkAndShowMessage("J0203");
      }
      const oToken = JSON.parse(sToken);
      Check(oToken.channel === _sChannelLogin);
      if (oToken.ci_gb) {
        m_Debug.FinishWorkAndShowMessage("J0217");
      }
      if (_sChannelId === "") {
        Check(oToken.channel_id);
        _sChannelId = String(oToken.channel_id);
        setTimeout(
          AddExceptionHandler(updateViewerAndChannelMetadata)
        );
      } else {
        Check(_sChannelId === String(oToken.channel_id));
      }
      let sAddress =
        `${bWithoutHttps ? "http" : "https"
        }://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(
          _sChannelLogin
        )}.m3u8` +
        "?allow_source=true" +
        "&allow_audio_only=true" +
        "&cdm=wv" +
        "&fast_bread=true" +
        "&platform=web" +
        "&player_backend=mediaplayer" +
        "&playlist_include_framerate=true" +
        "&reassignments_supported=true" +
        "&supported_codecs=h264" +
        "&transcode_mode=cbr_v1" +
        `&p=${Math.floor(Math.random() * 9999999)}` +
        `&token=${encodeURIComponent(sToken)}` +
        `&sig=${encodeURIComponent(sSignature)}`;
      if (!bWithoutAds) {
        _sPlaySessionID = createUniqueIdentifier(32);
        sAddress += `&play_session_id=${_sPlaySessionID}`;
        GetAbsoluteVariantListUrl._sUrl = sAddress;
        GetAbsoluteVariantListUrl._nExpiresAfter =
          performance.now() + TOKEN_EXPIRES_AFTER;
      }
      return sAddress;
    });
  }
  function clearGqlToken() {
    _sGqlToken = "";
    deleteCookie("tw5~gqltoken", "https://www.twitch.tv/tw5~storage/").catch(
      m_Debug.CaughtException
    );
  }
  function getUniqueDeviceIdentifier() {
    return (
      "0000000000000000" +
      (m_Settings.Get("nRandomNumber") || 0.1).toFixed(16).slice(2)
    );
  }
  function parseAuthCookie(sCookie) {
    if (sCookie) {
      try {
        const o = JSON.parse(decodeURIComponent(sCookie));
        Check(
          IsObject(o) &&
          IsNonEmptyString(o.id) &&
          IsNonEmptyString(o.login) &&
          IsNonEmptyString(o.authToken)
        );
        return o;
      } catch (_) { }
      m_Log.Oops(
        `[Twitch] Could not parse the auth cookie: ${sCookie}`
      );
    }
    return {
      id: "",
      login: "",
      authToken: "",
      displayName: "",
    };
  }
  function parseGqlTokenCookie(sCookie) {
    if (sCookie) {
      try {
        const o = JSON.parse(decodeURIComponent(sCookie));
        Check(
          IsNonEmptyString(o.sToken) && Number.isSafeInteger(o.nExpiresAfter)
        );
        return [o.sToken, o.nExpiresAfter];
      } catch (_) {
        m_Log.Oops(
          `[Twitch] Could not parse the GQL token cookie: ${sCookie}`
        );
      }
    }
    return ["", 0];
  }
  function parseCookie(nAction, { name, domain, path, value }) {
    if (nAction === 3 || typeof value != "string") {
      value = "";
    }
    switch (name) {
      case "twilight-user":
        if (domain === ".twitch.tv" && path === "/") {
          const { id, login, authToken, displayName } =
            parseAuthCookie(value);
          if (
            nAction !== 1 &&
            (_sViewerId !== id ||
              _sViewerLogin !== login ||
              _sViewerToken !== authToken)
          ) {
            m_Debug.FinishWorkAndShowMessage("J0222");
          }
          _sViewerId = id;
          _sViewerLogin = login;
          _sViewerToken = authToken;
          _sViewerName = IsNonEmptyString(displayName) ? displayName : login;
        }
        break;

      case "unique_id":
        if (
          domain === ".twitch.tv" &&
          path === "/" &&
          nAction === 1 &&
          _sDeviceId === ""
        ) {
          _sDeviceId = value;
        }
        break;

      case "tw5~gqltoken":
        if (domain === "www.twitch.tv" && path === "/tw5~storage/") {
          [_sGqlToken, _nGqlTokenExpiresAfter] =
            parseGqlTokenCookie(value);
          if (getGqlToken.fGqlTokenChanged) {
            getGqlToken.fGqlTokenChanged();
          }
        }
    }
  }
  function start(sChannelCode) {
    Check(IsNonEmptyString(sChannelCode));
    _sChannelLogin = sChannelCode;
    return getAllCookies("https://www.twitch.tv/tw5~storage/").then(
      (maCookies) => {
        for (const oCookie of maCookies) {
          parseCookie(1, oCookie);
        }
        if (_sDeviceId === "") {
          m_Log.Oops("[Twitch] Device identifier not found");
          _sDeviceId = getUniqueDeviceIdentifier();
        }
        chrome.cookies.onChanged.addListener(
          AddExceptionHandler(({ removed, cause, cookie }) => {
            if (!(removed && cause === "overwrite")) {
              parseCookie(removed ? 3 : 2, cookie);
            }
          })
        );
      }
    );
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
        const nSubscription = !chain(oUser.self, "canFollow")
          ? SUBSCRIPTION_UNAVAILABLE
          : !oUser.self.follower
            ? SUBSCRIPTION_NOT_SUBSCRIBED
            : oUser.self.follower.disableNotifications
              ? SUBSCRIPTION_DO_NOT_NOTIFY
              : SUBSCRIPTION_NOTIFY;
        m_Events.SendEvent("twitch-channelmetadatareceived", {
          sName: oUser.displayName || _sChannelLogin,
          sAvatar: oUser.profileImageURL || "player.svg#svg-missingavatar",
          sDescription: oUser.description,
          sLanguageCode: sLanguageCode && sLanguageCode !== "OTHER" ? sLanguageCode : null,
          kSubscribers: chain(oUser.followers, "totalCount"),
          nChannelCreated: Date.parse(oUser.createdAt),
          moTeams,
        });
        m_Events.SendEvent("twitch-viewermetadatareceived", {
          sName: _sViewerName,
          nSubscription,
        });
      })
      .catch((pReason) => {
        if (typeof pReason == "string") {
          m_Log.Oops(
            `[Twitch] Could not get channel metadata. ${pReason}`
          );
          m_Events.SendEvent("twitch-channelmetadatareceived", {
            sName: _sChannelLogin,
            sAvatar: "player.svg#svg-missingavatar",
            sLanguageCode: null,
            kSubscribers: null,
            nChannelCreated: null,
          });
          m_Events.SendEvent("twitch-viewermetadatareceived", {
            sName: _sViewerName,
            nSubscription: SUBSCRIPTION_UNAVAILABLE,
          });
        } else {
          m_Debug.CaughtException(pReason);
        }
      });
  }
  function UpdateBroadcastMetadata(oPromiseCancellation, nAfter) {
    Check(_sChannelId);
    m_Log.Here(
      `[Twitch] Broadcast metadata loading will start in ${m_Log.F0(
        nAfter
      )}ms`
    );
    Wait(oPromiseCancellation, nAfter)
      .then(() => {
        return sendGqlRequest(
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
            all: _sBroadcastId === "",
          },
          false,
          false,
          true,
          "broadcast metadata"
        );
      })
      .then((oResult) => {
        const oUser = chain(oResult.data, "user");
        const sChannelCode = chain(oUser, "login");
        if (sChannelCode !== _sChannelLogin && IsNonEmptyString(sChannelCode)) {
          m_Log.Oops(`[Twitch] New channel code ${sChannelCode}`);
          location.replace(`?channel=${encodeURIComponent(sChannelCode)}`);
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
          _sRecordingUrl = IsNonEmptyString(sRecordingId)
            ? GetRecordingUrl(sRecordingId)
            : "";
          const sBroadcastType = chain(oUser, "stream", "type");
          oMetadata.sBroadcastType =
            sBroadcastType === "live"
              ? "live"
              : sBroadcastType === "rerun"
                ? "replay"
                : null;
        }
        if (_sBroadcastId === "" || _sBroadcastId === sBroadcastId) {
          const sBroadcastTitle = chain(
            oUser,
            "broadcastSettings",
            "title"
          );
          if (typeof sBroadcastTitle == "string") {
            oMetadata.sBroadcastTitle =
              sBroadcastTitle.trim() || GetText("J0103");
          }
          oMetadata.sGameName = chain(
            oUser,
            "broadcastSettings",
            "game",
            "displayName"
          );
          const sGameUrl = chain(
            oUser,
            "broadcastSettings",
            "game",
            "slug"
          );
          if (sGameUrl) {
            oMetadata.sGameUrl = getCategoryUrl(sGameUrl);
          }
          oMetadata.nBroadcastDuration =
            performance.now() +
            g_nExactTime -
            Date.parse(chain(oUser, "stream", "createdAt"));
        }
        m_Events.SendEvent(
          "twitch-broadcastmetadatareceived",
          oMetadata
        );
        UpdateBroadcastMetadata(
          oPromiseCancellation,
          BROADCAST_METADATA_UPDATE_INTERVAL
        );
      })
      .catch(
        AddExceptionHandler((pReason) => {
          if (typeof pReason == "string") {
            m_Log.Oops(
              `[Twitch] Could not load broadcast metadata. ${pReason}`
            );
            UpdateBroadcastMetadata(
              oPromiseCancellation,
              BROADCAST_METADATA_UPDATE_INTERVAL / 2
            );
          } else if (pReason === PromiseCancellation.REASON) {
            m_Log.Here("[Twitch] Broadcast metadata update cancelled");
          } else {
            throw pReason;
          }
        })
      );
  }
  function StartCollectingBroadcastMetadata() {
    ClearBroadcastData();
    Check(!_oMetadataUpdateCancel);
    _oMetadataUpdateCancel = new PromiseCancellation();
    UpdateBroadcastMetadata(_oMetadataUpdateCancel, 0);
  }
  function FinishCollectingBroadcastMetadata(bBroadcastEnded) {
    if (bBroadcastEnded) {
      ClearBroadcastData();
    }
    if (_oMetadataUpdateCancel) {
      m_Log.Here(
        `[Twitch] Cancelling broadcast metadata update chain BroadcastEnded=${bBroadcastEnded}`
      );
      _oMetadataUpdateCancel.Cancel();
      _oMetadataUpdateCancel = null;
    }
    stopViewTracking();
  }
  function startViewTracking() {
    if (_sViewerId !== "") {
      m_Log.Here("[Twitch] Starting view tracking");
      Check(_nViewTrackingTimer === 0);
      _nViewTrackingTimer = setInterval(
        sendViewTrackingData,
        VIEW_TRACKING_INTERVAL
      );
      sendViewTrackingData();
    }
  }
  function stopViewTracking() {
    if (_nViewTrackingTimer !== 0) {
      m_Log.Here("[Twitch] Stopping view tracking");
      clearInterval(_nViewTrackingTimer);
      _nViewTrackingTimer = 0;
    }
  }
  const sendViewTrackingData = AddExceptionHandler(
    () => {
      Check(_sBroadcastId && _sChannelId && _sViewerId);
      const oToSend = new URLSearchParams();
      oToSend.set(
        "data",
        btoa(
          JSON.stringify([
            {
              event: "minute-watched",
              properties: {
                broadcast_id: _sBroadcastId,
                channel_id: _sChannelId,
                user_id: Number(_sViewerId),
                player: "site",
              },
            },
          ])
        )
      );
      m_Downloader
        .Load(
          null,
          "POST",
          _sViewTrackingUrl,
          LOAD_METADATA_NO_LONGER_THAN,
          null,
          oToSend,
          "view tracking",
          false,
          "none"
        )
        .catch((pReason) => {
          if (typeof pReason == "string") {
            m_Log.Oops(
              `[Twitch] Could not send view tracking data. ${pReason}`
            );
          } else {
            m_Debug.CaughtException(pReason);
          }
        });
    }
  );
  function GetRecordingUrlForCurrentPosition() {
    if (_sRecordingUrl === "") {
      m_Log.Oops("[Twitch] Recording address unknown");
      return "";
    }
    const nPlaybackPosition =
      m_Player.GetBroadcastPlaybackPosition(false);
    if (nPlaybackPosition === -1) {
      m_Log.Here("[Twitch] Recording address created without a playback position");
      return _sRecordingUrl;
    }
    return `${_sRecordingUrl}?t=${Math.floor(nPlaybackPosition / 60 / 60)}h${Math.floor(
      (nPlaybackPosition / 60) % 60
    )}m${Math.floor(nPlaybackPosition % 60)}s`;
  }
  function CreateClip() {
    const nPlaybackPosition =
      m_Player.GetBroadcastPlaybackPosition(true);
    if (_sBroadcastId === "" || nPlaybackPosition <= 0) {
      m_Log.Oops(
        `[Twitch] Not enough data to create a clip BroadcastId=${_sBroadcastId} Position=${nPlaybackPosition}`
      );
      m_Notification.ShowAss();
    } else {
      m_Log.Wow(
        `[Twitch] Creating clip BroadcastId=${_sBroadcastId} Position=${nPlaybackPosition} ViewerId=${_sViewerId}`
      );
      m_Notification.Show("svg-cut", false);
      OpenAddressInNewTab(
        `https://clips.twitch.tv/create?${new URLSearchParams({
          broadcastID: _sBroadcastId,
          broadcasterLogin: _sChannelLogin,
          offsetSeconds: Math.ceil(nPlaybackPosition),
        })}`
      );
    }
  }
  function GetAbsoluteSegmentListUrl(
    sAbsoluteSegmentListUrl
  ) {
    return sAbsoluteSegmentListUrl;
  }
  function sortVariantList(oVariantList) {
    if (oVariantList.sViewTrackingUrl) {
      _sViewTrackingUrl = oVariantList.sViewTrackingUrl;
    }
    return oVariantList;
  }
  const handleChatMessage = AddExceptionHandler(
    (oMessage, oSender, fRespond) => {
      if (oMessage.sQuery !== "InsertThirdPartyExtensions") {
        return false;
      }
      if (
        (oSender.tab ? oSender.tab.id : chrome.tabs.TAB_ID_NONE) !==
        getCurrentTab.nTabId
      ) {
        return false;
      }
      m_Log.Here("[Twitch] Request received to insert third-party extensions");
      chrome.management.getAll(
        AddExceptionHandler((moExtensions) => {
          if (chrome.runtime.lastError) {
            throw new Error(
              `Could not get the extension list: ${chrome.runtime.lastError.message}`
            );
          }
          //! Send to content script a list of known browser extensions that are currently installed and enabled in the browser.
          //! These extensions will be loaded into <iframe>. See insertThirdPartyExtensions() in content.js.
          //! Chrome itself cannot load installed extensions into another extension.
          //! See https://bugs.chromium.org/p/chromium/issues/detail?id=599167
          oMessage.sThirdPartyExtensions = "";
          for (let oExtensionItem of moExtensions) {
            if (oExtensionItem.enabled) {
              switch (oExtensionItem.id) {
                case /*! Chrome */ "ajopnjidmegmdimjlfnijceegpefgped":
                case /*! Opera  */ "deofbbdfofnmppcjbhjibgodpcdchjii":
                case /*! Edge   */ "icllegkipkooaicfmdfaloehobmglglb":
                  //! BetterTTV browser extension
                  //! https://betterttv.com/
                  //! https://chrome.google.com/webstore/detail/ajopnjidmegmdimjlfnijceegpefgped
                  oMessage.sThirdPartyExtensions += "BTTV ";
                  break;

                case /*! Chrome */ "fadndhdgpmmaapbmfcknlfgcflmmmieb":
                case /*! Opera  */ "djkpepcignmpfblhbfpmlhoindhndkdj":
                  //! FrankerFaceZ browser extension
                  //! https://www.frankerfacez.com/
                  //! https://chrome.google.com/webstore/detail/fadndhdgpmmaapbmfcknlfgcflmmmieb
                  oMessage.sThirdPartyExtensions += "FFZ ";
              }
            }
          }
          m_Log.Here(
            `[Twitch] Sending response to the third-party extension insertion: ${oMessage.sThirdPartyExtensions}`
          );
          try {
            fRespond(oMessage);
          } catch (pException) {
            m_Log.Oops(`[Twitch] Error sending response: ${pException}`);
          }
        })
      );
      return true;
    }
  );
  function openChat() {
    chrome.runtime.onMessage.addListener(handleChatMessage);
    return GetChatPanelUrl();
  }
  function closeChat() {
    chrome.runtime.onMessage.removeListener(handleChatMessage);
  }
  return {
    isAdSegment,
    sendAdTrackingData,
    GetAbsoluteVariantListUrl,
    GetAbsoluteSegmentListUrl,
    GetChannelUrl,
    checkUrlAvailability,
    StartCollectingBroadcastMetadata,
    FinishCollectingBroadcastMetadata,
    ChangeViewerChannelSubscription,
    GetRecordingUrlForCurrentPosition,
    CreateClip,
    sortVariantList,
    openChat,
    closeChat,
    start,
  };
})();
