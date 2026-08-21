import { useEffect, useRef, useState } from 'react';

const WIDTH = 720;
const HEIGHT = 520;
const BOX_LEFT = 40;
const BOX_RIGHT = WIDTH - 40;
const BOX_BOTTOM = HEIGHT - 70;
const PISTON_MIN_Y = 48;
const PISTON_START_Y = 74;
const PISTON_HEIGHT = 18;
const PISTON_MASS = 120;
const PISTON_DAMPING = 1.8;
const PARTICLE_COUNT = 500;
const PARTICLE_RADIUS = 9.2;
const PARTICLE_MASS = 1;
const PARTICLE_GRAVITY = 8;
const INITIAL_SPEED = 12;
const MAX_APPLIED_FORCE = 4000;
const FIXED_DT = 1 / 120;
const CELL_SIZE = PARTICLE_RADIUS * 2;
const GRID_COLUMNS = Math.ceil(WIDTH / CELL_SIZE);
const GRID_ROWS = Math.ceil(HEIGHT / CELL_SIZE);

function createRng(seed = 0xa19c73) {
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

function createParticles(rng) {
  const columns = 30;
  const rows = 17;
  const horizontalGap = (
    BOX_RIGHT - BOX_LEFT - PARTICLE_RADIUS * 2
  ) / (columns - 1);
  const particleTop = PISTON_START_Y + PISTON_HEIGHT + PARTICLE_RADIUS + 8;
  const particleBottom = BOX_BOTTOM - PARTICLE_RADIUS - 3;
  const verticalGap = (particleBottom - particleTop) / (rows - 1);
  const particles = [];

  for (let row = 0; row < rows && particles.length < PARTICLE_COUNT; row += 1) {
    for (let column = 0; column < columns && particles.length < PARTICLE_COUNT; column += 1) {
      const jitterX = (rng() - 0.5) * 0.5;
      const jitterY = (rng() - 0.5) * 0.5;
      particles.push({
        x: BOX_LEFT + PARTICLE_RADIUS + column * horizontalGap + jitterX,
        y: particleTop + row * verticalGap + jitterY,
        vx: normalRandom(rng) * INITIAL_SPEED,
        vy: normalRandom(rng) * INITIAL_SPEED,
      });
    }
  }

  return particles;
}

function createState() {
  const rng = createRng();
  return {
    particles: createParticles(rng),
    piston: { y: PISTON_START_Y, vy: 0 },
    buckets: Array.from({ length: GRID_COLUMNS * GRID_ROWS }, () => []),
    bottomCollisions: 0,
    bottomFlashes: [],
  };
}

function gridIndexFor(x, y) {
  const column = Math.max(0, Math.min(GRID_COLUMNS - 1, Math.floor(x / CELL_SIZE)));
  const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(y / CELL_SIZE)));
  return row * GRID_COLUMNS + column;
}

function rebuildSpatialGrid(state) {
  for (const bucket of state.buckets) bucket.length = 0;
  for (let index = 0; index < state.particles.length; index += 1) {
    const particle = state.particles[index];
    state.buckets[gridIndexFor(particle.x, particle.y)].push(index);
  }
}

function collideEqualParticles(first, second) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const minimumDistance = PARTICLE_RADIUS * 2;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minimumDistance * minimumDistance) return;

  const distance = Math.sqrt(Math.max(1e-8, distanceSquared));
  const nx = distance > 1e-4 ? dx / distance : 1;
  const ny = distance > 1e-4 ? dy / distance : 0;
  const overlap = minimumDistance - distance;
  first.x -= nx * overlap * 0.5;
  first.y -= ny * overlap * 0.5;
  second.x += nx * overlap * 0.5;
  second.y += ny * overlap * 0.5;

  const relativeNormalVelocity = (second.vx - first.vx) * nx
    + (second.vy - first.vy) * ny;
  if (relativeNormalVelocity >= 0) return;

  // Equal masses and restitution 1: exchange the normal velocity components.
  first.vx += relativeNormalVelocity * nx;
  first.vy += relativeNormalVelocity * ny;
  second.vx -= relativeNormalVelocity * nx;
  second.vy -= relativeNormalVelocity * ny;
}

function solveParticleCollisions(state) {
  rebuildSpatialGrid(state);

  for (let index = 0; index < state.particles.length; index += 1) {
    const particle = state.particles[index];
    const column = Math.floor(particle.x / CELL_SIZE);
    const row = Math.floor(particle.y / CELL_SIZE);

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const neighbourRow = row + offsetY;
      if (neighbourRow < 0 || neighbourRow >= GRID_ROWS) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const neighbourColumn = column + offsetX;
        if (neighbourColumn < 0 || neighbourColumn >= GRID_COLUMNS) continue;
        const bucket = state.buckets[neighbourRow * GRID_COLUMNS + neighbourColumn];
        for (const otherIndex of bucket) {
          if (otherIndex <= index) continue;
          collideEqualParticles(particle, state.particles[otherIndex]);
        }
      }
    }
  }
}

