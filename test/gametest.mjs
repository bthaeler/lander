// End-to-end test through the real Game state machine with a stub renderer.
const ROOT = new URL('../js/', import.meta.url).href;
const { Game } = await import(ROOT + 'game.js');
const { LEVELS, WARP_LEVELS } = await import(ROOT + 'config.js');
const { elementsFromState, timeToApoapsis } = await import(ROOT + 'orbit.js');
const { designStats } = await import(ROOT + 'design.js');
const { wrapAngle, clamp, DEG } = await import(ROOT + 'util.js');

let failures = 0;
function ok(name, cond, detail = '') {
  if (!cond) { failures++; console.log(`  FAIL ${name} ${detail}`); }
  else console.log(`  ok   ${name} ${detail}`);
}

function stubRenderer() {
  return {
    camera: { x: 0, y: 0, rot: 0 }, w: 1280, h: 800, scale: 1,
    setTier() {},
  };
}
class StubInput {
  constructor() { this.held = new Set(); this.p = new Set(); }
  isDown(a) { return this.held.has(a); }
  wasPressed(a) { return this.p.has(a); }
  endFrame() { this.p.clear(); }
  press(a) { this.p.add(a); }
  hold(a, on) { on ? this.held.add(a) : this.held.delete(a); }
  clear() { this.held.clear(); }
}

const DT = 1 / 60;

/**
 * Descent autopilot in the planet-centred frame. Nulls downrange error, then
 * flies a braking curve to a soft touchdown.
 *
 * Sign note: tilt = wrapAngle(upAngle - angle), so a positive tilt produces
 * NEGATIVE tangential thrust; cmd.rotate = +1 increases tilt.
 */
function descentAutopilot(game, input, targetTheta) {
  const ship = game.ship;
  const body = game.body;
  const r = ship.radiusFromCentre;
  const theta = Math.atan2(ship.y, ship.x);
  const alt = Math.max(0, body.altitudeAt(ship.x, ship.y));

  const ur = { x: ship.x / r, y: ship.y / r };
  const ut = { x: -ur.y, y: ur.x };
  const vs = ship.vx * ur.x + ship.vy * ur.y;
  const hs = ship.vx * ut.x + ship.vy * ut.y;

  const downrange = wrapAngle(targetTheta - theta) * body.radius;
  const aligned = Math.abs(downrange) < 12 && Math.abs(hs) < 0.4;

  const wantHs = clamp(downrange * 0.10, -60, 60);
  let wantTilt = -clamp((wantHs - hs) * 0.05, -0.55, 0.55);
  if (alt < 12) wantTilt = 0;

  const u = (wantTilt - ship.tilt) * 7 + ship.omega * 2.6;
  input.hold('right', u > 0.12);
  input.hold('left', u < -0.12);

  const g = body.mu / (r * r);
  const aSafe = 0.42 * (ship.maxThrust / ship.mass - g);
  let wantVs = -Math.max(1.1, Math.min(60, Math.sqrt(Math.max(0, 2 * aSafe * Math.max(0, alt - 6)))));
  if (alt < 90 && !aligned) wantVs = Math.max(wantVs, -0.3);
  input.hold('boost', vs < wantVs);
}

