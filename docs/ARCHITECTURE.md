# LANDER — Architecture decisions

Written down so future sessions do not re-derive them. See `ROADMAP.md` for
what is built and what is not.

## Frame of reference

Everything is in a **planet-centred inertial frame**: the body's centre is the
origin, position `(x, y)` in metres, velocity in m/s. There is no flat-ground
special case — a landing is just a very low, very slow orbit that intersects
the terrain.

Consequences:

- Gravity is `a = -mu * r / |r|³`. No constant-`g` path anywhere.
- Altitude is `|r| - body.surfaceRadius(atan2(y, x))`.
- Numbers are large (Luna's radius is 1.7374e6 m). Float64 handles this fine;
  do not introduce Float32 anywhere in the physics.
- **Ship attitude is stored in the inertial frame** (`ship.angle`, CCW from
  +x, so thrust direction is `(cos a, sin a)`). "Angle from vertical" is a
  *derived* quantity — `wrapAngle(upAngle - shipAngle)`. Storing attitude
  relative to local vertical would silently torque the ship as it orbits.

## Why analytic Kepler propagation

Time warp is required (a lunar orbit is ~2 hours; an Earth→Moon transfer is
3 days). Numerical integration at 100000× would need either an unusably large
step or an unusable number of substeps.

So: **while coasting outside the atmosphere, advance the ship analytically**
along its conic — exact at any warp factor, and free. Fall back to fixed-step
numerical integration only while thrusting or inside an atmosphere, and clamp
warp in those regimes.

The same conic solve produces the orbit display, so apoapsis/periapsis markers
and the projected path cost nothing extra.

Retrograde orbits: true anomaly is measured in the direction of motion, so
`nu = wrapAngle(sgn * (theta - argP))` with `sgn = sign(h)`, and the inverse is
`theta = argP + sgn * nu`. Getting this wrong makes clockwise orbits propagate
backwards.

## Terrain as `radius(θ)`

Storing a heightfield for a body 10,900 km around at metre resolution is not
possible. Terrain is instead a **procedural function of angle**: a sum of
octaves of value noise that is periodic in θ (each octave hashes integer
indices around a ring, so it wraps exactly).

Landing pads are carved by special-casing the angular span of each pad to a
constant radius, with a short blend at the shoulders. A pad 120 m wide on Luna
spans 6.9e-5 rad, so it is sub-pixel when zoomed out and appears naturally as
you descend. No level-of-detail machinery needed.

## One drawing path for "flat ground" and "whole planet"

The planet is drawn by sampling `radius(θ)` across the arc that is currently
on screen, at a resolution matched to screen pixels. When zoomed in, the arc is
tiny and reads as near-flat ground with real curvature; when zoomed out, the
arc is the full 2π and reads as a disc. Both come out of the same loop.

Visible angular half-span from a camera at radius `rc` with view radius `D`:

```
cos(span) = (rc² + R² - D²) / (2 · rc · R)
```

`≤ -1` means the whole planet is in view; `≥ 1` means it is entirely outside
the viewport and can be skipped.

## Camera

- **Scale is log-ranged**, roughly 5 px/m at touchdown down to ~1e-6 px/m for
  system views. Driven by altitude in flight view.
- **The camera rotates** so local "up" is screen up in flight view. Without
  this, flying to the far side of the planet puts "down" at the top of the
  screen. Map view is inertial (no rotation).
- Rotation is applied in `worldToScreen`, not via canvas transforms, because
  screen Y is flipped and mixing the two is a reliable source of sign bugs.
  For the same reason, an ellipse drawn with `ctx.ellipse` needs rotation
  `-(argP - camRot)`.

## Mass model

A ship is a payload plus an ordered list of stages, bottom stage first.

```
mass = payload + Σ(stage.structure + engineMass + tankDry + fuelRemaining)
       over stages from the active index upward
```

Staging drops a stage's entire mass. Tank dry mass is a fraction of capacity
(~8.5%), which is what makes single-stage-to-Earth-orbit impossible and
multi-stage necessary — that constraint is the point, do not tune it away.

Exhaust velocity must stay realistic (~3000 m/s) now that missions are
orbital. The earlier arcade build used 580–700 m/s to make a 300 m drop cost
propellant; at orbital scale that would make orbit unreachable.

Rotation: inertia is `m · L² / 12` for a rod of the stack's length, and steering
torque comes from both RCS and engine gimbal (`thrust · gimbalFraction · L/2`).
Gimbal is what lets a large launcher steer at all — RCS alone cannot.

## Mission structure

Objectives are an ordered list evaluated against flight state. A successful
landing does **not** end the flight when objectives remain — the ship rests on
the surface and can launch again. That is what makes "land, then return to
orbit" expressible.
