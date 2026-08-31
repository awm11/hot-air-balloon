import { useState } from 'react';
import Controls from './components/Controls.jsx';
import AltitudeMap from './components/AltitudeMap.jsx';
import Readouts from './components/Readouts.jsx';
import SimulationCanvas from './components/SimulationCanvas.jsx';
import LearnSequence from './components/LearnSequence.jsx';
import { PHYSICS } from './sim/constants.js';
import { outsideDensityKgM3, celsiusToKelvin } from './sim/thermodynamics.js';

function initialMetrics(ambientC, basketPayloadMassKg) {
  const rhoOut = outsideDensityKgM3(ambientC, 0);
  const upthrustN = rhoOut * PHYSICS.balloonVolumeM3 * PHYSICS.g;
  const internalAirMassKg = rhoOut * PHYSICS.balloonVolumeM3;
  const balloonContentsWeightN = (PHYSICS.envelopeMassKg + internalAirMassKg) * PHYSICS.g;
  const basketWeightN = basketPayloadMassKg * PHYSICS.g;
  const freeNetForceN = upthrustN - balloonContentsWeightN - basketWeightN;
  const reactionN = Math.max(0, -freeNetForceN);

  return {
    timeS: 0,
    ambientK: celsiusToKelvin(ambientC),
    rawTemperatureK: celsiusToKelvin(ambientC),
    temperatureK: celsiusToKelvin(ambientC),
    particleCount: 0,
    rawParticleCount: 0,
    ambientEquivalentCount: 0,
    outsideParticleCount: 0,
    outsideAmbientEquivalentCount: 0,
    insideDensityRelativeAmbient: 1,
    outsideDensityRelativeAmbient: 1,
    densityRatio: 1,
    pressureRatio: 1,
    pressureMismatchPct: 0,
    altitudeM: 0,
    velocityMps: 0,
    accelerationMps2: 0,
    jerkMps3: 0,
    groundY: 0,
    burner: 0,
    ventOpen: false,
    rhoOut,
    rhoIn: rhoOut,
    pressurePa: PHYSICS.seaLevelPressurePa,
    upthrustN,
    internalAirMassKg,
    balloonContentsWeightN,
    basketWeightN,
    dragN: 0,
    freeNetForceN,
    reactionN,
    netForceN: 0,
    resultantN: 0,
    mouthFluxInPerS: 0,
    mouthFluxOutPerS: 0,
    mouthNetFluxPerS: 0,
    mouthNetFlowLps: 0,
    ventFluxInPerS: 0,
    ventFluxOutPerS: 0,
    ventNetFluxPerS: 0,
    ventNetFlowLps: 0,
  };
}

