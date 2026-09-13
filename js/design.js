// The rocket you build in the hangar, and everything derived from it.
//
// A design is a payload plus an ordered list of stages, bottom stage first.
// Stage 0 burns and is discarded first. Every choice is a mass choice.

import {
  ENGINES, engineById, CAPSULE, LIFE_SUPPORT, RCS_TIERS, LEG_TIERS,
  COMPUTER_TIERS, TANK, TANK_DRY_FRACTION, STAGE_STRUCTURE,
} from './config.js';
import { clamp } from './util.js';

export function createDesign() {
  return {
    rcs: 0,
    legs: 0,
    computer: 0,
    lifeSupport: 1,
    stages: [{ engineId: 'lm1', engineCount: 1, fuel: 400 }],
  };
}

export function cloneDesign(d) {
  return { ...d, stages: d.stages.map((s) => ({ ...s })) };
}

/** Propellant bulk density, kg/m^3 — used only for sizing the silhouette. */
const PROP_DENSITY = 1000;
const CAPSULE_LENGTH = 2.6;

/** Physical size of a stage, which sets both drawing and rotational inertia. */
export function stageGeometry(stage) {
  // Diameter grows slowly so big stages come out long and narrow like real
  // ones. Length matters beyond looks: rotational inertia goes as length^2
  // and gimbal torque scales with length, so a squat stack would steer wrong.
  const radius = clamp(0.55 + 0.45 * Math.log10(1 + stage.fuel / 300), 0.55, 3.6);
  const volume = stage.fuel / PROP_DENSITY;
  const length = volume / (Math.PI * radius * radius) + 1.5;
  return { radius, length };
}

/** Landing-gear footprint, which also sets how wide the vehicle is. */
export function footSpanFor(maxRadius) {
  return Math.max(1.6, maxRadius * 1.5);
}

/**
 * Pitch inertia for a cylinder of this length and width. Shared with Ship so
 * the hangar's predicted turn rate is the rate you actually get in flight.
 */
export function inertiaFor(mass, length, maxRadius) {
  const width = 2 * footSpanFor(maxRadius);
  return (mass * (length * length + width * width)) / 12;
}

export function stageStats(stage) {
  const engine = engineById(stage.engineId);
  const engineMass = engine.mass * stage.engineCount;
  const tankDry = stage.fuel * TANK_DRY_FRACTION;
  const dry = engineMass + tankDry + STAGE_STRUCTURE;
  const geom = stageGeometry(stage);
  return {
    engine,
    engineMass,
    tankDry,
    structure: STAGE_STRUCTURE,
    dry,
    wet: dry + stage.fuel,
    fuel: stage.fuel,
    thrust: engine.thrust * stage.engineCount,
    ...geom,
    cost: engine.cost * stage.engineCount + stage.fuel * TANK.costPerKg,
  };
}

/** Everything the payload contributes: capsule, life support, RCS, gear. */
export function payloadStats(design) {
  const rcs = RCS_TIERS[design.rcs];
  const legs = LEG_TIERS[design.legs];
  const computer = COMPUTER_TIERS[design.computer || 0];
  const lifeMass = LIFE_SUPPORT.mass * design.lifeSupport;
  return {
    rcs,
    legs,
    computer,
    lifeMass,
    lifeSeconds: LIFE_SUPPORT.hours * 3600 * design.lifeSupport,
    mass: CAPSULE.mass + lifeMass + rcs.mass + legs.mass + computer.mass,
    cost: rcs.cost + legs.cost + computer.cost
      + LIFE_SUPPORT.cost * design.lifeSupport + CAPSULE.cost,
  };
}

/**
 * Full derived model. `body` is optional; when given, delta-v for the bottom
 * stage is estimated at the body's ambient pressure rather than in vacuum.
 */
