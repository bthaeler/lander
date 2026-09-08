// The flying vehicle: a multi-stage rocket in a body-centred inertial frame.
//
// Attitude is stored in the inertial frame (`angle` is CCW from +x and is the
// direction the nose points, so thrust is along (cos a, sin a)). "Angle from
// vertical" is derived, never stored — storing it relative to local up would
// silently torque the ship as it orbits.

import { GIMBAL_LENGTH_FACTOR, TANK_DRY_FRACTION, STAGE_STRUCTURE } from './config.js';
import { engineById } from './config.js';
import { stageGeometry, footSpanFor, inertiaFor } from './design.js';
import { clamp, wrapAngle, rotate } from './util.js';

const CAPSULE_LENGTH = 2.6;
const DRAG_CD = 0.85;

export class Ship {
  constructor(design, payloadMass, spawn) {
    this.design = design;
    this.payloadMass = payloadMass;

    // Live copies: fuel drains, stages get discarded.
    this.stages = design.stages.map((s) => {
      const engine = engineById(s.engineId);
      const geom = stageGeometry(s);
      return {
        engine,
        engineCount: s.engineCount,
        capacity: s.fuel,
        fuel: s.fuel,
        tankDry: s.fuel * TANK_DRY_FRACTION,
        engineMass: engine.mass * s.engineCount,
        structure: STAGE_STRUCTURE,
        length: geom.length,
        radius: geom.radius,
      };
    });
    this.activeStage = 0;

    this.x = spawn.x;
    this.y = spawn.y;
    this.vx = spawn.vx || 0;
    this.vy = spawn.vy || 0;
    this.angle = spawn.angle;       // inertial, CCW from +x
    this.omega = 0;
    this.spool = 0;
    this.throttle = 0;

    this.rcsTorque = spawn.rcsTorque || 0;
    this.sampleMass = 0;
    this.landed = false;
    this.elapsed = 0;

    this.rebuildGeometry();
  }

  // --- mass and geometry -----------------------------------------------------

  get remainingStages() { return this.stages.slice(this.activeStage); }

  get stage() { return this.stages[this.activeStage] || null; }

  get mass() {
    let m = this.payloadMass + this.sampleMass;
    for (let i = this.activeStage; i < this.stages.length; i++) {
      const s = this.stages[i];
      m += s.engineMass + s.tankDry + s.structure + s.fuel;
    }
    return m;
  }

  get fuel() { return this.stage ? this.stage.fuel : 0; }
  get fuelCapacity() { return this.stage ? this.stage.capacity : 1; }

  get totalFuel() {
    let f = 0;
    for (let i = this.activeStage; i < this.stages.length; i++) f += this.stages[i].fuel;
    return f;
  }

  get maxThrust() {
    return this.stage ? this.stage.engine.thrust * this.stage.engineCount : 0;
  }

  get thrust() { return this.spool * this.maxThrust; }

  get speed() { return Math.hypot(this.vx, this.vy); }

  get radiusFromCentre() { return Math.hypot(this.x, this.y); }

  /** Angle of local "up" (the outward radial direction). */
  get upAngle() { return Math.atan2(this.y, this.x); }

  /** Tilt from local vertical, radians. Positive = nose clockwise (right). */
  get tilt() { return wrapAngle(this.upAngle - this.angle); }

  /**
   * Rotational inertia about the pitch axis.
   *
   * A thin-rod model (m * L^2 / 12) badly under-estimates a short, wide
   * lander: splayed gear, footpads and tankage put a lot of mass off-axis.
   * Using the full width as well -- the cylinder form -- adds ~55% inertia to
   * a 4 m lander and almost nothing to a 52 m launcher, which is exactly the
   * right place for the correction to land.
   */
  get inertia() {
    return inertiaFor(this.mass, this.length, this.maxRadius);
  }

  /** Rebuild the local silhouette after staging. */
  rebuildGeometry() {
    const stages = this.remainingStages;
    const stackLength = stages.reduce((a, s) => a + s.length, 0);
    const length = CAPSULE_LENGTH + stackLength;
    const maxRadius = stages.reduce((a, s) => Math.max(a, s.radius), 0.9);

    this.length = length;
    this.maxRadius = maxRadius;
    this.dragArea = Math.PI * maxRadius * maxRadius;

    const top = length / 2;
    const bottom = -length / 2;
    this.nose = top;
    this.bottom = bottom;

    // Stage bands, top-down, for drawing.
    this.bands = [];
    let y = top - CAPSULE_LENGTH;
    this.capsule = { top, bottom: y, radius: Math.min(0.9, maxRadius) };
    for (const s of stages) {
      this.bands.push({ top: y, bottom: y - s.length, radius: s.radius, stage: s });
      y -= s.length;
    }

    // Legs and footpads live at the base of whatever is still attached.
    this.footSpan = footSpanFor(maxRadius);
    this.legRoot = bottom + Math.min(2.2, length * 0.18);
    this.nozzle = bottom;
  }

  /** Local (nose-up) point -> world. */
  toWorld(p) {
    const r = rotate(p.x, p.y, this.angle - Math.PI / 2);
    return { x: this.x + r.x, y: this.y + r.y };
  }

