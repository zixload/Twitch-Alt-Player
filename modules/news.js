"use strict";

/**
 * Module: News & Updates Manager (m_News)
 * -----------------------------------------------------------------------------
 * This module is a Singleton (IIFE) responsible for:
 * 1. CHANGELOG & NEWS DISPLAY:
 *    - Stores the entire history of changes (`_mNews`) as [Date/Version, TitleKey, ContentKeys...].
 *    - Renders these items into the UI (via `AddNewsItems`).
 *    - Supports "Special" pages like "Full Help" (`FULL_HELP`) or "Tablet Info".
 *    - Auto-generates "Google Translate" links for non-Russian users.
 *
 * 2. UPDATE CHECKING:
 *    - Notifies the user if a new version is found (logic involves `m_Settings.nLastExtensionUpdateCheck`).
 *
 * 3. VERSION TRACKING:
 *    - On startup (`Start`), compares the current extension version (`EXTENSION_VERSION`)
 *      with the last seen version (`sPreviousVersion` in Settings).
 *    - If upgraded, highlights the "News" button to alert the user of new features.
 *
 * USAGE IN CODEBASE:
 * - `m_News.Start()`: Called on player startup to verify version and check for updates.
 * - `m_News.OpenNews()`: Triggered by UI menu ("opennews"). Shows relevant changes based on what the user has seen.
 * - `m_News.OpenHelp()`: Triggered by UI menu ("openhelp"). Displays the full manual.
 *
 * DEPENDENCIES:
 * - `m_Settings`: To read/write version history and check times.
 * - `m_i18n`: To translate news keys (Jxxxx, Fxxxx) into text.
 * - `m_Downloader`: To fetch the version.json file.
 * - `m_Window`: To open the modal window.
 */
