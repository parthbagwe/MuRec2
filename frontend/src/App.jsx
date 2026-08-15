import { useState } from "react";
import { getRecommendations } from "./api";
import SearchBar from "./components/SearchBar";
import RecommendationCard from "./components/RecommendationBar";

const DEFAULT_WEIGHTS = { audio: 0.35, lyric: 0.35, collab: 0.3 };

export default function App() {
  const [selected, setSelected] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function recommend(track, nextWeights = weights) {
    setSelected(track);
    setLoading(true);
    setError("");
    try {
      const response = await getRecommendations(track.track_id, 12, nextWeights);
      setRecommendations(response.data.recommendations);
    } catch (requestError) {
      setRecommendations([]);
      setError(requestError.response?.data?.detail || "The API is unavailable. Start the backend on port 8000.");
    } finally {
      setLoading(false);
    }
  }

  function updateWeight(name, value) {
    const changed = Number(value);
    const otherNames = Object.keys(weights).filter((key) => key !== name);
    const otherTotal = otherNames.reduce((sum, key) => sum + weights[key], 0);
    const remainder = 1 - changed;
    const next = { ...weights, [name]: changed };
    otherNames.forEach((key) => {
      next[key] = otherTotal === 0 ? remainder / 2 : (weights[key] / otherTotal) * remainder;
    });
    setWeights(next);
  }

  return (
    <main>
      <header className="hero">
        <nav><span className="logo">MuRec<span>2</span></span><span className="tag">hybrid recommendation lab</span></nav>
        <div className="hero-copy">
          <p className="eyebrow">Sound + meaning + listener patterns</p>
          <h1>Find your next song.<br /><em>Know why it fits.</em></h1>
          <p className="intro">Choose a track and MuRec2 blends audio character, lyrical mood, and collaborative signals into transparent recommendations.</p>
          <SearchBar onSelect={recommend} />
        </div>
      </header>

      <section className="workspace">
        <div className="controls-card">
          <div>
            <p className="eyebrow">Your mix</p>
            <h2>{selected ? `${selected.title} — ${selected.artist}` : "Select a track above"}</h2>
          </div>
          <div className="sliders">
            {Object.entries(weights).map(([name, value]) => (
              <label key={name}>
                <span>{name}<strong>{Math.round(value * 100)}%</strong></span>
                <input type="range" min="0" max="1" step="0.05" value={value} onChange={(event) => updateWeight(name, event.target.value)} />
              </label>
            ))}
          </div>
          <button disabled={!selected || loading} onClick={() => recommend(selected)}>
            {loading ? "Listening…" : "Recalculate mix"}
          </button>
        </div>

        {error && <div className="notice error">{error}</div>}
        {!error && !selected && <div className="notice">Search for a demo track such as “Midnight” or an artist such as “Demo Artist 4”.</div>}

        <div className="results-heading">
          <div><p className="eyebrow">Ranked for you</p><h2>{recommendations.length ? `${recommendations.length} close matches` : "Recommendations will appear here"}</h2></div>
        </div>
        <div className="recommendation-grid">
          {recommendations.map((rec, index) => (
            <RecommendationCard key={rec.track_id} rec={rec} rank={index + 1} onClick={recommend} />
          ))}
        </div>
      </section>

      <footer>MuRec2 · Explainable hybrid music recommendations · Demo catalogue included</footer>
    </main>
  );
}
