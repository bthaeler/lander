// All tuning lives here. Physical quantities are SI: metres, kilograms,
// seconds, newtons. Body constants are the real ones.

export const FIXED_DT = 1 / 120;   // physics substep while powered, seconds

// Structural mass of a tank as a fraction of the propellant it holds. This is
// what makes single-stage-to-Earth-orbit impossible and staging necessary --
// it is a load-bearing constraint, not a knob to soften.
export const TANK_DRY_FRACTION = 0.085;

// Fixed plumbing/interstage mass per stage.
export const STAGE_STRUCTURE = 60;

// Engine gimbal: steering torque = thrust * gimbalFraction * (length/2).
// RCS alone cannot turn a large launcher; gimbal is what makes it steerable.
export const GIMBAL_LENGTH_FACTOR = 0.5;

export const WARP_LEVELS = [1, 2, 5, 10, 25, 100, 1000, 10000, 100000];
export const WARP_MAX_POWERED = 2;      // index into WARP_LEVELS while thrusting
export const WARP_MAX_ATMOSPHERE = 3;   // index while inside an atmosphere
export const WARP_MAX_LOW = 4;          // index while below LOW_ALTITUDE_FRACTION
export const LOW_ALTITUDE_FRACTION = 0.004;  // of body radius

// --- palette ----------------------------------------------------------------
// Still line art, but colour carries meaning: cyan is your trajectory, blue
// and orange are apoapsis and periapsis, amber warns, red kills.
export const COLORS = {
  ui: '#e6f0ff',
  uiDim: 'rgba(230,240,255,0.45)',
  uiFaint: 'rgba(230,240,255,0.22)',
  accent: '#6fe3ff',
  orbit: '#6fe3ff',
  orbitFaint: 'rgba(111,227,255,0.35)',
  apoapsis: '#84b4ff',
  periapsis: '#ffb154',
  prograde: '#b9ff70',
  warn: '#ffcb52',
  danger: '#ff6a58',
  good: '#7dffab',
  ship: '#ffffff',
  flame: '#ffa940',
  flameCore: '#fff3cc',
  star: '#ffffff',
  pad: '#7dffab',
};

// --- bodies -----------------------------------------------------------------
export const BODIES = {
  luna: {
    name: 'LUNA',
    radius: 1737400,
    mu: 4.9048695e12,
    color: '#c8d2de',
    seed: 20250907,
    terrain: { amplitude: 2600, octaves: 12, baseFreq: 48, decay: 0.55 },
    atmosphere: null,
    pads: [
      { name: 'alpha', label: 'PAD ALPHA', theta: 0, width: 140, mult: 1.0 },
      { name: 'beta', label: 'PAD BETA', theta: 12000 / 1737400, width: 100, mult: 1.3 },
      { name: 'crater', label: 'CRATER SITE', theta: 0.42, width: 80, mult: 1.6 },
    ],
  },
  earth: {
    name: 'EARTH',
    radius: 6371000,
    mu: 3.986004418e14,
    color: '#6fb4e8',
    seed: 19690720,
    terrain: { amplitude: 3400, octaves: 12, baseFreq: 60, decay: 0.55 },
    atmosphere: { height: 120000, density0: 1.225, scaleHeight: 8500 },
    pads: [
      { name: 'cape', label: 'THE CAPE', theta: 0, width: 240, mult: 1.0 },
    ],
  },
  mars: {
    name: 'MARS',
    radius: 3389500,
    mu: 4.282837e13,
    color: '#e08a5c',
    seed: 18770818,
    terrain: { amplitude: 5200, octaves: 12, baseFreq: 52, decay: 0.55 },
    atmosphere: { height: 90000, density0: 0.020, scaleHeight: 11100 },
    pads: [
      { name: 'chryse', label: 'CHRYSE BASE', theta: 0, width: 180, mult: 1.0 },
      { name: 'valles', label: 'VALLES SITE', theta: 0.25, width: 120, mult: 1.5 },
    ],
  },
};

