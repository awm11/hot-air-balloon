import { useLayoutEffect, useRef, useState } from 'react';
import { BALLOON, SIM } from '../sim/constants.js';

const MAP_TOP_Y = 66;
const MAP_HEIGHT = SIM.height;
const DEFAULT_GROUND_Y = MAP_HEIGHT - 50;

export default function AltitudeMap({ altitudeM, daylight = false }) {
  const svgRef = useRef(null);
  const [groundY, setGroundY] = useState(DEFAULT_GROUND_Y);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const canvas = document.querySelector('.simulation-canvas');
    if (!svg || !canvas) return undefined;

    const alignGround = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const matrix = svg.getScreenCTM();
      if (!matrix || Math.abs(matrix.d) < 1e-6) return;

      const canvasScale = canvasRect.width / SIM.width;
      const canvasGroundScreenY =
        canvasRect.top + BALLOON.basketBottom * canvasScale;
      const alignedGroundY = (canvasGroundScreenY - matrix.f) / matrix.d;
      const safeGroundY = Math.max(
        MAP_TOP_Y + 100,
        Math.min(MAP_HEIGHT - 20, alignedGroundY),
      );

      setGroundY((current) =>
        Math.abs(current - safeGroundY) < 0.1 ? current : safeGroundY,
      );
    };

    alignGround();
    const observer = new ResizeObserver(alignGround);
    observer.observe(svg);
    observer.observe(canvas);
    window.addEventListener('resize', alignGround);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', alignGround);
    };
  }, []);

  const mapMaxM = Math.max(500, Math.ceil((altitudeM * 1.15) / 250) * 250);
  const usableHeight = groundY - MAP_TOP_Y - 50;
  const balloonY = groundY - 31 - (Math.max(0, altitudeM) / mapMaxM) * usableHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => (mapMaxM / 4) * index);

  return (
    <aside
      className={`altitude-map ${daylight ? 'altitude-map-daylight' : ''}`}
      style={{ '--altitude-ground-stop': `${(groundY / MAP_HEIGHT) * 100}%` }}
      aria-label={`Altitude map: balloon at ${altitudeM.toFixed(1)} metres`}
    >
      <div className="altitude-map-heading">
        <strong>Altitude</strong>
        <span>{altitudeM.toFixed(1)} m</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 100 ${MAP_HEIGHT}`}
        role="img"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="altitude-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="altitude-map-sky-top" />
            <stop offset="1" className="altitude-map-sky-bottom" />
          </linearGradient>
        </defs>

        <rect x="-1" y="-1" width="102" height={MAP_HEIGHT + 2} fill="url(#altitude-sky)" />
        <line x1="22" y1={MAP_TOP_Y} x2="22" y2={groundY} className="altitude-map-axis" />

        {ticks.map((metres) => {
          const y = groundY - (metres / mapMaxM) * (groundY - MAP_TOP_Y);
          return (
            <g key={metres}>
              <line x1="17" y1={y} x2="29" y2={y} className="altitude-map-tick" />
              <text x="33" y={y + 3} className="altitude-map-label">
                {Math.round(metres)} m
              </text>
            </g>
          );
        })}

        <line x1="23" y1={balloonY} x2="91" y2={balloonY} className="altitude-map-guide" />
        <g transform={`translate(72 ${balloonY})`} className="altitude-map-balloon">
          <path d="M 0 -14.5 C -12 -14.5 -16 -5.5 -13 3.5 C -11 9.8 -5 13.4 -3 17 L 3 17 C 5 13.4 11 9.8 13 3.5 C 16 -5.5 12 -14.5 0 -14.5 Z" />
          <line x1="-3" y1="17" x2="-4" y2="22" />
          <line x1="3" y1="17" x2="4" y2="22" />
          <rect x="-6" y="22" width="12" height="7" rx="1" />
        </g>

        <rect x="-1" y={groundY} width="102" height={MAP_HEIGHT - groundY + 1} className="altitude-map-ground" />
        {[{ x: 4, scale: 0.55 }, { x: 14, scale: 0.68 }].map(({ x, scale }) => (
          <g key={x} transform={`translate(${x} ${groundY}) scale(${scale})`} className="altitude-map-tree">
            <rect x="-1.5" y="-17" width="3" height="17" />
            <circle cx="0" cy="-23" r="8" />
            <circle cx="-6" cy="-18" r="6" />
            <circle cx="6" cy="-18" r="6" />
          </g>
        ))}
        <line x1="-1" y1={groundY} x2="101" y2={groundY} className="altitude-map-ground-line" />
        <text x="50" y={MAP_HEIGHT - 24} textAnchor="middle" className="altitude-map-ground-label">GROUND</text>
      </svg>
    </aside>
  );
}
