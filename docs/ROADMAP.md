# LANDER — Roadmap

Tracking file for the orbital rewrite. Update the status boxes as work lands.
Status: `[ ]` not started · `[~]` in progress · `[x]` done

The long-term target the campaign builds toward: **launch from Earth in a
multi-stage craft, transfer to the Moon, land, launch again, return to Earth.**
Then Mars, with sample return trading payload mass against reward.

Tagged versions: `v0.1.0` the flat-world arcade lander, `v0.2.0` the orbital
rewrite, `v0.3.0` automated flight systems.

---

## Phase 1 — Orbital core `[x]`

Replaced the flat-ground, constant-gravity world with a planet-centred
inertial frame. This was the load-bearing change; everything else depends on it.

- [x] `util.js` — vector/angle helpers, distance/speed/mass/time formatting
- [x] `orbit.js` — state vector ↔ conic elements, Kepler propagation,
      apoapsis/periapsis, time-to-anomaly
- [x] `body.js` — round planet, procedural terrain as `radius(θ)`, landing
      pads carved flat, atmosphere model
- [x] `config.js` — real body constants, realistic engines, 12-level campaign
- [x] `design.js` — multi-stage design model and derived performance
- [x] `ship.js` — planet-centric position, inertial attitude, radial gravity,
      staging, gimbal steering, atmospheric drag
- [x] Retired `terrain.js`, `loadout.js`, `shop.js`

**Verified:** conic round-trips and energy conservation to ~1e-15 over 500
chained propagations; retrograde and hyperbolic cases; circular orbit holds
radius to 0.0 m over a full orbit; numerical coast agrees with analytic
propagation to 6 m over 900 s.

## Phase 2 — Camera, orbit display, colour `[x]`

- [x] Log-ranged auto-zoom camera: the ship holds a comfortable on-screen size
      when low, then altitude becomes what has to fit
- [x] Camera rotates so local "up" is screen up in flight view
- [x] Planet drawn by sampling `radius(θ)` across the visible arc — curvature
      and the full disc both fall out of one code path
- [x] Projected orbit drawn as a conic, with apoapsis/periapsis markers and an
      IMPACT marker when periapsis is underground
- [x] `M` toggles a map view framed on the whole orbit
- [x] Colour palette: per-body surface colours, cyan trajectory, blue/orange
      apsis markers, amber warnings, orange flame

## Phase 3 — Time warp and life support `[x]`

- [x] Warp 1×…100000×, `,` / `.` to change, auto-clamped under power, in
      atmosphere, and near the surface
- [x] Analytic Kepler propagation while coasting; warp auto-cancels on a
      periapsis approach so it can never skip the ship through the ground
- [x] Life support: mass per unit, hours per unit, consumed by mission time,
      depletion ends the mission
- [x] HUD: apoapsis/periapsis + time to each, orbital vs surface velocity
      split, life support, warp state, prograde cue, downrange-to-pad

## Phase 4 — Multi-stage ships and hangar redesign `[x]`

- [x] `design.js` — stage list (engine type, engine count, tank size per
      stage), payload, derived per-stage and total delta-v
- [x] Realistic exhaust velocities, sea-level vs vacuum blending
- [x] `hangar.js` — stage editor, mission requirements panel, mass budget,
      readiness checks, rocket silhouette, build cost paid per launch
- [x] Staging in flight (`X`), stage indicator, empty-stage prompt
- [x] **Throttle lever** — added because it turned out to be mandatory, not
      optional: with on/off thrust a large launcher pulls 5 g late in the
      first stage and tears through max-Q at 450 kPa. `W`/`S` set a persistent
      throttle, `SPACE` is momentary full thrust, `F` cuts off.

## Phase 5 — Mission and level system `[x]`

- [x] `mission.js` — ordered objectives: reach altitude, achieve orbit with a
      minimum periapsis, land on a named pad, collect sample
- [x] Campaign series, every level titled
- [x] Hangar-first flow: requirements shown before you design
- [x] Landing does not end the flight when objectives remain — the ship rests
      on the surface and can launch again

## Phase 6 — Earth and Mars `[x]`

- [x] Atmospheric drag, sea-level/vacuum engine performance blending
- [x] Earth ascent levels (multi-stage genuinely required)
- [x] Mars descent and sample return levels
- [x] Economy tuned so every level is affordable (`npm run economy`)

**Verified:** a 565 t three-stage launcher reaches a 160 km Earth orbit in
10.8 minutes with max-Q of 31.4 kPa — the real-world figure is ~30–40 kPa,
which is a good independent check on the atmosphere model.

