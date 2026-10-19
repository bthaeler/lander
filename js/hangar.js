// The hangar. You start every level here, read what the mission demands, and
// design a rocket to meet it. Every part is a mass decision, and you pay the
// build cost at launch.

import {
  COLORS, LIFE_SUPPORT, RCS_TIERS, LEG_TIERS, COMPUTER_TIERS, CAPSULE, TANK,
  tankStep, engineById, LEVELS, REPLAY_DECAY,
  difficultyAt, touchdownEnvelope, bonusesFor, maxPayout,
} from './config.js';
import {
  designStats, availableEngines, addStage, removeStage, adjustFuel, cycleEngine,
  suggestDesign,
} from './design.js';
import { clamp, fmtDistance, fmtSpeed, fmtMass, fmtTime } from './util.js';

const MAX_ENGINES_PER_STAGE = 8;
const MAX_STAGES = 5;
const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 1 / 14;

export class Hangar {
  constructor() {
    this.selection = 0;
    this.message = '';
    this.messageTime = 0;
    this.holdTime = 0;
    this.repeatTimer = 0;
    this.dt = 1 / 60;
    // Columns scroll when the screen is too short for them (a phone held
    // sideways). Offsets, content heights and on-screen extents per column,
    // plus the editor's row positions in content coordinates for tapping.
    this.scroll = {};
    this.content = {};
    this.views = {};
    this.rowRects = [];
    this.reveal = false;   // scroll the editor to the selection on next draw
  }

  reset() {
    this.selection = 0;
    this.scroll = {};
    this.reveal = true;
    this.message = '';
    this.messageTime = 0;
    // The suggested build is a search, so it is computed once per level and
    // held until the level or the unlocked catalogue changes.
    this.suggestion = null;
    this.suggestionKey = '';
  }

  /**
   * The vehicle the hangar would build for this mission. Only ever shown at
   * the setting that offers hints, but computed the same way regardless.
   */
  suggestionFor(level, body, frontier) {
    const key = `${level.id}:${frontier}`;
    if (this.suggestionKey !== key) {
      this.suggestionKey = key;
      this.suggestion = suggestDesign(level, body, frontier);
    }
    return this.suggestion;
  }

  flash(msg, seconds = 2.6) {
    this.message = msg;
    this.messageTime = seconds;
  }

  update(dt) {
    this.dt = dt;
    if (this.messageTime > 0) this.messageTime -= dt;
  }

  /** Flat list of editable rows, rebuilt each frame from the design. */
  rows(design) {
    const out = [];
    design.stages.forEach((_, i) => {
      out.push({ kind: 'engine', stage: i });
      out.push({ kind: 'count', stage: i });
      out.push({ kind: 'fuel', stage: i });
    });
    out.push({ kind: 'life' });
    out.push({ kind: 'rcs' });
    out.push({ kind: 'legs' });
    out.push({ kind: 'computer' });
    return out;
  }

  /** @returns {'launch'|null} */
  handle(input, session, body, level) {
    const design = session.design;
    const rows = this.rows(design);
    this.selection = clamp(this.selection, 0, rows.length - 1);

    const before = this.selection;
    if (input.wasPressed('up')) this.selection = (this.selection - 1 + rows.length) % rows.length;
    if (input.wasPressed('down')) this.selection = (this.selection + 1) % rows.length;
    this.pointer(input, rows.length);

    // Left/right adjust, with key repeat so large tanks are editable.
    let dir = 0;
    if (input.wasPressed('left')) dir = -1;
    if (input.wasPressed('right')) dir = 1;
    const holding = input.isDown('left') || input.isDown('right');
    let coarse = false;
    if (holding) {
      this.holdTime += this.dt;
      if (this.holdTime > REPEAT_DELAY) {
        this.repeatTimer -= this.dt;
        if (this.repeatTimer <= 0) {
          this.repeatTimer = REPEAT_RATE;
          dir = input.isDown('left') ? -1 : 1;
          coarse = true;
        }
      }
    } else {
      this.holdTime = 0;
      this.repeatTimer = 0;
    }
    if (dir !== 0) this.adjust(rows[this.selection], dir, coarse, session, level);

    if (input.wasPressed('addStage')) {
      if (design.stages.length >= MAX_STAGES) this.flash(`MAXIMUM ${MAX_STAGES} STAGES`);
      else {
        addStage(design, session.frontier);
        this.selection = 0;
        this.flash('STAGE ADDED BELOW — IT BURNS FIRST');
      }
    }
    if (input.wasPressed('stage')) {
      const row = rows[this.selection];
      if (row.stage === undefined) this.flash('SELECT A STAGE ROW TO REMOVE IT');
      else if (removeStage(design, row.stage)) {
        this.selection = 0;
        this.flash('STAGE REMOVED');
      } else this.flash('THE VEHICLE NEEDS AT LEAST ONE STAGE');
    }

    if (input.wasPressed('suggest')) this.fitSuggestion(session, body, level);
    if (this.selection !== before) this.reveal = true;

    if (input.wasPressed('launch') || input.wasPressed('confirm')) return 'launch';
    return null;
  }