// --- level 1 end to end -----------------------------------------------------
console.log('level 1, hangar to touchdown:');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  ok('starts in the hangar', game.state === 'hangar');
  ok('has a design', game.session.design.stages.length === 1);

  const beforeCredits = game.session.credits;
  const cost = designStats(game.session.design, game.body).cost;
  input.press('launch');
  game.update(DT); input.endFrame();
  ok('launch enters flight', game.state === 'flying');
  ok('build cost was charged',
    game.session.credits === beforeCredits - cost, `paid ${cost}`);
  ok('life support loaded', game.lifeRemaining > 0);

  const pad = game.body.padByName('alpha');
  let guard = 0;
  while (game.state === 'flying' && guard++ < 60 * 600) {
    descentAutopilot(game, input, pad.theta);
    game.update(DT);
    input.endFrame();
  }
  input.clear();
  ok('flight ended', game.state === 'result', `after ${(guard / 60).toFixed(0)} s`);
  const res = game.result;
  console.log(`       ${res.success ? 'LANDED' : 'LOST: ' + res.reason}` +
    (res.touchdown ? ` v=${res.touchdown.speed.toFixed(2)} a=${res.touchdown.tiltDeg.toFixed(1)}` +
      ` pad=${res.touchdown.pad ? res.touchdown.pad.name : 'none'}` : ''));
  ok('mission succeeded', res.success === true);
  ok('landed on Pad Alpha', !!res.touchdown && res.touchdown.pad
    && res.touchdown.pad.name === 'alpha');
  ok('objectives all complete', game.mission.complete);
  ok('credits awarded', res.credits > 0, `+${res.credits} cr`);

  input.press('confirm');
  game.update(DT); input.endFrame();
  ok('advances to the next level hangar',
    game.state === 'hangar' && game.session.levelIndex === 1);
}

// --- landing does not end a multi-objective flight ---------------------------
console.log('landing mid-mission keeps the flight alive (level 8 shape):');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  // Jump to the sample-return level and give it a capable vehicle.
  game.session.credits = 500000;
  game.loadLevel(7);
  game.session.design = {
    rcs: 2, legs: 2, lifeSupport: 3,
    stages: [{ engineId: 've1', engineCount: 1, fuel: 9000 }],
  };
  ok('level 8 has three objectives', game.mission.objectives.length === 3);
  ok('first objective is a landing', game.mission.active.type === 'land');

  game.launch();
  ok('starts resting on the surface', game.ship.landed === true);
  ok('starting on a pad does not complete the crater objective',
    !game.mission.objectives[0].done);

  // Teleport onto the crater pad and settle, as a landing would.
  const crater = game.body.padByName('crater');
  const rr = crater.r + game.ship.length / 2 + 2;
  game.ship.x = rr * Math.cos(crater.theta);
  game.ship.y = rr * Math.sin(crater.theta);
  game.ship.angle = crater.theta;
  game.ship.vx = 0; game.ship.vy = 0; game.ship.omega = 0;
  game.ship.settle(game.body);
  game.evaluateMission();

  ok('land objective completed', game.mission.objectives[0].done);
  ok('sample objective completed', game.mission.objectives[1].done);
  ok('sample mass is aboard', game.ship.sampleMass === 240,
    `${game.ship.sampleMass} kg`);
  ok('flight continues, mission not complete', !game.mission.complete);
  ok('orbit objective is now active', game.mission.active.type === 'orbit');
  ok('game did not go to result', game.state === 'flying');
}

// --- orbit objective and time warp ------------------------------------------
console.log('orbit objective, warp, and analytic coasting:');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  game.session.credits = 500000;
  game.loadLevel(4);   // ORBITAL INSERTION
  game.session.design = {
    rcs: 2, legs: 1, lifeSupport: 4,
    stages: [{ engineId: 've1', engineCount: 1, fuel: 6000 }],
  };
  game.launch();

  // Place the ship directly into a valid orbit and confirm the objective sees it.
  const body = game.body;
  const rr = body.radius + 90000;
  const v = body.circularSpeed(rr);
  const ship = game.ship;
  ship.x = rr; ship.y = 0; ship.vx = 0; ship.vy = v; ship.landed = false;
  game.evaluateMission();
  ok('orbit objective satisfied', game.mission.objectives[0].done);
  ok('mission complete -> result', game.state === 'result' && game.result.success);
}

