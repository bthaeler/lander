import { UPGRADES, UPGRADE_ORDER, HULL_MASS, INERTIA_FACTOR } from './config.js';

export function createLoadout() {
  return { engine: 0, tank: 0, rcs: 0, legs: 0 };
}

export function part(loadout, category) {
  return UPGRADES[category].tiers[loadout[category]];
}

export function nextTier(loadout, category) {
  return UPGRADES[category].tiers[loadout[category] + 1] || null;
}

export function isMaxed(loadout, category) {
  return loadout[category] >= UPGRADES[category].tiers.length - 1;
}

/**
 * Collapse a loadout into the flight model's inputs. Everything the physics
 * touches comes from here, so the mass/performance tradeoff is the whole game.
 */
export function shipStats(loadout) {
  const engine = part(loadout, 'engine');
  const tank = part(loadout, 'tank');
  const rcs = part(loadout, 'rcs');
  const legs = part(loadout, 'legs');

  let dryMass = HULL_MASS;
  for (const c of UPGRADE_ORDER) dryMass += part(loadout, c).mass;

  return {
    dryMass,
    fuelCapacity: tank.capacity,
    wetMass: dryMass + tank.capacity,
    maxThrust: engine.maxThrust,
    exhaustVelocity: engine.exhaustVelocity,
    spoolTime: engine.spoolTime,
    torque: rcs.torque,
    speedBonus: legs.speedBonus,
    angleBonus: legs.angleBonus,
  };
}

/** Derived numbers shown in the hangar so the player can shop deliberately. */
export function performance(stats, gravity) {
  const wetWeight = stats.wetMass * gravity;
  const dryWeight = stats.dryMass * gravity;
  const flowAtFull = stats.maxThrust / stats.exhaustVelocity;      // kg/s
  const hoverThrottle = wetWeight / stats.maxThrust;               // 0..1 at launch
  const hoverFlow = wetWeight / stats.exhaustVelocity;             // kg/s at launch

  return {
    twrWet: stats.maxThrust / wetWeight,
    twrDry: stats.maxThrust / dryWeight,
    burnTime: stats.fuelCapacity / flowAtFull,
    hoverTime: hoverThrottle >= 1 ? 0 : stats.fuelCapacity / hoverFlow,
    // Angular acceleration now (heavy) and at burnout (light).
    turnWet: stats.torque / (stats.wetMass * INERTIA_FACTOR),
    turnDry: stats.torque / (stats.dryMass * INERTIA_FACTOR),
    // Ideal delta-v from the rocket equation -- the honest measure of range.
    deltaV: stats.exhaustVelocity * Math.log(stats.wetMass / stats.dryMass),
  };
}