export function designStats(design, body = null) {
  const payload = payloadStats(design);
  const stages = design.stages.map(stageStats);

  // Mass above each stage: payload plus every stage that has not burned yet.
  const totalWet = payload.mass + stages.reduce((a, s) => a + s.wet, 0);

  let above = payload.mass;
  for (let i = stages.length - 1; i >= 0; i--) {
    stages[i].massAbove = above;
    above += stages[i].wet;
  }

  let totalDeltaV = 0;
  stages.forEach((s, i) => {
    const m0 = s.massAbove + s.wet;
    const m1 = s.massAbove + s.dry;
    // The bottom stage on a body with air spends much of its burn at pressure.
    const inAir = i === 0 && body && body.atmosphere;
    const ve = inAir ? (s.engine.veVac + s.engine.veSea) / 2 : s.engine.veVac;
    s.ve = ve;
    s.deltaV = ve * Math.log(m0 / m1);
    s.burnTime = s.fuel / (s.thrust / ve);
    s.m0 = m0;
    s.m1 = m1;
    totalDeltaV += s.deltaV;
  });

  const length = CAPSULE_LENGTH + stages.reduce((a, s) => a + s.length, 0);
  const maxRadius = stages.reduce((a, s) => Math.max(a, s.radius), 0.9);

  const liftoffThrust = stages.length ? stages[0].thrust : 0;
  const g = body ? body.surfaceGravity() : 0;
  const dry = totalWet - stages.reduce((a, s) => a + s.fuel, 0);

  // Turn rate, so the RCS choice is an informed one. Gimbal adds to this in
  // flight but only while the engine is lit.
  const inertiaWet = inertiaFor(totalWet, length, maxRadius);
  const inertiaDry = inertiaFor(dry, length, maxRadius);
  const turnWet = payload.rcs.torque / inertiaWet;
  const turnDry = payload.rcs.torque / inertiaDry;

  return {
    payload,
    stages,
    length,
    maxRadius,
    dragArea: Math.PI * maxRadius * maxRadius,
    wetMass: totalWet,
    dryMass: dry,
    inertiaWet,
    turnWet,
    turnDry,
    // Time to swing 90 degrees and stop again at full deflection.
    swing90: turnWet > 0 ? 2 * Math.sqrt((Math.PI / 4) / turnWet) : Infinity,
    deltaV: totalDeltaV,
    liftoffThrust,
    liftoffTWR: g > 0 ? liftoffThrust / (totalWet * g) : Infinity,
    lifeSeconds: payload.lifeSeconds,
    cost: Math.round(payload.cost + stages.reduce((a, s) => a + s.cost, 0)),
  };
}

/**
 * Value of the hardware that is physically still attached to the ship.
 *
 * Jettisoned stages are gone -- that is the point of staging, and it means
 * an expendable design recovers far less than a lander that flies home whole.
 * Burnt propellant is gone too; what is left in the tanks still counts.
 */
export function salvageValue(ship) {
  const payload = payloadStats(ship.design);
  let value = payload.cost;
  for (let i = ship.activeStage; i < ship.stages.length; i++) {
    const s = ship.stages[i];
    value += s.engine.cost * s.engineCount;
    value += s.fuel * TANK.costPerKg;
  }
  return value;
}

export function buildCost(design) {
  return designStats(design).cost;
}

/** Engines the player has unlocked at this point in the campaign. */
export function availableEngines(levelIndex) {
  return ENGINES.filter((e) => e.unlock <= levelIndex);
}

export function addStage(design, levelIndex) {
  const engines = availableEngines(levelIndex);
  design.stages.unshift({
    engineId: engines[0].id,
    engineCount: 1,
    fuel: 400,
  });
}

export function removeStage(design, index) {
  if (design.stages.length <= 1) return false;
  design.stages.splice(index, 1);
  return true;
}

export function adjustFuel(stage, delta) {
  stage.fuel = clamp(Math.round(stage.fuel + delta), TANK.min, TANK.max);
}

export function cycleEngine(stage, dir, levelIndex) {
  const list = availableEngines(levelIndex);
  const i = list.findIndex((e) => e.id === stage.engineId);
  const next = (i + dir + list.length) % list.length;
  stage.engineId = list[next].id;
}