console.log('time warp uses analytic propagation and stays exact:');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  game.session.credits = 500000;
  game.loadLevel(5);   // DEORBIT: starts in a 60 km circular orbit
  game.session.design = {
    rcs: 2, legs: 2, lifeSupport: 8,
    stages: [{ engineId: 've1', engineCount: 1, fuel: 9000 }],
  };
  game.launch();
  ok('spawns in orbit', !game.ship.landed);
  const el0 = elementsFromState(game.ship.x, game.ship.y, game.ship.vx, game.ship.vy, game.body.mu);
  ok('spawn orbit is circular', Math.abs(el0.e) < 1e-9, `e=${el0.e.toExponential(2)}`);
  console.log(`       period ${(el0.period / 60).toFixed(1)} min, ` +
    `alt ${((el0.periapsis - game.body.radius) / 1000).toFixed(1)} km`);

  // Wind warp up and coast a full orbit.
  for (let i = 0; i < 6; i++) { input.press('warpUp'); game.update(DT); input.endFrame(); }
  ok('warp increased', WARP_LEVELS[game.warpIndex] >= 100,
    `${WARP_LEVELS[game.warpIndex]}x`);

  const target = el0.period;
  let elapsed = 0, guard = 0;
  while (elapsed < target && guard++ < 200000 && game.state === 'flying') {
    const before = game.missionTime;
    game.update(DT);
    input.endFrame();
    elapsed += game.missionTime - before;
  }
  const el1 = elementsFromState(game.ship.x, game.ship.y, game.ship.vx, game.ship.vy, game.body.mu);
  const drift = Math.abs(el1.periapsis - el0.periapsis);
  ok('orbit unchanged after a full coasted orbit', drift < 50,
    `periapsis drift ${drift.toFixed(2)} m in ${guard} frames`);
  ok('life support was consumed', game.lifeRemaining < game.lifeTotal,
    `${(game.missionTime / 60).toFixed(0)} min elapsed`);
}

// --- surface to orbit is actually flyable -----------------------------------
// The headline new gameplay. If a plausible vehicle cannot reach orbit from
// the ground under keyboard-equivalent controls, the campaign is broken.
console.log('ascent to orbit from the surface (level 5):');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  game.session.credits = 500000;
  game.loadLevel(4);   // ORBITAL INSERTION, starts on Pad Alpha
  // Deliberately sized so the first stage cannot finish the job: the ascent
  // has to stage part way up.
  game.session.design = {
    rcs: 2, legs: 0, lifeSupport: 2,
    stages: [
      { engineId: 've1', engineCount: 1, fuel: 2200 },
      { engineId: 've1', engineCount: 1, fuel: 2600 },
    ],
  };
  game.launch();
  ok('starts on the ground', game.ship.landed === true);

  const body = game.body;
  const minPe = body.radius + game.mission.objectives[0].minPeriapsis;
  const targetAp = body.radius + 45000;
  let guard = 0;
  let staged = false;
  let phase = 'ascent';

  while (game.state === 'flying' && guard++ < 60 * 8000) {
    const ship = game.ship;
    const alt = body.altitudeAt(ship.x, ship.y);
    const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);
    const tAp = timeToApoapsis(el);

    // Standard two-burn ascent: raise apoapsis, coast to it, then
    // circularise. Burning horizontally down low only raises apoapsis while
    // periapsis stays underground, which is how you escape by accident.
    if (phase === 'ascent' && el.closed && el.apoapsis >= targetAp) phase = 'coast';
    if (phase === 'coast' && (tAp < 12 || el.periapsis >= minPe)) phase = 'circularise';

    // Negative tilt accelerates counter-clockwise (prograde here).
    let wantTilt;
    if (phase === 'ascent') {
      if (alt < 3000) wantTilt = -0.25;
      else if (alt < 10000) wantTilt = -0.9;
      else wantTilt = -1.35;
    } else {
      wantTilt = -Math.PI / 2;   // horizontal
    }

    const u = (wantTilt - ship.tilt) * 8 + ship.omega * 3.0;
    input.hold('right', u > 0.10);
    input.hold('left', u < -0.10);

    let burn = false;
    if (phase === 'ascent') burn = true;
    else if (phase === 'circularise') burn = el.periapsis < minPe + 1500;
    // Never keep burning once the trajectory has opened up.
    if (!el.closed && el.periapsis > minPe) burn = false;
    input.hold('boost', burn);

    if (!staged && ship.needsStaging) { input.press('stage'); staged = true; }
    game.update(DT);
    input.endFrame();
  }
  input.clear();

  const el = elementsFromState(game.ship.x, game.ship.y, game.ship.vx, game.ship.vy, body.mu);
  console.log(`       ended ${game.state}: pe=${((el.periapsis - body.radius) / 1000).toFixed(1)} km ` +
    `ap=${el.closed ? ((el.apoapsis - body.radius) / 1000).toFixed(1) + ' km' : 'escape'} ` +
    `fuel left ${game.ship.totalFuel.toFixed(0)} kg, MET ${(game.missionTime / 60).toFixed(1)} min`);
  ok('reached orbit and completed the mission',
    game.state === 'result' && game.result.success === true,
    game.result && !game.result.success ? game.result.reason : '');
  ok('staging was used', staged);
}

