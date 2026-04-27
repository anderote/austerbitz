export interface InputState {
  mouse: { x: number; y: number; buttons: number };
  wheelDelta: number;
  /** Held keys keyed by KeyboardEvent.code (e.g. 'KeyA', 'ArrowLeft', 'ShiftLeft'). */
  keys: Set<string>;
  // Edge consumed events:
  consumedWheel: number;
}

export interface InputManager {
  state: InputState;
  /** Call once per frame to swap consumed values. */
  beginFrame(): void;
  destroy(): void;
}

export function createInputManager(target: HTMLElement): InputManager {
  const state: InputState = {
    mouse: { x: 0, y: 0, buttons: 0 },
    wheelDelta: 0,
    keys: new Set(),
    consumedWheel: 0,
  };

  const onMouseMove = (e: MouseEvent) => {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
  };
  const onMouseDown = (e: MouseEvent) => {
    state.mouse.buttons |= 1 << e.button;
    target.focus();
  };
  const onMouseUp = (e: MouseEvent) => {
    state.mouse.buttons &= ~(1 << e.button);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
    // Normalize line-mode deltas to roughly pixel-mode magnitudes.
    const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1;
    state.wheelDelta += e.deltaY * factor;
  };
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    state.keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    state.keys.delete(e.code);
  };
  const onBlur = () => {
    state.keys.clear();
    state.mouse.buttons = 0;
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  // Wheel is scoped to the canvas so wheel events on UI panels (e.g. a future
  // scrollable build menu) aren't swallowed.
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    state,
    beginFrame() {
      state.consumedWheel = state.wheelDelta;
      state.wheelDelta = 0;
    },
    destroy() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
