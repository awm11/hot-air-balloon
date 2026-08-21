# Hot-Air Balloon Lab

A React/Vite hot-air-balloon simulation built around one continuous sea of representative air parcels.

## Run

Vite 8 requires Node 20.19+ or Node 22.12+.

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Headless physics/invariant checks:

```bash
npm run check:sim
```

## Project layout

```text
src/
├── App.jsx
├── main.jsx
├── styles.css
├── components/
│   ├── Controls.jsx
│   ├── Readouts.jsx
│   └── SimulationCanvas.jsx
└── sim/
    ├── balloonPhysics.js
    ├── constants.js
    ├── geometry.js
    ├── random.js
    ├── simulation.js
    └── thermodynamics.js
scripts/
└── sim-check.mjs
```

## Core model

### One particle sea

There are no separate "inside" and "outside" particle types. Roughly 4,200 representative parcels occupy one buffered 2D atmosphere. A parcel is counted as inside only when its current position lies inside the balloon geometry.

The visible canvas is surrounded by an invisible buffer. Particles fade near the visible edge but continue to exist and move there. Horizontal far-field boundaries recycle parcels from the opposite side at ambient thermal conditions. Top and bottom reservoir boundaries re-enter on the same side so they cannot bypass the solid ground.

### Shared geometry

The envelope outline used for drawing is the same geometry used for fabric collision tests. The bottom mouth is a permanent gap. The crown vent is a gap only while the **Pull top vent** control is held.

The vent itself does not suck or push particles. Particles are permitted to cross it in either direction.

### Burner = kinetic energy, not upward momentum

The burner heats only particles already inside the lower envelope. It increases random velocity variance around the local mean velocity, preserving the mean momentum of the heated group. Therefore the burner cannot act as an upward particle pump.

Only two mechanisms are allowed to change random thermal kinetic energy:

1. burner heat input;
2. thermal exchange with the ambient/fabric reservoir.

Pressure flow and balloon motion do not add thermal kinetic energy.

### Temperature

Temperature is inferred from random kinetic energy. Before calculating thermal variance, the sim subtracts the local mean velocity in horizontal bands inside the balloon so organised gas flow is not mistaken for heat.

The dashboard uses a low-pass-filtered temperature, analogous to a macroscopic thermometer rather than an instantaneous molecular reading.

### Pressure proxy and gas redistribution

A few thousand representative parcels cannot reproduce the enormous collision rate that transmits real gas pressure. The simulation therefore computes a coarse pressure proxy:

```text
Pinside / Poutside ≈ (rhoInside × Tinside) / (rhoOutside × Toutside)
```

A sustained mismatch produces a **bidirectional bulk advection field** near an open throat. This field changes particle positions but not their thermal velocities. It reverses automatically when the pressure difference reverses, and disappears inside a deadband near equal pressure.

This is deliberately separate from the balloon-force model.

## Density-only balloon forces

This is a hard invariant of the project: **pressure never enters the buoyancy/resultant-force calculation.**

Both gas densities are measured from particle occupancy:

- `rhoInside`: parcels inside the envelope, calibrated to physical density;
- `rhoOutside`: parcels in a large surrounding-air sample, calibrated to physical density.

The forces are then:

```text
upthrust = rhoOutside × balloonVolume × g

enclosedAirMass = rhoInside × balloonVolume
balloon + contents weight = (envelopeMass + enclosedAirMass) × g

basket weight = (basket + payload mass) × g

free resultant = upthrust
               - balloon + contents weight
               - basket weight
               + drag
```

On the ground:

```text
reaction = max(0, -free resultant)
resultant = free resultant + reaction
```

So a resting balloon has exactly zero resultant. As soon as the density-derived free resultant becomes upward, the reaction force becomes zero and lift-off begins.

All force arrows use the same linear pixels-per-kN scale.

## Ground

At altitude zero the basket visibly touches the solid ground band. The ground is a two-sided particle boundary: particles in the invisible below-ground reservoir cannot leak upward through it. As altitude increases the ground moves downward relative to the balloon and eventually leaves the view.

## Current tuning

The default setup is intended to be visually legible rather than quantitatively identical to one specific real balloon:

- balloon volume: 2,200 m³
- envelope mass: 125 kg
- default basket + payload: 140 kg
- ambient temperature: 15 °C
- representative parcels: 4,200

In the bundled invariant test, the cold balloon remains grounded near ambient temperature. Sustained full burner reduces measured inside density enough to create positive free lift without a temperature runaway. Opening the top vent with the burner off permits traffic in both directions, cools the enclosed gas, raises its density, and makes the free resultant downward.

## Useful tuning points

Most model constants live in `src/sim/constants.js`:

- `SIM.particleCount`
- `THERMAL.burnerLocalKelvinPerSecond`
- `THERMAL.insideThermalExchangeTauS`
- `THERMAL.thermometerTauS`
- `FLOW.pressureDeadband`
- `FLOW.pressureToSpeedPxPerS`
- `PHYSICS.balloonVolumeM3`
- `PHYSICS.envelopeMassKg`
- `PHYSICS.defaultBasketPayloadMassKg`

The intention is that tuning lives there rather than being hidden in the rendering layer.
