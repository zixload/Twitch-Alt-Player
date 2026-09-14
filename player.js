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

const m_Controls = (() => {
  const SEEK_BY_ARROWS_BY = 5;
  const SEEK_BY_FRAMES_BY = 3;
  const BROADCAST_TITLE_UNKNOWN = "• • •";
  let _nState;
  let _oPlaybackStart,
    _oBufferSize,
    _oBufferStretch,
    _oReplayDuration;
  let _oAutoHideInterval;
  function startWheelVolumeChange() {
    document.removeEventListener("pointerdown", handleWheelPress);
    document.removeEventListener("wheel", handleWheelRotate);
    if (m_Settings.Get("bWheelVolume")) {
      document.addEventListener("pointerdown", handleWheelPress);
      if (m_Settings.Get("nWheelVolumeStep") !== 0) {
        document.addEventListener("wheel", handleWheelRotate, {
          passive: false,
        });
      }
    }
  }
  const handleWheelPress = createElementEventHandler(
    (oEvent) => {
      if (
        !(
          oEvent.button !== MIDDLE_BUTTON ||
          oEvent.shiftKey ||
          oEvent.ctrlKey ||
          oEvent.altKey ||
          oEvent.metaKey ||
          IsLinkEvent(oEvent)
        )
      ) {
        oEvent.preventDefault();
        SaveAndApplyVolume(!m_Settings.Get("bMute"));
      }
    }
  );
  const handleWheelRotate = AddExceptionHandler((oEvent) => {
    if (
      !(
        oEvent.shiftKey ||
        oEvent.ctrlKey ||
        oEvent.altKey ||
        oEvent.metaKey ||
        ElementAtThisPointCanScroll(oEvent.clientX, oEvent.clientY)
      )
    ) {
      oEvent.preventDefault();
      m_Log.Here(
        `[Controls] Wheel movement deltaY=${oEvent.deltaY} deltaMode=${oEvent.deltaMode}`
      );
      if (oEvent.deltaY !== 0) {
        SaveAndApplyVolume(
          void 0,
          Clamp(
            m_Settings.Get("nVolume2") -
            m_Settings.Get("nWheelVolumeStep") *
            Math.sign(oEvent.deltaY),
            MIN_VOLUME,
            MAX_VOLUME
          )
        );
      }
    }
  });
  function ApplyImageScaling() {
    GetNode("eye").classList.toggle(
      "scaled",
      m_Settings.Get("bScaleImage")
    );
  }
  function ApplyInterfaceAnimation() {
    document.body.classList.toggle(
      "interfaceanimation",
      m_Settings.Get("bInterfaceAnimation")
    );
  }
  function StopWatchingBroadcast() {
    if (
      _nState === STATE_STOP ||
      _nState === STATE_REPEAT
    ) {
      return false;
    }
    m_Log.Wow("[Controls] Stopping broadcast viewing");
    m_Playlist.Stop();
    m_Transcoder.Stop();
    g_maQueue.Clear();
    g_maQueue.Add(new Segment(PROCESSING_CONVERTED, STATE_REPEAT));
    m_Player.AddNextSegment();
    return true;
  }
  function ToggleWatchingBroadcast() {
    if (!StopWatchingBroadcast()) {
      m_Log.Wow("[Controls] Starting broadcast viewing");
      g_maQueue.Clear();
      m_Player.Reload(STATE_START);
      m_Playlist.Start();
    }
  }
  function ToggleStatisticsWindow() {
    if (m_Statistics.WindowOpened()) {
      m_Statistics.CloseWindow();
    } else {
      m_Statistics.OpenWindow();
    }
  }
  function ToggleColourCheck(oEvent) {
    if (document.body.classList.toggle("colourcheck")) {
      document.body.classList.toggle("colourcheckbackground", !oEvent.shiftKey);
      m_News.OpenHelp();
    } else {
      document.body.classList.remove("colourcheckbackground");
    }
  }
  function CopyTextToClipboard(sText) {
    Check(typeof sText == "string");
    if (sText === "") {
      m_Notification.ShowAss();
      return;
    }
    navigator.clipboard
      .writeText(sText)
      .then(
        () => {
          m_Log.Here("[Controls] Copy to clipboard finished");
          m_Notification.ShowHappiness();
        },
        (pReason) => {
          m_Log.Oops(
            `[Controls] Error copying to clipboard: ${pReason}`
          );
          m_Notification.ShowAss();
        }
      )
      .catch(m_Debug.CaughtException);
  }
  function CopyBroadcastUrlToClipboard() {
    if (CopyBroadcastUrlToClipboard.bInProgress) {
      return;
    }
    CopyBroadcastUrlToClipboard.bInProgress = true;
    m_Log.Wow("[Controls] Getting broadcast address to copy");
    m_Twitch
      .GetAbsoluteVariantListUrl(null, true, false)
      .then((sResult) => {
        m_Log.Here("[Controls] Copying broadcast address to clipboard");
        return navigator.clipboard.writeText(sResult).then(
          () => {
            CopyBroadcastUrlToClipboard.bInProgress = false;
            m_Log.Here("[Controls] Copy to clipboard finished");
            m_Controls.StopWatchingBroadcast();
            m_Notification.ShowHappiness();
          },
          (pReason) => {
            throw `Error copying to clipboard: ${pReason}`;
          }
        );
      })
      .catch(
        AddExceptionHandler((pReason) => {
          CopyBroadcastUrlToClipboard.bInProgress = false;
          if (typeof pReason == "string") {
            m_Log.Oops(
              `[Controls] Error copying broadcast address to clipboard: ${pReason}`
            );
            m_Notification.ShowAss();
          } else {
            throw pReason;
          }
        })
      );
  }
  const HandleVolumeChange = AddExceptionHandler(
    (oEvent) => {
      SaveAndApplyVolume(false, oEvent.target.valueAsNumber);
    }
  );
  function SaveAndApplyVolume(bMute, nVolume) {
    Check(bMute !== void 0 || nVolume !== void 0);
    if (document.body.classList.contains("noaudio")) {
      return;
    }
    if (bMute !== void 0) {
      m_Settings.Change("bMute", bMute);
    }
    if (nVolume !== void 0) {
      m_Settings.Change("nVolume2", Math.round(nVolume));
    }
    m_Player.ApplyVolume();
    UpdateVolume();
    m_AutoHide.Show();
  }
  function UpdateVolume() {
    const nVolume = m_Settings.Get("nVolume2");
    const nodeVolume = GetNode("volume");
    nodeVolume.value = nVolume;
    nodeVolume.style.setProperty(
      "--width",
      `${((nVolume - MIN_VOLUME) / (100 - MIN_VOLUME)) *
      100
      }%`
    );
    ChangeButton(
      "togglemute",
      m_Settings.Get("bMute")
    );
  }
  function UpdateTrackCount(bHasVideo, bHasAudio) {
    document.body.classList.toggle("novideo", !bHasVideo);
    document.body.classList.toggle("noaudio", !bHasAudio);
  }
  function ChangeViewerChannelSubscription(nSubscription) {
    if (
      !document
        .getElementById("viewer-subscription")
        .classList.contains("updating")
    ) {
      m_Twitch.ChangeViewerChannelSubscription(nSubscription);
    }
  }
  const HandleLeftClick = createElementEventHandler((oEvent) => {
    if (oEvent.button !== LEFT_BUTTON) {
      return;
    }
    const nodeClick = oEvent.target;
    let nodeCallsign = nodeClick;
    let sCallsign = nodeCallsign.id || nodeCallsign.name;
    if (!sCallsign && nodeClick.parentNode) {
      nodeCallsign = nodeClick.parentNode;
      sCallsign = nodeCallsign.id || nodeCallsign.name;
    }
    oEvent.nodeCallsign = nodeCallsign;
    oEvent.sCallsign = sCallsign;
    m_Events.SendEvent("controls-leftclick", oEvent);
    switch (sCallsign) {
      case "togglebroadcast":
        ToggleWatchingBroadcast();
        break;

      case "togglepause":
        if (_nState === STATE_REPEAT) {
          m_Player.TogglePause();
        }
        break;

      case "togglemute":
        SaveAndApplyVolume(!m_Settings.Get("bMute"));
        break;

      case "togglechat":
        m_Chat.TogglePanelState();
        break;

      case "createclip":
        m_Twitch.CreateClip();
        break;

      case "togglepictureinpicture":
        m_PictureInPicture.toggle();
        break;

      case "togglefullscreen":
        m_FullscreenMode.Toggle();
        break;

      case "concurrentdownloads":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nConcurrentDownloads",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Statistics.ClearHistory();
        break;

      case "interfaceanimation":
        m_Settings.Change("bInterfaceAnimation", nodeClick.checked);
        ApplyInterfaceAnimation();
        break;

      case "scaleimage":
        m_Settings.Change("bScaleImage", nodeClick.checked);
        ApplyImageScaling();
        break;

      case "autochatposition":
        m_Settings.Change("bAutoChatPosition", nodeClick.checked);
        UpdateSettingsWindow();
        m_Chat.ApplyPanelPosition();
        break;

      case "horizontalchatposition":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nHorizontalChatPosition",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Chat.ApplyPanelPosition();
        break;

      case "verticalchatposition":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nVerticalChatPosition",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Chat.ApplyPanelPosition();
        break;

      case "chatposition":
        Check(nodeClick.checked);
        m_Settings.Change(
          "nChatPanelPosition",
          Number.parseInt(nodeClick.value, 10)
        );
        m_Chat.ApplyPanelPosition();
        break;

      case "closedchatstate":
        Check(nodeClick.checked);
        m_Chat.SaveAndApplyClosedPanelState(
          Number.parseInt(nodeClick.value, 10)
        );
        break;

      case "togglestatistics":
      case "position":
        ToggleStatisticsWindow();
        break;

      case "opennews":
      case "opennews2":
        m_News.OpenNews();
        break;

      case "openhelp":
        m_News.OpenHelp();
        break;

      case "sendfeedback":
        m_Debug.TerminateAndSendFeedback();
        break;

      case "exportsettings":
        m_Settings.Export();
        break;

      case "importsettings":
        const node = document.getElementById("settingsimportfile");
        node.value = "";
        node.click();
        break;

      case "resetsettings":
        m_Settings.Reset();
        break;

      case "colourcheck":
        ToggleColourCheck(oEvent);
        break;

      case "viewer-follow":
        ChangeViewerChannelSubscription(SUBSCRIPTION_NOTIFY);
        break;

      case "viewer-unfollow":
        ChangeViewerChannelSubscription(SUBSCRIPTION_NOT_SUBSCRIBED);
        break;

      case "viewer-notify":
        ChangeViewerChannelSubscription(
          nodeClick.checked ? SUBSCRIPTION_NOTIFY : SUBSCRIPTION_DO_NOT_NOTIFY
        );
        break;

      case "closestatistics":
        m_Statistics.CloseWindow();
        break;

      case "copychannelurl":
        m_Log.Here("[Controls] Copying channel address to clipboard");
        CopyTextToClipboard(m_Twitch.GetChannelUrl(false));
        break;

      case "copybroadcasturl":
        CopyBroadcastUrlToClipboard();
    }
  });
  const HandleKeyDownAndUp = AddExceptionHandler(
    (oEvent) => {
      const SHIFT_KEY = 1 << 16;
      const CTRL_KEY = 1 << 17;
      const ALT_KEY = 1 << 18;
      const META_KEY = 1 << 19;
      const bPress = oEvent.type === "keydown";
      const bPress1 = bPress && !oEvent.repeat;
      switch (
      oEvent.keyCode +
      oEvent.shiftKey * SHIFT_KEY +
      oEvent.ctrlKey * CTRL_KEY +
      oEvent.altKey * ALT_KEY +
      oEvent.metaKey * META_KEY
      ) {
        case 27:
          oEvent.preventDefault();
          if (bPress1) {
            getSelection().removeAllRanges();
            m_Window.close(false);
            m_AutoHide.Hide(false);
          }
          break;

        case 70:
        case 13:
        case 13 + ALT_KEY:
          if (bPress1) {
            m_FullscreenMode.Toggle();
          }
          break;

        case 13 + SHIFT_KEY:
          if (bPress1) {
            m_PictureInPicture.toggle();
          }
          break;

        case 93:
          if (!bPress) {
            GetNode("eye").focus();
          }
          return;

        case 88:
          if (bPress1) {
            m_Window.toggle("mainmenu");
          }
          break;

        case 67:
          if (bPress1) {
            m_Chat.TogglePanelState();
          }
          break;

        case 86:
          if (bPress1) {
            m_Window.toggle("settings");
          }
          break;

        case 73:
          if (bPress1) {
            m_Window.toggle("channel");
          }
          break;

        case 83:
          if (bPress1) {
            ToggleStatisticsWindow();
          }
          break;

        case 112:
          if (bPress1) {
            m_News.OpenHelp();
          }
          break;

        case 65 + CTRL_KEY:
          break;

        case 85 + CTRL_KEY:
          if (bPress1) {
            m_Chat.TogglePanelPosition();
            UpdateSettingsWindow();
          }
          break;

        case 32:
          if (bPress1) {
            ToggleWatchingBroadcast();
            m_AutoHide.Show();
          }
          break;

        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
        case 48:
          if (bPress1 && _nState === STATE_REPEAT) {
            setReplaySpeed(
              58 - (oEvent.keyCode === 48 ? 58 : oEvent.keyCode)
            );
            m_AutoHide.Show();
          }
          break;

        case 187:
        case 107:
        case 190:
          if (bPress1 && _nState === STATE_REPEAT) {
            setReplaySpeed(-Infinity);
            m_AutoHide.Show();
          }
          break;

        case 189:
        case 109:
        case 188:
          if (bPress1 && _nState === STATE_REPEAT) {
            setReplaySpeed(Infinity);
            m_AutoHide.Show();
          }
          break;

        case 75:
        case 12:
          if (bPress1 && _nState === STATE_REPEAT) {
            m_Player.TogglePause();
            m_AutoHide.Show();
          }
          break;

        case 74:
        case 37:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(
              `[Controls] Seeking by -${SEEK_BY_ARROWS_BY}s`
            );
            m_Player.SeekReplayBy(
              false,
              -SEEK_BY_ARROWS_BY
            );
            m_AutoHide.Show();
          }
          break;

        case 76:
        case 39:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(
              `[Controls] Seeking by +${SEEK_BY_ARROWS_BY}s`
            );
            m_Player.SeekReplayBy(
              false,
              SEEK_BY_ARROWS_BY
            );
            m_AutoHide.Show();
          }
          break;

        case 74 + SHIFT_KEY:
        case 37 + SHIFT_KEY:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(
              `[Controls] Seeking by -${SEEK_BY_FRAMES_BY} frames`
            );
            m_Player.SeekReplayBy(
              true,
              -SEEK_BY_FRAMES_BY
            );
          }
          break;

        case 76 + SHIFT_KEY:
        case 39 + SHIFT_KEY:
          if (bPress && _nState === STATE_REPEAT) {
            m_Log.Wow(`[Controls] Seeking by +1 frame`);
            m_Player.SeekReplayBy(true, 1);
          }
          break;

        case 38:
          if (bPress) {
            SaveAndApplyVolume(
              false,
              Math.min(
                m_Settings.Get("nVolume2") +
                VOLUME_INCREASE_STEP_BY_KEY,
                MAX_VOLUME
              )
            );
          }
          break;

        case 40:
          if (bPress) {
            SaveAndApplyVolume(
              false,
              Math.max(
                m_Settings.Get("nVolume2") -
                VOLUME_DECREASE_STEP_BY_KEY,
                MIN_VOLUME
              )
            );
          }
          break;

        case 33:
          if (bPress1) {
            SaveAndApplyVolume(false);
          }
          break;

        case 34:
          if (bPress1) {
            SaveAndApplyVolume(true);
          }
          break;

        case 77:
          if (bPress1) {
            SaveAndApplyVolume(!m_Settings.Get("bMute"));
          }
          break;

        case 73 + CTRL_KEY:
          if (bPress1) {
            const bScaleImage = m_Settings.Get(
              "bScaleImage"
            );
            m_Settings.Change(
              "bScaleImage",
              !bScaleImage
            );
            UpdateSettingsWindow();
            ApplyImageScaling();
            m_Notification.Show(
              `svg-fullscreen-${bScaleImage}`,
              false
            );
          }
          break;

        case 88 + ALT_KEY:
          if (bPress1) {
            m_Twitch.CreateClip();
          }
          break;

        default:
          return;
      }
      oEvent.preventDefault();
    }
  );
  function UpdateSettingsWindow() {
    document.querySelector(
      `input[name="concurrentdownloads"][value="${m_Settings.Get(
        "nConcurrentDownloads"
      )}"]`
    ).checked = true;
    document.querySelector(
      `input[name="closedchatstate"][value="${m_Settings.Get(
        "nClosedChatState"
      )}"]`
    ).checked = true;
    GetNode("chaturl").selectedIndex = m_Settings.Get("bFullChat")
      ? 0
      : m_Settings.Get("bDimChat")
        ? 2
        : 1;
    GetNode("scaleimage").checked = m_Settings.Get(
      "bScaleImage"
    );
    GetNode("interfaceanimation").checked = m_Settings.Get(
      "bInterfaceAnimation"
    );
    GetNode("wheelvolume").value = m_Settings.Get(
      "bWheelVolume"
    )
      ? m_Settings.Get("nWheelVolumeStep")
      : "";
    const bAutoPosition = m_Settings.Get("bAutoChatPosition");
    GetNode("autochatposition").checked = bAutoPosition;
    const snodeSides = document.querySelectorAll(".chatposition input");
    if (bAutoPosition) {
      const nHorizontalPosition = m_Settings.Get(
        "nHorizontalChatPosition"
      );
      const nVerticalPosition = m_Settings.Get(
        "nVerticalChatPosition"
      );
      let nodeHorizontalPosition, nodeVerticalPosition;
      for (let nodeSide of snodeSides) {
        const nSide = Number.parseInt(nodeSide.value, 10);
        if (nHorizontalPosition === nSide) {
          nodeHorizontalPosition = nodeSide;
        }
        if (nVerticalPosition === nSide) {
          nodeVerticalPosition = nodeSide;
        }
        nodeSide.name =
          nSide === RIGHT_SIDE || nSide === LEFT_SIDE
            ? "horizontalchatposition"
            : "verticalchatposition";
      }
      nodeHorizontalPosition.checked =
        nodeVerticalPosition.checked = true;
    } else {
      const nPosition = m_Settings.Get("nChatPanelPosition");
      let nodePosition;
      for (let nodeSide of snodeSides) {
        if (nPosition === Number.parseInt(nodeSide.value, 10)) {
          nodePosition = nodeSide;
        }
        nodeSide.name = "chatposition";
      }
      nodePosition.checked = true;
    }
    if (_oPlaybackStart) {
      _oPlaybackStart.Update();
      _oBufferSize.Update();
      _oBufferStretch.Update();
      _oReplayDuration.Update();
      _oAutoHideInterval.Update();
    } else {
      _oPlaybackStart = new NumberInput(
        "nPlaybackStart",
        0.5,
        1,
        "playbackstart"
      );
      _oBufferSize = new NumberInput("nBufferSize", 0.5, 1, "buffersize");
      _oBufferStretch = new NumberInput(
        "nBufferStretch",
        0.5,
        1,
        "bufferstretch"
      );
      _oReplayDuration = new NumberInput(
        "nReplayDuration2",
        30,
        0,
        "replayduration"
      );
      _oPlaybackStart.AfterChange =
        _oBufferSize.AfterChange =
        _oBufferStretch.AfterChange =
        m_Statistics.ClearHistory;
      _oAutoHideInterval = new NumberInput(
        "nAutoHideInterval",
        0.5,
        1,
        "autohideinterval"
      );
    }
  }
  function HandleMainMenuOpen() {
    const elItem = GetNode("recordingurl");
    const sAddress = m_Twitch.GetRecordingUrlForCurrentPosition();
    if (sAddress) {
      elItem.href = sAddress;
      m_Menu.setItemAvailability(elItem, true);
    } else {
      elItem.removeAttribute("href");
      m_Menu.setItemAvailability(elItem, false);
    }
  }
  function HandlePause(bPause) {
    ChangeButton("togglepause", bPause);
  }
  function HandleBufferingPresetChange() {
    UpdateSettingsWindow();
    m_Statistics.ClearHistory();
  }
  function getReplaySpeed() {
    const nodeSpeed = GetNode("speed");
    if (nodeSpeed.options[0].text === "") {
      for (const node of nodeSpeed.options) {
        node.text = node.defaultSelected
          ? "1x"
          : m_i18n.FormatNumber(node.value, 2);
      }
    }
    const nSpeed = Number.parseFloat(nodeSpeed.value);
    Check(nSpeed > 0);
    return nSpeed;
  }
  function setReplaySpeed(nCode) {
    const nodeSpeed = GetNode("speed");
    if (!Number.isSafeInteger(nCode)) {
      Check(
        nodeSpeed.selectedIndex >= 0 &&
        (nCode === -Infinity || nCode === Infinity)
      );
      nCode = nodeSpeed.selectedIndex + Math.sign(nCode);
    }
    if (nCode >= 0 && nCode < nodeSpeed.options.length) {
      nodeSpeed.selectedIndex = nCode;
      m_Player.SetReplaySpeed(getReplaySpeed());
    }
  }
  const HandlePlaybackSpeedChange =
    AddExceptionHandler((oEvent) => {
      if (_nState === STATE_REPEAT) {
        m_Player.SetReplaySpeed(getReplaySpeed());
      }
    });
  const HandleBroadcastVariantChange = AddExceptionHandler(
    ({ target: { selectedIndex } }) => {
      if (selectedIndex !== -1) {
        m_Log.Wow(`[Controls] Variant selected ${selectedIndex}`);
        m_Playlist.ChangeBroadcastVariant(selectedIndex);
      }
    }
  );
  const HandleWheelVolumeChange = AddExceptionHandler(
    (oEvent) => {
      if (oEvent.target.value) {
        m_Settings.Change("bWheelVolume", true);
        m_Settings.Change(
          "nWheelVolumeStep",
          Number(oEvent.target.value)
        );
      } else {
        m_Settings.Change("bWheelVolume", false);
      }
      startWheelVolumeChange();
    }
  );
  const HandleChatUrlChange = AddExceptionHandler(
    (oEvent) => {
      m_Log.Wow(
        `[Controls] Chat address selected ${oEvent.target.selectedIndex}`
      );
      switch (oEvent.target.selectedIndex) {
        case 0:
          m_Settings.Change("bFullChat", true);
          break;

        case 1:
          m_Settings.Change("bFullChat", false);
          m_Settings.Change("bDimChat", false);
          break;

        case 2:
          m_Settings.Change("bFullChat", false);
          m_Settings.Change("bDimChat", true);
          break;

        default:
          Check(false);
      }
      m_Chat.ApplyUrl();
    }
  );
  const HandleSettingsImportFileChoice = AddExceptionHandler(
    (oEvent) => {
      if (oEvent.target.files.length === 1) {
        m_Settings.Import(oEvent.target.files[0]);
      }
    }
  );
  function UpdateBroadcastVariantList([moVariants, oSelectedVariant]) {
    const nodeList = GetNode("broadcastvariant");
    nodeList.length = 0;
    if (moVariants) {
      for (const oVariant of moVariants) {
        let sLabel = oVariant.sLabel;
        if (sLabel === "audio_only") {
          sLabel = GetText("J0144");
        } else if (sLabel.endsWith("(source)")) {
          sLabel = sLabel.slice(0, -8) + GetText("J0139");
        }
        nodeList.add(
          new Option(
            sLabel,
            void 0,
            oVariant === oSelectedVariant,
            oVariant === oSelectedVariant
          )
        );
      }
    }
    nodeList.disabled = nodeList.length < 2;
  }
  function handleAdStart() {
    document.body.classList.add("advert");
  }
  function handleAdEnd() {
    document.body.classList.remove("advert");
  }
  function handleBufferOverflow() {
    m_Notification.Show("svg-cut", true);
  }
  function Start() {
    Check(_nState === void 0);
    GetNode("broadcasttitle").href = m_Twitch.GetChannelUrl(true);
    const nodeVolume = GetNode("volume");
    nodeVolume.min = MIN_VOLUME;
    nodeVolume.addEventListener("input", HandleVolumeChange);
    UpdateVolume();
    UpdateSettingsWindow();
    m_Settings.ConfigurePresetLists();
    m_AutoHide.Start();
    m_AutoHide.Show();
    m_News.Start();
    m_Chat.Restore();
    m_Events.AddHandler(
      "window-opened-mainmenu",
      HandleMainMenuOpen
    );
    m_Events.AddHandler(
      "playlist-broadcastvariantselected",
      UpdateBroadcastVariantList
    );
    m_Events.AddHandler(
      "playlist-adstart",
      handleAdStart
    );
    m_Events.AddHandler("playlist-adend", handleAdEnd);
    m_Events.AddHandler(
      "player-bufferoverflow",
      handleBufferOverflow
    );
    m_Events.AddHandler("player-paused", HandlePause);
    m_Events.AddHandler(
      "settings-presetchanged-buffering",
      HandleBufferingPresetChange
    );
    m_Events.AddHandler(
      "twitch-channelmetadatareceived",
      ShowChannelMetadata
    );
    m_Events.AddHandler(
      "twitch-viewermetadatareceived",
      ShowViewerMetadata
    );
    m_Events.AddHandler(
      "twitch-broadcastmetadatareceived",
      ShowBroadcastMetadata
    );
    document.documentElement.addEventListener("click", HandleLeftClick);
    document.addEventListener("keydown", HandleKeyDownAndUp);
    document.addEventListener("keyup", HandleKeyDownAndUp);
    GetNode("speed").addEventListener(
      "change",
      HandlePlaybackSpeedChange
    );
    GetNode("broadcastvariant").addEventListener(
      "change",
      HandleBroadcastVariantChange
    );
    GetNode("wheelvolume").addEventListener(
      "change",
      HandleWheelVolumeChange
    );
    GetNode("chaturl").addEventListener("change", HandleChatUrlChange);
    GetNode("settingsimportfile").addEventListener(
      "change",
      HandleSettingsImportFileChoice
    );
    startWheelVolumeChange();
    ChangeState(STATE_START);
    ApplyImageScaling();
    ApplyInterfaceAnimation();
    m_Appearance.Start();
  }
  function ChangeState(nNewState) {
    Check(Number.isInteger(nNewState));
    if (_nState === nNewState) {
      return;
    }
    m_Log.Here(
      `[Controls] Broadcast state changed from ${_nState} to ${nNewState}`
    );
    _nState = nNewState;
    document.body.setAttribute("data-state", nNewState);
    ChangeButton(
      "togglebroadcast",
      nNewState === STATE_STOP ||
      nNewState === STATE_REPEAT
    );
    m_Events.SendEvent("controls-statechanged", nNewState);
    switch (nNewState) {
      case STATE_START:
        ShowBroadcastMetadata({
          sBroadcastType: null,
          sBroadcastTitle: BROADCAST_TITLE_UNKNOWN,
          sGameName: null,
          sGameUrl: null,
          kViewers: null,
          nBroadcastDuration: null,
        });
        m_Twitch.FinishCollectingBroadcastMetadata(true);
        break;

      case STATE_BROADCAST_START:
        ShowBroadcastMetadata({
          sBroadcastType: null,
          sBroadcastTitle: BROADCAST_TITLE_UNKNOWN,
          sGameName: null,
          sGameUrl: null,
          kViewers: null,
          nBroadcastDuration: null,
        });
        m_Twitch.StartCollectingBroadcastMetadata();
        break;

      case STATE_BROADCAST_END:
        ShowBroadcastMetadata({
          sBroadcastType: "ended",
          kViewers: null,
          nBroadcastDuration: null,
        });
        m_Twitch.FinishCollectingBroadcastMetadata(true);
        GetNode("statistics-broadcastlatency").textContent = "";
        break;

      case STATE_LOADING:
      case STATE_PLAYBACK_START:
      case STATE_PLAYING:
        break;

      case STATE_STOP:
      case STATE_REPEAT:
        ShowBroadcastMetadata({
          kViewers: null,
        });
        m_Twitch.FinishCollectingBroadcastMetadata(false);
        GetNode("statistics-broadcastlatency").textContent = "";
        break;

      default:
        Check(false);
    }
  }
  function GetState() {
    Check(_nState !== void 0);
    return _nState;
  }
  function ShowChannelMetadata(oMetadata) {
    if (oMetadata.sName !== void 0) {
      ChangeDocumentTitle(
        `${oMetadata.sName} - Alternate Player for Twitch.tv`
      );
      GetNode("channel-name").textContent = oMetadata.sName;
    }
    if (oMetadata.sAvatar !== void 0) {
      Check(oMetadata.sAvatar);
      GetNode("channel-avatar").src = oMetadata.sAvatar;
    }
    if (oMetadata.sDescription !== void 0) {
      GetNode("channel-description").textContent = oMetadata.sDescription || "";
    }
    if (oMetadata.sLanguageCode !== void 0) {
      const node = GetNode("channel-language");
      if (oMetadata.sLanguageCode) {
        node.textContent = m_i18n.GetLanguageName(oMetadata.sLanguageCode);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.kSubscribers !== void 0) {
      const node = GetNode("channel-subscribers");
      if (Number.isFinite(oMetadata.kSubscribers)) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kSubscribers);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.nChannelCreated !== void 0) {
      const node = GetNode("channel-created");
      if (Number.isFinite(oMetadata.nChannelCreated)) {
        node.textContent = m_i18n.FormatDate(oMetadata.nChannelCreated);
        ShowElement(node.parentNode, true);
      } else {
        ShowElement(node.parentNode, false);
      }
    }
    if (oMetadata.moTeams !== void 0) {
      ShowLinkArray(oMetadata.moTeams, "channel-teams");
    }
  }
  function ShowLinkArray(moLinks, pInsert) {
    const nodeInsert = GetNode(pInsert);
    if (moLinks.length === 0) {
      ShowElement(nodeInsert.parentNode, false);
    } else {
      const oFragment = document.createDocumentFragment();
      for (let oLink, idx = 0; (oLink = moLinks[idx]); ++idx) {
        if (idx !== 0) {
          oFragment.appendChild(document.createTextNode(", "));
        }
        Check(
          IsNonEmptyString(oLink.sAddress) && IsNonEmptyString(oLink.sName)
        );
        const nodeLink = document.createElement("a");
        nodeLink.href = oLink.sAddress;
        nodeLink.rel = "noopener noreferrer";
        nodeLink.target = "_blank";
        if (oLink.sDescription) {
          nodeLink.className = "channel-link";
          nodeLink.title = oLink.sDescription;
        }
        nodeLink.textContent = oLink.sName;
        oFragment.appendChild(nodeLink);
      }
      nodeInsert.textContent = "";
      nodeInsert.appendChild(oFragment);
      ShowElement(nodeInsert.parentNode, true);
    }
  }
  function ShowViewerMetadata(oMetadata) {
    if (oMetadata.sName !== void 0) {
      if (oMetadata.sName !== "") {
        GetNode("viewer-name").textContent = oMetadata.sName;
      } else {
        m_i18n.InsertAdjacentHtmlMessage("viewer-name", "content", "F0590");
      }
    }
    if (oMetadata.nSubscription !== void 0) {
      const node = GetNode("viewer-subscription");
      if (oMetadata.nSubscription === SUBSCRIPTION_UPDATING) {
        node.classList.add("updating");
      } else {
        node.classList.remove("updating");
        node.setAttribute("data-subscription", oMetadata.nSubscription);
        GetNode("viewer-notify").checked =
          oMetadata.nSubscription === SUBSCRIPTION_NOTIFY;
      }
    }
  }
  /*
		Cles de valeurs internes, pas de valeurs de Twitch. Twitch envoie « live » ou « rerun » ;
		le producteur plus bas les traduit en « live », « replay » ou null, et la fin de diffusion
		pose « ended ». Ces trois cles doivent donc suivre le producteur lettre pour lettre --
		elles sont des identifiants d'objet, qu'un renommage de chaines ne voit pas.
	*/
  const _oBroadcastTypes = {
    ended: ["J0145", "J0100", false],
    live: ["J0146", "J0149", true],
    replay: ["J0147", "J0150", false],
  };
  function ShowBroadcastMetadata(oMetadata) {
    if (oMetadata.sBroadcastType !== void 0) {
      const node = GetNode("broadcasttype");
      if (typeof oMetadata.sBroadcastType == "string") {
        Check(_oBroadcastTypes.hasOwnProperty(oMetadata.sBroadcastType));
        node.textContent = GetText(_oBroadcastTypes[oMetadata.sBroadcastType][0]);
        node.parentElement.title = GetText(
          _oBroadcastTypes[oMetadata.sBroadcastType][1]
        );
        node.classList.toggle(
          "livebroadcast",
          _oBroadcastTypes[oMetadata.sBroadcastType][2]
        );
        ShowElement(node.parentElement, true);
      } else {
        ShowElement(node.parentElement, false);
      }
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.sBroadcastTitle !== void 0) {
      Check(oMetadata.sBroadcastTitle !== null);
      const node = GetNode("broadcasttitle");
      node.title = oMetadata.sBroadcastTitle + GetText("J0101");
      node.textContent = oMetadata.sBroadcastTitle;
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.sGameName !== void 0) {
      const node = GetNode("broadcastcategory");
      if (oMetadata.sGameName) {
        node.textContent = oMetadata.sGameName;
        node.title = node.previousElementSibling.title =
          oMetadata.sGameName + GetText("J0102");
        if (oMetadata.sGameUrl) {
          node.href = oMetadata.sGameUrl;
        } else {
          node.removeAttribute("href");
        }
        ShowElement(node, true);
        ShowElement(node.previousElementSibling, true);
      } else {
        ShowElement(node, false);
        ShowElement(node.previousElementSibling, false);
      }
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.kViewers !== void 0) {
      const node = GetNode("viewercount");
      if (
        Number.isFinite(oMetadata.kViewers) &&
        oMetadata.kViewers >= 0
      ) {
        node.textContent = m_i18n.FormatNumber(oMetadata.kViewers);
        ShowElement(node, true);
        ShowElement(node.previousElementSibling, true);
      } else {
        ShowElement(node, false);
        ShowElement(node.previousElementSibling, false);
      }
      m_MediaQuery.updateQuickly();
    }
    if (oMetadata.nBroadcastDuration !== void 0) {
      GetNode("position").textContent =
        Number.isFinite(oMetadata.nBroadcastDuration) &&
          oMetadata.nBroadcastDuration >= 0
          ? m_i18n.SecondsToString(
            oMetadata.nBroadcastDuration / 1e3,
            false
          )
          : "";
    }
  }
  return {
    Start,
    GetState,
    ChangeState,
    getReplaySpeed,
    UpdateTrackCount,
    StopWatchingBroadcast,
  };
})();

