import {
  FIXED_DT, LEVELS, BODIES, COLORS, WARP_LEVELS, WARP_MAX_POWERED,
  WARP_MAX_ATMOSPHERE, WARP_MAX_LOW, LOW_ALTITUDE_FRACTION, WARP_IMPACT_MARGIN,
  RCS_TIERS, LEG_TIERS, COMPUTER_TIERS, HOLD_LABELS, SAMPLE_MASS, STARTING_CREDITS,
  SEVERITY_SPEED_SPAN, REPLAY_DECAY,
  MAX_TOUCHDOWN_SPIN, OFF_PAD_MULTIPLIER, OFF_PAD_TOLERANCE_SCALE,
  MAX_OFF_PAD_SLOPE_DEG,
  DIFFICULTIES, DEFAULT_DIFFICULTY, difficultyAt,
  salvageRates, touchdownEnvelope, bonusesFor,
  PRECISION_FRACTION, FUEL_MARGIN_FRACTION,
} from './config.js';
import { Body } from './body.js';
import { Ship } from './ship.js';
import { Mission } from './mission.js';
import { Hangar } from './hangar.js';
import { createDesign, designStats, salvageValue } from './design.js';
import {
  elementsFromState, propagate, trueAnomalyAtRadius, timeToTrueAnomaly,
} from './orbit.js';
import { drawHUD, telemetry, HUD_LAYOUTS } from './hud.js';
import { clamp, lerp, wrapAngle, DEG, fmtTime, fmtMass } from './util.js';

const STATE = {
  DIFFICULTY: 'difficulty', HANGAR: 'hangar', FLYING: 'flying',
  RESULT: 'result', COMPLETE: 'complete',
};