// --- suggested build --------------------------------------------------------
// The hangar's CADET hint: a vehicle that meets the mission, chosen to be
// cheap rather than clever. It exists so a new player has somewhere to start
// and something to modify, not so they can skip the design decision.

/**
 * Delta-v reserve over the level's estimate. A first-time player wastes
 * propellant hovering, and a cheaper rocket they cannot land is not the
 * cheaper option -- but the reserve is capped in m/s rather than left as a
 * percentage, because a percentage compounds through the rocket equation. A
 * 35% margin on a lunar hop is a few hundred kilograms; the same margin on an
 * Earth ascent quintuples the launcher.
 */
const SUGGEST_RESERVE_FRACTION = 0.35;
const SUGGEST_RESERVE_CAP = 300;   // m/s
/** Thrust-to-weight the bottom stage needs at liftoff. */
const SUGGEST_LIFTOFF_TWR = 1.4;
/** Thrust-to-weight the last stage needs to hover and land on its own. */
const SUGGEST_LANDING_TWR = 1.6;
/** Middle stages need not hover, but must out-accelerate gravity usefully. */
const SUGGEST_MID_TWR = 0.8;
const MAX_SUGGEST_ENGINES = 6;

/**
 * How the delta-v is split between stages, bottom stage first. An even split
 * is rarely the cheapest: the bottom stage carries everything above it, so
 * giving it a larger share often buys a smaller stack overall. Both are tried
 * and costed.
 */
function splitProfiles(n) {
  const even = new Array(n).fill(1 / n);
  if (n === 1) return [even];
  const weights = [];
  let total = 0;
  for (let i = 0; i < n; i++) { const w = n - i; weights.push(w); total += w; }
  return [even, weights.map((w) => w / total)];
}

/**
 * Propellant a stage needs to deliver `dv` while carrying `above` kilograms.
 *
 * Closed form rather than a search. The tank's dry mass is a fixed fraction of
 * the propellant it holds, so with f the propellant and E the fixed stage mass:
 *
 *   (above + E + kf + f) / (above + E + kf) = exp(dv/ve) = K + 1
 *   =>  f = (above + E) * K / (1 - kK)
 *
 * The denominator going non-positive is not a numerical failure -- it is the
 * point where tank structure eats the whole mass ratio and no amount of
 * propellant delivers the delta-v. That is what forces staging, so it returns
 * null and the caller tries more stages.
 */
function sizeStage(engine, count, dv, ve, above) {
  const K = Math.exp(dv / ve) - 1;
  const denom = 1 - TANK_DRY_FRACTION * K;
  if (denom <= 0.05) return null;
  const fixed = engine.mass * count + STAGE_STRUCTURE;
  const fuel = ((above + fixed) * K) / denom;
  if (!isFinite(fuel) || fuel <= 0 || fuel > TANK.max) return null;
  return Math.max(TANK.min, Math.round(fuel));
}

/**
 * Cheapest vehicle this engine assignment can fly the mission with, or null.
 * Stages are sized from the top down, since each one has to lift everything
 * above it.
 */
