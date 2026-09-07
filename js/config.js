// Tuning constants for the lander sim.
// All physical quantities are SI: metres, kilograms, seconds, newtons.
// Nothing here is arcade-fudged -- the numbers are chosen so that a real
// rocket equation and real surface gravity produce a playable ship.

export const FIXED_DT = 1 / 120;      // physics substep, seconds
export const PIXELS_PER_METER = 2.2;  // world -> screen scale (starting value)

// The camera zooms in as the ship descends: a wide view while falling, a
// close view for the final approach where a degree of tilt matters.
export const ZOOM = { near: 5.2, far: 2.0, nearAlt: 35, farAlt: 340, rate: 2.5 };

// The ship rotates like a uniform disc: I = mass * INERTIA_FACTOR (kg*m^2).
// A heavier ship therefore turns more slowly for the same RCS torque, and
// gets more responsive as it burns fuel off.
export const INERTIA_FACTOR = 5.0;

// Structure, avionics, crew cab. Always present, never upgraded (for now).
export const HULL_MASS = 300;

// --- Upgrade tree -----------------------------------------------------------
// Every tier trades mass against capability. Buying "better" is not always
// buying "faster to land" -- a big engine on a small tank is a bad ship.
export const UPGRADES = {
  engine: {
    label: 'ENGINE',
    blurb: 'More thrust, more mass, thirstier per newton.',
    // exhaustVelocity is the one number tuned for play rather than realism:
    // a real hypergolic descent engine is ~3000 m/s, which would make
    // propellant effectively free over a 300 m descent. These low-efficiency
    // figures keep the tank a decision instead of a formality, and bigger
    // engines are deliberately less efficient than smaller ones.
    tiers: [
      { name: 'D-1 EMBER', mass: 110, maxThrust: 4200, exhaustVelocity: 700, spoolTime: 0.22, cost: 0 },
      { name: 'D-2 FORGE', mass: 168, maxThrust: 6600, exhaustVelocity: 660, spoolTime: 0.18, cost: 850 },
      { name: 'D-3 KILN', mass: 240, maxThrust: 9800, exhaustVelocity: 620, spoolTime: 0.15, cost: 2100 },
      { name: 'D-4 PYRE', mass: 330, maxThrust: 14500, exhaustVelocity: 580, spoolTime: 0.12, cost: 4800 },
    ],
  },
  tank: {
    label: 'TANK',
    blurb: 'Propellant is mass you carry until you spend it.',
    tiers: [
      { name: 'T-1 CANTEEN', mass: 34, capacity: 170, cost: 0 },
      { name: 'T-2 CISTERN', mass: 52, capacity: 280, cost: 700 },
      { name: 'T-3 RESERVOIR', mass: 78, capacity: 430, cost: 1900 },
      { name: 'T-4 DEEP WELL', mass: 116, capacity: 660, cost: 4200 },
    ],
  },
  rcs: {
    label: 'ATTITUDE',
    blurb: 'Torque for rotating. Fights your own inertia.',
    tiers: [
      { name: 'R-1 NUDGE', mass: 20, torque: 1800, cost: 0 },
      { name: 'R-2 SWIVEL', mass: 34, torque: 3000, cost: 600 },
      { name: 'R-3 PIVOT', mass: 52, torque: 5000, cost: 1600 },
      { name: 'R-4 GYRO', mass: 74, torque: 8000, cost: 3600 },
    ],
  },
  legs: {
    label: 'GEAR',
    blurb: 'Absorbs touchdown. Widens the margin for error.',
    tiers: [
      { name: 'G-1 STILTS', mass: 40, speedBonus: 0, angleBonus: 0, cost: 0 },
      { name: 'G-2 SPRUNG', mass: 66, speedBonus: 1.4, angleBonus: 3, cost: 650 },
      { name: 'G-3 DAMPED', mass: 98, speedBonus: 2.8, angleBonus: 6, cost: 1700 },
      { name: 'G-4 CRUSHABLE', mass: 140, speedBonus: 4.5, angleBonus: 10, cost: 3900 },
    ],
  },
};

