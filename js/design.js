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

  return {
    payload,
    stages,
    length,
    maxRadius,
    dragArea: Math.PI * maxRadius * maxRadius,
    wetMass: totalWet,
    dryMass: totalWet - stages.reduce((a, s) => a + s.fuel, 0),
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
