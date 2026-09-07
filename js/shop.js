import { UPGRADES, UPGRADE_ORDER, HULL_MASS, PLANETS } from './config.js';
import { part, nextTier, isMaxed, shipStats, performance } from './loadout.js';
import { fmt } from './util.js';

/**
 * Between-level hangar. Every purchase adds mass, so the interesting decision
 * is never "can I afford it" but "does this still fly".
 */
export class Hangar {
  constructor() {
    this.selection = 0;
    this.message = '';
    this.messageTime = 0;
  }

  reset() {
    this.selection = 0;
    this.message = '';
  }

  /** @returns {'launch'|null} */
  handle(input, session) {
    if (input.wasPressed('down')) {
      this.selection = (this.selection + 1) % UPGRADE_ORDER.length;
    }
    if (input.wasPressed('up')) {
      this.selection = (this.selection + UPGRADE_ORDER.length - 1) % UPGRADE_ORDER.length;
    }
    if (input.wasPressed('confirm')) this.buy(session);
    if (input.wasPressed('shop')) return 'launch';
    return null;
  }

  buy(session) {
    const cat = UPGRADE_ORDER[this.selection];
    if (isMaxed(session.loadout, cat)) {
      this.flash('ALREADY AT MAXIMUM TIER');
      return;
    }
    const next = nextTier(session.loadout, cat);
    if (session.credits < next.cost) {
      this.flash(`NEED ${next.cost - session.credits} MORE CREDITS`);
      return;
    }
    session.credits -= next.cost;
    session.loadout[cat] += 1;
    this.flash(`INSTALLED ${next.name}  (+${next.mass} KG)`);
  }

  flash(msg) {
    this.message = msg;
    this.messageTime = 2.5;
  }

  update(dt) {
    if (this.messageTime > 0) this.messageTime -= dt;
  }

  draw(r, session) {
    const level = session.upcomingLevel;
    const planet = PLANETS[level.planet];
    const stats = shipStats(session.loadout);
    const perf = performance(stats, planet.gravity);

    const m = Math.max(28, r.w * 0.06);
    let y = m + 8;

    r.text('HANGAR', m, y, { size: 26 });
    r.text(`CREDITS  ${session.credits}`, r.w - m, y, { size: 20, align: 'right' });
    y += 12;
    r.lineS(m, y, r.w - m, y, 0.35);
    y += 26;

    r.text(
      `NEXT: LEVEL ${session.levelIndex + 1}  ${level.name}  /  ${planet.name}  ` +
      `g = ${planet.gravity.toFixed(2)} M/S²`,
      m, y, { size: 13, alpha: 0.7 }
    );
    y += 18;
    r.text(
      `TOUCHDOWN LIMIT ${(level.tolerance.speed + stats.speedBonus).toFixed(1)} M/S  /  ` +
      `${Math.round(level.tolerance.angle + stats.angleBonus)}°   (gear included)`,
      m, y, { size: 13, alpha: 0.5 }
    );

    const listTop = y + 40;
    const colW = Math.min(520, (r.w - m * 2) * 0.58);
    this.drawList(r, session, m, listTop, colW);
    this.drawStats(r, stats, perf, planet, m + colW + 40, listTop, r.w - m - (m + colW + 40));

    // Footer.
    const fy = r.h - m;
    r.lineS(m, fy - 34, r.w - m, fy - 34, 0.25);
    if (this.messageTime > 0) {
      r.text(this.message, m, fy - 10, { size: 13, alpha: 0.9 });
    } else {
      r.text('W/S SELECT   ENTER BUY   U LAUNCH', m, fy - 10, { size: 13, alpha: 0.55 });
    }
    r.text('U  LAUNCH >', r.w - m, fy - 10, { size: 14, align: 'right' });
  }

