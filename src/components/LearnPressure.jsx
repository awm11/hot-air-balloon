import { useEffect, useRef, useState } from 'react';

const WIDTH = 600;
const HEIGHT = 560;
const PARTICLE_COUNT = 1680;
const PARTICLE_RADIUS = 2.1;
const PARTICLE_MASS = 0.035;
const GRAVITY = 22;
const THERMAL_SPEED = 82;
const PARTICLE_SPEED = THERMAL_SPEED * 0.6;
const FIXED_DT = 1 / 120;
const SENSOR_FRONT_X = WIDTH - 68;
const SENSOR_HEIGHT = 52;
const PRESSURE_WINDOW_SECONDS = 5;
const PRESSURE_BIN_SECONDS = 0.1;
const PRESSURE_BIN_COUNT = PRESSURE_WINDOW_SECONDS / PRESSURE_BIN_SECONDS;
const SENSOR_DEFINITIONS = [
  { id: 'shallow', label: 'Shallow', y: 105 },
  { id: 'middle', label: 'Middle', y: 280 },
  { id: 'deep', label: 'Deep', y: 455 },
];

function createRng(seed = 0x51d3b7) {
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
  const gradient = GRAVITY / (THERMAL_SPEED * THERMAL_SPEED);
  return Math.log(1 + rng() * (Math.exp(gradient * HEIGHT) - 1)) / gradient;
}

function insideSensorHousing(x, y) {
  return SENSOR_DEFINITIONS.some((sensor) => (
    x + PARTICLE_RADIUS > SENSOR_FRONT_X
    && y + PARTICLE_RADIUS > sensor.y - SENSOR_HEIGHT / 2
    && y - PARTICLE_RADIUS < sensor.y + SENSOR_HEIGHT / 2
  ));
}

function createParticle(rng) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = PARTICLE_RADIUS + rng() * (WIDTH - PARTICLE_RADIUS * 2);
    const y = PARTICLE_RADIUS
      + Math.min(HEIGHT - PARTICLE_RADIUS * 2, sampleDepth(rng));
    if (!insideSensorHousing(x, y)) {
      return {
        x,
        y,
        px: x,
        py: y,
        vx: normalRandom(rng) * PARTICLE_SPEED,
        vy: normalRandom(rng) * PARTICLE_SPEED,
      };
    }
  }

  return {
    x: WIDTH / 3,
    y: HEIGHT / 2,
    px: WIDTH / 3,
    py: HEIGHT / 2,
    vx: normalRandom(rng) * PARTICLE_SPEED,
    vy: normalRandom(rng) * PARTICLE_SPEED,
  };
}

function createSensorState(definition) {
  return {
    ...definition,
    collisionCount: 0,
    impulseBins: new Float64Array(PRESSURE_BIN_COUNT),
    binIndex: 0,
    binElapsed: 0,
    filledBins: 0,
    rollingImpulse: 0,
    displayedPressure: 0,
    flash: 0,
  };
}

function createState() {
  const rng = createRng();
  return {
    rng,
    elapsed: 0,
    particles: Array.from({ length: PARTICLE_COUNT }, () => createParticle(rng)),
    sensors: SENSOR_DEFINITIONS.map(createSensorState),
  };
}

function recordSensorImpact(sensor, incomingSpeed) {
  const impulse = 2 * PARTICLE_MASS * incomingSpeed;
  sensor.collisionCount += 1;
  sensor.impulseBins[sensor.binIndex] += impulse;
  sensor.rollingImpulse += impulse;
  sensor.flash = 1;
}

function collideWithSensorHousing(particle, sensor) {
  const top = sensor.y - SENSOR_HEIGHT / 2;
  const bottom = sensor.y + SENSOR_HEIGHT / 2;
  if (
    particle.x + PARTICLE_RADIUS <= SENSOR_FRONT_X
    || particle.y + PARTICLE_RADIUS <= top
    || particle.y - PARTICLE_RADIUS >= bottom
  ) return;

  const leftPenetration = particle.x + PARTICLE_RADIUS - SENSOR_FRONT_X;
  const topPenetration = particle.y + PARTICLE_RADIUS - top;
  const bottomPenetration = bottom - (particle.y - PARTICLE_RADIUS);

  if (leftPenetration <= topPenetration && leftPenetration <= bottomPenetration) {
    const incomingSpeed = Math.max(0, particle.vx);
    particle.x = SENSOR_FRONT_X - PARTICLE_RADIUS;
    particle.vx = -Math.abs(particle.vx);
    if (incomingSpeed > 0) recordSensorImpact(sensor, incomingSpeed);
  } else if (topPenetration <= bottomPenetration) {
    particle.y = top - PARTICLE_RADIUS;
    particle.vy = -Math.abs(particle.vy);
  } else {
    particle.y = bottom + PARTICLE_RADIUS;
    particle.vy = Math.abs(particle.vy);
  }
}

