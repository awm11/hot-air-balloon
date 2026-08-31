import { useEffect, useRef, useState } from 'react';

const WIDTH = 540;
const HEIGHT = 650;
const METRES_PER_PIXEL = 0.02;
const SPHERE_X = 270;
const SPHERE_RADIUS = 99;
const SPHERE_TOP_Y = SPHERE_RADIUS + 4;
const SPHERE_BOTTOM_Y = HEIGHT - SPHERE_RADIUS - 4;
const SPHERE_START_Y = HEIGHT * 0.82;
const SPHERE_AREA_M2 = Math.PI * (SPHERE_RADIUS * METRES_PER_PIXEL) ** 2;
const CANVAS_AREA_M2 = WIDTH * METRES_PER_PIXEL * HEIGHT * METRES_PER_PIXEL;
const OUTSIDE_AREA_M2 = CANVAS_AREA_M2 - SPHERE_AREA_M2;
const PARTICLE_RADIUS = 1.35;
const DEFAULT_EXTERNAL_DENSITY = 60;
const MAX_EXTERNAL_DENSITY = 80;
const DEFAULT_EXTERNAL_PARTICLE_COUNT = Math.round(
  (OUTSIDE_AREA_M2 * DEFAULT_EXTERNAL_DENSITY) / 10,
) * 10;
const DEFAULT_INNER_DENSITY = 5;
const DEFAULT_INNER_PARTICLE_COUNT = Math.round(
  (SPHERE_AREA_M2 * DEFAULT_INNER_DENSITY) / 3,
) * 3;
const MIN_INNER_PARTICLES = 0;
const MAX_INNER_DENSITY = 100;
const MAX_INNER_PARTICLES = Math.round(
  (SPHERE_AREA_M2 * MAX_INNER_DENSITY) / 3,
) * 3;
const PARTICLE_MASS = 0.035;
const SHELL_MASS = 1.26;
const SHELL_GRAVITY_SCALE = 0;
const GRAVITY = 22;
const THERMAL_SPEED = 82;
const FIXED_DT = 1 / 120;
const MIN_PARTICLES = 1000;
const MAX_PARTICLES = Math.round((OUTSIDE_AREA_M2 * MAX_EXTERNAL_DENSITY) / 10) * 10;
const PRESSURE_BANDS = 5;
const VALVE_TRANSFER_COUNT = 3;
const ADMIT_TRANSIT_SECONDS = 0.7;
const EXPEL_TRANSIT_SECONDS = 1.6;
const ADMIT_GLOW_SECONDS = 1.6;

function createRng(seed = 0x8a71c5) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(rng) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleDepth(rng) {
  // This is the barometric distribution for particles with the gravity and
  // thermal speed used here. It gives the lower fluid a genuinely larger
  // particle population rather than only drawing a darker gradient.
  const k = GRAVITY / (THERMAL_SPEED * THERMAL_SPEED);
  return Math.log(1 + rng() * (Math.exp(k * HEIGHT) - 1)) / k;
}

function createExternalParticle(rng, sphereY) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const x = PARTICLE_RADIUS + rng() * (WIDTH - 2 * PARTICLE_RADIUS);
    const y = PARTICLE_RADIUS
      + Math.min(HEIGHT - 2 * PARTICLE_RADIUS, sampleDepth(rng));
    if (
      Math.hypot(x - SPHERE_X, y - sphereY)
      > SPHERE_RADIUS + PARTICLE_RADIUS + 3
    ) {
      return {
        x,
        y,
        vx: normalRandom(rng) * THERMAL_SPEED,
        vy: normalRandom(rng) * THERMAL_SPEED,
      };
    }
  }
  return {
    x: PARTICLE_RADIUS + rng() * (WIDTH - 2 * PARTICLE_RADIUS),
    y: HEIGHT - 30,
    vx: normalRandom(rng) * THERMAL_SPEED,
    vy: normalRandom(rng) * THERMAL_SPEED,
  };
}

function createInnerParticle(rng, sphereY) {
  const radius = Math.sqrt(rng()) * (SPHERE_RADIUS - 11);
  const angle = rng() * Math.PI * 2;
  return {
    x: SPHERE_X + Math.cos(angle) * radius,
    y: sphereY + Math.sin(angle) * radius,
    vx: normalRandom(rng) * THERMAL_SPEED,
    vy: normalRandom(rng) * THERMAL_SPEED,
  };
}

