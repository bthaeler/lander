# LANDER

A 2D lander game. White line-art on black, real Newtonian physics, and an
upgrade economy where every purchase is a mass penalty.

## Running it

```sh
npm start          # or: node server.js [port]
```

Then open <http://localhost:8080>. No dependencies, no build step — it is
plain ES modules and a `<canvas>`. A real HTTP server is required because
`file://` will not load ES modules.

## Controls

| Key | Action |
| --- | --- |
| `←` `→` (or `A` `D`) | Rotate. Torque only — you must stop the rotation you start. |
| `↑` / `SPACE` (or `W`) | Thrust |
| `H` | Cycle HUD layout (TOP BAR / CORNERS / CLUSTER) |
| `R` | Restart the current level |
| In the hangar | `W`/`S` select, `ENTER` buy, `U` launch |

## How it plays

Land on the marked pad. You are scored on two things: **impact speed** and
**angle from vertical** at touchdown. Each level states its envelope up front
and the HUD shows it at all times. Land inside the envelope and you get paid;
exceed it and you lose the vehicle.

- Pads pay a multiplier (narrower pads pay more). Landing on open ground is
  allowed if the slope is under 12°, but the envelope tightens to 80% and the
  payout drops to 60%.
- Still rotating faster than 0.55 rad/s at contact tips the ship over, however
  upright it happened to be at that instant.
- Touching the ground with any part of the hull rather than the footpads is an
  immediate loss.

## The physics

Everything is SI and integrated with semi-implicit Euler at a fixed 120 Hz.

- **Thrust** acts along the ship's own axis: `a = F/m`, and `m` shrinks as you
  burn propellant, so the ship gets more responsive as the tank empties.
- **Propellant flow** follows `ṁ = F / v_e`, so throttle costs mass directly.
- **Rotation** is torque over inertia, with the ship modelled as a uniform disc
  (`I = m · 5.0`). There is no artificial angular damping — a heavy ship is
  sluggish, a nearly empty one is twitchy.
- **Gravity** is the real surface value for each body: Luna 1.62, Mars 3.71,
  Mercury 3.70 m/s².

The one number tuned for play rather than realism is exhaust velocity. A real
hypergolic descent engine is around 3000 m/s, which would make propellant
effectively free over a 300 m descent; the engines here run 580–700 m/s so the
tank stays a real decision. See the comment in `js/config.js`.

## The upgrade tradeoff

Four categories, four tiers each. Every tier adds mass:

| Category | Buys you | Costs you |
| --- | --- | --- |
| **Engine** | Thrust, faster spool | Mass, and lower efficiency per newton |
| **Tank** | Propellant, i.e. delta-v | Mass — the fuel itself is mass you carry |
| **Attitude** | Torque, so faster rotation | Mass, which is also more inertia |
| **Gear** | A wider touchdown envelope | Mass |

The hangar shows the derived flight model — thrust-to-weight at the next
destination, delta-v from the rocket equation, hover endurance, and turn rate
both full and empty — and warns when the ship can no longer hover or has a
thrust-to-weight under 1.3. The trap is real: a big engine on a small tank has
thrust but no endurance, and a big tank without engine cannot arrest its own
descent on Mars.

The landing bonus is paid on the *fraction* of propellant saved, not the mass,
so hauling an oversized tank you never burn does not pay for itself.

## Progressive fidelity

Graphics tier rises with the campaign and is set per level in `js/config.js`:

1. Bare wireframe, hairline strokes, sparse stars (levels 1–2)
2. Glow, terrain hatching, nozzle and hatch detail, denser starfield (3–4)
3. Heavier glow, fine hatching (5–6)

All tiers stay white-on-black line art. `TIER_STYLE` in `js/render.js` is the
single place that changes.

## Layout

```
index.html          entry point
css/style.css       only makes the canvas fullscreen; all drawing is canvas
server.js           zero-dependency static server
js/
  config.js         all tuning: physics constants, upgrade tree, levels
  util.js           math and formatting helpers
  input.js          keyboard -> semantic actions (touch will hook in here)
  terrain.js        midpoint-displacement heightfield with carved pads
  ship.js           geometry and the flight model
  loadout.js        loadout -> flight stats, and derived performance figures
  render.js         camera, world/screen transforms, all line drawing
  hud.js            three swappable HUD layouts
  shop.js           the hangar
  game.js           state machine, contact detection, scoring
  main.js           bootstrap and the frame loop
dev/devshot.html    renders one state statically, for screenshots
```

`dev/devshot.html` takes `?screen=briefing|flying|approach|hangar|result-good|
result-bad`, plus `&level=`, `&hud=` and `&alt=`. `approach` flies a scripted
autopilot down to a given altitude so a final-approach frame can be captured
without playing.

## Where this is going

- **Mobile.** All input goes through semantic actions in `js/input.js`, so
  touch controls attach there without touching game code. The canvas already
  handles devicePixelRatio and resize.
- **Automated flight systems** as a later upgrade category: attitude hold, a
  descent-rate autopilot, a projected-touchdown marker. The HUD has room
  reserved for a guidance cue.
- More bodies, and atmospheric ones (drag is not modelled yet).
