// All tuning lives here. Physical quantities are SI: metres, kilograms,
// seconds, newtons. Body constants are the real ones.

import { clamp, fmtTime } from './util.js';

export const FIXED_DT = 1 / 120;   // physics substep while powered, seconds

// Structural mass of a tank as a fraction of the propellant it holds. This is
// what makes single-stage-to-Earth-orbit impossible and staging necessary --
// it is a load-bearing constraint, not a knob to soften.
export const TANK_DRY_FRACTION = 0.085;

// Fixed plumbing/interstage mass per stage.
export const STAGE_STRUCTURE = 60;

// Engine gimbal: steering torque = thrust * gimbalFraction * length * this.
// RCS alone cannot turn a large launcher; gimbal is what makes it steerable.
//
// This is well below the L/2 a full-deflection nozzle would give. A real
// gimbal is that authoritative, but real vehicles do not hand full deflection
// to the pilot -- the control system rations it. Manual input commanding full
// deflection made a small lander snap round in about a second.
export const GIMBAL_LENGTH_FACTOR = 0.2;

export const WARP_LEVELS = [1, 2, 5, 10, 25, 100, 1000, 10000, 100000];
// Indices into WARP_LEVELS. Powered and low-altitude flight is integrated
// rather than solved analytically, but the substep count is only capped above
// 250x, so 100x still runs at the full 120 Hz and is safe. The real protection
// against warping into the ground is the time-to-impact guard in Game, not
// these ceilings.
export const WARP_MAX_POWERED = 5;      // 100x while thrusting
export const WARP_MAX_ATMOSPHERE = 4;   // 25x inside an atmosphere, where drag
                                        // changes fast with altitude
export const WARP_MAX_LOW = 5;          // 100x below LOW_ALTITUDE_FRACTION
export const LOW_ALTITUDE_FRACTION = 0.004;  // of body radius
// A single warp step may not consume more than this fraction of the time
// remaining before the ship would reach the ground.
export const WARP_IMPACT_MARGIN = 3;

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

// Torques are tuned so the starting lander turns at about 0.5 rad/s^2, which
// is the figure the pre-orbital build settled on and felt controllable.
// Inertia grows with mass AND the square of size, while RCS torque does not
// grow at all, so each tier suits a vehicle roughly 3x heavier than the last.
// The ladder is spaced to give about 0.5 rad/s^2 -- the figure the pre-orbital
// build settled on -- to successively larger landers. Fitting a big RCS to a
// tiny lander really does make it twitchy; the hangar shows the turn rate so
// that is a visible choice rather than a surprise.
export const RCS_TIERS = [
  { name: 'R-1 NUDGE', mass: 22, torque: 1.3e3, cost: 200 },
  { name: 'R-2 SWIVEL', mass: 40, torque: 4.5e3, cost: 700 },
  { name: 'R-3 PIVOT', mass: 75, torque: 1.5e4, cost: 2000 },
  { name: 'R-4 GYRO', mass: 140, torque: 5e4, cost: 5200 },
];

// Flight computer. The original brief called these "automated flight systems":
// each tier is mass and money in exchange for taking work off the pilot.
export const COMPUTER_TIERS = [
  { name: 'NONE', mass: 0, cost: 0, modes: [] },
  {
    name: 'FC-1 STABILISER', mass: 30, cost: 900,
    modes: ['KILL'],
  },
  {
    name: 'FC-2 POINTER', mass: 55, cost: 2600,
    modes: ['KILL', 'UP', 'PROGRADE', 'RETROGRADE'],
  },
  {
    name: 'FC-3 PILOT', mass: 95, cost: 7000,
    modes: ['KILL', 'UP', 'PROGRADE', 'RETROGRADE', 'DESCENT'],
  },
];

export const HOLD_LABELS = {
  KILL: 'KILL ROTATION',
  UP: 'HOLD VERTICAL',
  PROGRADE: 'HOLD PROGRADE',
  RETROGRADE: 'HOLD RETROGRADE',
  DESCENT: 'DESCENT ASSIST',
};

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