  footPoints() {
    return [
      this.toWorld({ x: -this.footSpan, y: this.bottom }),
      this.toWorld({ x: this.footSpan, y: this.bottom }),
    ];
  }

  /** Points that must never touch the ground. */
  hullPoints() {
    const r = this.maxRadius;
    return [
      this.toWorld({ x: 0, y: this.nose }),
      this.toWorld({ x: -r, y: this.bottom + 0.6 }),
      this.toWorld({ x: r, y: this.bottom + 0.6 }),
    ];
  }

  /** Lowest clearance of any contact point above the surface. */
  clearance(body) {
    let low = Infinity;
    for (const p of [...this.footPoints(), ...this.hullPoints()]) {
      low = Math.min(low, body.altitudeAt(p.x, p.y));
    }
    return low;
  }

  get altitude() {
    return this.bodyRef ? this.bodyRef.altitudeAt(this.x, this.y) : 0;
  }

  // --- staging ---------------------------------------------------------------

  canStage() { return this.activeStage < this.stages.length - 1; }

  jettison() {
    if (!this.canStage()) return false;
    this.activeStage += 1;
    this.spool = 0;
    this.rebuildGeometry();
    return true;
  }

  /** True when the active stage is dry but there is another below it. */
  get needsStaging() {
    return this.stage && this.stage.fuel <= 0 && this.canStage();
  }

  // --- integration -----------------------------------------------------------

  /**
   * One physics substep.
   * @param cmd {{rotate:number, throttle:number}} rotate: +1 = nose right
   *   (clockwise on screen), which is negative in the CCW inertial frame.
   */
  step(dt, body, cmd) {
    this.bodyRef = body;
    const mass = this.mass;
    const altitude = body.altitudeAt(this.x, this.y);

    // --- engine spool and propellant
    const stage = this.stage;
    const hasFuel = stage && stage.fuel > 0;
    const commanded = hasFuel ? clamp(cmd.throttle, 0, 1) : 0;
    const spoolTime = stage ? stage.engine.spoolTime : 0.2;
    const rate = dt / Math.max(spoolTime, 1e-4);
    this.spool = clamp(this.spool + clamp(commanded - this.spool, -rate * 2, rate), 0, 1);

    let thrust = this.spool * this.maxThrust;
    if (thrust > 0 && stage) {
      // Efficiency falls with ambient pressure; thrust is treated as constant.
      const press = body.pressureFraction(altitude);
      const ve = stage.engine.veVac + (stage.engine.veSea - stage.engine.veVac) * press;
      const wanted = (thrust / ve) * dt;
      const burned = Math.min(wanted, stage.fuel);
      if (burned < wanted) thrust *= burned / wanted;
      stage.fuel = Math.max(0, stage.fuel - burned);
      this.currentVe = ve;
    }
    this.currentThrust = thrust;

    // --- attitude. Torque comes from RCS plus engine gimbal; a large stack
    // cannot be turned by RCS alone.
    const inertia = this.inertia;
    const gimbalTorque = thrust * (stage ? stage.engine.gimbal : 0)
      * this.length * GIMBAL_LENGTH_FACTOR;
    const torque = (this.rcsTorque + gimbalTorque) * clamp(cmd.rotate, -1, 1);
    this.omega += (-torque / inertia) * dt;   // +cmd.rotate = clockwise = -CCW
    this.angle = wrapAngle(this.angle + this.omega * dt);

    // --- forces
    const g = body.gravityAt(this.x, this.y);
    let ax = g.ax;
    let ay = g.ay;

    ax += (thrust * Math.cos(this.angle)) / mass;
    ay += (thrust * Math.sin(this.angle)) / mass;

    const rho = body.density(altitude);
    if (rho > 0) {
      const v = Math.hypot(this.vx, this.vy);
      if (v > 0.01) {
        const drag = 0.5 * rho * v * v * DRAG_CD * this.dragArea;
        ax -= (drag * this.vx) / (v * mass);
        ay -= (drag * this.vy) / (v * mass);
      }
    }
    this.lastDrag = rho;

    if (this.landed) {
      // Sitting on the surface: the ground supplies whatever normal force is
      // needed until thrust along local up exceeds weight.
      const weight = mass * (body.mu / (this.x * this.x + this.y * this.y));
      const up = this.upAngle;
      const along = thrust * Math.cos(wrapAngle(this.angle - up));
      if (along > weight) {
        this.landed = false;
      } else {
        this.vx = 0;
        this.vy = 0;
        this.omega *= 0.6;   // resting on gear, not free to spin up
        this.elapsed += dt;
        return;
      }
    }

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.elapsed += dt;
  }

  /** Set the ship down exactly on the surface and stop it. */
  settle(body) {
    const feet = this.footPoints();
    const drop = Math.min(...feet.map((p) => body.altitudeAt(p.x, p.y)));
    const r = this.radiusFromCentre;
    if (r > 0) {
      const k = (r - drop) / r;
      this.x *= k;
      this.y *= k;
    }
    this.vx = 0;
    this.vy = 0;
    this.omega = 0;
    this.spool = 0;
    this.landed = true;
  }
}