const m_News = (() => {
  // Special "Version" Constants (Markers for non-date items)
  const SHOW_ONCE = "2000.1.1"; // Show once (e.g. urgent notice)
  const SHOW_ALWAYS = "2000.2.2"; // Always visible (e.g. pinned)
  const FULL_HELP = "2000.3.3";    // Full Help/Manual identifier
  const FOR_TABLET = "2000.4.4";      // Tablet-specific info

  // Changelog Data: [Version/Date, Title_I18n_Key, Content_I18n_Keys...]
  // Used to generate the "What's New" list.
  const _mNews = [
    ["2025.5.28", "J1010", "F1078"],
    ["2024.6.14", "J1010", "F1077"],
    ["2024.6.5", "J1010", "F1076"],
    ["2024.6.5", "J1010", "F1074"],
    ["2024.5.31", "F1072", "F1073"],
    ["2022.1.20", "J1513", "F1515"],
    ["2021.12.17", "J1066", "F1070", "F1514"],
    ["2021.12.17", "J1010", "F1069"],
    ["2021.3.7", "J1010", "F1068"],
    ["2020.10.30", "J1066", "F1067"],
    ["2020.10.5", "J1010", "F1065"],
    ["2019.10.9", "J1010", "F1064"],
    ["2019.3.17", "J1010", "F1063"],
    ["2018.10.28", "J1010", "F1062"],
    ["2018.8.17", "J1010", "F1060"],
    ["2018.7.30", "J1010", "F1059"],
    ["2018.6.27", "J1010", "F1058"],
    ["2018.6.12", "J1010", "F1057"],
    ["2018.5.18", "J1010", "F1049"],
    ["2018.4.24", "J1036", "F1048"],
    ["2018.4.6", "J1010", "F1047"],
    ["2018.3.17", "J1010", "F1046"],
    ["2018.3.4", "J1041", "F1042"],
    ["2018.2.17", "J1010", "F1044"],
    ["2018.1.7", "J1010", "F1043"],
    ["2017.11.6", "J1010", "F1037", "F1038"],
    ["2017.10.22", "J1010", "F1023"],
    ["2017.10.14", "J1010", "F1020"],
    ["2017.9.11", "J1010", "F1018"],
    ["2017.8.8", "J1035", "F1017"],
    ["2017.6.23", "J1010", "F1014"],
    ["2017.5.29", "J1010", "F1013"],
    ["2017.3.31", "J1031", "F1012"],
    ["2017.2.26", "J1030", "F1011"],
    [
      FULL_HELP,
      "J1500", // Start of manual ? (Keys are cryptic, likely "Manual" or "Help")
      "F1501",
      "F1503",
      "F1502",
      "F1575",
      "F1509",
      "F1573",
      "F1574",
      "F1504",
      "F1514",
      "F1507",
    ],
    [
      FULL_HELP,
      "J1513",
      "F1570",
      "F1571",
      "F1572",
      "F1515",
      "F1511",
      "F1506",
      "F1510",
    ],
    [SHOW_ONCE, "J1054", "F1501"],
    [FOR_TABLET, "J1055", "F1056"],
    [SHOW_ALWAYS, "J1003", "F1000"],
  ];
  function ConvertVersionToMilliseconds(sVersion) {
    const mnParts = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(sVersion);
    mnParts[1] |= 0;
    mnParts[2] |= 0;
    mnParts[3] |= 0;
    mnParts[4] |= 0;
    return Date.UTC(
      mnParts[1],
      mnParts[2] - 1,
      mnParts[3],
      0,
      0,
      0,
      mnParts[4]
    );
  }
  function HasNewsWithVersionOlderThan(sVersion) {
    const nVersion = ConvertVersionToMilliseconds(sVersion);
    return _mNews.some(
      (mNewsItem) => ConvertVersionToMilliseconds(mNewsItem[0]) > nVersion
    );
  }
  function AddNewsItems(nAddVersionsOlderThan, sAddHelpVersion) {
    Check(
      typeof nAddVersionsOlderThan == "number" && nAddVersionsOlderThan >= 0
    );
    Check(
      sAddHelpVersion === "" || sAddHelpVersion.startsWith("2000")
    );
    Check(
      Number.isFinite(nAddVersionsOlderThan) || sAddHelpVersion !== ""
    );
    const elAddTo = GetNode("newstext");
    elAddTo.textContent = "";
    for (let mNewsItem of _mNews) {
      const sVersion = mNewsItem[0];
      if (sVersion.startsWith("2000")) {
        if (
          sVersion === sAddHelpVersion ||
          (sVersion === FOR_TABLET && isMobileDevice()) ||
          sVersion === SHOW_ALWAYS
        ) {
          AddNewsItem(elAddTo, mNewsItem, 0);
        }
      } else {
        const nVersion = ConvertVersionToMilliseconds(sVersion);
        if (nVersion > nAddVersionsOlderThan) {
          AddNewsItem(elAddTo, mNewsItem, nVersion);
        }
      }
    }
    m_Window.configureScrollIndicator(elAddTo);
  }
  function AddNewsItem(elAddTo, mNewsItem, nNewsDate) {
    if (elAddTo.firstElementChild) {
      elAddTo.appendChild(document.createElement("hr"));
    }
    const nodeHeading = document.createElement("h4");
    if (nNewsDate === 0) {
      nodeHeading.textContent = GetText(mNewsItem[1]);
    } else {
      nodeHeading.textContent = `${m_i18n.FormatDate(
        nNewsDate
      )} · ${GetText(mNewsItem[1])}`;
    }
    elAddTo.appendChild(nodeHeading);
    if (GetText("M0010") !== "ru") {
      const elLink = nodeHeading.appendChild(document.createElement("a"));
      elLink.className = "news-translate";
      elLink.href = "translate:";
      elLink.target = "_blank";
      elLink.title = GetText("J0148");
    }
    for (let idx = 2; idx < mNewsItem.length; ++idx) {
      m_i18n.InsertAdjacentHtmlMessage(elAddTo, "beforeend", mNewsItem[idx]);
    }
  }
  function OpenWindow(bConfirmRead) {
    if (bConfirmRead) {
      m_i18n.InsertAdjacentHtmlMessage(
        "closenews",
        "content",
        "F0619"
      ).title = GetText("A0620");
      ShowElement("postponenews", true);
    } else {
      m_i18n.InsertAdjacentHtmlMessage(
        "closenews",
        "content",
        "F0663"
      ).title = "";
      ShowElement("postponenews", false);
    }
    m_Events.AddHandler(
      "controls-leftclick",
      HandleLeftClick
    );
    m_Window.open("news");
  }
  function HandleLeftClick(oEvent) {
    if (
      oEvent.sCallsign === "closenews" &&
      ElementIsShown("postponenews")
    ) {
      ShowElement("opennews", false);
      m_Settings.Change("sPreviousVersion", EXTENSION_VERSION);
    } else if (oEvent.target.href === "translate:") {
      let sText = "";
      for (
        let elText = oEvent.target.parentElement;
        elText && elText.nodeName !== "HR";
        elText = elText.nextElementSibling
      ) {
        sText += `${elText.textContent}\n\n`;
      }
      oEvent.target.href = `https://translate.google.com/?op=translate&sl=${GetText(
        "M0010"
      )}&text=${encodeURIComponent(sText)}`;
    }
  }
  function OpenHelp() {
    AddNewsItems(Infinity, FULL_HELP);
    OpenWindow(false);
  }
  function OpenNews() {
    const { pCurrent: sPreviousVersion, pInitial: sInitialVersion } =
      m_Settings.GetSettingParameters("sPreviousVersion");
    if (sPreviousVersion === sInitialVersion) {
      AddNewsItems(Infinity, SHOW_ONCE);
      OpenWindow(false);
      ShowElement("opennews", false);
      m_Settings.Change("sPreviousVersion", EXTENSION_VERSION);
    } else if (sPreviousVersion !== EXTENSION_VERSION) {
      AddNewsItems(ConvertVersionToMilliseconds(sPreviousVersion), "");
      OpenWindow(true);
      GetNode("opennews").classList.remove("unread");
    } else {
      AddNewsItems(0, "");
      OpenWindow(false);
    }
  }
  /*
   * The extension used to poll the original author's website every five days for
   * a version manifest, and offer an update from it. This fork does not ship from
   * there, so the check is gone rather than left pointing at someone else's site.
   */
  function Start() {
    const { pCurrent: sPreviousVersion, pInitial: sInitialVersion } =
      m_Settings.GetSettingParameters("sPreviousVersion");
    if (sPreviousVersion !== EXTENSION_VERSION) {
      m_Log.Wow(
        `[News] Extension version changed from ${sPreviousVersion} to ${EXTENSION_VERSION}`
      );
      if (
        sPreviousVersion === sInitialVersion ||
        HasNewsWithVersionOlderThan(sPreviousVersion)
      ) {
        ShowElement("opennews", true).classList.add("unread");
      } else {
        m_Settings.Change("sPreviousVersion", EXTENSION_VERSION);
      }
    }
  }
  return {
    Start,
    OpenNews,
    OpenHelp,
  };
})();
