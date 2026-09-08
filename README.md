# LANDER

A 2D orbital lander. Line art on black, real two-body physics, multi-stage
rockets you design yourself, and a campaign that works up from a 400 m drop
onto a lunar pad to launching from Earth.

```sh
npm start          # or: node server.js [port]
```

Then open <http://localhost:8080>. No dependencies, no build step — plain ES
modules and a `<canvas>`. A real HTTP server is required because `file://`
will not load ES modules.

```sh
npm test           # physics, orbital mechanics, and end-to-end game tests
npm run economy    # cheapest viable rocket per level vs. available credits
```

## Controls

| Key | Action |
| --- | --- |
| `←` `→` (or `A` `D`) | Rotate. Torque only — you must stop the rotation you start. |
| `W` / `S` (or `↑` `↓`) | Throttle up / down. It is a lever, and it stays where you put it. |
| `SPACE` | Momentary full thrust — hold it, and a landing flies like a classic lander. |
| `F` | Engine cutoff |
| `X` | Stage — jettison the burnt-out stage below you |
| `T` / `G` | Flight computer: engage hold / cycle hold mode |
| `,` `.` | Time warp down / up |
| `P` / `ESC` | Pause. The overlay doubles as the controls reference. |
| `M` | Map view, framed on your whole orbit |
| `H` | Cycle HUD layout (TOP BAR / CORNERS / CLUSTER) |
| `R` | Abort the mission |
| In the hangar | `W`/`S` select, `A`/`D` adjust (hold for coarse), `N` add stage, `X` remove stage, `ENTER` launch |

## How it plays

You start every level **in the hangar**, where the mission tells you what it
needs: delta-v, duration, whether you have to lift off, and the touchdown
envelope. You design a rocket to meet it, pay the build cost, and fly.

Landings are scored on **impact speed** and **angle from vertical**. Pads pay a
multiplier; open ground is allowed under 12° of slope but tightens the envelope
to 80% and pays 60%. Touching down with the hull instead of the footpads, or
still rotating faster than 0.55 rad/s, loses the vehicle.

A successful landing **does not** end the flight if the mission has more to do.
The ship rests on the surface and can launch again — which is what makes
"land at the crater, load a sample, get back to orbit" a single mission.

## The physics

Everything is in a **planet-centred inertial frame**. There is no flat-ground
special case: a landing is a very low, very slow orbit that intersects the
terrain.

- **Gravity** is `a = -µr/|r|³` with the real constants — Luna 4.905e12,
  Earth 3.986e14, Mars 4.283e13 m³/s². Surface gravity falls out at 1.62,
  9.82 and 3.71 m/s².
- **Coasting is solved analytically.** State vector → conic elements → advance
  the anomaly → state vector. This is what makes 100000× time warp possible: a
  full 114-minute lunar orbit coasts with **0.00 m** of periapsis drift. Powered
  flight and atmospheric flight are integrated at a fixed 120 Hz instead, and
  warp is clamped in those regimes.
- **Propellant flow** is `ṁ = F/v_e`, so the ship gets lighter and livelier as
  it burns. Exhaust velocity blends between sea-level and vacuum figures with
  ambient pressure.
- **Rotation** is torque over inertia for a rod of the stack's length, with no
  artificial damping. Steering comes from RCS *and* engine gimbal — a 565 t
  launcher cannot be turned by thrusters alone.
- **Atmosphere** is exponential, with drag `½ρv²C_dA`. It matters: a
  three-stage Earth ascent peaks at ~31 kPa of dynamic pressure, and getting
  the trajectory wrong puts you at Mach 16 in the stratosphere pulling 90 g.

Terrain is a procedural, exactly-periodic function of angle rather than a
stored heightfield — a body 10,900 km around gets metre-scale detail with no
level-of-detail machinery. Landing pads carve flat spans into it, and are
sub-pixel from orbit, appearing naturally as you descend.

## Designing a rocket

A design is a payload plus an ordered list of stages, bottom first. The hangar
shows the derived flight model: per-stage delta-v, total delta-v, thrust-to-
weight at the destination, life support endurance, build cost, and four
readiness checks.

| Category | Buys you | Costs you |
| --- | --- | --- |
| **Engine type / count** | Thrust | Mass, and efficiency per newton |
| **Propellant** | Delta-v | Mass — the fuel is mass you carry until you spend it |
| **Stages** | Throwing dead weight away | Structure and an interstage each |
| **Life support** | Mission hours | Mass |
| **Attitude** | Torque | Mass, which is also more inertia |
| **Gear** | A wider touchdown envelope | Mass |
| **Flight computer** | Automation — see below | Mass |

### Automated flight systems

The flight computer is the one upgrade that buys back pilot workload rather
than performance. Each tier is mass and money:

| Tier | Modes |
| --- | --- |
| NONE | you fly everything |
| FC-1 STABILISER | kill rotation |
| FC-2 POINTER | plus hold vertical, prograde, retrograde |
| FC-3 PILOT | plus **descent assist**, which flies the braking curve for you |

`T` engages, `G` cycles modes, and manual rotation always overrides — the
computer only flies what you are not. Descent assist alone will put a lander
on Pad Alpha at 1.0 m/s, dead vertical, with no other input.

Tank structure is 8.5% of the propellant it holds. That single number is why
**single-stage-to-Earth-orbit is impossible** — one enormous stage tops out
around 6.2 km/s, while three stages reach 14 km/s and Earth orbit needs 9.4.
It is a load-bearing constraint, not a knob.

The build cost is paid at launch. A lost vehicle refunds 90%, and credits are
floored so you can always rebuild what you just lost — the economy exists to
constrain what you can design, not to punish crashes.

## Progressive fidelity

Graphics tier rises with the campaign (`TIER_STYLE` in `js/render.js`):

1. Bare wireframe, hairline strokes, sparse stars
2. Glow, denser starfield
3. Heavier glow, full detail

## Layout

```
index.html          entry point
css/style.css       only makes the canvas fullscreen; all drawing is canvas
server.js           zero-dependency static server
js/
  config.js         all tuning: bodies, engines, palette, campaign
  util.js           math and formatting helpers
  orbit.js          conic elements, Kepler propagation, apsides
  body.js           round planet, procedural terrain, pads, atmosphere
  ship.js           multi-stage flight model
  design.js         design -> flight stats and derived performance
  mission.js        ordered objectives
  input.js          keyboard -> semantic actions (touch will hook in here)
  render.js         camera, planet, orbit and ship drawing
  hud.js            three swappable HUD layouts
  hangar.js         the rocket designer
  game.js           state machine, warp, contact detection, scoring
  main.js           bootstrap and the frame loop
test/               node test suites, run with npm test
dev/devshot.html    renders one state statically, for screenshots
docs/               ROADMAP.md (what is built, what is next)
                    ARCHITECTURE.md (why it is built this way)
```

`dev/devshot.html` takes `?screen=hangar|flight|orbit|map|result`, plus
`&level=`, `&hud=` and `&alt=`, and renders a single frame for screenshots.

## Status

See `docs/ROADMAP.md`. Phases 1–6 and 8 are done; the interplanetary capstone
(Earth → Moon → Earth) is Phase 7 and not started — the open problem there is
not the physics but how a player aims a transfer with rotate-and-thrust
controls and no maneuver nodes.

**Nothing here has been human-playtested.** It is verified by autopilots and
headless-browser captures, so the difficulty curve — especially the Earth
ascent — is an educated guess until someone actually flies it.
