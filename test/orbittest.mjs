const ROOT = new URL('../js/', import.meta.url).href;
const O = await import(ROOT + 'orbit.js');

const MU_LUNA = 4.9048695e12;
const R_LUNA = 1737400;

let failures = 0;
function ok(name, cond, detail = '') {
  if (!cond) { failures++; console.log(`  FAIL ${name} ${detail}`); }
  else console.log(`  ok   ${name} ${detail}`);
}
function close(a, b, tol, name) {
  const err = Math.abs(a - b) / Math.max(1, Math.abs(b));
  ok(name, err < tol, `rel=${err.toExponential(2)}`);
}

// --- circular orbit ---------------------------------------------------------
console.log('circular orbit, 100 km altitude:');
{
  const r = R_LUNA + 100000;
  const v = Math.sqrt(MU_LUNA / r);
  const el = O.elementsFromState(r, 0, 0, v, MU_LUNA);
  close(el.a, r, 1e-12, 'a == r');
  ok('e ~ 0', el.e < 1e-12, `e=${el.e.toExponential(2)}`);
  close(el.periapsis, r, 1e-12, 'periapsis == r');
  close(el.apoapsis, r, 1e-12, 'apoapsis == r');
  console.log(`       period = ${(el.period / 60).toFixed(1)} min, v = ${v.toFixed(1)} m/s`);

  // A quarter period should rotate the position by 90 degrees.
  const q = O.propagate(r, 0, 0, v, MU_LUNA, el.period / 4);
  close(Math.atan2(q.y, q.x), Math.PI / 2, 1e-9, 'quarter period -> +90 deg');
  close(Math.hypot(q.x, q.y), r, 1e-9, 'radius unchanged');
  close(Math.hypot(q.vx, q.vy), v, 1e-9, 'speed unchanged');

  // A full period should return to the start.
  const f = O.propagate(r, 0, 0, v, MU_LUNA, el.period);
  close(f.x, r, 1e-9, 'full period -> same x');
  ok('full period -> same y', Math.abs(f.y) < 1e-3, `y=${f.y.toExponential(2)}`);
}

// --- eccentric orbit --------------------------------------------------------
console.log('eccentric orbit (periapsis 50 km, apoapsis 2000 km):');
{
  const rp = R_LUNA + 50000, ra = R_LUNA + 2000000;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(MU_LUNA * (2 / rp - 1 / a));
  const el = O.elementsFromState(rp, 0, 0, vp, MU_LUNA);
  close(el.periapsis, rp, 1e-9, 'periapsis');
  close(el.apoapsis, ra, 1e-9, 'apoapsis');
  console.log(`       e = ${el.e.toFixed(4)}, period = ${(el.period / 3600).toFixed(2)} h`);

  // Half a period from periapsis should put us exactly at apoapsis.
  const h = O.propagate(rp, 0, 0, vp, MU_LUNA, el.period / 2);
  close(Math.hypot(h.x, h.y), ra, 1e-8, 'half period -> apoapsis radius');

  // timeToApoapsis should agree.
  close(O.timeToApoapsis(el), el.period / 2, 1e-9, 'timeToApoapsis from periapsis');
  close(O.timeToPeriapsis(el), 0, 1e-9, 'timeToPeriapsis at periapsis');

  // Energy must be conserved across many chained propagations.
  let s = { x: rp, y: 0, vx: 0, vy: vp };
  const e0 = (vp * vp) / 2 - MU_LUNA / rp;
  for (let i = 0; i < 500; i++) {
    const n = O.propagate(s.x, s.y, s.vx, s.vy, MU_LUNA, 137.7);
    s = { x: n.x, y: n.y, vx: n.vx, vy: n.vy };
  }
  const r1 = Math.hypot(s.x, s.y);
  const e1 = (s.vx * s.vx + s.vy * s.vy) / 2 - MU_LUNA / r1;
  close(e1, e0, 1e-10, 'energy after 500 propagations');
}