function createState(particleCount, innerParticleCount) {
  const rng = createRng();
  const sphere = {
    x: SPHERE_X,
    y: SPHERE_START_Y,
    vy: 0,
    mass: SHELL_MASS,
  };
  return {
    rng,
    sphere,
    external: Array.from({ length: particleCount }, () => createExternalParticle(rng, sphere.y)),
    internal: Array.from(
      { length: innerParticleCount },
      () => createInnerParticle(rng, sphere.y),
    ),
    pressureImpulse: Array(PRESSURE_BANDS).fill(0),
    pressure: Array(PRESSURE_BANDS).fill(0),
    pressureElapsed: 0,
    collisionWindow: { outerTop: 0, outerBottom: 0, innerTop: 0, innerBottom: 0 },
    collisionRates: { outerTop: 0, outerBottom: 0, innerTop: 0, innerBottom: 0 },
    collisionElapsed: 0,
    collisionFlashes: [],
    valveTransits: [],
    valveActivity: { admit: 0, expel: 0 },
  };
}

function resetSpherePosition(state, position) {
  const targetY = position === 'top' ? SPHERE_TOP_Y : SPHERE_BOTTOM_Y;
  const deltaY = targetY - state.sphere.y;
  state.sphere.y = targetY;
  state.sphere.vy = 0;

  for (const particle of state.internal) particle.y += deltaY;
  for (const transit of state.valveTransits) {
    if (transit.type !== 'expel') continue;
    transit.particle.y += deltaY;
    transit.startY += deltaY;
  }

  const minimumDistance = SPHERE_RADIUS + PARTICLE_RADIUS + 3;
  for (const particle of state.external) {
    if (Math.hypot(particle.x - state.sphere.x, particle.y - targetY) < minimumDistance) {
      Object.assign(particle, createExternalParticle(state.rng, targetY));
    }
  }
}

function capSpeed(particle) {
  const speed = Math.hypot(particle.vx, particle.vy);
  const maxSpeed = THERMAL_SPEED * 3.2;
  if (speed <= maxSpeed || speed === 0) return;
  const scale = maxSpeed / speed;
  particle.vx *= scale;
  particle.vy *= scale;
}

function pressureBandForY(y) {
  return Math.max(0, Math.min(PRESSURE_BANDS - 1, Math.floor((y / HEIGHT) * PRESSURE_BANDS)));
}

function circleAreaInHorizontalBand(sphereY, bandTop, bandBottom) {
  const lower = Math.max(-SPHERE_RADIUS, Math.min(SPHERE_RADIUS, bandTop - sphereY));
  const upper = Math.max(-SPHERE_RADIUS, Math.min(SPHERE_RADIUS, bandBottom - sphereY));
  const areaPrimitive = (offset) => (
    offset * Math.sqrt(Math.max(0, SPHERE_RADIUS ** 2 - offset ** 2))
    + SPHERE_RADIUS ** 2 * Math.asin(offset / SPHERE_RADIUS)
  );
  return Math.max(0, areaPrimitive(upper) - areaPrimitive(lower));
}

function externalDensityByBand(state) {
  const particleCounts = Array(PRESSURE_BANDS).fill(0);
  for (const particle of state.external) {
    particleCounts[pressureBandForY(particle.y)] += 1;
  }

  const bandHeight = HEIGHT / PRESSURE_BANDS;
  return particleCounts.map((count, index) => {
    const bandTop = index * bandHeight;
    const bandBottom = bandTop + bandHeight;
    const availableAreaPixels = WIDTH * bandHeight
      - circleAreaInHorizontalBand(state.sphere.y, bandTop, bandBottom);
    return count / (availableAreaPixels * METRES_PER_PIXEL ** 2);
  });
}

function collideExternalWithSphere(particle, state) {
  const sphere = state.sphere;
  const dx = particle.x - sphere.x;
  const dy = particle.y - sphere.y;
  const minimumDistance = SPHERE_RADIUS + PARTICLE_RADIUS;
  if (Math.abs(dx) >= minimumDistance || Math.abs(dy) >= minimumDistance) return;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minimumDistance * minimumDistance) return;
  const distance = Math.sqrt(distanceSquared);

  const nx = distance > 1e-6 ? dx / distance : 1;
  const ny = distance > 1e-6 ? dy / distance : 0;
  particle.x = sphere.x + nx * minimumDistance;
  particle.y = sphere.y + ny * minimumDistance;

  const relativeNormalVelocity = particle.vx * nx + (particle.vy - sphere.vy) * ny;
  if (relativeNormalVelocity >= 0) return;

  const impulse =
    (-(1 + 0.98) * relativeNormalVelocity) /
    (1 / PARTICLE_MASS + (ny * ny) / sphere.mass);
  particle.vx += (impulse * nx) / PARTICLE_MASS;
  particle.vy += (impulse * ny) / PARTICLE_MASS;
  sphere.vy -= (impulse * ny) / sphere.mass;

  if (ny < 0) state.collisionWindow.outerTop += 1;
  else state.collisionWindow.outerBottom += 1;

  if (state.collisionFlashes.length < 90) {
    state.collisionFlashes.push({
      x: sphere.x + nx * SPHERE_RADIUS,
      y: sphere.y + ny * SPHERE_RADIUS,
      life: 1,
    });
  }
}

