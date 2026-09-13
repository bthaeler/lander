// Economy model. Two questions, and they are different questions:
//
//   1. Is there a rocket that can fly each level, and can a player afford it?
//      Answered by a seeded random search for the cheapest feasible design.
//   2. Does the money work at every difficulty setting? Answered by walking
//      the campaign three times, paying out the real formula from game.js.
//
// Seeded, so the tool gives the same answer twice and can be used to tune.
const ROOT = new URL('../js/', import.meta.url).href;
const {
  LEVELS, BODIES, LIFE_SUPPORT, STARTING_CREDITS, DIFFICULTIES,
  SALVAGE_INTACT, REPLAY_FLOOR, TANK, bonusesFor, salvageRates,
} = await import(ROOT + 'config.js');
const { Body } = await import(ROOT + 'body.js');
const { mulberry32 } = await import(ROOT + 'util.js');
const {
  designStats, availableEngines, payloadStats, suggestDesign,
} = await import(ROOT + 'design.js');

const FUELS = [40, 80, 150, 300, 600, 1200, 2500, 5000, 9000, 16000, 30000,
  55000, 90000, 150000, 250000, 400000, 600000];

let rnd = mulberry32(0xC0FFEE);
function randOf(a) { return a[Math.floor(rnd() * a.length)]; }

function cheapestFor(level, levelIndex, samples = 400000) {
  rnd = mulberry32(0xC0FFEE + levelIndex);
  const body = new Body(BODIES[level.body]);
  const engines = availableEngines(levelIndex);
  const needsLiftoff = level.start.type === 'surface';
  const lifeUnits = Math.ceil(level.estDuration / (LIFE_SUPPORT.hours * 3600)) + 1;

  let best = null;
  for (let i = 0; i < samples; i++) {
    const nStages = 1 + Math.floor(rnd() * 3);
    const stages = [];
    for (let s = 0; s < nStages; s++) {
      stages.push({
        engineId: randOf(engines).id,
        engineCount: 1 + Math.floor(rnd() * 6),
        fuel: randOf(FUELS),
      });
    }
    const design = {
      rcs: Math.floor(rnd() * 4),
      legs: Math.floor(rnd() * 3),
      lifeSupport: lifeUnits,
      stages,
    };
    const st = designStats(design, body);
    if (st.deltaV < level.estDeltaV) continue;
    if (needsLiftoff && st.liftoffTWR < 1.3) continue;
    if (st.lifeSeconds < level.estDuration) continue;
    if (!best || st.cost < best.cost) best = { cost: st.cost, st, design, nStages };
  }
  return best;
}

// --- 1. cheapest feasible design, and the old single-setting affordability walk

const cheapest = [];
let credits = STARTING_CREDITS;
console.log('level                        cheapest  stages    dV      TWR   credits  verdict   grind/run');
console.log('(credits = what you hold arriving at PILOT; grind/run = net income replaying it at the payout floor)');
let stuck = 0;
for (let i = 0; i < LEVELS.length; i++) {
  const level = LEVELS[i];
  const best = cheapestFor(level, i);
  cheapest[i] = best;
  if (!best) { console.log(`L${level.id} ${level.title}: NO FEASIBLE DESIGN FOUND`); stuck++; continue; }
  const affordable = best.cost <= credits;
  if (!affordable) stuck++;
  // Grind income: replaying this level at the payout floor with a good
  // landing. Assumes every stage but the last is expended and the last lands
  // with 30% of its propellant, which is a pessimistic-but-fair flight.
  const gPayload = payloadStats(best.design);
  const lastDesign = best.design.stages[best.design.stages.length - 1];
  const lastStat = best.st.stages[best.st.stages.length - 1];
  const salvage = gPayload.cost
    + lastStat.engine.cost * lastDesign.engineCount
    + 0.3 * lastDesign.fuel * TANK.costPerKg;
  const missionAtFloor = level.reward * 0.925 * REPLAY_FLOOR;
  const grind = missionAtFloor + SALVAGE_INTACT * salvage - best.cost;

  console.log(
    `L${String(level.id).padStart(2)} ${level.title.padEnd(22)} ` +
    `${String(best.cost).padStart(8)}  ${best.nStages}      ` +
    `${String(Math.round(best.st.deltaV)).padStart(5)}  ` +
    `${best.st.liftoffTWR.toFixed(2).padStart(5)}  ` +
    `${String(Math.round(credits)).padStart(7)}  ${(affordable ? 'ok' : 'CANNOT AFFORD').padEnd(13)} ` +
    `${String(Math.round(grind)).padStart(7)}`
  );
  const payload = payloadStats(best.design);
  const lastStage = best.st.stages[best.st.stages.length - 1];
  const recovery = SALVAGE_INTACT
    * (payload.cost + lastStage.engine.cost * best.design.stages[best.design.stages.length - 1].engineCount);
  credits -= best.cost;
  credits += level.reward * 1.15 + recovery;
}
console.log(`\nstarting credits ${STARTING_CREDITS}, ending ${Math.round(credits)}, ` +
  `${stuck} level(s) unaffordable`);