function collideParticleWithPiston(particle, piston) {
  const pistonFace = piston.y + PISTON_HEIGHT;
  if (particle.y - PARTICLE_RADIUS >= pistonFace) return;

  particle.y = pistonFace + PARTICLE_RADIUS;
  if (particle.vy >= piston.vy) return;

  const particleVelocity = particle.vy;
  const pistonVelocity = piston.vy;
  particle.vy = (
    ((PARTICLE_MASS - PISTON_MASS) * particleVelocity)
    + 2 * PISTON_MASS * pistonVelocity
  ) / (PARTICLE_MASS + PISTON_MASS);
  piston.vy = (
    2 * PARTICLE_MASS * particleVelocity
    + (PISTON_MASS - PARTICLE_MASS) * pistonVelocity
  ) / (PARTICLE_MASS + PISTON_MASS);
}

function constrainParticle(state, particle, countBottomImpact = true) {
  if (particle.x < BOX_LEFT + PARTICLE_RADIUS) {
    particle.x = BOX_LEFT + PARTICLE_RADIUS;
    particle.vx = Math.abs(particle.vx);
  } else if (particle.x > BOX_RIGHT - PARTICLE_RADIUS) {
    particle.x = BOX_RIGHT - PARTICLE_RADIUS;
    particle.vx = -Math.abs(particle.vx);
  }

  if (particle.y > BOX_BOTTOM - PARTICLE_RADIUS) {
    const incomingSpeed = Math.max(0, particle.vy);
    particle.y = BOX_BOTTOM - PARTICLE_RADIUS;
    particle.vy = -Math.abs(particle.vy);
    if (countBottomImpact && incomingSpeed > 0) {
      state.bottomCollisions += 1;
      if (state.bottomFlashes.length < 70) {
        state.bottomFlashes.push({ x: particle.x, life: 1 });
      }
    }
  }
}

function stepState(state, forcePercent, dt) {
  const piston = state.piston;
  const appliedForce = (forcePercent / 100) * MAX_APPLIED_FORCE;
  piston.vy += (appliedForce / PISTON_MASS) * dt;
  piston.vy *= Math.exp(-PISTON_DAMPING * dt);
  piston.y += piston.vy * dt;

  if (piston.y < PISTON_MIN_Y) {
    piston.y = PISTON_MIN_Y;
    piston.vy = 0;
  }
  const pistonMaximumY = BOX_BOTTOM - PISTON_HEIGHT - PARTICLE_RADIUS * 5;
  if (piston.y > pistonMaximumY) {
    piston.y = pistonMaximumY;
    piston.vy = 0;
  }

  for (const particle of state.particles) {
    particle.vy += PARTICLE_GRAVITY * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    constrainParticle(state, particle);
    collideParticleWithPiston(particle, piston);
  }

  // Two spatially-binned solver passes keep this dense 500-particle liquid
  // from interpenetrating without an O(n²) all-pairs calculation.
  solveParticleCollisions(state);
  solveParticleCollisions(state);

  for (const particle of state.particles) {
    constrainParticle(state, particle);
    collideParticleWithPiston(particle, piston);
  }

  for (const flash of state.bottomFlashes) flash.life -= dt * 4;
  state.bottomFlashes = state.bottomFlashes.filter((flash) => flash.life > 0);
}

function drawArrowHead(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size, y - size * 1.35);
  ctx.lineTo(x + size, y - size * 1.35);
  ctx.closePath();
  ctx.fill();
}

