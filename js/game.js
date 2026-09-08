import {
  FIXED_DT, LEVELS, BODIES, COLORS, WARP_LEVELS, WARP_MAX_POWERED,
  WARP_MAX_ATMOSPHERE, WARP_MAX_LOW, LOW_ALTITUDE_FRACTION,
  RCS_TIERS, LEG_TIERS, COMPUTER_TIERS, HOLD_LABELS, SAMPLE_MASS, STARTING_CREDITS,
  MAX_TOUCHDOWN_SPIN, OFF_PAD_MULTIPLIER, OFF_PAD_TOLERANCE_SCALE,
  MAX_OFF_PAD_SLOPE_DEG,
} from './config.js';
import { Body } from './body.js';
import { Ship } from './ship.js';
import { Mission } from './mission.js';
import { Hangar } from './hangar.js';
import { createDesign, designStats } from './design.js';
import { elementsFromState, propagate, timeToPeriapsis } from './orbit.js';
import { drawHUD, telemetry, HUD_LAYOUTS } from './hud.js';
import { clamp, wrapAngle, DEG, fmtTime, fmtMass } from './util.js';

const STATE = { HANGAR: 'hangar', FLYING: 'flying', RESULT: 'result', COMPLETE: 'complete' };

// Escaping this far means the mission is unrecoverable.
const ESCAPE_RADIUS_FACTOR = 60;
// Refund on a lost vehicle, as "recovered hardware". The economy exists to
// constrain what you can design, not to punish crashes -- a losing streak
// must never leave the campaign unwinnable.
const LOSS_REFUND = 0.9;
// Seconds to sweep the throttle lever end to end.
const THROTTLE_RATE = 1 / 1.3;

export class Game {
  constructor(renderer, input) {
    this.r = renderer;
    this.input = input;
    this.hangar = new Hangar();
    this.hudLayout = 0;
    this.hudLabelTime = 0;
    this.titleTime = 0;
    this.time = 0;
    this.mapView = false;
    this.warpIndex = 0;
    this.throttle = 0;
    this.holdOn = false;
    this.holdIndex = 0;
    this.message = '';
    this.messageTime = 0;
    this.restart();
  }

  restart() {
    this.session = {
      credits: STARTING_CREDITS,
      levelIndex: 0,
      design: createDesign(),
      totalEarned: 0,
      landings: 0,
      losses: 0,
    };
    this.loadLevel(0);
    this.state = STATE.HANGAR;
  }

  get level() { return LEVELS[this.session.levelIndex]; }

  /** Hold modes the installed flight computer supports. */
  get holdModes() {
    return COMPUTER_TIERS[this.session.design.computer || 0].modes;
  }

  get holdMode() {
    const modes = this.holdModes;
    return this.holdOn && modes.length ? modes[this.holdIndex % modes.length] : null;
  }

  /** Touchdown envelope including landing-gear bonuses. */
  get envelope() {
    const legs = LEG_TIERS[this.session.design.legs];
    return {
      speed: this.level.envelope.speed + legs.speedBonus,
      angle: this.level.envelope.angle + legs.angleBonus,
    };
  }

  loadLevel(index) {
    this.session.levelIndex = index;
    const level = LEVELS[index];
    this.body = new Body(BODIES[level.body]);
    this.mission = new Mission(level, this.body);
    this.ship = null;
    this.debris = [];
    this.jetsam = [];
    this.result = null;
    this.missionTime = 0;
    this.lifeRemaining = 0;
    this.warpIndex = 0;
    this.mapView = false;
    this.r.setTier(level.graphicsTier);
    this.hangar.reset();
  }

  // --- launching -------------------------------------------------------------

