import { Children, useRef, useState } from 'react';
import { kelvinToCelsius } from '../sim/thermodynamics.js';

const FLOW_DISPLAY_FACTOR = 0.1;
const FLOW_CHART_SCALE_LPS = 40000 * FLOW_DISPLAY_FACTOR;
const FLOW_NUMBER_UPDATE_INTERVAL_MS = 800;
const DEFAULT_PANEL_ORDER = ['air-state', 'forces', 'flight', 'airflow'];

function Metric({ label, value, detail, tone = '', className = '' }) {
  return (
    <div className={`metric ${tone} ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function formatFlowLps(rate) {
  if (Math.abs(rate) < 0.5) return '0';
  const rounded = Math.round(Math.abs(rate)).toLocaleString('en-GB');
  return `${rate > 0 ? '+' : '−'}${rounded}`;
}

function FlowTimeseries({ id, samples, nowS, scaleLps }) {
  const width = 180;
  const height = 58;
  const axisY = height / 2;
  const plotHeight = axisY - 5;
  const path = samples
    .map((sample, index) => {
      const x = Math.max(0, Math.min(width, ((sample.timeS - (nowS - 5)) / 5) * width));
      const y = axisY - Math.max(-1, Math.min(1, sample.value / scaleLps)) * plotHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      className="flow-timeseries"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Past five seconds of four-second rolling-average net airflow. Entering air is green above the axis; leaving air is red below it."
      preserveAspectRatio="none"
    >
      <defs>
        <clipPath id={`${id}-entering`}>
          <rect x="0" y="0" width={width} height={axisY} />
        </clipPath>
        <clipPath id={`${id}-leaving`}>
          <rect x="0" y={axisY} width={width} height={axisY} />
        </clipPath>
      </defs>
      <line className="flow-axis" x1="0" y1={axisY} x2={width} y2={axisY} />
      {path ? (
        <>
          <path className="flow-trace flow-trace-entering" d={path} clipPath={`url(#${id}-entering)`} />
          <path className="flow-trace flow-trace-leaving" d={path} clipPath={`url(#${id}-leaving)`} />
        </>
      ) : null}
      <text className="flow-axis-label" x="4" y={axisY - 4}>ENTERING</text>
      <text className="flow-axis-label" x="4" y={axisY + 9}>LEAVING</text>
    </svg>
  );
}

function AirflowRow({ label, id, value, samples, nowS, scaleLps }) {
  const tone = value > 0.5 ? 'entering' : value < -0.5 ? 'leaving' : 'still';
  return (
    <div className={`airflow-row airflow-${tone}`}>
      <strong className="airflow-opening">{label}</strong>
      <FlowTimeseries id={id} samples={samples} nowS={nowS} scaleLps={scaleLps} />
      <output className="airflow-value">{formatFlowLps(value)}</output>
      <span className="airflow-unit">litres/s</span>
    </div>
  );
}

function DensityComparison({ inside, outside }) {
  const scaleMax = Math.max(1.25, inside, outside);
  const differencePct = ((inside - outside) / Math.max(outside, 0.001)) * 100;
  const barStyle = (value) => {
    const ratio = value / scaleMax;
    return {
      width: `${ratio * 100}%`,
      '--density-gradient-width': `${100 / Math.max(ratio, 0.001)}%`,
    };
  };
  const comparison = Math.abs(differencePct) < 0.05
    ? 'Inside and outside density are equal'
    : `Inside is ${Math.abs(differencePct).toFixed(1)}% ${differencePct < 0 ? 'less' : 'more'} dense than outside`;

  return (
    <div className="density-comparison" aria-label={comparison}>
      <span className="density-comparison-title">Density comparison</span>
      <div className="density-bar-row inside">
        <span>Inside</span>
        <strong>{inside.toFixed(3)} kg/m³</strong>
        <div className="density-bar-track" aria-hidden="true">
          <span style={barStyle(inside)} />
        </div>
      </div>
      <div className="density-bar-row outside">
        <span>Outside</span>
        <strong>{outside.toFixed(3)} kg/m³</strong>
        <div className="density-bar-track" aria-hidden="true">
          <span style={barStyle(outside)} />
        </div>
      </div>
      <strong className={`density-comparison-summary ${differencePct < 0 ? 'inside-lower' : differencePct > 0 ? 'inside-higher' : ''}`}>
        {comparison}
      </strong>
    </div>
  );
}

