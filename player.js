/**
 * @toc
 *
 * =============================================================================
 *                     TABLE OF CONTENTS (GOTO Line: control+g)
 * =============================================================================
 *
 *  In order of appearance in the file:
 *
 *  1. CONSTANTS
 *     - Global constants for player states, processing status, etc.
 *
 *  2. UTILITY FUNCTIONS
 *     - Generic helper functions (Text, Round, Clamp, DOM manipulation, etc.).
 *
 *  3. DEBUG & ERROR REPORTING (m_Debug)
 *     - Handles all fatal errors, exceptions, and user-submitted reports.
 *     - Displays the final error/feedback screen.
 *
 *  4. CORE DATA STRUCTURES & ASYNC
 *     - Promise Cancellation (PromiseCancellation): Custom promise cancellation logic.
 *     - Segment (Segment): Class representing a single video/audio segment.
 *     - Segment Queue (g_maQueue): Global queue for managing segments through
 *       the processing pipeline (download -> convert -> buffer).
 *
 *  5. UI & UX MODULES
 *     - Number Input (NumberInput): Reusable component for number inputs.
 *     - Event Bus (m_Events): Global pub/sub for inter-module communication.
 *     - Memory Recycler (m_GarbageCollector): Manages memory by offloading ArrayBuffers.
 *     - Focus Manager (m_FocusManager): Tracks browser tab focus/visibility.
 *     - Pulse Checker (m_Heartbeat): Monitors for UI thread freezes.
 *     - Statistics (m_Statistics): Core module for collecting and displaying
 *       all playback, network, and performance metrics in the stats overlay.
 *     - Window Manager (m_Window): Manages modal dialogs (Settings, News, etc.).
 *     - Menu (m_Menu): Handles the main player context menu.
 *     - Fullscreen Mode (m_FullscreenMode): Manages fullscreen state.
 *     - Picture-in-Picture (m_PictureInPicture): Manages PiP state.
 *     - Dragger (m_Dragger): Handles dragging/resizing UI elements (e.g., chat).
 *     - Auto-Hide Controls (m_AutoHide): Manages auto-hiding of player controls.
 *     - Media Query (m_MediaQuery): Handles responsive UI adjustments.
 *     - Theming/Appearance (m_Appearance): Manages custom styling and UI colors.
 *
 *  6. NEWS & UPDATES (m_News)
 *     - Displays the changelog and help manual.
 *     - Checks for new versions of the extension.
 *
 *  7. CENTRAL CONTROL (m_Controls)
 *     - Central hub for all user input (keyboard shortcuts, clicks).
 *     - Manages player state transitions (playing, stopped, replay).
 *     - Bridges UI actions to player logic.
 *
 *  8. CHAT MODULE (m_Chat)
 *     - Manages the integrated Twitch chat iframe, including its position and state.
 *
 *  9. PLAYER CORE (m_Player)
 *     - The heart of the player. Manages the `<video>` element and MediaSource Extensions (MSE).
 *     - Appends processed segments to the SourceBuffer.
 *     - Handles playback state (play, pause, seeking, ended).
 *     - Manages buffer health (stalls, overflow) and seeking logic.
 *
 *  10. PLAYLIST MANAGER (m_Playlist)
 *      - Fetches and parses M3U8 master and media playlists.
 *      - Manages ad-detection and switching between ad/clean streams.
 *      - Identifies new segments and adds them to the processing queue.
 *
 *  11. SEGMENT PROCESSOR (m_Transcoder)
 *      - Uses a Web Worker to process downloaded TS segments.
 *      - Receives raw segments and sends back transmuxed/inspected segments.
 *
 *  12. HTTP DOWNLOADER (m_Downloader)
 *      - Low-level XHR-based utility for downloading playlists and segments.
 *      - Includes retry logic, timeout handling, and stats collection.
 *
 *  13. TWITCH API WRAPPER (m_Twitch)
 *      - Handles all communication with Twitch's backend (GQL, Usher).
 *      - Fetches stream access tokens, channel metadata, user info, etc.
 *      - Sends telemetry for ad viewership.
 *
 *  14. MAIN INITIALIZATION (Launcher)
 *      - The main entry point. Initializes all modules and starts the player.
 * 
 *  15. AD DATA LOGGING
 *      - Where to start looking into the "hiding ads" problem: the video freezing,
 *        showing a solid black screen, or the player waiting through the whole
 *        pre-roll pod before playback starts.
 *      - Search the log for the [AdBlock] prefix. Those messages go through
 *        m_Log, so they land in the debug window and in bug reports rather
 *        than only in the devtools console.
 */