function advancePressureWindow(sensor, dt) {
  sensor.binElapsed += dt;
  while (sensor.binElapsed >= PRESSURE_BIN_SECONDS) {
    sensor.binElapsed -= PRESSURE_BIN_SECONDS;
    sensor.binIndex = (sensor.binIndex + 1) % PRESSURE_BIN_COUNT;
    sensor.rollingImpulse -= sensor.impulseBins[sensor.binIndex];
    sensor.impulseBins[sensor.binIndex] = 0;
    sensor.filledBins = Math.min(PRESSURE_BIN_COUNT, sensor.filledBins + 1);
  }

  const measuredDuration = Math.min(
    PRESSURE_WINDOW_SECONDS,
    sensor.filledBins * PRESSURE_BIN_SECONDS + sensor.binElapsed,
  );
  // The half-second denominator and easing prevent a noisy spike before the
  // first few pressure samples have accumulated. After five seconds this is a
  // conventional rolling five-second average.
  const stableDuration = Math.max(0.5, measuredDuration);
  const targetPressure = sensor.rollingImpulse / (stableDuration * SENSOR_HEIGHT);
  const easing = 1 - Math.exp(-dt / 1.15);
  sensor.displayedPressure += (targetPressure - sensor.displayedPressure) * easing;
  sensor.flash = Math.max(0, sensor.flash - dt * 4.5);
}

function stepState(state, dt) {
  state.elapsed += dt;

  for (const particle of state.particles) {
    particle.px = particle.x;
    particle.py = particle.y;
    particle.vy += GRAVITY * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;

    if (particle.x < PARTICLE_RADIUS) {
      particle.x = PARTICLE_RADIUS;
      particle.vx = Math.abs(particle.vx);
    } else if (particle.x > WIDTH - PARTICLE_RADIUS) {
      particle.x = WIDTH - PARTICLE_RADIUS;
      particle.vx = -Math.abs(particle.vx);
    }

    if (particle.y < PARTICLE_RADIUS) {
      particle.y = PARTICLE_RADIUS;
      particle.vy = Math.abs(particle.vy);
    } else if (particle.y > HEIGHT - PARTICLE_RADIUS) {
      particle.y = HEIGHT - PARTICLE_RADIUS;
      particle.vy = -Math.abs(particle.vy);
    }

    if (particle.x + PARTICLE_RADIUS > SENSOR_FRONT_X) {
      for (const sensor of state.sensors) collideWithSensorHousing(particle, sensor);
    }
  }

  for (const sensor of state.sensors) advancePressureWindow(sensor, dt);
}

