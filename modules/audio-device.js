"use strict";

const m_AudioDevice = (() => {
  const DEFAULT_DEVICE = "default";
  const COMMUNICATION_DEVICE = "communications";
  let _oMediaElement = null;
  function refreshDeviceListAndSelectDevice() {
    const nodeDeviceList = GetNode("audiodevices-list");
    m_Log.Wow("[AudioDevices] Getting media device list");
    navigator.mediaDevices
      .enumerateDevices()
      .then(
        (moMediaDevices) => {
          if (!Array.isArray(moMediaDevices)) {
            m_Log.Oops("[AudioDevices] Audio device list unavailable");
            ShowElement("audiodevices", false);
            return;
          }
          nodeDeviceList.length = 0;
          m_Log.Here(
            `[AudioDevices] Current device ${_oMediaElement.sinkId}`
          );
          const sCurrentDevice =
            _oMediaElement.sinkId === DEFAULT_DEVICE
              ? ""
              : _oMediaElement.sinkId;
          const sSavedDevice =
            m_Settings.Get("sAudioDeviceId");
          let kDevices = 0,
            kRealDevices = 0;
          let bHasDefaultDevice = false,
            bHasCurrentDevice = sCurrentDevice === "",
            bHasSavedDevice = sSavedDevice === "";
          for (const oMediaDevice of moMediaDevices) {
            m_Log.Here(
              `[AudioDevices] Media device kind=${oMediaDevice.kind} deviceId=${oMediaDevice.deviceId} groupId=${oMediaDevice.groupId} label=${oMediaDevice.label}`
            );
            if (oMediaDevice.kind === "audiooutput") {
              kDevices++;
              if (oMediaDevice.deviceId && oMediaDevice.label) {
                kRealDevices +=
                  oMediaDevice.deviceId !== DEFAULT_DEVICE &&
                  oMediaDevice.deviceId !== COMMUNICATION_DEVICE;
                bHasDefaultDevice =
                  bHasDefaultDevice ||
                  oMediaDevice.deviceId === DEFAULT_DEVICE;
                bHasCurrentDevice =
                  bHasCurrentDevice ||
                  oMediaDevice.deviceId === sCurrentDevice;
                bHasSavedDevice =
                  bHasSavedDevice ||
                  oMediaDevice.deviceId === sSavedDevice;
                nodeDeviceList.add(
                  new Option(
                    oMediaDevice.label,
                    oMediaDevice.deviceId === DEFAULT_DEVICE
                      ? ""
                      : oMediaDevice.deviceId
                  )
                );
              }
            }
          }
          if (kDevices !== 0 && nodeDeviceList.length === 0) {
            if (
              getBrowserEngineVersion() <= 68 &&
              chrome.extension.inIncognitoContext
            ) {
              ShowElement("audiodevices", false);
            } else {
              ShowElement("audiodevices-access", true);
              ShowElement(nodeDeviceList, false);
              ShowElement("audiodevices", true);
              m_Events.AddHandler(
                "controls-leftclick",
                handleClickAndRequestAudioDeviceAccess
              );
            }
          } else {
            if (!bHasDefaultDevice && nodeDeviceList.length !== 0) {
              nodeDeviceList.add(new Option("Default", ""), 0);
            }
            nodeDeviceList.value = sCurrentDevice;
            nodeDeviceList.disabled = nodeDeviceList.length === 0;
            ShowElement("audiodevices-access", false);
            ShowElement(nodeDeviceList, true);
            if (kRealDevices > 1) {
              ShowElement("audiodevices", true);
              nodeDeviceList.addEventListener(
                "change",
                handleDeviceChoice
              );
            }
            let sSelect;
            if (
              bHasSavedDevice &&
              sSavedDevice !== sCurrentDevice
            ) {
              sSelect = sSavedDevice;
            } else if (
              !bHasCurrentDevice &&
              nodeDeviceList.length !== 0
            ) {
              sSelect = "";
            }
            if (sSelect !== void 0) {
              m_Log.Wow(`[AudioDevices] Selecting device ${sSelect}`);
              return _oMediaElement.setSinkId(sSelect).then(
                () => {
                  m_Log.Here("[AudioDevices] Device selected");
                  nodeDeviceList.value = sSelect;
                },
                (pReason) => {
                  m_Log.Oops(
                    `[AudioDevices] Could not select device: ${pReason}`
                  );
                }
              );
            }
          }
        },
        (pReason) => {
          m_Log.Oops(
            `[AudioDevices] Could not get media device list: ${pReason}`
          );
          nodeDeviceList.length = 0;
          nodeDeviceList.disabled = true;
        }
      )
      .catch(m_Debug.CaughtException);
  }
  function handleClickAndRequestAudioDeviceAccess({ sCallsign }) {
    if (sCallsign !== "audiodevices-access") {
      return;
    }
    m_Log.Wow("[AudioDevices] Requesting contentSettings permission");
    chrome.permissions.request(
      {
        permissions: ["contentSettings"],
      },
      AddExceptionHandler((bPermissionGranted) => {
        if (bPermissionGranted) {
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
              refreshDeviceListAndSelectDevice();
            })
          );
        } else {
          m_Log.Oops(
            `[AudioDevices] Permission not granted: ${chrome.runtime.lastError && chrome.runtime.lastError.message
            }`
          );
          m_Notification.ShowAss();
        }
      })
    );
  }
  const handleDeviceChoice = AddExceptionHandler((oEvent) => {
    if (oEvent.target.selectedIndex !== -1) {
      const sSelect = oEvent.target.value;
      m_Log.Wow(
        `[AudioDevices] Selecting device ${sSelect} instead of ${_oMediaElement.sinkId}`
      );
      _oMediaElement
        .setSinkId(sSelect)
        .then(
          () => {
            m_Log.Here("[AudioDevices] Device selected");
            m_Settings.Change("sAudioDeviceId", sSelect);
          },
          (pReason) => {
            m_Log.Oops(
              `[AudioDevices] Could not select device: ${pReason}`
            );
            m_Notification.ShowAss();
            refreshDeviceListAndSelectDevice();
          }
        )
        .catch(m_Debug.CaughtException);
    }
  });
  function start(oMediaElement) {
    if (_oMediaElement) {
      return;
    }
    _oMediaElement = oMediaElement;
    if (!("setSinkId" in _oMediaElement)) {
      m_Log.Oops(
        "[AudioDevices] Browser does not support MediaElement.setSinkId"
      );
      return;
    }
    if (!("addEventListener" in navigator.mediaDevices)) {
      m_Log.Oops(
        "[AudioDevices] Browser does not support MediaDevices.ondevicechange"
      );
    } else {
      navigator.mediaDevices.addEventListener(
        "devicechange",
        AddExceptionHandler(refreshDeviceListAndSelectDevice)
      );
    }
    refreshDeviceListAndSelectDevice();
  }
  return {
    start,
  };
})();