function drawState(ctx, state, forcePercent) {
  ctx.fillStyle = '#0b2131';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = 'rgba(64, 143, 181, 0.16)';
  ctx.fillRect(
    BOX_LEFT,
    state.piston.y + PISTON_HEIGHT,
    BOX_RIGHT - BOX_LEFT,
    BOX_BOTTOM - state.piston.y - PISTON_HEIGHT,
  );

  ctx.save();
  ctx.fillStyle = '#75c9e8';
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  for (const particle of state.particles) {
    ctx.moveTo(particle.x + PARTICLE_RADIUS, particle.y);
    ctx.arc(particle.x, particle.y, PARTICLE_RADIUS, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(221, 239, 249, 0.62)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(BOX_LEFT, PISTON_MIN_Y - 6);
  ctx.lineTo(BOX_LEFT, BOX_BOTTOM + 2);
  ctx.lineTo(BOX_RIGHT, BOX_BOTTOM + 2);
  ctx.lineTo(BOX_RIGHT, PISTON_MIN_Y - 6);
  ctx.stroke();

  ctx.fillStyle = '#d9913f';
  ctx.fillRect(BOX_LEFT - 2, state.piston.y, BOX_RIGHT - BOX_LEFT + 4, PISTON_HEIGHT);
  ctx.fillStyle = '#ffd18d';
  ctx.fillRect(BOX_LEFT + 5, state.piston.y + PISTON_HEIGHT - 4, BOX_RIGHT - BOX_LEFT - 10, 4);

  const arrowAlpha = 0.28 + forcePercent * 0.0072;
  ctx.fillStyle = `rgba(255, 179, 86, ${arrowAlpha})`;
  ctx.strokeStyle = `rgba(255, 179, 86, ${arrowAlpha})`;
  ctx.lineWidth = 3 + forcePercent * 0.025;
  const arrowX = WIDTH / 2;
  const arrowTop = 10;
  const arrowBottom = Math.max(31, state.piston.y - 7);
  ctx.beginPath();
  ctx.moveTo(arrowX, arrowTop);
  ctx.lineTo(arrowX, arrowBottom - 7);
  ctx.stroke();
  drawArrowHead(ctx, arrowX, arrowBottom, 6 + forcePercent * 0.018);

  ctx.fillStyle = '#dcecf6';
  ctx.font = '700 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DOWNWARD APPLIED FORCE', arrowX, 12);

  ctx.fillStyle = '#2f7797';
  ctx.fillRect(BOX_LEFT, BOX_BOTTOM, BOX_RIGHT - BOX_LEFT, 16);
  ctx.fillStyle = '#71d3ea';
  ctx.fillRect(BOX_LEFT, BOX_BOTTOM, BOX_RIGHT - BOX_LEFT, 4);

  for (const flash of state.bottomFlashes) {
    ctx.globalAlpha = flash.life;
    ctx.fillStyle = '#e7fbff';
    ctx.beginPath();
    ctx.arc(flash.x, BOX_BOTTOM + 2, 3 + (1 - flash.life) * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#a9c3d3';
  ctx.textAlign = 'left';
  ctx.fillText('ELASTIC LIQUID PARTICLES', BOX_LEFT + 8, BOX_BOTTOM + 39);
  ctx.textAlign = 'right';
  ctx.fillText('BOTTOM COLLISION PLATE', BOX_RIGHT - 8, BOX_BOTTOM + 39);
}

export default function LearnLiquidPressure() {
  const canvasRef = useRef(null);
  const forcePercentRef = useRef(0);
  const resetCounterRef = useRef(false);
  const [forcePercent, setForcePercent] = useState(0);
  const [bottomCollisions, setBottomCollisions] = useState(0);
  forcePercentRef.current = forcePercent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const state = createState();
    let frameId = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let lastReadoutTime = previousTime;

    const frame = (now) => {
      accumulator += Math.min(0.08, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;

      if (resetCounterRef.current) {
        state.bottomCollisions = 0;
        resetCounterRef.current = false;
      }

      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 10) {
        stepState(state, forcePercentRef.current, FIXED_DT);
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === 10) accumulator = 0;

      drawState(ctx, state, forcePercentRef.current);
      if (now - lastReadoutTime >= 150) {
        setBottomCollisions(state.bottomCollisions);
        lastReadoutTime = now;
      }

      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const resetCounter = () => {
    resetCounterRef.current = true;
    setBottomCollisions(0);
  };

  return (
    <section className="learn-section learn-liquid-pressure" aria-labelledby="liquid-pressure-title">
      <div className="learn-intro">
        <p className="learn-kicker">LEARN 3 OF 3 · APPLIED PRESSURE</p>
        <h2 id="liquid-pressure-title">How does a liquid transmit an applied force?</h2>
        <p>
          Five hundred equal particles fill a closed box beneath a movable piston. Increase the
          downward force and watch elastic particle collisions transmit momentum through the
          liquid to the collision plate across the entire bottom.
        </p>
      </div>

      <div className="learn-simulation-card liquid-pressure-card">
        <div className="liquid-force-control">
          <label htmlFor="liquid-force-slider">
            <span>DOWNWARD FORCE ON PISTON</span>
            <output>{forcePercent}%</output>
          </label>
          <input
            id="liquid-force-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            value={forcePercent}
            aria-valuetext={`${forcePercent} percent of maximum downward force`}
            onInput={(event) => setForcePercent(Number(event.currentTarget.value))}
            onChange={(event) => setForcePercent(Number(event.target.value))}
          />
        </div>

        <canvas
          ref={canvasRef}
          className="liquid-pressure-canvas"
          width={WIDTH}
          height={HEIGHT}
          aria-label="Five hundred elastic liquid particles beneath a force-controlled piston and above a full-width bottom collision plate"
        />

        <div className="liquid-bottom-counter" aria-live="polite">
          <div>
            <span>BOTTOM PLATE COLLISIONS</span>
            <strong>{bottomCollisions.toLocaleString('en-GB')}</strong>
          </div>
          <button type="button" onClick={resetCounter}>Reset collision counter</button>
        </div>
      </div>

      <p className="learn-caption">
        Particle–particle, wall, piston and floor collisions all use 100% elastic restitution.
        The counter records every particle impact anywhere across the blue bottom plate.
      </p>
    </section>
  );
}
