import { wrapAngle, DEG, clamp, fmt } from './util.js';

// Three HUD arrangements. Press H in flight to cycle -- the point is to be
// able to judge readability in motion rather than guess at it.
export const HUD_LAYOUTS = ['TOP BAR', 'CORNERS', 'CLUSTER'];

/**
 * @param {object} t telemetry: { altitude, vs, hs, speed, angleDeg, fuel,
 *   fuelCapacity, mass, throttle, tolerance, level, planet, time }
 */
export function drawHUD(r, t, layout) {
  switch (layout) {
    case 1: drawCorners(r, t); break;
    case 2: drawCluster(r, t); break;
    default: drawTopBar(r, t); break;
  }
  drawPadGuidance(r, t);
  drawWarnings(r, t);
}

// --- shared pieces ----------------------------------------------------------

function alertLevel(t) {
  // Amber-equivalent (we only have white): how close touchdown conditions are
  // to violating the envelope, 0..1+, only meaningful when low.
  const sp = t.speed / t.tolerance.speed;
  const an = Math.abs(t.angleDeg) / t.tolerance.angle;
  return Math.max(sp, an);
}

function blink(time, hz = 4) {
  return Math.sin(time * hz * Math.PI * 2) > 0 ? 1 : 0.25;
}

function field(r, label, value, x, y, opts = {}) {
  const size = opts.size || 22;
  r.text(label, x, y, { size: 10, alpha: 0.5, align: opts.align || 'left' });
  r.text(value, x, y + size + 2, {
    size,
    align: opts.align || 'left',
    alpha: opts.alpha ?? 1,
  });
}

// Direction indicators. The neutral case is a space, not a dash, so a value
// sitting at zero does not read as "-0.0".
function vsGlyph(vs) {
  if (vs < -0.15) return 'v';
  if (vs > 0.15) return '^';
  return ' ';
}

function hsGlyph(hs) {
  if (hs < -0.15) return '<';
  if (hs > 0.15) return '>';
  return ' ';
}

// --- layout 0: top bar ------------------------------------------------------

function drawTopBar(r, t) {
  const h = 62;
  r.lineS(0, h, r.w, h, 0.35);

  const cells = 4;
  const cw = r.w / cells;
  for (let i = 1; i < cells; i++) r.lineS(cw * i, 10, cw * i, h - 10, 0.18);

  const pad = 18;
  field(r, 'ALTITUDE  M', fmt(t.altitude, 1, 0), pad, 20);

  const speedAlpha = t.speed > t.tolerance.speed ? blink(t.time) : 1;
  field(
    r,
    'VELOCITY  M/S',
    `${vsGlyph(t.vs)}${fmt(Math.abs(t.vs), 1, 0)}  ${hsGlyph(t.hs)}${fmt(Math.abs(t.hs), 1, 0)}`,
    cw + pad, 20, { alpha: speedAlpha }
  );

  const fuelFrac = t.fuel / t.fuelCapacity;
  field(r, 'FUEL  KG', fmt(t.fuel, 0, 0), cw * 2 + pad, 20, {
    alpha: fuelFrac < 0.15 ? blink(t.time, 2) : 1,
  });
  r.barS(cw * 2 + pad + 78, 26, cw - pad * 2 - 84, 14, fuelFrac);

  const angAlpha = Math.abs(t.angleDeg) > t.tolerance.angle ? blink(t.time) : 1;
  field(
    r,
    'ANGLE FROM VERTICAL',
    `${fmt(Math.abs(t.angleDeg), 0, 0)}° ${t.angleDeg < -0.5 ? 'L' : t.angleDeg > 0.5 ? 'R' : ' '}`,
    cw * 3 + pad, 20, { alpha: angAlpha }
  );

  drawEnvelope(r, t, r.w - 18, h + 20, 'right');
}

// --- layout 1: corners ------------------------------------------------------