// --- 2. the same campaign at each difficulty setting -------------------------
//
// Flown in the vehicle the hangar itself would suggest, since that is a build
// a player can actually arrive at, and it carries the propellant reserve the
// fuel bonus asks for. Two flights per level:
//
//   clean   -- a competent landing: quality 0.85, fuel and schedule bonuses,
//              precision missed. This is the flight that has to keep a player
//              solvent.
//   perfect -- quality 1.0 and every bonus the level offers. This one is not
//              allowed to lose money at any setting.

function salvageOf(design, stats, fuelFraction, expendAllButLast) {
  const payload = payloadStats(design);
  let value = payload.cost;
  const from = expendAllButLast ? design.stages.length - 1 : 0;
  for (let i = from; i < design.stages.length; i++) {
    value += stats.stages[i].engine.cost * design.stages[i].engineCount;
    value += design.stages[i].fuel * fuelFraction * TANK.costPerKg;
  }
  return value;
}

function flightIncome(level, body, diff, build, profile) {
  const bonuses = bonusesFor(level, body);
  const earned = bonuses.filter((b) => profile.bonuses.includes(b.id));
  const base = Math.round(level.reward * diff.rewardScale * (0.5 + 0.5 * profile.quality));
  const mission = base + earned.reduce((a, b) => a + b.value, 0);
  // A design that has to stage cannot bring every stage home, so the salvage
  // assumption follows the same rule the intact-return bonus does.
  const multi = build.design.stages.length > 1;
  const salvage = salvageOf(build.design, build.stats, profile.fuelLeft, multi);
  return {
    mission,
    recovered: Math.round(salvage * salvageRates(diff).intact),
    bonuses: earned.map((b) => b.id),
  };
}

const CLEAN = { quality: 0.85, fuelLeft: 0.18, bonuses: ['fuel', 'schedule', 'intact'] };
const PERFECT = { quality: 1, fuelLeft: 0.25, bonuses: ['precision', 'fuel', 'schedule', 'intact'] };

// Flown in whichever of the two vehicles is cheaper: the hangar's suggestion,
// or the optimum the search found. A player short of money builds down to the
// optimum, so pricing the walk above it would invent a dead end that is not
// there -- and pricing it below the suggestion would assume a player who
// already knows the answer.
const builds = LEVELS.map((level, i) => {
  const body = new Body(BODIES[level.body]);
  const suggested = suggestDesign(level, body, i);
  const opt = cheapest[i] ? { design: cheapest[i].design, stats: cheapest[i].st } : null;
  let build = suggested;
  if (opt && (!suggested || opt.stats.cost < suggested.stats.cost)) build = opt;
  return { level, body, build, suggested };
});

let failures = 0;
for (const diff of DIFFICULTIES) {
  console.log(`\n${diff.name}  (start ${Math.round(STARTING_CREDITS * diff.credits)} CR, ` +
    `reward x${diff.rewardScale}, salvage x${diff.salvageScale}, floor ${diff.replayFloor})`);
  console.log('level                      vehicle   clean net  perfect net   credits  verdict');
  let bank = Math.round(STARTING_CREDITS * diff.credits);
  for (const { level, body, build } of builds) {
    if (!build) { console.log(`L${level.id} ${level.title}: NO FEASIBLE BUILD`); failures++; continue; }
    const cost = build.stats.cost;
    const clean = flightIncome(level, body, diff, build, CLEAN);
    const perfect = flightIncome(level, body, diff, build, PERFECT);
    const cleanNet = clean.mission + clean.recovered - cost;
    const perfectNet = perfect.mission + perfect.recovered - cost;

    const notes = [];
    if (cost > bank) { notes.push('CANNOT AFFORD'); failures++; }
    // The roadmap's invariant: a setting may make a clean flight barely pay,
    // but a perfect flight that loses money means the level cannot be farmed
    // out of a hole, and the campaign can dead-end.
    if (perfectNet < 0) { notes.push('PERFECT FLIGHT LOSES MONEY'); failures++; }

    console.log(
      `L${String(level.id).padStart(2)} ${level.title.padEnd(22)} ` +
      `${String(cost).padStart(7)}  ${String(cleanNet).padStart(10)}  ` +
      `${String(perfectNet).padStart(11)}  ${String(bank).padStart(8)}  ${notes.join(' / ') || 'ok'}`
    );
    bank += cleanNet;
  }
  console.log(`ending ${bank} CR`);
}

console.log(failures ? `\n${failures} economy problem(s)` : '\nevery setting stays solvent');
process.exit(failures ? 1 : 0);
