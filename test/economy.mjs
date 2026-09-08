// Finds the cheapest feasible rocket for each level and checks it against the
// credits a player would plausibly have accumulated by then.
const ROOT = new URL('../js/', import.meta.url).href;
const { LEVELS, BODIES, LIFE_SUPPORT, STARTING_CREDITS } = await import(ROOT + 'config.js');
const { Body } = await import(ROOT + 'body.js');
const { designStats, availableEngines } = await import(ROOT + 'design.js');

const FUELS = [40, 80, 150, 300, 600, 1200, 2500, 5000, 9000, 16000, 30000,
  55000, 90000, 150000, 250000, 400000, 600000];

function randOf(a) { return a[Math.floor(Math.random() * a.length)]; }

function cheapestFor(level, levelIndex, samples = 120000) {
  const body = new Body(BODIES[level.body]);
  const engines = availableEngines(levelIndex);
  const needsLiftoff = level.start.type === 'surface';
  const lifeUnits = Math.ceil(level.estDuration / (LIFE_SUPPORT.hours * 3600)) + 1;

  let best = null;
  for (let i = 0; i < samples; i++) {
    const nStages = 1 + Math.floor(Math.random() * 3);
    const stages = [];
    for (let s = 0; s < nStages; s++) {
      stages.push({
        engineId: randOf(engines).id,
        engineCount: 1 + Math.floor(Math.random() * 6),
        fuel: randOf(FUELS),
      });
    }
    const design = {
      rcs: Math.floor(Math.random() * 4),
      legs: Math.floor(Math.random() * 3),
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
console.log('level                        cheapest  stages    dV      TWR   credits  verdict');
let stuck = 0;
for (let i = 0; i < LEVELS.length; i++) {
  const level = LEVELS[i];
  const best = cheapestFor(level, i);
  if (!best) { console.log(`L${level.id} ${level.title}: NO FEASIBLE DESIGN FOUND`); stuck++; continue; }
  const affordable = best.cost <= credits;
  if (!affordable) stuck++;
  console.log(
    `L${String(level.id).padStart(2)} ${level.title.padEnd(22)} ` +
    `${String(best.cost).padStart(8)}  ${best.nStages}      ` +
    `${String(Math.round(best.st.deltaV)).padStart(5)}  ` +
    `${best.st.liftoffTWR.toFixed(2).padStart(5)}  ` +
    `${String(Math.round(credits)).padStart(7)}  ${affordable ? 'ok' : 'CANNOT AFFORD'}`
  );
  // Assume the player pays for the rocket and earns the reward plus a decent
  // quality/fuel bonus.
  credits -= best.cost;
  credits += level.reward * 1.15;
}
console.log(`\nstarting credits ${STARTING_CREDITS}, ending ${Math.round(credits)}, ` +
  `${stuck} level(s) unaffordable`);