// --- parts ------------------------------------------------------------------
// Exhaust velocities are realistic (~3000 m/s). Thrust is treated as constant;
// only efficiency varies with ambient pressure, which is the dominant effect.
export const ENGINES = [
  {
    id: 'lm1', name: 'LM-1 TICK', thrust: 16e3, mass: 95,
    veVac: 3120, veSea: 2500, gimbal: 0.06, spoolTime: 0.20,
    cost: 300, unlock: 0,
    blurb: 'Small lander engine. Efficient, gentle, barely lifts anything big.',
  },
  {
    id: 'lm2', name: 'LM-2 BEETLE', thrust: 48e3, mass: 240,
    veVac: 3180, veSea: 2600, gimbal: 0.06, spoolTime: 0.18,
    cost: 800, unlock: 2,
    blurb: 'The workhorse lander engine.',
  },
  {
    id: 've1', name: 'VE-1 VESTA', thrust: 140e3, mass: 620,
    veVac: 3280, veSea: 2350, gimbal: 0.05, spoolTime: 0.16,
    cost: 2200, unlock: 4,
    blurb: 'Vacuum-optimised. Superb in space, wasteful in air.',
  },
  {
    id: 'bs1', name: 'BS-1 ANVIL', thrust: 780e3, mass: 2500,
    veVac: 3020, veSea: 2760, gimbal: 0.07, spoolTime: 0.14,
    cost: 6000, unlock: 8,
    blurb: 'First-stage booster. Built for sea level.',
  },
  {
    id: 'bs2', name: 'BS-2 TITAN', thrust: 2100e3, mass: 6200,
    veVac: 3060, veSea: 2800, gimbal: 0.07, spoolTime: 0.12,
    cost: 14000, unlock: 9,
    blurb: 'Heavy lift. Nothing reaches Earth orbit without one.',
  },
];

export function engineById(id) {
  return ENGINES.find((e) => e.id === id) || ENGINES[0];
}

export const CAPSULE = { name: 'C-1 POD', mass: 420, cost: 0 };

export const LIFE_SUPPORT = { name: 'LS CANISTER', mass: 22, hours: 2, cost: 90 };

export const RCS_TIERS = [
  { name: 'R-1 NUDGE', mass: 22, torque: 2.5e3, cost: 200 },
  { name: 'R-2 SWIVEL', mass: 40, torque: 6e3, cost: 700 },
  { name: 'R-3 PIVOT', mass: 75, torque: 1.8e4, cost: 2000 },
  { name: 'R-4 GYRO', mass: 140, torque: 6e4, cost: 5200 },
];

export const LEG_TIERS = [
  { name: 'G-1 STILTS', mass: 45, speedBonus: 0, angleBonus: 0, cost: 150 },
  { name: 'G-2 SPRUNG', mass: 75, speedBonus: 1.4, angleBonus: 3, cost: 600 },
  { name: 'G-3 DAMPED', mass: 120, speedBonus: 2.8, angleBonus: 6, cost: 1600 },
  { name: 'G-4 CRUSHABLE', mass: 190, speedBonus: 4.5, angleBonus: 10, cost: 3800 },
];

// Propellant is sized continuously per stage.
export const TANK = {
  min: 40,
  max: 600000,
  costPerKg: 1.1,
};

/** Adjustment step for a tank, scaled so editing stays usable at any size. */
export function tankStep(capacity, coarse = false) {
  const base = capacity < 500 ? 10
    : capacity < 5000 ? 100
      : capacity < 50000 ? 1000
        : 10000;
  return coarse ? base * 10 : base;
}

// Sample mass added to the ship when a sample objective completes.
export const SAMPLE_MASS = 240;

// --- landing rules ----------------------------------------------------------
export const MAX_TOUCHDOWN_SPIN = 0.55;      // rad/s
export const OFF_PAD_MULTIPLIER = 0.6;
export const OFF_PAD_TOLERANCE_SCALE = 0.8;
export const MAX_OFF_PAD_SLOPE_DEG = 12;