"use strict";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const LOAD_METADATA_NO_LONGER_THAN = 15e3;

const LOAD_VARIANT_LIST_NO_LONGER_THAN = 15e3;

const LOAD_SEGMENT_LIST_NO_LONGER_THAN = 6e3;

const PROCESSING_AWAITING_DOWNLOAD = 1;

const PROCESSING_DOWNLOADING = 2;

const PROCESSING_DOWNLOADED = 3;

const PROCESSING_CONVERTED = 4;

const STATE_START = 1;

const STATE_BROADCAST_START = 2;

const STATE_BROADCAST_END = 3;

const STATE_LOADING = 4;

const STATE_PLAYBACK_START = 5;

const STATE_PLAYING = 6;

const STATE_STOP = 7;

const STATE_REPEAT = 8;

const STATE_VARIANT_CHANGE = 9;

const SUBSCRIPTION_UPDATING = -1;

const SUBSCRIPTION_UNAVAILABLE = 0;

const SUBSCRIPTION_NOT_SUBSCRIBED = 1;

const SUBSCRIPTION_DO_NOT_NOTIFY = 2;

const SUBSCRIPTION_NOTIFY = 3;

const RESPONSE_CODE = "Server returned code ";
// const RESPONSE_CODE = 'Server returned code ';

let g_nExactTime = NaN;

if (!navigator.clipboard) {
  navigator.clipboard = {};
}

if (!navigator.clipboard.writeText) {
  navigator.clipboard.writeText = function (sText) {
    // navigator.clipboard.writeText = function(sText) {
    Check(typeof sText == "string");
    // Check(typeof sText == 'string');
    return new Promise(
      AddExceptionHandler((fResolve, fReject) => {
        // return new Promise(AddExceptionHandler((fResolve, fReject) => {
        const nodeText = document.createElement("input");
        // const nodeText = document.createElement('input');
        nodeText.type = "text";
        // nodeText.type = 'text';
        nodeText.readOnly = true;
        nodeText.value = sText;
        nodeText.style.position = "fixed";
        // nodeText.style.position = 'fixed';
        nodeText.style.left = "-100500px";
        // nodeText.style.left = '-100500px';
        document.body.appendChild(nodeText);
        nodeText.select();
        const bSuccess = document.execCommand("copy");
        // const bSuccess = document.execCommand('copy');
        nodeText.remove();
        if (bSuccess) {
          fResolve();
        } else {
          fReject();
        }
      })
    );
  };
}

function GetText(sCode, sSubstitution) {
  // function Text(sCode, sSubstitution) {
  return m_i18n.GetMessage(sCode, sSubstitution);
}

function Round(nValue, nPrecision) {
  Check(
    typeof nValue == "number" &&
    Number.isInteger(nPrecision) &&
    nPrecision >= 0 &&
    nPrecision <= 20
  );
  // Check(typeof nValue == 'number' && Number.isInteger(nPrecision) && nPrecision >= 0 && nPrecision <= 20);
  if (nPrecision === 0) {
    return Math.round(nValue);
  }
  const h = Math.pow(10, nPrecision);
  // const n = Math.pow(10, nPrecision);
  return Math.round(nValue * h) / h;
  // return Math.round(nValue * n) / n;
}

function Clamp(nValue, nMin, nMax) {
  Check(
    Number.isFinite(nValue) &&
    Number.isFinite(nMin) &&
    Number.isFinite(nMax) &&
    nMin <= nMax
  );
  // Check(Number.isFinite(nValue) && Number.isFinite(nMin) && Number.isFinite(nMax) && nMin <= nMax);
  return Math.min(Math.max(nValue, nMin), nMax);
}

