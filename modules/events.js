"use strict";
/*
	The switchboard between modules. A module announces what it did, by name; whoever cares has
	registered a function under that name.

	Deliberately synchronous. SendEvent returns only once every handler has run, in the order they
	registered, so the sender may rely on the rest of the player having reacted. A handler that sends
	an event of its own runs that dispatch to completion before the outer one moves on.

	The order of a dispatch is read from the live set, not from a copy taken when it starts. Two
	things follow. A handler removed before its turn does not run. A handler registered during the
	dispatch, for the event being dispatched, runs in that same dispatch. Nothing in the player relies
	on the second today; it is written here so that changing it is a decision and not an accident.

	Handlers are functions, and only functions. The old dispatcher also accepted a DOM-style listener
	object with a handleEvent method, and built a shared { type, data } object for it. Not one
	registration in the extension ever passed such an object -- checked on the syntax tree, each
	handler resolved to its declaration -- so that second calling convention is gone, and refused,
	rather than kept alive with nobody exercising it.
*/
const m_Events = (() => {
  // Event name -> the functions registered under it. An entry exists only while it holds one.
  const _mafHandlers = new Map();

  function checkRegistration(sEvent, fHandler) {
    Check(IsNonEmptyString(sEvent));
    Check(typeof fHandler == "function");
  }

  // Registering the same function twice for one event is one registration: it runs once.
  function AddHandler(sEvent, fHandler) {
    checkRegistration(sEvent, fHandler);
    const setHandlers = _mafHandlers.get(sEvent);
    if (setHandlers) {
      setHandlers.add(fHandler);
    } else {
      _mafHandlers.set(sEvent, new Set([fHandler]));
    }
  }

  // Removing what was never registered does nothing: teardown need not remember what it set up.
  function RemoveHandler(sEvent, fHandler) {
    checkRegistration(sEvent, fHandler);
    const setHandlers = _mafHandlers.get(sEvent);
    if (setHandlers && setHandlers.delete(fHandler) && setHandlers.size === 0) {
      _mafHandlers.delete(sEvent);
    }
  }

  // Every handler receives the data first and the event name second, so that one function can
  // serve several events and still tell them apart.
  function SendEvent(sEvent, pData) {
    Check(IsNonEmptyString(sEvent));
    m_Log.Here(`[Events] Event occurred: ${sEvent}`);
    const setHandlers = _mafHandlers.get(sEvent);
    if (!setHandlers) {
      return;
    }
    // RemoveHandler never leaves an empty set behind; one here means the map was corrupted.
    Check(setHandlers.size !== 0);
    for (const fHandler of setHandlers) {
      fHandler(pData, sEvent);
    }
  }

  return {
    AddHandler,
    RemoveHandler,
    SendEvent,
  };
})();
