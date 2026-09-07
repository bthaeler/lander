import {
  FIXED_DT, LEVELS, PLANETS, ZOOM, OFF_PAD_MULTIPLIER, OFF_PAD_TOLERANCE_SCALE,
  MAX_OFF_PAD_SLOPE_DEG,
} from './config.js';
import { createLoadout, shipStats } from './loadout.js';
import { generateTerrain } from './terrain.js';
import { Ship } from './ship.js';
import { drawHUD, telemetry, HUD_LAYOUTS } from './hud.js';
import { Hangar } from './shop.js';
import { clamp, wrapAngle, DEG } from './util.js';

const STATE = {
  BRIEFING: 'briefing',
  FLYING: 'flying',
  RESULT: 'result',
  HANGAR: 'hangar',
  COMPLETE: 'complete',
};

// A ship still rotating fast at touchdown will tip over regardless of how
// upright it happened to be at the instant of contact.
const MAX_TOUCHDOWN_SPIN = 0.55; // rad/s
const BOUNDARY_MARGIN = 40;      // metres of world edge that count as off-course
const CEILING_ABOVE_START = 450; // metres

export class Game {
  constructor(renderer, input) {
    this.r = renderer;
    this.input = input;
    this.hangar = new Hangar();
    this.hudLayout = 0;
    this.hudLabelTime = 0;
    this.accumulator = 0;
    this.time = 0;
    this.newTier = 0;
    this.restart();
  }

  restart() {
    this.session = {
      credits: 0,
      loadout: createLoadout(),
      levelIndex: 0,
      totalCredits: 0,
      landings: 0,
      crashes: 0,
    };
    // Tier 1 is the baseline look, so it is never announced as an unlock.
    this.lastTier = 1;
    this.loadLevel(0);
    this.state = STATE.BRIEFING;
  }

  get level() { return LEVELS[this.session.levelIndex]; }
  get planet() { return PLANETS[this.level.planet]; }

  /** Touchdown envelope for the current level including landing-gear bonuses. */
  get tolerance() {
    const stats = shipStats(this.session.loadout);
    return {
      speed: this.level.tolerance.speed + stats.speedBonus,
      angle: this.level.tolerance.angle + stats.angleBonus,
    };
  }

  loadLevel(index) {
    this.session.levelIndex = index;
    const level = LEVELS[index];
    this.terrain = generateTerrain(level, (Date.now() ^ (index * 7919)) >>> 0);

    const stats = shipStats(this.session.loadout);
    const pad = this.terrain.pads[0];
    const spawnX = clamp(
      pad.cx + (Math.random() - 0.5) * 2 * level.startOffset,
      120, this.terrain.width - 120
    );
    const spawnY = this.terrain.heightAt(spawnX) + level.startAltitude;

    this.ship = new Ship(stats, {
      x: spawnX,
      y: spawnY,
      vx: (Math.random() < 0.5 ? -1 : 1) * level.startDrift * (0.6 + Math.random() * 0.4),
      vy: -level.startDrift * 0.35,
      angle: 0,
    });

    this.spawnY = spawnY;
    this.r.scale = ZOOM.far;   // start wide; updateCamera zooms in on descent
    this.debris = [];
    this.result = null;
    this.accumulator = 0;

    this.newTier = level.graphicsTier > this.lastTier ? level.graphicsTier : 0;
    this.lastTier = Math.max(this.lastTier, level.graphicsTier);
    this.r.setTier(level.graphicsTier);
  }

  // --- main loop hooks -------------------------------------------------------

  update(dt) {
    this.time += dt;
    if (this.hudLabelTime > 0) this.hudLabelTime -= dt;
    this.hangar.update(dt);

    if (this.input.wasPressed('hud')) {
      this.hudLayout = (this.hudLayout + 1) % HUD_LAYOUTS.length;
      this.hudLabelTime = 1.6;
    }

    switch (this.state) {
      case STATE.BRIEFING: this.updateBriefing(); break;
      case STATE.FLYING: this.updateFlying(dt); break;
      case STATE.RESULT: this.updateResult(dt); break;
      case STATE.HANGAR: this.updateHangar(); break;
      case STATE.COMPLETE:
        if (this.input.wasPressed('restart') || this.input.wasPressed('confirm')) this.restart();
        break;
    }
    this.updateCamera(dt);
  }