function drawState(ctx, state) {
  ctx.fillStyle = '#0d2738';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (let index = 1; index < 5; index += 1) {
    const y = (HEIGHT / 5) * index;
    ctx.strokeStyle = 'rgba(156, 201, 225, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.fillStyle = 'rgb(194, 231, 248)';
  ctx.globalAlpha = 0.62;
  ctx.beginPath();
  for (const particle of state.particles) {
    ctx.moveTo(particle.x + PARTICLE_RADIUS, particle.y);
    ctx.arc(particle.x, particle.y, PARTICLE_RADIUS, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(48, 94, 119, 0.86)';
  ctx.fillRect(WIDTH - 8, 0, 8, HEIGHT);

  for (const sensor of state.sensors) {
    const top = sensor.y - SENSOR_HEIGHT / 2;
    ctx.fillStyle = 'rgba(47, 91, 116, 0.88)';
    ctx.fillRect(SENSOR_FRONT_X, top, WIDTH - SENSOR_FRONT_X, SENSOR_HEIGHT);
    ctx.fillStyle = '#386f8d';
    ctx.fillRect(SENSOR_FRONT_X + 7, sensor.y - 5, WIDTH - SENSOR_FRONT_X - 7, 10);

    ctx.shadowColor = sensor.flash > 0.05 ? '#ffe0a8' : 'transparent';
    ctx.shadowBlur = sensor.flash * 12;
    ctx.fillStyle = sensor.flash > 0.05 ? '#ffd28a' : '#ffad51';
    ctx.fillRect(SENSOR_FRONT_X - 5, top, 7, SENSOR_HEIGHT);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#dcecf6';
    ctx.font = '700 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(sensor.label.toUpperCase(), SENSOR_FRONT_X - 12, sensor.y + 5);
  }

  ctx.fillStyle = 'rgba(219, 235, 245, 0.72)';
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('LOWER PRESSURE', 16, 26);
  ctx.fillText('HIGHER PRESSURE', 16, HEIGHT - 16);
}

export default function LearnPressure() {
  const canvasRef = useRef(null);
  const resetCollisionsRef = useRef(false);
  const [readouts, setReadouts] = useState(() => SENSOR_DEFINITIONS.map((sensor) => ({
    ...sensor,
    collisionCount: 0,
    pressure: 0,
  })));

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
      if (resetCollisionsRef.current) {
        for (const sensor of state.sensors) sensor.collisionCount = 0;
        resetCollisionsRef.current = false;
      }

      accumulator += Math.min(0.08, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;

      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 10) {
        stepState(state, FIXED_DT);
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === 10) accumulator = 0;

      drawState(ctx, state);
      if (now - lastReadoutTime >= 180) {
        setReadouts(state.sensors.map((sensor) => ({
          id: sensor.id,
          label: sensor.label,
          y: sensor.y,
          collisionCount: sensor.collisionCount,
          pressure: sensor.displayedPressure,
        })));
        lastReadoutTime = now;
      }

      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const pressureMaximum = Math.max(1, ...readouts.map((sensor) => sensor.pressure)) * 1.15;

  const resetCollisions = () => {
    resetCollisionsRef.current = true;
    setReadouts((current) => current.map((sensor) => ({
      ...sensor,
      collisionCount: 0,
    })));
  };

  return (
    <section className="learn-section learn-pressure-lesson" aria-labelledby="pressure-lesson-title">
      <div className="learn-intro">
        <p className="learn-kicker">LEARN 1 OF 3 · PRESSURE WITH DEPTH</p>
        <h2 id="pressure-lesson-title">Why is pressure greater lower down?</h2>
        <p>
          These identical sensors face sideways into one continuous particle column. Gravity
          creates a greater particle density lower down, so the deeper sensor surfaces receive
          more momentum from collisions—even though every sensor has the same size and direction.
        </p>
      </div>

      <div className="learn-causal-chain" aria-label="Pressure with depth causal chain">
        <span>gravity</span><b>→</b><span>more particles lower down</span><b>→</b>
        <span>more side-surface impacts</span><b>→</b><span>greater pressure</span>
      </div>

      <div className="learn-simulation-card pressure-lesson-card">
        <div className="pressure-column-wrap">
          <canvas
            ref={canvasRef}
            className="pressure-column-canvas"
            width={WIDTH}
            height={HEIGHT}
            aria-label="A vertical particle column with shallow, middle, and deep pressure sensors protruding from its right wall"
          />
        </div>

        <aside className="pressure-sensor-meters" aria-label="Pressure sensor readings">
          <button
            type="button"
            className="pressure-reset-button"
            onClick={resetCollisions}
          >
            Reset collisions
          </button>
          {readouts.map((sensor) => (
            <section className="pressure-sensor-meter" key={sensor.id}>
              <header>
                <span>{sensor.label}</span>
                <small>side sensor</small>
              </header>
              <div>
                <span>Collisions</span>
                <strong>{sensor.collisionCount.toLocaleString('en-GB')}</strong>
              </div>
              <div>
                <span>5 s average pressure</span>
                <strong>{sensor.pressure.toFixed(2)}</strong>
              </div>
              <div className="pressure-sensor-meter-track" aria-hidden="true">
                <i style={{ width: `${(sensor.pressure / pressureMaximum) * 100}%` }} />
              </div>
            </section>
          ))}
        </aside>
      </div>

      <p className="learn-caption">
        Collision totals accumulate from zero. Pressure uses the momentum delivered to each
        orange sensing platform per unit length and time, averaged over the latest five seconds;
        the opening seconds ease in while that measurement window fills.
      </p>
    </section>
  );
}
