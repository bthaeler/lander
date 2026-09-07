export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Normalise an angle in radians to (-PI, PI]. */
export function wrapAngle(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

export const DEG = 180 / Math.PI;

/** Rotate a local point clockwise by `angle` (radians) into world axes. */
export function rotate(lx, ly, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: lx * c + ly * s, y: -lx * s + ly * c };
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

/** Fixed-width number for the monospace HUD, e.g. fmt(3.14, 1, 5) -> "  3.1". */
export function fmt(value, decimals, width) {
  let s = value.toFixed(decimals);
  if (parseFloat(s) === 0) s = s.replace('-', '');   // never show "-0"
  if (width) while (s.length < width) s = ' ' + s;
  return s;
}
