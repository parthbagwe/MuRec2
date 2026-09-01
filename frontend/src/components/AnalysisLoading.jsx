const STEPS = [
  { threshold: 0.08, label: "Preview" },
  { threshold: 0.30, label: "Rhythm" },
  { threshold: 0.54, label: "Spectrum" },
  { threshold: 0.86, label: "Fingerprint" },
  { threshold: 0.98, label: "Match" },
];

export default function AnalysisLoading({ state }) {
  if (!state) return null;
  const progress = Math.max(0.03, Math.min(1, Number(state.progress) || 0));
  const percent = Math.round(progress * 100);

  return (
    <section className="analysis-loading" aria-live="polite" aria-label={`Analyzing ${state.track?.title || "song"}`}>
      <div className="analysis-loading-glow" aria-hidden="true" />
      <div className="analysis-loading-inner">
        <header>
          <span>CERUM / LIVE ACOUSTIC SCAN</span>
          <strong>{String(percent).padStart(2, "0")}%</strong>
        </header>
        <div className="analysis-loading-grid">
          <div className="musical-loader" aria-hidden="true">
            <i /><i /><i /><i />
            <span className="loader-floor" />
          </div>
          <div className="analysis-loading-copy">
            <p>New song detected</p>
            <h2>{state.track?.title}</h2>
            <h3>{state.track?.artist}</h3>
            <div className="analysis-stage"><span>{state.stage || "Listening"}</span><b>{percent}%</b></div>
            <div className="analysis-progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
            <ol>
              {STEPS.map((step) => (
                <li key={step.label} className={progress >= step.threshold ? "complete" : ""}>
                  <span />{step.label}
                </li>
              ))}
            </ol>
            <small>The preview keeps playing. Analysis stays in this browser and uses no more than 30 seconds.</small>
          </div>
        </div>
      </div>
    </section>
  );
}
