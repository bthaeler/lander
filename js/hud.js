import { COLORS, WARP_LEVELS, HOLD_LABELS } from './config.js';
import { elementsFromState, timeToApoapsis, timeToPeriapsis } from './orbit.js';
import {
  clamp, wrapAngle, DEG, fmt, fmtDistance, fmtSpeed, fmtTime, fmtMass,
} from './util.js';

// Three arrangements, cycled with H. Instrument placement is genuinely hard to
// judge statically, so it stays switchable in flight.
export const HUD_LAYOUTS = ['TOP BAR', 'CORNERS', 'CLUSTER'];

/** Collect everything the HUD needs from the game. */
export function telemetry(game) {
  const ship = game.ship;
  const body = game.body;
  const r = ship.radiusFromCentre;
  const el = elementsFromState(ship.x, ship.y, ship.vx, ship.vy, body.mu);

  // Split velocity into radial (climb/sink) and tangential (downrange).
  const ur = { x: ship.x / r, y: ship.y / r };
  const ut = { x: -ur.y, y: ur.x };
  const vs = ship.vx * ur.x + ship.vy * ur.y;
  const hs = ship.vx * ut.x + ship.vy * ut.y;

  // Ground offset to the site we are trying to reach. The camera keeps local
  // up at screen up, and increasing theta maps to screen LEFT, so the sign
  // can be reported as a direction the player can act on directly.
  const active = game.mission.active;
  const targetPad = active && active.type === 'land' && active.pad
    ? body.padByName(active.pad)
    : null;
  const theta = Math.atan2(ship.y, ship.x);
  const downrange = targetPad
    ? wrapAngle(targetPad.theta - theta) * body.radius
    : null;

  return {
    targetPad,
    downrange,
    body,
    ship,
    altitude: Math.max(0, body.altitudeAt(ship.x, ship.y)),
    vs,
    hs,
    speed: ship.speed,
    tiltDeg: ship.tilt * DEG,
    fuel: ship.fuel,
    fuelCapacity: ship.fuelCapacity,
    totalFuel: ship.totalFuel,
    throttle: ship.spool,          // actual engine output
    throttleSet: game.throttle,     // commanded lever position
    stageIndex: ship.activeStage,
    stageCount: ship.stages.length,
    canStage: ship.canStage(),
    needsStaging: ship.needsStaging,
    landed: ship.landed,
    elements: el,
    apoAlt: el.closed ? el.apoapsis - body.radius : Infinity,
    perAlt: el.periapsis - body.radius,
    tApo: el.closed ? timeToApoapsis(el) : Infinity,
    tPer: timeToPeriapsis(el),
    radial: el.radial,
    tImpact: ship.landed ? Infinity : game.timeToImpact(),
    orbital: r > body.radius * 1.002,
    envelope: game.envelope,
    mission: game.mission,
    missionTime: game.missionTime,
    lifeRemaining: game.lifeRemaining,
    lifeTotal: game.lifeTotal || game.lifeRemaining,
    warp: WARP_LEVELS[game.warpIndex],
    holdMode: game.holdMode,
    mapView: game.mapView,
    level: game.level,
    time: game.time,
    prograde: Math.atan2(ship.vy, ship.vx),
    upAngle: ship.upAngle,
    camRot: game.r.camera.rot,
  };
}

export function drawHUD(r, t, layout) {
  switch (layout) {
    case 1: drawCorners(r, t); break;
    case 2: drawCluster(r, t); break;
    default: drawTopBar(r, t); break;
  }
  drawMissionPanel(r, t, layout);
  drawStatusPanel(r, t);
  drawWarnings(r, t);
}

// --- helpers ----------------------------------------------------------------

function blink(time, hz = 4) {
  return Math.sin(time * hz * Math.PI * 2) > 0 ? 1 : 0.3;
}

function field(r, label, value, x, y, opts = {}) {
  const size = opts.size || 22;
  r.text(label, x, y, { size: 10, alpha: 0.5, align: opts.align || 'left' });
  r.text(value, x, y + size + 2, {
    size, align: opts.align || 'left',
    alpha: opts.alpha ?? 1, color: opts.color || COLORS.ui,
  });
}

function vsGlyph(v) { return v < -0.15 ? 'v' : v > 0.15 ? '^' : ' '; }
function hsGlyph(v) { return v < -0.15 ? '<' : v > 0.15 ? '>' : ' '; }

/** Is a landing the thing we are currently trying to do? */
function landingPhase(t) {
  const a = t.mission.active;
  return !!a && a.type === 'land' && t.altitude < 8000;
}

