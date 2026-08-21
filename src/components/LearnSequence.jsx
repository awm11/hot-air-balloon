import { useState } from 'react';
import LearnPressure from './LearnPressure.jsx';
import LearnBuoyancy from './LearnBuoyancy.jsx';
import LearnLiquidPressure from './LearnLiquidPressure.jsx';

const STEPS = [
  { id: 'pressure', label: 'Pressure with depth' },
  { id: 'buoyancy', label: 'Buoyancy from collisions' },
  { id: 'liquid', label: 'Applied pressure' },
];

export default function LearnSequence() {
  const [stepIndex, setStepIndex] = useState(0);

  return (
    <div className="learn-sequence">
      <nav className="learn-step-switcher" aria-label="Learn exercises">
        {STEPS.map((step, index) => (
          <button
            type="button"
            key={step.id}
            className={index === stepIndex ? 'learn-step-active' : ''}
            aria-current={index === stepIndex ? 'step' : undefined}
            onClick={() => setStepIndex(index)}
          >
            <span>{index + 1}</span>
            {step.label}
          </button>
        ))}
      </nav>

      {stepIndex === 0 && <LearnPressure />}
      {stepIndex === 1 && <LearnBuoyancy />}
      {stepIndex === 2 && <LearnLiquidPressure />}

      <div className="learn-step-actions" aria-label="Learn exercise navigation">
        {stepIndex > 0 && (
          <button type="button" onClick={() => setStepIndex(stepIndex - 1)}>
            ← Previous: {STEPS[stepIndex - 1].label.toLowerCase()}
          </button>
        )}
        {stepIndex < STEPS.length - 1 && (
          <button
            type="button"
            className="learn-step-next"
            onClick={() => setStepIndex(stepIndex + 1)}
          >
            Next: {STEPS[stepIndex + 1].label.toLowerCase()} →
          </button>
        )}
      </div>
    </div>
  );
}
