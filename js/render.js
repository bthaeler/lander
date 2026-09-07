import { PIXELS_PER_METER } from './config.js';
import { GEOMETRY } from './ship.js';
import { mulberry32, clamp } from './util.js';

// Everything is white line-art on black. `tier` selects graphical fidelity
// and rises as the campaign progresses:
//   1 -- bare wireframe, hairline strokes, sparse stars
//   2 -- glow, terrain hatching, denser starfield
//   3 -- heavier glow, fine hatching, crater detail, horizon wash
const TIER_STYLE = {
  1: { line: 1.3, glow: 0, stars: 140, hatch: 0, starTwinkle: false },
  2: { line: 1.5, glow: 6, stars: 320, hatch: 6, starTwinkle: true },
  3: { line: 1.7, glow: 11, stars: 520, hatch: 3, starTwinkle: true },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.camera = { x: 0, y: 0 };
    // Pixels per metre. The game zooms in as the ship descends (see
    // Game.updateCamera) so the craft reads as a shape on final approach
    // without losing the wide view during the fall.
    this.scale = PIXELS_PER_METER;
    this.tier = 1;
    this.stars = [];
    this.time = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get style() { return TIER_STYLE[this.tier] || TIER_STYLE[1]; }
  get halfViewW() { return this.w / 2 / this.scale; }
  get halfViewH() { return this.h / 2 / this.scale; }

  setTier(tier) {
    if (tier === this.tier && this.stars.length) return;
    this.tier = tier;
    this.buildStars();
  }

  buildStars() {
    const rand = mulberry32(0x5eed + this.tier);
    const n = this.style.stars;
    this.stars = [];
    for (let i = 0; i < n; i++) {
      this.stars.push({
        // Stored in a normalised parallax space, tiled across the screen.
        x: rand(),
        y: rand(),
        b: 0.25 + rand() * 0.6,
        phase: rand() * Math.PI * 2,
      });
    }
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.camera.x) * this.scale + this.w / 2,
      y: this.h / 2 - (wy - this.camera.y) * this.scale,
    };
  }

  /** Ship-local point straight to screen coordinates. */
  shipPoint(ship, p) {
    const w = ship.toWorld(p);
    return this.worldToScreen(w.x, w.y);
  }

  clear() {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Configure stroke style for a pass. */
  stroke(alpha = 1, widthScale = 1, glow = true) {
    const { ctx } = this;
    ctx.strokeStyle = '#fff';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = this.style.line * widthScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = glow ? this.style.glow : 0;
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
  }

  reset() {
    this.ctx.globalAlpha = 1;
    this.ctx.shadowBlur = 0;
  }

  // --- screen-space primitives (used by HUD / menus) ------------------------

  text(str, x, y, opts = {}) {
    const { ctx } = this;
    const size = opts.size || 14;
    ctx.font = `${opts.weight || 400} ${size}px "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.shadowBlur = opts.glow ?? (this.style.glow ? this.style.glow * 0.6 : 0);
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.fillStyle = '#fff';
    ctx.fillText(str, x, y);
    this.reset();
  }

  measure(str, size = 14) {
    this.ctx.font = `400 ${size}px "SF Mono", Menlo, Consolas, monospace`;
    return this.ctx.measureText(str).width;
  }

  lineS(x1, y1, x2, y2, alpha = 1, widthScale = 1) {
    const { ctx } = this;
    this.stroke(alpha, widthScale, false);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    this.reset();
  }

  rectS(x, y, w, h, alpha = 1, widthScale = 1) {
    const { ctx } = this;
    this.stroke(alpha, widthScale, false);
    ctx.strokeRect(x, y, w, h);
    this.reset();
  }

  /** Horizontal fill bar: outline plus a solid portion. */
  barS(x, y, w, h, frac, alpha = 1) {
    const { ctx } = this;
    this.rectS(x, y, w, h, alpha * 0.55);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 1.5, y + 1.5, Math.max(0, (w - 3) * clamp(frac, 0, 1)), h - 3);
    this.reset();
  }

  /** Vertical fill bar, filling from the bottom up. */
  vbarS(x, y, w, h, frac, alpha = 1) {
    const { ctx } = this;
    this.rectS(x, y, w, h, alpha * 0.55);
    const fh = Math.max(0, (h - 3) * clamp(frac, 0, 1));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 1.5, y + h - 1.5 - fh, w - 3, fh);
    this.reset();
  }

  // --- scene ---------------------------------------------------------------

  drawStars(dt) {
    this.time += dt;
    const { ctx } = this;
    // Parallax: stars drift a fraction of the camera motion so altitude reads
    // as motion even against an empty sky.
    const px = (this.camera.x * 0.12) % this.w;
    const py = (this.camera.y * 0.08) % this.h;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    for (const s of this.stars) {
      let x = (s.x * this.w - px + this.w) % this.w;
      let y = (s.y * this.h + py + this.h) % this.h;
      let b = s.b;
      if (this.style.starTwinkle) b *= 0.75 + 0.25 * Math.sin(this.time * 1.7 + s.phase);
      ctx.globalAlpha = b * 0.8;
      const size = b > 0.7 ? 1.6 : 1;
      ctx.fillRect(x, y, size, size);
    }
    this.reset();
  }

  drawTerrain(terrain) {
    const { ctx } = this;
    const left = this.camera.x - this.halfViewW - terrain.step;
    const right = this.camera.x + this.halfViewW + terrain.step;
    const i0 = Math.max(0, Math.floor(left / terrain.step));
    const i1 = Math.min(terrain.h.length - 1, Math.ceil(right / terrain.step));

    // Hatching under the surface gives the ground weight at higher fidelity.
    const hatch = this.style.hatch;
    if (hatch) {
      this.stroke(0.16, 0.8, false);
      ctx.beginPath();
      for (let i = i0; i <= i1; i += hatch) {
        const top = this.worldToScreen(i * terrain.step, terrain.h[i]);
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x, this.h);
      }
      ctx.stroke();
      this.reset();
    }

    this.stroke(1, 1);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const p = this.worldToScreen(i * terrain.step, terrain.h[i]);
      if (i === i0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    this.reset();

    for (const pad of terrain.pads) this.drawPad(pad);
  }

  drawPad(pad) {
    const { ctx } = this;
    const a = this.worldToScreen(pad.x1, pad.y);
    const b = this.worldToScreen(pad.x2, pad.y);
    if (b.x < -40 || a.x > this.w + 40) return;

    this.stroke(1, 2.2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // End posts and a row of markers so the pad reads as built, not natural.
    this.stroke(0.8, 1.2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y - 12);
    ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y - 12);
    const ticks = 4;
    for (let i = 1; i < ticks; i++) {
      const x = a.x + ((b.x - a.x) * i) / ticks;
      ctx.moveTo(x, a.y); ctx.lineTo(x, a.y - 5);
    }
    ctx.stroke();
    this.reset();

    this.text(`x${pad.mult.toFixed(2)}`, (a.x + b.x) / 2, a.y - 18, {
      size: 11, align: 'center', alpha: 0.65,
    });
  }

  drawShip(ship, opts = {}) {
    const { ctx } = this;
    const alpha = opts.alpha ?? 1;

    this.stroke(alpha, 1.15);
    ctx.beginPath();
    const body = ship.bodyPoints().map((p) => this.worldToScreen(p.x, p.y));
    ctx.moveTo(body[0].x, body[0].y);
    for (let i = 1; i < body.length; i++) ctx.lineTo(body[i].x, body[i].y);
    ctx.closePath();
    ctx.stroke();

    // Legs and footpads.
    ctx.beginPath();
    for (const [a, b] of GEOMETRY.legs) {
      const wa = this.shipPoint(ship, a);
      const wb = this.shipPoint(ship, b);
      ctx.moveTo(wa.x, wa.y);
      ctx.lineTo(wb.x, wb.y);
    }
    for (const foot of GEOMETRY.feet) {
      const sl = this.shipPoint(ship, { x: foot.x - GEOMETRY.padWidth, y: foot.y });
      const sr = this.shipPoint(ship, { x: foot.x + GEOMETRY.padWidth, y: foot.y });
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sr.x, sr.y);
    }
    ctx.stroke();

    // Tier 2+: an ascent-stage hatch line and a nozzle bell.
    if (this.tier >= 2) {
      this.stroke(alpha * 0.7, 0.9);
      ctx.beginPath();
      const hl = this.shipPoint(ship, { x: -1.9, y: 0.6 });
      const hr = this.shipPoint(ship, { x: 1.9, y: 0.6 });
      ctx.moveTo(hl.x, hl.y); ctx.lineTo(hr.x, hr.y);
      const n1 = this.shipPoint(ship, { x: -0.9, y: -1.8 });
      const n2 = this.shipPoint(ship, { x: -1.3, y: -3.0 });
      const n3 = this.shipPoint(ship, { x: 1.3, y: -3.0 });
      const n4 = this.shipPoint(ship, { x: 0.9, y: -1.8 });
      ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y);
      ctx.lineTo(n3.x, n3.y); ctx.lineTo(n4.x, n4.y);
      ctx.stroke();
    }
    this.reset();

    if (ship.spool > 0.02) this.drawFlame(ship);
  }

  drawFlame(ship) {
    const { ctx } = this;
    const t = ship.spool;
    const flick = 0.82 + Math.random() * 0.36;
    const len = (2.5 + 9 * t) * flick;
    const halfW = 1.1 + 0.9 * t;

    const root = GEOMETRY.nozzle;
    const pts = [
      { x: root.x - halfW, y: root.y - 0.6 },
      { x: root.x + (Math.random() - 0.5) * 0.8, y: root.y - len },
      { x: root.x + halfW, y: root.y - 0.6 },
    ].map((p) => this.shipPoint(ship, p));

    this.stroke(0.9, 1);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.stroke();

    // A shorter inner cone at higher fidelity.
    if (this.tier >= 2) {
      const inner = [
        { x: root.x - halfW * 0.45, y: root.y - 0.4 },
        { x: root.x, y: root.y - len * 0.55 * flick },
        { x: root.x + halfW * 0.45, y: root.y - 0.4 },
      ].map((p) => this.shipPoint(ship, p));
      this.stroke(0.55, 0.8);
      ctx.beginPath();
      ctx.moveTo(inner[0].x, inner[0].y);
      ctx.lineTo(inner[1].x, inner[1].y);
      ctx.lineTo(inner[2].x, inner[2].y);
      ctx.stroke();
    }
    this.reset();
  }

  drawDebris(pieces) {
    const { ctx } = this;
    this.stroke(1, 1);
    ctx.beginPath();
    for (const p of pieces) {
      if (p.life <= 0) continue;
      ctx.globalAlpha = clamp(p.life, 0, 1);
      const c = Math.cos(p.angle) * p.len * 0.5;
      const s = Math.sin(p.angle) * p.len * 0.5;
      const a = this.worldToScreen(p.x - c, p.y - s);
      const b = this.worldToScreen(p.x + c, p.y + s);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    this.reset();
  }
}