// --- layouts ----------------------------------------------------------------

function drawTopBar(r, t) {
  const h = 62;
  r.lineS(0, h, r.w, h, COLORS.ui, 0.3);
  const cells = 4;
  const cw = r.w / cells;
  for (let i = 1; i < cells; i++) r.lineS(cw * i, 10, cw * i, h - 10, COLORS.ui, 0.15);

  const pad = 18;
  field(r, 'ALTITUDE', fmtDistance(t.altitude), pad, 20);

  const fast = landingPhase(t) && t.speed > t.envelope.speed;
  field(r, 'VELOCITY',
    `${vsGlyph(t.vs)}${fmtSpeed(Math.abs(t.vs))}`,
    cw + pad, 20, { alpha: fast ? blink(t.time) : 1, size: 20 });
  r.text(`${hsGlyph(t.hs)} ${fmtSpeed(Math.abs(t.hs))} DOWNRANGE`, cw + pad, 56,
    { size: 10, alpha: 0.5 });

  const frac = t.fuel / Math.max(1, t.fuelCapacity);
  field(r, `PROPELLANT  STAGE ${t.stageIndex + 1}/${t.stageCount}`,
    fmtMass(t.fuel), cw * 2 + pad, 20, {
      size: 20, alpha: frac < 0.12 ? blink(t.time, 2) : 1,
    });
  r.barS(cw * 2 + pad + 118, 26, cw - pad * 2 - 124, 13, frac, COLORS.ui);

  const steep = landingPhase(t) && Math.abs(t.tiltDeg) > t.envelope.angle;
  field(r, 'ANGLE FROM VERTICAL',
    `${fmt(Math.abs(t.tiltDeg), 0, 0)}° ${t.tiltDeg > 0.5 ? 'R' : t.tiltDeg < -0.5 ? 'L' : ' '}`,
    cw * 3 + pad, 20, { alpha: steep ? blink(t.time) : 1 });

  drawOrbitBlock(r, t, r.w - 20, h + 26, 'right');
  if (landingPhase(t)) drawEnvelope(r, t, 20, h + 26, 'left');
}

function drawCorners(r, t) {
  const m = 24;
  field(r, 'ALT', fmtDistance(t.altitude), m, m + 44, { size: 28 });

  const frac = t.fuel / Math.max(1, t.fuelCapacity);
  field(r, `PROP  ST${t.stageIndex + 1}/${t.stageCount}`, fmtMass(t.fuel),
    r.w - m, m + 44, {
      size: 26, align: 'right', alpha: frac < 0.12 ? blink(t.time, 2) : 1,
    });
  r.vbarS(r.w - m - 14, m + 92, 14, 120, frac, COLORS.ui);

  const fast = landingPhase(t) && t.speed > t.envelope.speed;
  field(r, 'CLIMB / SINK', `${vsGlyph(t.vs)}${fmtSpeed(Math.abs(t.vs))}`,
    m, r.h - m - 96, { size: 22, alpha: fast ? blink(t.time) : 1 });
  field(r, 'DOWNRANGE', `${hsGlyph(t.hs)}${fmtSpeed(Math.abs(t.hs))}`,
    m, r.h - m - 38, { size: 22, alpha: fast ? blink(t.time) : 1 });

  // Clears the mission panel above it.
  drawAttitude(r, t, r.w / 2, m + 152, 72);
  drawOrbitBlock(r, t, r.w - m, r.h - m - 96, 'right');
  if (landingPhase(t)) drawEnvelope(r, t, r.w / 2, m + 246, 'center');
}

function drawCluster(r, t) {
  const m = 24;
  const y0 = r.h - m - 132;
  const fast = landingPhase(t) && t.speed > t.envelope.speed;
  const rows = [
    ['ALT', fmtDistance(t.altitude), 1],
    ['VS', `${fmt(t.vs, 1, 0)} M/S`, fast ? blink(t.time) : 1],
    ['HS', `${fmt(t.hs, 1, 0)} M/S`, fast ? blink(t.time) : 1],
    ['ANG', `${fmt(t.tiltDeg, 0, 0)} DEG`,
      landingPhase(t) && Math.abs(t.tiltDeg) > t.envelope.angle ? blink(t.time) : 1],
  ];
  rows.forEach(([label, value, alpha], i) => {
    const y = y0 + i * 24;
    r.text(label, m, y, { size: 12, alpha: 0.5 });
    r.text(value, m + 52, y, { size: 16, alpha });
  });

  const frac = t.fuel / Math.max(1, t.fuelCapacity);
  const fy = y0 + 4 * 24 + 4;
  r.text(`ST${t.stageIndex + 1}`, m, fy, { size: 12, alpha: 0.5 });
  r.barS(m + 52, fy - 10, 150, 11, frac, COLORS.ui);
  r.text(fmtMass(t.fuel), m + 212, fy, { size: 12, alpha: 0.7 });

  drawAttitude(r, t, r.w - m - 76, r.h - m - 78, 66);
  drawOrbitBlock(r, t, m, m + 130, 'left');
  if (landingPhase(t)) drawEnvelope(r, t, m, m + 112, 'left');
}