export default function App() {
  const [activeSection, setActiveSection] = useState('learn');
  const [burnerLatched, setBurnerLatched] = useState(false);
  const [burnerHeld, setBurnerHeld] = useState(false);
  const burner = burnerLatched || burnerHeld ? 1 : 0;
  const [ventLatched, setVentLatched] = useState(false);
  const [ventHeld, setVentHeld] = useState(false);
  const ventOpen = ventLatched || ventHeld;
  const [basketPayloadMassKg, setBasketPayloadMassKg] = useState(PHYSICS.defaultBasketPayloadMassKg);
  const [ambientC, setAmbientC] = useState(15);
  const [paused, setPaused] = useState(false);
  const [slowMotion, setSlowMotion] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [toggles, setToggles] = useState({
    daylight: true,
    particles: true,
    trails: true,
    forces: true,
    pressure: true,
    collisions: false,
  });
  const [metrics, setMetrics] = useState(() => initialMetrics(15, PHYSICS.defaultBasketPayloadMassKg));

  const reset = () => {
    setBurnerLatched(false);
    setBurnerHeld(false);
    setVentLatched(false);
    setVentHeld(false);
    setPaused(false);
    setSlowMotion(false);
    setResetKey((key) => key + 1);
    setMetrics(initialMetrics(ambientC, basketPayloadMassKg));
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">THE MAGIC OF LIGHTER THAN AIR FLIGHT</p>
          <h1>Hot-Air Balloon Lab</h1>
        </div>
        {activeSection !== 'learn' && (
          <div className="causal-chain" aria-label="Causal chain">
            <span>burner adds KE</span>
            <b>→</b>
            <span>temperature rises</span>
            <b>→</b>
            <span>air leaves</span>
            <b>→</b>
            <span>density falls</span>
            <b>→</b>
            <span>lift</span>
          </div>
        )}
        <nav className="section-switcher" aria-label="Main sections">
          <button
            type="button"
            className={activeSection === 'learn' ? 'section-switcher-active' : ''}
            aria-pressed={activeSection === 'learn'}
            onClick={() => setActiveSection('learn')}
          >
            Learn
          </button>
          <button
            type="button"
            className={activeSection === 'lab' ? 'section-switcher-active' : ''}
            aria-pressed={activeSection === 'lab'}
            onClick={() => setActiveSection('lab')}
          >
            Hot Air Balloon Lab
          </button>
        </nav>
      </header>

      {activeSection === 'learn' ? (
        <LearnSequence />
      ) : (
        <>
      <div className="lab-layout">
        <div className="flight-stage">
          <AltitudeMap
            altitudeM={metrics.altitudeM}
            daylight={toggles.daylight}
          />
          <section className="simulation-column" aria-label="Balloon simulation">
            <SimulationCanvas
              burner={burner}
              burnerLatched={burnerLatched}
              setBurnerLatched={setBurnerLatched}
              setBurnerHeld={setBurnerHeld}
              ventOpen={ventOpen}
              ventLatched={ventLatched}
              setVentLatched={setVentLatched}
              setVentHeld={setVentHeld}
              basketPayloadMassKg={basketPayloadMassKg}
              ambientC={ambientC}
              paused={paused}
              slowMotion={slowMotion}
              toggles={toggles}
              resetKey={resetKey}
              onMetrics={setMetrics}
            />
          </section>
        </div>

        <aside className="lab-sidebar" aria-label="Measurements">
          <Readouts metrics={metrics} ambientC={ambientC} setAmbientC={setAmbientC} />
        </aside>
      </div>

      <div className="wide-controls">
        <Controls
          basketPayloadMassKg={basketPayloadMassKg}
          setBasketPayloadMassKg={setBasketPayloadMassKg}
          paused={paused}
          setPaused={setPaused}
          slowMotion={slowMotion}
          setSlowMotion={setSlowMotion}
          toggles={toggles}
          setToggles={setToggles}
          onReset={reset}
        />
      </div>

      <section className="model-note" aria-labelledby="model-note-title">
        <div className="model-note-heading">
          <p className="model-note-kicker">ABOUT THE SIMULATION</p>
          <h2 id="model-note-title">Assumptions, physics and interpretation</h2>
          <p>
            This is an explanatory model of the causal chain behind hot-air-balloon flight,
            not a flight-planning or engineering tool. It combines a two-dimensional parcel
            animation with three-dimensional balloon physics: the dots make heat, density and
            airflow visible, while the force calculation uses a real volume, mass and reference
            area. The aim is physically coherent behaviour that remains easy to inspect.
          </p>
        </div>

        <div className="model-facts" aria-label="Core model values">
          <span><strong>2,395.8 m³</strong> envelope volume</span>
          <span><strong>125 kg</strong> envelope mass</span>
          <span><strong>100–500 kg</strong> basket + payload</span>
          <span><strong>0.611</strong> drag coefficient</span>
          <span><strong>123.2 m²</strong> drag area</span>
          <span><strong>60 Hz</strong> physics update</span>
        </div>

        <div className="note-grid">
          <article className="model-card">
            <h3>One continuous parcel sea</h3>
            <p>
              Inside and outside air are not separate substances. Every dot is a representative
              parcel in one continuous atmosphere. A parcel is “inside” only while its current
              position lies within the envelope. Fabric reflects parcels; the mouth is always an
              opening, and the crown becomes a genuine second opening when the top vent is open.
            </p>
            <p>
              The dots are much larger and fewer than real molecules. Their occupancy is therefore
              smoothed before it becomes a density reading, reducing sampling noise without forcing
              the two densities to agree.
            </p>
          </article>

          <article className="model-card">
            <h3>Temperature and the burner</h3>
            <p>
              Random parcel motion represents thermal kinetic energy: faster random motion means a
              higher temperature. The burner adds random kinetic energy to parcels in the lower
              envelope. It preserves their local average velocity, so it heats the air without
              secretly pushing the balloon upward.
            </p>
            <p>
              Temperature is measured in horizontal bands so rising hot regions and cooler regions
              can coexist. The displayed thermometer is smoothed with a 4-second response rather
              than following every collision.
            </p>
          </article>

          <article className="model-card">
            <h3>Heat loss</h3>
            <p>
              The envelope and surrounding atmosphere act as a thermal reservoir. Air hotter than
              ambient relaxes toward ambient with a 10-second time constant. A separate 5-second
              recovery operates only below ambient to counter an artefact of the coarse open-mouth
              parcel model, which can otherwise preferentially lose fast parcels.
            </p>
            <p>
              The model therefore does not allow persistent passive cooling below the selected
              ambient temperature. It does not separately model fabric temperature, radiation,
              humidity or burner combustion products.
            </p>
          </article>

          <article className="model-card">
            <h3>Density, pressure and altitude</h3>
            <p>
              Density comes from the number of representative parcels occupying a known region,
              calibrated against the ideal-gas ambient density <code>ρ = P/RT</code> at the start
              of a run. The parcel mass stays fixed during that run: moving the ambient thermometer
              changes the thermal reservoir, while Reset establishes a new density calibration.
              The atmospheric pressure readout falls exponentially with altitude using an 8,434 m
              scale height; the live inside and outside densities still come from parcel occupancy.
            </p>
            <p>
              The pressure readout is a proxy based on <code>P ∝ ρT</code>. It drives gas
              redistribution through openings, but pressure is deliberately excluded from the
              balloon’s force calculation—preventing pressure imbalance from becoming a second,
              hidden source of lift.
            </p>
          </article>

          <article className="model-card">
            <h3>Airflow through the openings</h3>
            <p>
              A coarse bidirectional pressure-gradient field moves parcels through the mouth and,
              when open, the top vent. A small pressure deadband prevents noise from producing
              constant flow. Opening the vent changes both the visible fabric and the actual parcel
              boundary; the vent itself adds no force.
            </p>
            <p>
              Each chart reports net flow—entering minus leaving—rather than showing simultaneous
              gross flows. It is a rolling average over the previous 4 seconds, with the unfilled
              part of the window treated as zero after reset. For readability, the displayed
              litres-per-second values are one tenth of the internally estimated volumetric flow;
              this visual scaling does not affect particles, temperature, density or flight.
            </p>
          </article>

          <article className="model-card">
            <h3>Forces</h3>
            <dl className="model-equations">
              <div><dt>Upthrust</dt><dd><code>ρoutside Vg</code></dd></div>
              <div><dt>Envelope + enclosed-air weight</dt><dd><code>(125 kg + ρinside V)g</code></dd></div>
              <div><dt>Basket weight</dt><dd><code>payload mass × g</code></dd></div>
              <div><dt>Drag</dt><dd><code>½ρoutside Cd Av²</code>, opposite the motion</dd></div>
            </dl>
            <p>
              Resultant force is the signed sum of these forces plus any ground reaction. Drag is
              proportional to speed squared, uses <code>Cd = 0.611</code>, and acts only vertically
              because the model has no horizontal flight or wind.
            </p>
          </article>

          <article className="model-card">
            <h3>Ground, lift-off and motion</h3>
            <p>
              While the balloon rests on the ground, the reaction force exactly cancels any
              downward free resultant. It cannot pull downward, so it falls to zero as soon as the
              free resultant points upward. Once airborne, acceleration is <code>a = Fresultant/m</code>,
              where inertial mass includes the envelope, basket, payload and currently enclosed air.
            </p>
            <p>
              Velocity and altitude are advanced in fixed 1/60-second steps. Altitude cannot go
              below zero. Jerk is the rate of change of acceleration and is smoothed over roughly
              0.4 seconds so the readout remains legible.
            </p>
          </article>

          <article className="model-card">
            <h3>Geometry and calibration</h3>
            <p>
              The drawn envelope is also the particle-collision boundary. Its broadened,
              vertically compressed profile has a fixed model volume of 2,395.8 m³. Changing that
              geometry changed potential lift because more or fewer parcels can occupy it; the
              current volume and parcel population were recalibrated together. The vertical drag
              area remained 123.2 m² because the envelope’s horizontal width was retained when its
              height was reduced.
            </p>
            <p>
              Payload changes in 50 kg steps and is represented by ballast bags. Those steps affect
              basket weight and inertial mass directly.
            </p>
          </article>

          <article className="model-card model-card-wide">
            <h3>What is display-only—and what is not modelled</h3>
            <p>
              Daylight, particle visibility, trails, collision flashes, coloured balloon skin,
              labels, panel order and panel collapse are presentation controls only. The camera lets
              the balloon rise about 5 m before the ground scrolls, and force arrows use a
              readability scale that preserves short arrows while compressing long ones. Neither
              adjustment changes a force or trajectory.
            </p>
            <p>
              The model omits wind, horizontal motion, weather layers, humidity, changing gas
              composition, detailed convection and turbulence, fabric deformation, a separate
              fabric heat capacity, burner fuel consumption, ropes, pilot inputs and landing
              dynamics. The finite parcel sea and coarse opening-flow field are educational
              approximations, so instantaneous fluctuations and exact flow rates should be read as
              illustrative rather than as predictions for a particular real balloon.
            </p>
          </article>
        </div>
      </section>
        </>
      )}
    </main>
  );
}
