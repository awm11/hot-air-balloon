import { BALLOON, FLOW, GROUND, PHYSICS, SIM, THERMAL } from './constants.js';
import {
  bufferBounds,
  clamp,
  envelopeAreaPx2,
  groundYForAltitude,
  inOutsideDensitySample,
  insideEnvelope,
  outsideDensitySampleAreaPx2,
  reflectFabricCrossing,
  smoothstep,
} from './geometry.js';
import { createRng, normalRandom } from './random.js';
import {
  addBurnerHeat,
  celsiusToKelvin,
  exchangeHeatWithEnvelope,
  exponentialBlend,
  measureInsideThermalState,
  sigmaForTemperatureK,
  setInsideTemperatureK,
  outsideDensityKgM3,
  atmosphericPressurePa,
} from './thermodynamics.js';
import { computeForces, stepBalloon } from './balloonPhysics.js';

const FLOW_RATE_WINDOW_S = 4;

function particleDomainArea() {
  const bounds = bufferBounds();
  return (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
}

export function expectedAmbientInsideCount() {
  return (SIM.particleCount / particleDomainArea()) * envelopeAreaPx2();
}

export function expectedAmbientOutsideSampleCount(groundY = groundYForAltitude(0)) {
  return (SIM.particleCount / particleDomainArea()) * outsideDensitySampleAreaPx2(groundY);
}

function countOutsideDensitySample(particles, groundY) {
  let count = 0;
  for (const p of particles) {
    if (inOutsideDensitySample(p.x, p.y, groundY)) count += 1;
  }
  return count;
}

function measuredDensities(state) {
  // Representative parcel mass is calibrated once when the run starts. Changing
  // ambient temperature therefore changes particle KE, but cannot instantly
  // rescale the mass of parcels already inside or outside the balloon.
  const ambientReferenceDensity = state.initialAmbientDensityKgM3;
  const insideRelativeAmbient =
    state.smoothedInsideCount / Math.max(1e-6, state.expectedAmbientInsideCount);
  const expectedOutsideCount = expectedAmbientOutsideSampleCount(
    groundYForAltitude(state.balloon.altitudeM),
  );
  const outsideRelativeAmbient =
    state.smoothedOutsideCount / Math.max(1e-6, expectedOutsideCount);
  const rhoIn = ambientReferenceDensity * insideRelativeAmbient;
  const rhoOut = ambientReferenceDensity * outsideRelativeAmbient;
  return {
    ambientReferenceDensity,
    insideRelativeAmbient,
    outsideRelativeAmbient,
    rhoIn,
    rhoOut,
    densityRatio: rhoIn / Math.max(1e-6, rhoOut),
  };
}

function thermalVelocity(ambientK, rng) {
  const sigma = sigmaForTemperatureK(ambientK);
  return {
    vx: normalRandom(rng) * sigma,
    vy: normalRandom(rng) * sigma,
  };
}

function randomInsidePoint(rng) {
  for (let tries = 0; tries < 1000; tries += 1) {
    const x = BALLOON.cx - BALLOON.maxHalfWidth - 70 + rng() * (2 * BALLOON.maxHalfWidth + 140);
    const y = BALLOON.top + rng() * (BALLOON.bottom - BALLOON.top);
    if (insideEnvelope(x, y, 3)) return { x, y };
  }
  return { x: BALLOON.cx, y: (BALLOON.top + BALLOON.bottom) / 2 };
}

function randomOutsidePoint(rng) {
  const bounds = bufferBounds();
  for (let tries = 0; tries < 1000; tries += 1) {
    const x = bounds.left + rng() * (bounds.right - bounds.left);
    const y = bounds.top + rng() * (bounds.bottom - bounds.top);
    if (!insideEnvelope(x, y, -2)) return { x, y };
  }
  return { x: bounds.left + 10, y: bounds.top + 10 };
}

function createJitteredSea(ambientK, rng) {
  const bounds = bufferBounds();
  const domainW = bounds.right - bounds.left;
  const domainH = bounds.bottom - bounds.top;
  const cols = SIM.gridCols ?? Math.ceil(Math.sqrt(SIM.particleCount * (domainW / domainH)));
  const rows = Math.ceil(SIM.particleCount / cols);
  const cellW = domainW / cols;
  const cellH = domainH / rows;
  const particles = [];

  for (let row = 0; row < rows && particles.length < SIM.particleCount; row += 1) {
    for (let col = 0; col < cols && particles.length < SIM.particleCount; col += 1) {
      const x = bounds.left + (col + 0.16 + 0.68 * rng()) * cellW;
      const y = bounds.top + (row + 0.16 + 0.68 * rng()) * cellH;
      const velocity = thermalVelocity(ambientK, rng);
      particles.push({
        x,
        y,
        px: x,
        py: y,
        vx: velocity.vx,
        vy: velocity.vy,
        wasInside: insideEnvelope(x, y, 0.2),
        collisionFlash: 0,
      });
    }
  }

  // Force the initial occupancy to the analytic ambient expectation so the
  // simulation starts at P_inside ~= P_outside instead of a random count error.
  const targetInside = Math.round(expectedAmbientInsideCount());
  let insideIndices = [];
  let outsideIndices = [];
  for (let i = 0; i < particles.length; i += 1) {
    if (insideEnvelope(particles[i].x, particles[i].y, 0.2)) insideIndices.push(i);
    else outsideIndices.push(i);
  }

  while (insideIndices.length < targetInside && outsideIndices.length) {
    const pick = Math.floor(rng() * outsideIndices.length);
    const index = outsideIndices.splice(pick, 1)[0];
    const point = randomInsidePoint(rng);
    particles[index].x = point.x;
    particles[index].y = point.y;
    particles[index].px = point.x;
    particles[index].py = point.y;
    particles[index].wasInside = true;
    insideIndices.push(index);
  }

  while (insideIndices.length > targetInside) {
    const pick = Math.floor(rng() * insideIndices.length);
    const index = insideIndices.splice(pick, 1)[0];
    const point = randomOutsidePoint(rng);
    particles[index].x = point.x;
    particles[index].y = point.y;
    particles[index].px = point.x;
    particles[index].py = point.y;
    particles[index].wasInside = false;
    outsideIndices.push(index);
  }

  return particles;
}

function capThermalSpeed(p) {
  const speed = Math.hypot(p.vx, p.vy);
  if (speed <= SIM.maxThermalSpeed || speed === 0) return;
  const scale = SIM.maxThermalSpeed / speed;
  p.vx *= scale;
  p.vy *= scale;
}

function openingFlowSpeed(pressureRatio) {
  const error = pressureRatio - 1;
  if (Math.abs(error) <= FLOW.pressureDeadband) return 0;
  const effective = error - Math.sign(error) * FLOW.pressureDeadband;
  return clamp(
    effective * FLOW.pressureToSpeedPxPerS,
    -FLOW.maxOpeningFlowPxPerS,
    FLOW.maxOpeningFlowPxPerS,
  );
}

function bulkFlowAt(x, y, pressureRatio, ventOpen) {
  const pressureSpeed = openingFlowSpeed(pressureRatio);
  let vy = 0;

  // Bottom mouth. Positive pressure error means inside pressure is higher,
  // so the bulk flow points downward/out through the mouth. Negative reverses.
  const mouthDx = Math.abs(x - BALLOON.cx);
  const mouthDy = Math.abs(y - BALLOON.bottom);
  if (
    mouthDx < BALLOON.mouthHalfWidth + FLOW.mouthHorizontalPad &&
    mouthDy < FLOW.mouthVerticalReach
  ) {
    const wx = 1 - smoothstep(BALLOON.mouthHalfWidth, BALLOON.mouthHalfWidth + FLOW.mouthHorizontalPad, mouthDx);
    const wy = 1 - smoothstep(FLOW.mouthVerticalReach * 0.35, FLOW.mouthVerticalReach, mouthDy);
    vy += pressureSpeed * wx * wy;
  }

  // Top vent. The vent itself adds no force; opening it merely exposes a second
  // throat to the same bidirectional pressure-gradient bulk flow field.
  if (ventOpen) {
    const ventDx = Math.abs(x - BALLOON.cx);
    const ventDy = Math.abs(y - BALLOON.top);
    if (
      ventDx < BALLOON.ventHalfWidth + FLOW.ventHorizontalPad &&
      ventDy < FLOW.ventVerticalReach
    ) {
      const wx = 1 - smoothstep(BALLOON.ventHalfWidth, BALLOON.ventHalfWidth + FLOW.ventHorizontalPad, ventDx);
      const wy = 1 - smoothstep(FLOW.ventVerticalReach * 0.3, FLOW.ventVerticalReach, ventDy);
      vy -= pressureSpeed * wx * wy;
    }
  }

  return { vx: 0, vy };
}

function wrapAtReservoirBoundary(p, ambientK, rng) {
  const bounds = bufferBounds();
  const velocity = thermalVelocity(ambientK, rng);

  if (p.x < bounds.left) {
    p.x = bounds.right - 3;
    p.vx = -Math.abs(velocity.vx);
    p.vy = velocity.vy;
  } else if (p.x > bounds.right) {
    p.x = bounds.left + 3;
    p.vx = Math.abs(velocity.vx);
    p.vy = velocity.vy;
  }

  // Do not wrap top <-> bottom: while the ground is visible that would move
  // particles between the atmosphere and the hidden below-ground reservoir.
  // Instead each vertical edge acts as an ambient thermal reservoir wall.
  if (p.y < bounds.top) {
    p.y = bounds.top + 3;
    p.vx = velocity.vx;
    p.vy = Math.abs(velocity.vy);
  } else if (p.y > bounds.bottom) {
    p.y = bounds.bottom - 3;
    p.vx = velocity.vx;
    p.vy = -Math.abs(velocity.vy);
  }

  p.px = p.x;
  p.py = p.y;
  p.wasInside = insideEnvelope(p.x, p.y, 0.2);
}

function maintainFarField(p, ambientK, dt, rng) {
  const bounds = bufferBounds();
  if (p.x < bounds.left || p.x > bounds.right || p.y < bounds.top || p.y > bounds.bottom) {
    wrapAtReservoirBoundary(p, ambientK, rng);
    return;
  }

  const inInvisibleBuffer = p.x < 0 || p.x > SIM.width || p.y < 0 || p.y > SIM.height;
  if (inInvisibleBuffer && rng() < dt / 3.5) {
    const velocity = thermalVelocity(ambientK, rng);
    p.vx = velocity.vx;
    p.vy = velocity.vy;
  }
}

function updateFlux(state, prevInside, nextInside, opening) {
  if (prevInside === nextInside || !opening) return;
  const direction = nextInside ? 'in' : 'out';
  state.flux[opening][direction] += 1;
}

function pushFluxRates(state, dt) {
  for (const opening of ['mouth', 'vent']) {
    const flux = state.flux[opening];
    const sample = { incoming: flux.in, outgoing: flux.out, dt };
    flux.history.push(sample);
    flux.windowIn += sample.incoming;
    flux.windowOut += sample.outgoing;
    flux.windowDuration += dt;

    while (flux.windowDuration > FLOW_RATE_WINDOW_S + 1e-9 && flux.history.length > 1) {
      const oldest = flux.history.shift();
      flux.windowIn -= oldest.incoming;
      flux.windowOut -= oldest.outgoing;
      flux.windowDuration -= oldest.dt;
    }

    // Treat the unfilled part of the startup window as zero flow. This avoids
    // magnifying the first few discrete parcel crossings after a reset.
    const duration = FLOW_RATE_WINDOW_S;
    flux.inRate = flux.windowIn / duration;
    flux.outRate = flux.windowOut / duration;
    flux.netRate = (flux.windowIn - flux.windowOut) / duration;
    flux.in = 0;
    flux.out = 0;
  }
}

export function createSimulation({ ambientC = 15, seed = 0x51f15e } = {}) {
  const rng = createRng(seed);
  const ambientK = celsiusToKelvin(ambientC);
  const particles = createJitteredSea(ambientK, rng);
  setInsideTemperatureK(particles, ambientK);
  const expectedCount = expectedAmbientInsideCount();
  const initialGroundY = groundYForAltitude(0);
  const expectedOutsideCount = expectedAmbientOutsideSampleCount(initialGroundY);
  const measured = measureInsideThermalState(particles);
  const outsideCount = countOutsideDensitySample(particles, initialGroundY);

  const state = {
    rng,
    particles,
    timeS: 0,
    expectedAmbientInsideCount: expectedCount,
    expectedAmbientOutsideCount: expectedOutsideCount,
    smoothedInsideCount: measured.insideCount,
    smoothedOutsideCount: outsideCount,
    smoothedTemperatureK: ambientK,
    initialAmbientDensityKgM3: outsideDensityKgM3(ambientC, 0),
    smoothedPressureRatio: 1,
    flowPressureRatio: 1,
    smoothedJerkMps3: 0,
    balloon: {
      altitudeM: 0,
      velocityMps: 0,
      accelerationMps2: 0,
    },
    flux: {
      mouth: { in: 0, out: 0, inRate: 0, outRate: 0, netRate: 0, history: [], windowIn: 0, windowOut: 0, windowDuration: 0 },
      vent: { in: 0, out: 0, inRate: 0, outRate: 0, netRate: 0, history: [], windowIn: 0, windowOut: 0, windowDuration: 0 },
    },
    metrics: null,
  };

  state.metrics = makeMetrics(state, {
    ambientC,
    basketPayloadMassKg: PHYSICS.defaultBasketPayloadMassKg,
    burner: 0,
    ventOpen: false,
  });
  return state;
}

function makeMetrics(state, controls, measured = null) {
  const ambientK = celsiusToKelvin(controls.ambientC);
  const rawMeasured = measured ?? measureInsideThermalState(state.particles);
  const densities = measuredDensities(state);
  const pressureRatio = state.smoothedPressureRatio;
  const parcelMassKg =
    (state.initialAmbientDensityKgM3 * PHYSICS.balloonVolumeM3) /
    Math.max(1e-6, state.expectedAmbientInsideCount);
  const netVolumeFlowLps = (particleRate) => {
    const openingDensity = particleRate >= 0 ? densities.rhoOut : densities.rhoIn;
    return (particleRate * parcelMassKg * 1000) / Math.max(1e-6, openingDensity);
  };
  const forces = computeForces({
    rhoOut: densities.rhoOut,
    rhoIn: densities.rhoIn,
    altitudeM: state.balloon.altitudeM,
    velocityMps: state.balloon.velocityMps,
    basketPayloadMassKg: controls.basketPayloadMassKg,
  });

  return {
    timeS: state.timeS,
    ambientK,
    rawTemperatureK: rawMeasured.temperatureK,
    temperatureK: state.smoothedTemperatureK,
    rawParticleCount: rawMeasured.insideCount,
    particleCount: state.smoothedInsideCount,
    ambientEquivalentCount: state.expectedAmbientInsideCount,
    outsideParticleCount: state.smoothedOutsideCount,
    outsideAmbientEquivalentCount: expectedAmbientOutsideSampleCount(
      groundYForAltitude(state.balloon.altitudeM),
    ),
    insideDensityRelativeAmbient: densities.insideRelativeAmbient,
    outsideDensityRelativeAmbient: densities.outsideRelativeAmbient,
    densityRatio: densities.densityRatio,
    pressureRatio,
    pressureMismatchPct: (pressureRatio - 1) * 100,
    pressurePa: atmosphericPressurePa(state.balloon.altitudeM),
    altitudeM: state.balloon.altitudeM,
    velocityMps: state.balloon.velocityMps,
    accelerationMps2: state.balloon.accelerationMps2,
    jerkMps3: state.smoothedJerkMps3,
    groundY: groundYForAltitude(state.balloon.altitudeM),
    burner: controls.burner,
    ventOpen: controls.ventOpen,
    ...forces,
    resultantN: forces.netForceN,
    mouthFluxInPerS: state.flux.mouth.inRate,
    mouthFluxOutPerS: state.flux.mouth.outRate,
    mouthNetFluxPerS: state.flux.mouth.netRate,
    mouthNetFlowLps: netVolumeFlowLps(state.flux.mouth.netRate),
    ventFluxInPerS: state.flux.vent.inRate,
    ventFluxOutPerS: state.flux.vent.outRate,
    ventNetFluxPerS: state.flux.vent.netRate,
    ventNetFlowLps: netVolumeFlowLps(state.flux.vent.netRate),
  };
}

export function stepSimulation(state, controls, dt = SIM.fixedDt) {
  const ambientK = celsiusToKelvin(controls.ambientC);
  const pressureRatioForFlow = state.flowPressureRatio;
  const groundY = groundYForAltitude(state.balloon.altitudeM);
  for (const p of state.particles) {
    p.px = p.x;
    p.py = p.y;
    p.collisionFlash = Math.max(0, p.collisionFlash - dt * 4);

    const prev = { x: p.x, y: p.y };
    const prevInside = insideEnvelope(prev.x, prev.y, 0.2);
    const flow = bulkFlowAt(p.x, p.y, pressureRatioForFlow, controls.ventOpen);
    p.x += (p.vx + flow.vx) * dt;
    p.y += (p.vy + flow.vy) * dt;

    // The ground is a two-sided solid boundary. Particles stored in the hidden
    // below-ground reservoir cannot leak upward through it while the balloon is
    // resting; as altitude increases, the ground moves down past those parcels
    // and naturally reveals new atmospheric volume.
    if (groundY < SIM.height + SIM.buffer) {
      const r = SIM.particleRadius;
      const crossedDown = prev.y < groundY && p.y >= groundY - r;
      const crossedUp = prev.y > groundY && p.y <= groundY + r;
      if (crossedDown) {
        p.y = groundY - r;
        if (p.vy > 0) p.vy *= -0.92;
      } else if (crossedUp) {
        p.y = groundY + r;
        if (p.vy < 0) p.vy *= -0.92;
      }
    }

    const candidateInside = insideEnvelope(p.x, p.y, 0.2);
    const crossing = reflectFabricCrossing(p, prev, prevInside, candidateInside, controls.ventOpen);
    if (crossing.collided) p.collisionFlash = 1;

    const nextInside = insideEnvelope(p.x, p.y, 0.2);
    updateFlux(state, prevInside, nextInside, crossing.opening);
    p.wasInside = nextInside;

    capThermalSpeed(p);
    maintainFarField(p, ambientK, dt, state.rng);
  }

  // Only these two operations are allowed to alter random thermal KE:
  // the ambient/fabric reservoir and the burner energy source.
  const preHeatMeasured = measureInsideThermalState(state.particles);
  exchangeHeatWithEnvelope(state.particles, ambientK, dt, preHeatMeasured);
  addBurnerHeat(state.particles, controls.burner, ambientK, dt);

  const measured = measureInsideThermalState(state.particles);
  state.smoothedInsideCount = exponentialBlend(
    state.smoothedInsideCount,
    measured.insideCount,
    dt,
    THERMAL.densityGaugeTauS,
  );
  const outsideCount = countOutsideDensitySample(state.particles, groundY);
  state.smoothedOutsideCount = exponentialBlend(
    state.smoothedOutsideCount,
    outsideCount,
    dt,
    THERMAL.outsideDensityGaugeTauS,
  );
  state.smoothedTemperatureK = exponentialBlend(
    state.smoothedTemperatureK,
    measured.temperatureK,
    dt,
    THERMAL.thermometerTauS,
  );

  const densities = measuredDensities(state);

  // Flow pressure is a faster instrument used only to advect gas through open
  // throats. Using raw local measurements with a short time constant prevents
  // the long phase lag that previously caused large in/out oscillations.
  const rawFlowPressureRatio =
    ((measured.insideCount / Math.max(1e-6, state.expectedAmbientInsideCount)) * measured.temperatureK) /
    Math.max(
      1e-6,
      (outsideCount / Math.max(1e-6, expectedAmbientOutsideSampleCount(groundY))) * ambientK,
    );
  state.flowPressureRatio = exponentialBlend(
    state.flowPressureRatio,
    rawFlowPressureRatio,
    dt,
    THERMAL.flowPressureTauS,
  );

  const rawPressureRatio =
    (densities.rhoIn * state.smoothedTemperatureK) /
    Math.max(1e-6, densities.rhoOut * ambientK);
  state.smoothedPressureRatio = exponentialBlend(
    state.smoothedPressureRatio,
    rawPressureRatio,
    dt,
    THERMAL.pressureGaugeTauS,
  );

  // Flight-force invariant: only measured densities enter buoyancy/weight.
  // The pressure proxy above is used solely for bidirectional gas redistribution.
  const forces = computeForces({
    rhoOut: densities.rhoOut,
    rhoIn: densities.rhoIn,
    altitudeM: state.balloon.altitudeM,
    velocityMps: state.balloon.velocityMps,
    basketPayloadMassKg: controls.basketPayloadMassKg,
  });
  const previousAccelerationMps2 = state.balloon.accelerationMps2;
  state.balloon = stepBalloon(state.balloon, forces, controls.basketPayloadMassKg, dt);
  const rawJerkMps3 = (state.balloon.accelerationMps2 - previousAccelerationMps2) / Math.max(dt, 1e-6);
  state.smoothedJerkMps3 = exponentialBlend(
    state.smoothedJerkMps3,
    rawJerkMps3,
    dt,
    0.4,
  );

  pushFluxRates(state, dt);
  state.timeS += dt;
  state.metrics = makeMetrics(state, controls, measured);
  return state.metrics;
}

export function getGroundY(state) {
  return groundYForAltitude(state.balloon.altitudeM);
}