function buildCandidate(engineIds, level, body, payloadPicks, targetDv, split) {
  const g = body.surfaceGravity();
  const needsLiftoff = level.start.type === 'surface';
  const n = engineIds.length;

  const stages = new Array(n);
  let above = payloadStats(payloadPicks).mass;

  for (let i = n - 1; i >= 0; i--) {
    const engine = engineById(engineIds[i]);
    // Only the bottom stage burns at sea level, and designStats blends its
    // exhaust velocity the same way, so size against the figure it will grade.
    const ve = i === 0 && body.atmosphere
      ? (engine.veVac + engine.veSea) / 2 : engine.veVac;

    // Enough engines to meet the thrust the stage's job needs: lifting the
    // stack off the pad at the bottom, hovering the lander at the top, and in
    // between simply not wallowing.
    let count = 1;
    let fuel = null;
    for (; count <= MAX_SUGGEST_ENGINES; count++) {
      fuel = sizeStage(engine, count, targetDv * split[i], ve, above);
      if (fuel === null) break;
      const wet = fuel * (1 + TANK_DRY_FRACTION) + engine.mass * count + STAGE_STRUCTURE;
      const thrust = engine.thrust * count;
      if (i === 0 && needsLiftoff) {
        // The bottom stage lifts everything.
        if (thrust >= (above + wet) * g * SUGGEST_LIFTOFF_TWR) break;
      } else if (i === n - 1) {
        // The last stage lands on its own, near dry.
        const landingMass = above + wet - fuel * 0.85;
        if (thrust >= landingMass * g * SUGGEST_LANDING_TWR) break;
      } else if (thrust >= (above + wet) * g * SUGGEST_MID_TWR) break;
    }
    if (fuel === null || count > MAX_SUGGEST_ENGINES) return null;

    stages[i] = { engineId: engine.id, engineCount: count, fuel };
    above += fuel * (1 + TANK_DRY_FRACTION) + engine.mass * count + STAGE_STRUCTURE;
  }

  const design = { ...payloadPicks, stages };
  const stats = designStats(design, body);
  if (stats.deltaV < level.estDeltaV) return null;
  if (needsLiftoff && stats.liftoffTWR < 1.25) return null;
  return { design, stats };
}

/**
 * A vehicle that meets `level`, or null if nothing in the unlocked catalogue
 * does. Deterministic: same level and same unlocks, same rocket.
 */
export function suggestDesign(level, body, frontier) {
  const engines = availableEngines(frontier);
  // Half again the estimated mission, rounded up to whole canisters.
  const lifeSupport = Math.max(1,
    Math.ceil((level.estDuration * 1.5) / (LIFE_SUPPORT.hours * 3600)));
  // Gear tier is a landing decision: tighter envelopes want more absorption.
  const legs = level.envelope.speed <= 6 ? 2 : level.envelope.speed <= 8 ? 1 : 0;

  let best = null;
  // Two passes over the attitude tier: the right RCS depends on the vehicle's
  // inertia, which is not known until the vehicle exists.
  let rcs = 1;
  for (let pass = 0; pass < 2; pass++) {
    const picks = { rcs, legs, computer: 0, lifeSupport };
    best = null;
    for (let n = 1; n <= 3; n++) {
      // Every assignment of unlocked engines to n stages. Small enough to
      // enumerate (at most 5^3), and exhaustive beats clever here.
      const total = engines.length ** n;
      for (let code = 0; code < total; code++) {
        const ids = [];
        let c = code;
        for (let s = 0; s < n; s++) { ids.push(engines[c % engines.length].id); c = Math.floor(c / engines.length); }
        for (const split of splitProfiles(n)) {
          // Walk the reserve up only until something flies: more delta-v is
          // for when the design would not close at all, not a free upgrade.
          for (let extra = 0; extra <= 0.45; extra += 0.15) {
            const dv = level.estDeltaV * (1 + extra)
              + Math.min(level.estDeltaV * SUGGEST_RESERVE_FRACTION, SUGGEST_RESERVE_CAP);
            const cand = buildCandidate(ids, level, body, picks, dv, split);
            if (!cand) continue;
            // Strictly cheaper to displace, and n ascends, so a tie goes to
            // the simpler rocket.
            if (!best || cand.stats.cost < best.stats.cost) best = cand;
            break;
          }
        }
      }
    }
    if (!best) return null;
    // Pick the attitude tier closest to a comfortable half a radian per second
    // squared, then rebuild once so its mass is actually accounted for.
    const inertia = best.stats.inertiaWet;
    let bestRcs = 0, bestErr = Infinity;
    RCS_TIERS.forEach((t, i) => {
      const err = Math.abs(t.torque / inertia - 0.5);
      if (err < bestErr) { bestErr = err; bestRcs = i; }
    });
    if (bestRcs === rcs) break;
    rcs = bestRcs;
  }
  return best;
}
