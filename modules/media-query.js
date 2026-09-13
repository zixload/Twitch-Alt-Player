"use strict";
/*
	The player's own media queries, and why the stylesheet cannot hold them.

	A CSS media query measures the viewport. What decides here is the height of the player *as the
	interface sees it*: the interface-size setting scales every control, so at 200 % a player 900
	pixels tall has as much room as one 450 pixels tall. Below 460 interface pixels the main menu
	switches to its folded layout, below 412 the settings panel does. Both are classes on #player,
	and the stylesheet does the rest.

	The top panel is the other half: its font shrinks from 124 % down to 100 % in steps until its
	contents fit. "Fit" is read off #filler, the elastic gap that keeps the panel's two ends apart —
	as long as it has width, there is slack left. At 100 % the loop stops whether it fits or not,
	because a smaller font would be unreadable and something has to give.

	**Asking is not doing.** Two ways to ask: updateQuickly, for the next animation frame — used when
	the player itself changed something and the result must be on screen for the same paint; and
	updateSlowly, two hundred milliseconds later, for a stream of changes that will keep coming, a
	window being dragged by its corner. A quick request supersedes a slow one already waiting; a slow
	request while anything is pending is dropped. One integer holds all of it.

	That integer starts at NEVER_ASKED, and the resize listener refuses to be the first to schedule:
	while the page is still being built, the player has no size worth measuring and the settings are
	not restored yet. The first update always comes from the player.
*/
const m_MediaQuery = (() => {
  const COLLAPSE_MAIN_MENU_BELOW = 460;
  const COLLAPSE_SETTINGS_BELOW = 412;
  const SLOW_DELAY = 200;

  const FONT_SIZE_MAX = 124;
  const FONT_SIZE_MIN = 100;
  const FONT_SIZE_STEP = 8;

  // L'attente en cours : jamais rien demande, une image demandee, rien, ou un minuteur (> 0).
  const NEVER_ASKED = -2;
  const FRAME_ASKED = -1;
  const NOTHING_PENDING = 0;

  let _nPending = NEVER_ASKED;

  const Update = AddExceptionHandler(() => {
    // Elle ne s'execute jamais d'elle-meme : elle a ete demandee, ou l'etat a ete perdu.
    Check(_nPending !== NOTHING_PENDING);
    _nPending = NOTHING_PENDING;
    const elPlayer = GetNode("player");
    const nHeight =
      (elPlayer.clientHeight * 100) / m_Settings.Get("nInterfaceSize");
    Check(nHeight > 0);
    elPlayer.classList.toggle(
      "collapsemainmenu",
      nHeight <= COLLAPSE_MAIN_MENU_BELOW
    );
    elPlayer.classList.toggle(
      "collapsesettings",
      nHeight <= COLLAPSE_SETTINGS_BELOW
    );
    FitTopPanel();
  });

  function FitTopPanel() {
    const oPanelStyle = GetNode("toppanel").style;
    const elFiller = GetNode("filler");
    for (let nFontSize = FONT_SIZE_MAX; ; nFontSize -= FONT_SIZE_STEP) {
      oPanelStyle.fontSize = `${nFontSize}%`;
      if (nFontSize === FONT_SIZE_MIN || elFiller.clientWidth > 0) {
        return;
      }
    }
  }

  function updateQuickly() {
    if (_nPending === FRAME_ASKED) {
      return;
    }
    if (_nPending > NOTHING_PENDING) {
      clearTimeout(_nPending);
    }
    _nPending = FRAME_ASKED;
    requestAnimationFrame(Update);
  }

  function updateSlowly() {
    if (_nPending !== NEVER_ASKED && _nPending !== NOTHING_PENDING) {
      return;
    }
    _nPending = setTimeout(Update, SLOW_DELAY);
    Check(_nPending > NOTHING_PENDING);
  }

  window.addEventListener(
    "resize",
    AddExceptionHandler(() => {
      if (_nPending !== NEVER_ASKED) {
        updateSlowly();
      }
    })
  );

  return {
    updateQuickly,
    updateSlowly,
  };
})();
