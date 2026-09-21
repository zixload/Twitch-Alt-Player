"use strict";
/*
	The progress bar of a replay: how far in we are, and where the viewer wants to go.

	It holds one time window — the start and end of what can be replayed — and the position watched
	inside it, all in the media element's own time base. Everything it is asked is relative to that
	window, and every position it is given is brought back inside it: a playback clock that runs a
	little past the end of the last segment is normal, and must not paint past the end of the bar.

	**The filled part is painted with a scaleX, not a width.** The position is set as often as the
	video reports a new time, and a width would put the page through layout each time; a transform
	is composited and costs nothing. Four decimals is more than a screen can show.

	**A click seeks during a replay, and during the live DVR.** In a replay it moves within the frozen
	recording; live, it rewinds into the buffer without cutting the stream, and a click near the end is
	a return to the live edge. Only when the broadcast is fully stopped is a click dropped.

	Where the click lands is measured on the bar's content box: the bar carries padding so the
	handle can hang over its ends without leaving it, and the padding is not part of the timeline.
	The pointer is read one pixel to the right of where the browser puts it — measured, kept as is;
	removing it moves every seek by a pixel's worth of time.

	Nothing here moves the player. It works out a time and asks m_Player for it.
*/
const m_Scale = (() => {
  const PAINT_PRECISION = 4;
  const POINTER_OFFSET = 1;

  let _nStart = 0;
  let _nEnd = 0;
  let _nWatched;

  function InsideWindow(nTime) {
    return Clamp(nTime, _nStart, _nEnd);
  }

  function Paint() {
    Check(
      Number.isFinite(_nStart) &&
      Number.isFinite(_nEnd) &&
      Number.isFinite(_nWatched)
    );
    const nRatio = (_nWatched - _nStart) / (_nEnd - _nStart);
    GetNode("scale-watched").style.transform = `scaleX(${nRatio.toFixed(
      PAINT_PRECISION
    )})`;
  }

  const HandleClick = AddExceptionHandler((oEvent) => {
    const nState = m_Controls.GetState();
    if (nState !== STATE_REPEAT && nState !== STATE_PLAYING) {
      return;
    }
    const elScale = oEvent.currentTarget;
    const oBorder = elScale.getBoundingClientRect();
    const oStyle = getComputedStyle(elScale);
    const nBarStart = Math.round(
      oBorder.left + Number.parseFloat(oStyle.paddingLeft)
    );
    const nBarEnd = Math.round(
      oBorder.right - Number.parseFloat(oStyle.paddingRight)
    );
    const nAlong =
      (oEvent.clientX + POINTER_OFFSET - nBarStart) / (nBarEnd - nBarStart);
    const nSeekTo = InsideWindow(nAlong * (_nEnd - _nStart) + _nStart);
    m_Log.Wow(`[Scale] Seeking to ${nSeekTo}`);
    // En rediffusion, on se deplace dans l'enregistrement fige ; en direct, on rembobine dans le
    // tampon sans couper le flux (DVR).
    if (nState === STATE_PLAYING) {
      // La fenetre peut etre celle de la diffusion entiere : seul m_Controls sait alors laquelle
      // des deux sources doit prendre le point vise.
      m_Controls.SeekBroadcastTo(nSeekTo);
    } else {
      m_Player.SeekReplayTo(nSeekTo);
    }
  });

  /*
    L'ecouteur est pose ici et non a la construction : la barre n'a de sens qu'une fois une fenetre
    connue. Le reposer a chaque rediffusion ne le double pas -- c'est la meme fonction, et le
    navigateur ne garde qu'un exemplaire de la meme paire (type, fonction).
  */
  function SetStartAndEnd(nStart, nEnd) {
    Check(nStart <= nEnd);
    _nStart = nStart;
    _nEnd = nEnd;
    GetNode("scale").addEventListener("click", HandleClick);
  }

  function SetWatched(nWatched) {
    _nWatched = InsideWindow(nWatched);
    Paint();
  }

  function GetStart() {
    return _nStart;
  }

  function GetEnd() {
    return _nEnd;
  }

  return {
    SetStartAndEnd,
    SetWatched,
    GetStart,
    GetEnd,
  };
})();
