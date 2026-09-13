"use strict";
/*
	The pulse: is this page still being served, and is the clock still the clock?

	Nothing here is visible. Once a second — a little under, so the beat does not fall in step with
	everything else that runs on the second — it wakes up and measures two things.

	**Lateness**: how much later than asked the browser actually woke us. A few milliseconds is
	normal; two hundred means the page was not being served, and that is exactly what a viewer
	reports as stutter. The worst value seen goes into the bug report, where it answers the question
	the log alone cannot: was the player slow, or was the machine?

	**Clock jump**: how far the wall clock drifted from the monotonic clock while we were away. They
	should advance together; when they do not, the system clock has been set — a time sync, a resume
	from sleep, a manual change. Segment timing is computed from wall-clock dates, so a jump explains
	failures that otherwise look like the server's fault. The two numbers look alike in a report if
	they are not kept apart, which is why they are measured and logged separately.

	**It only beats while someone is watching.** A stopped, finished or replayed player has nothing
	to be late for, and would fill the log with complaints nobody asked for. State changes arrive
	dozens of times a session, so starting and stopping are idempotent: the same state twice does
	nothing the second time.

	The beat re-arms itself after each measurement instead of running on an interval. A late beat
	then simply shifts the next one, where an interval would queue them up and turn one stall into a
	burst of complaints.
*/
const m_Heartbeat = (() => {
  const BEAT_INTERVAL = 970;
  const TOO_EARLY = -30;
  const TOO_LATE = 200;
  const CLOCK_JUMP_LIMIT = 40;

  let _nWorstLateness = 0;
  let _nTimer = 0;
  let _nLastTime;
  let _nLastDate;

  const Beat = AddExceptionHandler(() => {
    const nTime = performance.now();
    const nDate = Date.now();
    const nLateness = nTime - _nLastTime - BEAT_INTERVAL;
    const nClockJump = nDate - _nLastDate - (nTime - _nLastTime);
    if (
      nLateness < TOO_EARLY ||
      nLateness > TOO_LATE ||
      Math.abs(nClockJump) > CLOCK_JUMP_LIMIT
    ) {
      m_Log.Oops(
        `[Heartbeat] ${m_Log.F0(nLateness)} ${m_Log.F0(nClockJump)}`
      );
    }
    _nWorstLateness = Math.max(_nWorstLateness, nLateness);
    _nLastTime = nTime;
    _nLastDate = nDate;
    _nTimer = setTimeout(Beat, BEAT_INTERVAL);
  });

  function Start() {
    if (_nTimer !== 0) {
      return;
    }
    m_Log.Here("[Heartbeat] Timer started");
    _nLastTime = performance.now();
    _nLastDate = Date.now();
    _nTimer = setTimeout(Beat, BEAT_INTERVAL);
  }

  function Stop() {
    if (_nTimer === 0) {
      return;
    }
    m_Log.Here("[Heartbeat] Timer stopped");
    clearTimeout(_nTimer);
    _nTimer = 0;
  }

  /*
    Les etats sont compares ici plutot que ranges dans un ensemble construit avec le module : les
    constantes d'etat vivent dans player.js, et ce fichier peut se charger avant lui. Les lire
    pendant la construction serait une dependance d'ordre, pour rien.
  */
  function HandleStateChange(nState) {
    if (
      nState === STATE_BROADCAST_END ||
      nState === STATE_STOP ||
      nState === STATE_REPEAT
    ) {
      Stop();
    } else {
      Start();
    }
  }

  function GetDataForReport() {
    return _nWorstLateness;
  }

  m_Events.AddHandler("controls-statechanged", HandleStateChange);

  return {
    GetDataForReport,
  };
})();
