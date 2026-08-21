export const SIM = {
  width: 825,
  // A little extra vertical viewport keeps the two flight panes aligned with
  // the taller readout stack. Balloon geometry and the metres-to-pixels scale
  // are unchanged; the added space sits below the existing scene.
  height: 996,
  buffer: 150,
  // A 10% denser 2D particle sea combined with the 10% wider envelope gives
  // the wider envelope the correct extra depth. Compressing the envelope
  // vertically reduces its enclosed particle count automatically, without
  // thinning the surrounding atmosphere.
  // Scale the particle sea with the added viewport area so its density does
  // not change when the ground scrolls out of view.
  particleCount: 6150,
  gridCols: 73,
  particleRadius: 1.55,
  fadeWidth: 58,
  maxThermalSpeed: 230,
  fixedDt: 1 / 60,
  maxFrameSteps: 6,
  pixelsPerMeter: 22.5,
};

export const BALLOON = {
  cx: 402.5,
  top: 270.2,
  bottom: 744.5,
  maxHalfWidth: 214.5,
  crownHalfWidth: 63.8,
  mouthHalfWidth: 72.6,
  // Deliberately broad so opening the crown creates an obvious, genuinely
  // larger particle boundary rather than only changing a decorative marker.
  ventHalfWidth: 36,
  basketTop: 819.5,
  basketWidth: 108,
  basketHeight: 62,
};

BALLOON.basketBottom = BALLOON.basketTop + BALLOON.basketHeight;

export const THERMAL = {
  ambientSigmaAt15C: 31,
  heatingZoneTopOffset: 106.2,
  heatingZoneBottomOffset: 16.2,
  heatingZoneHalfWidth: 72,
  // Full burner raises the local random-velocity temperature by this amount
  // per simulated second. Because only the lower plume is heated, the whole
  // envelope warms much more slowly.
  burnerLocalKelvinPerSecond: 180,
  insideThermalExchangeTauS: 10,
  // The coarse open-mouth particle model preferentially loses fast parcels
  // and can otherwise drift below ambient at rest. This recovery applies only
  // below ambient; hot-air cooling still uses the 10 s skin-loss constant.
  passiveAmbientRecoveryTauS: 5,
  thermometerTauS: 4.0,
  densityGaugeTauS: 1.6,
  outsideDensityGaugeTauS: 8.0,
  pressureGaugeTauS: 2.2,
  flowPressureTauS: 0.55,
  thermalBands: 5,
};

export const FLOW = {
  // The sparse parcel sea cannot resolve billions of molecular collisions.
  // This coarse bulk-flow field represents the macroscopic pressure-gradient
  // velocity through an opening. It advects positions but does not alter the
  // particles' thermal velocities/kinetic energy.
  pressureDeadband: 0.018,
  pressureToSpeedPxPerS: 1200,
  maxOpeningFlowPxPerS: 150,
  mouthVerticalReach: 99,
  mouthHorizontalPad: 38,
  ventVerticalReach: 63,
  ventHorizontalPad: 26,
};

export const PHYSICS = {
  g: 9.81,
  gasConstantDryAir: 287.05,
  seaLevelPressurePa: 101325,
  atmosphereScaleHeightM: 8434,
  // The widened envelope had 2662 m³ of volume. Reducing its height by 10%
  // with horizontal radii unchanged reduces volume by the same factor.
  balloonVolumeM3: 2395.8,
  envelopeMassKg: 125,
  defaultBasketPayloadMassKg: 140,
  dragCoefficient: 0.611,
  // Vertical motion sees the horizontal cross-section. Width is unchanged,
  // so the drag reference area is unchanged by the height compression.
  referenceAreaM2: 123.2,
};

export const GROUND = {
  zeroAltitudeY: BALLOON.basketBottom,
  bandHeight: SIM.height - BALLOON.basketBottom,
};

export const COLORS = {
  // Used only by pure-canvas fallbacks. CSS variables override these in the UI.
  cool: '#8bd7ff',
  hot: '#ffd17a',
};