// --- retrograde -------------------------------------------------------------
console.log('retrograde circular orbit:');
{
  const r = R_LUNA + 100000;
  const v = Math.sqrt(MU_LUNA / r);
  const el = O.elementsFromState(r, 0, 0, -v, MU_LUNA);
  ok('h negative', el.h < 0, `h=${el.h.toExponential(3)}`);
  ok('sgn = -1', el.sgn === -1);
  const q = O.propagate(r, 0, 0, -v, MU_LUNA, el.period / 4);
  close(Math.atan2(q.y, q.x), -Math.PI / 2, 1e-9, 'quarter period -> -90 deg');
  const f = O.propagate(r, 0, 0, -v, MU_LUNA, el.period);
  close(f.x, r, 1e-9, 'full period -> same x');
}

// --- retrograde eccentric, arbitrary orientation ----------------------------
console.log('retrograde eccentric at an arbitrary orientation:');
{
  const rx = -1.2e6, ry = 2.1e6, vx = 900, vy = 260;
  const el = O.elementsFromState(rx, ry, vx, vy, MU_LUNA);
  console.log(`       e = ${el.e.toFixed(4)}, sgn = ${el.sgn}, closed = ${el.closed}`);
  const back = O.propagate(rx, ry, vx, vy, MU_LUNA, el.period);
  close(back.x, rx, 1e-8, 'full period -> same x');
  close(back.y, ry, 1e-8, 'full period -> same y');
  close(back.vx, vx, 1e-8, 'full period -> same vx');
  close(back.vy, vy, 1e-8, 'full period -> same vy');

  // Propagate forward then back.
  const f = O.propagate(rx, ry, vx, vy, MU_LUNA, 1234.5);
  const g = O.propagate(f.x, f.y, f.vx, f.vy, MU_LUNA, -1234.5);
  close(g.x, rx, 1e-8, 'forward then back -> x');
  close(g.y, ry, 1e-8, 'forward then back -> y');
}

// --- hyperbolic -------------------------------------------------------------
console.log('hyperbolic escape trajectory:');
{
  const r = R_LUNA + 200000;
  const vEsc = Math.sqrt(2 * MU_LUNA / r);
  const v = vEsc * 1.25;
  const el = O.elementsFromState(r, 0, 0, v, MU_LUNA);
  ok('e > 1', el.e > 1, `e=${el.e.toFixed(4)}`);
  ok('not closed', !el.closed);
  ok('apoapsis infinite', !isFinite(el.apoapsis));
  const f = O.propagate(r, 0, 0, v, MU_LUNA, 3600);
  const g = O.propagate(f.x, f.y, f.vx, f.vy, MU_LUNA, -3600);
  close(g.x, r, 1e-7, 'forward then back -> x');
  ok('forward then back -> y', Math.abs(g.y) < 1e-2, `y=${g.y.toExponential(2)}`);
  console.log(`       after 1 h: r = ${(Math.hypot(f.x, f.y) / 1000).toFixed(0)} km`);
}

// --- radius crossing --------------------------------------------------------
console.log('true anomaly at a given radius:');
{
  const rp = R_LUNA + 15000, ra = R_LUNA + 600000;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(MU_LUNA * (2 / rp - 1 / a));
  const el = O.elementsFromState(rp, 0, 0, vp, MU_LUNA);
  const target = R_LUNA + 100000;
  const nu = O.trueAnomalyAtRadius(el, target);
  ok('crossing exists', nu !== null);
  const s = O.stateAtTrueAnomaly(el, nu);
  close(Math.hypot(s.x, s.y), target, 1e-9, 'state at crossing has the right radius');
  ok('no crossing below periapsis', O.trueAnomalyAtRadius(el, R_LUNA - 1000) === null);
}

// --- conic sampling ---------------------------------------------------------
console.log('conic sampling:');
{
  const rp = R_LUNA + 50000, ra = R_LUNA + 900000;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(MU_LUNA * (2 / rp - 1 / a));
  const el = O.elementsFromState(rp, 0, 0, vp, MU_LUNA);
  const pts = O.conicPoints(el, 128);
  const radii = pts.map((p) => Math.hypot(p.x, p.y));
  close(Math.min(...radii), rp, 1e-9, 'min sampled radius == periapsis');
  close(Math.max(...radii), ra, 1e-9, 'max sampled radius == apoapsis');
}

console.log(failures === 0 ? '\nALL ORBIT TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
