import { BALLOON, SIM } from './constants.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function halfWidthAtY(y) {
  const t = clamp((y - BALLOON.top) / (BALLOON.bottom - BALLOON.top), 0, 1);

  // Traditional hot-air-balloon profile inspired by the reference photo:
  // broad rounded crown, very full upper body, and a long taper into a
  // deliberately generous open mouth. This remains the single source of
  // truth for both rendering and particle/fabric collisions.
  const widestAt = 0.27;

  if (t <= widestAt) {
    const u = t / widestAt;
    const crownToShoulder = Math.pow(
      Math.sin((Math.PI / 2) * u),
      0.58,
    );

    return (
      BALLOON.crownHalfWidth +
      (BALLOON.maxHalfWidth - BALLOON.crownHalfWidth) * crownToShoulder
    );
  }

  const lowerStraightStart = 0.5;
  const curvedBodyWidth = (bodyT) => {
    const u = (bodyT - widestAt) / (1 - widestAt);

    // Keep the upper half full before it meets the straighter lower panels.
    const taper = Math.pow(
      Math.max(0, 1 - Math.pow(u, 1.55)),
      0.72,
    );

    return (
      BALLOON.mouthHalfWidth +
      (BALLOON.maxHalfWidth - BALLOON.mouthHalfWidth) * taper
    );
  };

  // From the white mouth-rim circles upward, the lower envelope panels read
  // as long, nearly straight diagonals instead of continuing the rounded
  // teardrop curve.
  const straightStartWidth = curvedBodyWidth(lowerStraightStart);
  const straightWidth = (bodyT) => {
    const lowerT = (bodyT - lowerStraightStart) / (1 - lowerStraightStart);
    return straightStartWidth + (BALLOON.mouthHalfWidth - straightStartWidth) * lowerT;
  };

  // Ease across a broad band so the middle of each side rolls gently into
  // the straight lower panels without introducing a visible corner.
  const cornerBlend = smoothstep(0.34, 0.7, t);
  return curvedBodyWidth(t) * (1 - cornerBlend) + straightWidth(t) * cornerBlend;
}

export function halfWidthDerivative(y) {
  const eps = 0.65;
  return (halfWidthAtY(y + eps) - halfWidthAtY(y - eps)) / (2 * eps);
}

export function insideEnvelope(x, y, inset = 0) {
  if (y < BALLOON.top + inset || y > BALLOON.bottom - inset) return false;
  const half = halfWidthAtY(y) - inset;
  return Math.abs(x - BALLOON.cx) <= Math.max(0, half);
}

export function inBottomMouth(x, y, pad = 0) {
  return (
    Math.abs(x - BALLOON.cx) <= BALLOON.mouthHalfWidth + pad &&
    Math.abs(y - BALLOON.bottom) <= 8 + pad
  );
}

export function inTopVent(x, y, ventOpen, pad = 0) {
  return Boolean(
    ventOpen &&
      Math.abs(x - BALLOON.cx) <= BALLOON.ventHalfWidth + pad &&
      Math.abs(y - BALLOON.top) <= 8 + pad,
  );
}

export function crossingAllowed(prev, next, ventOpen) {
  const dy = next.y - prev.y;

  if (dy !== 0) {
    const mouthT = (BALLOON.bottom - prev.y) / dy;
    if (mouthT >= 0 && mouthT <= 1) {
      const xAtMouth = prev.x + (next.x - prev.x) * mouthT;
      if (Math.abs(xAtMouth - BALLOON.cx) <= BALLOON.mouthHalfWidth) {
        return { allowed: true, opening: 'mouth' };
      }
    }

    if (ventOpen) {
      const ventT = (BALLOON.top - prev.y) / dy;
      if (ventT >= 0 && ventT <= 1) {
        const xAtVent = prev.x + (next.x - prev.x) * ventT;
        if (Math.abs(xAtVent - BALLOON.cx) <= BALLOON.ventHalfWidth) {
          return { allowed: true, opening: 'vent' };
        }
      }
    }
  }

  return { allowed: false, opening: null };
}

export function reflectFabricCrossing(particle, prev, prevInside, nextInside, ventOpen) {
  if (prevInside === nextInside) return { collided: false, opening: null };

  const crossing = crossingAllowed(prev, particle, ventOpen);
  if (crossing.allowed) return { collided: false, opening: crossing.opening };

  const nearTop = Math.min(prev.y, particle.y) <= BALLOON.top + 8;
  if (nearTop && Math.abs(particle.x - BALLOON.cx) <= BALLOON.crownHalfWidth + 12) {
    particle.x = prev.x;
    particle.y = prevInside ? BALLOON.top + 0.6 : BALLOON.top - 0.6;
    particle.vy *= -1;
    return { collided: true, opening: null };
  }

  // Project to the side boundary and reflect the thermal velocity around its normal.
  const y = clamp(particle.y, BALLOON.top + 0.8, BALLOON.bottom - 0.8);
  const sign = (particle.x || prev.x) >= BALLOON.cx ? 1 : -1;
  const hw = halfWidthAtY(y);
  const slope = halfWidthDerivative(y);
  let nx = sign;
  let ny = -slope;
  const nLen = Math.hypot(nx, ny) || 1;
  nx /= nLen;
  ny /= nLen;

  const dot = particle.vx * nx + particle.vy * ny;
  particle.vx -= 2 * dot * nx;
  particle.vy -= 2 * dot * ny;

  const side = prevInside ? -1 : 1;
  particle.x = BALLOON.cx + sign * (hw + side * 0.8);
  particle.y = y;
  return { collided: true, opening: null };
}

export function envelopeAreaPx2(samples = 1600) {
  const dy = (BALLOON.bottom - BALLOON.top) / samples;
  let area = 0;
  for (let i = 0; i < samples; i += 1) {
    const y = BALLOON.top + (i + 0.5) * dy;
    area += 2 * halfWidthAtY(y) * dy;
  }
  return area;
}


export function inOutsideDensitySample(x, y, _groundY = null) {
  const bounds = bufferBounds();
  const sampleBottom = BALLOON.bottom + 35;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= sampleBottom && !insideEnvelope(x, y, 0);
}

export function outsideDensitySampleAreaPx2(_groundY = null) {
  const bounds = bufferBounds();
  const sampleBottom = BALLOON.bottom + 35;
  return Math.max(1, (bounds.right - bounds.left) * (sampleBottom - bounds.top) - envelopeAreaPx2());
}

export function bufferBounds() {
  return {
    left: -SIM.buffer,
    right: SIM.width + SIM.buffer,
    top: -SIM.buffer,
    bottom: SIM.height + SIM.buffer,
  };
}

export function fadeOpacity(x, y) {
  const dx = Math.min(x, SIM.width - x);
  const dy = Math.min(y, SIM.height - y);
  const edge = Math.min(dx, dy);
  return smoothstep(0, SIM.fadeWidth, edge);
}

export function groundYForAltitude(altitudeM) {
  return BALLOON.basketBottom + Math.max(0, altitudeM) * SIM.pixelsPerMeter;
}
