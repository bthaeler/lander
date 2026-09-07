const ROOT = new URL('../js/', import.meta.url).href;
const { Body } = await import(ROOT + 'body.js');
const { Ship } = await import(ROOT + 'ship.js');
const { BODIES, RCS_TIERS } = await import(ROOT + 'config.js');
const D = await import(ROOT + 'design.js');
const O = await import(ROOT + 'orbit.js');

let failures = 0;
function ok(name, cond, detail = '') {
  if (!cond) { failures++; console.log(`  FAIL ${name} ${detail}`); }
  else console.log(`  ok   ${name} ${detail}`);
}

const luna = new Body(BODIES.luna);
const earth = new Body(BODIES.earth);

// --- body -------------------------------------------------------------------
console.log('body:');
{
  ok('surface gravity ~1.62', Math.abs(luna.surfaceGravity() - 1.625) < 0.01,
    `g=${luna.surfaceGravity().toFixed(4)}`);
  ok('earth surface gravity ~9.82', Math.abs(earth.surfaceGravity() - 9.82) < 0.02,
    `g=${earth.surfaceGravity().toFixed(3)}`);

  // Terrain must be periodic: theta and theta+2pi are the same ground.
  const a = luna.surfaceRadius(0.7);
  const b = luna.surfaceRadius(0.7 + Math.PI * 2);
  ok('terrain periodic', Math.abs(a - b) < 1e-6, `d=${Math.abs(a - b).toExponential(2)}`);

  // Relief should be interesting but bounded.
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const h = luna.terrainHeight((i / 20000) * Math.PI * 2);
    min = Math.min(min, h); max = Math.max(max, h);
  }
  console.log(`       luna relief: ${(min / 1000).toFixed(2)} .. ${(max / 1000).toFixed(2)} km`);
  ok('relief bounded', max - min > 1000 && max - min < 20000);

  // Continuity: no cliffs between adjacent samples at landing scale.
  let worst = 0;
  const step = 5 / luna.radius;  // 5 m of arc
  for (let i = 0; i < 4000; i++) {
    const t = i * step;
    worst = Math.max(worst, Math.abs(luna.surfaceRadius(t + step) - luna.surfaceRadius(t)));
  }
  ok('no cliffs over 5 m of arc', worst < 6, `max step = ${worst.toFixed(2)} m`);

  // Pads are flat and findable.
  for (const pad of luna.pads) {
    const rs = [-0.9, -0.4, 0, 0.4, 0.9].map((f) =>
      luna.surfaceRadius(pad.theta + f * pad.halfAngle));
    const flat = Math.max(...rs) - Math.min(...rs);
    ok(`pad ${pad.name} flat`, flat < 1e-6, `spread=${flat.toExponential(2)}`);
    ok(`pad ${pad.name} found by padAt`, luna.padAt(pad.theta) === pad);
    ok(`pad ${pad.name} slope ~0`, Math.abs(luna.slopeAt(pad.theta)) < 1e-9);
  }
  ok('padAt off-pad returns null', luna.padAt(1.7) === null);
}

// --- gravity vs. orbit ------------------------------------------------------
console.log('numerically integrated circular orbit (checks gravityAt):');
{
  const r = luna.radius + 100000;
  const v = luna.circularSpeed(r);
  let x = r, y = 0, vx = 0, vy = v;
  const dt = 1 / 120;
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / luna.mu);
  const steps = Math.round(period / dt);
  for (let i = 0; i < steps; i++) {
    const g = luna.gravityAt(x, y);
    vx += g.ax * dt; vy += g.ay * dt;
    x += vx * dt; y += vy * dt;
  }
  const rEnd = Math.hypot(x, y);
  const drift = Math.abs(rEnd - r);
  ok('radius holds over one orbit', drift < 500, `drift=${drift.toFixed(1)} m over ${(period / 60).toFixed(0)} min`);
}

