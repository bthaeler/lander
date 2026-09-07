import { INERTIA_FACTOR } from './config.js';
import { clamp, rotate } from './util.js';

// Ship geometry in local metres. +y is "up" through the nose, +x is right.
// The craft is roughly 8 m across, comparable to an Apollo LM.
export const GEOMETRY = {
  body: [
    { x: 0, y: 4.0 },     // nose
    { x: -3.7, y: -1.8 }, // lower left
    { x: 3.7, y: -1.8 },  // lower right
  ],
  legs: [
    [{ x: -2.7, y: -1.6 }, { x: -4.4, y: -4.2 }],
    [{ x: 2.7, y: -1.6 }, { x: 4.4, y: -4.2 }],
  ],
  // Footpads: the only points allowed to touch the ground.
  feet: [{ x: -4.4, y: -4.2 }, { x: 4.4, y: -4.2 }],
  // Skids across the bottom of each footpad, purely cosmetic.
  padWidth: 1.1,
  nozzle: { x: 0, y: -2.0 },
};

export class Ship {
  constructor(stats, spawn) {
    this.stats = stats;
    this.x = spawn.x;
    this.y = spawn.y;
    this.vx = spawn.vx || 0;
    this.vy = spawn.vy || 0;
    this.angle = spawn.angle || 0;  // radians, clockwise from vertical
    this.omega = 0;                 // rad/s
    this.fuel = stats.fuelCapacity;
    this.spool = 0;                 // actual engine output, 0..1
    this.elapsed = 0;
  }

  get mass() { return this.stats.dryMass + this.fuel; }
  get thrust() { return this.spool * this.stats.maxThrust; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get outOfFuel() { return this.fuel <= 0; }

  /**
   * One physics substep. `cmd.rotate` is -1..1 (right positive) and
   * `cmd.throttle` is 0..1. Integration is semi-implicit Euler, which is
   * stable and energy-honest at 120 Hz.
   */
  step(dt, gravity, cmd) {
    const mass = this.mass;

    // --- attitude: pure torque, no artificial damping. Momentum is real, so
    // every rotation you start you must also stop.
    const inertia = mass * INERTIA_FACTOR;
    this.omega += (cmd.rotate * this.stats.torque / inertia) * dt;
    this.angle += this.omega * dt;

    // --- engine: spools toward the commanded throttle rather than snapping,
    // and spools down roughly twice as fast as it spools up.
    const commanded = this.outOfFuel ? 0 : clamp(cmd.throttle, 0, 1);
    const rate = dt / Math.max(this.stats.spoolTime, 1e-4);
    this.spool = clamp(this.spool + clamp(commanded - this.spool, -rate * 2, rate), 0, 1);

    let thrust = this.spool * this.stats.maxThrust;
    if (thrust > 0) {
      const wanted = (thrust / this.stats.exhaustVelocity) * dt;
      const burned = Math.min(wanted, this.fuel);
      if (burned < wanted) thrust *= burned / wanted;   // ran the tank dry mid-step
      this.fuel = Math.max(0, this.fuel - burned);
    }

    // --- translation. Thrust acts along the ship's own +y axis.
    const dir = rotate(0, 1, this.angle);
    const ax = (thrust * dir.x) / mass;
    const ay = (thrust * dir.y) / mass - gravity;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.elapsed += dt;
  }

  /** Transform a local geometry point into world space. */
  toWorld(p) {
    const r = rotate(p.x, p.y, this.angle);
    return { x: this.x + r.x, y: this.y + r.y };
  }

  footPoints() { return GEOMETRY.feet.map((p) => this.toWorld(p)); }
  bodyPoints() { return GEOMETRY.body.map((p) => this.toWorld(p)); }

  /** Height of the lowest part of the ship above the given terrain. */
  clearance(terrain) {
    let lowest = Infinity;
    for (const p of [...this.footPoints(), ...this.bodyPoints()]) {
      lowest = Math.min(lowest, p.y - terrain.heightAt(p.x));
    }
    return lowest;
  }
}
