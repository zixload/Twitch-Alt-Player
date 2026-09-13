"use strict";
/*
	The player's skin: the colours the viewer picks, how far through the panels you can see, and how
	big the whole interface is.

	**A colour control's id is the name of its setting.** That is what lets this module handle all of
	them without naming a single one — and what makes a renamed id fail quietly, since the loop then
	finds nothing to write. The cross-check exists for exactly that.

	**`input` and `change` are two different moments.** While the viewer drags inside the colour
	picker, `input` arrives continuously and the player recolours itself live. `change` arrives once,
	on release, and only that one is written to storage. Treating them alike would write to
	chrome.storage on every pixel of a drag.

	The opacity setting is a *transparency*: zero means opaque. The stylesheet wants the opposite, so
	it is turned around here — and windows never go below a floor, because settings text over moving
	video stops being readable well before panels do.

	The interface size is a font size on the root element. Every length in the player is in rem, so
	one number scales all of it; m_MediaQuery's fold thresholds are measured in those same interface
	pixels, which is why it is asked to measure again.

	The body starts hidden and this module is what shows it. Everything above has to be applied
	first: nobody should watch the default colours flash by before their own arrive.
*/
const m_Appearance = (() => {
  const COLOUR_CONTROL = 'input[type="color"]';
  const WINDOW_MIN_OPACITY = 0.85;
  const BASE_FONT_SIZE = 16;

  let _oOpacityInput = null;

  const ColourControls = () => document.querySelectorAll(COLOUR_CONTROL);

  const HandleColourInput = AddExceptionHandler((oEvent) => {
    if (oEvent.target.matches(COLOUR_CONTROL)) {
      ApplyStyles();
    }
  });

  const HandleColourChange = AddExceptionHandler((oEvent) => {
    if (oEvent.target.matches(COLOUR_CONTROL)) {
      m_Settings.Change(oEvent.target.id, oEvent.target.value);
    }
  });

  // « #rrggbb » devient « r,g,b » : la feuille de style compose l'alpha elle-meme.
  function ToComponents(sColour) {
    return [1, 3, 5]
      .map((nAt) => Number.parseInt(sColour.slice(nAt, nAt + 2), 16))
      .join(",");
  }

  function ReadControlsFromSettings() {
    for (const elControl of ColourControls()) {
      elControl.value = m_Settings.Get(elControl.id);
    }
    _oOpacityInput.Update();
  }

  function ApplyStyles() {
    const oStyle = document.documentElement.style;
    for (const elControl of ColourControls()) {
      oStyle.setProperty(`--${elControl.id}`, ToComponents(elControl.value));
    }
    const nOpacity = Round(1 - m_Settings.Get("nOpacity") / 100, 2);
    oStyle.setProperty("--nOpacity", nOpacity);
    oStyle.setProperty(
      "--nWindowOpacity",
      Clamp(nOpacity, WINDOW_MIN_OPACITY, 1)
    );
  }

  function ApplyInterfaceSize() {
    const nSize = m_Settings.Get("nInterfaceSize");
    document.documentElement.style.fontSize = `${(BASE_FONT_SIZE * nSize) / 100}px`;
    m_MediaQuery.updateSlowly();
  }

  function HandlePresetChange() {
    ReadControlsFromSettings();
    ApplyStyles();
  }

  function Start() {
    m_i18n.TranslateDocument(document);

    _oOpacityInput = new NumberInput("nOpacity", 5, 0, "opacity");
    _oOpacityInput.AfterChange = ApplyStyles;

    document.addEventListener("input", HandleColourInput);
    document.addEventListener("change", HandleColourChange);
    m_Events.AddHandler(
      "settings-presetchanged-appearance",
      HandlePresetChange
    );
    HandlePresetChange();

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