  launch() {
    const level = this.level;
    const stats = designStats(this.session.design, this.body);
    if (stats.cost > this.session.credits) {
      this.hangar.flash('CANNOT AFFORD THIS VEHICLE');
      return;
    }
    this.session.credits -= stats.cost;
    this.buildCost = stats.cost;

    const spawn = this.spawnState(level, stats);
    this.ship = new Ship(this.session.design, stats.payload.mass, spawn);
    this.ship.rcsTorque = RCS_TIERS[this.session.design.rcs].torque;
    if (level.start.type === 'surface') this.ship.settle(this.body);

    this.throttle = 0;
    this.holdOn = false;
    this.holdIndex = 0;
    this.lifeRemaining = stats.lifeSeconds;
    this.lifeTotal = stats.lifeSeconds;
    this.startFuel = this.ship.totalFuel;
    this.missionTime = 0;
    this.warpIndex = 0;
    this.mapView = false;
    this.debris = [];
    this.jetsam = [];
    this.titleTime = 3.6;
    this.r.scale = 1;
    this.updateCamera(1);
    this.state = STATE.FLYING;
  }

  spawnState(level, stats) {
    const body = this.body;
    const s = level.start;
    const pad = s.pad ? body.padByName(s.pad) : body.pads[0];

    if (s.type === 'orbit') {
      const theta = pad.theta - (s.leadAngle || 0);
      const r = body.radius + s.altitude;
      const v = body.circularSpeed(r);
      return {
        x: r * Math.cos(theta), y: r * Math.sin(theta),
        // Prograde is counter-clockwise: velocity is +90 degrees from radial.
        vx: -v * Math.sin(theta), vy: v * Math.cos(theta),
        angle: theta + Math.PI / 2,
      };
    }

    if (s.type === 'surface') {
      const theta = pad.theta;
      const r = pad.r + stats.length / 2 + 2;
      return {
        x: r * Math.cos(theta), y: r * Math.sin(theta),
        vx: 0, vy: 0,
        angle: theta,
      };
    }

    // 'drop'
    const offset = (s.offset || 0) * (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4);
    const theta = pad.theta + offset / body.radius;
    const r = body.surfaceRadius(theta) + s.altitude;
    const drift = (s.drift || 0) * (Math.random() < 0.5 ? -1 : 1);
    return {
      x: r * Math.cos(theta), y: r * Math.sin(theta),
      vx: -drift * Math.sin(theta), vy: drift * Math.cos(theta),
      angle: theta,
    };
  }

  // --- main loop -------------------------------------------------------------

  update(dt) {
    this.time += dt;
    if (this.hudLabelTime > 0) this.hudLabelTime -= dt;
    if (this.titleTime > 0) this.titleTime -= dt;
    if (this.messageTime > 0) this.messageTime -= dt;
    this.hangar.update(dt);

    if (this.input.wasPressed('hud')) {
      this.hudLayout = (this.hudLayout + 1) % HUD_LAYOUTS.length;
      this.hudLabelTime = 1.6;
    }

    switch (this.state) {
      case STATE.HANGAR: this.updateHangar(); break;
      case STATE.FLYING: this.updateFlying(dt); break;
      case STATE.RESULT: this.updateResult(dt); break;
      case STATE.COMPLETE:
        if (this.input.wasPressed('restart') || this.input.wasPressed('confirm')) this.restart();
        break;
    }
    this.updateCamera(dt);
  }

  updateHangar() {
    const action = this.hangar.handle(this.input, this.session, this.body, this.level);
    if (action === 'launch') this.launch();
  }

  flash(msg, seconds = 3) {
    this.message = msg;
    this.messageTime = seconds;
  }

  // --- flight ----------------------------------------------------------------

