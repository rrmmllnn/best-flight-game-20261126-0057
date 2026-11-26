// Keyboard and mouse, one place. The stick is the arrow keys (or WASD);
// Shift/W throttles up, Control/S throttles down; the mouse steers too —
// drag left or right to bank, up or down to pitch. Actions are edge-triggered
// bits the main loop takes once per frame.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MISSION_1 = 4;
export const ACTION_MISSION_2 = 8;
export const ACTION_MISSION_3 = 16;
export const ACTION_GEAR = 32;
export const ACTION_FLAPS = 64;
export const ACTION_BRAKE = 128;
export const ACTION_MUTE = 256;

const KEY_ACTIONS = {
  Enter: ACTION_CONFIRM,
  Space: ACTION_CONFIRM,
  KeyP: ACTION_PAUSE,
  Escape: ACTION_PAUSE,
  Digit1: ACTION_MISSION_1,
  Digit2: ACTION_MISSION_2,
  Digit3: ACTION_MISSION_3,
  KeyG: ACTION_GEAR,
  KeyF: ACTION_FLAPS,
  KeyM: ACTION_MUTE,
};

export function createInput(canvas) {
  const keys = new Set();
  let queued = 0;
  const pointer = { active: false, dx: 0, dy: 0, startX: 0, startY: 0 };
  let clicked = false;
  let lastClick = null;

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    const action = KEY_ACTIONS[event.code];
    if (action) queued |= action;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onPointerDown(event) {
    pointer.active = true;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    pointer.dx = 0;
    pointer.dy = 0;
    clicked = true;
    lastClick = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event) {
    if (!pointer.active) return;
    pointer.dx = (event.clientX - pointer.startX) / 160;
    pointer.dy = (event.clientY - pointer.startY) / 160;
  }

  function onPointerUp() {
    pointer.active = false;
    pointer.dx = 0;
    pointer.dy = 0;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  function clamp01(value) {
    return value < -1 ? -1 : value > 1 ? 1 : value;
  }

  return {
    /** Stick position: pitch up positive, roll right positive. */
    stick() {
      let pitch = 0;
      let roll = 0;
      if (keys.has('ArrowUp') || keys.has('KeyW')) pitch += 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) pitch -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) roll += 1;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) roll -= 1;
      if (pointer.active) {
        roll += clamp01(pointer.dx);
        pitch -= clamp01(pointer.dy);
      }
      return { pitch: clamp01(pitch), roll: clamp01(roll) };
    },
    throttleUp() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyE');
    },
    throttleDown() {
      return keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyQ');
    },
    brake() {
      return keys.has('KeyB') || keys.has('Space');
    },
    /** Edge-triggered actions since the last take, plus any mouse click. */
    takeActions() {
      const actions = queued;
      queued = 0;
      if (clicked) {
        clicked = false;
        return actions | ACTION_CONFIRM;
      }
      return actions;
    },
    /** The last pointer-down position, in client pixels, taken once. */
    takeClick() {
      const click = lastClick;
      lastClick = null;
      return click;
    },
    /** True while the pointer is dragging the stick. */
    pointerActive() {
      return pointer.active;
    },
  };
}