// --- shared blocks ----------------------------------------------------------

/** Apoapsis / periapsis, the two numbers that define an orbit. */
function drawOrbitBlock(r, t, x, y, align) {
  if (!t.orbital && !t.mapView) return;
  const rows = [
    ['AP', t.elements.closed ? fmtDistance(t.apoAlt) : 'ESCAPE',
      t.elements.closed ? fmtTime(t.tApo) : '', COLORS.apoapsis],
    // Periapsis altitude is worth reading while it is near the surface -- that
    // is how you watch a circularisation burn work. Once it is deep inside the
    // body the number stops meaning anything (a radial trajectory's periapsis
    // is the centre itself), so show the clock to impact instead.
    ['PE',
      t.perAlt < -t.body.radius * 0.25 ? 'IMPACT' : fmtDistance(t.perAlt),
      fmtTime(t.perAlt <= 0 ? t.tImpact : t.tPer),
      t.perAlt <= 0 ? COLORS.danger : COLORS.periapsis],
    ['V', fmtSpeed(t.speed), '', COLORS.ui],
  ];
  let yy = y;
  for (const [label, value, when, color] of rows) {
    if (align === 'right') {
      r.text(label, x - 168, yy, { size: 11, alpha: 0.55, color });
      r.text(value, x - 62, yy, { size: 13, align: 'right', color });
      if (when) r.text(`T ${when}`, x, yy, { size: 11, align: 'right', alpha: 0.45 });
    } else {
      r.text(label, x, yy, { size: 11, alpha: 0.55, color });
      r.text(value, x + 106, yy, { size: 13, align: 'right', color });
      if (when) r.text(`T ${when}`, x + 168, yy, { size: 11, align: 'right', alpha: 0.45 });
    }
    yy += 19;
  }
  if (t.elements.closed && isFinite(t.elements.period)) {
    const label = `PERIOD ${fmtTime(t.elements.period)}`;
    r.text(label, align === 'right' ? x : x, yy,
      { size: 10, align: align === 'right' ? 'right' : 'left', alpha: 0.4 });
  }
}

function drawEnvelope(r, t, x, y, align) {
  r.text(
    `TOUCHDOWN LIMIT  ${t.envelope.speed.toFixed(1)} M/S  /  ${Math.round(t.envelope.angle)}°`,
    x, y, { size: 11, alpha: 0.5, align, color: COLORS.warn }
  );
}

/**
 * Attitude dial. The camera keeps local up at screen up, so the needle also
 * reads directly against the horizon; this exists for when the ship is only a
 * few pixels tall and for the prograde cue.
 */
function drawAttitude(r, t, cx, cy, radius) {
  const ctx = r.ctx;
  const limit = t.envelope.angle / DEG;

  r.stroke(COLORS.ui, 0.3, 1, false);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();

  if (landingPhase(t)) {
    r.stroke(COLORS.good, 0.7, 2, false);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2 - limit, -Math.PI / 2 + limit);
    ctx.stroke();
  }
  r.reset();

  for (let d = -90; d <= 90; d += 30) {
    const a = -Math.PI / 2 + d / DEG;
    const inner = d === 0 ? radius - 13 : radius - 7;
    r.lineS(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner,
      cx + Math.cos(a) * radius, cy + Math.sin(a) * radius,
      COLORS.ui, d === 0 ? 0.75 : 0.3);
  }

  // Prograde: where the velocity vector points, relative to local up.
  if (t.speed > 1) {
    const rel = wrapAngle(t.prograde - t.upAngle);
    const a = -Math.PI / 2 - rel;
    const px = cx + Math.cos(a) * (radius - 16);
    const py = cy + Math.sin(a) * (radius - 16);
    r.stroke(COLORS.prograde, 0.9, 1.1, true);
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.stroke();
    r.reset();
  }

  // Ship nose.
  const a = -Math.PI / 2 + t.tiltDeg / DEG;
  const over = landingPhase(t) && Math.abs(t.tiltDeg) > t.envelope.angle;
  r.lineS(cx, cy, cx + Math.cos(a) * (radius - 6), cy + Math.sin(a) * (radius - 6),
    over ? COLORS.danger : COLORS.ui, over ? blink(t.time) : 1, 1.5);
  r.text(`${fmt(Math.abs(t.tiltDeg), 0, 0)}°`, cx, cy + 20,
    { size: 13, align: 'center', alpha: 0.85 });
}