function ReadoutGroup({
  panelId,
  title,
  children,
  className = '',
  aside = null,
  draggingPanelId,
  dropTarget,
  isCollapsed,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKeyboardMove,
  onToggleCollapsed,
}) {
  const isDragging = draggingPanelId === panelId;
  const dropPosition = dropTarget?.panelId === panelId ? dropTarget.position : '';

  return (
    <section
      className={`readout-group ${className} ${isDragging ? 'is-dragging' : ''} ${isCollapsed ? 'is-collapsed' : ''} ${dropPosition ? `drop-${dropPosition}` : ''}`.trim()}
      data-panel-id={panelId}
      onDragOver={(event) => onDragOver(event, panelId)}
      onDrop={(event) => onDrop(event, panelId)}
    >
      <h2 className="readout-group-title">{title}</h2>
      <button
        type="button"
        className="panel-collapse-button"
        aria-expanded={!isCollapsed}
        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${title} panel`}
        title={`${isCollapsed ? 'Expand' : 'Collapse'} ${title}`}
        onClick={() => onToggleCollapsed(panelId)}
      >
        <span aria-hidden="true">{isCollapsed ? '+' : '−'}</span>
      </button>
      <button
        type="button"
        className="panel-drag-handle"
        draggable="true"
        aria-label={`Reorder ${title} panel. Drag, or use the up and down arrow keys.`}
        title={`Drag to reorder ${title}`}
        onDragStart={(event) => onDragStart(event, panelId)}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            onKeyboardMove(panelId, event.key === 'ArrowUp' ? -1 : 1);
          }
        }}
      />
      {!isCollapsed ? (
        <div className={aside ? 'readout-group-body has-aside' : 'readout-group-body'}>
          <div className="readout-grid">{children}</div>
          {aside}
        </div>
      ) : null}
    </section>
  );
}

function OrderedReadoutStack({ order, children }) {
  const panels = Children.toArray(children);
  return (
    <div className="readout-stack" aria-label="Live measurements">
      {order.map((panelId) => panels.find((panel) => panel.props.panelId === panelId))}
    </div>
  );
}

export default function Readouts({ metrics, ambientC, setAmbientC }) {
  const [panelOrder, setPanelOrder] = useState(DEFAULT_PANEL_ORDER);
  const [collapsedPanels, setCollapsedPanels] = useState(() => new Set());
  const [draggingPanelId, setDraggingPanelId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const draggingPanelRef = useRef(null);
  const flowHistoryRef = useRef({
    lastTimeS: -Infinity,
    mouth: [],
    vent: [],
  });
  const displayedFlowRef = useRef({
    lastUpdateMs: -Infinity,
    lastSimulationTimeS: -Infinity,
    mouthLps: 0,
    ventLps: 0,
  });
  const nowS = metrics.timeS ?? 0;
  const mouthDisplayFlowLps = (metrics.mouthNetFlowLps ?? 0) * FLOW_DISPLAY_FACTOR;
  const ventDisplayFlowLps = (metrics.ventNetFlowLps ?? 0) * FLOW_DISPLAY_FACTOR;
  const flowHistory = flowHistoryRef.current;
  const displayedFlow = displayedFlowRef.current;

  if (nowS < flowHistory.lastTimeS) {
    flowHistory.mouth = [];
    flowHistory.vent = [];
    flowHistory.lastTimeS = -Infinity;
  }

  if (nowS < displayedFlow.lastSimulationTimeS) {
    displayedFlow.lastUpdateMs = -Infinity;
    displayedFlow.mouthLps = 0;
    displayedFlow.ventLps = 0;
  }
  displayedFlow.lastSimulationTimeS = nowS;

  const displayNowMs = Date.now();
  if (
    displayedFlow.lastUpdateMs === -Infinity ||
    displayNowMs - displayedFlow.lastUpdateMs >= FLOW_NUMBER_UPDATE_INTERVAL_MS
  ) {
    displayedFlow.lastUpdateMs = displayNowMs;
    displayedFlow.mouthLps = mouthDisplayFlowLps;
    displayedFlow.ventLps = ventDisplayFlowLps;
  }

  if (nowS - flowHistory.lastTimeS >= 0.09 || flowHistory.mouth.length === 0) {
    flowHistory.mouth.push({ timeS: nowS, value: mouthDisplayFlowLps });
    flowHistory.vent.push({ timeS: nowS, value: ventDisplayFlowLps });
    flowHistory.lastTimeS = nowS;
  }

  const historyStartS = nowS - 5;
  while (flowHistory.mouth.length > 1 && flowHistory.mouth[0].timeS < historyStartS) {
    flowHistory.mouth.shift();
  }
  while (flowHistory.vent.length > 1 && flowHistory.vent[0].timeS < historyStartS) {
    flowHistory.vent.shift();
  }

  const temperatureC = kelvinToCelsius(metrics.temperatureK);
  const rawTemperatureC = kelvinToCelsius(metrics.rawTemperatureK);
  const thermometerLevel = ((ambientC - (-5)) / (35 - (-5))) * 100;
  const thermometerMarkerY = 122.5 - thermometerLevel * 1.14;
  const resultantDirection = metrics.resultantN > 0.5 ? '↑' : metrics.resultantN < -0.5 ? '↓' : '0';
  const resultantTone = metrics.resultantN > 0.5 ? 'positive' : metrics.resultantN < -0.5 ? 'negative' : '';
  const dragDirection = metrics.dragN > 0.5 ? '↑' : metrics.dragN < -0.5 ? '↓' : '0';
  const dragTone = metrics.dragN > 0.5 ? 'positive' : metrics.dragN < -0.5 ? 'negative' : '';
  const flightStatus = metrics.reactionN > 0
    ? 'ON GROUND'
    : metrics.velocityMps > 0.08
      ? 'RISING'
      : metrics.velocityMps < -0.08
        ? 'DESCENDING'
        : 'AIRBORNE';
  const updateAmbientFromPointer = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const markerY = Math.max(8.5, Math.min(122.5, event.clientY - bounds.top));
    const level = (122.5 - markerY) / 114;
    setAmbientC(Math.round(-5 + level * 40));
  };

  const getDropPosition = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  };

  const startPanelDrag = (event, panelId) => {
    draggingPanelRef.current = panelId;
    setDraggingPanelId(panelId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', panelId);
  };

  const trackPanelDrag = (event, panelId) => {
    event.preventDefault();
    if (!draggingPanelRef.current || draggingPanelRef.current === panelId) {
      setDropTarget(null);
      return;
    }
    event.dataTransfer.dropEffect = 'move';
    const position = getDropPosition(event);
    setDropTarget((current) => (
      current?.panelId === panelId && current.position === position
        ? current
        : { panelId, position }
    ));
  };

  const endPanelDrag = () => {
    draggingPanelRef.current = null;
    setDraggingPanelId(null);
    setDropTarget(null);
  };

  const dropPanel = (event, panelId) => {
    event.preventDefault();
    const movingPanelId = draggingPanelRef.current;
    if (!movingPanelId || movingPanelId === panelId) {
      endPanelDrag();
      return;
    }

    const position = getDropPosition(event);
    setPanelOrder((current) => {
      const reordered = current.filter((id) => id !== movingPanelId);
      const targetIndex = reordered.indexOf(panelId);
      reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, movingPanelId);
      return reordered;
    });
    endPanelDrag();
  };

  const movePanelByKeyboard = (panelId, direction) => {
    setPanelOrder((current) => {
      const currentIndex = current.indexOf(panelId);
      const targetIndex = Math.max(0, Math.min(current.length - 1, currentIndex + direction));
      if (targetIndex === currentIndex) return current;
      const reordered = [...current];
      reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, panelId);
      return reordered;
    });
  };

  const togglePanelCollapsed = (panelId) => {
    setCollapsedPanels((current) => {
      const next = new Set(current);
      if (next.has(panelId)) next.delete(panelId);
      else next.add(panelId);
      return next;
    });
  };

  const panelDragProps = (panelId) => ({
    panelId,
    draggingPanelId,
    dropTarget,
    isCollapsed: collapsedPanels.has(panelId),
    onDragStart: startPanelDrag,
    onDragOver: trackPanelDrag,
    onDrop: dropPanel,
    onDragEnd: endPanelDrag,
    onKeyboardMove: movePanelByKeyboard,
    onToggleCollapsed: togglePanelCollapsed,
  });

  return (
    <OrderedReadoutStack order={panelOrder}>
      <ReadoutGroup
        {...panelDragProps('air-state')}
        title="Air state & density"
        className="air-state-readout-group"
        aside={(
          <label className="thermometer-control">
            <span className="thermometer-heading">
              <strong>Ambient</strong>
              <output>{ambientC} °C</output>
            </span>
            <span
              className="thermometer"
              style={{ '--thermometer-marker-y': `${thermometerMarkerY}px` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                updateAmbientFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  updateAmbientFromPointer(event);
                }
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
            >
              <span className="thermometer-scale" aria-hidden="true">
                <span>35°</span>
                <span>15°</span>
                <span>−5°</span>
              </span>
              <span className="thermometer-tube" aria-hidden="true">
                <span className="thermometer-mercury" />
                <span className="thermometer-bulb" />
              </span>
              <span className="thermometer-thumb" aria-hidden="true" />
              <input
                className="thermometer-range"
                type="range"
                min="-5"
                max="35"
                step="1"
                value={ambientC}
                aria-label="Ambient temperature"
                onChange={(event) => setAmbientC(Number(event.target.value))}
              />
            </span>
          </label>
        )}
      >
        <Metric
          label="Inside temperature"
          value={`${temperatureC.toFixed(1)} °C`}
          detail={`ambient ${ambientC} °C · raw ${rawTemperatureC.toFixed(0)} °C`}
        />
        <Metric
          label="Pressure proxy mismatch"
          value={`${metrics.pressureMismatchPct >= 0 ? '+' : ''}${metrics.pressureMismatchPct.toFixed(1)}%`}
        />
        <DensityComparison inside={metrics.rhoIn} outside={metrics.rhoOut} />
      </ReadoutGroup>

      <ReadoutGroup {...panelDragProps('forces')} title="Forces" className="force-readout-group">
        <Metric
          label="Upthrust"
          value={`${(metrics.upthrustN / 1000).toFixed(1)} kN`}
          detail="measured ρoutside × V × g"
          tone="positive"
        />
        <Metric
          label="Ground reaction"
          value={`${(metrics.reactionN / 1000).toFixed(1)} kN`}
          detail={metrics.reactionN > 0 ? 'balances downward free resultant' : 'zero when airborne / lifting'}
          tone={metrics.reactionN > 0 ? 'positive' : ''}
        />
        <Metric
          label="Balloon + contents weight"
          value={`${(metrics.balloonContentsWeightN / 1000).toFixed(1)} kN`}
          detail="envelope + enclosed air"
          tone="negative"
        />
        <Metric
          label="Basket weight"
          value={`${(metrics.basketWeightN / 1000).toFixed(1)} kN`}
          detail="basket + payload"
          tone="negative"
        />
        <Metric
          label="Drag"
          value={dragDirection === '0' ? '0.00 kN' : `${dragDirection} ${(Math.abs(metrics.dragN) / 1000).toFixed(2)} kN`}
          detail="opposes vertical motion"
          tone={dragTone}
        />
        <Metric
          label="Resultant force"
          value={resultantDirection === '0' ? '0.00 kN' : `${resultantDirection} ${(Math.abs(metrics.resultantN) / 1000).toFixed(2)} kN`}
          tone={resultantTone}
          className="resultant-highlight"
        />
      </ReadoutGroup>

      <ReadoutGroup {...panelDragProps('flight')} title="Flight" className="flight-readout-group">
        <Metric
          label="Status"
          value={flightStatus}
          className={`flight-status-metric status-${flightStatus.toLowerCase().replace(' ', '-')}`}
        />
        <Metric
          label="Altitude"
          value={`${metrics.altitudeM.toFixed(1)} m`}
          detail="height above ground"
          className="flight-altitude-metric"
        />
        <Metric
          label="Vertical velocity"
          value={`${metrics.velocityMps > 0.005 ? '↑ ' : metrics.velocityMps < -0.005 ? '↓ ' : ''}${Math.abs(metrics.velocityMps).toFixed(2)} m/s`}
          className="flight-motion-metric"
        />
        <Metric
          label="Acceleration"
          value={`${metrics.accelerationMps2 >= 0 ? '+' : ''}${metrics.accelerationMps2.toFixed(2)} m/s²`}
          className="flight-motion-metric"
        />
        <Metric
          label="Jerk"
          value={`${metrics.jerkMps3 >= 0 ? '+' : ''}${metrics.jerkMps3.toFixed(2)} m/s³`}
          className="flight-motion-metric"
        />
      </ReadoutGroup>

      <ReadoutGroup {...panelDragProps('airflow')} title="Airflow through openings" className="airflow-readout-group">
        <AirflowRow
          label="MOUTH"
          id="mouth-flow"
          value={displayedFlow.mouthLps}
          samples={flowHistory.mouth}
          nowS={nowS}
          scaleLps={FLOW_CHART_SCALE_LPS}
        />
        <AirflowRow
          label="TOP VENT"
          id="vent-flow"
          value={displayedFlow.ventLps}
          samples={flowHistory.vent}
          nowS={nowS}
          scaleLps={FLOW_CHART_SCALE_LPS}
        />
      </ReadoutGroup>
    </OrderedReadoutStack>
  );
}