// --- Earth orbit is reachable ------------------------------------------------
// The campaign's hardest claim: 9.4 km/s through an atmosphere, which needs a
// real multi-stage launcher and a gravity turn.
console.log('Earth orbit from the Cape (level 10):');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  game.session.credits = 5e6;
  game.loadLevel(9);
  game.session.design = {
    rcs: 2, legs: 1, lifeSupport: 3,
    stages: [
      { engineId: 'bs2', engineCount: 4, fuel: 400000 },
      { engineId: 'bs1', engineCount: 1, fuel: 80000 },
      { engineId: 've1', engineCount: 1, fuel: 14000 },
    ],
  };
  const st = designStats(game.session.design, game.body);
  console.log(`       launcher: ${(st.wetMass / 1000).toFixed(0)} t, ` +
    `dV ${st.deltaV.toFixed(0)} m/s, TWR ${st.liftoffTWR.toFixed(2)}, ` +
    `${st.length.toFixed(0)} m tall`);
  ok('launcher lifts off Earth', st.liftoffTWR > 1.2);
  game.launch();

  const body = game.body;
  const minPe = body.radius + game.mission.objectives[0].minPeriapsis;
  let guard = 0, stagings = 0, maxQ = 0;

  while (game.state === 'flying' && guard++ < 60 * 6000) {
    const ship = game.ship;
    const alt = body.altitudeAt(ship.x, ship.y);
    const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);
    maxQ = Math.max(maxQ, 0.5 * body.density(alt) * ship.speed * ship.speed);

    // Continuous burn to insertion, the way a real launcher flies. The pitch
    // program is keyed to SPEED, not altitude: an altitude-keyed program
    // pitches back up once the vehicle starts falling, which throws away all
    // the horizontal speed it just bought.
    const spd = ship.speed;
    const wantTilt = -Math.min(1, Math.max(0, (spd - 50) / 3500)) * 1.535;

    const u = (wantTilt - ship.tilt) * 9 + ship.omega * 3.4;
    input.hold('right', u > 0.08);
    input.hold('left', u < -0.08);

    let burn = el.periapsis < minPe + 4000;
    if (!el.closed && el.periapsis > minPe) burn = false;
    // Throttle to a target thrust acceleration. Full throttle the whole way
    // up would pull over 5 g late in the first stage and tear through max-Q.
    const targetAccel = alt < 22000 ? 20 : 40;
    const want = clamp((targetAccel * ship.mass) / Math.max(1, ship.maxThrust), 0, 1);
    game.throttle = burn ? want : 0;

    if (ship.needsStaging) { input.press('stage'); stagings++; }
    game.update(DT);
    input.endFrame();
  }
  input.clear();

  const el = elementsFromState(game.ship.x, game.ship.y, game.ship.vx, game.ship.vy, body.mu);
  console.log(`       ended ${game.state}: pe=${((el.periapsis - body.radius) / 1000).toFixed(1)} km ` +
    `ap=${el.closed ? ((el.apoapsis - body.radius) / 1000).toFixed(0) + ' km' : 'escape'}, ` +
    `${stagings} stagings, max dynamic pressure ${(maxQ / 1000).toFixed(1)} kPa, ` +
    `MET ${(game.missionTime / 60).toFixed(1)} min`);
  ok('reached Earth orbit', game.state === 'result' && game.result.success === true,
    game.result && !game.result.success ? game.result.reason : '');
  ok('needed multiple stages', stagings >= 1, `${stagings}`);
  ok('atmospheric drag was significant', maxQ > 5000, `${(maxQ / 1000).toFixed(1)} kPa`);
}

