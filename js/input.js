// Keyboard state. Held keys drive flight; edge-triggered presses drive menus.
// Game code only ever reads the semantic actions below, never raw key codes,
// so the on-screen touch controls (touch.js) drive the same actions through
// press() and release() without touching game logic.
//
// A key can fire more than one action: Up/W is both "thrust" in flight and
// "move up" in a menu, and the two contexts never overlap.

const KEY_MAP = {
  ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ArrowUp: ['throttleUp', 'up'], KeyW: ['throttleUp', 'up'],
  ArrowDown: ['throttleDown', 'down'], KeyS: ['throttleDown', 'down'],
  // Momentary full thrust, so a landing can still be flown by tapping one key.
  Space: ['boost'],
  KeyF: ['cutoff'],
  KeyT: ['hold'],
  KeyG: ['holdMode'],
  Enter: ['confirm'],
  Escape: ['pause'],
  KeyP: ['pause'],
  KeyH: ['hud'],
  KeyM: ['map'],
  KeyR: ['restart'],
  KeyU: ['launch'],
  KeyX: ['stage'],
  KeyN: ['addStage'],
  KeyB: ['suggest'],
  KeyQ: ['prevLevel'],
  KeyE: ['nextLevel'],
  Comma: ['warpDown'],
  Period: ['warpUp'],
  BracketLeft: ['warpDown'],
  BracketRight: ['warpUp'],
};

// A touch that moves further than this (CSS px) is a drag, not a tap.
const TAP_SLOP = 10;

export class Input {
  constructor(target = window) {
    this.held = new Set();
    this.pressed = new Set();
    // Pointer gestures on the canvas, in logical canvas pixels, for this
    // frame only: taps select things, scrolls move overflowing panels.
    this.taps = [];
    this.scrolls = [];
    // True while the player is on a touch screen. It decides which controls
    // are shown and how on-screen hints are worded; a key press flips it back
    // so a tablet with a keyboard attached reads like the desktop game.
    this.touch = typeof matchMedia === 'function'
      && matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.onModeChange = null;

    target.addEventListener('keydown', (e) => {
      const actions = KEY_MAP[e.code];
      if (!actions) return;
      e.preventDefault();
      this.setTouch(false);
      for (const a of actions) this.press(a);
    });

    target.addEventListener('keyup', (e) => {
      const actions = KEY_MAP[e.code];
      if (!actions) return;
      e.preventDefault();
      for (const a of actions) this.release(a);
    });

    // Losing focus mid-burn should not leave the engine stuck on.
    window.addEventListener('blur', () => this.held.clear());
  }

  setTouch(on) {
    if (this.touch === on) return;
    this.touch = on;
    if (this.onModeChange) this.onModeChange(on);
  }

  /** Start holding an action. Edge-triggered on the first press only. */
  press(action) {
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  }

  release(action) { this.held.delete(action); }

  /**
   * Taps, drags and the mouse wheel on the canvas. `renderer` converts client
   * coordinates to the logical pixels everything is laid out in.
   */
  bindCanvas(canvas, renderer) {
    const active = new Map();   // pointerId -> { x, y, lastY, dragging }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setTouch(true);
      active.set(e.pointerId, { x: e.clientX, y: e.clientY, lastY: e.clientY, dragging: false });
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = active.get(e.pointerId);
      if (!p) return;
      if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) {
        p.dragging = true;
      }
      if (p.dragging) {
        const at = renderer.toLogical(e.clientX, e.clientY);
        // Content follows the finger, so dragging up scrolls down.
        this.scrolls.push({ ...at, dy: (p.lastY - e.clientY) * renderer.fit });
        p.lastY = e.clientY;
      }
    });

    const end = (e) => {
      const p = active.get(e.pointerId);
      active.delete(e.pointerId);
      if (p && !p.dragging && e.type === 'pointerup') {
        this.taps.push(renderer.toLogical(e.clientX, e.clientY));
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const at = renderer.toLogical(e.clientX, e.clientY);
      // deltaMode 1 is lines, as some mice report.
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      this.scrolls.push({ ...at, dy: dy * renderer.fit });
    }, { passive: false });
  }

  isDown(action) { return this.held.has(action); }

  /** True once per physical key press. */
  wasPressed(action) { return this.pressed.has(action); }

  /** Call at the end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.taps.length = 0;
    this.scrolls.length = 0;
  }
}
