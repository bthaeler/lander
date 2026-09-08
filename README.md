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
| In the hangar | `W`/`S` select, `A`/`D` adjust (hold for coarse), `N` add stage, `X` remove stage, `Q`/`E` pick which level to fly, `ENTER` launch |

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
- **Rotation** is torque over inertia, with no artificial damping — you stop
  every rotation you start. Inertia uses the cylinder form `m(L² + W²)/12`
  rather than a thin rod, because splayed gear and tankage put real mass
  off-axis on a short lander. Steering comes from RCS *and* engine gimbal; a
  565 t launcher cannot be turned by thrusters alone.

  Inertia grows with mass *and* the square of size while RCS torque does not
  grow at all, so each attitude tier suits a vehicle roughly three times
  heavier than the last, and the right tier gives any lander about
  0.5 rad/s² — a 90° swing in ~2.5 s. The hangar shows the turn rate and swing
  time for what you have built, and warns when a vehicle is too twitchy or too
  slow to point.
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

### Hardware recovery

The build cost is paid at launch, and you get back a share of **whatever
hardware is still bolted to the ship** when the mission ends. Jettisoned stages
are gone — that is the point of staging — and burnt propellant is gone, but
what is still attached and still in the tanks comes home. An expendable
three-stage launcher recovers almost nothing; a lander that flies home whole
recovers most of itself.

**How much you get back slides with how badly you wrecked it:**

| Outcome | Severity | Salvaged |
| --- | --- | --- |
| Landed, or mission abandoned with the ship intact | 0.00 | 85% |
| Touchdown 3 m/s over the limit | 0.06 | 80% |
| Impact at 45 m/s | 0.70 | 29% |
| Hypersonic impact | 1.00 | 5% |

Coming down badly tilted adds to severity, and landing on the hull rather than
the gear adds more. Not every failure is an impact: an abandoned mission or a
dead crew leaves the vehicle intact, while an escape trajectory loses it
outright.

Two properties this guarantees, both covered by tests:

- **Landing always pays better than crashing, for the same vehicle** — only
  success also pays the mission. Before recovery applied to success it did not:
  crashing was the second-best financial outcome on level 1, beating every
  landing except a textbook one.
- **A losing streak can never dead-end the campaign.** Credits are floored to
  the cost of the vehicle you just flew, on success as well as failure.

Over-building still costs you. Recovery is 85%, not 100%, so flying a 31,000
credit vehicle at a 900 credit contract loses money even with a perfect
landing — which is the intended pressure to build to the mission.

### Replaying levels for money

`Q` and `E` in the hangar pick which level to fly: anything you have already
unlocked. Replaying a level you have completed pays **less mission money each
time** — 100%, 70%, 49%, then a floor of 35% — while hardware recovery does not
decay, because the hardware is worth what it is worth however often you fly it.

The floor is deliberately still worth flying, so a player who has run short can
always mine for money. It is just slow, and how slow depends on where you grind
(figures from `npm run economy`):

| Grind site | Net per run |
| --- | --- |
| Level 1, First Light | +158 |
| Level 3, Hop | +475 |
| Level 8, Sample Return | +1,770 |
| Level 9, Thick Air | +8,703 |
| Level 10, Earth Orbit | **−31,892** |

The gradient falls out of the rules rather than being tuned in: the floor is a
fraction of that level's *own* reward, so harder contracts grind better — and
Earth orbit is a terrible place to farm, because you throw away a 50-tonne
launcher every run. Grinding the best level you can actually fly is always the
right move, and level 1 will fund an Earth launcher only if you fly it a few
hundred times.

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