// Hardware recovery. Applied to the value of whatever is still bolted to the
// ship when the mission ends, so an expendable stack recovers little and a
// lander that comes home whole recovers most of itself.
//
// The rate slides with how badly the vehicle was wrecked: a lander that tipped
// over at 3 m/s is mostly reusable, a hypersonic impact is scrap. An intact
// vehicle -- a successful landing, or a mission abandoned with the ship still
// flying -- recovers the top rate.
//
// Success always beats a crash for the same vehicle regardless, because only
// success also pays the mission.
export const SALVAGE_INTACT = 0.85;
export const SALVAGE_WRECKED = 0.05;
// Impact speed this far past the touchdown limit counts as a total loss.
export const SEVERITY_SPEED_SPAN = 50;

// Replaying a level you have already completed pays less each time, decaying
// to a floor. That floor is deliberately still worth flying: it lets a player
// who has run short grind for money, but slowly enough that building to the
// mission is always the better plan. Harder levels grind better, since the
// floor is a fraction of the level's own reward.
export const REPLAY_DECAY = 0.7;
export const REPLAY_FLOOR = 0.35;

// Sample mass added to the ship when a sample objective completes.
export const SAMPLE_MASS = 240;

// --- difficulty -------------------------------------------------------------
// Chosen once, before the first hangar. Gravity, drag, engine performance and
// the levels themselves are identical at every setting -- what changes is how
// much margin the economy gives you and how much the hangar tells you. A
// player who moves up a setting should recognise the game they learned, and
// one set of tuned levels stays honest for all three.
//
// The load-bearing asymmetry: the BASE mission payment scales with the
// setting, but the objective bonuses below do not. At CADET the base alone
// covers a rebuild and bonuses are gravy; at FLIGHT DIRECTOR the base does
// not, so flying well is how you stay solvent. That is the whole difference
// in one number each.
export const DIFFICULTIES = [
  {
    id: 'cadet', name: 'CADET',
    tagline: 'Learn to fly. Money is not the problem.',
    notes: [
      'Three times the starting budget',
      'Generous payment — a landing always pays for the next rocket',
      'Wider touchdown limits, more hardware recovered',
      'The hangar suggests a vehicle for every mission',
    ],
    credits: 3, rewardScale: 1.35, salvageScale: 1.1,
    replayFloor: 0.5, envelopeScale: 1.3, hints: 'full',
  },
  {
    id: 'pilot', name: 'PILOT',
    tagline: 'The campaign as it was tuned.',
    notes: [
      'Standard budget, payment and touchdown limits',
      'The hangar checks your build but does not design it',
      'Bonuses are worth chasing, not required',
    ],
    credits: 1, rewardScale: 1, salvageScale: 1,
    replayFloor: REPLAY_FLOOR, envelopeScale: 1, hints: 'standard',
  },
  {
    id: 'director', name: 'FLIGHT DIRECTOR',
    tagline: 'The mission payment alone will not keep you flying.',
    notes: [
      'Reduced budget, payment and salvage — a crash really costs',
      'Tighter touchdown limits',
      'Bonuses are the budget: fly precisely or fly broke',
      'The hangar states the requirements and nothing else',
    ],
    credits: 0.6, rewardScale: 0.7, salvageScale: 0.85,
    replayFloor: 0.25, envelopeScale: 0.85, hints: 'minimal',
  },
];

/** PILOT: the setting everything else is expressed relative to. */
export const DEFAULT_DIFFICULTY = 1;

export function difficultyAt(index) {
  return DIFFICULTIES[clamp(Math.round(index || 0), 0, DIFFICULTIES.length - 1)];
}

export function difficultyIndexById(id) {
  const i = DIFFICULTIES.findIndex((d) => d.id === String(id).toLowerCase());
  return i < 0 ? DEFAULT_DIFFICULTY : i;
}

/** Salvage rates for a setting. Recovery can approach, but never reach, 1. */
export function salvageRates(difficulty) {
  return {
    intact: Math.min(0.98, SALVAGE_INTACT * difficulty.salvageScale),
    wrecked: Math.min(0.98, SALVAGE_WRECKED * difficulty.salvageScale),
  };
}