  drawList(r, session, x, y, w) {
    UPGRADE_ORDER.forEach((cat, i) => {
      const def = UPGRADES[cat];
      const cur = part(session.loadout, cat);
      const next = nextTier(session.loadout, cat);
      const selected = i === this.selection;
      const rowH = 76;
      const ry = y + i * (rowH + 10);

      if (selected) {
        r.rectS(x - 10, ry - 16, w + 20, rowH + 8, 0.8);
        r.text('>', x - 24, ry + 4, { size: 14 });
      }

      r.text(def.label, x, ry, { size: 12, alpha: 0.55 });
      r.text(cur.name, x + 90, ry, { size: 15, alpha: 1 });
      r.text(`${cur.mass} KG`, x + w, ry, { size: 13, align: 'right', alpha: 0.6 });

      // Tier pips.
      for (let k = 0; k < def.tiers.length; k++) {
        const px = x + 90 + k * 14;
        const owned = k <= session.loadout[cat];
        r.rectS(px, ry + 10, 9, 9, owned ? 0.9 : 0.25);
        if (owned) {
          r.ctx.globalAlpha = 0.9;
          r.ctx.fillStyle = '#fff';
          r.ctx.fillRect(px + 2, ry + 12, 5, 5);
          r.reset();
        }
      }

      if (next) {
        const affordable = session.credits >= next.cost;
        r.text(
          `-> ${next.name}   +${next.mass - cur.mass} KG`,
          x + 90, ry + 36, { size: 12, alpha: affordable ? 0.8 : 0.35 }
        );
        r.text(`${next.cost} CR`, x + w, ry + 36,
          { size: 13, align: 'right', alpha: affordable ? 1 : 0.35 });
      } else {
        r.text('MAX TIER', x + 90, ry + 36, { size: 12, alpha: 0.5 });
      }

      if (selected) {
        r.text(def.blurb, x + 90, ry + 56, { size: 11, alpha: 0.45 });
      }
    });
  }

  drawStats(r, stats, perf, planet, x, y, w) {
    r.text('FLIGHT MODEL', x, y, { size: 12, alpha: 0.55 });
    let ry = y + 24;
    const row = (label, value, alpha = 1) => {
      r.text(label, x, ry, { size: 12, alpha: 0.5 });
      r.text(value, x + w, ry, { size: 13, align: 'right', alpha });
      ry += 21;
    };

    row('HULL', `${HULL_MASS} KG`);
    row('DRY MASS', `${fmt(stats.dryMass, 0, 0)} KG`);
    row('PROPELLANT', `${fmt(stats.fuelCapacity, 0, 0)} KG`);
    row('LAUNCH MASS', `${fmt(stats.wetMass, 0, 0)} KG`);
    ry += 8;
    r.lineS(x, ry - 14, x + w, ry - 14, 0.2);

    row('MAX THRUST', `${fmt(stats.maxThrust / 1000, 1, 0)} KN`);
    const twrOk = perf.twrWet >= 1.3;
    row(`THRUST/WEIGHT @ ${planet.name}`,
      `${perf.twrWet.toFixed(2)}${twrOk ? '' : '  !'}`, twrOk ? 1 : 0.95);
    row('  AT BURNOUT', perf.twrDry.toFixed(2), 0.7);
    row('DELTA-V', `${fmt(perf.deltaV, 0, 0)} M/S`);
    row('FULL-THROTTLE BURN', `${fmt(perf.burnTime, 0, 0)} S`);
    row('HOVER ENDURANCE',
      perf.hoverTime > 0 ? `${fmt(perf.hoverTime, 0, 0)} S` : 'CANNOT HOVER',
      perf.hoverTime > 0 ? 1 : 0.95);
    ry += 8;
    r.lineS(x, ry - 14, x + w, ry - 14, 0.2);
    row('TURN RATE (FULL)', `${perf.turnWet.toFixed(2)} RAD/S²`);
    row('TURN RATE (EMPTY)', `${perf.turnDry.toFixed(2)} RAD/S²`, 0.7);

    if (!twrOk) {
      ry += 10;
      r.text('! THRUST/WEIGHT BELOW 1.3 -- YOU MAY NOT ARREST YOUR DESCENT',
        x, ry, { size: 11, alpha: 0.75 });
      ry += 16;
    }
    if (perf.hoverTime <= 0) {
      r.text('! CANNOT HOVER AT LAUNCH MASS', x, ry, { size: 11, alpha: 0.75 });
    }
  }
}