## Phase 8 — Automated flight systems `[x]`

From the original brief. Bought in the hangar, so automation is a mass and
money decision like everything else.

- [x] `COMPUTER_TIERS` — NONE / kill rotation / vector holds / descent assist
- [x] `T` engages, `G` cycles; manual rotation always overrides
- [x] Attitude controller is PD on the inertial angle; descent assist also
      takes the throttle and flies the braking curve
- [x] Verified: with FC-3 installed and descent assist engaged, level 1 lands
      itself at 1.00 m/s dead vertical on Pad Alpha with no other input

## Economy correction `[x]`

- [x] **Hardware recovery on success.** Only crashes recovered hardware, which
      made crashing the second-best financial outcome on level 1 — better than
      every landing except a textbook one. Success now recovers 85% and a
      crash 30%, both of the *surviving* hardware (payload plus attached
      stages plus unburnt propellant), so jettisoned stages stay lost and
      recovery is tied to the design.
- [x] The rebuild floor applies on success too; a rough landing could pay less
      than a crash-plus-floor, which reintroduced the same inversion.

## Salvage and replay `[x]`

- [x] **Salvage slides with impact severity.** A touchdown 3 m/s over the limit
      returns 80% of the surviving hardware; a 45 m/s impact 29%; hypersonic
      5%. Tilt beyond the envelope and landing on the hull add severity.
      Non-impact failures are handled separately: an abort or a dead crew
      leaves the vehicle intact at 85%, an escape trajectory loses it entirely.
- [x] **Level replay for money.** `Q`/`E` in the hangar select any unlocked
      level. Mission payment decays 100% -> 70% -> 49% -> 35% floor; hardware
      recovery does not decay, since decaying it would make grinding
      net-negative and kill the mechanic.
- [x] `session.frontier` tracks progress separately from the selected level, so
      part unlocks do not regress when you go back to level 1.
- [x] Beating the frontier advances it; replaying leaves you in place, so a
      grind loop is ENTER, fly, ENTER.
- [x] Finishing the campaign no longer forces a restart — ENTER returns to the
      hangar with everything replayable.
- [x] `npm run economy` is now seeded and reports net grind income per level.
      Grinding is positive on 11 of 12 levels and the gradient emerges from the
      rules: +158/run on level 1, +8,703 on level 9, and -31,892 on Earth orbit
      where you discard a 50-tonne launcher each attempt.

## Rotation feel `[x]`

Reported as "too sensitive" after actually flying it, and it was a regression:
replacing the flat-world inertia model (`m * 5.0`) with a thin rod
(`m * L²/12`) cut a 4 m lander's inertia by 3.2x, and full-deflection gimbal
piled on top. The starting lander was at 2.65 rad/s² under thrust — a 1.1 s
90° swing, against the 0.53 rad/s² / 2.4 s the flat-world build had settled on.

- [x] Inertia uses the cylinder form `m(L² + W²)/12`. Adds ~55% to a 4 m
      lander and ~1% to a 52 m launcher, so the correction lands exactly where
      the error was.
- [x] `GIMBAL_LENGTH_FACTOR` 0.5 -> 0.2. A real gimbal is that authoritative,
      but real vehicles ration deflection rather than handing the pilot all of
      it.
- [x] RCS ladder respaced so each tier suits a vehicle ~3x heavier, giving
      ~0.5 rad/s² to small, orbital and two-stage landers respectively.
- [x] Hangar shows turn rate and 90° swing time, and warns when a build is
      twitchy or sluggish — fitting a big RCS to a small lander genuinely does
      make it twitchy, so that should be visible before launch, not after.
- [x] Regression test pins the starting lander's rate, the width term in
      inertia, gimbal not dominating, hangar prediction matching flight, and a
      suitable tier existing for each vehicle class.

Stock lander is now 0.49 rad/s² coasting and 0.80 under thrust (2.5 s / 2.0 s
per 90°). Earth ascent and the hands-off descent assist are unaffected.

## Degenerate-conic and warp fixes `[x]`

All reported from actually flying it, and all one root cause: a vertical climb
has **exactly zero angular momentum**, which makes its conic degenerate.

- [x] Boundedness now comes from specific energy, not eccentricity. A radial
      trajectory has `e = 1` whether it is a hop or an escape, so the old test
      labelled a ballistic climb "ESCAPE" while simultaneously warning that it
      intersected the surface. Apoapsis on a radial path now reports the true
      apex (`a(1+e)`, which is also numerically stable as `e` approaches 1,
      unlike `p/(1-e)`).
