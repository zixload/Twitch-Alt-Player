"use strict";
/*
	The changelog and the manual, in the same window, from the same table.

	Each row is a version, a title key, then body keys. Four rows are not versions at all: they are
	markers, and they all start with "2000" so a single prefix test tells them apart from a date —
	show once, always show, the manual, tablets only. The manual is not a separate document; it is
	rows of this table that no date will ever match.

	**Asking for entries newer than Infinity means asking for none.** That is how the manual and the
	first-run notice are shown alone: the filter that keeps dated entries out is the same one that
	selects them, given an impossible bound. It reads like a mistake and is the opposite.

	Three ways to open, and they do not show the same thing:
	  - the viewer has never seen anything: the one-time notice, no more, and the version is recorded
	    straight away — there is nothing they could have missed;
	  - the viewer saw an older version: everything newer than it, and a "later" button. **The
	    version is recorded only when they confirm having read it.** Opening by accident must not
	    swallow news nobody read;
	  - the viewer is up to date: the whole changelog, since they asked for it themselves, and no
	    confirmation to give.

	The translate link is filled in when it is clicked, not when the entry is drawn: building it
	means URL-encoding the whole entry, and drawing thirty entries would do that thirty times for a
	link that is almost never used. It is left out entirely when the interface is already Russian —
	the language these entries were written in.

	The extension used to poll the original author's website every five days for a version manifest
	and offer an update from it. This fork does not ship from there, so the check is gone rather
	than left pointing at someone else's site.
*/
const m_News = (() => {
  // Les quatre marqueurs qui ne sont pas des dates. Tous en « 2000 », c'est ce qui les distingue.
  const SHOW_ONCE = "2000.1.1";
  const SHOW_ALWAYS = "2000.2.2";
  const FULL_HELP = "2000.3.3";
  const FOR_TABLET = "2000.4.4";

  const NO_DATED_ENTRIES = Infinity;
  const EVERY_DATED_ENTRY = 0;
  const NO_MARKER = "";

  const NEWS = [
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

  // « 2025.5.28 » ou « 2025.5.28.2 » : une date, et un rang dans la journee.
  function VersionToTime(sVersion) {
    const mnParts = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(sVersion);
    Check(mnParts !== null);
    return Date.UTC(
      mnParts[1] | 0,
      (mnParts[2] | 0) - 1,
      mnParts[3] | 0,
      0,
      0,
      0,
      mnParts[4] | 0
    );
  }

  function HasEntriesNewerThan(sVersion) {
    const nVersion = VersionToTime(sVersion);
    return NEWS.some((mEntry) => VersionToTime(mEntry[0]) > nVersion);
  }

  function Render(nNewerThan, sMarker) {
    Check(typeof nNewerThan == "number" && nNewerThan >= 0);
    Check(sMarker === NO_MARKER || sMarker.startsWith("2000"));
    Check(Number.isFinite(nNewerThan) || sMarker !== NO_MARKER);
    const elAddTo = GetNode("newstext");
    elAddTo.textContent = "";
    for (const mEntry of NEWS) {
      const sVersion = mEntry[0];
      if (sVersion.startsWith("2000")) {
        // Le marqueur demande, ce qui est toujours visible, et les tablettes sur une tablette.
        if (
          sVersion === sMarker ||
          sVersion === SHOW_ALWAYS ||
          (sVersion === FOR_TABLET && isMobileDevice())
        ) {
          RenderEntry(elAddTo, mEntry, 0);
        }
      } else {
        const nTime = VersionToTime(sVersion);
        if (nTime > nNewerThan) {
          RenderEntry(elAddTo, mEntry, nTime);
        }
      }
    }
    m_Window.configureScrollIndicator(elAddTo);
  }

  function RenderEntry(elAddTo, mEntry, nTime) {
    if (elAddTo.firstElementChild) {
      elAddTo.appendChild(document.createElement("hr"));
    }
    const nodeHeading = document.createElement("h4");
    // Les entrees marquees n'ont pas de date a montrer : le manuel n'est pas date.
    nodeHeading.textContent = nTime === 0
      ? GetText(mEntry[1])
      : `${m_i18n.FormatDate(nTime)}\u2002\u00b7\u2002${GetText(mEntry[1])}`;
    elAddTo.appendChild(nodeHeading);
    if (GetText("M0010") !== "ru") {
      const elLink = nodeHeading.appendChild(document.createElement("a"));
      elLink.className = "news-translate";
      elLink.href = "translate:";
      elLink.target = "_blank";
      elLink.title = GetText("J0148");
    }
    for (let idx = 2; idx < mEntry.length; ++idx) {
      // Le texte des entrees porte du balisage : il s'insere, il ne s'affecte pas.
      m_i18n.InsertAdjacentHtmlMessage(elAddTo, "beforeend", mEntry[idx]);
    }
  }

  function OpenWindow(bConfirmRead) {
    if (bConfirmRead) {
      m_i18n.InsertAdjacentHtmlMessage("closenews", "content", "F0619").title =
        GetText("A0620");
    } else {
      m_i18n.InsertAdjacentHtmlMessage("closenews", "content", "F0663").title = "";
    }
    ShowElement("postponenews", bConfirmRead);
    m_Events.AddHandler("controls-leftclick", HandleLeftClick);
    m_Window.open("news");
  }

  function HandleLeftClick(oEvent) {
    // Fermer par « j'ai lu » : c'est le seul moment ou la version vue est enregistree.
    if (oEvent.sCallsign === "closenews" && ElementIsShown("postponenews")) {
      m_Settings.Change("sPreviousVersion", EXTENSION_VERSION);
      return;
    }
    if (oEvent.target.href === "translate:") {
      oEvent.target.href = TranslateAddress(oEvent.target);
    }
  }

  // Le texte d'une entree : du titre jusqu'au trait qui ouvre la suivante.
  function TranslateAddress(elLink) {
    let sText = "";
    for (
      let elText = elLink.parentElement;
      elText && elText.nodeName !== "HR";
      elText = elText.nextElementSibling
    ) {
      sText += `${elText.textContent}\n\n`;
    }
    return `https://translate.google.com/?op=translate&sl=${GetText(
      "M0010"
    )}&text=${encodeURIComponent(sText)}`;
  }

  function OpenHelp() {
    Render(NO_DATED_ENTRIES, FULL_HELP);
    OpenWindow(false);
  }

  function OpenNews() {
    const { pCurrent: sSeenVersion, pInitial: sNeverSeen } =
      m_Settings.GetSettingParameters("sPreviousVersion");
    if (sSeenVersion === sNeverSeen) {
      Render(NO_DATED_ENTRIES, SHOW_ONCE);
      OpenWindow(false);
      m_Settings.Change("sPreviousVersion", EXTENSION_VERSION);
    } else if (sSeenVersion !== EXTENSION_VERSION) {
      Render(VersionToTime(sSeenVersion), NO_MARKER);
      OpenWindow(true);
    } else {
      Render(EVERY_DATED_ENTRY, NO_MARKER);
      OpenWindow(false);
    }
  }

  function Start() {
    const { pCurrent: sSeenVersion, pInitial: sNeverSeen } =
      m_Settings.GetSettingParameters("sPreviousVersion");
    if (sSeenVersion === EXTENSION_VERSION) {
      return;
    }
    m_Log.Wow(
      `[News] Extension version changed from ${sSeenVersion} to ${EXTENSION_VERSION}`
    );
    // Plus d'icone de notification : on note la version comme vue ; les annonces restent
    // ouvrables depuis le menu principal.
    m_Settings.Change("sPreviousVersion", EXTENSION_VERSION);
  }

  return {
    Start,
    OpenNews,
    OpenHelp,
  };
})();
