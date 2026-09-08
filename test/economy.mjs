// Finds the cheapest feasible rocket for each level and checks it against the
// credits a player would plausibly have accumulated by then.
const ROOT = new URL('../js/', import.meta.url).href;
const { LEVELS, BODIES, LIFE_SUPPORT, STARTING_CREDITS } = await import(ROOT + 'config.js');
const { Body } = await import(ROOT + 'body.js');
const { mulberry32 } = await import(ROOT + 'util.js');
const { designStats, availableEngines, payloadStats } = await import(ROOT + 'design.js');
const { SALVAGE_INTACT, REPLAY_FLOOR, TANK } = await import(ROOT + 'config.js');

const FUELS = [40, 80, 150, 300, 600, 1200, 2500, 5000, 9000, 16000, 30000,
  55000, 90000, 150000, 250000, 400000, 600000];

// Seeded, so the tool gives the same answer twice and can be used to tune.
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

let credits = STARTING_CREDITS;
console.log('level                        cheapest  stages    dV      TWR   credits  verdict   grind/run');
console.log('(credits = what you hold arriving; grind/run = net income replaying it at the payout floor)');
let stuck = 0;
for (let i = 0; i < LEVELS.length; i++) {
  const level = LEVELS[i];
  const best = cheapestFor(level, i);
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
  const missionAtFloor = (level.reward * 0.925 + level.reward * 0.25 * 0.3) * REPLAY_FLOOR;
  const grind = missionAtFloor + SALVAGE_INTACT * salvage - best.cost;

  console.log(
    `L${String(level.id).padStart(2)} ${level.title.padEnd(22)} ` +
    `${String(best.cost).padStart(8)}  ${best.nStages}      ` +
    `${String(Math.round(best.st.deltaV)).padStart(5)}  ` +
    `${best.st.liftoffTWR.toFixed(2).padStart(5)}  ` +
    `${String(Math.round(credits)).padStart(7)}  ${(affordable ? 'ok' : 'CANNOT AFFORD').padEnd(13)} ` +
    `${String(Math.round(grind)).padStart(7)}`
  );
  // Pay for the rocket, earn the reward plus a decent quality/fuel bonus, and
  // recover surviving hardware. The recovery figure here is deliberately
  // pessimistic: it assumes every drop of propellant was burnt and every
  // stage but the last was expended, so it is a lower bound on real income.
  const payload = payloadStats(best.design);
  const lastStage = best.st.stages[best.st.stages.length - 1];
  const recovery = SALVAGE_INTACT
    * (payload.cost + lastStage.engine.cost * best.design.stages[best.design.stages.length - 1].engineCount);
  credits -= best.cost;
  credits += level.reward * 1.15 + recovery;
}
console.log(`\nstarting credits ${STARTING_CREDITS}, ending ${Math.round(credits)}, ` +
  `${stuck} level(s) unaffordable`);
