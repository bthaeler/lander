export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Normalise an angle in radians to (-PI, PI]. */
export function wrapAngle(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Normalise an angle to [0, 2PI). */
export function wrapTwoPi(a) {
  a = a % (Math.PI * 2);
  return a < 0 ? a + Math.PI * 2 : a;
}

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

/**
 * Rotate a vector counter-clockwise by `angle` radians.
 * Note this is CCW, matching the inertial-frame convention used throughout
 * the physics; the pre-orbital build rotated clockwise.
 */
export function rotate(x, y, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Small deterministic PRNG so terrain and starfields are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash -> [-1, 1). Used by the procedural terrain. */
export function hash1(i, seed) {
  let h = Math.imul(i ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 2147483648) - 1;
}

// --- formatting -------------------------------------------------------------

/** Fixed-width number for the monospace HUD. */
export function fmt(value, decimals, width) {
  let s = value.toFixed(decimals);
  if (parseFloat(s) === 0) s = s.replace('-', '');   // never show "-0"
  if (width) while (s.length < width) s = ' ' + s;
  return s;
}

/** Distances span metres to millions of kilometres, so pick a unit. */
export function fmtDistance(m) {
  const a = Math.abs(m);
  if (!isFinite(m)) return '---';
  if (a < 1000) return `${m.toFixed(a < 100 ? 1 : 0)} M`;
  if (a < 1e6) return `${(m / 1e3).toFixed(a < 1e5 ? 2 : 1)} KM`;
  return `${(m / 1e6).toFixed(2)} MM`;
}

export function fmtSpeed(v) {
  const a = Math.abs(v);
  if (a < 1000) return `${v.toFixed(a < 100 ? 1 : 0)} M/S`;
  return `${(v / 1000).toFixed(3)} KM/S`;
}

export function fmtMass(kg) {
  if (Math.abs(kg) < 1000) return `${kg.toFixed(0)} KG`;
  return `${(kg / 1000).toFixed(kg < 1e4 ? 2 : 1)} T`;
}

/** Seconds -> compact clock, e.g. "2D 04:11:07" or "7:12". */
export function fmtTime(s) {
  if (!isFinite(s)) return '--:--';
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const body = d > 0 ? `${d}D ${pad(h)}:${pad(m)}:${pad(sec)}`
    : h > 0 ? `${h}:${pad(m)}:${pad(sec)}`
      : `${m}:${pad(sec)}`;
  return (neg ? '-' : '') + body;
}

export function fmtHours(s) {
  const h = s / 3600;
  return `${h.toFixed(h < 10 ? 2 : 1)} H`;
}
