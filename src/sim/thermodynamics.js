import { BALLOON, PHYSICS, THERMAL } from './constants.js';
import { clamp, insideEnvelope } from './geometry.js';

export const celsiusToKelvin = (c) => c + 273.15;
export const kelvinToCelsius = (k) => k - 273.15;

export function atmosphericPressurePa(altitudeM) {
  return PHYSICS.seaLevelPressurePa * Math.exp(-Math.max(0, altitudeM) / PHYSICS.atmosphereScaleHeightM);
}

export function outsideDensityKgM3(ambientC, altitudeM = 0) {
  const pressure = atmosphericPressurePa(altitudeM);
  return pressure / (PHYSICS.gasConstantDryAir * celsiusToKelvin(ambientC));
}

export function sigmaForTemperatureK(temperatureK) {
  const ambientK = celsiusToKelvin(15);
  return THERMAL.ambientSigmaAt15C * Math.sqrt(Math.max(1, temperatureK) / ambientK);
}

export function variancePerParticleForTemperatureK(temperatureK) {
  const sigma = sigmaForTemperatureK(temperatureK);
  // Two independent velocity components, each with variance sigma^2.
  return 2 * sigma * sigma;
}

export function temperatureKFromVariance(variance) {
  const ambientK = celsiusToKelvin(15);
  const ambientVariance = variancePerParticleForTemperatureK(ambientK);
  return clamp((variance / ambientVariance) * ambientK, 80, 800);
}

export function exponentialBlend(current, target, dt, tauS) {
  const alpha = 1 - Math.exp(-dt / Math.max(1e-6, tauS));
  return current + (target - current) * alpha;
}

function bandIndexForY(y, bandCount) {
  const t = clamp((y - BALLOON.top) / (BALLOON.bottom - BALLOON.top), 0, 0.999999);
  return Math.floor(t * bandCount);
}

export function measureInsideThermalState(particles, bandCount = THERMAL.thermalBands) {
  const bands = Array.from({ length: bandCount }, () => ({
    count: 0,
    sumVx: 0,
    sumVy: 0,
    indices: [],
  }));
  let insideCount = 0;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    if (!insideEnvelope(p.x, p.y, 0.2)) continue;
    insideCount += 1;
    const band = bands[bandIndexForY(p.y, bandCount)];
    band.count += 1;
    band.sumVx += p.vx;
    band.sumVy += p.vy;
    band.indices.push(i);
  }

  let totalVariance = 0;
  let varianceCount = 0;
  for (const band of bands) {
    if (band.count < 2) continue;
    const meanVx = band.sumVx / band.count;
    const meanVy = band.sumVy / band.count;
    let variance = 0;
    for (const index of band.indices) {
      const p = particles[index];
      const dvx = p.vx - meanVx;
      const dvy = p.vy - meanVy;
      variance += dvx * dvx + dvy * dvy;
    }
    totalVariance += variance;
    varianceCount += band.count;
  }

  const meanVariance = varianceCount > 0 ? totalVariance / varianceCount : 0;
  return {
    insideCount,
    temperatureK: temperatureKFromVariance(meanVariance),
    bands,
  };
}

function rescaleBandThermalVariance(particles, band, targetTotalVariance) {
  if (band.count < 2) return;
  const meanVx = band.sumVx / band.count;
  const meanVy = band.sumVy / band.count;

  let currentTotalVariance = 0;
  for (const index of band.indices) {
    const p = particles[index];
    const dvx = p.vx - meanVx;
    const dvy = p.vy - meanVy;
    currentTotalVariance += dvx * dvx + dvy * dvy;
  }

  if (currentTotalVariance < 1e-9) return;
  const scale = Math.sqrt(Math.max(0, targetTotalVariance) / currentTotalVariance);
  for (const index of band.indices) {
    const p = particles[index];
    p.vx = meanVx + (p.vx - meanVx) * scale;
    p.vy = meanVy + (p.vy - meanVy) * scale;
  }
}

export function setInsideTemperatureK(particles, targetTemperatureK) {
  const measured = measureInsideThermalState(particles);
  const targetVariancePerParticle = variancePerParticleForTemperatureK(targetTemperatureK);
  for (const band of measured.bands) {
    if (band.count < 2) continue;
    rescaleBandThermalVariance(particles, band, targetVariancePerParticle * band.count);
  }
}

export function exchangeHeatWithEnvelope(particles, ambientK, dt, measured = null) {
  const thermalState = measured ?? measureInsideThermalState(particles);
  const ambientVariancePerParticle = variancePerParticleForTemperatureK(ambientK);

  for (const band of thermalState.bands) {
    if (band.count < 2) continue;
    const meanVx = band.sumVx / band.count;
    const meanVy = band.sumVy / band.count;
    let current = 0;
    for (const index of band.indices) {
      const p = particles[index];
      const dvx = p.vx - meanVx;
      const dvy = p.vy - meanVy;
      current += dvx * dvx + dvy * dvy;
    }
    const target = ambientVariancePerParticle * band.count;
    const tauS = current < target
      ? THERMAL.passiveAmbientRecoveryTauS
      : THERMAL.insideThermalExchangeTauS;
    const alpha = 1 - Math.exp(-dt / tauS);
    const blended = current + (target - current) * alpha;
    rescaleBandThermalVariance(particles, band, blended);
  }
}

export function addBurnerHeat(particles, burner, ambientK, dt) {
  if (burner <= 0 || dt <= 0) return 0;

  const top = BALLOON.bottom - THERMAL.heatingZoneTopOffset;
  const bottom = BALLOON.bottom - THERMAL.heatingZoneBottomOffset;
  const indices = [];
  let sumVx = 0;
  let sumVy = 0;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    if (
      p.y >= top &&
      p.y <= bottom &&
      Math.abs(p.x - BALLOON.cx) <= THERMAL.heatingZoneHalfWidth &&
      insideEnvelope(p.x, p.y, 1)
    ) {
      indices.push(i);
      sumVx += p.vx;
      sumVy += p.vy;
    }
  }

  if (indices.length < 2) return indices.length;

  const meanVx = sumVx / indices.length;
  const meanVy = sumVy / indices.length;
  let currentVariance = 0;
  for (const index of indices) {
    const p = particles[index];
    const dvx = p.vx - meanVx;
    const dvy = p.vy - meanVy;
    currentVariance += dvx * dvx + dvy * dvy;
  }

  const deltaTemperatureK = THERMAL.burnerLocalKelvinPerSecond * burner * dt;
  const ambientVariance = variancePerParticleForTemperatureK(ambientK);
  const variancePerK = ambientVariance / ambientK;
  const addedVariance = indices.length * variancePerK * deltaTemperatureK;

  if (currentVariance < 1e-9) return indices.length;
  const scale = Math.sqrt((currentVariance + addedVariance) / currentVariance);
  for (const index of indices) {
    const p = particles[index];
    p.vx = meanVx + (p.vx - meanVx) * scale;
    p.vy = meanVy + (p.vy - meanVy) * scale;
  }

  return indices.length;
}
