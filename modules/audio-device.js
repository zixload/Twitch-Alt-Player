"use strict";
/*
	Which speakers the sound comes out of.

	The browser will happily list audio outputs, but it only names them once the page has been
	granted access to media devices — before that, enumerateDevices answers entries with empty ids
	and empty labels. So there are two states, and the module shows whichever is true:

	  - **named devices**: a list to pick from, with the viewer's saved choice re-applied;
	  - **anonymous devices**: no list at all, a button that asks for the permission instead.

	Asking means `chrome.permissions.request` followed by `chrome.contentSettings.microphone.set` —
	audio *output* is gated behind the microphone permission, because naming your speakers is as
	identifying as naming your microphones. **That request opens a browser prompt, and a prompt needs
	a human.** It is the one thing in this repository no test can close; the harness reports the
	button as mute, and it is right to.

	"Default" is not a device like the others: the browser calls it `default`, the list calls it the
	empty string, and an entry for it is added by hand when the browser did not offer one. Keeping
	that in one place is the whole reason the conversions are here and not spread over the callers.

	The list is rebuilt whenever the system says the devices changed — plugging in a headset while
	watching has to be enough — and after any failed attempt to switch, because a device that refused
	us may no longer be there at all.

	A browser without setSinkId gets nothing: no list, no button, no error in the viewer's face. The
	sound keeps coming out of wherever the system sends it.
*/
const m_AudioDevice = (() => {
  const DEFAULT_DEVICE = "default";
  const COMMUNICATION_DEVICE = "communications";
  // Dans la liste, « par defaut » est la chaine vide ; pour le navigateur, c'est « default ».
  const AS_LIST_VALUE = (sDeviceId) =>
    sDeviceId === DEFAULT_DEVICE ? "" : sDeviceId;

  let _elVideo = null;

  function DeviceList() {
    return GetNode("audiodevices-list");
  }

  function Refresh() {
    const elList = DeviceList();
    m_Log.Wow("[AudioDevices] Getting media device list");
    navigator.mediaDevices
      .enumerateDevices()
      .then((moDevices) => ShowDevices(elList, moDevices), (pReason) => {
        m_Log.Oops(`[AudioDevices] Could not get media device list: ${pReason}`);
        elList.length = 0;
        elList.disabled = true;
      })
      .catch(m_Debug.CaughtException);
  }

  function ShowDevices(elList, moDevices) {
    if (!Array.isArray(moDevices)) {
      m_Log.Oops("[AudioDevices] Audio device list unavailable");
      ShowElement("audiodevices", false);
      return undefined;
    }
    elList.length = 0;
    m_Log.Here(`[AudioDevices] Current device ${_elVideo.sinkId}`);
    const sCurrentDevice = AS_LIST_VALUE(_elVideo.sinkId);
    const sSavedDevice = m_Settings.Get("sAudioDeviceId");

    let nOutputs = 0;
    let nNamedRealDevices = 0;
    let bHasDefault = false;
    let bHasCurrent = sCurrentDevice === "";
    let bHasSaved = sSavedDevice === "";

    for (const oDevice of moDevices) {
      m_Log.Here(
        `[AudioDevices] Media device kind=${oDevice.kind} deviceId=${oDevice.deviceId} groupId=${oDevice.groupId} label=${oDevice.label}`
      );
      if (oDevice.kind !== "audiooutput") {
        continue;
      }
      nOutputs++;
      // Sans identifiant ni nom, le navigateur dit « il y en a, mais je ne te dirai pas lesquels ».
      if (!oDevice.deviceId || !oDevice.label) {
        continue;
      }
      nNamedRealDevices +=
        oDevice.deviceId !== DEFAULT_DEVICE &&
        oDevice.deviceId !== COMMUNICATION_DEVICE;
      bHasDefault = bHasDefault || oDevice.deviceId === DEFAULT_DEVICE;
      bHasCurrent = bHasCurrent || oDevice.deviceId === sCurrentDevice;
      bHasSaved = bHasSaved || oDevice.deviceId === sSavedDevice;
      elList.add(new Option(oDevice.label, AS_LIST_VALUE(oDevice.deviceId)));
    }

    if (nOutputs !== 0 && elList.length === 0) {
      AskForAccess();
      return undefined;
    }
    return ShowList(elList, {
      bHasDefault,
      bHasCurrent,
      bHasSaved,
      nNamedRealDevices,
      sCurrentDevice,
      sSavedDevice,
    });
  }

  function AskForAccess() {
    /*
      Un cas ancien : avant Chrome 69, une fenetre de navigation privee ne pouvait pas obtenir cet
      acces du tout. Montrer un bouton qui ne peut pas aboutir serait pire que ne rien montrer.
    */
    if (getBrowserEngineVersion() <= 68 && chrome.extension.inIncognitoContext) {
      ShowElement("audiodevices", false);
      return;
    }
    ShowElement("audiodevices-access", true);
    ShowElement(DeviceList(), false);
    ShowElement("audiodevices", true);
    m_Events.AddHandler("controls-leftclick", HandleAccessClick);
  }

  function ShowList(elList, oState) {
    if (!oState.bHasDefault && elList.length !== 0) {
      elList.add(new Option("Default", ""), 0);
    }
    elList.value = oState.sCurrentDevice;
    elList.disabled = elList.length === 0;
    ShowElement("audiodevices-access", false);
    ShowElement(elList, true);
    // Un seul vrai peripherique : il n'y a rien a choisir, la liste reste muette.
    if (oState.nNamedRealDevices > 1) {
      ShowElement("audiodevices", true);
      elList.addEventListener("change", HandleDeviceChoice);
    }

    let sSelect;
    if (oState.bHasSaved && oState.sSavedDevice !== oState.sCurrentDevice) {
      // Le choix du spectateur est revenu : on le reprend.
      sSelect = oState.sSavedDevice;
    } else if (!oState.bHasCurrent && elList.length !== 0) {
      // Le peripherique en cours a disparu : on retombe sur celui par defaut.
      sSelect = "";
    }
    if (sSelect === void 0) {
      return undefined;
    }
    m_Log.Wow(`[AudioDevices] Selecting device ${sSelect}`);
    return _elVideo.setSinkId(sSelect).then(
      () => {
        m_Log.Here("[AudioDevices] Device selected");
        elList.value = sSelect;
      },
      (pReason) => {
        m_Log.Oops(`[AudioDevices] Could not select device: ${pReason}`);
      }
    );
  }

  function HandleAccessClick({ sCallsign }) {
    if (sCallsign !== "audiodevices-access") {
      return;
    }
    m_Log.Wow("[AudioDevices] Requesting contentSettings permission");
    chrome.permissions.request(
      { permissions: ["contentSettings"] },
      AddExceptionHandler((bGranted) => {
        if (!bGranted) {
          m_Log.Oops(
            `[AudioDevices] Permission not granted: ${chrome.runtime.lastError && chrome.runtime.lastError.message}`
          );
          m_Notification.ShowAss();
          return;
        }
        m_Log.Wow("[AudioDevices] Getting access to audio devices");
        chrome.contentSettings.microphone.set(
          {
            primaryPattern: `*://${chrome.runtime.id}/*`,
            setting: "allow",
            scope: chrome.extension.inIncognitoContext
              ? "incognito_session_only"
              : "regular",
          },
          AddExceptionHandler(() => {
            if (chrome.runtime.lastError) {
              m_Log.Oops(
                `[AudioDevices] Access not granted: ${chrome.runtime.lastError.message}`
              );
              m_Notification.ShowAss();
            }
            Refresh();
          })
        );
      })
    );
  }

  const HandleDeviceChoice = AddExceptionHandler((oEvent) => {
    if (oEvent.target.selectedIndex === -1) {
      return;
    }
    const sSelect = oEvent.target.value;
    m_Log.Wow(
      `[AudioDevices] Selecting device ${sSelect} instead of ${_elVideo.sinkId}`
    );
    _elVideo
      .setSinkId(sSelect)
      .then(
        () => {
          m_Log.Here("[AudioDevices] Device selected");
          m_Settings.Change("sAudioDeviceId", sSelect);
        },
        (pReason) => {
          m_Log.Oops(`[AudioDevices] Could not select device: ${pReason}`);
          m_Notification.ShowAss();
          // Celui qui vient de refuser n'est peut-etre plus la : on redemande la liste.
          Refresh();
        }
      )
      .catch(m_Debug.CaughtException);
  });

  function start(oMediaElement) {
    if (_elVideo) {
      return;
    }
    _elVideo = oMediaElement;
    if (!("setSinkId" in _elVideo)) {
      m_Log.Oops("[AudioDevices] Browser does not support MediaElement.setSinkId");
      return;
    }
    if ("addEventListener" in navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener(
        "devicechange",
        AddExceptionHandler(Refresh)
      );
    } else {
      m_Log.Oops("[AudioDevices] Browser does not support MediaDevices.ondevicechange");
    }
    Refresh();
  }

  return {
    start,
  };
})();
