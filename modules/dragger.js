"use strict";

const m_Dragger = (() => {
  const MIN_DRAG_INTERVAL = 45;
  let _nPointerId = NaN;
  let _oParameters = null;
  let _nLastDragTime;
  let _nInitialX, _nInitialY;
  let _nLastX, _nLastY;
  function DragParameters(nodePressed, nodeDragging) {
    this.nodePressed = nodePressed;
    this.nodeDragging = nodeDragging;
    this.nStep = 1;
    this.bCancel = false;
    this.bChangedX = false;
    this.bChangedY = false;
    this.nDeltaX = 0;
    this.nDeltaY = 0;
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
    document.addEventListener(
      "pointermove",
      HandlePointerMove,
      PASSIVE_HANDLER
    );
    document.addEventListener(
      "pointerup",
      HandlePointerUpAndCancel,
      PASSIVE_HANDLER
    );
    document.addEventListener(
      "pointercancel",
      HandlePointerUpAndCancel
    );
    m_Events.AddHandler(
      "focus-statechanged",
      HandleTabLeave
    );
    m_FullscreenMode
      .GetElement()
      .style.setProperty(
        "cursor",
        getComputedStyle(nodePressed).cursor,
        "important"
      );
    m_FullscreenMode.GetElement().classList.add("dragger-capture");
    _oParameters.nodeDragging.classList.add("dragger");
    m_Events.SendEvent(
      `dragger-drag-${_oParameters.nodeDragging.id}`,
      _oParameters
    );
  });
  const HandlePointerMove = AddExceptionHandler((oEvent) => {
    if (_nPointerId === oEvent.pointerId) {
      if ((oEvent.buttons & LEFT_BUTTON_PRESSED) == 0) {
        FinishDrag("button released");
      } else {
        const nTime = performance.now();
        if (
          nTime - _nLastDragTime >=
          MIN_DRAG_INTERVAL
        ) {
          _nLastDragTime = nTime;
          _oParameters.bChangedX = _nLastX !== oEvent.clientX;
          _oParameters.bChangedY = _nLastY !== oEvent.clientY;
          if (_oParameters.bChangedX || _oParameters.bChangedY) {
            _nLastX = oEvent.clientX;
            _nLastY = oEvent.clientY;
            _oParameters.nStep = 2;
            _oParameters.nDeltaX = _nLastX - _nInitialX;
            _oParameters.nDeltaY = _nLastY - _nInitialY;
            m_Events.SendEvent(
              `dragger-drag-${_oParameters.nodeDragging.id}`,
              _oParameters
            );
          }
        }
      }
    }
  });
  const HandlePointerUpAndCancel = AddExceptionHandler(
    (oEvent) => {
      if (_nPointerId === oEvent.pointerId) {
        FinishDrag(oEvent.type);
      }
    }
  );
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
    if (_oParameters.nStep !== 3) {
      m_Log.Wow(
        `[Dragger] Finishing drag: ${sReason} X=${_nLastX} Y=${_nLastY}`
      );
      _oParameters.nStep = 3;
      m_Events.SendEvent(
        `dragger-drag-${_oParameters.nodeDragging.id}`,
        _oParameters
      );
      m_FullscreenMode.GetElement().style.removeProperty("cursor");
      m_FullscreenMode
        .GetElement()
        .classList.remove("dragger-capture");
      _oParameters.nodeDragging.classList.remove("dragger");
      document.removeEventListener(
        "pointermove",
        HandlePointerMove,
        PASSIVE_HANDLER
      );
      document.removeEventListener(
        "pointerup",
        HandlePointerUpAndCancel,
        PASSIVE_HANDLER
      );
      document.removeEventListener(
        "pointercancel",
        HandlePointerUpAndCancel
      );
      m_Events.RemoveHandler(
        "focus-statechanged",
        HandleTabLeave
      );
      _nPointerId = NaN;
      _oParameters = null;
    }
  }
  document.addEventListener(
    "pointerdown",
    HandlePointerDown,
    PASSIVE_HANDLER
  );
  return {
    CancelDrag,
  };
})();
