import { useEffect, useRef } from 'react';
import { BALLOON, SIM, THERMAL } from '../sim/constants.js';
import {
  clamp,
  fadeOpacity,
  groundYForAltitude,
  halfWidthAtY,
  insideEnvelope,
  smoothstep,
} from '../sim/geometry.js';
import { createSimulation, stepSimulation } from '../sim/simulation.js';
import { atmosphericPressurePa, sigmaForTemperatureK } from '../sim/thermodynamics.js';

const FORCE_PX_PER_KN = 10.5;
const CAMERA_LEAD_M = 5;

function cameraViewForAltitude(altitudeM) {
  const safeAltitudeM = Math.max(0, altitudeM);
  const visibleBalloonRiseM = Math.min(CAMERA_LEAD_M, safeAltitudeM);

  return {
    balloonOffsetY: -visibleBalloonRiseM * SIM.pixelsPerMeter,
    cameraAltitudeM: Math.max(0, safeAltitudeM - CAMERA_LEAD_M),
  };
}

function readColors() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    bg: get('--sim-bg', '#07131f'),
    grid: get('--sim-grid', 'rgba(185,210,230,.14)'),
    text: get('--sim-text', '#eef7ff'),
    muted: get('--sim-muted', '#96abba'),
    cool: get('--sim-particle', '#8bd7ff'),
    hot: get('--sim-hot-particle', '#ffd17a'),
    envelope: get('--sim-envelope', '#e7f4ff'),
    envelopeFill: get('--sim-envelope-fill', 'rgba(82,158,201,.10)'),
    burner: get('--sim-burner', '#ffb356'),
    up: get('--sim-up', '#7ee2a8'),
    down: get('--sim-down', '#ff8f8f'),
    collision: get('--sim-collision', '#f3dc86'),
    ground: get('--sim-ground', '#3b4232'),
    groundLine: get('--sim-ground-line', '#252f25'),
    flow: get('--sim-flow', '#b6d9ef'),
    skinEdge: '#49380c',
    skinMid: '#6d5412',
    skinHighlight: '#8f701e',
  };
}

function daylightColors(colors) {
  return {
    ...colors,
    grid: 'rgba(38, 78, 101, 0.2)',
    text: '#18384a',
    muted: '#476779',
    cool: '#17455f',
    hot: '#b64821',
    collision: '#6b235c',
    particleVisibilityBoost: 1.65,
    envelope: '#fff0d8',
    burner: '#e97823',
    up: '#287b50',
    down: '#a83d49',
    ground: '#647a50',
    groundLine: '#49633f',
    flow: '#3e657b',
    skinEdge: '#b78013',
    skinMid: '#d9aa2f',
    skinHighlight: '#f1cf62',
  };
}

function drawDaylightBackground(ctx) {
  const sky = ctx.createLinearGradient(0, 0, 0, SIM.height);
  sky.addColorStop(0, '#79a8bf');
  sky.addColorStop(0.52, '#a9c9d4');
  sky.addColorStop(1, '#d8ded7');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SIM.width, SIM.height);

  // A broad, low-contrast glow gives the sky depth without introducing a
  // literal sun or decorative clouds.
  const haze = ctx.createRadialGradient(
    SIM.width * 0.76,
    SIM.height * 0.12,
    8,
    SIM.width * 0.76,
    SIM.height * 0.12,
    SIM.width * 0.78,
  );
  haze.addColorStop(0, 'rgba(255, 244, 211, 0.22)');
  haze.addColorStop(1, 'rgba(255, 244, 211, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, SIM.width, SIM.height);
}

