"use strict";
/*
	Dragging, for everything in the player that can be dragged: the statistics panel, the chat
	divider, the plus and minus of every number setting.

	**The handle and the thing that moves are two different elements.** You grab a table header or a
	button; what moves is named by that element's `data-dragger` attribute. One listener on the
	document therefore serves every draggable thing in the player, and adding a new one is an
	attribute in the markup — no registration, no code here.

	**One drag at a time, and three moments.** Pressing starts it, each retained move continues it,
	and one of five things ends it: the pointer released, the pointer cancelled, the left button no
	longer held during a move, the tab losing the keyboard, or an explicit cancellation. All three
	moments arrive on the same event, `dragger-drag-<id of the element being dragged>`, and the step
	number tells them apart. A second press while a drag is running is ignored.

	**The same parameters object travels through the whole drag**, mutated from step to step. A
	listener that keeps a reference sees the values change under it, which is what makes a drag
	cheap — no allocation per move — and what makes replacing it with a fresh object per step a
	behaviour change rather than a tidy-up.

	A cancelled drag sets bCancel before its last step: the listener has to undo, not commit. That
	is how Escape and a tab switch leave a panel where it was rather than where the pointer stopped.

	**One move per 45 ms, and only when the pointer really moved.** A pointer reports hundreds of
	moves a second, each one costing a listener a layout; the two filters are what keep a drag from
	melting the machine.

	While a drag runs, the fullscreen element carries `dragger-capture` and the handle's cursor is
	forced onto it: without that, the cursor flickers as it passes over elements with cursors of
	their own, and the drag looks broken even though it works. The document listeners exist only for
	the duration — nothing is bound while the player sits idle.
*/
const m_Dragger = (() => {
  const MIN_DRAG_INTERVAL = 45;
  const STEP_START = 1;
  const STEP_MOVE = 2;
  const STEP_END = 3;

  let _nPointerId = NaN;
  let _oParameters = null;
  let _nLastDragTime = 0;
  let _nInitialX = 0;
  let _nInitialY = 0;
  let _nLastX = 0;
  let _nLastY = 0;

  function DragParameters(nodePressed, nodeDragging) {
    this.nodePressed = nodePressed;
    this.nodeDragging = nodeDragging;
    this.nStep = STEP_START;
    this.bCancel = false;
    this.bChangedX = false;
    this.bChangedY = false;
    this.nDeltaX = 0;
    this.nDeltaY = 0;
  }

  function Announce() {
    m_Events.SendEvent(
      `dragger-drag-${_oParameters.nodeDragging.id}`,
      _oParameters
    );
  }

  function CaptureElement() {
    return m_FullscreenMode.GetElement();
  }

  const HandlePointerDown = createElementEventHandler((oEvent) => {
    if (!Number.isNaN(_nPointerId) || oEvent.button !== LEFT_BUTTON) {
      return;
    }
    const nodePressed = oEvent.target.closest("[data-dragger]");
    if (nodePressed === null) {
      return;
    }
    _nPointerId = oEvent.pointerId;
    _oParameters = new DragParameters(
      nodePressed,
      GetNode(nodePressed.getAttribute("data-dragger"))
    );
    _nLastDragTime = 0;
    _nInitialX = _nLastX = oEvent.clientX;
    _nInitialY = _nLastY = oEvent.clientY;
    m_Log.Wow(
      `[Dragger] Starting to drag ${_oParameters.nodeDragging.id} X=${_nInitialX} Y=${_nInitialY} id=${_nPointerId} type=${oEvent.pointerType} primary=${oEvent.isPrimary}`
    );
    document.addEventListener("pointermove", HandlePointerMove, PASSIVE_HANDLER);
    document.addEventListener("pointerup", HandlePointerUpAndCancel, PASSIVE_HANDLER);
    document.addEventListener("pointercancel", HandlePointerUpAndCancel);
    m_Events.AddHandler("focus-statechanged", HandleTabLeave);
    CaptureElement().style.setProperty(
      "cursor",
      getComputedStyle(nodePressed).cursor,
      "important"
    );
    CaptureElement().classList.add("dragger-capture");
    _oParameters.nodeDragging.classList.add("dragger");
    Announce();
  });

  const HandlePointerMove = AddExceptionHandler((oEvent) => {
    if (_nPointerId !== oEvent.pointerId) {
      return;
    }
    if ((oEvent.buttons & LEFT_BUTTON_PRESSED) === 0) {
      // Le bouton a ete relache hors de la page : personne ne nous l'a dit autrement.
      FinishDrag("button released");
      return;
    }
    const nTime = performance.now();
    if (nTime - _nLastDragTime < MIN_DRAG_INTERVAL) {
      return;
    }
    /*
      La fenetre se referme ici, avant meme de savoir si le pointeur a bouge : un mouvement examine
      est un mouvement paye. Deplacer cette ligne apres le test ci-dessous laisserait un pointeur
      immobile rouvrir la fenetre a chaque evenement, et le premier vrai mouvement passerait sans
      attendre son tour.
    */
    _nLastDragTime = nTime;
    _oParameters.bChangedX = _nLastX !== oEvent.clientX;
    _oParameters.bChangedY = _nLastY !== oEvent.clientY;
    if (!_oParameters.bChangedX && !_oParameters.bChangedY) {
      return;
    }
    _nLastX = oEvent.clientX;
    _nLastY = oEvent.clientY;
    _oParameters.nStep = STEP_MOVE;
    _oParameters.nDeltaX = _nLastX - _nInitialX;
    _oParameters.nDeltaY = _nLastY - _nInitialY;
    Announce();
  });

  const HandlePointerUpAndCancel = AddExceptionHandler((oEvent) => {
    if (_nPointerId === oEvent.pointerId) {
      FinishDrag(oEvent.type);
    }
  });

  function HandleTabLeave({ bActive }) {
    if (!bActive) {
      FinishDrag("tab inactive");
    }
  }

  function CancelDrag(sNodeId) {
    Check(sNodeId === void 0 || IsNonEmptyString(sNodeId));
    if (
      !Number.isNaN(_nPointerId) &&
      (sNodeId === void 0 || sNodeId === _oParameters.nodeDragging.id)
    ) {
      _oParameters.bCancel = true;
      FinishDrag("operation cancelled");
    }
  }

  function FinishDrag(sReason) {
    // Cinq chemins menent ici, et deux peuvent se croiser : la fin ne se fait qu'une fois.
    if (_oParameters.nStep === STEP_END) {
      return;
    }
    m_Log.Wow(`[Dragger] Finishing drag: ${sReason} X=${_nLastX} Y=${_nLastY}`);
    _oParameters.nStep = STEP_END;
    Announce();
    CaptureElement().style.removeProperty("cursor");
    CaptureElement().classList.remove("dragger-capture");
    _oParameters.nodeDragging.classList.remove("dragger");
    document.removeEventListener("pointermove", HandlePointerMove, PASSIVE_HANDLER);
    document.removeEventListener("pointerup", HandlePointerUpAndCancel, PASSIVE_HANDLER);
    document.removeEventListener("pointercancel", HandlePointerUpAndCancel);
    m_Events.RemoveHandler("focus-statechanged", HandleTabLeave);
    _nPointerId = NaN;
    _oParameters = null;
  }

  document.addEventListener("pointerdown", HandlePointerDown, PASSIVE_HANDLER);

  return {
    CancelDrag,
  };
})();