function collideInternalWithSphere(particle, state) {
  const sphere = state.sphere;
  const dx = particle.x - sphere.x;
  const dy = particle.y - sphere.y;
  const maximumDistance = SPHERE_RADIUS - PARTICLE_RADIUS - 2;
  const distance = Math.hypot(dx, dy);
  if (distance <= maximumDistance) return;

  const nx = distance > 1e-6 ? dx / distance : 1;
  const ny = distance > 1e-6 ? dy / distance : 0;
  particle.x = sphere.x + nx * maximumDistance;
  particle.y = sphere.y + ny * maximumDistance;

  const relativeNormalVelocity = particle.vx * nx + (particle.vy - sphere.vy) * ny;
  if (relativeNormalVelocity <= 0) return;

  const impulse =
    ((1 + 0.98) * relativeNormalVelocity) /
    (1 / PARTICLE_MASS + (ny * ny) / sphere.mass);
  particle.vx -= (impulse * nx) / PARTICLE_MASS;
  particle.vy -= (impulse * ny) / PARTICLE_MASS;
  sphere.vy += (impulse * ny) / sphere.mass;

  if (ny < 0) state.collisionWindow.innerTop += 1;
  else state.collisionWindow.innerBottom += 1;
}

function syncExternalParticleCount(state, targetCount) {
  if (state.external.length > targetCount) {
    state.external.length = targetCount;
    return;
  }
  while (state.external.length < targetCount) {
    state.external.push(createExternalParticle(state.rng, state.sphere.y));
  }
}

function syncInnerParticleCount(state, targetCount) {
  if (state.internal.length > targetCount) {
    state.internal.length = targetCount;
    return;
  }
  while (state.internal.length < targetCount) {
    state.internal.push(createInnerParticle(state.rng, state.sphere.y));
  }
}

function removeNearestParticle(particles, x, y) {
  if (particles.length === 0) return null;

  let nearestIndex = 0;
  let nearestDistanceSquared = Infinity;
  for (let index = 0; index < particles.length; index += 1) {
    const dx = particles[index].x - x;
    const dy = particles[index].y - y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < nearestDistanceSquared) {
      nearestIndex = index;
      nearestDistanceSquared = distanceSquared;
    }
  }

  return particles.splice(nearestIndex, 1)[0];
}

function processValveCommands(state, commands) {
  while (commands.length > 0) {
    const command = commands.shift();
    let transferred = 0;

    while (transferred < command.count) {
      const offsetY = (transferred - (command.count - 1) / 2) * 5;
      const valveX = state.sphere.x
        + (command.type === 'admit' ? -SPHERE_RADIUS : SPHERE_RADIUS);
      const valveY = state.sphere.y + offsetY;
      const source = command.type === 'admit' ? state.external : state.internal;
      const particle = removeNearestParticle(source, valveX, valveY);
      if (!particle) break;

      state.valveTransits.push({
        type: command.type,
        particle,
        startX: particle.x,
        startY: particle.y,
        offsetY,
        progress: 0,
      });
      transferred += 1;
    }

    if (transferred > 0) state.valveActivity[command.type] = 1;
  }
}