/*
  Une liste de lecture qui grandit encore -- le VOD d'une diffusion en cours -- refermee pour que le
  navigateur y voie une video finie.

  Twitch la sert en type EVENT, sans #EXT-X-ENDLIST. Chrome la lit alors comme un direct : duree
  infinie, aucune plage deplacable. Or elle porte deja tout depuis le debut de la diffusion ; il ne
  lui manque que sa marque de fin. On la referme donc et on sert la copie par un blob.

  Les adresses de segments deviennent absolues : un blob n'a plus de base pour resoudre « 1356.mp4 ».
  Les balises qui portent une adresse, #EXT-X-MAP et #EXT-X-KEY, sont traitees de meme.

  Rend l'adresse d'origine quand il n'y a rien a faire, ou quand quoi que ce soit echoue : au pire on
  retombe sur le comportement d'avant, jamais sur une video qui ne part pas. Une adresse rendue
  differente de celle qu'on a donnee est un blob, a liberer par l'appelant.
*/
const PLAYLIST_MEDIA_TYPE = "application/vnd.apple.mpegurl";

function closePlaylist(sText, sBaseUrl) {
  const asLines = sText.split("\n");
  const asClosed = asLines.map((sLine) => {
    const sTrimmed = sLine.trim();
    if (sTrimmed === "") {
      return sLine;
    }
    if (sTrimmed.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
      return "#EXT-X-PLAYLIST-TYPE:VOD";
    }
    if (sTrimmed.startsWith("#")) {
      return sTrimmed.replace(/URI="([^"]*)"/g, (sAll, sUri) => `URI="${new URL(sUri, sBaseUrl).href}"`);
    }
    return new URL(sTrimmed, sBaseUrl).href;
  });
  if (!sText.includes("#EXT-X-PLAYLIST-TYPE:")) {
    asClosed.splice(1, 0, "#EXT-X-PLAYLIST-TYPE:VOD");
  }
  asClosed.push("#EXT-X-ENDLIST", "");
  return asClosed.join("\n");
}

function makeSeekablePlaylist(sUrl) {
  if (!/\.m3u8(\?|$)/.test(sUrl)) {
    return Promise.resolve(sUrl);
  }
  return fetch(sUrl, { cache: "no-store" })
    .then((oResponse) => (oResponse.ok ? oResponse.text() : ""))
    .then((sText) => {
      if (!sText || !sText.includes("#EXTINF") || sText.includes("#EXT-X-ENDLIST")) {
        return sUrl;
      }
      m_Log.Wow("[Player] Growing playlist closed so it can be seeked");
      return URL.createObjectURL(new Blob([closePlaylist(sText, sUrl)], { type: PLAYLIST_MEDIA_TYPE }));
    })
    .catch((pReason) => {
      m_Log.Oops(`[Player] Could not close the playlist. ${pReason}`);
      return sUrl;
    });
}

function chain(pObject, ...msProperties) {
  Check(msProperties.length !== 0);
  for (const sProperty of msProperties) {
    if (!IsObject(pObject)) {
      return null;
    }
    Check(IsNonEmptyString(sProperty));
    pObject = pObject[sProperty];
  }
  return pObject;
}

function ResolveRelativeUrl(sRelativeUrl, sAbsoluteBaseUrl) {
  return new URL(sRelativeUrl, sAbsoluteBaseUrl).href;
}

function ChangeDocumentTitle(sTitle) {
  history.replaceState(null, "");
  document.title = sTitle;
}