// Escaping this far means the mission is unrecoverable.
const ESCAPE_RADIUS_FACTOR = 60;
// The economy exists to constrain what you can design, not to punish
// crashes -- a losing streak must never leave the campaign unwinnable.
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
    this.paused = false;
    this.message = '';
    this.messageTime = 0;
    this.restart();
  }

  /**
   * Begin a campaign at a difficulty setting. The constructor starts one at
   * the default so a Game is always in a playable state; `promptDifficulty`
   * is what puts the choice in front of a player.
   */
  restart(difficultyIndex = DEFAULT_DIFFICULTY) {
    const difficulty = difficultyAt(difficultyIndex);
    this.session = {
      difficulty: DIFFICULTIES.indexOf(difficulty),
      credits: Math.round(STARTING_CREDITS * difficulty.credits),
      levelIndex: 0,
      // Highest level unlocked. Part availability keys off this, not off the
      // level currently selected, so replaying level 1 does not take your
      // engines away.
      frontier: 0,
      completions: LEVELS.map(() => 0),
      design: createDesign(),
      totalEarned: 0,
      landings: 0,
      losses: 0,
    };
    this.loadLevel(0);
    this.state = STATE.HANGAR;
    return this;
  }

  get level() { return LEVELS[this.session.levelIndex]; }

  get difficulty() { return difficultyAt(this.session.difficulty); }

  /**
   * Put the difficulty choice in front of the player. Only reachable before a
   * campaign has been flown -- the setting rewrites the starting budget, so
   * changing it mid-run would mean either a windfall or a bankruptcy.
   */
  promptDifficulty(index = this.session.difficulty) {
    this.diffIndex = clamp(index, 0, DIFFICULTIES.length - 1);
    this.state = STATE.DIFFICULTY;
    return this;
  }

  /** Take the choice and start the campaign on it. */
  chooseDifficulty(index) {
    this.restart(index);
    return this;
  }

  /**
   * Start straight into a chosen level, for testing. Unlocks everything up to
   * it, marks the earlier ones completed, and grants roughly the credits a
   * real playthrough would have arrived with.
   *
   * Reachable from the URL (`?level=6`, optionally `&credits=200000`) and from
   * the console as `lander.game.jumpTo(5)`.
   */
  jumpTo(index, credits = null) {
    const i = clamp(Math.round(index), 0, LEVELS.length - 1);
    const diff = this.difficulty;
    this.session.frontier = i;
    this.session.completions = LEVELS.map((_, n) => (n < i ? 1 : 0));
    if (credits !== null) {
      this.session.credits = Math.max(0, credits);
    } else {
      let earned = STARTING_CREDITS * diff.credits;
      for (let n = 0; n < i; n++) earned += LEVELS[n].reward * 1.2 * diff.rewardScale;
      this.session.credits = Math.round(earned);
    }
    this.loadLevel(i);
    this.state = STATE.HANGAR;
    return this;
  }

  /** Hold modes the installed flight computer supports. */
  get holdModes() {
    return COMPUTER_TIERS[this.session.design.computer || 0].modes;
  }

  get holdMode() {
    const modes = this.holdModes;
    return this.holdOn && modes.length ? modes[this.holdIndex % modes.length] : null;
  }

  /**
   * Mission payout multiplier for the selected level. Full price the first
   * time, decaying with each completion down to a floor that is still worth
   * flying, so a short player can grind but would rather not.
   */
  get payoutMultiplier() {
    const done = this.session.completions[this.session.levelIndex] || 0;
    return Math.max(this.difficulty.replayFloor, REPLAY_DECAY ** done);
  }

  get isReplay() { return (this.session.completions[this.session.levelIndex] || 0) > 0; }

  /** Touchdown envelope, widened by the landing gear and the setting. */
  get envelope() {
    return touchdownEnvelope(this.level, LEG_TIERS[this.session.design.legs],
      this.difficulty);
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
    this.paused = false;
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
    this.paused = false;
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
    // this.time keeps running while paused so on-screen prompts still pulse;
    // nothing that affects the simulation does.
    this.time += dt;

    if (this.input.wasPressed('pause') && this.state === STATE.FLYING) {
      this.paused = !this.paused;
    }

    if (this.paused && this.state === STATE.FLYING) {
      // Frozen. Cycling the HUD is allowed -- comparing layouts on a still
      // frame is the easiest way to judge them -- and so is aborting.
      if (this.input.wasPressed('hud')) {
        this.hudLayout = (this.hudLayout + 1) % HUD_LAYOUTS.length;
      }
      if (this.input.wasPressed('restart')) {
        this.paused = false;
        this.abort();
      }
      return;
    }

    if (this.hudLabelTime > 0) this.hudLabelTime -= dt;
    if (this.titleTime > 0) this.titleTime -= dt;
    if (this.messageTime > 0) this.messageTime -= dt;
    this.hangar.update(dt);

    if (this.input.wasPressed('hud')) {
      this.hudLayout = (this.hudLayout + 1) % HUD_LAYOUTS.length;
      this.hudLabelTime = 1.6;
    }

    switch (this.state) {
      case STATE.DIFFICULTY: this.updateDifficulty(); break;
      case STATE.HANGAR: this.updateHangar(); break;
      case STATE.FLYING: this.updateFlying(dt); break;
      case STATE.RESULT: this.updateResult(dt); break;
      case STATE.COMPLETE:
        // ENTER goes back to the hangar rather than forcing a restart, so the
        // campaign being finished does not end the save. R starts over, and a
        // new campaign is the one moment the difficulty can change.
        if (this.input.wasPressed('restart')) {
          this.restart(this.session.difficulty).promptDifficulty();
        }
        else if (this.input.wasPressed('confirm')) {
          this.loadLevel(this.session.frontier);
          this.state = STATE.HANGAR;
        }
        break;
    }
    this.updateCamera(dt);
  }

  updateDifficulty() {
    if (this.input.wasPressed('up')) {
      this.diffIndex = (this.diffIndex - 1 + DIFFICULTIES.length) % DIFFICULTIES.length;
    }
    if (this.input.wasPressed('down')) {
      this.diffIndex = (this.diffIndex + 1) % DIFFICULTIES.length;
    }
    if (this.input.wasPressed('confirm') || this.input.wasPressed('launch')) {
      this.chooseDifficulty(this.diffIndex);
    }
  }

  updateHangar() {
    if (this.input.wasPressed('prevLevel')) this.selectLevel(this.session.levelIndex - 1);
    if (this.input.wasPressed('nextLevel')) this.selectLevel(this.session.levelIndex + 1);
    const action = this.hangar.handle(this.input, this.session, this.body, this.level);
    if (action === 'launch') this.launch();
  }

  /** Pick a level to fly: anything up to and including the frontier. */
  selectLevel(index) {
    const i = clamp(index, 0, this.session.frontier);
    if (i === this.session.levelIndex) return;
    const row = this.hangar.selection;   // keep the player's place in the editor
    this.loadLevel(i);
    this.hangar.selection = row;
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

    // Wind warp down until a single step cannot reach the ground. This has to
    // happen BEFORE simDt is computed -- an earlier version cancelled warp but
    // still stepped the pre-cancellation interval, which tunnelled the ship
    // straight through the surface.
    if (!ship.landed) {
      const tti = this.timeToImpact();
      let steps = 0;
      while (this.warpIndex > 0
        && tti < dt * WARP_LEVELS[this.warpIndex] * WARP_IMPACT_MARGIN
        && steps++ < WARP_LEVELS.length) {
        this.warpIndex -= 1;
      }
      if (steps > 0) this.flash('WARP REDUCED — GROUND APPROACH', 1.6);
    }

    const warp = WARP_LEVELS[this.warpIndex];
    const simDt = dt * warp;

    // Coasting outside an atmosphere is advanced analytically -- exact at any
    // warp factor. Anything else has to be integrated. A radial trajectory is
    // a degenerate conic, so propagate() declines it and it integrates too.
    const useKepler = !powered && !inAir && !ship.landed && warp > 10;

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

  /**
   * Seconds until the ship would reach the ground on its current path, from
   * altitude, radial speed and local gravity.
   *
   * Deliberately not derived from the conic. A radial trajectory -- anything
   * flown straight up -- is degenerate: its periapsis is the planet's centre
   * and its time-to-periapsis is zero, which pinned time warp at 1x for the
   * whole flight.
   */
  timeToImpact() {
    const ship = this.ship;
    const body = this.body;
    const r = ship.radiusFromCentre;
    const alt = body.altitudeAt(ship.x, ship.y);
    if (alt <= 0) return 0;

    const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);
    if (!el.radial) {
      // A trajectory whose periapsis clears the surface never arrives, and a
      // free-fall estimate would wrongly throttle warp in a stable orbit --
      // it ignores angular momentum entirely.
      if (el.periapsis > body.radius) return Infinity;
      const nu = trueAnomalyAtRadius(el, body.radius);
      if (nu !== null) {
        const t = timeToTrueAnomaly(el, nu);
        if (isFinite(t) && t >= 0) return t;
      }
    }

    // Radial, or a conic that could not be solved: fall back to free fall.
    // Positive sink means descending; when climbing this correctly includes
    // the coast up and back down.
    const sink = -(ship.vx * ship.x + ship.vy * ship.y) / r;
    const g = body.mu / (r * r);
    const t = (-sink + Math.sqrt(Math.max(0, sink * sink + 2 * g * alt))) / g;
    return isFinite(t) && t > 0 ? t : Infinity;
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

    // Distance from the pad's centre line, which is what the precision bonus
    // is judged on. Measured at the pad's own radius, not the body's mean.
    const offset = pad ? Math.abs(wrapAngle(midTheta - pad.theta)) * pad.r : Infinity;
    this.lastTouchdown = { speed, tiltDeg, pad, limitSpeed, limitAngle, slope, offset };

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

  /**
   * Grade the flight against each bonus the level offers. Every one is
   * all-or-nothing against a threshold stated in the hangar, and a missed one
   * carries the margin it was missed by -- "short by 40 kg" is the single most
   * useful thing the results screen can say.
   */
  awardBonuses() {
    const ship = this.ship;
    const level = this.level;
    const td = this.lastTouchdown;
    // What the stages still bolted on were built to hold. Jettisoned stages
    // do not count against the reserve -- burning one dry and dropping it is
    // the plan, not a waste.
    const loaded = Math.max(1, ship.design.stages
      .slice(ship.activeStage).reduce((a, s) => a + s.fuel, 0));

    return bonusesFor(level, this.body).map((b) => {
      let earned = false;
      let detail = '';
      if (b.id === 'precision') {
        const offset = td && isFinite(td.offset) ? td.offset : Infinity;
        const limit = (td && td.pad ? td.pad.width / 2 : 0) * PRECISION_FRACTION;
        if (!td || !td.pad) detail = 'NOT ON THE PAD';
        else if (!isFinite(offset)) detail = 'NOT MEASURED';
        else {
          earned = offset <= limit;
          detail = earned ? `${offset.toFixed(0)} M OFF CENTRE`
            : `${(offset - limit).toFixed(0)} M TOO FAR OUT`;
        }
      } else if (b.id === 'fuel') {
        const need = loaded * FUEL_MARGIN_FRACTION;
        earned = ship.totalFuel >= need;
        detail = earned ? `${fmtMass(ship.totalFuel)} LEFT`
          : `SHORT BY ${fmtMass(need - ship.totalFuel)}`;
      } else if (b.id === 'schedule') {
        earned = this.missionTime <= level.estDuration;
        detail = earned ? `${fmtTime(level.estDuration - this.missionTime)} TO SPARE`
          : `OVER BY ${fmtTime(this.missionTime - level.estDuration)}`;
      } else if (b.id === 'intact') {
        earned = ship.activeStage === 0;
        detail = earned ? 'WHOLE VEHICLE RETURNED'
          : `${ship.activeStage} STAGE${ship.activeStage > 1 ? 'S' : ''} EXPENDED`;
      }
      return { ...b, earned, detail };
    });
  }

  succeed() {
    const ship = this.ship;
    const td = this.lastTouchdown;
    const level = this.level;
    const diff = this.difficulty;

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
    const payout = this.payoutMultiplier;

    // The base payment scales with the difficulty setting; the bonuses do not.
    // That is the whole difference between the settings: at CADET the base
    // alone rebuilds the rocket and bonuses are gravy, at FLIGHT DIRECTOR it
    // does not and they are the budget.
    const base = Math.round(level.reward * diff.rewardScale
      * (0.5 + 0.5 * quality) * padMult);
    const bonuses = this.awardBonuses();
    const bonusTotal = bonuses.reduce((a, b) => a + (b.earned ? b.value : 0), 0);
    const gross = base + bonusTotal;
    // Only the mission payment decays on a replay. Recovery is physical: the
    // hardware is worth what it is worth however many times you have flown it,
    // and decaying it would make grinding net-negative.
    const mission = Math.round(gross * payout);
    const recovered = Math.round(salvageValue(ship) * salvageRates(diff).intact);
    const credits = mission + recovered;

    this.session.credits += credits;
    this.session.totalEarned += credits;
    this.session.completions[this.session.levelIndex] += 1;
    this.ensureRebuildable();

    this.result = {
      success: true,
      quality,
      credits,
      mission,
      base,
      gross,
      payout,
      replay: this.isReplay,
      completions: this.session.completions[this.session.levelIndex] || 0,
      recovered,
      expended: ship.activeStage,
      bonuses,
      bonusTotal,
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
    const severity = this.severityOf(reason, detail);
    const rates = salvageRates(this.difficulty);
    const rate = lerp(rates.intact, rates.wrecked, severity);
    const recovered = this.ship ? Math.round(salvageValue(this.ship) * rate) : 0;
    this.session.credits += recovered;
    this.ensureRebuildable();

    if (this.ship) this.spawnDebris();
    this.result = {
      success: false,
      reason,
      severity,
      salvageRate: rate,
      recovered,
      expended: this.ship ? this.ship.activeStage : 0,
      touchdown: this.lastTouchdown,
      detail,
      fuelLeft: this.ship ? this.ship.totalFuel : 0,
      missionTime: this.missionTime,
      objectives: this.mission.objectives,
    };
    this.state = STATE.RESULT;
  }

  /**
   * How badly the vehicle was wrecked, 0 (walk away) to 1 (total loss).
   * Drives salvage, so a landing that just missed the envelope leaves most of
   * the hardware recoverable while a hypersonic impact leaves scrap.
   */
  severityOf(reason, detail) {
    // Not every failure is an impact. An abandoned mission or a dead crew
    // leaves the vehicle itself intact; an escape trajectory loses it outright.
    if (reason === 'ABORTED BY CREW') return 0;
    if (reason === 'LIFE SUPPORT EXHAUSTED') return 0;
    if (reason === 'LOST — ESCAPED THE BODY') return 1;

    const env = this.envelope;
    const speed = detail.speed ?? (this.ship ? this.ship.speed : 0);
    const limitSpeed = detail.limitSpeed ?? env.speed;
    let sev = clamp((speed - limitSpeed) / SEVERITY_SPEED_SPAN, 0, 1);

    // Coming down badly tilted wrecks structure even at modest speed.
    const tilt = detail.tiltDeg ?? (this.ship ? Math.abs(this.ship.tilt) * DEG : 0);
    const limitAngle = detail.limitAngle ?? env.angle;
    sev += clamp((tilt - limitAngle) / 90, 0, 1) * 0.35;

    // Landing on the hull rather than the gear is its own kind of bad.
    if (reason === 'HULL IMPACT') sev += 0.3;

    return clamp(sev, 0, 1);
  }

  /**
   * Never leave the player unable to rebuild the vehicle they just flew.
   * This is the whole soft-lock guarantee, and it has to apply on success as
   * well: a rough landing can pay less than a crash-plus-floor would.
   */
  ensureRebuildable() {
    const cost = this.buildCost || 0;
    if (this.session.credits < cost) this.session.credits = cost;
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
    // Beating the frontier unlocks the next level. Replaying an older one
    // leaves you on it, so a grind loop is just ENTER, fly, ENTER.
    if (this.session.levelIndex === this.session.frontier) {
      if (this.session.frontier + 1 >= LEVELS.length) {
        this.state = STATE.COMPLETE;
        return;
      }
      this.session.frontier += 1;
      this.loadLevel(this.session.frontier);
    } else {
      this.loadLevel(this.session.levelIndex);
    }
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

    // Flight view, in two framings that blend into each other.
    //
    // Close in, the ship is the subject: hold it at a comfortable size when
    // low, then let altitude be what has to fit. Far out that breaks down --
    // the body is small enough to see whole but sits half off the edge -- so
    // the framing shifts to the planet: centred, entire, with the ship above
    // it.
    const alt = Math.max(1, body.altitudeAt(ship.x, ship.y));
    const R = body.radius;
    const dist = ship.radiusFromCentre;
    const viewport = Math.min(r.w, r.h);

    // Ship-centred. Target on-screen ship size scales with the display so the
    // close view reads the same on a laptop and a large monitor.
    const shipScale = (r.h * 0.055) / Math.max(4, ship.length);
    const altScale = (r.h * 0.40) / alt;
    const closeScale = clamp(Math.min(shipScale, altScale), 1e-9, 40);

    // Planet-centred: fit the whole body, and the ship along with it.
    const wideScale = (viewport * 0.45) / (Math.max(R, dist) * 1.08);

    // Blend as the body shrinks to fit. Starts when it is slightly wider than
    // the viewport and completes once it is comfortably inside.
    const planetFraction = (2 * R * closeScale) / viewport;
    const t = clamp((1.35 - planetFraction) / 0.5, 0, 1);

    const target = closeScale * (wideScale / closeScale) ** t;
    const k = Math.min(1, dt * 3.5);
    r.scale = r.scale > 0 ? r.scale * (target / r.scale) ** k : target;

    // Ease the centre from the ship to the body's centre over the same blend.
    r.camera.x = ship.x * (1 - t);
    r.camera.y = ship.y * (1 - t);
    // Local up stays screen up. Once centred on the body this also parks the
    // ship directly above the middle of the screen, with the surface turning
    // beneath it.
    r.camera.rot = ship.upAngle - Math.PI / 2;
    this.planetFramed = t;
  }

  // --- drawing ---------------------------------------------------------------

  draw(dt) {
    const r = this.r;
    r.clear();
    r.drawStars(dt);
    r.drawBody(this.body);

    if (this.state === STATE.DIFFICULTY) {
      this.dim(0.85);
      this.drawDifficulty();
      return;
    }

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
      // The title flash would sit behind the pause overlay forever, since its
      // timer is frozen along with everything else.
      if (this.paused) this.drawPaused();
      else this.drawTitleFlash();
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

  /**
   * The difficulty choice, shown once before the first hangar. Every setting
   * flies the same physics and the same twelve levels; what the list explains
   * is what the economy and the hangar do differently, because that is all
   * that changes.
   */
  drawDifficulty() {
    const r = this.r;
    const cx = r.w / 2;
    const w = Math.min(560, r.w - 80);
    const x0 = cx - w / 2;
    let y = Math.max(70, r.h / 2 - 250);

    r.text('LANDER', cx, y, { size: 34, align: 'center', color: COLORS.accent });
    y += 26;
    r.text('SELECT A DIFFICULTY', cx, y, { size: 13, align: 'center', alpha: 0.6 });
    y += 46;

    DIFFICULTIES.forEach((d, i) => {
      const on = i === this.diffIndex;
      const h = 44 + d.notes.length * 16;
      if (on) r.rectS(x0 - 12, y - 22, w + 24, h + 12, COLORS.accent, 0.8);
      r.text(`${on ? '>' : ' '} ${d.name}`, x0, y,
        { size: 17, color: on ? COLORS.accent : COLORS.ui, alpha: on ? 1 : 0.55 });
      r.text(`${Math.round(STARTING_CREDITS * d.credits)} CR TO START`, x0 + w, y,
        { size: 12, align: 'right', alpha: on ? 0.75 : 0.35 });
      y += 20;
      r.text(d.tagline, x0 + 18, y, { size: 12, alpha: on ? 0.75 : 0.35 });
      y += 18;
      for (const note of d.notes) {
        r.text(`- ${note}`, x0 + 18, y, { size: 11, alpha: on ? 0.55 : 0.2 });
        y += 16;
      }
      y += 22;
    });

    y += 6;
    r.text('THE PHYSICS, THE LEVELS AND THE LANDING RULES ARE THE SAME AT EVERY SETTING.',
      cx, y, { size: 11, align: 'center', alpha: 0.4 });
    y += 28;
    r.text('W/S SELECT      ENTER CONFIRM', cx, y, {
      size: 14, align: 'center',
      alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
  }

  /** Pause overlay, which doubles as the controls reference. */
  drawPaused() {
    const r = this.r;
    this.dim(0.72);
    const cx = r.w / 2;
    let y = r.h / 2 - 190;

    r.text('PAUSED', cx, y, { size: 32, align: 'center', color: COLORS.accent });
    y += 22;
    r.text(`${this.level.title}  /  ${this.body.name}   MET ${fmtTime(this.missionTime)}`,
      cx, y, { size: 12, align: 'center', alpha: 0.55 });
    y += 40;

    const rows = [
      ['ROTATE', 'LEFT / RIGHT   (A / D)'],
      ['THROTTLE', 'W / S   (UP / DOWN)'],
      ['FULL THRUST', 'SPACE  (hold)'],
      ['ENGINE CUTOFF', 'F'],
      ['STAGE', 'X'],
      ['TIME WARP', ',  /  .'],
      ['FLIGHT COMPUTER', 'T engage    G mode'],
      ['MAP VIEW', 'M'],
      ['HUD LAYOUT', 'H'],
      ['PAUSE', 'P  /  ESC'],
      ['ABORT MISSION', 'R'],
    ];
    const w = Math.min(420, r.w - 80);
    const x0 = cx - w / 2;
    for (const [label, keys] of rows) {
      r.text(label, x0, y, { size: 12, alpha: 0.5 });
      r.text(keys, x0 + w, y, { size: 12, align: 'right' });
      y += 20;
    }

    y += 16;
    r.text('PRESS P TO RESUME', cx, y, {
      size: 14, align: 'center',
      alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
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
      rows.push(['MISSION PAYMENT', `${res.mission} CR`,
        res.replay ? `${Math.round(res.payout * 100)}% OF ${res.gross}  (REPLAY x${res.completions})` : '']);
      rows.push(['HARDWARE RECOVERED', `${res.recovered} CR`,
        res.expended ? `${res.expended} STAGE${res.expended > 1 ? 'S' : ''} EXPENDED` : 'NOTHING EXPENDED']);
      rows.push(['TOTAL CREDITED', `${res.credits} CR`, `BUILD COST ${this.buildCost}`]);
    } else {
      rows.push(['HARDWARE RECOVERED', `${res.recovered} CR`,
        `${Math.round(res.salvageRate * 100)}% SALVAGED`]);
      rows.push(['IMPACT SEVERITY', severityLabel(res.severity),
        res.expended ? `${res.expended} STAGE${res.expended > 1 ? 'S' : ''} ALREADY EXPENDED` : '']);
    }

    const w = Math.min(520, r.w - 80);
    const x0 = cx - w / 2;
    // Values sit well left of the right edge: the notes beside them are long
    // ("100% OF 1147 (REPLAY x3)") and used to run into the figure.
    const vx = x0 + w * 0.58;
    for (const [label, value, note] of rows) {
      r.text(label, x0, y, { size: 12, alpha: 0.55 });
      r.text(value, vx, y, { size: 13, align: 'right' });
      if (note) r.text(note, x0 + w, y, { size: 11, align: 'right', alpha: 0.4 });
      y += 21;
    }

    // Bonuses, earned and missed. A miss is worth as much screen space as an
    // award: it is the only place the game says how close you came.
    if (good && res.bonuses && res.bonuses.length) {
      y += 8;
      r.text(`OBJECTIVE BONUSES   ${res.bonusTotal} CR`, x0, y,
        { size: 11, alpha: 0.55 });
      y += 18;
      for (const b of res.bonuses) {
        const col = b.earned ? COLORS.good : COLORS.ui;
        r.text(`${b.earned ? '[x]' : '[ ]'} ${b.label}`, x0, y,
          { size: 12, color: col, alpha: b.earned ? 0.9 : 0.35 });
        r.text(b.earned ? `+${b.value} CR` : '—', vx, y,
          { size: 12, align: 'right', color: col, alpha: b.earned ? 0.9 : 0.35 });
        r.text(b.detail, x0 + w, y,
          { size: 11, align: 'right', alpha: b.earned ? 0.4 : 0.55, color: b.earned ? COLORS.ui : COLORS.warn });
        y += 19;
      }
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
    r.text('ENTER  BACK TO THE HANGAR        R  RESTART THE CAMPAIGN', cx, y, {
      size: 14, align: 'center',
      alpha: 0.55 + 0.45 * Math.abs(Math.sin(this.time * 2)),
    });
  }
}

function severityLabel(sev) {
  if (sev <= 0.001) return 'INTACT';
  if (sev < 0.2) return 'LIGHT DAMAGE';
  if (sev < 0.5) return 'HEAVY DAMAGE';
  if (sev < 0.85) return 'WRECKED';
  return 'TOTAL LOSS';
}

function ratingFor(q) {
  if (q > 0.88) return 'TEXTBOOK';
  if (q > 0.7) return 'CLEAN';
  if (q > 0.45) return 'SOLID';
  return 'ROUGH BUT INTACT';
}