function balloonEnvelopePath(ctx, ventOpen, closeForFill = false) {
  const steps = 72;
  ctx.beginPath();
  ctx.moveTo(BALLOON.cx - BALLOON.mouthHalfWidth, BALLOON.bottom);

  for (let i = 0; i <= steps; i += 1) {
    const y = BALLOON.bottom - (i / steps) * (BALLOON.bottom - BALLOON.top);
    ctx.lineTo(BALLOON.cx - halfWidthAtY(y), y);
  }

  if (closeForFill) {
    ctx.lineTo(BALLOON.cx + halfWidthAtY(BALLOON.top), BALLOON.top);
  } else if (ventOpen) {
    ctx.lineTo(BALLOON.cx - BALLOON.ventHalfWidth, BALLOON.top);
    ctx.moveTo(BALLOON.cx + BALLOON.ventHalfWidth, BALLOON.top);
    ctx.lineTo(BALLOON.cx + halfWidthAtY(BALLOON.top), BALLOON.top);
  } else {
    ctx.lineTo(BALLOON.cx + halfWidthAtY(BALLOON.top), BALLOON.top);
  }

  for (let i = 1; i <= steps; i += 1) {
    const y = BALLOON.top + (i / steps) * (BALLOON.bottom - BALLOON.top);
    ctx.lineTo(BALLOON.cx + halfWidthAtY(y), y);
  }

  if (closeForFill) ctx.closePath();
}

function drawPressureGradient(ctx, cameraAltitudeM, colors) {
  // These are world-fixed atmospheric contours, not balloon-relative bands.
  // The camera follows the balloon, so the contours move down the canvas as
  // the balloon climbs, exactly like the ground. Each contour represents a
  // fixed altitude and therefore keeps a fixed pressure value.
  const spacingM = 10;
  const groundY = groundYForAltitude(cameraAltitudeM);

  // Convert the visible canvas bounds back into world altitude.
  const lowestVisibleAltitudeM = Math.max(
    0,
    (groundY - SIM.height) / SIM.pixelsPerMeter,
  );
  const highestVisibleAltitudeM = Math.max(
    0,
    groundY / SIM.pixelsPerMeter,
  );

  const firstAltitudeM =
    Math.ceil(lowestVisibleAltitudeM / spacingM) * spacingM;
  const lastAltitudeM =
    Math.floor(highestVisibleAltitudeM / spacingM) * spacingM;

  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';

  for (
    let altitudeM = firstAltitudeM;
    altitudeM <= lastAltitudeM;
    altitudeM += spacingM
  ) {
    const y = groundY - altitudeM * SIM.pixelsPerMeter;
    if (y < 0 || y > SIM.height) continue;

    const pressurePa = atmosphericPressurePa(altitudeM);

    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(SIM.width - 14, y);
    ctx.stroke();

    // Keep the two quantities visually distinct: altitude on the left,
    // atmospheric pressure on the right. Both belong to this fixed world
    // contour and therefore keep the same values as the balloon moves past.
    ctx.textAlign = 'left';
    ctx.fillText(`${altitudeM.toFixed(0)} m`, 16, y - 5);

    ctx.textAlign = 'right';
    ctx.fillText(`${(pressurePa / 1000).toFixed(2)} kPa`, SIM.width - 16, y - 5);
  }

  ctx.restore();
}