function drawCorners(r, t) {
  const m = 24;

  // Altitude, upper left, with a tape down the left edge.
  field(r, 'ALT  M', fmt(t.altitude, 1, 0), m, m, { size: 30 });
  drawAltitudeTape(r, t, m - 8, m + 76, r.h - m * 2 - 140);

  // Fuel, upper right.
  const fuelFrac = t.fuel / t.fuelCapacity;
  field(r, 'FUEL  KG', fmt(t.fuel, 0, 0), r.w - m, m, {
    size: 30, align: 'right', alpha: fuelFrac < 0.15 ? blink(t.time, 2) : 1,
  });
  r.vbarS(r.w - m - 14, m + 76, 14, 130, fuelFrac);

  // Velocity, lower left.
  const speedAlpha = t.speed > t.tolerance.speed ? blink(t.time) : 1;
  field(r, 'DESCENT  M/S', `${vsGlyph(t.vs)}${fmt(Math.abs(t.vs), 1, 0)}`,
    m, r.h - m - 92, { size: 24, alpha: speedAlpha });
  field(r, 'LATERAL  M/S', `${hsGlyph(t.hs)}${fmt(Math.abs(t.hs), 1, 0)}`,
    m, r.h - m - 34, { size: 24, alpha: speedAlpha });

  // Attitude, top centre. Centre sits a full radius down so the arc clears
  // the top edge.
  drawAttitudeArc(r, t, r.w / 2, m + 78, 74);
  drawEnvelope(r, t, r.w - m, r.h - m, 'right');
}

// --- layout 2: cluster ------------------------------------------------------

function drawCluster(r, t) {
  const m = 24;
  const y0 = r.h - m - 120;
  const speedAlpha = t.speed > t.tolerance.speed ? blink(t.time) : 1;
  const rows = [
    ['ALT', `${fmt(t.altitude, 1, 7)} M`, 1],
    ['VS', `${fmt(t.vs, 1, 7)} M/S`, speedAlpha],
    ['HS', `${fmt(t.hs, 1, 7)} M/S`, speedAlpha],
    ['ANG', `${fmt(t.angleDeg, 0, 7)} DEG`,
      Math.abs(t.angleDeg) > t.tolerance.angle ? blink(t.time) : 1],
  ];
  rows.forEach(([label, value], i) => {
    const y = y0 + i * 24;
    r.text(label, m, y, { size: 12, alpha: 0.5 });
    r.text(value, m + 46, y, { size: 16, alpha: rows[i][2] });
  });

  const fuelFrac = t.fuel / t.fuelCapacity;
  r.text('FUEL', m, y0 + 4 * 24 + 6, { size: 12, alpha: 0.5 });
  r.barS(m + 46, y0 + 4 * 24 - 6, 150, 11, fuelFrac);
  r.text(`${fmt(t.fuel, 0, 0)} KG`, m + 206, y0 + 4 * 24 + 4, { size: 12, alpha: 0.7 });

  drawAttitudeArc(r, t, r.w - m - 78, r.h - m - 78, 68);
  drawEnvelope(r, t, m, m + 12, 'left');
}

// --- widgets ----------------------------------------------------------------

/** The touchdown limits for this level, so the player always knows the target. */
function drawEnvelope(r, t, x, y, align) {
  const txt = `TOUCHDOWN LIMIT  ${t.tolerance.speed.toFixed(1)} M/S  /  ${Math.round(t.tolerance.angle)}°`;
  r.text(txt, x, y, { size: 11, alpha: 0.45, align });
}

function drawAltitudeTape(r, t, x, y, height) {
  // Log-ish scale: fine detail near the ground, compressed high up.
  const maxAlt = 500;
  const frac = clamp(Math.sqrt(clamp(t.altitude, 0, maxAlt) / maxAlt), 0, 1);
  r.lineS(x, y, x, y + height, 0.3);
  for (let i = 0; i <= 5; i++) {
    const ty = y + height * (1 - i / 5);
    r.lineS(x, ty, x + (i % 5 === 0 ? 12 : 7), ty, 0.3);
    const label = Math.round(maxAlt * (i / 5) ** 2);
    r.text(String(label), x + 16, ty + 4, { size: 9, alpha: 0.35 });
  }
  const my = y + height * (1 - frac);
  r.lineS(x - 7, my, x + 14, my, 1, 1.6);
}