  /** Taps select an editor row; drags and the wheel scroll a column. */
  pointer(input, rowCount) {
    for (const t of input.taps || []) {
      const v = this.views.editor;
      if (!v || !inView(v, t)) continue;
      const y = t.y + (this.scroll.editor || 0);
      const i = this.rowRects.findIndex((rr) => y >= rr.y0 && y < rr.y1);
      if (i >= 0 && i < rowCount) this.selection = i;
    }
    for (const sc of input.scrolls || []) {
      for (const [key, v] of Object.entries(this.views)) {
        if (inView(v, sc)) this.scroll[key] = (this.scroll[key] || 0) + sc.dy;
      }
    }
  }

  /**
   * Draw one column, scrolled and clipped to [top, bottom] if its content
   * (as measured last frame) is taller than that. Returns where the content
   * ends on screen.
   */
  column(r, key, x, w, pad, top, bottom, draw) {
    const viewTop = top - 18;
    const viewH = bottom - viewTop;
    const max = Math.max(0, (this.content[key] || 0) - viewH);
    const s = clamp(this.scroll[key] || 0, 0, max);
    this.scroll[key] = s;
    this.views[key] = { x0: x - pad, x1: x + w + pad, y0: viewTop, y1: bottom };

    const ctx = r.ctx;
    ctx.save();
    if (max > 0) {
      ctx.beginPath();
      ctx.rect(0, viewTop, r.w, viewH);
      ctx.clip();
      ctx.translate(0, -s);
    }
    const end = draw();
    ctx.restore();
    this.content[key] = end - viewTop + 6;

    // A scroll bar in the gutter, only when there is something to scroll.
    if (max > 0) {
      const bx = x + w + pad * 0.5;
      const thumb = Math.max(24, viewH * (viewH / this.content[key]));
      const ty = viewTop + (viewH - thumb) * (s / max);
      r.lineS(bx, viewTop, bx, bottom, COLORS.ui, 0.12);
      r.lineS(bx, ty, bx, ty + thumb, COLORS.accent, 0.7, 2);
    }
    return end - s;
  }

  /** Keep the selected editor row on screen after it moves. */
  revealSelection() {
    const v = this.views.editor;
    const rr = this.rowRects[this.selection];
    this.reveal = false;
    if (!v || !rr) return;
    const s = this.scroll.editor || 0;
    if (rr.y0 - s < v.y0 + 4) this.scroll.editor = rr.y0 - v.y0 - 4;
    else if (rr.y1 - s > v.y1 - 4) this.scroll.editor = rr.y1 - v.y1 + 4;
  }

  /**
   * Replace the design with the hangar's suggestion. Offered only where hints
   * are, and it copies the design rather than sharing it so the player can
   * take it apart afterwards -- which is the point of offering it.
   */
  fitSuggestion(session, body, level) {
    if (difficultyAt(session.difficulty).hints !== 'full') {
      this.flash('NO BUILD SUGGESTIONS AT THIS DIFFICULTY');
      return;
    }
    const s = this.suggestionFor(level, body, session.frontier);
    if (!s) { this.flash('NO SUGGESTION FOR THIS MISSION'); return; }
    session.design = {
      ...s.design,
      stages: s.design.stages.map((st) => ({ ...st })),
    };
    this.selection = 0;
    this.flash(`FITTED THE SUGGESTED BUILD — ${s.stats.cost} CR`);
  }