  updateFlying(dt) {
    const ship = this.ship;
    const body = this.body;

    if (this.input.wasPressed('restart')) { this.abort(); return; }
    if (this.input.wasPressed('map')) this.mapView = !this.mapView;
    if (this.input.wasPressed('stage') && ship.jettison()) {
      this.spawnJetsam();
      this.flash('STAGE SEPARATION', 1.6);
    }

    // Throttle is a persistent lever, not a button: an orbital burn can run
    // for minutes and needs a held setting. SPACE is a momentary full-thrust
    // override so a landing can still be flown by tapping one key.
    const trim = THROTTLE_RATE * dt;
    if (this.input.isDown('throttleUp')) this.throttle = clamp(this.throttle + trim, 0, 1);
    if (this.input.isDown('throttleDown')) this.throttle = clamp(this.throttle - trim, 0, 1);
    if (this.input.wasPressed('cutoff')) this.throttle = 0;

    // Flight computer. Each tier is mass and money bought back as work the
    // pilot no longer has to do by hand.
    const modes = this.holdModes;
    if (this.input.wasPressed('hold')) {
      if (!modes.length) this.flash('NO FLIGHT COMPUTER INSTALLED', 2);
      else {
        this.holdOn = !this.holdOn;
        this.flash(this.holdOn ? `HOLD: ${HOLD_LABELS[this.holdMode]}` : 'HOLD OFF', 1.8);
      }
    }
    if (this.input.wasPressed('holdMode') && modes.length) {
      this.holdIndex = (this.holdIndex + 1) % modes.length;
      this.holdOn = true;
      this.flash(`HOLD: ${HOLD_LABELS[this.holdMode]}`, 1.8);
    }

    const manualRotate = (this.input.isDown('right') ? 1 : 0)
      - (this.input.isDown('left') ? 1 : 0);
    const cmd = {
      rotate: manualRotate,
      throttle: this.input.isDown('boost') ? 1 : this.throttle,
    };

    // Manual input always wins; the computer only flies what you are not.
    const mode = this.holdMode;
    if (mode && manualRotate === 0) cmd.rotate = this.holdRotate(mode);
    if (mode === 'DESCENT' && !this.input.isDown('boost')) {
      cmd.throttle = this.descentThrottle();
    }

    const altitude = body.altitudeAt(ship.x, ship.y);
    const powered = cmd.throttle > 0 || ship.spool > 1e-3;
    const inAir = body.density(altitude) > 1e-7;
    const low = altitude < body.radius * LOW_ALTITUDE_FRACTION;

    this.applyWarpInput(powered, inAir, low || ship.landed);
    const warp = WARP_LEVELS[this.warpIndex];
    const simDt = dt * warp;

    // Coasting outside an atmosphere is advanced analytically -- exact at any
    // warp factor. Anything else has to be integrated.
    let useKepler = !powered && !inAir && !ship.landed && warp > 10;
    if (useKepler) {
      const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);
      // Never let warp skip the ship through the ground.
      const danger = el.periapsis < body.radius + 25000;
      if (danger && timeToPeriapsis(el) < simDt * 2.5) {
        this.warpIndex = 0;
        this.flash('WARP CANCELLED — PERIAPSIS APPROACH', 2.5);
        useKepler = false;
      }
    }

    if (useKepler) {
      const res = propagate(ship.x, ship.y, ship.vx, ship.vy, body.mu, simDt);
      if (res) {
        ship.x = res.x; ship.y = res.y; ship.vx = res.vx; ship.vy = res.vy;
        ship.angle = wrapAngle(ship.angle + ship.omega * simDt);
        ship.spool = 0;
        ship.elapsed += simDt;
      } else {
        this.integrate(simDt, cmd);
      }
    } else {
      this.integrate(simDt, cmd);
    }

    if (this.state !== STATE.FLYING) return;

    this.missionTime += simDt;
    this.lifeRemaining -= simDt;
    this.stepJetsam(Math.min(simDt, 2));

    if (this.lifeRemaining <= 0) { this.fail('LIFE SUPPORT EXHAUSTED'); return; }
    if (ship.radiusFromCentre > body.radius * ESCAPE_RADIUS_FACTOR) {
      this.fail('LOST — ESCAPED THE BODY'); return;
    }