function drawParticle(ctx, p, metrics, groundY, visualOffsetY, toggles, colors) {
  const screenY = p.y + visualOffsetY;
  if (p.x < 0 || p.x > SIM.width || p.y < 0 || p.y > SIM.height) return;
  if (groundY < SIM.height && p.y >= groundY) return;

  // During the five-metre camera lead, particles leave through the top of the
  // viewport as the balloon rises. Reuse those same particles in the exposed
  // strip at the bottom instead of revealing the hidden below-ground reservoir.
  // This is a drawing-only wrap: particle positions and all measurements stay
  // untouched.
  const visualWrapY = screenY < 0 ? SIM.height : 0;
  const wrappedScreenY = screenY + visualWrapY;
  if (wrappedScreenY < 0 || wrappedScreenY > SIM.height) return;

  const alpha = fadeOpacity(p.x, wrappedScreenY);
  if (alpha <= 0.015) return;

  const ambientSigma = sigmaForTemperatureK(metrics.ambientK);
  const ambientRms = Math.SQRT2 * ambientSigma;
  const speed = Math.hypot(p.vx, p.vy);
  const heat = smoothstep(ambientRms * 1.05, ambientRms * 2.0, speed);
  const visibilityBoost = colors.particleVisibilityBoost ?? 1;

  if (toggles.trails && heat > 0.35) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * heat * 0.33 * visibilityBoost);
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.px, p.py + visualWrapY);
    ctx.lineTo(p.x, p.y + visualWrapY);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = Math.min(
    1,
    alpha * (0.34 + heat * 0.52) * visibilityBoost,
  );
  ctx.fillStyle = heat > 0.46 ? colors.hot : colors.cool;
  ctx.beginPath();
  ctx.arc(p.x, p.y + visualWrapY, SIM.particleRadius + heat * 0.3, 0, Math.PI * 2);
  ctx.fill();

  if (toggles.collisions && p.collisionFlash > 0.05) {
    ctx.globalAlpha = Math.min(
      1,
      alpha * p.collisionFlash * visibilityBoost * 1.2,
    );
    ctx.strokeStyle = colors.collision;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y + visualWrapY, 4.2 + (1 - p.collisionFlash) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGround(ctx, groundY, colors) {
  if (groundY >= SIM.height) return;
  const y = Math.max(0, groundY);
  ctx.save();
  ctx.fillStyle = colors.ground;
  ctx.fillRect(0, y, SIM.width, SIM.height - y);
  ctx.strokeStyle = colors.groundLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, y + 1.5);
  ctx.lineTo(SIM.width, y + 1.5);
  ctx.stroke();

  // A quiet scale cue in the background; it moves with the world/ground.
  const drawTree = (x, scale) => {
    ctx.fillStyle = '#7a6047';
    ctx.fillRect(x - 2.5 * scale, y - 25 * scale, 5 * scale, 25 * scale);
    ctx.fillStyle = '#55745d';
    ctx.beginPath();
    ctx.arc(x, y - 34 * scale, 13 * scale, 0, Math.PI * 2);
    ctx.arc(x - 10 * scale, y - 27 * scale, 10 * scale, 0, Math.PI * 2);
    ctx.arc(x + 10 * scale, y - 27 * scale, 10 * scale, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.globalAlpha = 0.4;
  drawTree(20, 0.72);
  drawTree(49, 1);
  ctx.restore();
}

function drawEnvelope(ctx, ventOpen, colors, skinMode = 'none') {
  ctx.save();
  balloonEnvelopePath(ctx, ventOpen, true);
  if (skinMode !== 'none') {
    const skin = ctx.createLinearGradient(
      BALLOON.cx - BALLOON.maxHalfWidth,
      0,
      BALLOON.cx + BALLOON.maxHalfWidth,
      0,
    );
    skin.addColorStop(0, colors.skinEdge);
    skin.addColorStop(0.22, colors.skinMid);
    skin.addColorStop(0.5, colors.skinHighlight);
    skin.addColorStop(0.78, colors.skinMid);
    skin.addColorStop(1, colors.skinEdge);
    ctx.fillStyle = skin;
    if (skinMode === 'faint') ctx.globalAlpha = 0.12;
  } else {
    ctx.fillStyle = colors.envelopeFill;
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  balloonEnvelopePath(ctx, ventOpen, false);
  ctx.strokeStyle = colors.envelope;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (ventOpen) {
    const left = BALLOON.cx - BALLOON.ventHalfWidth;
    const right = BALLOON.cx + BALLOON.ventHalfWidth;

    // A recessed crescent makes the missing crown fabric read as an actual
    // aperture. It is deliberately direction-neutral because vent flow can
    // enter or leave depending on the pressure imbalance.
    ctx.fillStyle = 'rgba(5, 14, 20, 0.88)';
    ctx.beginPath();
    ctx.moveTo(left, BALLOON.top - 1);
    ctx.quadraticCurveTo(BALLOON.cx, BALLOON.top + 17, right, BALLOON.top - 1);
    ctx.quadraticCurveTo(BALLOON.cx, BALLOON.top + 6, left, BALLOON.top - 1);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(left, BALLOON.top);
    ctx.quadraticCurveTo(BALLOON.cx, BALLOON.top + 17, right, BALLOON.top);
    ctx.stroke();

    // Short folded-back seams connect the opening to the surrounding crown.
    ctx.strokeStyle = colors.envelope;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(left, BALLOON.top);
    ctx.lineTo(left - 14, BALLOON.top + 9);
    ctx.moveTo(right, BALLOON.top);
    ctx.lineTo(right + 14, BALLOON.top + 9);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Mouth rim ends, but deliberately no line across the opening.
  ctx.strokeStyle = colors.envelope;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(BALLOON.cx - BALLOON.mouthHalfWidth, BALLOON.bottom, 3, 0, Math.PI * 2);
  ctx.arc(BALLOON.cx + BALLOON.mouthHalfWidth, BALLOON.bottom, 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = '600 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = ventOpen ? colors.hot : colors.muted;
  ctx.fillText(ventOpen ? 'VENT OPEN' : 'parachute vent', BALLOON.cx, BALLOON.top - 14);
  ctx.restore();
}

function drawBurnerFlames(ctx, burner, colors) {
  if (burner <= 0.005) return;

  const flameH = 28 + 82 * burner;
  const now = performance.now();
  const flicker = 0.93 + Math.sin(now / 52) * 0.07;
  const drawFlame = (x) => {
    // Keep a small amount of movement in the exposed lower neck. The solid
    // daylight skin hides the taller tip, but this part remains below the
    // mouth and makes the burner still read as a live, flickering flame.
    const lowerFlicker = Math.sin(now / 68 + x * 0.075);
    const lowerSway = Math.sin(now / 47 + x * 0.045) * 2.4;

    ctx.save();
    ctx.globalAlpha = 0.68 + burner * 0.25;
    ctx.fillStyle = colors.burner;
    ctx.beginPath();
    ctx.moveTo(x - 11, BALLOON.bottom + 32);
    ctx.bezierCurveTo(
      x - 15 - lowerSway * 0.35,
      BALLOON.bottom + 10 + lowerFlicker * 2.5,
      x - 8 + lowerSway,
      BALLOON.bottom - 3 + lowerFlicker * 4,
      x + lowerSway * 0.55,
      BALLOON.bottom + 32 - flameH * flicker,
    );
    ctx.bezierCurveTo(
      x + 8 + lowerSway,
      BALLOON.bottom - 3 - lowerFlicker * 3,
      x + 15 + lowerSway * 0.35,
      BALLOON.bottom + 10 - lowerFlicker * 2,
      x + 11,
      BALLOON.bottom + 32,
    );
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fff4c7';
    ctx.beginPath();
    ctx.moveTo(x - 5, BALLOON.bottom + 32);
    ctx.quadraticCurveTo(
      x + lowerSway * 0.65,
      BALLOON.bottom + 12 + lowerFlicker * 3,
      x + 5 + lowerSway * 0.4,
      BALLOON.bottom + 32 - flameH * 0.58,
    );
    ctx.quadraticCurveTo(x + 6, BALLOON.bottom + 21, x + 5, BALLOON.bottom + 32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  drawFlame(BALLOON.cx - 22);
  drawFlame(BALLOON.cx + 22);
}

function drawBurnerAndBasket(ctx, burner, basketPayloadMassKg, colors, includeFlames = true) {
  const basketX = BALLOON.cx - BALLOON.basketWidth / 2;
  const basketY = BALLOON.basketTop;

  ctx.save();
  // Suspension ropes.
  ctx.strokeStyle = colors.muted;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(BALLOON.cx - BALLOON.mouthHalfWidth + 8, BALLOON.bottom + 3);
  ctx.lineTo(basketX + 12, basketY);
  ctx.moveTo(BALLOON.cx + BALLOON.mouthHalfWidth - 8, BALLOON.bottom + 3);
  ctx.lineTo(basketX + BALLOON.basketWidth - 12, basketY);
  ctx.stroke();

  // Burner frame and twin heads.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.envelope;
  ctx.fillStyle = '#263747';
  ctx.lineWidth = 2;
  ctx.fillRect(BALLOON.cx - 46, BALLOON.bottom + 41, 92, 25);
  ctx.strokeRect(BALLOON.cx - 46, BALLOON.bottom + 41, 92, 25);
  ctx.fillStyle = '#556979';
  ctx.fillRect(BALLOON.cx - 34, BALLOON.bottom + 30, 23, 14);
  ctx.fillRect(BALLOON.cx + 11, BALLOON.bottom + 30, 23, 14);
  ctx.strokeRect(BALLOON.cx - 34, BALLOON.bottom + 30, 23, 14);
  ctx.strokeRect(BALLOON.cx + 11, BALLOON.bottom + 30, 23, 14);

  ctx.strokeStyle = colors.burner;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(BALLOON.cx - 22, BALLOON.bottom + 66);
  ctx.lineTo(BALLOON.cx - 22, BALLOON.bottom + 99);
  ctx.moveTo(BALLOON.cx + 22, BALLOON.bottom + 66);
  ctx.lineTo(BALLOON.cx + 22, BALLOON.bottom + 99);
  ctx.stroke();

  if (includeFlames) drawBurnerFlames(ctx, burner, colors);

  // Basket.
  ctx.fillStyle = '#6e4d33';
  ctx.strokeStyle = '#d2b38e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(basketX, basketY);
  ctx.lineTo(basketX + BALLOON.basketWidth, basketY);
  ctx.lineTo(basketX + BALLOON.basketWidth - 9, BALLOON.basketBottom);
  ctx.lineTo(basketX + 9, BALLOON.basketBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(240,214,178,.45)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = basketY + (i / 4) * BALLOON.basketHeight;
    ctx.beginPath();
    ctx.moveTo(basketX + 6, y);
    ctx.lineTo(basketX + BALLOON.basketWidth - 6, y);
    ctx.stroke();
  }

  // Ballast bags provide a visual cue for the basket + payload slider.
  // The physics still uses the exact continuous mass; the bags are deliberately
  // coarse, at roughly 50 kg per visible bag above the lightest 100 kg setting.
  const ballastBagCount = Math.max(
    0,
    Math.min(8, Math.round((basketPayloadMassKg - 100) / 50)),
  );

  for (let i = 0; i < ballastBagCount; i += 1) {
    const row = Math.floor(i / 4);
    const column = i % 4;
    const rowBagCount = Math.min(4, ballastBagCount - row * 4);
    const bagW = 20;
    const bagH = 18;
    const spacing = 23;
    const rowWidth = (rowBagCount - 1) * spacing;
    const bagCx = BALLOON.cx - rowWidth / 2 + column * spacing;
    const bagTop = basketY + 13 + row * 24;
    const anchorX = bagCx;

    // Short tether from basket to the sack knot.
    ctx.strokeStyle = '#70451f';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(anchorX, bagTop - 1);
    ctx.lineTo(bagCx, bagTop + 4);
    ctx.stroke();

    // Knot / tied neck.
    ctx.fillStyle = '#f3bd45';
    ctx.beginPath();
    ctx.moveTo(bagCx - 3, bagTop + 2);
    ctx.lineTo(bagCx + 3, bagTop + 2);
    ctx.lineTo(bagCx + 1.8, bagTop + 6);
    ctx.lineTo(bagCx - 1.8, bagTop + 6);
    ctx.closePath();
    ctx.fill();

    // Rounded, slightly bulging sandbag body.
    ctx.fillStyle = '#d98b24';
    ctx.strokeStyle = '#6f3d16';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bagCx - bagW * 0.32, bagTop + 5);
    ctx.quadraticCurveTo(bagCx - bagW * 0.58, bagTop + bagH * 0.52, bagCx - bagW * 0.38, bagTop + bagH);
    ctx.quadraticCurveTo(bagCx, bagTop + bagH + 2, bagCx + bagW * 0.38, bagTop + bagH);
    ctx.quadraticCurveTo(bagCx + bagW * 0.58, bagTop + bagH * 0.52, bagCx + bagW * 0.32, bagTop + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Small seam mark helps them read as sacks rather than circles.
    ctx.strokeStyle = 'rgba(255,239,174,.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(bagCx - 4, bagTop + bagH - 3);
    ctx.quadraticCurveTo(bagCx, bagTop + bagH - 1, bagCx + 4, bagTop + bagH - 3);
    ctx.stroke();
  }

  ctx.fillStyle = burner > 0.5 ? colors.burner : colors.muted;
  ctx.font = '700 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(burner > 0.5 ? 'BURNER ON' : 'BURNER', BALLOON.cx, BALLOON.bottom + 59);
  ctx.restore();
}

function drawVerticalForce(
  ctx,
  x,
  y,
  forceN,
  label,
  color,
  side = 'right',
  { minimumForceKN = 0.5, minimumLengthPx = 0, decimals = 1 } = {},
) {
  const forceKN = forceN / 1000;
  const absoluteForceKN = Math.abs(forceKN);
  // Preserve the deliberately exaggerated short arrows, then ease into a 20%
  // compression for long forces so the dominant arrows fit more comfortably.
  const longForceCompression = 1 - 0.2 * smoothstep(3, 8, absoluteForceKN);
  const length = Math.max(
    absoluteForceKN * FORCE_PX_PER_KN * longForceCompression,
    minimumLengthPx,
  );
  if (absoluteForceKN <= minimumForceKN) return;

  const direction = forceKN >= 0 ? -1 : 1;
  const lineEndY = y + direction * length;

  // Arrowhead geometry is deliberately constant. Only shaft/tip distance
  // represents force magnitude, so arrowheads never imply a second scale.
  const shortArrowScale = clamp(absoluteForceKN / 3, 0, 1);
  const headLength = 6 + 6 * shortArrowScale;
  const headHalfWidth = 4 + 3.5 * shortArrowScale;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.8 + 1.4 * shortArrowScale;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, lineEndY);
  ctx.stroke();

  // The scaled force line stops at the flat base of the arrowhead. The fixed
  // arrowhead is then added beyond it, so it does not consume any of the line.
  const tipY = lineEndY + direction * headLength;
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.lineTo(x - headHalfWidth, lineEndY);
  ctx.lineTo(x + headHalfWidth, lineEndY);
  ctx.closePath();
  ctx.fill();

  const labelText = `${label} ${absoluteForceKN.toFixed(decimals)} kN`;
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = side === 'left' ? 'right' : 'left';
  const labelX = x + (side === 'left' ? -12 : 12);
  const labelY = (y + lineEndY) / 2;
  const textWidth = ctx.measureText(labelText).width;
  const padX = 6;
  const padY = 4;
  const boxX = side === 'left'
    ? labelX - textWidth - padX
    : labelX - padX;

  ctx.fillStyle = 'rgba(7, 19, 31, 0.82)';
  ctx.fillRect(boxX, labelY - 9 - padY, textWidth + padX * 2, 18 + padY * 2);
  ctx.fillStyle = color;
  ctx.fillText(labelText, labelX, labelY);
  ctx.restore();
}

function drawForces(ctx, metrics, colors) {
  // All arrows share the same short-force scale and long-force compression.
  drawVerticalForce(
    ctx,
    BALLOON.cx - BALLOON.maxHalfWidth - 25,
    BALLOON.top + 352.8,
    metrics.upthrustN,
    'upthrust',
    colors.up,
    'left',
  );
  drawVerticalForce(ctx, BALLOON.cx, BALLOON.top + 190.8, -metrics.balloonContentsWeightN, 'balloon + contents', colors.down, 'right');
  drawVerticalForce(ctx, BALLOON.cx + 18, BALLOON.basketTop + 24, -metrics.basketWeightN, 'basket', colors.down, 'right');

  if (metrics.reactionN > 0) {
    drawVerticalForce(
      ctx,
      BALLOON.cx - 18,
      BALLOON.basketBottom,
      metrics.reactionN,
      'reaction',
      colors.up,
      'left',
      { minimumForceKN: 0, minimumLengthPx: 8, decimals: 1 },
    );
  }

  if (Math.abs(metrics.dragN) > 120) {
    drawVerticalForce(ctx, SIM.width - 72, BALLOON.top + 60.3, metrics.dragN, 'drag', colors.flow, 'left');
  }

}

function drawScene(ctx, state, toggles, colors, basketPayloadMassKg) {
  const metrics = state.metrics;
  const daylightMode = toggles.daylight;
  const skinMode = !toggles.particles
    ? 'opaque'
    : daylightMode
      ? 'faint'
      : 'none';
  const sceneColors = daylightMode ? daylightColors(colors) : colors;
  const physicalGroundY = groundYForAltitude(metrics.altitudeM);
  const { balloonOffsetY, cameraAltitudeM } = cameraViewForAltitude(metrics.altitudeM);
  const visualGroundY = groundYForAltitude(cameraAltitudeM);

  ctx.clearRect(0, 0, SIM.width, SIM.height);
  if (daylightMode) {
    drawDaylightBackground(ctx);
  } else {
    ctx.fillStyle = sceneColors.bg;
    ctx.fillRect(0, 0, SIM.width, SIM.height);
  }

  if (toggles.pressure) drawPressureGradient(ctx, cameraAltitudeM, sceneColors);

  ctx.save();
  ctx.translate(0, balloonOffsetY);
  if (toggles.particles) {
    for (const p of state.particles) {
      drawParticle(ctx, p, metrics, physicalGroundY, balloonOffsetY, toggles, sceneColors);
    }
  }
  ctx.restore();

  // The solid ground masks particles below it and visibly contacts the basket at altitude zero.
  drawGround(ctx, visualGroundY, sceneColors);

  ctx.save();
  ctx.translate(0, balloonOffsetY);
  if (skinMode !== 'none') drawBurnerFlames(ctx, metrics.burner, sceneColors);
  drawEnvelope(ctx, metrics.ventOpen, sceneColors, skinMode);
  drawBurnerAndBasket(
    ctx,
    metrics.burner,
    basketPayloadMassKg,
    sceneColors,
    skinMode === 'none',
  );

  if (toggles.forces) drawForces(ctx, metrics, sceneColors);
  ctx.restore();
}

export default function SimulationCanvas({
  burner,
  burnerLatched,
  setBurnerLatched,
  setBurnerHeld,
  ventOpen,
  ventLatched,
  setVentLatched,
  setVentHeld,
  basketPayloadMassKg,
  ambientC,
  paused,
  slowMotion,
  toggles,
  resetKey,
  onMetrics,
}) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const controlsRef = useRef(null);
  const burnerPressStartedAtRef = useRef(0);
  const ventPressStartedAtRef = useRef(0);
  const onMetricsRef = useRef(onMetrics);

  controlsRef.current = {
    burner,
    ventOpen,
    basketPayloadMassKg,
    ambientC,
    paused,
    slowMotion,
    toggles,
  };
  onMetricsRef.current = onMetrics;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(SIM.width * dpr);
    canvas.height = Math.round(SIM.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = readColors();
    const state = createSimulation({
      ambientC: controlsRef.current.ambientC,
      seed: (0x51f15e + resetKey * 7919) >>> 0,
    });

    onMetricsRef.current?.(state.metrics);
    let raf = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let lastMetricsPush = previousTime;

    const frame = (now) => {
      const controls = controlsRef.current;
      const realDt = Math.min(0.12, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;

      if (!controls.paused) {
        const timeScale = controls.slowMotion ? 0.25 : 1;
        accumulator += realDt * timeScale;
        let steps = 0;
        while (accumulator >= SIM.fixedDt && steps < SIM.maxFrameSteps) {
          stepSimulation(state, controls, SIM.fixedDt);
          accumulator -= SIM.fixedDt;
          steps += 1;
        }
        if (steps === SIM.maxFrameSteps) accumulator = 0;
      }

      drawScene(ctx, state, controls.toggles, colors, controls.basketPayloadMassKg);

      const { balloonOffsetY } = cameraViewForAltitude(state.metrics.altitudeM);
      hostRef.current?.style.setProperty(
        '--balloon-visual-rise',
        `${(balloonOffsetY / SIM.height) * 100}%`,
      );

      if (now - lastMetricsPush > 120) {
        onMetricsRef.current?.({ ...state.metrics });
        lastMetricsPush = now;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [resetKey]);

  const beginBurnerPress = (event) => {
    burnerPressStartedAtRef.current = performance.now();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setBurnerHeld(true);
  };

  const endBurnerPress = () => {
    const elapsed = performance.now() - burnerPressStartedAtRef.current;
    setBurnerHeld(false);

    // A quick click latches/unlatches the burner. A deliberate hold is purely
    // momentary and stops as soon as the control is released.
    if (elapsed < 240) {
      setBurnerLatched((value) => !value);
    }
  };


  const beginVentPress = (event) => {
    ventPressStartedAtRef.current = performance.now();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setVentHeld(true);
  };

  const endVentPress = () => {
    const elapsed = performance.now() - ventPressStartedAtRef.current;
    setVentHeld(false);

    // Match the burner interaction: a quick click latches/unlatches the vent,
    // while a deliberate hold keeps it open only until the control is released.
    if (elapsed < 240) {
      setVentLatched((value) => !value);
    }
  };

  return (
    <div ref={hostRef} className="simulation-host">
      <canvas
        ref={canvasRef}
        className="simulation-canvas"
        width={SIM.width}
        height={SIM.height}
        aria-label="Hot-air balloon particle simulation"
      />

      <button
        type="button"
        className={`vent-control ${ventOpen ? 'vent-active' : ''} ${
          ventLatched ? 'vent-latched' : ''
        }`}
        aria-pressed={ventLatched}
        aria-label={
          ventLatched
            ? 'Top vent locked open. Click to close it.'
            : 'Top vent control. Hold to open, or click to lock open.'
        }
        onPointerDown={beginVentPress}
        onPointerUp={endVentPress}
        onPointerCancel={() => setVentHeld(false)}
        onLostPointerCapture={() => setVentHeld(false)}
        onKeyDown={(event) => {
          if (event.key === ' ' && !event.repeat) {
            event.preventDefault();
            setVentHeld(true);
          }
          if (event.key === 'Enter' && !event.repeat) {
            event.preventDefault();
            setVentLatched((value) => !value);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ') {
            event.preventDefault();
            setVentHeld(false);
          }
        }}
        onBlur={() => setVentHeld(false)}
      >
        <strong>{ventLatched ? 'VENT LOCKED OPEN' : ventOpen ? 'VENT OPEN' : 'TOP VENT'}</strong>
        <small>{ventLatched ? 'click to close' : 'hold to open · click to lock'}</small>
      </button>

      <button
        type="button"
        className={`burner-control ${burner > 0.5 ? 'burner-active' : ''} ${
          burnerLatched ? 'burner-latched' : ''
        }`}
        aria-pressed={burnerLatched}
        aria-label={
          burnerLatched
            ? 'Burner locked on. Click to unlock.'
            : 'Burner control. Hold to fire, or click to lock on.'
        }
        onPointerDown={beginBurnerPress}
        onPointerUp={endBurnerPress}
        onPointerCancel={() => setBurnerHeld(false)}
        onLostPointerCapture={() => setBurnerHeld(false)}
        onKeyDown={(event) => {
          if (event.key === ' ' && !event.repeat) {
            event.preventDefault();
            setBurnerHeld(true);
          }
          if (event.key === 'Enter' && !event.repeat) {
            event.preventDefault();
            setBurnerLatched((value) => !value);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ') {
            event.preventDefault();
            setBurnerHeld(false);
          }
        }}
        onBlur={() => setBurnerHeld(false)}
      >
        <strong>{burnerLatched ? 'BURNER LOCKED' : burner > 0.5 ? 'FIRING' : 'BURNER'}</strong>
        <small>{burnerLatched ? 'click to release' : 'hold to fire · click to lock'}</small>
      </button>
    </div>
  );
}
