"use strict";

const m_Appearance = (() => {
  const COLOUR_BUTTON_SELECTOR = 'input[type="color"]';
  let _oOpacity = null;
  const HandleColourInput = AddExceptionHandler((oEvent) => {
    if (oEvent.target.matches(COLOUR_BUTTON_SELECTOR)) {
      UpdateStyles();
    }
  });
  const HandleColourChange = AddExceptionHandler((oEvent) => {
    if (oEvent.target.matches(COLOUR_BUTTON_SELECTOR)) {
      m_Settings.Change(oEvent.target.id, oEvent.target.value);
    }
  });
  function HandleAppearancePresetChange() {
    UpdateSettingsWindow();
    UpdateStyles();
  }
  function UpdateSettingsWindow() {
    for (let nodeButton of document.querySelectorAll(COLOUR_BUTTON_SELECTOR)) {
      nodeButton.value = m_Settings.Get(nodeButton.id);
    }
    _oOpacity.Update();
  }
  function UpdateStyles() {
    const oStyle = document.documentElement.style;
    for (let nodeButton of document.querySelectorAll(COLOUR_BUTTON_SELECTOR)) {
      oStyle.setProperty(
        `--${nodeButton.id}`,
        Number.parseInt(nodeButton.value.slice(1, 3), 16) +
        "," +
        Number.parseInt(nodeButton.value.slice(3, 5), 16) +
        "," +
        Number.parseInt(nodeButton.value.slice(5, 7), 16)
      );
    }
    const nOpacity = Round(
      1 - m_Settings.Get("nOpacity") / 100,
      2
    );
    oStyle.setProperty("--nOpacity", nOpacity);
    oStyle.setProperty(
      "--nWindowOpacity",
      Clamp(nOpacity, 0.85, 1)
    );
  }
  function ApplyInterfaceSize() {
    document.documentElement.style.fontSize = `${(16 * m_Settings.Get("nInterfaceSize")) / 100
      }px`;
    m_MediaQuery.updateSlowly();
  }
  function Start() {
    m_i18n.TranslateDocument(document);
    _oOpacity = new NumberInput("nOpacity", 5, 0, "opacity");
    _oOpacity.AfterChange = UpdateStyles;
    document.addEventListener("input", HandleColourInput);
    document.addEventListener("change", HandleColourChange);
    m_Events.AddHandler(
      "settings-presetchanged-appearance",
      HandleAppearancePresetChange
    );
    HandleAppearancePresetChange();
    new NumberInput(
      "nInterfaceSize",
      1,
      0,
      "interfacesize"
    ).AfterChange = ApplyInterfaceSize;
    ApplyInterfaceSize();
    ShowElement(document.body, true);
  }
  return {
    Start,
  };
})();
