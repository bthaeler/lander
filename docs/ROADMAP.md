# LANDER — Roadmap

Tracking file for the orbital rewrite. Update the status boxes as work lands.
Status: `[ ]` not started · `[~]` in progress · `[x]` done

The long-term target the campaign builds toward: **launch from Earth in a
multi-stage craft, transfer to the Moon, land, launch again, return to Earth.**
Then Mars, with sample return trading payload mass against reward.

---

## Phase 1 — Orbital core `[~]`

Replace the flat-ground, constant-gravity world with a planet-centred inertial
frame. This is the load-bearing change; everything else depends on it.

- [x] `util.js` — vector/angle helpers, distance/speed/mass/time formatting
- [x] `orbit.js` — state vector ↔ conic elements, Kepler propagation,
      apoapsis/periapsis, time-to-anomaly
- [x] `body.js` — round planet, procedural terrain as `radius(θ)`, landing
      pads carved flat, atmosphere model
- [x] `config.js` — real body constants, realistic engines, 12-level campaign
- [x] `design.js` — multi-stage design model and derived performance
- [x] `ship.js` — planet-centric position, inertial attitude, radial gravity,
      staging, gimbal steering, atmospheric drag
- [ ] `mission.js`, `game.js` rewrite — the game does not run yet
- [ ] Retire `terrain.js`, `loadout.js`, `shop.js`

**Verified** (`scratchpad/orbittest.mjs`, `scratchpad/physicstest.mjs`):
conic round-trips and energy conservation to ~1e-15 over 500 chained
propagations; retrograde and hyperbolic cases; circular orbit holds radius to
0.0 m over a full orbit; numerical coast agrees with analytic propagation to
6 m over 900 s; staging beats a single stage of equal propellant; a single
stage cannot reach Earth orbit (6222 m/s) but three stages can (14245 m/s).

**Done when:** the existing "drop and land" gameplay works unchanged on a round
planet with inverse-square gravity.

## Phase 2 — Camera, orbit display, colour `[ ]`

- [ ] Log-scale auto-zoom camera: ~5 px/m on touchdown to whole-planet views
- [ ] Camera rotates so local "up" is screen up in flight view
- [ ] Planet drawn by sampling `radius(θ)` across the visible arc — curvature
      and the full disc both fall out of one code path
- [ ] Projected orbit drawn as a conic, with apoapsis/periapsis markers
- [ ] `M` toggles a map view framed on the whole orbit
- [ ] Colour palette (still line art, per-body surface colours, orbit cyan,
      apoapsis/periapsis markers, amber warnings)

**Done when:** you can watch the horizon curve as you climb and see your
projected orbit close.

## Phase 3 — Time warp and life support `[ ]`

- [ ] Warp levels 1×…100000×, `,` / `.` to change
- [ ] Analytic Kepler propagation while coasting (exact at any warp);
      numerical integration, warp-clamped, while thrusting or in atmosphere
- [ ] Life support: mass per unit, hours per unit, consumed by mission time,
      depletion ends the mission
- [ ] HUD: apoapsis/periapsis + time to each, orbital vs surface speed,
      life support remaining, warp state, prograde/retrograde cue

**Done when:** a multi-hour orbital mission is playable in minutes.

## Phase 4 — Multi-stage ships and hangar redesign `[ ]`

- [ ] `design.js` — stage list (engine type, engine count, tank size per
      stage), payload, derived per-stage and total delta-v
- [ ] Realistic exhaust velocities (~3000 m/s), sea-level vs vacuum
- [ ] `hangar.js` — stage editor, mission requirements panel, mass budget,
      rocket silhouette preview, build cost paid per launch
- [ ] Staging in flight, with a stage indicator and prompt
- [ ] Retire `loadout.js` / `shop.js`

**Done when:** you design a rocket to a stated mission requirement and fly it.

## Phase 5 — Mission and level system `[ ]`

- [ ] `mission.js` — ordered objectives: reach altitude, achieve orbit with a
      minimum periapsis, land on a named pad, return to orbit, collect sample
- [ ] Campaign series, every level titled
- [ ] Hangar-first flow: requirements shown before you design
- [ ] Landing no longer ends the flight when objectives remain — sit on the
      surface, then launch again

**Done when:** the Luna campaign runs surface → orbit → round trip → sample
return.

## Phase 6 — Earth and Mars `[ ]`

- [ ] Atmospheric drag, sea-level/vacuum engine performance blending
- [ ] Earth ascent levels (multi-stage genuinely required — ~9.4 km/s)
- [ ] Mars descent and sample return levels

## Phase 7 — Interplanetary `[ ]` (the capstone)

- [ ] Multi-body: Moon orbiting Earth, n-body acceleration
- [ ] Trajectory prediction by numerical propagation when no single body
      dominates
- [ ] Transfer planning aid (the hard playability problem)
- [ ] Earth → Moon → Earth mission, sample return economy

---

## Campaign plan

| # | Title | Body | Mission |
| --- | --- | --- | --- |
| 1 | First Light | Luna | Drop from 400 m, land on Pad Alpha |
| 2 | Descent Profile | Luna | Drop from 3 km with lateral drift |
| 3 | Hop | Luna | Launch from Alpha, land on Beta 12 km away |
| 4 | Above the Line | Luna | Surface → 30 km → land safely |
| 5 | Orbital Insertion | Luna | Surface → orbit, periapsis above 20 km |
| 6 | Deorbit | Luna | Start in 60 km orbit, deorbit, land on Alpha |
| 7 | Round Trip | Luna | Surface → orbit → deorbit → land on Beta |
| 8 | Sample Return | Luna | Land at the crater site, collect, return to orbit |
| 9 | Thick Air | Earth | Suborbital to 60 km and back |
| 10 | Earth Orbit | Earth | Surface → orbit, periapsis above 160 km |
| 11 | Mars Descent | Mars | From orbit, deorbit and land |
| 12 | Mars Sample Return | Mars | Land, collect, return to orbit |

## Deferred, deliberately

- Body rotation (a landed ship has no surface velocity, and there are no
  launch windows). Revisit with Phase 7.
- Rendezvous and docking.
- Reusable/recovered stages in the economy.