// --- hangar editing ---------------------------------------------------------
console.log('hangar editing:');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  game.session.levelIndex = 9;   // everything unlocked
  const design = game.session.design;

  const before = design.stages.length;
  input.press('addStage');
  game.update(DT); input.endFrame();
  ok('N adds a stage', design.stages.length === before + 1);

  // Select the first fuel row and raise it.
  game.hangar.selection = 2;
  const fuel0 = design.stages[0].fuel;
  input.press('right');
  game.update(DT); input.endFrame();
  ok('right increases propellant', design.stages[0].fuel > fuel0,
    `${fuel0} -> ${design.stages[0].fuel}`);

  game.hangar.selection = 0;
  const eng0 = design.stages[0].engineId;
  input.press('right');
  game.update(DT); input.endFrame();
  ok('right cycles the engine', design.stages[0].engineId !== eng0,
    `${eng0} -> ${design.stages[0].engineId}`);

  input.press('stage');
  game.update(DT); input.endFrame();
  ok('X removes the selected stage', design.stages.length === before);

  // Cannot remove the last stage.
  while (design.stages.length > 1) design.stages.pop();
  game.hangar.selection = 0;
  input.press('stage');
  game.update(DT); input.endFrame();
  ok('cannot remove the only stage', design.stages.length === 1);
}

// --- every level is loadable and self-consistent ----------------------------
console.log('all levels load and are internally consistent:');
{
  const input = new StubInput();
  const game = new Game(stubRenderer(), input);
  for (let i = 0; i < LEVELS.length; i++) {
    game.session.credits = 5e6;
    game.loadLevel(i);
    const lvl = LEVELS[i];
    let bad = '';
    if (!lvl.title) bad = 'no title';
    if (!game.body) bad = 'no body';
    if (!lvl.objectives.length) bad = 'no objectives';
    // Every named pad must exist on the body.
    for (const o of lvl.objectives) {
      if (o.type === 'land' && o.pad && !game.body.padByName(o.pad)) bad = `missing pad ${o.pad}`;
    }
    if (lvl.start.pad && !game.body.padByName(lvl.start.pad)) bad = `missing start pad ${lvl.start.pad}`;
    // A vehicle must be buildable that meets the stated delta-v.
    game.session.design = {
      rcs: 3, legs: 3, lifeSupport: Math.ceil(lvl.estDuration / 7200) + 1,
      stages: [
        { engineId: 'bs2', engineCount: 4, fuel: 500000 },
        { engineId: 'bs1', engineCount: 1, fuel: 90000 },
        { engineId: 've1', engineCount: 1, fuel: 20000 },
      ],
    };
    const st = designStats(game.session.design, game.body);
    if (st.deltaV < lvl.estDeltaV) bad = `unreachable dV (${st.deltaV.toFixed(0)} < ${lvl.estDeltaV})`;
    game.launch();
    if (game.state !== 'flying') bad = 'launch failed';
    ok(`L${lvl.id} ${lvl.title}`, bad === '', bad);
  }
}

console.log(failures === 0 ? '\nALL GAME TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
