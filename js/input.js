// Keyboard state. Held keys drive flight; edge-triggered presses drive menus.
// Game code only ever reads the semantic actions below, never raw key codes,
// so touch controls for mobile attach here without touching game logic.
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

export class Input {
  constructor(target = window) {
    this.held = new Set();
    this.pressed = new Set();

    target.addEventListener('keydown', (e) => {
      const actions = KEY_MAP[e.code];
      if (!actions) return;
      e.preventDefault();
      for (const a of actions) {
        if (!this.held.has(a)) this.pressed.add(a);
        this.held.add(a);
      }
    });

    target.addEventListener('keyup', (e) => {
      const actions = KEY_MAP[e.code];
      if (!actions) return;
      e.preventDefault();
      for (const a of actions) this.held.delete(a);
    });

    // Losing focus mid-burn should not leave the engine stuck on.
    window.addEventListener('blur', () => this.held.clear());
  }

  isDown(action) { return this.held.has(action); }

  /** True once per physical key press. */
  wasPressed(action) { return this.pressed.has(action); }

  /** Call at the end of each frame. */
  endFrame() { this.pressed.clear(); }
}
