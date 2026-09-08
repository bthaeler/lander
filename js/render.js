// Line-art renderer with a camera that spans six orders of magnitude, from
// ~5 px/m on touchdown to whole-planet views.
//
// The camera rotates so local "up" is screen up in flight view; without that,
// flying to the far side of the planet puts "down" at the top of the screen.
// Rotation is applied inside worldToScreen rather than via canvas transforms,
// because screen Y is flipped and mixing the two is a reliable source of sign
// bugs.

import { COLORS } from './config.js';
import { mulberry32, clamp, wrapAngle } from './util.js';
import {
  conicPoints, stateAtTrueAnomaly, trueAnomalyAtRadius,
} from './orbit.js';

const TIER_STYLE = {
  1: { line: 1.3, glow: 0, stars: 260, twinkle: false },
  2: { line: 1.5, glow: 6, stars: 460, twinkle: true },
  3: { line: 1.6, glow: 10, stars: 700, twinkle: true },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.camera = { x: 0, y: 0, rot: 0 };
    this.scale = 1;          // pixels per metre
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
    this.buildStars();
  }

  get style() { return TIER_STYLE[this.tier] || TIER_STYLE[1]; }

  /** Half the screen diagonal, in metres. */
  get viewRadius() { return Math.hypot(this.w, this.h) / 2 / this.scale; }

  setTier(tier) {
    if (tier === this.tier && this.stars.length) return;
    this.tier = tier;
    this.buildStars();
  }

  /**
   * Stars sit on a disc in a "sky frame" that only rotates with the camera.
   * Infinitely distant objects should not translate as the ship moves, and
   * they should wheel overhead as the ship travels around the body.
   */
  buildStars() {
    const rand = mulberry32(0x5eed + this.tier);
    const n = this.style.stars;
    const radius = Math.hypot(this.w, this.h) * 0.75 || 900;
    this.stars = [];
    for (let i = 0; i < n; i++) {
      const r = radius * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      this.stars.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        b: 0.25 + rand() * 0.6,
        phase: rand() * Math.PI * 2,
      });
    }
  }

  worldToScreen(wx, wy) {
    const dx = wx - this.camera.x;
    const dy = wy - this.camera.y;
    const c = Math.cos(-this.camera.rot);
    const s = Math.sin(-this.camera.rot);
    return {
      x: this.w / 2 + (dx * c - dy * s) * this.scale,
      y: this.h / 2 - (dx * s + dy * c) * this.scale,
    };
  }

  shipPoint(ship, p) {
    const w = ship.toWorld(p);
    return this.worldToScreen(w.x, w.y);
  }

  onScreen(p, margin = 200) {
    return p.x > -margin && p.x < this.w + margin
      && p.y > -margin && p.y < this.h + margin;
  }

  // --- primitives ------------------------------------------------------------

  clear() {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
  }

  stroke(color = COLORS.ui, alpha = 1, widthScale = 1, glow = true) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = this.style.line * widthScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = glow ? this.style.glow : 0;
    ctx.shadowColor = color;
  }

  reset() {
    this.ctx.globalAlpha = 1;
    this.ctx.shadowBlur = 0;
    this.ctx.setLineDash([]);
  }

  text(str, x, y, opts = {}) {
    const { ctx } = this;
    const size = opts.size || 14;
    ctx.font = `${opts.weight || 400} ${size}px "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.shadowBlur = opts.glow ?? (this.style.glow ? this.style.glow * 0.5 : 0);
    ctx.shadowColor = opts.color || COLORS.ui;
    ctx.fillStyle = opts.color || COLORS.ui;
    ctx.fillText(str, x, y);
    this.reset();
  }

  measure(str, size = 14) {
    this.ctx.font = `400 ${size}px "SF Mono", Menlo, Consolas, monospace`;
    return this.ctx.measureText(str).width;
  }

  lineS(x1, y1, x2, y2, color = COLORS.ui, alpha = 1, widthScale = 1) {
    const { ctx } = this;
    this.stroke(color, alpha, widthScale, false);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    this.reset();
  }

  rectS(x, y, w, h, color = COLORS.ui, alpha = 1, widthScale = 1) {
    this.stroke(color, alpha, widthScale, false);
    this.ctx.strokeRect(x, y, w, h);
    this.reset();
  }

  fillRectS(x, y, w, h, color, alpha = 1) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    this.reset();
  }

  barS(x, y, w, h, frac, color = COLORS.ui, alpha = 1) {
    this.rectS(x, y, w, h, color, alpha * 0.55);
    this.fillRectS(x + 1.5, y + 1.5, Math.max(0, (w - 3) * clamp(frac, 0, 1)), h - 3, color, alpha);
  }

  vbarS(x, y, w, h, frac, color = COLORS.ui, alpha = 1) {
    this.rectS(x, y, w, h, color, alpha * 0.55);
    const fh = Math.max(0, (h - 3) * clamp(frac, 0, 1));
    this.fillRectS(x + 1.5, y + h - 1.5 - fh, w - 3, fh, color, alpha);
  }

  marker(p, size, color, alpha = 1) {
    const { ctx } = this;
    this.stroke(color, alpha, 1.2, true);
    ctx.beginPath();
    ctx.moveTo(p.x - size, p.y);
    ctx.lineTo(p.x, p.y - size);
    ctx.lineTo(p.x + size, p.y);
    ctx.lineTo(p.x, p.y + size);
    ctx.closePath();
    ctx.stroke();
    this.reset();
  }

  // --- scene -----------------------------------------------------------------

  drawStars(dt) {
    this.time += dt;
    const { ctx } = this;
    const c = Math.cos(-this.camera.rot);
    const s = Math.sin(-this.camera.rot);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.star;
    for (const st of this.stars) {
      const x = this.w / 2 + st.x * c - st.y * s;
      const y = this.h / 2 + st.x * s + st.y * c;
      if (x < 0 || x > this.w || y < 0 || y > this.h) continue;
      let b = st.b;
      if (this.style.twinkle) b *= 0.75 + 0.25 * Math.sin(this.time * 1.7 + st.phase);
      ctx.globalAlpha = b * 0.8;
      ctx.fillRect(x, y, b > 0.7 ? 1.6 : 1, b > 0.7 ? 1.6 : 1);
    }
    this.reset();
  }

  /**
   * Draw the body by sampling surfaceRadius(theta) across the arc that is
   * currently on screen. Zoomed in this reads as near-flat ground with real
   * curvature; zoomed out it is a disc. Same loop either way.
   */
  drawBody(body) {
    const { ctx } = this;
    const cam = this.camera;
    const rc = Math.hypot(cam.x, cam.y);
    const thetaC = rc > 1 ? Math.atan2(cam.y, cam.x) : 0;
    const R = body.surfaceRadius(thetaC);
    const D = this.viewRadius;

    let span;
    let full = false;
    if (rc <= R) {
      // Camera at or inside the surface (map view sits on the body centre):
      // the visible-arc solve degenerates, so just draw the whole circle.
      span = Math.PI;
      full = true;
    } else {
      const cosSpan = (rc * rc + R * R - D * D) / (2 * rc * R);
      if (cosSpan >= 1) return;                     // body entirely off screen
      span = cosSpan <= -1 ? Math.PI : Math.acos(cosSpan) * 1.06;
      full = span >= Math.PI;
      if (full) span = Math.PI;
    }

    // One sample per couple of screen pixels of arc.
    const arcPixels = 2 * span * R * this.scale;
    const n = Math.round(clamp(arcPixels / 2, 180, 1800));

    const pts = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const t = thetaC - span + (2 * span * i) / n;
      const r = body.surfaceRadius(t);
      pts[i] = this.worldToScreen(r * Math.cos(t), r * Math.sin(t));
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= n; i++) ctx.lineTo(pts[i].x, pts[i].y);

    if (full) {
      ctx.closePath();
    } else {
      // Close the wedge just far enough below the surface to cover the screen.
      const inner = Math.max(0, rc - D * 2);
      const t1 = thetaC + span, t0 = thetaC - span;
      const a = this.worldToScreen(inner * Math.cos(t1), inner * Math.sin(t1));
      const b = this.worldToScreen(inner * Math.cos(t0), inner * Math.sin(t0));
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = body.color + '14';
    ctx.fill();
    this.stroke(body.color, 1, 1.1, true);
    ctx.stroke();
    this.reset();

    if (body.atmosphere) this.drawAtmosphere(body, thetaC, span, full);

    // Decide labels before drawing: sites only a few kilometres apart are
    // within a pixel of each other from orbit, and their names would overprint.
    const placed = [];
    for (const pad of body.pads) {
      const mid = this.worldToScreen(pad.r * Math.cos(pad.theta), pad.r * Math.sin(pad.theta));
      const clear = placed.every((p) => Math.hypot(p.x - mid.x, p.y - mid.y) > 95);
      if (clear) placed.push(mid);
      this.drawPad(body, pad, placed.length - 1, clear);
    }
  }

  drawAtmosphere(body, thetaC, span, full) {
    const { ctx } = this;
    const layers = [0.18, 0.45, 1.0];
    const n = full ? 360 : 220;
    for (let li = 0; li < layers.length; li++) {
      const r = body.radius + body.atmosphere.height * layers[li];
      const alpha = 0.3 * (1 - li * 0.28);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const t = full
          ? (i / n) * Math.PI * 2
          : thetaC - span + (2 * span * i) / n;
        const p = this.worldToScreen(r * Math.cos(t), r * Math.sin(t));
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      this.stroke(body.color, alpha, 0.8, false);
      ctx.stroke();
    }
    this.reset();
  }

  drawPad(body, pad, index = 0, showLabel = true) {
    const { ctx } = this;
    const a = this.worldToScreen(pad.r * Math.cos(pad.theta - pad.halfAngle),
      pad.r * Math.sin(pad.theta - pad.halfAngle));
    const b = this.worldToScreen(pad.r * Math.cos(pad.theta + pad.halfAngle),
      pad.r * Math.sin(pad.theta + pad.halfAngle));
    const width = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = this.worldToScreen(pad.r * Math.cos(pad.theta), pad.r * Math.sin(pad.theta));
    if (!this.onScreen(mid, 120)) return;

    if (width < 7) {
      // Too small to draw: mark the site so it can be found from orbit.
      const up = { x: Math.cos(pad.theta), y: Math.sin(pad.theta) };
      const out = this.worldToScreen((pad.r + 14 / this.scale) * up.x,
        (pad.r + 14 / this.scale) * up.y);
      const dx = out.x - mid.x, dy = out.y - mid.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const tick = 16 + index * 14;
      this.lineS(mid.x + ux * 6, mid.y + uy * 6, mid.x + ux * tick, mid.y + uy * tick,
        COLORS.pad, 0.85, 1.2);
      if (showLabel) {
        this.text(pad.label, mid.x + ux * (tick + 9), mid.y + uy * (tick + 9) + 4,
          { size: 10, align: 'center', color: COLORS.pad, alpha: 0.7 });
      }
      return;
    }

    this.stroke(COLORS.pad, 1, 2.2, true);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    this.reset();

    // End posts, drawn along the local outward normal.
    const nx = (mid.x - (a.x + b.x) / 2), ny = (mid.y - (a.y + b.y) / 2);
    const up = { x: -(b.y - a.y), y: (b.x - a.x) };
    const ul = Math.hypot(up.x, up.y) || 1;
    const sgn = (up.x * nx + up.y * ny) >= 0 ? 1 : -1;
    const ox = (up.x / ul) * 12 * sgn, oy = (up.y / ul) * 12 * sgn;
    this.stroke(COLORS.pad, 0.8, 1.2, false);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + ox, a.y + oy);
    ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + ox, b.y + oy);
    ctx.stroke();
    this.reset();

    if (width > 40 && showLabel) {
      this.text(pad.label, mid.x + ox * 1.8, mid.y + oy * 1.8,
        { size: 10, align: 'center', color: COLORS.pad, alpha: 0.75 });
    }
  }

  /** Projected trajectory, with apoapsis and periapsis called out. */
  drawOrbit(el, body, opts = {}) {
    const { ctx } = this;
    if (!el || !isFinite(el.a)) return;

    const surface = body.radius;
    const pts = conicPoints(el, el.closed ? 512 : 320, surface);
    this.stroke(opts.color || COLORS.orbit, opts.alpha ?? 0.75, 1, true);
    ctx.setLineDash(opts.dash || []);
    ctx.beginPath();
    let drawing = false;
    for (const q of pts) {
      // Do not draw the stretch that passes underground. A steeply elliptical
      // impact trajectory dives close to the body's centre, and drawing that
      // is both wrong and unreadable.
      if (q.r < surface * 0.999) { drawing = false; continue; }
      const p = this.worldToScreen(q.x, q.y);
      if (!this.onScreen(p, this.w * 2)) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(p.x, p.y); drawing = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    this.reset();

    if (opts.markers === false) return;

    // Periapsis: the point that decides whether this is an orbit or an impact.
    // When it lies underground, mark where the path actually meets the surface
    // rather than a point buried inside the body -- for a radial trajectory
    // the true periapsis is the centre itself.
    const impact = el.periapsis <= surface;
    let per;
    if (!impact) {
      per = stateAtTrueAnomaly(el, 0);
    } else if (el.radial) {
      per = { x: surface * Math.cos(el.theta), y: surface * Math.sin(el.theta) };
    } else {
      const nu = trueAnomalyAtRadius(el, surface);
      per = nu === null ? null : stateAtTrueAnomaly(el, nu);
    }
    if (!per) return;
    const pp = this.worldToScreen(per.x, per.y);
    if (this.onScreen(pp, 60)) {
      const col = impact ? COLORS.danger : COLORS.periapsis;
      this.marker(pp, 5, col);
      this.text(impact ? 'IMPACT' : 'PE', pp.x + 9, pp.y + 4,
        { size: 10, color: col, alpha: 0.9 });
    }
    if (el.closed) {
      const apo = stateAtTrueAnomaly(el, Math.PI);
      const ap = this.worldToScreen(apo.x, apo.y);
      if (this.onScreen(ap, 60)) {
        this.marker(ap, 5, COLORS.apoapsis);
        this.text('AP', ap.x + 9, ap.y + 4,
          { size: 10, color: COLORS.apoapsis, alpha: 0.9 });
      }
    }
  }

  drawShip(ship, opts = {}) {
    const { ctx } = this;
    const alpha = opts.alpha ?? 1;
    const pixelLength = ship.length * this.scale;

    if (pixelLength < 7) {
      // Below a few pixels, draw a readable icon instead of a sliver.
      const c = this.worldToScreen(ship.x, ship.y);
      if (!this.onScreen(c, 40)) return;
      const dir = ship.angle - this.camera.rot;
      const dx = Math.cos(dir), dy = -Math.sin(dir);
      const px = -dy, py = dx;
      this.stroke(COLORS.ship, alpha, 1.2, true);
      ctx.beginPath();
      ctx.moveTo(c.x + dx * 7, c.y + dy * 7);
      ctx.lineTo(c.x - dx * 4 + px * 4, c.y - dy * 4 + py * 4);
      ctx.lineTo(c.x - dx * 4 - px * 4, c.y - dy * 4 - py * 4);
      ctx.closePath();
      ctx.stroke();
      this.reset();
      if (ship.spool > 0.02) {
        this.lineS(c.x - dx * 5, c.y - dy * 5,
          c.x - dx * (5 + 10 * ship.spool), c.y - dy * (5 + 10 * ship.spool),
          COLORS.flame, 0.9, 1.4);
      }
      return;
    }

    if (ship.spool > 0.02) this.drawFlame(ship);

    this.stroke(COLORS.ship, alpha, 1.1, true);

    // Capsule: a cone on top of the stack.
    const cap = ship.capsule;
    ctx.beginPath();
    const nose = this.shipPoint(ship, { x: 0, y: cap.top });
    const cl = this.shipPoint(ship, { x: -cap.radius, y: cap.bottom });
    const cr = this.shipPoint(ship, { x: cap.radius, y: cap.bottom });
    ctx.moveTo(cl.x, cl.y);
    ctx.lineTo(nose.x, nose.y);
    ctx.lineTo(cr.x, cr.y);
    ctx.stroke();

    // Stage bands.
    for (let i = 0; i < ship.bands.length; i++) {
      const band = ship.bands[i];
      const p1 = this.shipPoint(ship, { x: -band.radius, y: band.top });
      const p2 = this.shipPoint(ship, { x: band.radius, y: band.top });
      const p3 = this.shipPoint(ship, { x: band.radius, y: band.bottom });
      const p4 = this.shipPoint(ship, { x: -band.radius, y: band.bottom });
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      // The burning stage is drawn solid, the ones above it dimmer.
      this.stroke(COLORS.ship, alpha * (i === 0 ? 1 : 0.55), 1.1, true);
      ctx.stroke();
    }

    // Legs and footpads.
    this.stroke(COLORS.ship, alpha, 1, true);
    ctx.beginPath();
    for (const sgn of [-1, 1]) {
      const root = this.shipPoint(ship, { x: sgn * ship.maxRadius * 0.8, y: ship.legRoot });
      const foot = this.shipPoint(ship, { x: sgn * ship.footSpan, y: ship.bottom });
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(foot.x, foot.y);
      const padA = this.shipPoint(ship, { x: sgn * ship.footSpan - 0.6, y: ship.bottom });
      const padB = this.shipPoint(ship, { x: sgn * ship.footSpan + 0.6, y: ship.bottom });
      ctx.moveTo(padA.x, padA.y);
      ctx.lineTo(padB.x, padB.y);
    }
    ctx.stroke();
    this.reset();
  }

  drawFlame(ship) {
    const { ctx } = this;
    const t = ship.spool;
    const flick = 0.82 + Math.random() * 0.36;
    const len = ship.length * 0.5 * t * flick;
    const halfW = ship.maxRadius * (0.5 + 0.4 * t);
    const root = ship.nozzle;

    const outer = [
      { x: -halfW, y: root },
      { x: (Math.random() - 0.5) * halfW * 0.5, y: root - len },
      { x: halfW, y: root },
    ].map((p) => this.shipPoint(ship, p));

    this.stroke(COLORS.flame, 0.9, 1.2, true);
    ctx.beginPath();
    ctx.moveTo(outer[0].x, outer[0].y);
    ctx.lineTo(outer[1].x, outer[1].y);
    ctx.lineTo(outer[2].x, outer[2].y);
    ctx.stroke();

    const inner = [
      { x: -halfW * 0.42, y: root },
      { x: 0, y: root - len * 0.55 * flick },
      { x: halfW * 0.42, y: root },
    ].map((p) => this.shipPoint(ship, p));
    this.stroke(COLORS.flameCore, 0.75, 0.9, true);
    ctx.beginPath();
    ctx.moveTo(inner[0].x, inner[0].y);
    ctx.lineTo(inner[1].x, inner[1].y);
    ctx.lineTo(inner[2].x, inner[2].y);
    ctx.stroke();
    this.reset();
  }

  drawDebris(pieces) {
    const { ctx } = this;
    this.stroke(COLORS.ship, 1, 1, true);
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

  /** Discarded stages, drawn as tumbling rectangles. */
  drawJetsam(pieces) {
    const { ctx } = this;
    this.stroke(COLORS.ui, 0.5, 1, false);
    for (const p of pieces) {
      if (p.life <= 0) continue;
      const half = p.len / 2;
      const corners = [
        { x: -p.rad, y: -half }, { x: p.rad, y: -half },
        { x: p.rad, y: half }, { x: -p.rad, y: half },
      ].map((c) => {
        const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
        return this.worldToScreen(p.x + c.x * cos - c.y * sin, p.y + c.x * sin + c.y * cos);
      });
      ctx.globalAlpha = clamp(p.life, 0, 1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    this.reset();
  }
}