  updateBriefing() {
    if (this.input.wasPressed('thrust') || this.input.wasPressed('confirm')) {
      this.state = STATE.FLYING;
    }
  }

  updateFlying(dt) {
    if (this.input.wasPressed('restart')) { this.loadLevel(this.session.levelIndex); return; }

    const cmd = {
      rotate: (this.input.isDown('right') ? 1 : 0) - (this.input.isDown('left') ? 1 : 0),
      throttle: this.input.isDown('thrust') ? 1 : 0,
    };

    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= FIXED_DT) {
      this.ship.step(FIXED_DT, this.planet.gravity, cmd);
      this.accumulator -= FIXED_DT;
      if (this.checkContact()) break;
      if (this.checkBounds()) break;
    }
  }

  updateResult(dt) {
    this.stepDebris(dt);
    if (!(this.input.wasPressed('thrust') || this.input.wasPressed('confirm'))) return;

    if (!this.result.success) {
      this.loadLevel(this.session.levelIndex);
      this.state = STATE.BRIEFING;
      return;
    }
    const next = this.session.levelIndex + 1;
    if (next >= LEVELS.length) {
      this.state = STATE.COMPLETE;
      return;
    }
    this.session.upcomingLevel = LEVELS[next];
    this.session.levelIndex = next;
    this.hangar.reset();
    this.state = STATE.HANGAR;
  }

  updateHangar() {
    this.session.upcomingLevel = LEVELS[this.session.levelIndex];
    if (this.hangar.handle(this.input, this.session) === 'launch') {
      this.loadLevel(this.session.levelIndex);
      this.state = STATE.BRIEFING;
    }
  }

  updateCamera(dt) {
    const ship = this.ship;
    if (!ship) return;

    // Zoom in on the way down. Interpolating on sqrt(altitude) keeps the
    // change gradual high up and quicker over the last hundred metres.
    const alt = Math.max(0, ship.clearance(this.terrain));
    const span = Math.sqrt(ZOOM.farAlt) - Math.sqrt(ZOOM.nearAlt);
    const t = clamp((Math.sqrt(clamp(alt, ZOOM.nearAlt, ZOOM.farAlt)) - Math.sqrt(ZOOM.nearAlt)) / span, 0, 1);
    const target = ZOOM.near + (ZOOM.far - ZOOM.near) * t;
    this.r.scale += (target - this.r.scale) * Math.min(1, dt * ZOOM.rate);

    const groundY = this.terrain.heightAt(ship.x);
    // Keep the ship centred while high, then let the ground settle into the
    // lower third of the screen as it comes down.
    const minCamY = groundY + this.r.halfViewH * 0.5;
    this.r.camera.x = ship.x;
    this.r.camera.y = Math.max(ship.y, minCamY);
  }

  // --- contact and failure ---------------------------------------------------

  /** @returns {boolean} true if the flight ended this step. */
  checkContact() {
    const ship = this.ship;

    // Any part of the hull touching the ground is an immediate loss.
    for (const p of ship.bodyPoints()) {
      if (p.y <= this.terrain.heightAt(p.x)) {
        this.fail('HULL IMPACT');
        return true;
      }
    }

    const feet = ship.footPoints();
    const contact = feet.filter((p) => p.y <= this.terrain.heightAt(p.x));
    if (contact.length === 0) return false;

    this.evaluateTouchdown(feet);
    return true;
  }

  evaluateTouchdown(feet) {
    const ship = this.ship;
    const speed = ship.speed;
    const angleDeg = wrapAngle(ship.angle) * DEG;
    const absAngle = Math.abs(angleDeg);
    const midX = (feet[0].x + feet[1].x) / 2;

    const padA = this.terrain.padAt(feet[0].x);
    const padB = this.terrain.padAt(feet[1].x);
    const onPad = padA && padB && padA === padB;
    const pad = onPad ? padA : null;

    const tol = this.tolerance;
    const scale = onPad ? 1 : OFF_PAD_TOLERANCE_SCALE;
    const limitSpeed = tol.speed * scale;
    const limitAngle = tol.angle * scale;
    const slope = Math.abs(this.terrain.slopeDegAt(midX));

    let reason = null;
    if (speed > limitSpeed) reason = 'IMPACT SPEED TOO HIGH';
    else if (absAngle > limitAngle) reason = 'TOUCHED DOWN TOO STEEP';
    else if (Math.abs(ship.omega) > MAX_TOUCHDOWN_SPIN) reason = 'STILL ROTATING -- TIPPED OVER';
    else if (!onPad && slope > MAX_OFF_PAD_SLOPE_DEG) reason = 'GROUND TOO STEEP';

    if (reason) {
      this.fail(reason, { speed, angleDeg, onPad, limitSpeed, limitAngle, slope });
      return;
    }

    // Settle the ship exactly onto the surface and stop it dead.
    const drop = Math.min(
      ...feet.map((p) => p.y - this.terrain.heightAt(p.x))
    );
    ship.y -= drop;
    ship.vx = 0; ship.vy = 0; ship.omega = 0; ship.spool = 0;

    const quality = clamp(
      1 - 0.5 * (speed / limitSpeed) - 0.5 * (absAngle / limitAngle), 0, 1
    );
    const mult = onPad ? pad.mult : OFF_PAD_MULTIPLIER;
    // Bonus is on the *fraction* of propellant saved, not the mass -- otherwise
    // hauling an oversized tank you never burn would pay for itself.
    const fuelFraction = ship.fuel / ship.stats.fuelCapacity;
    const fuelBonus = Math.round(this.level.reward * 0.3 * fuelFraction);
    const credits = Math.round(this.level.reward * (0.45 + 0.55 * quality) * mult) + fuelBonus;

    this.session.credits += credits;
    this.session.totalCredits += credits;
    this.session.landings += 1;

    this.result = {
      success: true,
      speed, angleDeg, onPad, mult, quality, credits, fuelBonus,
      limitSpeed, limitAngle, slope,
      fuel: ship.fuel,
      rating: ratingFor(quality),
      time: ship.elapsed,
    };
    this.state = STATE.RESULT;
  }

  fail(reason, detail = {}) {
    this.session.crashes += 1;
    this.spawnDebris();
    this.result = {
      success: false,
      reason,
      speed: detail.speed ?? this.ship.speed,
      angleDeg: detail.angleDeg ?? wrapAngle(this.ship.angle) * DEG,
      onPad: detail.onPad ?? false,
      limitSpeed: detail.limitSpeed ?? this.tolerance.speed,
      limitAngle: detail.limitAngle ?? this.tolerance.angle,
      fuel: this.ship.fuel,
      time: this.ship.elapsed,
    };
    this.state = STATE.RESULT;
  }

  checkBounds() {
    const ship = this.ship;
    if (ship.x < BOUNDARY_MARGIN || ship.x > this.terrain.width - BOUNDARY_MARGIN) {
      this.fail('DRIFTED OUT OF THE LANDING ZONE');
      return true;
    }
    if (ship.y > this.spawnY + CEILING_ABOVE_START) {
      this.fail('CLIMBED OUT OF THE APPROACH CORRIDOR');
      return true;
    }
    return false;
  }

  get outOfBounds() {
    const ship = this.ship;
    const near = BOUNDARY_MARGIN * 3;
    return ship.x < near || ship.x > this.terrain.width - near ||
      ship.y > this.spawnY + CEILING_ABOVE_START * 0.8;
  }

  spawnDebris() {
    const ship = this.ship;
    const pieces = [];
    const points = [...ship.bodyPoints(), ...ship.footPoints()];
    for (let i = 0; i < 14; i++) {
      const p = points[i % points.length];
      const dir = Math.random() * Math.PI * 2;
      const spread = 6 + Math.random() * 14;
      pieces.push({
        x: p.x, y: p.y,
        vx: ship.vx * 0.3 + Math.cos(dir) * spread,
        vy: Math.abs(ship.vy) * 0.15 + Math.sin(dir) * spread * 0.8 + 6,
        angle: Math.random() * Math.PI,
        omega: (Math.random() - 0.5) * 8,
        len: 1.4 + Math.random() * 3.4,
        life: 1,
      });
    }
    this.debris = pieces;
  }

  stepDebris(dt) {
    const g = this.planet.gravity;
    for (const p of this.debris) {
      if (p.life <= 0) continue;
      p.vy -= g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.omega * dt;
      const ground = this.terrain.heightAt(p.x);
      if (p.y < ground) {
        p.y = ground;
        p.vy *= -0.25;
        p.vx *= 0.6;
        p.omega *= 0.5;
      }
      p.life -= dt * 0.45;
    }
  }

  // --- drawing ---------------------------------------------------------------

  draw(dt) {
    const r = this.r;
    r.clear();
    r.drawStars(dt);
    r.drawTerrain(this.terrain);
    this.drawBoundaries();

    if (this.state === STATE.HANGAR) {
      this.dim(0.82);
      this.hangar.draw(r, this.session);
      this.drawHudLabel();
      return;
    }

    if (this.debris.length && this.state === STATE.RESULT && !this.result.success) {
      r.drawDebris(this.debris);
    } else if (this.ship) {
      r.drawShip(this.ship);
    }

    if (this.state === STATE.FLYING || this.state === STATE.BRIEFING) {
      const t = telemetry(
        this.ship, this.terrain, this.level, this.tolerance, this.time, this.outOfBounds
      );
      drawHUD(r, t, this.hudLayout);
      this.drawLevelTag();
    }

    if (this.state === STATE.BRIEFING) this.drawBriefing();
    if (this.state === STATE.RESULT) this.drawResult();
    if (this.state === STATE.COMPLETE) this.drawComplete();
    this.drawHudLabel();
  }

  drawBoundaries() {
    const r = this.r;
    for (const x of [0, this.terrain.width]) {
      const top = r.worldToScreen(x, r.camera.y + r.halfViewH);
      const bottom = r.worldToScreen(x, r.camera.y - r.halfViewH);
      if (top.x < -20 || top.x > r.w + 20) continue;
      for (let y = top.y; y < bottom.y; y += 22) {
        r.lineS(top.x, y, top.x, y + 11, 0.25);
      }
    }
  }

  dim(alpha) {
    const ctx = this.r.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.r.w, this.r.h);
    this.r.reset();
  }

  drawHudLabel() {
    if (this.hudLabelTime <= 0) return;
    this.r.text(`HUD: ${HUD_LAYOUTS[this.hudLayout]}`, this.r.w / 2, this.r.h / 2 + 140, {
      size: 13, align: 'center', alpha: clamp(this.hudLabelTime, 0, 1) * 0.8,
    });
  }

  drawLevelTag() {
    const r = this.r;
    r.text(
      `LEVEL ${this.session.levelIndex + 1}/${LEVELS.length}  ${this.level.name}  /  ${this.planet.name}`,
      r.w / 2, r.h - 14, { size: 11, align: 'center', alpha: 0.4 }
    );
  }

  drawBriefing() {
    const r = this.r;
    this.dim(0.55);
    const cx = r.w / 2;
    let y = r.h / 2 - 130;

    r.text(`LEVEL ${this.session.levelIndex + 1}`, cx, y, { size: 13, align: 'center', alpha: 0.6 });
    y += 34;
    r.text(this.level.name, cx, y, { size: 30, align: 'center' });
    y += 24;
    r.text(`${this.planet.name}   g = ${this.planet.gravity.toFixed(2)} M/S²`,
      cx, y, { size: 14, align: 'center', alpha: 0.7 });
    y += 34;
    r.text(this.level.brief, cx, y, { size: 13, align: 'center', alpha: 0.6 });
    y += 34;

    const tol = this.tolerance;
    r.text(
      `TOUCHDOWN ENVELOPE   ${tol.speed.toFixed(1)} M/S   ${Math.round(tol.angle)}° FROM VERTICAL`,
      cx, y, { size: 14, align: 'center' }
    );
    y += 22;
    r.text(`PADS PAY MORE. OFF-PAD LANDINGS ARE SCORED AT ${Math.round(OFF_PAD_MULTIPLIER * 100)}%.`,
      cx, y, { size: 11, align: 'center', alpha: 0.45 });

    if (this.newTier) {
      y += 30;
      r.text(`>> VISUAL FIDELITY TIER ${this.newTier} ONLINE <<`,
        cx, y, { size: 13, align: 'center', alpha: 0.85 });
    }

    y += 46;
    r.text('LEFT / RIGHT  ROTATE     UP or SPACE  THRUST     H  HUD LAYOUT     R  RESET',
      cx, y, { size: 12, align: 'center', alpha: 0.5 });
    y += 30;
    r.text('PRESS SPACE TO BEGIN DESCENT', cx, y, {
      size: 15, align: 'center', alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
  }

  drawResult() {
    const r = this.r;
    const res = this.result;
    this.dim(0.65);
    const cx = r.w / 2;
    let y = r.h / 2 - 120;

    r.text(res.success ? 'TOUCHDOWN' : 'VEHICLE LOST', cx, y, { size: 32, align: 'center' });
    y += 26;
    if (res.success) {
      r.text(res.rating, cx, y, { size: 15, align: 'center', alpha: 0.8 });
    } else {
      r.text(res.reason, cx, y, { size: 14, align: 'center', alpha: 0.8 });
    }
    y += 40;

    const rows = [
      ['IMPACT SPEED', `${res.speed.toFixed(2)} M/S`, `LIMIT ${res.limitSpeed.toFixed(1)}`],
      ['ANGLE FROM VERTICAL', `${Math.abs(res.angleDeg).toFixed(1)}°`, `LIMIT ${Math.round(res.limitAngle)}°`],
      ['PROPELLANT LEFT', `${res.fuel.toFixed(0)} KG`,
        `${Math.round((res.fuel / this.ship.stats.fuelCapacity) * 100)}%`],
      ['FLIGHT TIME', `${res.time.toFixed(1)} S`, ''],
    ];
    if (res.success) {
      rows.push(['LANDING SITE', res.onPad ? `PAD  x${res.mult.toFixed(2)}` : 'OPEN GROUND  x0.60', '']);
      rows.push(['FUEL BONUS', `${res.fuelBonus} CR`, '']);
      rows.push(['CREDITS EARNED', `${res.credits} CR`, '']);
    }

    const w = Math.min(520, r.w - 80);
    const x0 = cx - w / 2;
    for (const [label, value, note] of rows) {
      r.text(label, x0, y, { size: 13, alpha: 0.55 });
      r.text(value, x0 + w * 0.72, y, { size: 14, align: 'right' });
      if (note) r.text(note, x0 + w, y, { size: 11, align: 'right', alpha: 0.4 });
      y += 24;
    }

    y += 18;
    r.text(`CREDITS  ${this.session.credits}`, cx, y, { size: 15, align: 'center', alpha: 0.8 });
    y += 34;
    r.text(res.success ? 'PRESS SPACE FOR THE HANGAR' : 'PRESS SPACE TO TRY AGAIN', cx, y, {
      size: 14, align: 'center', alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
  }

  drawComplete() {
    const r = this.r;
    this.dim(0.8);
    const cx = r.w / 2;
    let y = r.h / 2 - 90;
    r.text('CAMPAIGN COMPLETE', cx, y, { size: 32, align: 'center' });
    y += 44;
    r.text(`${this.session.landings} LANDINGS   ${this.session.crashes} VEHICLES LOST`,
      cx, y, { size: 15, align: 'center', alpha: 0.75 });
    y += 26;
    r.text(`${this.session.totalCredits} CREDITS EARNED`, cx, y,
      { size: 15, align: 'center', alpha: 0.75 });
    y += 50;
    r.text('PRESS R TO FLY THE CAMPAIGN AGAIN', cx, y, {
      size: 14, align: 'center', alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
  }
}

function ratingFor(q) {
  if (q > 0.88) return 'TEXTBOOK';
  if (q > 0.7) return 'CLEAN';
  if (q > 0.45) return 'SOLID';
  return 'ROUGH BUT INTACT';
}
