// Two-body orbital mechanics in 2D, in a body-centred inertial frame.
//
// The ship coasts along a conic section. Rather than integrating that
// numerically (which falls apart at high time warp), we solve it analytically:
// state vector -> orbital elements -> advance the anomaly by dt -> state
// vector. Exact at any warp factor, and the same elements drive the orbit
// display, so apoapsis/periapsis markers are free.
//
// Sign convention: `h` (specific angular momentum) is negative for a
// clockwise/retrograde orbit. True anomaly is always measured in the direction
// of motion, so nu = sgn * (theta - argP) and theta = argP + sgn * nu.

import { wrapAngle, wrapTwoPi } from './util.js';

const NEAR_PARABOLIC = 1e-6;

/**
 * Conic elements from a state vector.
 * @returns {{a:number,e:number,argP:number,h:number,sgn:number,p:number,
 *   periapsis:number,apoapsis:number,period:number,nu:number,r:number,
 *   speed:number,energy:number,mu:number,closed:boolean}}
 */
export function elementsFromState(rx, ry, vx, vy, mu) {
  const r = Math.hypot(rx, ry);
  const v2 = vx * vx + vy * vy;
  const h = rx * vy - ry * vx;
  const sgn = h < 0 ? -1 : 1;
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);

  // Eccentricity vector points at periapsis.
  const rv = rx * vx + ry * vy;
  const k = v2 - mu / r;
  const ex = (k * rx - rv * vx) / mu;
  const ey = (k * ry - rv * vy) / mu;
  const e = Math.hypot(ex, ey);

  // For a perfectly circular orbit the eccentricity vector has no direction;
  // anchor periapsis at the current position so nu comes out as 0.
  const argP = e > 1e-12 ? Math.atan2(ey, ex) : Math.atan2(ry, rx);
  const p = (h * h) / mu;
  const theta = Math.atan2(ry, rx);
  const nu = wrapAngle(sgn * (theta - argP));

  const closed = e < 1 - NEAR_PARABOLIC;
  return {
    a, e, argP, h, sgn, p, mu, nu, r, energy, closed,
    speed: Math.sqrt(v2),
    periapsis: p / (1 + e),
    apoapsis: closed ? p / (1 - e) : Infinity,
    period: closed ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity,
  };
}

/** Mean motion, rad/s. Valid for both ellipse and hyperbola. */
export function meanMotion(el) {
  const absA = Math.abs(el.a);
  return Math.sqrt(el.mu / (absA * absA * absA));
}

// --- anomaly conversions ----------------------------------------------------

function eccentricFromTrue(e, nu) {
  return 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2),
    Math.sqrt(1 + e) * Math.cos(nu / 2));
}

function trueFromEccentric(e, E) {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2));
}

function hyperbolicFromTrue(e, nu) {
  // Only defined inside the asymptote limit; clamp rather than return NaN.
  let t = Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2);
  t = Math.max(-1 + 1e-14, Math.min(1 - 1e-14, t));
  return 2 * Math.atanh(t);
}

function trueFromHyperbolic(e, H) {
  return 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2),
    Math.sqrt(e - 1) * Math.cosh(H / 2));
}

/** Mean anomaly from true anomaly, for either conic. */
export function meanFromTrue(el, nu) {
  if (el.closed) {
    const E = eccentricFromTrue(el.e, nu);
    return E - el.e * Math.sin(E);
  }
  const H = hyperbolicFromTrue(el.e, nu);
  return el.e * Math.sinh(H) - H;
}

// --- Kepler's equation ------------------------------------------------------

function solveElliptic(M, e) {
  M = wrapAngle(M);
  let E = e < 0.8 ? M + e * Math.sin(M) : (M < 0 ? -Math.PI / 2 : Math.PI / 2);
  for (let i = 0; i < 80; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    // Damped Newton: an undamped step can overshoot badly at high e.
    let step = f / (Math.abs(fp) < 1e-12 ? 1e-12 : fp);
    if (step > 1) step = 1; else if (step < -1) step = -1;
    E -= step;
    if (Math.abs(f) < 1e-13) break;
  }
  return E;
}

