// On-screen controls for touch screens. Buttons are DOM elements over the
// canvas, and each one simply holds a semantic action in Input while it is
// pressed -- the game cannot tell a button from a key.
//
// The set of buttons follows the game's screen. Everything sits in a band
// along the bottom edge (bar the throttle pair, which stacks above the right
// thumb in flight), and the renderer is told how tall that band is so
// readouts and menus lay themselves out above it.

// kind 'hold' buttons are for actions read with isDown (rotation, throttle,
// boost, hangar adjust with auto-repeat); everything else is edge-triggered.
const B = {
  up: { label: '▲', action: 'up' },
  down: { label: '▼', action: 'down' },
  left: { label: '◀', action: 'left', hold: true },
  right: { label: '▶', action: 'right', hold: true },
  confirm: (label) => ({ label, action: 'confirm', wide: true, tone: 'go' }),
};

function layoutFor(game) {
  switch (game.screen) {
    case 'difficulty':
      return { left: [B.up, B.down], right: [B.confirm('START')] };

    case 'hangar': {
      const center = [
        { label: '+ STAGE', action: 'addStage', small: true },
        { label: '− STAGE', action: 'stage', small: true },
      ];
      if (game.session.frontier > 0) {
        center.push({ label: '◀ LVL', action: 'prevLevel', small: true });
        center.push({ label: 'LVL ▶', action: 'nextLevel', small: true });
      }
      if (game.difficulty.hints === 'full') {
        center.push({ label: 'FIT', action: 'suggest', small: true });
      }
      return {
        left: [B.up, B.down],
        center,
        right: [B.left, B.right, { label: 'LAUNCH', action: 'launch', wide: true, tone: 'go' }],
      };
    }

    case 'flying': {
      const center = [{ label: 'STAGE', action: 'stage', small: true }];
      if (game.holdModes.length) {
        center.push({ label: 'HOLD', action: 'hold', small: true });
        center.push({ label: 'MODE', action: 'holdMode', small: true });
      }
      center.push(
        { label: 'MAP', action: 'map', small: true },
        { label: 'WARP−', action: 'warpDown', small: true },
        { label: 'WARP+', action: 'warpUp', small: true },
        { label: 'II', action: 'pause', small: true },
      );
      return {
        left: [{ ...B.left, big: true }, { ...B.right, big: true }],
        center,
        right: [
          { label: 'CUT', action: 'cutoff' },
          { label: 'BOOST', action: 'boost', hold: true, big: true, wide: true, tone: 'flame' },
        ],
        upper: [
          { label: 'THR ▲', action: 'throttleUp', hold: true },
          { label: 'THR ▼', action: 'throttleDown', hold: true },
        ],
      };
    }

    case 'paused':
      return {
        center: [
          { label: 'HUD', action: 'hud' },
          { label: 'ABORT', action: 'restart', tone: 'danger' },
        ],
        right: [{ label: 'RESUME', action: 'pause', wide: true, tone: 'go' }],
      };

    case 'result':
      return { right: [B.confirm('CONTINUE')] };

    case 'complete':
      return {
        center: [{ label: 'NEW CAMPAIGN', action: 'restart', wide: true }],
        right: [B.confirm('HANGAR')],
      };

    default:
      return {};
  }
}

const GROUPS = ['left', 'center', 'right', 'upper'];

export class TouchControls {
  constructor(input, renderer, root = document.body) {
    this.input = input;
    this.renderer = renderer;
    this.key = '';
    this.held = new Set();    // actions currently held by a button

    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.groups = {};
    for (const g of GROUPS) {
      const div = document.createElement('div');
      div.className = `group ${g}`;
      this.el.appendChild(div);
      this.groups[g] = div;
    }
    root.appendChild(this.el);

    const rotate = document.createElement('div');
    rotate.id = 'rotate';
    rotate.textContent = 'ROTATE TO LANDSCAPE';
    root.appendChild(rotate);

    // The first touch asks for fullscreen: the browser chrome takes a big
    // share of a phone held sideways. iPhone Safari has no element
    // fullscreen at all; Add to Home Screen is the way to get it there.
    const goFullscreen = () => {
      if (!this.input.touch) return;
      document.removeEventListener('pointerdown', goFullscreen, true);
      const el = document.documentElement;
      if (!el.requestFullscreen || document.fullscreenElement) return;
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => {});
    };
    document.addEventListener('pointerdown', goFullscreen, true);

    input.onModeChange = () => { this.key = ''; };
  }

  /** Call once per frame; rebuilds only when the button set changes. */
  update(game) {
    const on = this.input.touch;
    document.body.classList.toggle('touch', on);
    const layout = on ? layoutFor(game) : {};
    const key = JSON.stringify(layout);
    if (key === this.key) return;
    this.key = key;
    this.build(layout);
  }

  build(layout) {
    // Nothing may stay held by a button that is about to disappear.
    for (const a of this.held) this.input.release(a);
    this.held.clear();

    for (const g of GROUPS) {
      const div = this.groups[g];
      div.replaceChildren(...(layout[g] || []).map((b) => this.button(b)));
    }
    this.measure();
  }

  button(def) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = def.label;
    el.className = [
      def.big && 'big', def.small && 'small', def.wide && 'wide', def.tone,
    ].filter(Boolean).join(' ');

    const pointers = new Set();
    const down = (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (!pointers.size) {
        this.input.press(def.action);
        this.held.add(def.action);
        el.classList.add('on');
      }
      pointers.add(e.pointerId);
    };
    const up = (e) => {
      if (!pointers.delete(e.pointerId) || pointers.size) return;
      this.input.release(def.action);
      this.held.delete(def.action);
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  /**
   * Keep the centre row clear of the thumb groups, and tell the renderer how
   * much of the canvas the bottom band covers.
   */
  measure() {
    const { left, center, right } = this.groups;
    const canvas = this.renderer.canvas.getBoundingClientRect();
    const l = left.getBoundingClientRect();
    const r = right.getBoundingClientRect();
    center.style.left = `${left.childElementCount ? l.right + 10 : canvas.left + 12}px`;
    center.style.right = `${right.childElementCount
      ? window.innerWidth - r.left + 10 : window.innerWidth - canvas.right + 12}px`;

    let top = canvas.bottom;
    for (const g of [left, center, right]) {
      if (g.childElementCount) top = Math.min(top, g.getBoundingClientRect().top);
    }
    this.renderer.insetBottom = top < canvas.bottom ? canvas.bottom - top + 6 : 0;
  }

  /** Layout depends on the viewport, so re-measure when it changes. */
  resize() { this.measure(); }
}