function checkExtensionPermissions() {
  return new Promise((fResolve) => {
    chrome.permissions.contains(
      {
        origins: chrome.runtime
          .getManifest()
          .permissions.filter((sPermission) => sPermission.includes(":")),
      },
      (bAllowed) => {
        if (chrome.runtime.lastError) {
          console.error(
            "permissions.contains",
            chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        if (!bAllowed) {
          m_Debug.FinishWorkAndShowMessage("J0215");
        }
        fResolve();
      }
    );
  });
}

getCurrentTab.nTabId = NaN;

getCurrentTab.sCookieStore = "";

function getCurrentTab() {
  return new Promise((fResolve) => {
    chrome.tabs.getCurrent(
      AddExceptionHandler((oTab) => {
        if (
          chrome.runtime.lastError ||
          !IsObject(oTab) ||
          !Number.isSafeInteger(oTab.id) ||
          oTab.id === chrome.tabs.TAB_ID_NONE
        ) {
          console.error(
            "tabs.getCurrent",
            chrome.runtime.lastError && chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        getCurrentTab.nTabId = oTab.id;
        fResolve();
      })
    );
  });
}

function getAllCookies(sAddress) {
  return new Promise((fResolve) => {
    const oParameters = {
      url: sAddress,
    };
    if (getCurrentTab.sCookieStore) {
      oParameters.storeId = getCurrentTab.sCookieStore;
    }
    chrome.cookies.getAll(
      oParameters,
      AddExceptionHandler((maCookies) => {
        if (!chrome.runtime.lastError && Array.isArray(maCookies)) {
          m_Log.Here(`[API] Cookie count: ${maCookies.length}`);
          fResolve(maCookies);
        } else {
          console.error(
            "cookies.getAll",
            chrome.runtime.lastError && chrome.runtime.lastError.message
          );
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
      })
    );
  });
}

function deleteCookie(sName, sAddress) {
  return new Promise((fResolve) => {
    chrome.cookies.remove(
      {
        name: sName,
        url: sAddress,
      },
      AddExceptionHandler(() => {
        if (chrome.runtime.lastError) {
          console.error("cookies.remove", chrome.runtime.lastError.message);
          m_Debug.FinishWorkAndShowMessage("J0221");
        }
        fResolve();
      })
    );
  });
}

function OpenAddressInNewTab(sAddress) {
  window.open(sAddress);
}

function WriteTextToLocalFile(sText, sDataType, sFileName) {
  Check(
    typeof sText == "string" &&
    IsNonEmptyString(sDataType) &&
    IsNonEmptyString(sFileName)
  );
  const nodeLink = document.createElement("a");
  nodeLink.href = URL.createObjectURL(
    new Blob([sText], {
      type: sDataType,
    })
  );
  nodeLink.download = sFileName;
  nodeLink.dispatchEvent(new MouseEvent("click"));
}

function createElementEventHandler(fCall) {
  return AddExceptionHandler((oEvent) => {
    if (oEvent.target.nodeType === Node.ELEMENT_NODE) {
      fCall(oEvent);
    }
  });
}

function IsLinkEvent(oEvent) {
  return !!oEvent.target.closest("a[href]");
}

function ElementAtThisPointCanScroll(x, y) {
  for (
    let nodeElement = document.elementFromPoint(x, y);
    nodeElement;
    nodeElement = nodeElement.parentElement
  ) {
    if (ThisElementCanScroll(nodeElement)) {
      return true;
    }
  }
  return false;
}

function ThisElementCanScroll(nodeElement) {
  const oStyle = getComputedStyle(nodeElement);
  return (
    (oStyle.overflowY === "scroll" || oStyle.overflowY === "auto") &&
    nodeElement.clientHeight < nodeElement.scrollHeight
  );
}

function thisElementIsFullyScrolled(elElement) {
  return (
    elElement.scrollHeight - elElement.scrollTop - elElement.clientHeight < 2
  );
}

function ShowElement(pElement, bShow) {
  const nodeElement = GetNode(pElement);
  if (bShow) {
    nodeElement.removeAttribute("hidden");
  } else {
    nodeElement.setAttribute("hidden", "");
  }
  return nodeElement;
}

function ElementIsShown(pElement) {
  return !GetNode(pElement).hasAttribute("hidden");
}

function ChangeButton(pButton, pState) {
  const nodeButton = GetNode(pButton);
  const nState = Number(pState);
  const nodeStates = nodeButton.getElementsByTagName("use");
  Check(nState >= 0 && nState < nodeStates.length);
  for (let idx = 0; idx < nodeStates.length; ++idx) {
    if (idx === nState) {
      const sTooltip = nodeStates[idx].getAttributeNS(
        "http://www.w3.org/1999/xlink",
        "title"
      );
      if (sTooltip) {
        nodeButton.title = GetText(sTooltip);
      }
      nodeStates[idx].removeAttribute("display");
    } else {
      nodeStates[idx].setAttribute("display", "none");
    }
  }
  return nodeButton;
}

class PromiseCancellation {
  constructor() {
    this.bCancelled = false;
    this._fHandler = null;
  }
  Cancel() {
    this.bCancelled = true;
    if (this._fHandler) {
      this._fHandler();
      this._fHandler = null;
    }
  }
  ReplaceHandler(fHandler) {
    Check(!this.bCancelled);
    Check(typeof fHandler == "function" || fHandler === null);
    this._fHandler = fHandler;
  }
}

PromiseCancellation.REASON = new Error("PROMISE_CANCELLED");

function Wait(oPromiseCancellation, nMilliseconds) {
  if (oPromiseCancellation && oPromiseCancellation.bCancelled) {
    return Promise.reject(PromiseCancellation.REASON);
  }
  if (nMilliseconds === -Infinity) {
    let oPromise = Promise.resolve();
    if (oPromiseCancellation) {
      oPromise = oPromise.then(() => {
        if (oPromiseCancellation.bCancelled) {
          throw PromiseCancellation.REASON;
        }
      });
    }
    return oPromise;
  }
  Check(Number.isFinite(nMilliseconds));
  nMilliseconds = Math.round(nMilliseconds);
  Check(nMilliseconds >= 0 && nMilliseconds <= 2147483647);
  if (oPromiseCancellation) {
    return new Promise((fResolve, fReject) => {
      const nTimer = setTimeout(() => {
        oPromiseCancellation.ReplaceHandler(null);
        fResolve();
      }, nMilliseconds);
      oPromiseCancellation.ReplaceHandler(() => {
        clearTimeout(nTimer);
        fReject(PromiseCancellation.REASON);
      });
    });
  }
  return new Promise((fResolve) => {
    setTimeout(fResolve, nMilliseconds);
  });
}

class Segment {
  constructor(nProcessing, pData, nDuration, bDiscontinuity, nNumber) {
    Check(
      typeof nProcessing == "number" &&
      nProcessing >= PROCESSING_AWAITING_DOWNLOAD &&
      nProcessing <= PROCESSING_CONVERTED
    );
    Check(
      (typeof pData == "number" && nProcessing >= PROCESSING_DOWNLOADED) ||
      (typeof pData == "string" &&
        nProcessing === PROCESSING_AWAITING_DOWNLOAD) ||
      (IsObject(pData) && nProcessing > PROCESSING_AWAITING_DOWNLOAD)
    );
    switch (arguments.length) {
      case 2:
        nDuration = 0;
        bDiscontinuity = true;

      case 4:
        Check(Number.isFinite(nDuration) && nDuration >= 0);
        Check(typeof bDiscontinuity == "boolean");
        nNumber = ++Segment._nNumber;

      case 5:
        Check(Number.isFinite(nNumber));
        break;

      default:
        Check(false);
    }
    if (typeof pData == "number") {
      m_Log.Wow(
        `[Queue] Segment added ${nNumber} State=${pData} Processing=${nProcessing}`
      );
    }
    this.nProcessing = nProcessing;
    this.pData = pData;
    this.nDuration = nDuration;
    this.bDiscontinuity = bDiscontinuity;
    this.nNumber = nNumber;
  }
  toString() {
    if (typeof this.pData == "number") {
      return `${this.nNumber}-${this.nProcessing}-${this.pData}`;
    }
    if (this.bDiscontinuity) {
      return `${this.nNumber}-${this.nProcessing}-D`;
    }
    return `${this.nNumber}-${this.nProcessing}`;
  }
}

Segment._nNumber = 0;

let g_maQueue = [];

g_maQueue.CountConvertedSegments = function () {
  let nAmount = 0,
    nDuration = 0;
  for (
    ;
    nAmount < this.length &&
    this[nAmount].nProcessing === PROCESSING_CONVERTED;
    ++nAmount
  ) {
    if (typeof this[nAmount].pData != "number") {
      nDuration += this[nAmount].nDuration;
    }
  }
  return {
    nAmount,
    nDuration,
  };
};

g_maQueue.Add = function (oSegment) {
  Check(oSegment instanceof Segment);
  for (let o of this) {
    Check(o.nNumber !== oSegment.nNumber);
  }
  if (oSegment.nProcessing !== PROCESSING_CONVERTED) {
    this.push(oSegment);
  } else {
    const { nAmount, nDuration } =
      this.CountConvertedSegments();
    if (nDuration > BUFFER_OVERFLOW * 1.5) {
      m_Debug.FinishWorkAndShowMessage("J0208");
    }
    this.splice(nAmount, 0, oSegment);
  }
  return oSegment;
};

g_maQueue.Remove = function (pElement, nAmount = 1) {
  if (nAmount === 0) {
    return;
  }
  Check(Number.isInteger(nAmount) && nAmount > 0);
  let nIndex;
  if (typeof pElement == "number") {
    Check(Number.isInteger(pElement) && pElement >= 0);
    nIndex = pElement;
  } else if ((nIndex = this.indexOf(pElement)) === -1) {
    Check(pElement instanceof Segment);
    return;
  }
  while (--nAmount >= 0) {
    Check(nIndex < this.length);
    switch (this[nIndex].nProcessing) {
      case PROCESSING_DOWNLOADING:
        if (IsObject(this[nIndex].pData)) {
          m_Log.Here(`[Queue] Cancelling download ${this[nIndex]}`);
          this[nIndex].pData.Cancel();
        }
        break;

      case PROCESSING_DOWNLOADED:
        m_GarbageCollector.Discard(this[nIndex].pData);
        break;

      case PROCESSING_CONVERTED:
        if (IsObject(this[nIndex].pData)) {
          m_GarbageCollector.Discard(this[nIndex].pData.mbInitializationSegment);
          m_GarbageCollector.Discard(this[nIndex].pData.mbMediaSegment);
        }
    }
    m_Log.Here(`[Queue] Removing ${this[nIndex]}`);
    this.splice(nIndex, 1);
  }
};

g_maQueue.Clear = function () {
  this.Remove(0, this.length);
};

g_maQueue.ShowState = function () {
  m_Log.Here(`[Queue] ${this.join(" ")}`);
};

class NumberInput {
  constructor(sSettingName, nStep, nPrecision, sNodeId) {
    Check(nPrecision >= 0 && IsNonEmptyString(sNodeId));
    this._sSettingName = sSettingName;
    this._nStep = nStep;
    this._nPrecision = nPrecision;
    this._nToAdd = 0;
    this._nInterval = 0;
    this._nTimer = 0;
    m_Events.AddHandler(
      `dragger-drag-${sNodeId}`,
      (oParameters) => this._HandleDrag(oParameters)
    );
    this._nodeNumber = document.querySelector(`#${sNodeId} > .numberinput-number`);
    this.Update();
  }
  Update(nValue = m_Settings.Get(this._sSettingName)) {
    this._nodeNumber.value =
      nValue === AUTO_SETTING
        ? GetText(
          m_Settings.GetSettingParameters(this._sSettingName)
            .sAutoTune
        )
        : m_i18n.FormatNumber(nValue, this._nPrecision);
  }
  _HandleDrag(oParameters) {
    const VALUE_CHANGE_INTERVAL = 130;
    if (oParameters.nStep === 1) {
      this._nToAdd = oParameters.nodePressed.classList.contains("numberinput-minus")
        ? -this._nStep
        : this._nStep;
      this._nInterval = 0;
      this._nTimer = setInterval(
        () => this._HandleTimer(),
        VALUE_CHANGE_INTERVAL
      );
      this._HandleTimer();
    }
    if (oParameters.nStep === 3) {
      clearInterval(this._nTimer);
    }
  }
}

NumberInput.prototype._HandleTimer = AddExceptionHandler(
  function () {
    const VALUE_CHANGE_DELAY = 3;
    if (
      ++this._nInterval == 1 ||
      this._nInterval > VALUE_CHANGE_DELAY
    ) {
      const oSettingParameters = m_Settings.GetSettingParameters(
        this._sSettingName
      );
      const nValue = m_Settings.Get(this._sSettingName);
      let nNewValue;
      if (
        (oSettingParameters.sAutoTune &&
          this._nToAdd < 0 &&
          nValue === oSettingParameters.nMinimum) ||
        (oSettingParameters.sAutoTune &&
          this._nToAdd > 0 &&
          nValue === oSettingParameters.nMaximum)
      ) {
        nNewValue = AUTO_SETTING;
      } else if (nValue === AUTO_SETTING && this._nToAdd > 0) {
        nNewValue = oSettingParameters.nMinimum;
      } else if (nValue === AUTO_SETTING && this._nToAdd < 0) {
        nNewValue = oSettingParameters.nMaximum;
      } else {
        nNewValue = nValue + this._nToAdd;
      }
      if (nNewValue !== AUTO_SETTING) {
        nNewValue = Clamp(
          Round(nNewValue, this._nPrecision),
          oSettingParameters.nMinimum,
          oSettingParameters.nMaximum
        );
      }
      if (nNewValue !== nValue) {
        m_Settings.Change(this._sSettingName, nNewValue);
        this.Update(nNewValue);
        this.AfterChange(nNewValue);
      }
    }
  }
);

NumberInput.prototype.AfterChange = STUB;

function Terminate(bFast) {
  try {
    g_bWorkFinished = true;
    m_Log.Wow("[Launcher] Shutting down");
    window.stop();
    if (!bFast) {
      m_Transcoder.Stop();
      m_Player.Stop();
    }
    m_Log.Wow("[Launcher] Work ended");
  } catch (_) { }
}