  adjust(row, dir, coarse, session, level) {
    const design = session.design;
    const stage = row.stage !== undefined ? design.stages[row.stage] : null;
    switch (row.kind) {
      case 'engine':
        cycleEngine(stage, dir, session.frontier);
        break;
      case 'count':
        stage.engineCount = clamp(stage.engineCount + dir, 1, MAX_ENGINES_PER_STAGE);
        break;
      case 'fuel':
        adjustFuel(stage, dir * tankStep(stage.fuel, coarse));
        break;
      case 'life':
        design.lifeSupport = clamp(design.lifeSupport + dir, 0, 400);
        break;
      case 'rcs':
        design.rcs = clamp(design.rcs + dir, 0, RCS_TIERS.length - 1);
        break;
      case 'legs':
        design.legs = clamp(design.legs + dir, 0, LEG_TIERS.length - 1);
        break;
      case 'computer':
        design.computer = clamp((design.computer || 0) + dir, 0, COMPUTER_TIERS.length - 1);
        break;
    }
  }

  // --- drawing ---------------------------------------------------------------

  draw(r, session, body, level, touch = false) {
    const design = session.design;
    const stats = designStats(design, body);
    const rows = this.rows(design);
    this.selection = clamp(this.selection, 0, rows.length - 1);

    const m = Math.max(22, r.w * 0.028);
    const usable = r.w - m * 2;
    const colA = usable * 0.27;
    const colB = usable * 0.44;
    const colC = usable * 0.25;
    const gap = (usable - colA - colB - colC) / 2;
    const xA = m;
    const xB = m + colA + gap;
    const xC = xB + colB + gap;

    const diff = difficultyAt(session.difficulty);
    let y = m + 6;
    r.text('HANGAR', xA, y, { size: 25 });
    r.text(diff.name, xA + r.measure('HANGAR', 25) + 14, y,
      { size: 11, alpha: 0.45 });
    r.text(`CREDITS  ${session.credits}`, r.w - m, y,
      { size: 19, align: 'right', color: COLORS.accent });
    y += 11;
    r.lineS(m, y, r.w - m, y, COLORS.ui, 0.3);
    const top = y + 26;
    const fy = r.bottom - m;
    const viewBottom = fy - 40;

    const bottom = this.column(r, 'mission', xA, colA, gap, top, viewBottom,
      () => this.drawMission(r, xA, top, colA, body, level, session, touch));
    if (!this.scroll.mission) {
      this.drawSilhouette(r, xA, bottom + 18, colA, fy - 52 - (bottom + 18), stats);
    }
    if (this.reveal) this.revealSelection();
    this.column(r, 'editor', xB, colB, gap, top, viewBottom,
      () => this.drawEditor(r, xB, top, colB, design, rows, session));
    this.column(r, 'vehicle', xC, colC, gap, top, viewBottom,
      () => this.drawVehicle(r, xC, top, colC, stats, body, level, session, touch));

    r.lineS(m, fy - 32, r.w - m, fy - 32, COLORS.ui, 0.22);
    if (this.messageTime > 0) {
      r.text(this.message, m, fy - 9, { size: 13, color: COLORS.accent });
    } else {
      const keys = touch
        ? 'TAP A ROW TO SELECT   ◀ ▶ ADJUST (HOLD FOR COARSE)   DRAG A COLUMN TO SCROLL'
        : 'W/S SELECT   A/D ADJUST (HOLD FOR COARSE)   N ADD STAGE   X REMOVE   Q/E LEVEL'
          + (diff.hints === 'full' ? '   B SUGGESTED BUILD' : '');
      r.text(keys, m, fy - 9, { size: 12, alpha: 0.5 });
    }
    const afford = stats.cost <= session.credits;
    if (!afford || !touch) {
      r.text(afford ? 'ENTER  LAUNCH >' : 'CANNOT AFFORD', r.w - m, fy - 9, {
        size: 14, align: 'right', color: afford ? COLORS.good : COLORS.danger,
      });
    }
  }