function updateValveTransits(state, dt) {
  const remaining = [];

  for (const transit of state.valveTransits) {
    const transitSeconds = transit.type === 'admit'
      ? ADMIT_TRANSIT_SECONDS
      : EXPEL_TRANSIT_SECONDS;
    transit.progress = Math.min(1, transit.progress + dt / transitSeconds);
    const easedProgress = transit.type === 'admit'
      ? transit.progress
      : transit.progress < 0.5
        ? 2 * transit.progress * transit.progress
        : 1 - ((-2 * transit.progress + 2) ** 2) / 2;
    const destinationX = transit.type === 'admit'
      ? state.sphere.x - SPHERE_RADIUS + 8
      : state.sphere.x + SPHERE_RADIUS + PARTICLE_RADIUS + 3;
    const destinationY = state.sphere.y + transit.offsetY;
    transit.particle.x = transit.startX
      + (destinationX - transit.startX) * easedProgress;
    transit.particle.y = transit.startY
      + (destinationY - transit.startY) * easedProgress;

    if (transit.progress < 1) {
      remaining.push(transit);
      continue;
    }

    transit.particle.vx = Math.abs(transit.particle.vx) + 38;
    transit.particle.vy = state.sphere.vy + normalRandom(state.rng) * 12;
    if (transit.type === 'admit') {
      transit.particle.admitGlow = 1;
      state.internal.push(transit.particle);
    } else {
      state.external.push(transit.particle);
    }
  }

  state.valveTransits = remaining;
}

function stepState(state, targetExternalCount, targetInnerCount, valveCommands, dt) {
  processValveCommands(state, valveCommands);
  const pendingExpel = state.valveTransits.filter((transit) => transit.type === 'expel').length;
  const pendingAdmit = state.valveTransits.length - pendingExpel;
  syncExternalParticleCount(state, targetExternalCount - pendingExpel);
  syncInnerParticleCount(state, targetInnerCount - pendingAdmit);
  const sphere = state.sphere;

  sphere.vy += GRAVITY * SHELL_GRAVITY_SCALE * dt;
  sphere.vy *= Math.exp(-0.025 * dt);
  sphere.y += sphere.vy * dt;

  if (sphere.y < SPHERE_TOP_Y) {
    sphere.y = SPHERE_TOP_Y;
    if (sphere.vy < 0) sphere.vy = 0;
  } else if (sphere.y > SPHERE_BOTTOM_Y) {
    sphere.y = SPHERE_BOTTOM_Y;
    if (sphere.vy > 0) sphere.vy = 0;
  }

  for (const particle of state.external) {
    particle.vy += GRAVITY * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;

    if (particle.x < PARTICLE_RADIUS) {
      const incomingSpeed = Math.abs(particle.vx);
      particle.x = PARTICLE_RADIUS;
      particle.vx = Math.abs(particle.vx);
      state.pressureImpulse[pressureBandForY(particle.y)] += 2 * PARTICLE_MASS * incomingSpeed;
    } else if (particle.x > WIDTH - PARTICLE_RADIUS) {
      const incomingSpeed = Math.abs(particle.vx);
      particle.x = WIDTH - PARTICLE_RADIUS;
      particle.vx = -Math.abs(particle.vx);
      state.pressureImpulse[pressureBandForY(particle.y)] += 2 * PARTICLE_MASS * incomingSpeed;
    }

    if (particle.y < PARTICLE_RADIUS) {
      particle.y = PARTICLE_RADIUS;
      particle.vy = Math.abs(particle.vy);
    } else if (particle.y > HEIGHT - PARTICLE_RADIUS) {
      particle.y = HEIGHT - PARTICLE_RADIUS;
      particle.vy = -Math.abs(particle.vy);
    }

    collideExternalWithSphere(particle, state);
    capSpeed(particle);
  }

  for (const particle of state.internal) {
    particle.vy += GRAVITY * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    collideInternalWithSphere(particle, state);
    capSpeed(particle);
    if (particle.admitGlow) {
      particle.admitGlow = Math.max(0, particle.admitGlow - dt / ADMIT_GLOW_SECONDS);
    }
  }

  state.pressureElapsed += dt;
  if (state.pressureElapsed >= 0.45) {
    for (let index = 0; index < PRESSURE_BANDS; index += 1) {
      const measured = state.pressureImpulse[index] / state.pressureElapsed;
      state.pressure[index] += (measured - state.pressure[index]) * 0.42;
      state.pressureImpulse[index] = 0;
    }
    state.pressureElapsed = 0;
  }

  state.collisionElapsed += dt;
  if (state.collisionElapsed >= 3) {
    state.collisionRates = Object.fromEntries(
      Object.entries(state.collisionWindow).map(([surface, count]) => [
        surface,
        Math.round(count / 3),
      ]),
    );
    state.collisionWindow.outerTop = 0;
    state.collisionWindow.outerBottom = 0;
    state.collisionWindow.innerTop = 0;
    state.collisionWindow.innerBottom = 0;
    state.collisionElapsed -= 3;
  }

  for (const flash of state.collisionFlashes) flash.life -= dt * 4.5;
  state.collisionFlashes = state.collisionFlashes.filter((flash) => flash.life > 0);
  updateValveTransits(state, dt);
  state.valveActivity.admit = Math.max(0, state.valveActivity.admit - dt * 0.62);
  state.valveActivity.expel = Math.max(0, state.valveActivity.expel - dt * 0.62);
}

