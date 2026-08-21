export default function Controls({
  basketPayloadMassKg,
  setBasketPayloadMassKg,
  paused,
  setPaused,
  slowMotion,
  setSlowMotion,
  toggles,
  setToggles,
  onReset,
}) {
  const toggle = (key) => {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <section className="control-panel" aria-label="Simulation controls">
      <div className="environment-controls">
        <label className="range-control payload-control">
          <span>
            <strong>Basket + payload</strong>
            <output>{basketPayloadMassKg} kg</output>
          </span>
          <input
            type="range"
            min="100"
            max="500"
            step="50"
            value={basketPayloadMassKg}
            onChange={(event) => setBasketPayloadMassKg(Number(event.target.value))}
          />
          <small>50 kg steps · each step adds or removes one ballast bag.</small>
        </label>

      </div>

      <div className="button-row">
        <button type="button" className="primary-button" onClick={() => setPaused((value) => !value)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className={slowMotion ? 'active-button' : ''}
          onClick={() => setSlowMotion((value) => !value)}
        >
          {slowMotion ? 'Slow: on' : 'Slow motion'}
        </button>
        <button type="button" onClick={onReset}>Reset</button>
      </div>

      <fieldset className="toggle-grid">
        <legend>Overlays</legend>
        {[
          ['daylight', 'Daylight'],
          ['particles', 'Particles'],
          ['trails', 'Fast-particle trails'],
          ['forces', 'Force arrows'],
          ['pressure', 'Pressure and altitude labels'],
          ['collisions', 'Fabric collisions'],
        ].map(([key, label]) => (
          <label className="check-control" key={key}>
            <input
              type="checkbox"
              checked={toggles[key]}
              onChange={() => toggle(key)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
