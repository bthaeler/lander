// A celestial body: a circle of radius `radius` with terrain expressed as a
// function of angle rather than a stored heightfield.
//
// Storing a heightfield at metre resolution for something 10,900 km around is
// not possible, so terrain is procedural: a sum of octaves of value noise that
// is periodic in theta (each octave hashes integer indices around a ring, so
// it wraps exactly). Landing pads are carved by special-casing their angular
// span to a constant radius with a short blend at the shoulders.

import { hash1, smoothstep, wrapTwoPi, wrapAngle, clamp } from './util.js';

/** Value noise around a ring of `n` samples. Periodic in theta by construction. */
function ringNoise(theta, n, seed) {
  const t = (wrapTwoPi(theta) / (Math.PI * 2)) * n;
  const i = Math.floor(t);
  const f = smoothstep(t - i);
  const a = hash1(i % n, seed);
  const b = hash1((i + 1) % n, seed);
  return a + (b - a) * f;
}

export class Body {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.radius = def.radius;
    this.mu = def.mu;
    this.color = def.color;
    this.atmosphere = def.atmosphere || null;
    this.seed = def.seed ?? 1;
    this.terrain = def.terrain;

    // Pads sit on the natural terrain height at their centre, so they never
    // float above or sink into the surrounding ground.
    this.pads = (def.pads || []).map((p) => {
      const halfAngle = p.width / 2 / def.radius;
      return {
        ...p,
        halfAngle,
        // Blend shoulders over the pad's own width, but at least 40 m of arc.
        blendAngle: Math.max(halfAngle * 0.8, 40 / def.radius),
        r: this.baseRadius(p.theta),
      };
    });
  }

  /** Terrain elevation above the mean radius, ignoring pads. */
  terrainHeight(theta) {
    const t = this.terrain;
    let h = 0;
    let amp = t.amplitude;
    let n = t.baseFreq;
    for (let o = 0; o < t.octaves; o++) {
      h += amp * ringNoise(theta, n, this.seed + o * 7919);
      amp *= t.decay;
      n *= 2;
    }
    return h;
  }

  /** Surface radius ignoring pads. Used when siting a pad. */
  baseRadius(theta) {
    return this.radius + this.terrainHeight(theta);
  }

  /** Surface radius including any landing pad flattening. */
  surfaceRadius(theta) {
    for (const pad of this.pads) {
      const d = Math.abs(wrapAngle(theta - pad.theta));
      if (d <= pad.halfAngle) return pad.r;
      if (d <= pad.halfAngle + pad.blendAngle) {
        const t = smoothstep((d - pad.halfAngle) / pad.blendAngle);
        return pad.r + (this.baseRadius(theta) - pad.r) * t;
      }
    }
    return this.baseRadius(theta);
  }

  /** Altitude of a world point above the local surface. */
  altitudeAt(x, y) {
    return Math.hypot(x, y) - this.surfaceRadius(Math.atan2(y, x));
  }

  /** Local surface slope in radians (positive = rising with increasing theta). */
  slopeAt(theta) {
    // Sample over ~8 m of arc so the slope reflects what a footpad spans.
    const d = 8 / this.radius;
    const a = this.surfaceRadius(theta - d);
    const b = this.surfaceRadius(theta + d);
    return Math.atan2(b - a, 2 * d * this.radius);
  }

  gravityAt(x, y) {
    const r2 = x * x + y * y;
    const r = Math.sqrt(r2);
    const k = -this.mu / (r2 * r);
    return { ax: k * x, ay: k * y };
  }

  surfaceGravity() { return this.mu / (this.radius * this.radius); }

  escapeSpeed(r) { return Math.sqrt((2 * this.mu) / r); }

  circularSpeed(r) { return Math.sqrt(this.mu / r); }

  /** Exponential atmosphere. Returns 0 for airless bodies and above the top. */
  density(altitude) {
    const a = this.atmosphere;
    if (!a) return 0;
    if (altitude >= a.height) return 0;
    return a.density0 * Math.exp(-Math.max(0, altitude) / a.scaleHeight);
  }

  get atmosphereHeight() { return this.atmosphere ? this.atmosphere.height : 0; }

  /** Ambient pressure as a 0..1 fraction of sea level, for engine performance. */
  pressureFraction(altitude) {
    const a = this.atmosphere;
    if (!a) return 0;
    return clamp(Math.exp(-Math.max(0, altitude) / a.scaleHeight), 0, 1);
  }

  padByName(name) { return this.pads.find((p) => p.name === name) || null; }

  /** The pad containing this angle, or null. */
  padAt(theta) {
    for (const pad of this.pads) {
      if (Math.abs(wrapAngle(theta - pad.theta)) <= pad.halfAngle) return pad;
    }
    return null;
  }

  nearestPad(theta) {
    let best = null, bestD = Infinity;
    for (const pad of this.pads) {
      const d = Math.abs(wrapAngle(theta - pad.theta));
      if (d < bestD) { bestD = d; best = pad; }
    }
    return best;
  }

  /** Ground distance along the surface between two angles, in metres. */
  arcDistance(theta1, theta2) {
    return Math.abs(wrapAngle(theta2 - theta1)) * this.radius;
  }
}
