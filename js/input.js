// Keyboard state. Held keys drive flight; edge-triggered presses drive menus.
// Touch controls will hook in here later for mobile -- game code only ever
// reads the semantic actions below, never raw key codes.
//
// A key can fire more than one action: Up/W is both "thrust" in flight and
// "move up" in a menu, and the two contexts never overlap.

const KEY_MAP = {
  ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ArrowUp: ['thrust', 'up'], KeyW: ['thrust', 'up'],
  ArrowDown: ['down'], KeyS: ['down'],
  Space: ['thrust'],
  Enter: ['confirm'],
  Escape: ['back'],
  KeyH: ['hud'],
  KeyR: ['restart'],
  KeyU: ['shop'],
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