function drawAttitudeArc(r, t, cx, cy, radius) {
  const ctx = r.ctx;
  const limit = t.tolerance.angle / DEG;

  // Outer arc.
  r.stroke(0.35, 1, false);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();

  // The acceptable-tilt wedge, drawn brighter: land inside it.
  r.stroke(0.75, 2, false);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2 - limit, -Math.PI / 2 + limit);
  ctx.stroke();
  r.reset();

  for (let d = -90; d <= 90; d += 30) {
    const a = -Math.PI / 2 + d / DEG;
    const inner = d === 0 ? radius - 14 : radius - 8;
    r.lineS(
      cx + Math.cos(a) * inner, cy + Math.sin(a) * inner,
      cx + Math.cos(a) * radius, cy + Math.sin(a) * radius,
      d === 0 ? 0.8 : 0.3
    );
  }

  // Needle: points where the ship's nose points.
  const a = -Math.PI / 2 + t.angleDeg / DEG;
  const over = Math.abs(t.angleDeg) > t.tolerance.angle;
  r.lineS(cx, cy, cx + Math.cos(a) * (radius - 6), cy + Math.sin(a) * (radius - 6),
    over ? blink(t.time) : 1, 1.5);
  r.text(`${fmt(Math.abs(t.angleDeg), 0, 0)}°`, cx, cy + 20,
    { size: 14, align: 'center', alpha: 0.85 });
}

/** Edge chevron pointing at the nearest landing pad when it is off-screen. */
function drawPadGuidance(r, t) {
  if (!t.padTarget) return;
  const dx = t.padTarget.cx - t.shipX;
  const halfView = r.halfViewW;
  if (Math.abs(dx) < halfView * 0.85) return;

  const dir = Math.sign(dx);
  const x = dir > 0 ? r.w - 26 : 26;
  const y = r.h / 2;
  const s = 12;
  r.lineS(x - s * dir, y - s, x, y, 0.8, 1.4);
  r.lineS(x, y, x - s * dir, y + s, 0.8, 1.4);
  r.text(`PAD ${Math.round(Math.abs(dx))}M`, dir > 0 ? x - 14 : x + 14, y + 30,
    { size: 11, align: dir > 0 ? 'right' : 'left', alpha: 0.6 });
}

function drawWarnings(r, t) {
  const msgs = [];
  if (t.fuel <= 0) msgs.push('PROPELLANT EXHAUSTED');
  else if (t.fuel / t.fuelCapacity < 0.12) msgs.push('LOW PROPELLANT');
  if (t.altitude < 60 && alertLevel(t) > 1) msgs.push('APPROACH UNSTABLE');
  if (t.outOfBounds) msgs.push('LEAVING LANDING ZONE');

  msgs.forEach((m, i) => {
    r.text(m, r.w / 2, r.h - 34 - i * 20, {
      size: 13, align: 'center', alpha: blink(t.time, 2.5),
    });
  });
}

/** Build the telemetry object the HUD consumes. */
export function telemetry(ship, terrain, level, tolerance, time, outOfBounds) {
  return {
    altitude: Math.max(0, ship.clearance(terrain)),
    vs: ship.vy,
    hs: ship.vx,
    speed: ship.speed,
    angleDeg: wrapAngle(ship.angle) * DEG,
    fuel: ship.fuel,
    fuelCapacity: ship.stats.fuelCapacity,
    mass: ship.mass,
    throttle: ship.spool,
    tolerance,
    level,
    time,
    shipX: ship.x,
    padTarget: terrain.nearestPad(ship.x),
    outOfBounds,
  };
}
