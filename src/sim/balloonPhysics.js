import { PHYSICS } from './constants.js';

// Force invariant: pressure is deliberately absent from this module.
// Buoyancy and enclosed-air weight are functions of measured density only.
export function computeForces({
  rhoOut,
  rhoIn,
  altitudeM,
  velocityMps,
  basketPayloadMassKg,
}) {
  const outsideDensity = Math.max(0.02, rhoOut);
  const insideDensity = Math.max(0.01, rhoIn);

  const upthrustN = outsideDensity * PHYSICS.balloonVolumeM3 * PHYSICS.g;
  const internalAirMassKg = insideDensity * PHYSICS.balloonVolumeM3;
  const balloonContentsWeightN =
    (PHYSICS.envelopeMassKg + internalAirMassKg) * PHYSICS.g;
  const basketWeightN = basketPayloadMassKg * PHYSICS.g;

  const dragMagnitude =
    0.5 *
    outsideDensity *
    PHYSICS.dragCoefficient *
    PHYSICS.referenceAreaM2 *
    velocityMps *
    velocityMps;
  const dragN = velocityMps === 0 ? 0 : -Math.sign(velocityMps) * dragMagnitude;

  const freeNetForceN = upthrustN - balloonContentsWeightN - basketWeightN + dragN;
  const onGround = altitudeM <= 1e-6 && velocityMps <= 0;
  const reactionN = onGround && freeNetForceN < 0 ? -freeNetForceN : 0;
  const netForceN = freeNetForceN + reactionN;

  return {
    rhoOut: outsideDensity,
    rhoIn: insideDensity,
    upthrustN,
    internalAirMassKg,
    balloonContentsWeightN,
    basketWeightN,
    dragN,
    freeNetForceN,
    reactionN,
    netForceN,
  };
}

export function stepBalloon(balloon, forces, basketPayloadMassKg, dt) {
  const inertialMassKg =
    PHYSICS.envelopeMassKg +
    basketPayloadMassKg +
    forces.internalAirMassKg;
  const accelerationMps2 = forces.netForceN / Math.max(1, inertialMassKg);

  let velocityMps = balloon.velocityMps + accelerationMps2 * dt;
  let altitudeM = balloon.altitudeM + velocityMps * dt;

  if (altitudeM <= 0) {
    altitudeM = 0;
    if (velocityMps < 0) velocityMps = 0;
  }

  return {
    altitudeM,
    velocityMps,
    accelerationMps2: altitudeM === 0 && forces.netForceN === 0 ? 0 : accelerationMps2,
  };
}
