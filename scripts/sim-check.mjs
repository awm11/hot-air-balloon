import { BALLOON, PHYSICS, SIM } from '../src/sim/constants.js';
import { computeForces } from '../src/sim/balloonPhysics.js';
import { crossingAllowed } from '../src/sim/geometry.js';
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { kelvinToCelsius } from '../src/sim/thermodynamics.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBetween(value, min, max, message) {
  if (!(value >= min && value <= max)) {
    throw new Error(`${message}: got ${value}, expected ${min}..${max}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: got ${actual}, expected ${expected} ± ${tolerance}`);
  }
}

function runSeconds(state, controls, seconds, observe = null) {
  const steps = Math.ceil(seconds / SIM.fixedDt);
  for (let i = 0; i < steps; i += 1) {
    const metrics = stepSimulation(state, controls, SIM.fixedDt);
    observe?.(metrics);
  }
  return state.metrics;
}

function summary(label, m) {
  console.log(
    `${label.padEnd(22)} ` +
      `T=${kelvinToCelsius(m.temperatureK).toFixed(1)}°C ` +
      `rho(in/out)=${m.rhoIn.toFixed(3)}/${m.rhoOut.toFixed(3)} ` +
      `Pproxy=${(m.pressureRatio * 100).toFixed(1)}% ` +
      `alt=${m.altitudeM.toFixed(1)}m ` +
      `free=${(m.freeNetForceN / 1000).toFixed(2)}kN ` +
      `result=${(m.resultantN / 1000).toFixed(2)}kN`,
  );
}

function assertDensityOnlyForces(m) {
  assertClose(
    m.upthrustN,
    m.rhoOut * PHYSICS.balloonVolumeM3 * PHYSICS.g,
    1e-7,
    'upthrust must use measured outside density only',
  );
  assertClose(
    m.balloonContentsWeightN,
    (PHYSICS.envelopeMassKg + m.rhoIn * PHYSICS.balloonVolumeM3) * PHYSICS.g,
    1e-7,
    'balloon + contents weight must use measured inside density only',
  );

  // balloonPhysics has no pressure input. Re-evaluate the same density state
  // directly and ensure it reproduces the displayed forces.
  const direct = computeForces({
    rhoOut: m.rhoOut,
    rhoIn: m.rhoIn,
    altitudeM: m.altitudeM,
    velocityMps: m.velocityMps,
    basketPayloadMassKg: PHYSICS.defaultBasketPayloadMassKg,
  });
  assertClose(direct.upthrustN, m.upthrustN, 1e-7, 'density-only upthrust invariant');
  assertClose(
    direct.balloonContentsWeightN,
    m.balloonContentsWeightN,
    1e-7,
    'density-only enclosed weight invariant',
  );
}

const base = {
  ambientC: 15,
  basketPayloadMassKg: PHYSICS.defaultBasketPayloadMassKg,
  burner: 0,
  ventOpen: false,
};

const state = createSimulation({ ambientC: 15, seed: 73 });
summary('initial', state.metrics);
assertBetween(kelvinToCelsius(state.metrics.rawTemperatureK), 14.99, 15.01, 'initial temperature');
assertBetween(state.metrics.rhoOut, 1.15, 1.30, 'initial measured outside density');
assertBetween(state.metrics.densityRatio, 0.96, 1.04, 'initial inside/outside density ratio');
assertDensityOnlyForces(state.metrics);

const cold = runSeconds(state, base, 15);
summary('cold idle 15 s', cold);
assertBetween(kelvinToCelsius(cold.temperatureK), 8, 22, 'cold temperature drift');
assertBetween(cold.pressureRatio, 0.88, 1.12, 'cold pressure proxy drift');
assert(cold.altitudeM < 0.02, 'cold balloon should remain grounded');
assert(Math.abs(cold.resultantN) < 1, 'ground reaction should make resultant zero');
assert(cold.reactionN > 0, 'grounded cold balloon should have a reaction force');
assertDensityOnlyForces(cold);

const coldDensityRatio = cold.densityRatio;
let maxHotTemperatureC = -Infinity;
let maxFreeForceN = -Infinity;
let maxAltitudeM = 0;
const hot = runSeconds(
  state,
  { ...base, burner: 1 },
  40,
  (m) => {
    maxHotTemperatureC = Math.max(maxHotTemperatureC, kelvinToCelsius(m.temperatureK));
    maxFreeForceN = Math.max(maxFreeForceN, m.freeNetForceN);
    maxAltitudeM = Math.max(maxAltitudeM, m.altitudeM);
  },
);
summary('full burner 40 s', hot);
assertBetween(maxHotTemperatureC, 35, 110, 'burner temperature should be controlled');
assertBetween(hot.pressureRatio, 0.85, 1.15, 'heated pressure proxy should remain bounded');
assert(hot.densityRatio < coldDensityRatio - 0.06, 'heating should reduce measured inside/outside density');
assert(maxFreeForceN > 0, 'default full burner should create positive free lift at some point');
assert(maxAltitudeM > 1, 'positive density-derived lift should raise the balloon');
assertDensityOnlyForces(hot);

const tempBeforeVent = kelvinToCelsius(hot.temperatureK);
const densityBeforeVent = hot.densityRatio;
let sawVentOut = false;
let sawVentIn = false;
const vented = runSeconds(
  state,
  { ...base, ventOpen: true },
  10,
  (m) => {
    sawVentOut ||= m.ventFluxOutPerS > 0.02;
    sawVentIn ||= m.ventFluxInPerS > 0.02;
  },
);
summary('vent open 10 s', vented);
assert(sawVentOut, 'open vent should permit outward particle traffic');
assert(sawVentIn, 'open vent should permit inward particle traffic');
assert(kelvinToCelsius(vented.temperatureK) < tempBeforeVent, 'venting with burner off should cool the gas');
assert(vented.densityRatio > densityBeforeVent - 0.01, 'cooling/venting should not make density collapse');
assertDensityOnlyForces(vented);

// Geometry invariant: the vent is a literal bidirectional gap when open.
const outward = crossingAllowed(
  { x: BALLOON.cx, y: BALLOON.top + 4 },
  { x: BALLOON.cx, y: BALLOON.top - 4 },
  true,
);
const inward = crossingAllowed(
  { x: BALLOON.cx, y: BALLOON.top - 4 },
  { x: BALLOON.cx, y: BALLOON.top + 4 },
  true,
);
const closed = crossingAllowed(
  { x: BALLOON.cx, y: BALLOON.top + 4 },
  { x: BALLOON.cx, y: BALLOON.top - 4 },
  false,
);
assert(outward.allowed && outward.opening === 'vent', 'open vent should allow outward crossing');
assert(inward.allowed && inward.opening === 'vent', 'open vent should allow inward crossing');
assert(!closed.allowed, 'closed vent should block the same crossing');

console.log('\nSimulation invariants passed.');