/**
 * Touchdown envelope for a level: the level's own limits, widened by the
 * landing gear and then by the difficulty setting. One function so the figure
 * the hangar prints is the figure the touchdown is judged against.
 */
export function touchdownEnvelope(level, legs, difficulty) {
  return {
    speed: (level.envelope.speed + legs.speedBonus) * difficulty.envelopeScale,
    angle: (level.envelope.angle + legs.angleBonus) * difficulty.envelopeScale,
  };
}

// --- objective bonuses ------------------------------------------------------
// Paid on top of the base mission payment for flying well rather than merely
// arriving. Each is all-or-nothing against a stated threshold, which is what
// makes "you missed the fuel margin by 40 kg" sayable -- a sliding scale can
// only ever report a number, not a miss.
//
// Shares are of the level's own reward, so they scale with the campaign
// without a second table.
export const BONUS_SHARES = {
  precision: 0.15,
  fuel: 0.20,
  schedule: 0.10,
  intact: 0.15,
};

/** Landing this close to the pad centre, as a fraction of its half-width. */
export const PRECISION_FRACTION = 0.3;
/**
 * Propellant left, as a fraction of what the stages you still have were built
 * to hold. Measured against the surviving stages rather than the whole launch
 * load on purpose: 15% of an Earth launcher's propellant is more than the
 * lander masses, so the whole-vehicle version of this bonus would be
 * unearnable on exactly the missions where a reserve matters most.
 */
export const FUEL_MARGIN_FRACTION = 0.15;
/**
 * Above this delta-v a vehicle has to stage, so bringing every stage home is
 * not a thing a player can choose to do -- and an unearnable bonus is worse
 * than no bonus. Airless only, for the same reason: an ascent through air
 * needs a booster whatever the budget says.
 */
export const INTACT_RETURN_DV = 2500;

/**
 * The bonuses a level offers. Derived from the mission rather than declared
 * per level, so a new level cannot silently ship with an impossible one.
 */
export function bonusesFor(level, body) {
  const out = [];
  const value = (share) => Math.round(level.reward * share);
  const last = level.objectives[level.objectives.length - 1];
  const pad = last && last.type === 'land' && last.pad && body
    ? body.padByName(last.pad) : null;

  if (pad) {
    out.push({
      id: 'precision', label: 'PRECISION LANDING', value: value(BONUS_SHARES.precision),
      note: `WITHIN ${Math.round((pad.width / 2) * PRECISION_FRACTION)} M OF ${pad.label}`,
    });
  }
  out.push({
    id: 'fuel', label: 'FUEL MARGIN', value: value(BONUS_SHARES.fuel),
    note: `${Math.round(FUEL_MARGIN_FRACTION * 100)}% RESERVE IN THE STAGES YOU KEEP`,
  });
  out.push({
    id: 'schedule', label: 'ON SCHEDULE', value: value(BONUS_SHARES.schedule),
    note: `MISSION UNDER ${fmtTime(level.estDuration)}`,
  });
  if (!body?.atmosphere && level.estDeltaV <= INTACT_RETURN_DV) {
    out.push({
      id: 'intact', label: 'INTACT RETURN', value: value(BONUS_SHARES.intact),
      note: 'NO STAGES EXPENDED',
    });
  }
  return out;
}

/** Everything a perfect flight of this level could pay, before replay decay. */
export function maxPayout(level, body, difficulty) {
  const bonuses = bonusesFor(level, body);
  return Math.round(level.reward * difficulty.rewardScale)
    + bonuses.reduce((a, b) => a + b.value, 0);
}

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
    // The only level whose vehicle is necessarily expendable, so its payment
    // has to cover a launcher it will never get back. At 45,000 even a perfect
    // flight lost money against the cheapest stack that can reach orbit --
    // which made the campaign's centrepiece a level you could not afford to
    // fly twice.
    estDeltaV: 9400, estDuration: 2700, reward: 65000,
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