  /** What the mission demands. This is what you design against. */
  drawMission(r, x, y, w, body, level, session, touch) {
    const diff = difficultyAt(session.difficulty);
    const done = session.completions ? (session.completions[session.levelIndex] || 0) : 0;
    const payout = Math.max(diff.replayFloor, REPLAY_DECAY ** done);
    const canBrowse = session.frontier > 0;

    r.text('MISSION', x, y, { size: 11, alpha: 0.55 });
    if (canBrowse) {
      r.text(`${session.levelIndex + 1}/${session.frontier + 1}${touch ? '' : '   Q/E'}`, x + w, y,
        { size: 10, align: 'right', alpha: 0.45 });
    }
    let yy = y + 22;
    r.text(`LEVEL ${level.id}  ${level.title}`, x, yy, { size: 16 });
    yy += 18;
    if (done > 0) {
      r.text(`REPLAY x${done} — MISSION PAYS ${Math.round(payout * 100)}%`, x, yy,
        { size: 11, color: COLORS.warn });
      yy += 16;
    } else {
      r.text('FIRST ATTEMPT — FULL PAYMENT', x, yy,
        { size: 11, color: COLORS.good, alpha: 0.8 });
      yy += 16;
    }
    yy += 2;
    r.text(`${body.name}   g = ${body.surfaceGravity().toFixed(2)} M/S²`, x, yy,
      { size: 12, alpha: 0.65 });
    yy += 16;
    if (body.atmosphere) {
      r.text(`ATMOSPHERE TO ${fmtDistance(body.atmosphere.height)}`, x, yy,
        { size: 11, alpha: 0.5, color: COLORS.warn });
      yy += 15;
    }
    yy += 8;

    yy = this.wrapText(r, level.brief, x, yy, w, 11, 0.5);
    yy += 12;

    r.text('OBJECTIVES', x, yy, { size: 11, alpha: 0.55 });
    yy += 17;
    for (const o of level.objectives) {
      const label = objectiveLabel(o, body);
      yy = this.wrapText(r, `- ${label}`, x, yy, w, 11.5, 0.85, COLORS.accent) + 2;
    }
    yy += 10;

    const env = touchdownEnvelope(level, LEG_TIERS[session.design.legs], diff);
    const rows = [
      ['DELTA-V NEEDED', `~${level.estDeltaV} M/S`],
      ['MISSION DURATION', `~${fmtTime(level.estDuration)}`],
      ['MISSION PAYS UP TO', `${Math.round(maxPayout(level, body, diff) * payout)} CR`],
      ['TOUCHDOWN LIMIT',
        `${env.speed.toFixed(1)} M/S / ${Math.round(env.angle)}°`],
    ];
    for (const [label, value] of rows) {
      r.text(label, x, yy, { size: 11, alpha: 0.5 });
      r.text(value, x + w, yy, { size: 12, align: 'right', color: COLORS.warn });
      yy += 17;
    }

    // Bonuses are shown at every setting, and before the flight rather than
    // after it: they are a plan, not a surprise on the results screen.
    yy += 8;
    r.text('BONUSES', x, yy, { size: 11, alpha: 0.55 });
    yy += 17;
    for (const b of bonusesFor(level, body)) {
      r.text(b.label, x, yy, { size: 11, alpha: 0.7, color: COLORS.good });
      r.text(`+${Math.round(b.value * payout)} CR`, x + w, yy,
        { size: 11, align: 'right', alpha: 0.7, color: COLORS.good });
      yy += 14;
      r.text(b.note, x + 10, yy, { size: 10, alpha: 0.4 });
      yy += 16;
    }
    return yy;
  }

