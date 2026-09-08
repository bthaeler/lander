// Mission objectives, evaluated in order.
//
// The important property: a successful landing does NOT end the flight when
// objectives remain. The ship rests on the surface and can launch again, which
// is what makes "land, collect a sample, return to orbit" expressible.

import { SAMPLE_MASS } from './config.js';
import { fmtDistance } from './util.js';

function labelFor(def, body) {
  switch (def.type) {
    case 'altitude':
      return `REACH ${fmtDistance(def.min)} ALTITUDE`;
    case 'orbit':
      return `ACHIEVE ORBIT — PERIAPSIS ABOVE ${fmtDistance(def.minPeriapsis)}`;
    case 'land': {
      if (!def.pad) return 'LAND SAFELY';
      const pad = body.padByName(def.pad);
      return `LAND ON ${pad ? pad.label : def.pad.toUpperCase()}`;
    }
    case 'sample':
      return `COLLECT SAMPLE (${SAMPLE_MASS} KG)`;
    default:
      return def.type.toUpperCase();
  }
}

export class Mission {
  constructor(level, body) {
    this.level = level;
    this.body = body;
    this.objectives = level.objectives.map((def, i) => ({
      ...def,
      index: i,
      done: false,
      label: labelFor(def, body),
    }));
    this.activeIndex = 0;
  }

  get active() { return this.objectives[this.activeIndex] || null; }

  get complete() { return this.activeIndex >= this.objectives.length; }

  /** The landing envelope this mission's current objective demands. */
  get landingPad() {
    const a = this.active;
    return a && a.type === 'land' ? a.pad : null;
  }

  /** True if the ship is expected to touch down at some point from here. */
  get expectsLanding() {
    return this.objectives.slice(this.activeIndex).some((o) => o.type === 'land');
  }

  /**
   * Advance the objective chain.
   * @param ctx {{altitude:number, elements:object, landed:boolean,
   *   landedPad:object|null, radius:number}}
   * @returns {Array<{type:string}>} events for the caller to act on
   */
  evaluate(ctx) {
    const events = [];
    // Several objectives can complete in one frame (land then sample).
    for (let guard = 0; guard < 8; guard++) {
      const o = this.active;
      if (!o || o.done) break;
      if (!this.satisfied(o, ctx)) break;
      o.done = true;
      this.activeIndex += 1;
      events.push({ type: o.type, objective: o });
    }
    return events;
  }

  satisfied(o, ctx) {
    switch (o.type) {
      case 'altitude':
        return ctx.altitude >= o.min;

      case 'orbit': {
        const el = ctx.elements;
        if (!el || !el.closed) return false;
        // Periapsis measured against the mean radius, and the ship has to
        // actually be off the ground.
        return (el.periapsis - this.body.radius) >= o.minPeriapsis && !ctx.landed;
      }

      case 'land': {
        if (!ctx.landed) return false;
        if (!o.pad) return true;
        return !!ctx.landedPad && ctx.landedPad.name === o.pad;
      }

      case 'sample':
        return ctx.landed;

      default:
        return false;
    }
  }

  /** Compact progress string for the HUD. */
  get progress() {
    const done = this.objectives.filter((o) => o.done).length;
    return `${done}/${this.objectives.length}`;
  }
}