/**
 * Active objective and progress, top centre. The TOP BAR layout already owns
 * the strip across the top, so this drops below it in that layout.
 */
function drawMissionPanel(r, t, layout) {
  const y = layout === 0 ? 88 : 22;
  const active = t.mission.active;
  const label = active ? active.label : 'RETURNING';
  r.text(`OBJECTIVE ${t.mission.progress}`, r.w / 2, y,
    { size: 10, align: 'center', alpha: 0.5 });
  r.text(label, r.w / 2, y + 18, { size: 13, align: 'center', color: COLORS.accent });

  // Where the target site is, relative to the ship's ground track.
  if (t.targetPad && t.downrange !== null) {
    const d = t.downrange;
    const dir = Math.abs(d) < 20 ? 'BELOW' : d > 0 ? '< LEFT' : 'RIGHT >';
    r.text(`${t.targetPad.label}   ${fmtDistance(Math.abs(d))}   ${dir}`,
      r.w / 2, y + 34, { size: 11, align: 'center', alpha: 0.6, color: COLORS.pad });
  }
}

/** Warp, mission clock and life support -- bottom centre. */
function drawStatusPanel(r, t) {
  const y = r.h - 18;
  const parts = [];
  parts.push(t.warp > 1 ? `WARP ${t.warp}x` : 'WARP 1x');
  parts.push(`MET ${fmtTime(t.missionTime)}`);
  parts.push(`LS ${fmtTime(t.lifeRemaining)}`);
  if (t.holdMode) parts.push(HOLD_LABELS[t.holdMode]);
  if (t.mapView) parts.push('MAP');
  if (t.landed) parts.push('LANDED');

  const text = parts.join('    ');
  const lifeLow = t.lifeRemaining < 900;
  r.text(text, r.w / 2, y, {
    size: 11, align: 'center',
    alpha: lifeLow ? blink(t.time, 1.5) : 0.55,
    color: lifeLow ? COLORS.warn : COLORS.ui,
  });

  r.text(`${t.level.title}  /  ${t.body.name}`, r.w / 2, y - 16,
    { size: 10, align: 'center', alpha: 0.32 });

  // Throttle: the tape shows actual engine output, the number shows the
  // commanded lever, so spool-up is visible and the setting is never a guess.
  const th = 90;
  const ty = r.h - 16 - th;
  r.vbarS(5, ty, 7, th, t.throttle, COLORS.flame, 0.85);
  r.text(`${Math.round(t.throttleSet * 100)}%`, 5, ty - 7,
    { size: 10, alpha: 0.6, color: COLORS.flame });
}

function drawWarnings(r, t) {
  const msgs = [];
  if (t.needsStaging) msgs.push('STAGE EMPTY — PRESS X TO SEPARATE');
  else if (t.fuel <= 0 && !t.canStage) msgs.push('PROPELLANT EXHAUSTED');
  else if (t.fuel / Math.max(1, t.fuelCapacity) < 0.1) msgs.push('LOW PROPELLANT');
  if (t.lifeRemaining < 600) msgs.push('LIFE SUPPORT CRITICAL');
  // Only worth saying when you are trying to be in an orbit: coasting, moving
  // sideways fast, and high up. On a vertical hop the periapsis is the body's
  // centre by definition, and under a landing burn hitting the ground is the
  // plan -- warning about either is pure noise.
  const circular = Math.sqrt(t.body.mu / (t.body.radius + t.altitude));
  const orbitLike = Math.abs(t.hs) > circular * 0.4;
  if (t.perAlt <= 0 && t.orbital && !t.landed && orbitLike && t.throttle < 0.02) {
    msgs.push('TRAJECTORY INTERSECTS SURFACE');
  }

  msgs.forEach((m, i) => {
    r.text(m, r.w / 2, r.h - 58 - i * 19, {
      size: 12, align: 'center', color: COLORS.warn, alpha: blink(t.time, 2.5),
    });
  });
}