  wrapText(r, text, x, y, w, size, alpha, color) {
    const words = String(text).split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (r.measure(test, size) > w && line) {
        r.text(line, x, yy, { size, alpha, color });
        yy += size + 4;
        line = word;
      } else line = test;
    }
    if (line) { r.text(line, x, yy, { size, alpha, color }); yy += size + 4; }
    return yy;
  }

  drawEditor(r, x, y, w, design, rows, session) {
    r.text('VEHICLE DESIGN', x, y, { size: 11, alpha: 0.55 });
    r.text(`${design.stages.length} STAGE${design.stages.length > 1 ? 'S' : ''}`,
      x + w, y, { size: 11, align: 'right', alpha: 0.55 });

    let yy = y + 24;
    let rowIndex = 0;
    this.rowRects = [];
    const engines = availableEngines(session.frontier);

    design.stages.forEach((stage, i) => {
      const st = engineById(stage.engineId);
      r.text(`STAGE ${i + 1}${i === 0 ? '  (BURNS FIRST)' : ''}`, x, yy,
        { size: 11, alpha: 0.5, color: COLORS.accent });
      yy += 18;

      const entries = [
        ['ENGINE', st.name, `${engines.findIndex((e) => e.id === st.id) + 1}/${engines.length}`],
        ['ENGINES', `x${stage.engineCount}`,
          `${((st.thrust * stage.engineCount) / 1000).toFixed(0)} KN`],
        ['PROPELLANT', fmtMass(stage.fuel), `TANK ${fmtMass(stage.fuel * 0.085)}`],
      ];
      entries.forEach(([label, value, note], k) => {
        this.rowRects.push({ y0: yy - 15, y1: yy + 8 });
        const selected = rowIndex === this.selection;
        if (selected) {
          r.rectS(x - 8, yy - 14, w + 16, 21, COLORS.accent, 0.8);
          r.text('<', x + w * 0.44, yy, { size: 12, alpha: 0.8, color: COLORS.accent });
          r.text('>', x + w * 0.80, yy, { size: 12, alpha: 0.8, color: COLORS.accent });
        }
        r.text(label, x, yy, { size: 11, alpha: 0.55 });
        r.text(value, x + w * 0.62, yy, { size: 13, align: 'center' });
        r.text(note, x + w, yy, { size: 11, align: 'right', alpha: 0.45 });
        yy += 22;
        rowIndex++;
      });
      yy += 8;
    });

    yy += 4;
    r.text('PAYLOAD', x, yy, { size: 11, alpha: 0.5, color: COLORS.accent });
    yy += 18;
    r.text(`CAPSULE  ${CAPSULE.name}`, x, yy, { size: 11, alpha: 0.4 });
    r.text(fmtMass(CAPSULE.mass), x + w, yy, { size: 11, align: 'right', alpha: 0.4 });
    yy += 20;

    const payloadRows = [
      ['LIFE SUPPORT', `x${design.lifeSupport}`,
        fmtTime(design.lifeSupport * LIFE_SUPPORT.hours * 3600)],
      ['ATTITUDE', RCS_TIERS[design.rcs].name, fmtMass(RCS_TIERS[design.rcs].mass)],
      ['LANDING GEAR', LEG_TIERS[design.legs].name, fmtMass(LEG_TIERS[design.legs].mass)],
      ['FLIGHT COMPUTER', COMPUTER_TIERS[design.computer || 0].name,
        fmtMass(COMPUTER_TIERS[design.computer || 0].mass)],
    ];
    payloadRows.forEach(([label, value, note]) => {
      this.rowRects.push({ y0: yy - 15, y1: yy + 8 });
      const selected = rowIndex === this.selection;
      if (selected) {
        r.rectS(x - 8, yy - 14, w + 16, 21, COLORS.accent, 0.8);
        r.text('<', x + w * 0.44, yy, { size: 12, alpha: 0.8, color: COLORS.accent });
        r.text('>', x + w * 0.80, yy, { size: 12, alpha: 0.8, color: COLORS.accent });
      }
      r.text(label, x, yy, { size: 11, alpha: 0.55 });
      r.text(value, x + w * 0.62, yy, { size: 13, align: 'center' });
      r.text(note, x + w, yy, { size: 11, align: 'right', alpha: 0.45 });
      yy += 22;
      rowIndex++;
    });

    const comp = COMPUTER_TIERS[design.computer || 0];
    r.text(comp.modes.length ? `HOLD MODES: ${comp.modes.join('  ')}` : 'NO AUTOMATED FLIGHT',
      x, yy - 4, { size: 10, alpha: 0.45, color: COLORS.accent });
    return yy + 4;
  }

  drawVehicle(r, x, y, w, stats, body, level, session, touch) {
    const hints = difficultyAt(session.difficulty).hints;
    r.text('FLIGHT MODEL', x, y, { size: 11, alpha: 0.55 });
    let yy = y + 22;
    const row = (label, value, color, alpha = 1) => {
      r.text(label, x, yy, { size: 11, alpha: 0.5 });
      r.text(value, x + w, yy, { size: 12, align: 'right', color, alpha });
      yy += 18;
    };

    row('LAUNCH MASS', fmtMass(stats.wetMass));
    row('DRY MASS', fmtMass(stats.dryMass));
    row('PAYLOAD', fmtMass(stats.payload.mass));
    yy += 6;
    r.lineS(x, yy - 12, x + w, yy - 12, COLORS.ui, 0.18);

    stats.stages.forEach((s, i) => {
      row(`STAGE ${i + 1} DELTA-V`, `${s.deltaV.toFixed(0)} M/S`, COLORS.ui, 0.85);
      r.text(`   ${s.burnTime.toFixed(0)} S BURN`, x, yy - 4,
        { size: 10, alpha: 0.35 });
      yy += 12;
    });

    yy += 4;
    r.lineS(x, yy - 12, x + w, yy - 12, COLORS.ui, 0.18);
    const dvOk = stats.deltaV >= level.estDeltaV;
    row('TOTAL DELTA-V', `${stats.deltaV.toFixed(0)} M/S`,
      dvOk ? COLORS.good : COLORS.danger);

    const needsLiftoff = level.start.type === 'surface';
    const twrOk = !needsLiftoff || stats.liftoffTWR >= 1.25;
    row(`THRUST/WEIGHT @ ${body.name}`, stats.liftoffTWR.toFixed(2),
      twrOk ? COLORS.ui : COLORS.danger);

    const lifeOk = stats.lifeSeconds >= level.estDuration;
    row('LIFE SUPPORT', fmtTime(stats.lifeSeconds), lifeOk ? COLORS.ui : COLORS.danger);

    // Turn rate makes the attitude choice legible: too little and you cannot
    // point the ship, too much and a tap sends it spinning.
    const twitchy = stats.turnWet > 1.2;
    const sluggish = stats.turnWet < 0.12;
    row('TURN RATE', `${stats.turnWet.toFixed(3)} RAD/S²`,
      twitchy || sluggish ? COLORS.warn : COLORS.ui);
    row('  90° SWING', isFinite(stats.swing90) ? `${stats.swing90.toFixed(1)} S` : '---',
      twitchy || sluggish ? COLORS.warn : COLORS.ui, 0.75);
    // The numbers above are arithmetic and stay at every setting. Reading them
    // for you is the hint, so that is what FLIGHT DIRECTOR loses.
    if (hints !== 'minimal') {
      if (twitchy) {
        r.text('! OVER-THRUSTED FOR ITS SIZE — WILL BE TWITCHY', x, yy,
          { size: 10, color: COLORS.warn });
        yy += 15;
      } else if (sluggish) {
        r.text('! SLOW TO POINT — CONSIDER MORE ATTITUDE AUTHORITY', x, yy,
          { size: 10, color: COLORS.warn });
        yy += 15;
      }
    }

    yy += 10;
    r.lineS(x, yy - 12, x + w, yy - 12, COLORS.ui, 0.18);
    const afford = stats.cost <= session.credits;
    row('BUILD COST', `${stats.cost} CR`, afford ? COLORS.accent : COLORS.danger);
    row('CREDITS AFTER', `${session.credits - stats.cost} CR`,
      afford ? COLORS.ui : COLORS.danger, 0.7);

    // Readiness: the four things that actually decide whether this flies.
    // FLIGHT DIRECTOR states the requirements and leaves the verdict to you.
    if (hints !== 'minimal') {
      yy += 14;
      r.text('READINESS', x, yy, { size: 11, alpha: 0.55 });
      yy += 18;
      const checks = [
        [dvOk, `DELTA-V ${dvOk ? 'SUFFICIENT' : `SHORT BY ${(level.estDeltaV - stats.deltaV).toFixed(0)} M/S`}`],
        [twrOk, needsLiftoff
          ? (twrOk ? 'CAN LIFT OFF' : 'TOO HEAVY TO LIFT OFF')
          : 'NO LIFTOFF REQUIRED'],
        [lifeOk, lifeOk ? 'LIFE SUPPORT ADEQUATE' : 'LIFE SUPPORT TOO SHORT'],
        [afford, afford ? 'WITHIN BUDGET' : 'OVER BUDGET'],
      ];
      for (const [ok, text] of checks) {
        r.text(`${ok ? '[x]' : '[!]'} ${text}`, x, yy, {
          size: 11, color: ok ? COLORS.good : COLORS.danger, alpha: ok ? 0.8 : 1,
        });
        yy += 17;
      }
    }

    if (hints === 'full') return this.drawSuggestion(r, x, yy + 14, w, body, level, session, touch);
    return yy;
  }

  /**
   * CADET's build hint: a vehicle that meets the mission, with the reasoning
   * for the parts that were chosen for a reason. It is a starting point to
   * modify, not a shortcut past the design decision -- which is why it shows
   * what it sized each stage for rather than just handing over a rocket.
   */
  drawSuggestion(r, x, y, w, body, level, session, touch) {
    const s = this.suggestionFor(level, body, session.frontier);
    r.text('SUGGESTED BUILD', x, y, { size: 11, alpha: 0.55 });
    let yy = y + 18;
    if (!s) {
      r.text('NO SUGGESTION FOR THIS MISSION', x, yy, { size: 11, alpha: 0.45 });
      return yy;
    }
    const n = s.design.stages.length;
    const dv = Math.round(s.stats.deltaV);
    r.text(`${n} STAGE${n > 1 ? 'S' : ''}, ${dv} M/S FOR A ${level.estDeltaV} M/S MISSION`,
      x, yy, { size: 11, alpha: 0.6, color: COLORS.accent });
    yy += 16;
    s.design.stages.forEach((st, i) => {
      const e = engineById(st.engineId);
      r.text(`S${i + 1}  ${e.name} x${st.engineCount}`, x, yy, { size: 10, alpha: 0.5 });
      r.text(fmtMass(st.fuel), x + w, yy, { size: 10, align: 'right', alpha: 0.5 });
      yy += 14;
    });
    r.text(`GEAR ${LEG_TIERS[s.design.legs].name}   ${RCS_TIERS[s.design.rcs].name}`,
      x, yy, { size: 10, alpha: 0.5 });
    yy += 14;
    const afford = s.stats.cost <= session.credits;
    r.text(`${touch ? 'TAP FIT FOR' : 'B  FIT'} THIS BUILD — ${s.stats.cost} CR`, x, yy, {
      size: 11, color: afford ? COLORS.good : COLORS.danger,
    });
    return yy;
  }

  /** Scale silhouette of the stack, bottom stage at the bottom. */
  drawSilhouette(r, x, y, w, h, stats) {
    if (h < 60) return;
    const ctx = r.ctx;
    const cx = x + w / 2;
    const pxPerM = Math.min(h / stats.length, (w * 0.45) / Math.max(0.8, stats.maxRadius));
    const bottom = y + h;

    r.text('STACK', x, y - 6, { size: 11, alpha: 0.55 });
    r.text(`${stats.length.toFixed(1)} M`, x + w, y - 6,
      { size: 11, align: 'right', alpha: 0.45 });

    let cursor = bottom;
    r.stroke(COLORS.ui, 0.85, 1, false);
    stats.stages.forEach((s, i) => {
      const sh = s.length * pxPerM;
      const sw = s.radius * pxPerM;
      ctx.beginPath();
      ctx.rect(cx - sw, cursor - sh, sw * 2, sh);
      ctx.globalAlpha = i === 0 ? 0.95 : 0.6;
      ctx.stroke();
      if (sh > 16) {
        r.text(`S${i + 1}`, cx, cursor - sh / 2 + 4,
          { size: 10, align: 'center', alpha: 0.5 });
      }
      cursor -= sh;
    });

    // Capsule cone.
    const capH = 2.6 * pxPerM;
    const capW = Math.min(0.9, stats.maxRadius) * pxPerM;
    r.stroke(COLORS.ui, 0.95, 1, false);
    ctx.beginPath();
    ctx.moveTo(cx - capW, cursor);
    ctx.lineTo(cx, cursor - capH);
    ctx.lineTo(cx + capW, cursor);
    ctx.stroke();
    r.reset();
  }
}

function inView(v, p) {
  return p.x >= v.x0 && p.x < v.x1 && p.y >= v.y0 && p.y < v.y1;
}

function objectiveLabel(o, body) {
  switch (o.type) {
    case 'altitude': return `Reach ${fmtDistance(o.min)} altitude`;
    case 'orbit': return `Orbit with periapsis above ${fmtDistance(o.minPeriapsis)}`;
    case 'land': {
      if (!o.pad) return 'Land safely';
      const pad = body.padByName(o.pad);
      return `Land on ${pad ? pad.label : o.pad}`;
    }
    case 'sample': return 'Collect surface sample';
    default: return o.type;
  }
}