function fadeSceneEdges(ctx) {
  const fadeWidth = WIDTH * 0.1;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const leftFade = ctx.createLinearGradient(0, 0, fadeWidth, 0);
  leftFade.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
  leftFade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = leftFade;
  ctx.fillRect(0, 0, fadeWidth, HEIGHT);

  const rightFade = ctx.createLinearGradient(WIDTH - fadeWidth, 0, WIDTH, 0);
  rightFade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rightFade.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
  ctx.fillStyle = rightFade;
  ctx.fillRect(WIDTH - fadeWidth, 0, fadeWidth, HEIGHT);
  ctx.restore();
}

function drawOneWayValves(ctx, state) {
  const sphere = state.sphere;
  const valveY = sphere.y;
  const admitX = sphere.x - SPHERE_RADIUS;
  const expelX = sphere.x + SPHERE_RADIUS;

  const drawValve = (x, colour, activity) => {
    ctx.fillStyle = activity > 0 ? colour : 'rgba(136, 164, 180, 0.78)';
    ctx.strokeStyle = activity > 0 ? '#fff0c8' : 'rgba(226, 238, 245, 0.76)';
    ctx.lineWidth = activity > 0 ? 2 : 1.2;
    ctx.fillRect(x - 5, valveY - 12, 10, 24);
    ctx.strokeRect(x - 5, valveY - 12, 10, 24);
  };

  drawValve(admitX, '#77d9a6', state.valveActivity.admit);
  drawValve(expelX, '#ffb356', state.valveActivity.expel);

  ctx.lineWidth = 1.8;
  const drawArrow = (startX, endX, y, colour) => {
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(endX, y);
    ctx.lineTo(endX - 5, y - 3.5);
    ctx.lineTo(endX - 5, y + 3.5);
    ctx.closePath();
    ctx.fill();
  };

  drawArrow(admitX - 22, admitX - 7, valveY, '#77d9a6');
  drawArrow(expelX + 7, expelX + 22, valveY, '#ffb356');

  ctx.font = '700 9px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9ee8be';
  ctx.textAlign = 'right';
  ctx.fillText('IN', admitX - 9, valveY - 16);
  ctx.fillStyle = '#ffc77f';
  ctx.textAlign = 'left';
  ctx.fillText('OUT', expelX + 9, valveY - 16);

  for (const transit of state.valveTransits) {
    const visibility = Math.sin(transit.progress * Math.PI);
    const { x, y } = transit.particle;
    ctx.globalAlpha = 0.22 + visibility * 0.24;
    ctx.fillStyle = transit.type === 'admit' ? '#b9ffd6' : '#ffe0a6';
    ctx.beginPath();
    ctx.arc(x, y, PARTICLE_RADIUS + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = transit.type === 'admit' ? '#d6ffe6' : '#fff0bd';
    ctx.beginPath();
    ctx.arc(x, y, PARTICLE_RADIUS + 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawState(ctx, state) {
  ctx.fillStyle = '#0d2738';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (let index = 1; index < PRESSURE_BANDS; index += 1) {
    const y = (HEIGHT / PRESSURE_BANDS) * index;
    ctx.strokeStyle = 'rgba(156, 201, 225, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.fillStyle = 'rgb(194, 231, 248)';
  ctx.globalAlpha = 0.62;
  ctx.beginPath();
  for (const particle of state.external) {
    ctx.moveTo(particle.x + PARTICLE_RADIUS, particle.y);
    ctx.arc(particle.x, particle.y, PARTICLE_RADIUS, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  fadeSceneEdges(ctx);

  const sphere = state.sphere;
  const sphereFill = ctx.createRadialGradient(
    sphere.x - 15,
    sphere.y - 18,
    8,
    sphere.x,
    sphere.y,
    SPHERE_RADIUS,
  );
  sphereFill.addColorStop(0, 'rgba(255, 203, 119, 0.25)');
  sphereFill.addColorStop(1, 'rgba(184, 116, 46, 0.12)');
  ctx.fillStyle = sphereFill;
  ctx.strokeStyle = '#ffd38f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sphere.x, sphere.y, SPHERE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  for (const particle of state.internal) {
    ctx.fillStyle = '#ffb356';
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, PARTICLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (particle.admitGlow > 0) {
      const glowStrength = particle.admitGlow ** 2;
      ctx.globalAlpha = glowStrength * 0.46;
      ctx.fillStyle = '#b9ffd6';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, PARTICLE_RADIUS + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = glowStrength;
      ctx.fillStyle = '#d6ffe6';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, PARTICLE_RADIUS + 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  for (const flash of state.collisionFlashes) {
    ctx.strokeStyle = `rgba(255, 228, 170, ${flash.life})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, 3 + (1 - flash.life) * 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawOneWayValves(ctx, state);

  ctx.fillStyle = '#ffe4b7';
  ctx.font = '700 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CLOSED SPHERE', sphere.x, sphere.y - SPHERE_RADIUS - 11);
  ctx.textAlign = 'left';

}

export default function LearnBuoyancy() {
  const canvasRef = useRef(null);
  const valveCommandRef = useRef([]);
  const spherePositionCommandRef = useRef(null);
  const particleCountRef = useRef(DEFAULT_EXTERNAL_PARTICLE_COUNT);
  const innerParticleCountRef = useRef(DEFAULT_INNER_PARTICLE_COUNT);
  const [particleCount, setParticleCount] = useState(DEFAULT_EXTERNAL_PARTICLE_COUNT);
  const [innerParticleCount, setInnerParticleCount] = useState(DEFAULT_INNER_PARTICLE_COUNT);
  const [collapsedCollisionSurfaces, setCollapsedCollisionSurfaces] = useState({
    outer: false,
    inner: false,
  });
  const [sphereReadout, setSphereReadout] = useState({
    heightPct: Math.round((1 - SPHERE_START_Y / HEIGHT) * 100),
    velocity: 0,
    outerTopCollisions: 0,
    outerBottomCollisions: 0,
    innerTopCollisions: 0,
    innerBottomCollisions: 0,
    pressure: Array(PRESSURE_BANDS).fill(0),
    densityByBand: Array(PRESSURE_BANDS).fill(
      DEFAULT_EXTERNAL_PARTICLE_COUNT / OUTSIDE_AREA_M2,
    ),
  });
  particleCountRef.current = particleCount;
  innerParticleCountRef.current = innerParticleCount;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const state = createState(particleCountRef.current, innerParticleCountRef.current);
    let frameId = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let lastReadoutTime = previousTime;

    const frame = (now) => {
      accumulator += Math.min(0.08, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;

      if (spherePositionCommandRef.current) {
        resetSpherePosition(state, spherePositionCommandRef.current);
        spherePositionCommandRef.current = null;
      }

      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 10) {
        stepState(
          state,
          particleCountRef.current,
          innerParticleCountRef.current,
          valveCommandRef.current,
          FIXED_DT,
        );
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === 10) accumulator = 0;

      drawState(ctx, state);
      if (now - lastReadoutTime >= 240) {
        setSphereReadout({
          heightPct: Math.round((1 - state.sphere.y / HEIGHT) * 100),
          velocity: -state.sphere.vy,
          outerTopCollisions: state.collisionRates.outerTop,
          outerBottomCollisions: state.collisionRates.outerBottom,
          innerTopCollisions: state.collisionRates.innerTop,
          innerBottomCollisions: state.collisionRates.innerBottom,
          pressure: [...state.pressure],
          densityByBand: externalDensityByBand(state),
        });
        lastReadoutTime = now;
      }
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const motion = Math.abs(sphereReadout.velocity) < 2
    ? 'jiggling near equilibrium'
    : sphereReadout.velocity > 0
      ? 'rising'
      : 'sinking';
  const outsideDensity = particleCount / OUTSIDE_AREA_M2;
  const insideDensity = innerParticleCount / SPHERE_AREA_M2;
  const outsideSliderWidth = Math.min(
    100,
    ((MAX_PARTICLES / OUTSIDE_AREA_M2) / (MAX_INNER_PARTICLES / SPHERE_AREA_M2)) * 100,
  );
  const pressureMaximum = Math.max(1, ...sphereReadout.pressure) * 1.2;

  const toggleCollisionSurface = (surface) => {
    setCollapsedCollisionSurfaces((current) => ({
      ...current,
      [surface]: !current[surface],
    }));
  };

  const operateValve = (type) => {
    const currentInside = innerParticleCountRef.current;
    const currentOutside = particleCountRef.current;
    const available = type === 'expel'
      ? Math.min(currentInside - MIN_INNER_PARTICLES, MAX_PARTICLES - currentOutside)
      : Math.min(MAX_INNER_PARTICLES - currentInside, currentOutside - MIN_PARTICLES);
    const count = Math.min(VALVE_TRANSFER_COUNT, Math.max(0, available));
    if (count === 0) return;

    const nextInside = currentInside + (type === 'admit' ? count : -count);
    const nextOutside = currentOutside + (type === 'expel' ? count : -count);
    innerParticleCountRef.current = nextInside;
    particleCountRef.current = nextOutside;
    valveCommandRef.current.push({ type, count });
    setInnerParticleCount(nextInside);
    setParticleCount(nextOutside);
  };

  return (
    <section className="learn-section learn-buoyancy-lesson" aria-labelledby="learn-title">
      <div className="learn-intro">
        <p className="learn-kicker">LEARN 2 OF 2 · BUOYANCY FROM COLLISIONS</p>
        <h2 id="learn-title">Why does a less-dense object rise?</h2>
        <p>
          Gravity makes the surrounding particle sea denser—and its collision pressure larger—at
          greater depth. Every collision transfers momentum to the closed sphere. When its
          interior contains fewer particles than the same volume outside, the stronger impacts on
          its lower surface can overcome the downward momentum transferred by the particles
          inside. The shell itself is weightless, but retains inertial mass.
        </p>
      </div>

      <div className="learn-causal-chain" aria-label="Buoyancy causal chain">
        <span>gravity</span><b>→</b><span>more particles lower down</span><b>→</b>
        <span>unequal collision pressure</span><b>→</b><span>buoyancy</span>
      </div>

      <div className="learn-simulation-card">
        <div className="learn-visual-row">
          <aside className="learn-left-pane" aria-label="Density and sphere controls">
            <div className="learn-controls">
              <section className="learn-density-group" aria-labelledby="learn-density-title">
                <div className="learn-group-heading">
                  <p id="learn-density-title">PARTICLE DENSITY</p>
                  <small>shared scale · 0–100 particles/m²</small>
                </div>

                <label className="learn-particle-control learn-particle-control-outside">
                  <span>
                    <strong>Average outside particle density</strong>
                    <output>{outsideDensity.toFixed(1)} particles/m²</output>
                  </span>
                  <input
                    type="range"
                    min={MIN_PARTICLES}
                    max={MAX_PARTICLES}
                    step="1"
                    value={particleCount}
                    aria-label="Average outside particle density"
                    aria-valuetext={`${outsideDensity.toFixed(1)} particles per square metre`}
                    style={{ width: `${outsideSliderWidth}%` }}
                    onChange={(event) => setParticleCount(Number(event.target.value))}
                  />
                  <small>
                    {particleCount.toLocaleString('en-GB')} particles across{' '}
                    {OUTSIDE_AREA_M2.toFixed(1)} m²
                  </small>
                </label>

                <div className="learn-particle-control learn-particle-control-inside">
                  <span>
                    <strong>Inside particle density</strong>
                    <output>{insideDensity.toFixed(1)} particles/m²</output>
                  </span>
                  <input
                    type="range"
                    min={MIN_INNER_PARTICLES}
                    max={MAX_INNER_PARTICLES}
                    step="3"
                    value={innerParticleCount}
                    aria-label="Inside particle density"
                    aria-valuetext={`${insideDensity.toFixed(1)} particles per square metre`}
                    onChange={(event) => setInnerParticleCount(Number(event.target.value))}
                  />
                  <small>
                    {innerParticleCount} particles inside {SPHERE_AREA_M2.toFixed(1)} m²
                  </small>

                  <div className="learn-transfer-control">
                    <span>ADJUST THROUGH THE VALVES</span>
                    <div className="learn-valve-actions">
                      <button
                        type="button"
                        className="learn-valve-expel"
                        disabled={
                          innerParticleCount <= MIN_INNER_PARTICLES
                          || particleCount >= MAX_PARTICLES
                        }
                        onClick={() => operateValve('expel')}
                      >
                        Expel particles
                      </button>
                      <button
                        type="button"
                        className="learn-valve-admit"
                        disabled={
                          innerParticleCount >= MAX_INNER_PARTICLES
                          || particleCount <= MIN_PARTICLES
                        }
                        onClick={() => operateValve('admit')}
                      >
                        Let in particles
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <div className="learn-position-control">
                <p>SPHERE POSITION</p>
                <div className="learn-position-actions">
                  <button
                    type="button"
                    onClick={() => { spherePositionCommandRef.current = 'top'; }}
                  >
                    <span aria-hidden="true">↑</span> Reset at top
                  </button>
                  <p className="learn-live-state" aria-live="polite">
                    Height <strong>{sphereReadout.heightPct}%</strong>
                    <span aria-hidden="true">·</span>
                    <strong>{motion}</strong>
                  </p>
                  <button
                    type="button"
                    onClick={() => { spherePositionCommandRef.current = 'bottom'; }}
                  >
                    <span aria-hidden="true">↓</span> Reset at bottom
                  </button>
                </div>
              </div>
            </div>

            <div
              className="learn-collision-counts"
              aria-label="Inner and outer shell collision rates averaged over three seconds"
            >
              <p>SHELL COLLISIONS <small>3-second average · per second</small></p>
              <div className="learn-collision-surfaces">
                <section
                  className={`learn-collision-surface learn-collision-outer${
                    collapsedCollisionSurfaces.outer ? ' learn-collision-surface-collapsed' : ''
                  }`}
                >
                  <header>
                    <div>
                      <strong>OUTER SURFACE</strong>
                      <small>top ↓ · bottom ↑</small>
                    </div>
                    <button
                      type="button"
                      className="learn-collision-toggle"
                      aria-expanded={!collapsedCollisionSurfaces.outer}
                      aria-label={`${collapsedCollisionSurfaces.outer ? 'Expand' : 'Collapse'} outer surface collision counts`}
                      onClick={() => toggleCollisionSurface('outer')}
                    >
                      {collapsedCollisionSurfaces.outer ? '+' : '−'}
                    </button>
                  </header>
                  {!collapsedCollisionSurfaces.outer && (
                    <>
                      <div><span>Top</span><strong>{sphereReadout.outerTopCollisions}</strong></div>
                      <div><span>Bottom</span><strong>{sphereReadout.outerBottomCollisions}</strong></div>
                    </>
                  )}
                </section>
                <section
                  className={`learn-collision-surface learn-collision-inner${
                    collapsedCollisionSurfaces.inner ? ' learn-collision-surface-collapsed' : ''
                  }`}
                >
                  <header>
                    <div>
                      <strong>INNER SURFACE</strong>
                      <small>top ↑ · bottom ↓</small>
                    </div>
                    <button
                      type="button"
                      className="learn-collision-toggle"
                      aria-expanded={!collapsedCollisionSurfaces.inner}
                      aria-label={`${collapsedCollisionSurfaces.inner ? 'Expand' : 'Collapse'} inner surface collision counts`}
                      onClick={() => toggleCollisionSurface('inner')}
                    >
                      {collapsedCollisionSurfaces.inner ? '+' : '−'}
                    </button>
                  </header>
                  {!collapsedCollisionSurfaces.inner && (
                    <>
                      <div><span>Top</span><strong>{sphereReadout.innerTopCollisions}</strong></div>
                      <div><span>Bottom</span><strong>{sphereReadout.innerBottomCollisions}</strong></div>
                    </>
                  )}
                </section>
              </div>
            </div>
          </aside>

          <div className="learn-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="learn-canvas"
              width={WIDTH}
              height={HEIGHT}
              aria-label="Closed sphere moving vertically in a particle sea whose density and collision pressure increase with depth"
            />
          </div>

          <aside className="learn-pressure-pane" aria-label="Air pressure by depth">
            <div>
              <h3>AIR PRESSURE</h3>
              <p>relative pressure · density (particles/m²)</p>
            </div>
            <div className="learn-pressure-scale">
              {sphereReadout.pressure.map((pressure, index) => (
                <div className="learn-pressure-band" key={index}>
                  <span>
                    {index === 0 ? 'SHALLOW' : index === PRESSURE_BANDS - 1 ? 'DEEP' : ''}
                  </span>
                  <div className="learn-pressure-reading">
                    <div className="learn-pressure-track">
                      <i style={{ width: `${(pressure / pressureMaximum) * 100}%` }} />
                    </div>
                    <output>{sphereReadout.densityByBand[index].toFixed(1)}</output>
                  </div>
                </div>
              ))}
            </div>
            <div className="learn-pressure-key"><span>LOW</span><span>HIGH</span></div>
          </aside>
        </div>
      </div>

      <p className="learn-caption">
        There is no separate buoyancy formula: actual particle impacts give the sphere vertical
        momentum. Change either density—or move particles through the paired one-way valves—and
        watch the balance reverse. Horizontal motion is constrained so the effect is easier to
        see, and the top boundary prevents the sphere leaving the canvas.
      </p>
    </section>
  );
}
