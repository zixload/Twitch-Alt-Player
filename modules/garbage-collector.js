"use strict";
/*
	Where finished video buffers go -- and they go at once.

	A stream's segments add up to tens of megabytes an hour. Dropped the ordinary way, a buffer waits
	for the garbage collector, and by the time it runs the player has already allocated the next
	seconds of stream. Over a session of several hours that is a sawtooth of memory the page never
	needed.

	So a buffer the player is done with is posted to a MessagePort with itself in the transfer list.
	A transfer DETACHES the buffer: on this side it drops to zero bytes on the spot, and the receiving
	end of the channel was closed before anything was sent, so nothing picks it up on the other. The
	memory is released at the call, deterministically.

	That is the whole contract, and it cannot be seen from outside. Lose the transfer list and the
	buffer is merely copied into a dead port: nothing throws, nothing is logged, the stream plays --
	and the player leaks. tests/garbage-collector.test.js asserts the detach, because nothing else
	would notice.

	On mobile the module does nothing at all. That was the original author's choice; it is kept, and
	not re-derived here.

	What is gone: a second implementation that handed buffers to a worker thread, recycler.js, and
	"burned" them by terminating it. It was chosen only below Chrome 67. manifest.json requires 92,
	and MV3 alone requires 88, so no browser able to load this extension ever ran it. Burn() went with
	it: in every configuration that could run it was an empty function, called once at shutdown.
*/
const m_GarbageCollector = (() => {
  if (isMobileDevice()) {
    return {
      Discard: STUB,
    };
  }

  // Opened on first use, its receiving end closed at once: nothing is ever meant to arrive.
  let _oDeadPort = null;

  // Takes an ArrayBuffer or any view onto one. Anything else, or an empty buffer, is ignored.
  function Discard(pJunk) {
    if (!IsObject(pJunk)) {
      return;
    }
    const bufJunk = pJunk.buffer ? pJunk.buffer : pJunk;
    if (!bufJunk.byteLength) {
      return;
    }
    m_Log.Here(`[GarbageCollector] Discarding ${bufJunk.byteLength} bytes`);
    if (_oDeadPort === null) {
      const oChannel = new MessageChannel();
      oChannel.port2.close();
      _oDeadPort = oChannel.port1;
    }
    _oDeadPort.postMessage(bufJunk, [bufJunk]);
  }

  return {
    Discard,
  };
})();