// --- design -----------------------------------------------------------------
console.log('design model:');
{
  const d = D.createDesign();
  const s = D.designStats(d, luna);
  console.log(`       single stage: wet=${s.wetMass.toFixed(0)} kg dV=${s.deltaV.toFixed(0)} m/s ` +
    `TWR=${s.liftoffTWR.toFixed(2)} cost=${s.cost}`);
  ok('single stage has usable dV', s.deltaV > 400 && s.deltaV < 3000);
  ok('single stage lifts off Luna', s.liftoffTWR > 1);

  // Staging must beat a single stage of the same total propellant.
  const single = { rcs: 0, legs: 0, lifeSupport: 1, stages: [{ engineId: 've1', engineCount: 1, fuel: 20000 }] };
  const twoStage = {
    rcs: 0, legs: 0, lifeSupport: 1,
    stages: [
      { engineId: 've1', engineCount: 1, fuel: 14000 },
      { engineId: 'lm2', engineCount: 1, fuel: 6000 },
    ],
  };
  const a = D.designStats(single, luna).deltaV;
  const b = D.designStats(twoStage, luna).deltaV;
  console.log(`       20 t propellant: single=${a.toFixed(0)} m/s  two-stage=${b.toFixed(0)} m/s`);
  ok('staging increases delta-v', b > a);

  // Earth orbit must be out of reach for one stage and reachable with three.
  const bigSingle = { rcs: 1, legs: 1, lifeSupport: 2, stages: [{ engineId: 'bs2', engineCount: 4, fuel: 500000 }] };
  const dvSingle = D.designStats(bigSingle, earth).deltaV;
  console.log(`       one huge stage on Earth: ${dvSingle.toFixed(0)} m/s (need 9400)`);
  ok('single stage cannot reach Earth orbit', dvSingle < 9400);

  const stack = {
    rcs: 1, legs: 1, lifeSupport: 2,
    stages: [
      { engineId: 'bs2', engineCount: 4, fuel: 420000 },
      { engineId: 'bs1', engineCount: 1, fuel: 90000 },
      { engineId: 've1', engineCount: 1, fuel: 16000 },
    ],
  };
  const st = D.designStats(stack, earth);
  console.log(`       three-stage on Earth: ${st.deltaV.toFixed(0)} m/s, ` +
    `TWR=${st.liftoffTWR.toFixed(2)}, wet=${(st.wetMass / 1000).toFixed(0)} t`);
  ok('three-stage reaches Earth orbit dV', st.deltaV > 9400);
  ok('three-stage lifts off Earth', st.liftoffTWR > 1.2);
}

// --- ship: hover ------------------------------------------------------------
console.log('ship hover (thrust balancing weight holds altitude):');
{
  const d = D.createDesign();
  const stats = D.designStats(d, luna);
  const pad = luna.padByName('alpha');
  const r = pad.r + 200;
  const ship = new Ship(d, stats.payload.mass, {
    x: r * Math.cos(pad.theta), y: r * Math.sin(pad.theta),
    vx: 0, vy: 0, angle: pad.theta, rcsTorque: RCS_TIERS[0].torque,
  });
  const dt = 1 / 120;
  let minAlt = Infinity, maxAlt = -Infinity;
  for (let i = 0; i < 120 * 30; i++) {
    // Throttle to exactly cancel weight.
    const m = ship.mass;
    const g = luna.mu / (ship.x ** 2 + ship.y ** 2);
    const need = (m * g) / ship.maxThrust;
    ship.step(dt, luna, { rotate: 0, throttle: Math.min(1, need) });
    const alt = luna.altitudeAt(ship.x, ship.y);
    minAlt = Math.min(minAlt, alt); maxAlt = Math.max(maxAlt, alt);
  }
  console.log(`       altitude over 30 s: ${minAlt.toFixed(1)} .. ${maxAlt.toFixed(1)} m, ` +
    `fuel left ${ship.fuel.toFixed(0)} kg`);
  ok('hover holds altitude within 5 m', maxAlt - minAlt < 5);
  ok('hover burns propellant', ship.fuel < 400);
}

// --- ship: staging ----------------------------------------------------------
console.log('ship staging:');
{
  const d = {
    rcs: 0, legs: 0, lifeSupport: 1,
    stages: [
      { engineId: 'lm2', engineCount: 1, fuel: 2000 },
      { engineId: 'lm1', engineCount: 1, fuel: 500 },
    ],
  };
  const stats = D.designStats(d, luna);
  const ship = new Ship(d, stats.payload.mass, { x: luna.radius + 1e5, y: 0, angle: 0 });
  const m0 = ship.mass;
  ok('starts on stage 0', ship.activeStage === 0 && ship.maxThrust === 48e3);
  ok('mass matches design', Math.abs(m0 - stats.wetMass) < 1e-6,
    `ship=${m0.toFixed(1)} design=${stats.wetMass.toFixed(1)}`);
  const lenBefore = ship.length;
  ship.jettison();
  ok('staging drops mass', ship.mass < m0, `${m0.toFixed(0)} -> ${ship.mass.toFixed(0)} kg`);
  ok('staging switches engine', ship.maxThrust === 16e3);
  ok('staging shortens the stack', ship.length < lenBefore,
    `${lenBefore.toFixed(1)} -> ${ship.length.toFixed(1)} m`);
  ok('cannot stage past the last', !ship.canStage() && ship.jettison() === false);
}

// --- ship: coast matches the analytic conic --------------------------------
console.log('numerical coast agrees with analytic propagation:');
{
  const d = D.createDesign();
  const stats = D.designStats(d, luna);
  const r = luna.radius + 150000;
  const v = luna.circularSpeed(r) * 1.12;   // mildly elliptical
  const ship = new Ship(d, stats.payload.mass, { x: r, y: 0, vx: 0, vy: v, angle: 0 });
  const dt = 1 / 120;
  const T = 900;
  for (let i = 0; i < T / dt; i++) ship.step(dt, luna, { rotate: 0, throttle: 0 });
  const an = O.propagate(r, 0, 0, v, luna.mu, T);
  const err = Math.hypot(ship.x - an.x, ship.y - an.y);
  console.log(`       after ${T} s coasting, disagreement = ${err.toFixed(1)} m`);
  ok('analytic and numerical agree within 200 m', err < 200);
}

console.log(failures === 0 ? '\nALL PHYSICS TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
