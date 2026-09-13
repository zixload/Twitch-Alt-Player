"use strict";
/*
	Is the page being looked at?

	Two questions, and the answer to the second depends on the first: a page is *shown* when the tab
	is not hidden, and *active* when it is shown and holds the keyboard focus. A hidden page is never
	active, whatever the browser says about focus — which is why this is one state and not two flags,
	and why hiding a page that had already lost focus announces one change, not two.

	Who cares: the drag stops when the tab leaves (a pointer that comes back would jump), the bug
	report carries the state, and the player knows whether anyone is watching.

	**The browser tells you before the truth is readable.** At the moment `blur` arrives,
	document.hasFocus() still returns true; at the moment `visibilitychange` arrives, the new value
	is already there, but the focus that goes with it may not be. So the module lets a task go by and
	then measures, rather than believing the event.

	Focus events also come in packs — a click that moves focus inside the page can fire several — so
	the measurement is compared with the last one and only a real change is announced. Every
	announcement wakes half the player up.
*/
const m_FocusManager = (() => {
  function CurrentState() {
    const bShown = !document.hidden;
    return {
      bShown,
      bActive: bShown && document.hasFocus(),
    };
  }

  let _oState = CurrentState();

  function GetState() {
    return _oState;
  }

  const Measure = AddExceptionHandler(() => {
    const oNewState = CurrentState();
    if (
      oNewState.bShown === _oState.bShown &&
      oNewState.bActive === _oState.bActive
    ) {
      return;
    }
    m_Log.Wow(`[Focus] New state ${m_Log.O(oNewState)}`);
    _oState = oNewState;
    m_Events.SendEvent("focus-statechanged", oNewState);
  });

  const HandleBrowserEvent = AddExceptionHandler((oEvent) => {
    m_Log.Here(
      `[Focus] Event ${oEvent.type}, previous state ${m_Log.O(_oState)}`
    );
    setTimeout(Measure);
  });

  m_Log.Here(`[Focus] Initial state ${m_Log.O(_oState)}`);
  document.addEventListener("visibilitychange", HandleBrowserEvent);
  window.addEventListener("focus", HandleBrowserEvent);
  window.addEventListener("blur", HandleBrowserEvent);

  return {
    GetState,
  };
})();