export const UPGRADE_ORDER = ['engine', 'tank', 'rcs', 'legs'];

// --- Worlds -----------------------------------------------------------------
export const PLANETS = {
  moon: { name: 'LUNA', gravity: 1.62 },
  mars: { name: 'MARS', gravity: 3.71 },
  mercury: { name: 'MERCURY', gravity: 3.70 },
};

// --- Levels -----------------------------------------------------------------
// tolerance: the touchdown envelope BEFORE landing-gear bonuses are added.
//   speed -- max impact speed in m/s
//   angle -- max tilt from vertical in degrees
// graphicsTier: 1 = bare white wireframe, 2 = detailed, 3 = full fidelity.
//   Fidelity unlocks as the campaign progresses (see render.js).
export const LEVELS = [
  {
    planet: 'moon', name: 'TRANQUILLITY BASE',
    startAltitude: 260, startOffset: 30, startDrift: 0,
    tolerance: { speed: 10, angle: 30 },
    pads: 3, padWidth: 100, roughness: 0.5,
    reward: 600, graphicsTier: 1,
    brief: 'A wide, flat mare. Everything is forgiving here. Learn the throttle.',
  },
  {
    planet: 'moon', name: 'SEA OF SERENITY',
    startAltitude: 320, startOffset: 120, startDrift: 3,
    tolerance: { speed: 8, angle: 24 },
    pads: 2, padWidth: 72, roughness: 0.9,
    reward: 850, graphicsTier: 1,
    brief: 'You arrive with lateral drift. Kill it early -- it costs less fuel high up.',
  },
  {
    planet: 'moon', name: 'COPERNICUS RIM',
    startAltitude: 380, startOffset: 220, startDrift: 6,
    tolerance: { speed: 6, angle: 18 },
    pads: 2, padWidth: 52, roughness: 1.5,
    reward: 1200, graphicsTier: 2,
    brief: 'Broken crater terrain. The pads are the only ground worth trusting.',
  },
  {
    planet: 'mars', name: 'CHRYSE PLANITIA',
    startAltitude: 400, startOffset: 200, startDrift: 5,
    tolerance: { speed: 6, angle: 18 },
    pads: 2, padWidth: 62, roughness: 1.1,
    reward: 1700, graphicsTier: 2,
    brief: 'Mars pulls 2.3x harder than Luna. If your thrust-to-weight is under 1.5, buy engine.',
  },
  {
    planet: 'mars', name: 'VALLES MARINERIS',
    startAltitude: 460, startOffset: 260, startDrift: 8,
    tolerance: { speed: 5, angle: 14 },
    pads: 2, padWidth: 44, roughness: 1.9,
    reward: 2300, graphicsTier: 3,
    brief: 'Canyon shelves. Long fall, narrow shelf, no second approach.',
  },
  {
    planet: 'mercury', name: 'CALORIS BASIN',
    startAltitude: 520, startOffset: 300, startDrift: 10,
    tolerance: { speed: 4, angle: 10 },
    pads: 1, padWidth: 38, roughness: 2.2,
    reward: 3200, graphicsTier: 3,
    brief: 'One pad. Four metres per second. Ten degrees. Fly it clean.',
  },
];

// Landing pad payout multiplier by pad width (narrow pads pay more).
export function padMultiplier(widthMeters) {
  if (widthMeters <= 45) return 1.8;
  if (widthMeters <= 65) return 1.45;
  if (widthMeters <= 85) return 1.2;
  return 1.0;
}

// Landing off a marked pad is allowed if the ground is flat enough, but it
// pays less and the touchdown envelope is tighter.
export const OFF_PAD_MULTIPLIER = 0.6;
export const OFF_PAD_TOLERANCE_SCALE = 0.8;
export const MAX_OFF_PAD_SLOPE_DEG = 12;