// --- campaign ---------------------------------------------------------------
// start.type:
//   'drop'    -- released above a pad at a given altitude
//   'surface' -- sitting on a pad, engines cold
//   'orbit'   -- circular orbit at a given altitude
//
// objectives run in order; a landing does not end the flight if more remain.
export const LEVELS = [
  {
    id: 1, title: 'FIRST LIGHT', body: 'luna', graphicsTier: 1,
    brief: 'A tethered drop over Pad Alpha. Everything is forgiving. Learn the throttle.',
    start: { type: 'drop', pad: 'alpha', altitude: 400, offset: 30, drift: 0 },
    envelope: { speed: 10, angle: 30 },
    objectives: [{ type: 'land', pad: 'alpha' }],
    estDeltaV: 150, estDuration: 180, reward: 900,
  },
  {
    id: 2, title: 'DESCENT PROFILE', body: 'luna', graphicsTier: 1,
    brief: 'Released high and off-centre with lateral drift. Kill the drift early — it is cheaper up there.',
    start: { type: 'drop', pad: 'alpha', altitude: 3000, offset: 900, drift: 14 },
    envelope: { speed: 8, angle: 24 },
    objectives: [{ type: 'land', pad: 'alpha' }],
    estDeltaV: 340, estDuration: 360, reward: 1300,
  },
  {
    id: 3, title: 'HOP', body: 'luna', graphicsTier: 2,
    brief: 'Your first launch. Lift off Alpha, fly the 12 km to Pad Beta, and set down.',
    start: { type: 'surface', pad: 'alpha' },
    envelope: { speed: 8, angle: 24 },
    objectives: [{ type: 'land', pad: 'beta' }],
    estDeltaV: 320, estDuration: 480, reward: 1900,
  },
  {
    id: 4, title: 'ABOVE THE LINE', body: 'luna', graphicsTier: 2,
    brief: 'Straight up to 30 km, then bring it home. The horizon starts to bend up there.',
    start: { type: 'surface', pad: 'alpha' },
    envelope: { speed: 7, angle: 20 },
    objectives: [
      { type: 'altitude', min: 30000 },
      { type: 'land', pad: null },
    ],
    estDeltaV: 760, estDuration: 900, reward: 2800,
  },
  {
    id: 5, title: 'ORBITAL INSERTION', body: 'luna', graphicsTier: 2,
    brief: 'Pitch over as you climb and build horizontal speed. Orbit is sideways, not up.',
    start: { type: 'surface', pad: 'alpha' },
    envelope: { speed: 7, angle: 20 },
    objectives: [{ type: 'orbit', minPeriapsis: 20000 }],
    estDeltaV: 1980, estDuration: 1200, reward: 4500,
  },
  {
    id: 6, title: 'DEORBIT', body: 'luna', graphicsTier: 3,
    brief: 'You start in a 60 km circular orbit. Burn retrograde to drop your periapsis into the surface, then land on Alpha.',
    start: { type: 'orbit', altitude: 60000, pad: 'alpha', leadAngle: 0.9 },
    envelope: { speed: 6, angle: 18 },
    objectives: [{ type: 'land', pad: 'alpha' }],
    estDeltaV: 1950, estDuration: 2400, reward: 5500,
  },
  {
    id: 7, title: 'ROUND TRIP', body: 'luna', graphicsTier: 3,
    brief: 'Surface to orbit, once around, then down on Beta. Budget the descent before you spend the ascent.',
    start: { type: 'surface', pad: 'alpha' },
    envelope: { speed: 6, angle: 18 },
    objectives: [
      { type: 'orbit', minPeriapsis: 20000 },
      { type: 'land', pad: 'beta' },
    ],
    estDeltaV: 4000, estDuration: 5400, reward: 9000,
  },
  {
    id: 8, title: 'SAMPLE RETURN', body: 'luna', graphicsTier: 3,
    brief: 'Land at the crater site, load 240 kg of regolith, and get back to orbit carrying it.',
    start: { type: 'surface', pad: 'alpha' },
    envelope: { speed: 6, angle: 18 },
    objectives: [
      { type: 'land', pad: 'crater' },
      { type: 'sample' },
      { type: 'orbit', minPeriapsis: 20000 },
    ],
    estDeltaV: 4400, estDuration: 10800, reward: 17000,
  },
  {
    id: 9, title: 'THICK AIR', body: 'earth', graphicsTier: 3,
    brief: 'Earth. Six times the gravity of Luna and an atmosphere that fights you. Reach 60 km and come back alive.',
    start: { type: 'surface', pad: 'cape' },
    envelope: { speed: 8, angle: 24 },
    objectives: [
      { type: 'altitude', min: 60000 },
      { type: 'land', pad: null },
    ],
    estDeltaV: 2600, estDuration: 1500, reward: 30000,
  },
  {
    id: 10, title: 'EARTH ORBIT', body: 'earth', graphicsTier: 3,
    brief: 'Nine and a half kilometres per second. No single stage can do this — build a stack and throw the empties away.',
    start: { type: 'surface', pad: 'cape' },
    envelope: { speed: 8, angle: 24 },
    objectives: [{ type: 'orbit', minPeriapsis: 160000 }],
    estDeltaV: 9400, estDuration: 2700, reward: 45000,
  },
  {
    id: 11, title: 'MARS DESCENT', body: 'mars', graphicsTier: 3,
    brief: 'An 80 km Mars orbit. The atmosphere is too thin to slow you much — plan on doing it with the engine.',
    start: { type: 'orbit', altitude: 80000, pad: 'chryse', leadAngle: 0.8 },
    envelope: { speed: 6, angle: 16 },
    objectives: [{ type: 'land', pad: 'chryse' }],
    estDeltaV: 3800, estDuration: 3600, reward: 30000,
  },
  {
    id: 12, title: 'MARS SAMPLE RETURN', body: 'mars', graphicsTier: 3,
    brief: 'From a 60 km orbit: land at the Valles site, load the sample, and fly it back up to orbit.',
    start: { type: 'orbit', altitude: 60000, pad: 'valles', leadAngle: 0.8 },
    envelope: { speed: 6, angle: 16 },
    objectives: [
      { type: 'land', pad: 'valles' },
      { type: 'sample' },
      { type: 'orbit', minPeriapsis: 60000 },
    ],
    estDeltaV: 8200, estDuration: 14400, reward: 70000,
  },
];

/** Credits you start the campaign with -- enough to build the level 1 lander. */
export const STARTING_CREDITS = 3000;