- [x] Time warp was pinned at **1x** on any vertical climb: the degenerate
      periapsis is the body's centre with time-to-periapsis zero, so the
      periapsis-approach guard fired every frame. Replaced with a
      time-to-impact estimate that uses the conic's surface crossing where the
      conic is valid and free-fall where it is not.
- [x] The guard computed `simDt` *before* cancelling warp, so the dangerous
      step still executed — one probe tunnelled to 1 km *below* the surface.
      Warp now winds down before the interval is chosen, and steps down a level
      at a time rather than slamming to 1x.
- [x] Warp ceilings raised: 5x -> 100x under power, 10x -> 25x in atmosphere,
      25x -> 100x near the surface. Integration holds 120 Hz up to 250x, so
      these are safe; the impact guard does the real protecting.
- [x] The surface-intersect warning is gated to coasting, orbit-like flight.
      On a vertical hop the periapsis is the body's centre by definition and on
      a landing burn hitting the ground is the plan.
- [x] Trajectories are clipped at the surface instead of drawn through the
      body's core, and the impact marker sits on the surface crossing.
- [x] Camera centres on the planet once the body fits inside the viewport, with
      the ship parked above it.
- [x] `?level=N` (and `&credits=`), plus `lander.game.jumpTo(i)`, to start
      straight into a level for testing.

## Quality of life `[~]`

- [x] **Pause** (`P` / `ESC`). Freezes the simulation completely — position,
      velocity, propellant, mission clock, life support, warp and camera.
      Cycling the HUD and aborting stay live, since comparing layouts on a
      still frame is the easiest way to judge them. The overlay doubles as the
      controls reference, which matters now that there are fifteen keys.
- [ ] Save/resume a campaign between sessions
- [ ] Rebindable keys

## Phase 7 — Interplanetary `[ ]` (the capstone, not started)

- [ ] Multi-body: Moon orbiting Earth, n-body acceleration summation
- [ ] Trajectory prediction by numerical propagation when no single body
      dominates (the analytic conic only holds for one attractor)
- [ ] Transfer planning aid — the real playability problem, and the reason
      this is its own phase rather than "add a level"
- [ ] Earth → Moon → Earth mission, sample return economy

The `Body` model is already per-level and the ship integrates whatever
acceleration it is handed, so the physics side is a contained change. The
open question is how a player aims a transfer with rotate-and-thrust controls
and no maneuver nodes.

---

## Campaign

| # | Title | Body | Mission | ΔV |
| --- | --- | --- | --- | --- |
| 1 | FIRST LIGHT | Luna | Drop from 400 m, land on Pad Alpha | 150 |
| 2 | DESCENT PROFILE | Luna | Drop from 3 km with lateral drift | 340 |
| 3 | HOP | Luna | Launch from Alpha, land on Beta 12 km away | 320 |
| 4 | ABOVE THE LINE | Luna | Surface → 30 km → land safely | 760 |
| 5 | ORBITAL INSERTION | Luna | Surface → orbit, periapsis above 20 km | 1980 |
| 6 | DEORBIT | Luna | Start in 60 km orbit, deorbit, land on Alpha | 1950 |
| 7 | ROUND TRIP | Luna | Surface → orbit → land on Beta | 4000 |
| 8 | SAMPLE RETURN | Luna | Land at the crater, collect, return to orbit | 4400 |
| 9 | THICK AIR | Earth | Suborbital to 60 km and back | 2600 |
| 10 | EARTH ORBIT | Earth | Surface → orbit, periapsis above 160 km | 9400 |
| 11 | MARS DESCENT | Mars | From 80 km orbit, deorbit and land | 3800 |
| 12 | MARS SAMPLE RETURN | Mars | Land at Valles, collect, return to orbit | 8200 |

## Known gaps and deferred decisions

- **Not human-playtested.** Everything is verified by autopilots and
  screenshots. The difficulty curve, especially levels 9 and 10, is a guess
  until someone flies it. Earth ascent needs a real gravity turn and is a
  large step up from Luna.
- **Body rotation is not modelled.** A landed ship has no surface velocity and
  there are no launch windows. Revisit with Phase 7, where it starts to matter.
- Rendezvous and docking.
- Recovering *jettisoned* stages (currently they are simply lost, which is
  what makes an expendable design expensive; a recovery-and-refurbish
  mechanic would be a real addition rather than a fix).
- Mobile/touch controls. Input already goes through semantic actions, so this
  attaches in `input.js` without touching game logic.