function solveHyperbolic(M, e) {
  let H = Math.asinh(M / e);
  if (!isFinite(H)) H = M > 0 ? 1 : -1;
  for (let i = 0; i < 120; i++) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    let step = f / (Math.abs(fp) < 1e-12 ? 1e-12 : fp);
    if (step > 1) step = 1; else if (step < -1) step = -1;
    H -= step;
    if (Math.abs(f) < 1e-12) break;
  }
  return H;
}

// --- state <-> orbit --------------------------------------------------------

/** Position and velocity at a given true anomaly on the conic. */
export function stateAtTrueAnomaly(el, nu) {
  const { e, p, mu, sgn, argP } = el;
  const denom = 1 + e * Math.cos(nu);
  const r = p / denom;
  const theta = argP + sgn * nu;
  const ct = Math.cos(theta), st = Math.sin(theta);

  const hAbs = Math.abs(el.h);
  const vr = (mu / hAbs) * e * Math.sin(nu);
  const vt = hAbs / r;

  return {
    x: r * ct,
    y: r * st,
    vx: vr * ct + vt * sgn * -st,
    vy: vr * st + vt * sgn * ct,
    r,
    theta,
  };
}

/**
 * Advance a state vector along its conic by `dt` seconds.
 * Returns null for near-parabolic orbits, where the closed-form solution is
 * numerically unreliable; the caller should integrate instead.
 */
export function propagate(rx, ry, vx, vy, mu, dt) {
  const el = elementsFromState(rx, ry, vx, vy, mu);
  if (Math.abs(1 - el.e) < NEAR_PARABOLIC) return null;

  const n = meanMotion(el);
  let nu2;
  if (el.closed) {
    const E = eccentricFromTrue(el.e, el.nu);
    const M = E - el.e * Math.sin(E) + n * dt;
    nu2 = trueFromEccentric(el.e, solveElliptic(M, el.e));
  } else {
    const H = hyperbolicFromTrue(el.e, el.nu);
    const M = el.e * Math.sinh(H) - H + n * dt;
    nu2 = trueFromHyperbolic(el.e, solveHyperbolic(M, el.e));
  }

  const s = stateAtTrueAnomaly(el, nu2);
  return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, elements: el };
}

/**
 * Seconds until the ship next reaches `targetNu`.
 * On a closed orbit this is always in [0, period). On a hyperbola it is
 * signed — negative means the point is already behind you.
 */
export function timeToTrueAnomaly(el, targetNu) {
  const n = meanMotion(el);
  const M0 = meanFromTrue(el, el.nu);
  const M1 = meanFromTrue(el, targetNu);
  if (el.closed) return wrapTwoPi(M1 - M0) / n;
  return (M1 - M0) / n;
}

export function timeToPeriapsis(el) { return timeToTrueAnomaly(el, 0); }

export function timeToApoapsis(el) {
  return el.closed ? timeToTrueAnomaly(el, Math.PI) : Infinity;
}

/**
 * True anomaly at which the orbit crosses a given radius, or null if it never
 * does. Returns the descending crossing (approaching the body), which is what
 * an impact or atmospheric-entry prediction needs.
 */
export function trueAnomalyAtRadius(el, r) {
  const cosNu = (el.p / r - 1) / el.e;
  if (!isFinite(cosNu) || cosNu < -1 || cosNu > 1) return null;
  return -Math.acos(cosNu);   // negative branch = inbound
}

/** Sampled points along the conic, for drawing. */
export function conicPoints(el, count = 256) {
  const pts = [];
  if (el.closed) {
    for (let i = 0; i <= count; i++) {
      const nu = (i / count) * Math.PI * 2;
      pts.push(stateAtTrueAnomaly(el, nu));
    }
  } else {
    // Stop short of the asymptotes, which run to infinity.
    const nuMax = Math.acos(-1 / el.e) * 0.985;
    for (let i = 0; i <= count; i++) {
      const nu = -nuMax + (i / count) * 2 * nuMax;
      pts.push(stateAtTrueAnomaly(el, nu));
    }
  }
  return pts;
}

/** Circular orbital speed at radius r. */
export function circularSpeed(mu, r) { return Math.sqrt(mu / r); }

/** Speed needed at r1 to raise the far side of the orbit to r2. */
export function transferSpeed(mu, r1, r2) {
  return Math.sqrt(mu * (2 / r1 - 2 / (r1 + r2)));
}