    this.evaluateMission();
  }

  /** Fixed-step integration, with the substep count bounded. */
  integrate(simDt, cmd) {
    let steps = Math.ceil(simDt / FIXED_DT);
    let h = FIXED_DT;
    const MAX_STEPS = 500;
    if (steps > MAX_STEPS) { steps = MAX_STEPS; h = simDt / MAX_STEPS; }
    for (let i = 0; i < steps; i++) {
      this.ship.step(h, this.body, cmd);
      if (!this.ship.landed && this.checkContact()) return;
    }
  }

  applyWarpInput(powered, inAir, low) {
    let maxIdx = WARP_LEVELS.length - 1;
    if (powered) maxIdx = WARP_MAX_POWERED;
    else if (inAir) maxIdx = WARP_MAX_ATMOSPHERE;
    else if (low) maxIdx = WARP_MAX_LOW;

    if (this.input.wasPressed('warpUp')) {
      if (this.warpIndex >= maxIdx) {
        this.flash(powered ? 'CANNOT WARP UNDER POWER'
          : inAir ? 'CANNOT WARP IN ATMOSPHERE' : 'TOO LOW TO WARP FURTHER', 2);
      } else this.warpIndex += 1;
    }
    if (this.input.wasPressed('warpDown') && this.warpIndex > 0) this.warpIndex -= 1;
    if (this.warpIndex > maxIdx) this.warpIndex = maxIdx;
  }

  evaluateMission() {
    const ship = this.ship;
    const body = this.body;
    const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);
    const theta = Math.atan2(ship.y, ship.x);

    const events = this.mission.evaluate({
      altitude: body.altitudeAt(ship.x, ship.y),
      elements: el,
      landed: ship.landed,
      landedPad: ship.landed ? body.padAt(theta) : null,
    });

    for (const e of events) {
      if (e.type === 'sample') {
        ship.sampleMass += SAMPLE_MASS;
        this.flash(`SAMPLE ABOARD — +${SAMPLE_MASS} KG`, 3);
      } else {
        this.flash(`OBJECTIVE COMPLETE — ${e.objective.label}`, 3);
      }
    }

    if (this.mission.complete) this.succeed();
  }

  /**
   * Attitude controller. cmd.rotate = +1 applies clockwise torque, which
   * DECREASES the inertial (counter-clockwise) angle, hence the sign flip.
   */
  holdRotate(mode) {
    const ship = this.ship;
    const KD = 2.6;
    if (mode === 'KILL') return clamp(ship.omega * 8, -1, 1);

    let target;
    if (mode === 'UP' || mode === 'DESCENT') target = ship.upAngle;
    else if (mode === 'PROGRADE') target = Math.atan2(ship.vy, ship.vx);
    else if (mode === 'RETROGRADE') target = Math.atan2(-ship.vy, -ship.vx);
    else return 0;

    // Below a crawl the velocity vector is noise; hold vertical instead.
    if ((mode === 'PROGRADE' || mode === 'RETROGRADE') && ship.speed < 1) {
      target = ship.upAngle;
    }

    const err = wrapAngle(target - ship.angle);
    return clamp(-(err * 3.2 - ship.omega * KD), -1, 1);
  }

  /** Descent assist: fly the braking curve down to a slow touchdown. */
  descentThrottle() {
    const ship = this.ship;
    const body = this.body;
    if (ship.landed) return 0;
    const r = ship.radiusFromCentre;
    const alt = Math.max(0, body.altitudeAt(ship.x, ship.y));
    const g = body.mu / (r * r);
    const available = ship.maxThrust / ship.mass - g;
    if (available <= 0) return 1;

    // Radial speed, negative when descending.
    const vs = (ship.vx * ship.x + ship.vy * ship.y) / r;
    const target = -Math.max(1.0, Math.min(80,
      Math.sqrt(Math.max(0, 2 * 0.42 * available * Math.max(0, alt - 6)))));
    return clamp((target - vs) * 0.5 + (g * ship.mass) / ship.maxThrust, 0, 1);
  }

  // --- contact ---------------------------------------------------------------

  /** @returns {boolean} true if the flight ended this step. */
  checkContact() {
    const ship = this.ship;
    const body = this.body;

    for (const p of ship.hullPoints()) {
      if (body.altitudeAt(p.x, p.y) <= 0) { this.fail('HULL IMPACT'); return true; }
    }

    const feet = ship.footPoints();
    if (!feet.some((p) => body.altitudeAt(p.x, p.y) <= 0)) return false;

    this.evaluateTouchdown(feet);
    return true;
  }

  evaluateTouchdown(feet) {
    const ship = this.ship;
    const body = this.body;
    const speed = ship.speed;
    const tiltDeg = Math.abs(ship.tilt) * DEG;
    const thetas = feet.map((p) => Math.atan2(p.y, p.x));
    const midTheta = Math.atan2(
      (Math.sin(thetas[0]) + Math.sin(thetas[1])) / 2,
      (Math.cos(thetas[0]) + Math.cos(thetas[1])) / 2
    );

    const padA = body.padAt(thetas[0]);
    const padB = body.padAt(thetas[1]);
    const pad = padA && padB && padA === padB ? padA : null;

    const env = this.envelope;
    const scale = pad ? 1 : OFF_PAD_TOLERANCE_SCALE;
    const limitSpeed = env.speed * scale;
    const limitAngle = env.angle * scale;
    const slope = Math.abs(body.slopeAt(midTheta) * DEG);

    let reason = null;
    if (speed > limitSpeed) reason = 'IMPACT SPEED TOO HIGH';
    else if (tiltDeg > limitAngle) reason = 'TOUCHED DOWN TOO STEEP';
    else if (Math.abs(ship.omega) > MAX_TOUCHDOWN_SPIN) reason = 'STILL ROTATING — TIPPED OVER';
    else if (!pad && slope > MAX_OFF_PAD_SLOPE_DEG) reason = 'GROUND TOO STEEP';

    this.lastTouchdown = { speed, tiltDeg, pad, limitSpeed, limitAngle, slope };

    if (reason) {
      this.fail(reason, { speed, tiltDeg, limitSpeed, limitAngle });
      return;
    }

    ship.settle(body);
    this.session.landings += 1;
    this.flash(pad ? `TOUCHDOWN — ${pad.label}` : 'TOUCHDOWN', 3);
    this.evaluateMission();
  }

  // --- outcomes --------------------------------------------------------------

  succeed() {
    const ship = this.ship;
    const td = this.lastTouchdown;
    const level = this.level;

    // Quality is judged on the touchdown if there was one, otherwise on how
    // much propellant is left.
    let quality;
    if (td) {
      quality = clamp(1 - 0.5 * (td.speed / td.limitSpeed)
        - 0.5 * (td.tiltDeg / td.limitAngle), 0, 1);
    } else {
      quality = clamp(ship.totalFuel / Math.max(1, this.startFuel || 1), 0, 1) * 0.6 + 0.4;
    }
    const padMult = td && td.pad ? td.pad.mult : (td ? OFF_PAD_MULTIPLIER : 1);
    const fuelFraction = ship.totalFuel / Math.max(1, this.startFuel || ship.totalFuel || 1);
    const fuelBonus = Math.round(level.reward * 0.25 * clamp(fuelFraction, 0, 1));
    const credits = Math.round(level.reward * (0.5 + 0.5 * quality) * padMult) + fuelBonus;

    this.session.credits += credits;
    this.session.totalEarned += credits;

    this.result = {
      success: true,
      quality,
      credits,
      fuelBonus,
      padMult,
      touchdown: td,
      fuelLeft: ship.totalFuel,
      missionTime: this.missionTime,
      lifeLeft: this.lifeRemaining,
      sample: ship.sampleMass,
      rating: ratingFor(quality),
    };
    this.state = STATE.RESULT;
  }

  fail(reason, detail = {}) {
    this.session.losses += 1;
    const cost = this.buildCost || 0;
    const refund = Math.round(cost * LOSS_REFUND);
    this.session.credits += refund;
    // Guarantee you can always rebuild the vehicle you just lost.
    if (this.session.credits < cost) this.session.credits = cost;

    if (this.ship) this.spawnDebris();
    this.result = {
      success: false,
      reason,
      refund,
      touchdown: this.lastTouchdown,
      detail,
      fuelLeft: this.ship ? this.ship.totalFuel : 0,
      missionTime: this.missionTime,
      objectives: this.mission.objectives,
    };
    this.state = STATE.RESULT;
  }

  abort() {
    this.flash('MISSION ABORTED', 2);
    this.fail('ABORTED BY CREW');
  }

  updateResult(dt) {
    this.stepDebris(dt);
    if (!(this.input.wasPressed('confirm') || this.input.wasPressed('boost'))) return;

    if (!this.result.success) {
      this.loadLevel(this.session.levelIndex);
      this.state = STATE.HANGAR;
      return;
    }
    const next = this.session.levelIndex + 1;
    if (next >= LEVELS.length) { this.state = STATE.COMPLETE; return; }
    this.loadLevel(next);
    this.state = STATE.HANGAR;
  }

  // --- debris ----------------------------------------------------------------

  spawnDebris() {
    const ship = this.ship;
    const pieces = [];
    const pts = [...ship.hullPoints(), ...ship.footPoints()];
    const spread = Math.max(4, ship.length * 1.5);
    for (let i = 0; i < 16; i++) {
      const p = pts[i % pts.length];
      const dir = Math.random() * Math.PI * 2;
      pieces.push({
        x: p.x, y: p.y,
        vx: ship.vx * 0.3 + Math.cos(dir) * spread,
        vy: ship.vy * 0.3 + Math.sin(dir) * spread,
        angle: Math.random() * Math.PI,
        omega: (Math.random() - 0.5) * 8,
        len: ship.length * (0.08 + Math.random() * 0.22),
        life: 1,
      });
    }
    this.debris = pieces;
  }

  stepDebris(dt) {
    const body = this.body;
    for (const p of this.debris) {
      if (p.life <= 0) continue;
      const g = body.gravityAt(p.x, p.y);
      p.vx += g.ax * dt; p.vy += g.ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.angle += p.omega * dt;
      if (body.altitudeAt(p.x, p.y) < 0) {
        const r = Math.hypot(p.x, p.y);
        const sr = body.surfaceRadius(Math.atan2(p.y, p.x));
        p.x *= sr / r; p.y *= sr / r;
        p.vx *= 0.4; p.vy *= -0.25;
        p.omega *= 0.5;
      }
      p.life -= dt * 0.4;
    }
  }

  spawnJetsam() {
    const ship = this.ship;
    const back = ship.toWorld({ x: 0, y: ship.bottom - 2 });
    this.jetsam.push({
      x: back.x, y: back.y,
      vx: ship.vx - Math.cos(ship.angle) * 6,
      vy: ship.vy - Math.sin(ship.angle) * 6,
      angle: ship.angle - Math.PI / 2,
      omega: (Math.random() - 0.5) * 1.2,
      len: Math.max(2, ship.length * 0.4),
      rad: Math.max(0.6, ship.maxRadius),
      life: 1,
    });
  }

  stepJetsam(dt) {
    for (const p of this.jetsam) {
      if (p.life <= 0) continue;
      const g = this.body.gravityAt(p.x, p.y);
      p.vx += g.ax * dt; p.vy += g.ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.angle += p.omega * dt;
      p.life -= dt * 0.06;
    }
    this.jetsam = this.jetsam.filter((p) => p.life > 0);
  }

  // --- camera ----------------------------------------------------------------

  updateCamera(dt) {
    const r = this.r;
    const body = this.body;
    if (!this.ship) {
      // Hangar: frame the body so there is something behind the panels.
      r.camera.x = 0; r.camera.y = body.radius * 1.6;
      r.camera.rot = Math.PI / 2;
      r.scale = (r.h * 0.5) / (body.radius * 1.2);
      return;
    }
    const ship = this.ship;

    if (this.mapView) {
      const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);
      const far = el.closed && isFinite(el.apoapsis)
        ? el.apoapsis
        : Math.max(ship.radiusFromCentre * 2, body.radius * 4);
      const fit = Math.max(far, ship.radiusFromCentre, body.radius) * 1.25;
      r.camera.x = 0; r.camera.y = 0;
      r.camera.rot = 0;
      const target = (Math.min(r.w, r.h) * 0.5) / fit;
      r.scale += (target - r.scale) * Math.min(1, dt * 6);
      return;
    }

    // Flight view. Keep the ship a comfortable size when low, and zoom out
    // once altitude, not the ship, is what needs to fit on screen.
    const alt = Math.max(1, body.altitudeAt(ship.x, ship.y));
    // Target on-screen ship size scales with the display, so the close view
    // reads the same on a laptop and a large monitor.
    const shipScale = (r.h * 0.055) / Math.max(4, ship.length);
    const altScale = (r.h * 0.40) / alt;
    const target = clamp(Math.min(shipScale, altScale), 1e-7, 40);
    const k = Math.min(1, dt * 3.5);
    r.scale = r.scale > 0 ? r.scale * Math.pow(target / r.scale, k) : target;

    r.camera.x = ship.x;
    r.camera.y = ship.y;
    // Local up points to screen up.
    const wanted = ship.upAngle - Math.PI / 2;
    r.camera.rot = wanted;
  }

  // --- drawing ---------------------------------------------------------------

  draw(dt) {
    const r = this.r;
    r.clear();
    r.drawStars(dt);
    r.drawBody(this.body);

    if (this.state === STATE.HANGAR) {
      this.dim(0.78);
      this.hangar.draw(r, this.session, this.body, this.level);
      this.drawHudLabel();
      return;
    }

    if (this.ship) {
      const el = elementsFromState(this.ship.x, this.ship.y,
        this.ship.vx, this.ship.vy, this.body.mu);
      const showOrbit = this.mapView
        || this.ship.radiusFromCentre > this.body.radius + this.body.radius * 0.002;
      if (showOrbit && !this.ship.landed) r.drawOrbit(el, this.body);
    }

    r.drawJetsam(this.jetsam);

    const lost = this.state === STATE.RESULT && !this.result.success;
    if (lost && this.debris.length) r.drawDebris(this.debris);
    else if (this.ship) r.drawShip(this.ship);

    if (this.state === STATE.FLYING) {
      drawHUD(r, telemetry(this), this.hudLayout);
      this.drawTitleFlash();
    }
    if (this.state === STATE.RESULT) this.drawResult();
    if (this.state === STATE.COMPLETE) this.drawComplete();

    this.drawMessage();
    this.drawHudLabel();
  }

  dim(alpha) {
    const ctx = this.r.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.r.w, this.r.h);
    this.r.reset();
  }

  drawMessage() {
    if (this.messageTime <= 0) return;
    this.r.text(this.message, this.r.w / 2, this.r.h * 0.22, {
      size: 15, align: 'center', color: COLORS.accent,
      alpha: clamp(this.messageTime, 0, 1),
    });
  }

  drawHudLabel() {
    if (this.hudLabelTime <= 0) return;
    this.r.text(`HUD: ${HUD_LAYOUTS[this.hudLayout]}`, this.r.w / 2, this.r.h - 60, {
      size: 13, align: 'center', alpha: clamp(this.hudLabelTime, 0, 1) * 0.8,
    });
  }

  drawTitleFlash() {
    if (this.titleTime <= 0) return;
    const a = clamp(this.titleTime / 1.4, 0, 1);
    const r = this.r;
    r.text(`LEVEL ${this.level.id}`, r.w / 2, r.h * 0.36,
      { size: 13, align: 'center', alpha: a * 0.7 });
    r.text(this.level.title, r.w / 2, r.h * 0.36 + 34,
      { size: 30, align: 'center', alpha: a });
    r.text(this.body.name, r.w / 2, r.h * 0.36 + 58,
      { size: 13, align: 'center', alpha: a * 0.7 });
    if (this.session.levelIndex === 0) {
      r.text('LEFT/RIGHT ROTATE    W/S THROTTLE    SPACE FULL THRUST    F CUTOFF',
        r.w / 2, r.h * 0.36 + 92, { size: 12, align: 'center', alpha: a * 0.6 });
      r.text('X STAGE    , . TIME WARP    M MAP    H HUD    R ABORT',
        r.w / 2, r.h * 0.36 + 112, { size: 12, align: 'center', alpha: a * 0.6 });
      r.text('T HOLD    G HOLD MODE   (needs a flight computer)',
        r.w / 2, r.h * 0.36 + 132, { size: 12, align: 'center', alpha: a * 0.5 });
    }
  }

  drawResult() {
    const r = this.r;
    const res = this.result;
    this.dim(0.7);
    const cx = r.w / 2;
    let y = r.h / 2 - 170;

    const good = res.success;
    r.text(good ? 'MISSION COMPLETE' : 'VEHICLE LOST', cx, y,
      { size: 32, align: 'center', color: good ? COLORS.good : COLORS.danger });
    y += 26;
    r.text(good ? res.rating : res.reason, cx, y,
      { size: 15, align: 'center', alpha: 0.85 });
    y += 38;

    // Objective checklist.
    for (const o of this.mission.objectives) {
      r.text(`${o.done ? '[x]' : '[ ]'}  ${o.label}`, cx - 240, y,
        { size: 12, alpha: o.done ? 0.9 : 0.4, color: o.done ? COLORS.good : COLORS.ui });
      y += 19;
    }
    y += 14;

    const rows = [];
    if (res.touchdown) {
      rows.push(['IMPACT SPEED', `${res.touchdown.speed.toFixed(2)} M/S`,
        `LIMIT ${res.touchdown.limitSpeed.toFixed(1)}`]);
      rows.push(['ANGLE FROM VERTICAL', `${res.touchdown.tiltDeg.toFixed(1)}°`,
        `LIMIT ${Math.round(res.touchdown.limitAngle)}°`]);
      rows.push(['LANDING SITE', res.touchdown.pad ? res.touchdown.pad.label : 'OPEN GROUND', '']);
    }
    rows.push(['MISSION TIME', fmtTime(res.missionTime), '']);
    rows.push(['PROPELLANT LEFT', fmtMass(res.fuelLeft), '']);
    if (good) {
      if (res.sample) rows.push(['SAMPLE ABOARD', fmtMass(res.sample), '']);
      rows.push(['LIFE SUPPORT LEFT', fmtTime(res.lifeLeft), '']);
      rows.push(['FUEL BONUS', `${res.fuelBonus} CR`, '']);
      rows.push(['CREDITS EARNED', `${res.credits} CR`, '']);
    } else {
      rows.push(['HARDWARE RECOVERED', `${res.refund} CR`, '']);
    }

    const w = Math.min(520, r.w - 80);
    const x0 = cx - w / 2;
    for (const [label, value, note] of rows) {
      r.text(label, x0, y, { size: 12, alpha: 0.55 });
      r.text(value, x0 + w * 0.74, y, { size: 13, align: 'right' });
      if (note) r.text(note, x0 + w, y, { size: 11, align: 'right', alpha: 0.4 });
      y += 21;
    }

    y += 18;
    r.text(`CREDITS  ${this.session.credits}`, cx, y,
      { size: 15, align: 'center', color: COLORS.accent });
    y += 32;
    r.text(good ? 'PRESS ENTER FOR THE HANGAR' : 'PRESS ENTER TO REBUILD AND TRY AGAIN',
      cx, y, {
        size: 14, align: 'center',
        alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
      });
  }

  drawComplete() {
    const r = this.r;
    this.dim(0.85);
    const cx = r.w / 2;
    let y = r.h / 2 - 90;
    r.text('CAMPAIGN COMPLETE', cx, y,
      { size: 32, align: 'center', color: COLORS.good });
    y += 44;
    r.text(`${this.session.landings} LANDINGS   ${this.session.losses} VEHICLES LOST`,
      cx, y, { size: 15, align: 'center', alpha: 0.75 });
    y += 26;
    r.text(`${this.session.totalEarned} CREDITS EARNED`, cx, y,
      { size: 15, align: 'center', alpha: 0.75 });
    y += 50;
    r.text('PRESS R TO FLY IT AGAIN', cx, y, {
      size: 14, align: 'center',
      alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
  }
}

function ratingFor(q) {
  if (q > 0.88) return 'TEXTBOOK';
  if (q > 0.7) return 'CLEAN';
  if (q > 0.45) return 'SOLID';
  return 'ROUGH BUT INTACT';
}