const m_Player = (() => {
  const VIDEO_REMOVAL_INTERVAL = 10;
  const BUFFER_EXHAUSTION = (1 / 25) * 7;
  const REPLAY_AVAILABLE_IF_WATCHED = 1;
  const CHECK_SEGMENT_ADDITION = -1;
  const CHECK_PLAYBACK_START = -2;
  const CHECK_PLAYBACK = -3;
  const CHECK_PLAYBACK_STOP = -4;
  const PLAYBACK_IMPOSSIBLE = 0;
  const PLAYBACK_POSSIBLE = 1;
  const PLAYBACK_POSSIBLE_AFTER_SEEK = 2;
  let _oMediaElement;
  let _oMediaSource;
  let _oMediaSourceBuffer = null;
  let _bHasVideoTrack = false;
  let _nPlaybackStarted = 0;
  let _bAsyncOperation = false;
  let _sBufferSize = "nPlaybackStart";
  let _bWaitForBufferFill = true;
  let _nBroadcastOffset = NaN;
  let _bSeekNeeded = false;
  const _oLiveBroadcast = {
    HandleSourceOpen() {
      Check(_oMediaElement.paused);
      _nPlaybackStarted = Math.max(_nPlaybackStarted, 1);
      AddNextSegment();
    },
    HandleProgress() {
      if (!_bAsyncOperation) {
        StartPlayback(
          CheckPlaybackPosition(CHECK_SEGMENT_ADDITION)
        );
      }
    },
    HandleWaiting() { },
    HandlePlaying() {
      if (
        m_Controls.GetState() === STATE_PLAYBACK_START &&
        !_oMediaElement.paused
      ) {
        m_Controls.ChangeState(STATE_PLAYING);
      }
    },
    HandleSeeking: STUB,
    HandleSeeked: StartPlayback,
    HandleEnded() {
      ReloadPlayer(STATE_LOADING);
    },
    HandleTimeUpdate() {
      if (
        !_oMediaElement.seeking &&
        !_oMediaElement.paused &&
        !_oMediaElement.ended
      ) {
        CheckPlaybackPosition(CHECK_PLAYBACK);
      }
    },
  };
  const _oReplay = {
    bPause: true,
    HandleSourceOpen() {
      Check(_oMediaElement.paused);
      _nPlaybackStarted = Math.max(_nPlaybackStarted, 1);
    },
    HandleProgress: STUB,
    HandleWaiting: STUB,
    HandlePlaying: STUB,
    HandleSeeked: STUB,
    HandleSeeking() {
      m_Scale.SetWatched(_oMediaElement.currentTime);
    },
    HandleEnded() {
      if (!this.bPause) {
        _oMediaElement.play();
      }
    },
    HandleTimeUpdate() {
      if (!this.bPause && !_oMediaElement.seeking) {
        this.CheckPlaybackPosition(CHECK_PLAYBACK);
      }
      m_Scale.SetWatched(_oMediaElement.currentTime);
    },
    CheckPlaybackPosition(nTime) {
      Check(Number.isFinite(nTime));
      Check(
        nTime === CHECK_PLAYBACK_START ||
        nTime === CHECK_PLAYBACK ||
        nTime >= 0
      );
      const oBuffer = _oMediaElement.buffered;
      const nLastRegion = oBuffer.length - 1;
      const nCurrentTime = _oMediaElement.currentTime + 1e-4;
      let nSeekTo = nTime >= 0 ? nTime : nCurrentTime;
      let sSeekReason = "";
      for (let bStartFromBeginning = false; ;) {
        let nNeededForPlayback =
          nTime === CHECK_PLAYBACK
            ? BUFFER_EXHAUSTION
            : MIN_BUFFER_SIZE;
        for (let nRegion = 0; nRegion <= nLastRegion; ++nRegion) {
          if (nSeekTo < oBuffer.start(nRegion)) {
            nNeededForPlayback = MIN_BUFFER_SIZE;
            sSeekReason += "Jumping over gap. ";
            nSeekTo = oBuffer.start(nRegion);
          }
          if (
            oBuffer.end(nRegion) - nSeekTo >=
            nNeededForPlayback
          ) {
            break;
          }
        }
        if (this.bPause || nSeekTo < m_Scale.GetEnd()) {
          break;
        }
        if (bStartFromBeginning) {
          ShowState("Oops", `Endless seek Time=${nTime}`);
          return;
        }
        nSeekTo = m_Scale.GetStart();
        sSeekReason += "Starting from beginning. ";
        bStartFromBeginning = true;
      }
      if (nSeekTo !== nCurrentTime) {
        ShowState(
          "Wow",
          `${sSeekReason}Seeking to ${nSeekTo}`
        );
        _oMediaElement.currentTime = nSeekTo;
      }
    },
  };
  let _oBehaviour = _oLiveBroadcast;
  function ShowState(sImportance, sRecord) {
    const oBuffer =
      _oMediaSource.sourceBuffers.length !== 0
        ? _oMediaSource.sourceBuffers[0]
        : null;
    const sBufferRanges = RangesToString(
      oBuffer ? oBuffer.buffered : null
    );
    const sRanges = RangesToString(_oMediaElement.buffered);
    const bRangesEqual = sBufferRanges === sRanges;
    if (
      sImportance === "Here" &&
      ((oBuffer && oBuffer.buffered.length > 1) ||
        _oMediaElement.buffered.length > 1)
    ) {
      sImportance = "Wow";
    }
    if (_oMediaElement.error || !bRangesEqual) {
      sImportance = "Oops";
    }
    m_Log[sImportance](
      `${sRecord.charAt(0) === "[" ? "" : "[Player] "}${sRecord} •••` +
      (oBuffer && oBuffer.updating ? " [U]" : "") +
      (_oMediaElement.paused ? " [P]" : "") +
      (_oMediaElement.seeking ? " [S]" : "") +
      (_oMediaElement.ended ? " [E]" : "") +
      (_oMediaElement.error ? ` error=${_oMediaElement.error.code}` : "") +
      (_oMediaElement.src.startsWith("blob:") ||
        _oMediaElement.src.startsWith("mediasource:")
        ? ""
        : ` src=${_oMediaElement.src}`) +
      (_oMediaSource.readyState === "open"
        ? ""
        : ` MSE.readyState=${_oMediaSource.readyState}`) +
      (_oMediaSource.sourceBuffers.length === 1
        ? ""
        : ` MSE.buffers=${_oMediaSource.sourceBuffers.length}`) +
      (_oMediaElement.networkState === HTMLMediaElement.NETWORK_LOADING
        ? ""
        : ` networkState=${_oMediaElement.networkState}`) +
      ` readyState=${_oMediaElement.readyState}` +
      ` currentTime=${_oMediaElement.currentTime}` +
      (bRangesEqual
        ? ` buffered=${sRanges}`
        : ` MSE.buffered=${sBufferRanges} buffered=${sRanges}`) +
      (_oMediaElement.duration === Infinity
        ? ""
        : ` duration=${_oMediaElement.duration}`) +
      ` seekable=${RangesToString(_oMediaElement.seekable)}` +
      ` played=${RangesToString(_oMediaElement.played)}`
    );
  }
  function RangesToString(oRanges) {
    let sResult = "";
    if (oRanges && oRanges.length !== 0) {
      let nRegion = Math.max(oRanges.length - 5, 0);
      if (nRegion !== 0) {
        sResult = `[${nRegion}]`;
      }
      for (; nRegion < oRanges.length; ++nRegion) {
        if (nRegion !== 0) {
          sResult += `(${(
            oRanges.start(nRegion) - oRanges.end(nRegion - 1)
          ).toFixed(3)})`;
        }
        sResult += `${oRanges.start(nRegion)}-${oRanges.end(nRegion)}`;
      }
    }
    return sResult;
  }
  function GetBufferFill(oBuffer = _oMediaElement.buffered) {
    let nWatched = 0;
    let nUnwatched = 0;
    if (oBuffer.length !== 0) {
      const nStart = oBuffer.start(0);
      const nEnd = oBuffer.end(oBuffer.length - 1);
      const nCurrentTime = Clamp(
        _oMediaElement.currentTime,
        nStart,
        nEnd
      );
      nWatched = nCurrentTime - nStart;
      nUnwatched = nEnd - nCurrentTime;
    }
    return {
      nWatched,
      nUnwatched,
    };
  }
  function GetDroppedFrameCount() {
    return _oMediaElement.getVideoPlaybackQuality
      ? _oMediaElement.getVideoPlaybackQuality()
      : {
        totalVideoFrames: _oMediaElement.webkitDecodedFrameCount,
        droppedVideoFrames: _oMediaElement.webkitDroppedFrameCount,
      };
  }
  function GetBroadcastPlaybackPosition(bForClip) {
    if (Number.isNaN(_nBroadcastOffset)) {
      return -1;
    }
    WatchForErrors();
    let nPlaybackPosition = _oMediaElement.currentTime;
    if (bForClip && m_Controls.GetState() === STATE_REPEAT) {
      nPlaybackPosition = m_Scale.GetEnd();
    }
    if (!bForClip && nPlaybackPosition === 0 && _oMediaSourceBuffer !== null) {
      if (_oMediaSourceBuffer.buffered.length !== 0) {
        nPlaybackPosition = _oMediaSourceBuffer.buffered.start(0);
      }
    }
    return nPlaybackPosition === 0 ? -1 : Math.max(nPlaybackPosition + _nBroadcastOffset, 0);
  }
  function CalculateBroadcastOffset(oSegment) {
    if (
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.nBroadcastPosition)
    ) {
      const nBroadcastOffset =
        oSegment.pData.nBroadcastPosition -
        oSegment.pData.nEncodingPosition;
      m_Log[
        Math.abs(nBroadcastOffset - _nBroadcastOffset) > 2 ? "Oops" : "Here"
      ](
        `[Player] Broadcast offset: ${m_Log.F1(
          nBroadcastOffset
        )}s`
      );
      _nBroadcastOffset = nBroadcastOffset;
    }
  }
  function ShowBroadcastLatency(oSegment) {
    if (
      m_Statistics.WindowOpened() &&
      Number.isFinite(oSegment.pData.nEncodingPosition) &&
      Number.isFinite(oSegment.pData.nEncodingTime) &&
      _oMediaElement.currentTime !== 0
    ) {
      const nFetch =
        (performance.now() +
          g_nExactTime -
          oSegment.pData.nEncodingTime) /
        1e3;
      const nPlayback =
        oSegment.pData.nEncodingPosition - _oMediaElement.currentTime;
      const sLatency = `${nFetch.toFixed(1)} + ${nPlayback.toFixed(
        1
      )} = ${(nFetch + nPlayback).toFixed(1)}`;
      m_Log[nFetch > 0 && nPlayback > -0.1 ? "Here" : "Oops"](
        `[Player] Broadcast latency: ${sLatency}s`
      );
      GetNode("statistics-broadcastlatency").textContent = sLatency;
    }
  }
  function ApplyVolume() {
    _oMediaElement.volume =
      m_Settings.Get("nVolume2") / MAX_VOLUME;
    _oMediaElement.muted = m_Settings.Get("bMute");
  }
  function ReloadAndWaitForBufferFill(nNewState) {
    _bWaitForBufferFill = true;
    ReloadPlayer(nNewState);
  }
  function ReloadPlayer(nNewState) {
    ShowState("Wow", "Reloading player");
    m_Controls.ChangeState(nNewState);
    _oBehaviour = _oLiveBroadcast;
    _oMediaSourceBuffer = null;
    _bSeekNeeded = false;
    attachMediaSourceToMediaElement();
  }
  function WatchForErrors() {
    if (_oMediaElement.error) {
      m_Debug.FinishWorkAndShowMessage("J0206");
    }
  }
  const WatchMediaSourceEvents = AddExceptionHandler(
    (oEvent) => {
      WatchForErrors();
      const sRecord = `[MediaSource] ${oEvent.type}`;
      switch (oEvent.type) {
        case "sourceopen":
          ShowState("Here", sRecord);
          _oBehaviour.HandleSourceOpen();
          break;

        case "sourceended":
        case "sourceclose":
          ShowState("Here", sRecord);
          break;

        default:
          m_Log.Here(sRecord);
      }
    }
  );
  const WatchMediaElementEvents = AddExceptionHandler(
    (oEvent) => {
      WatchForErrors();
      const sRecord = `[MediaElement] ${oEvent.type}`;
      switch (oEvent.type) {
        case "loadstart":
          ShowState(
            "Here",
            `${sRecord} src=${_oMediaElement.src} currentSrc=${_oMediaElement.currentSrc}`
          );
          break;

        case "progress":
          ShowState("Here", sRecord);
          _oBehaviour.HandleProgress();
          break;

        case "abort":
          ShowState("Here", sRecord);
          break;

        case "waiting":
          ShowState("Wow", sRecord);
          _oBehaviour.HandleWaiting();
          break;

        case "playing":
          ShowState("Here", sRecord);
          _oBehaviour.HandlePlaying();
          break;

        case "seeking":
          ShowState("Here", sRecord);
          _oBehaviour.HandleSeeking();
          break;

        case "seeked":
          ShowState("Here", sRecord);
          _oBehaviour.HandleSeeked();
          break;

        case "ended":
          ShowState("Here", sRecord);
          _oBehaviour.HandleEnded();
          break;

        case "timeupdate":
          m_Log.Here(
            `${sRecord} readyState=${_oMediaElement.readyState} currentTime=${_oMediaElement.currentTime
            } Unwatched=${m_Log.F2(
              GetBufferFill().nUnwatched
            )}`
          );
          _oBehaviour.HandleTimeUpdate();
          break;

        default:
          m_Log.Here(sRecord);
      }
    }
  );
  function CheckPlaybackPosition(
    nCheckSource,
    nWillBeAdded = 0
  ) {
    const oBuffer = _oMediaElement.buffered;
    const nLastRegion = oBuffer.length - 1;
    if (nLastRegion === -1) {
      return false;
    }
    const nCurrentTime = _oMediaElement.currentTime + 1e-4;
    let nSeekTo = Math.max(nCurrentTime, oBuffer.start(0));
    let sSeekReason = "";
    const nUnwatched = oBuffer.end(nLastRegion) - nSeekTo;
    if (nCheckSource === CHECK_SEGMENT_ADDITION) {
      const nBufferSize = m_Settings.Get("nMaxBufferSize");
      const nOverflow =
        nBufferSize + m_Settings.Get("nBufferStretch");
      if (nUnwatched <= nOverflow) {
        return;
      }
      if (_nPlaybackStarted === 2) {
        m_Events.SendEvent(
          "player-bufferoverflow",
          nUnwatched - nBufferSize
        );
      }
      sSeekReason += `Player buffer overflow ${nUnwatched.toFixed(
        2
      )}s > ${nOverflow}s. `;
      nSeekTo = oBuffer.end(nLastRegion) - nBufferSize - 0.1;
    }
    if (
      nCheckSource === CHECK_PLAYBACK_START &&
      _nPlaybackStarted !== 2
    ) {
      _nPlaybackStarted = 2;
      const nOverflow =
        m_Settings.Get("nMaxBufferSize") +
        m_Statistics.GetTargetDuration() / 2;
      if (nUnwatched > nOverflow) {
        sSeekReason += `Broadcast latency exceeded ${nUnwatched.toFixed(
          2
        )}s > ${nOverflow}s. `;
        nSeekTo = oBuffer.end(nLastRegion) - nOverflow;
      }
    }
    Check(BUFFER_EXHAUSTION < MIN_BUFFER_SIZE);
    let nNeededForPlayback =
      nCheckSource === CHECK_PLAYBACK
        ? BUFFER_EXHAUSTION
        : nCheckSource === CHECK_PLAYBACK_STOP
          ? Infinity
          : MIN_BUFFER_SIZE;
    let bPlaybackPossible = _oMediaSource.readyState === "ended";
    let nToRangeEnd;
    for (let nRegion = 0; nRegion <= nLastRegion; ++nRegion) {
      if (nSeekTo < oBuffer.start(nRegion)) {
        nNeededForPlayback = MIN_BUFFER_SIZE;
        sSeekReason += "Jumping over gap. ";
        nSeekTo = oBuffer.start(nRegion);
      }
      nToRangeEnd = oBuffer.end(nRegion) - nSeekTo;
      if (nToRangeEnd >= nNeededForPlayback) {
        bPlaybackPossible = true;
        break;
      }
    }
    if (!bPlaybackPossible && !_oMediaElement.paused) {
      BufferExhausted(nToRangeEnd, nUnwatched, nWillBeAdded);
    }
    if (
      (bPlaybackPossible ||
        nCheckSource === CHECK_SEGMENT_ADDITION) &&
      (nSeekTo !== nCurrentTime || _bSeekNeeded)
    ) {
      if (nSeekTo === nCurrentTime) {
        nSeekTo = _oMediaElement.currentTime;
      }
      ShowState(
        sSeekReason ? "Oops" : "Wow",
        `${sSeekReason}Seeking to ${nSeekTo}`
      );
      _bSeekNeeded = false;
      _oMediaElement.currentTime = nSeekTo;
      return PLAYBACK_POSSIBLE_AFTER_SEEK;
    }
    return bPlaybackPossible
      ? PLAYBACK_POSSIBLE
      : PLAYBACK_IMPOSSIBLE;
  }
  function StartPlayback(nCheck) {
    if (
      _oMediaElement.seeking ||
      nCheck === PLAYBACK_POSSIBLE_AFTER_SEEK ||
      !_oMediaElement.paused ||
      _oMediaElement.ended
    ) {
      return;
    }
    if (_bWaitForBufferFill && _oMediaSource.readyState !== "ended") {
      const { nUnwatched } = GetBufferFill();
      const nBufferSize = m_Settings.Get(_sBufferSize);
      if (nUnwatched < nBufferSize) {
        m_Log.Here(
          `[Player] Unwatched in buffer ${m_Log.F3(
            nUnwatched
          )}s < ${nBufferSize}s`
        );
        return;
      }
      m_Log.Wow(
        `[Player] Unwatched in buffer ${m_Log.F3(
          nUnwatched
        )}s >= ${nBufferSize}s`
      );
    } else {
      m_Log.Wow("[Player] No need to wait for the buffer to fill");
    }
    switch (CheckPlaybackPosition(CHECK_PLAYBACK_START)) {
      case PLAYBACK_IMPOSSIBLE:
        ShowState(
          "Oops",
          `No range >= ${MIN_BUFFER_SIZE}s found to start playback`
        );
        _bWaitForBufferFill = true;
        break;

      case PLAYBACK_POSSIBLE:
        ShowState("Wow", "Playback start");
        _bWaitForBufferFill = true;
        _oMediaElement.play();
        m_Controls.ChangeState(STATE_PLAYBACK_START);
    }
  }
  function StopPlayback(nNewState) {
    if (nNewState !== void 0) {
      m_Controls.ChangeState(nNewState);
    }
    _oMediaElement.pause();
  }
  function BufferExhausted(
    nToLastRangeEnd,
    nUnwatched,
    nWillBeAdded
  ) {
    Check(_oMediaSource.readyState !== "ended");
    Check(nToLastRangeEnd < MIN_BUFFER_SIZE);
    const bEarly = nUnwatched > 1;
    m_Statistics.PlayerBufferExhausted(bEarly);
    _sBufferSize = "nMaxBufferSize";
    const nBufferSize = m_Settings.Get(_sBufferSize);
    if (
      nToLastRangeEnd + nWillBeAdded >= MIN_BUFFER_SIZE &&
      nUnwatched + nWillBeAdded >= nBufferSize
    ) {
      ShowState(
        bEarly ? "Oops" : "Wow",
        `Buffer exhausted, no stop needed WillBeAdded=${m_Log.F3(
          nWillBeAdded
        )}s ToLastRangeEnd=${m_Log.F3(
          nToLastRangeEnd
        )}s Unwatched=${m_Log.F3(
          nUnwatched
        )}s BufferSize=${nBufferSize}s`
      );
    } else {
      ShowState(
        bEarly ? "Oops" : "Wow",
        `Pausing playback to fill the buffer ToLastRangeEnd=${m_Log.F3(
          nToLastRangeEnd
        )}s Unwatched=${m_Log.F3(
          nUnwatched
        )}s BufferSize=${nBufferSize}s`
      );
      _bSeekNeeded = true;
      StopPlayback(STATE_LOADING);
    }
  }
  function EndStream(oSegment) {
    ShowState(
      "Wow",
      `Segment ${oSegment.nNumber} caused end of stream`
    );
    if (
      _oMediaElement.buffered.length === 0 ||
      (_oMediaElement.paused &&
        GetBufferFill().nUnwatched < BUFFER_EXHAUSTION + 0.1)
    ) {
      ReloadAndWaitForBufferFill(STATE_LOADING);
    } else {
      _bWaitForBufferFill =
        typeof oSegment.pData == "number" ||
        (!_oMediaElement.seeking && _oMediaElement.paused);
      _oMediaSource.endOfStream();
      StartPlayback();
    }
  }
  function RemoveWatchedVideo(oSegment) {
    const MAX_AUDIO_REPLAY_DURATION = 640;
    WatchForErrors();
    let nReplayDuration = m_Settings.Get("nReplayDuration2");
    if (nReplayDuration === AUTO_SETTING) {
      if (_bHasVideoTrack) {
        return Promise.resolve(oSegment);
      }
      nReplayDuration = MAX_AUDIO_REPLAY_DURATION;
    }
    const { nWatched } = GetBufferFill(
      _oMediaSourceBuffer.buffered
    );
    if (nWatched < nReplayDuration + VIDEO_REMOVAL_INTERVAL) {
      return Promise.resolve(oSegment);
    }
    const nRemoveUntil = _oMediaElement.currentTime - nReplayDuration;
    return new Promise((fResolve, fReject) => {
      ShowState(
        "Here",
        `Removing watched video Watched=${m_Log.F3(
          nWatched
        )}s RemoveUntil=${m_Log.F3(nRemoveUntil)}s`
      );
      _oMediaSourceBuffer.addEventListener("updateend", Removed);
      let nElapsedTime = -performance.now();
      _oMediaSourceBuffer.remove(0, nRemoveUntil);
      function Removed() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
          } else {
            nElapsedTime += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Removed);
            const { nWatched } = GetBufferFill(
              _oMediaSourceBuffer.buffered
            );
            ShowState(
              nElapsedTime > 100 || nWatched < MIN_BUFFER_SIZE
                ? "Oops"
                : "Here",
              `Watched video removed in ${m_Log.F0(
                nElapsedTime
              )}ms Watched=${m_Log.F0(nWatched)}s`
            );
            fResolve(oSegment);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function AppendInitSegment(oSegment) {
    return AppendSegment(
      oSegment,
      oSegment.pData.mbInitializationSegment,
      "initialisation segment"
    );
  }
  function AppendMediaSegment(oSegment) {
    return AppendSegment(
      oSegment,
      oSegment.pData.mbMediaSegment,
      "mediasegment"
    );
  }
  function AppendSegment(oSegment, mbAppend, sAppend) {
    WatchForErrors();
    return new Promise((fResolve, fReject) => {
      ShowState("Here", `Appending ${sAppend} ${oSegment.nNumber}`);
      _oMediaSourceBuffer.addEventListener("updateend", Appended);
      let nElapsedTime = -performance.now();
      _oMediaSourceBuffer.appendBuffer(mbAppend);
      function Appended() {
        try {
          if (_oMediaSourceBuffer === null) {
            fReject(PromiseCancellation.REASON);
          } else {
            nElapsedTime += performance.now();
            _oMediaSourceBuffer.removeEventListener("updateend", Appended);
            ShowState(
              nElapsedTime > 100 ? "Oops" : "Here",
              `Appended ${sAppend} ${oSegment.nNumber} in ${m_Log.F0(
                nElapsedTime
              )}ms`
            );
            fResolve(oSegment);
          }
        } catch (pException) {
          fReject(pException);
        }
      }
    });
  }
  function CheckBufferExhaustion(oSegment) {
    if (
      !_oMediaElement.seeking &&
      !_oMediaElement.paused &&
      !_oMediaElement.ended
    ) {
      CheckPlaybackPosition(
        CHECK_PLAYBACK,
        oSegment.nDuration
      );
    }
    if (_oMediaElement.played.length !== 0) {
      m_Statistics.updateBufferFill(
        GetBufferFill().nUnwatched
      );
    }
    return oSegment;
  }
  function SegmentWasAppended(oSegment) {
    _bAsyncOperation = false;
    g_maQueue.Remove(oSegment);
    CalculateBroadcastOffset(oSegment);
    if (!(g_maQueue[0] && g_maQueue[0].pData === STATE_REPEAT)) {
      const nCheck = CheckPlaybackPosition(
        CHECK_SEGMENT_ADDITION
      );
      if (
        !(
          g_maQueue[0] && g_maQueue[0].nProcessing === PROCESSING_CONVERTED
        )
      ) {
        StartPlayback(nCheck);
        ShowBroadcastLatency(oSegment);
      }
    }
    AddNextSegment();
  }
  const SegmentWasNotAppended = AddExceptionHandler((pReason) => {
    _bAsyncOperation = false;
    if (pReason === PromiseCancellation.REASON) {
      m_Log.Here("[Player] Segment append cancelled");
    } else {
      throw pReason;
    }
  });
  function PreventQueueOverflow() {
    const { nDuration } = g_maQueue.CountConvertedSegments();
    if (nDuration >= BUFFER_OVERFLOW) {
      m_Log.Oops(
        `[Player] MediaSource closed for too long ${nDuration}s >= ${BUFFER_OVERFLOW}s`
      );
      Check(
        m_Controls.GetState() === STATE_START ||
        m_Controls.GetState() === STATE_BROADCAST_START
      );
      m_Controls.StopWatchingBroadcast();
    }
  }
  function DetectAndHandleBroadcastVariantChange() {
    for (let idx = g_maQueue.length; --idx >= 0;) {
      if (
        g_maQueue[idx].pData === STATE_VARIANT_CHANGE &&
        g_maQueue[idx].nProcessing === PROCESSING_CONVERTED
      ) {
        g_maQueue.ShowState();
        do {
          if (
            g_maQueue[idx].pData === STATE_VARIANT_CHANGE ||
            typeof g_maQueue[idx].pData != "number"
          ) {
            g_maQueue.Remove(idx);
          }
        } while (--idx >= 0);
        g_maQueue.ShowState();
        ReloadAndWaitForBufferFill(STATE_LOADING);
        break;
      }
    }
  }
  function AddNextSegment() {
    WatchForErrors();
    DetectAndHandleBroadcastVariantChange();
    const oSegment = g_maQueue[0];
    if (!oSegment || oSegment.nProcessing !== PROCESSING_CONVERTED) {
      return;
    }
    Check(_oBehaviour === _oLiveBroadcast);
    if (oSegment.pData === STATE_BROADCAST_START) {
      Check(_oMediaSource.sourceBuffers.length === 0);
      _nBroadcastOffset = NaN;
      m_Controls.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_bAsyncOperation) {
      return;
    }
    if (oSegment.pData === STATE_REPEAT) {
      Check(
        m_Controls.GetState() !== STATE_STOP &&
        m_Controls.GetState() !== STATE_REPEAT
      );
      StartReplay();
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    const sReadyState = _oMediaSource.readyState;
    if (sReadyState !== "open") {
      m_Log.Here(
        `[Player] Appending segment ${oSegment.nNumber} postponed MediaSource.readyState=${sReadyState} MediaElement.src=${_oMediaElement.src}`
      );
      if (sReadyState === "closed" && _nPlaybackStarted === 0) {
        PreventQueueOverflow();
      }
      return;
    }
    if (oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length !== 0) {
      EndStream(oSegment);
      return;
    }
    if (oSegment.pData === STATE_BROADCAST_END) {
      Check(oSegment.bDiscontinuity && _oMediaSource.sourceBuffers.length === 0);
      m_Controls.ChangeState(oSegment.pData);
      g_maQueue.Remove(0);
      AddNextSegment();
      return;
    }
    if (_oMediaSource.sourceBuffers.length === 0) {
      AddSourceBuffers(oSegment);
      m_Controls.UpdateTrackCount(
        oSegment.pData.bHasVideo,
        oSegment.pData.bHasAudio
      );
    }
    _bAsyncOperation = true;
    let oPromise = RemoveWatchedVideo(oSegment).then(
      CheckBufferExhaustion
    );
    if (oSegment.pData.mbInitializationSegment) {
      oPromise = oPromise.then(AppendInitSegment);
    }
    oPromise
      .then(AppendMediaSegment)
      .then(SegmentWasAppended)
      .catch(SegmentWasNotAppended);
  }
  function SeekReplayTo(nSeekTo) {
    Check(m_Controls.GetState() === STATE_REPEAT);
    _oReplay.CheckPlaybackPosition(nSeekTo);
  }
  function SeekReplayBy(bFrames, nSeekBy) {
    Check(m_Controls.GetState() === STATE_REPEAT);
    Check(Number.isFinite(nSeekBy));
    if (bFrames) {
      nSeekBy *=
        m_Statistics.GetFrameDurationInSeconds().nMinimum;
    }
    if (nSeekBy !== 0) {
      SeekReplayTo(
        Clamp(
          _oMediaElement.currentTime + nSeekBy,
          m_Scale.GetStart(),
          m_Scale.GetEnd()
        )
      );
    }
  }
  function TogglePause() {
    Check(m_Controls.GetState() === STATE_REPEAT);
    if ((_oReplay.bPause = !_oReplay.bPause)) {
      m_Log.Wow("[Player] Pausing replay");
      _oMediaElement.pause();
    } else {
      m_Log.Wow("[Player] Resuming replay");
      _oReplay.CheckPlaybackPosition(
        CHECK_PLAYBACK_START
      );
      _oMediaElement.play();
    }
    m_Events.SendEvent("player-paused", _oReplay.bPause);
  }
  function SetReplaySpeed(nSpeed) {
    Check(nSpeed > 0);
    Check(m_Controls.GetState() === STATE_REPEAT);
    m_Log.Wow(`[Player] Speed set to ${nSpeed}`);
    _oMediaElement.playbackRate = nSpeed;
  }
  function StartReplay() {
    _oReplay.bPause = true;
    _oBehaviour = _oReplay;
    StopPlayback();
    if (
      _oMediaSource.sourceBuffers.length !== 0 &&
      _oMediaSource.readyState === "open"
    ) {
      _oMediaSource.endOfStream();
    }
    if (
      _oMediaElement.played.length === 0 ||
      GetBufferFill().nWatched <
      REPLAY_AVAILABLE_IF_WATCHED
    ) {
      ShowState("Wow", "Nothing to replay");
      m_Controls.ChangeState(STATE_STOP);
      return;
    }
    ShowState("Wow", "Starting replay");
    m_Events.SendEvent("player-paused", _oReplay.bPause);
    m_Scale.SetStartAndEnd(
      _oMediaElement.buffered.start(0),
      _oMediaElement.buffered.end(_oMediaElement.buffered.length - 1)
    );
    m_Scale.SetWatched(_oMediaElement.currentTime);
    m_Controls.ChangeState(STATE_REPEAT);
    SetReplaySpeed(m_Controls.getReplaySpeed());
  }
  function AddSourceBuffers(oSegment) {
    m_Log.Wow(`[Player] Adding buffer ${oSegment.pData.sCodecs}`);
    Check(oSegment.bDiscontinuity && oSegment.pData.sCodecs);
    try {
      _oMediaSourceBuffer = _oMediaSource.addSourceBuffer(
        oSegment.pData.sCodecs
      );
    } catch (pException) {
      if (IsObject(pException) && pException.name === "NotSupportedError") {
        m_Debug.FinishWorkAndShowMessage("J0201");
      } else {
        m_Debug.CaughtException(pException);
      }
    }
    _bHasVideoTrack = oSegment.pData.bHasVideo;
    _oMediaSourceBuffer.addEventListener(
      "updatestart",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "update",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "updateend",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "abort",
      WatchMediaSourceEvents
    );
    _oMediaSourceBuffer.addEventListener(
      "error",
      WatchMediaSourceEvents
    );
  }
  function attachMediaSourceToMediaElement() {
    if (_oMediaElement.src) {
      URL.revokeObjectURL(_oMediaElement.src);
    }
    _oMediaElement.src = URL.createObjectURL(_oMediaSource);
    m_AudioDevice.start(_oMediaElement);
  }
  function Start() {
    Check(!_oMediaElement);
    try {
      _oMediaSource = new MediaSource();
    } catch (pException) {
      console.error(`MediaSource ${pException}`);
      m_Debug.FinishWorkAndShowMessage("J0221");
    }
    _oMediaSource.addEventListener("sourceopen", WatchMediaSourceEvents);
    _oMediaSource.addEventListener(
      "sourceended",
      WatchMediaSourceEvents
    );
    _oMediaSource.addEventListener(
      "sourceclose",
      WatchMediaSourceEvents
    );
    _oMediaSource.sourceBuffers.addEventListener(
      "addsourcebuffer",
      WatchMediaSourceEvents
    );
    _oMediaSource.sourceBuffers.addEventListener(
      "removesourcebuffer",
      WatchMediaSourceEvents
    );
    _oMediaElement = document.getElementById("eye");
    ApplyVolume();
    m_PictureInPicture.start(_oMediaElement);
    for (let sEvent of [
      "progress",
      "error",
      "playing",
      "seeking",
      "seeked",
      "ended",
      "timeupdate",
      "waiting",
      "loadstart",
      "suspend",
      "abort",
      "emptied",
      "stalled",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "durationchange",
      "play",
      "pause",
      "ratechange",
      "resize",
    ]) {
      _oMediaElement.addEventListener(sEvent, WatchMediaElementEvents);
    }
    attachMediaSourceToMediaElement();
    return true;
  }
  function Stop() {
    if (_oMediaElement) {
      URL.revokeObjectURL(_oMediaElement.src);
      _oMediaElement.removeAttribute("src");
      _oMediaElement.load();
    }
  }
  return {
    Start,
    Stop,
    GetBufferFill,
    GetDroppedFrameCount,
    GetBroadcastPlaybackPosition,
    ShowState,
    Reload: ReloadAndWaitForBufferFill,
    ApplyVolume,
    AddNextSegment,
    SeekReplayTo,
    SeekReplayBy,
    TogglePause,
    SetReplaySpeed,
  };
})();

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

