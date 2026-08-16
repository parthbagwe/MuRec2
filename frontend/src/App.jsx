import { useState } from "react";
import { analyzeUnknown, getRecommendations } from "./api";
import SearchBar from "./components/SearchBar";
import RecommendationCard from "./components/RecommendationBar";

const DEFAULT_WEIGHTS = { audio: 0.35, lyric: 0.35, collab: 0.3 };

export default function App() {
  const [selected, setSelected] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioProfile, setAudioProfile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const scoreMode = recommendations[0]?.score_mode;
  const weightLabels = selected?.source === "Apple Music"
    ? { audio: "genre", lyric: "artist", collab: "era" }
    : { audio: "audio", lyric: "lyric", collab: "collab" };

  async function recommend(track, nextWeights = weights) {
    setPlayingTrackId(null);
    setSelected(track);
    setLoading(true);
    setError("");
    setAudioProfile(null);
    try {
      const response = await getRecommendations(track.track_id, 12, nextWeights);
      setRecommendations(response.data.recommendations);
    } catch (requestError) {
      setRecommendations([]);
      setError(requestError.response?.data?.detail || "The API is unavailable. Run start-backend.cmd and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function analyze(file, title) {
    setPlayingTrackId(null);
    setAnalyzing(true);
    setError("");
    try {
      const response = await analyzeUnknown(file, title, 12);
      setSelected(response.data.anchor);
      setRecommendations(response.data.recommendations);
      setAudioProfile(response.data.audio_profile);
      return true;
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "This audio could not be analyzed. Try a WAV, MP3, FLAC, OGG, M4A, or AAC file under 30 MB.");
      return false;
    } finally {
      setAnalyzing(false);
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
          <p className="eyebrow">Real previews · explainable matches · YouTube discovery</p>
          <h1>Find your next song.<br /><em>Know why it fits.</em></h1>
          <p className="intro">Search real songs, hear a short preview, and jump to YouTube when you find the right one. Every match explains why it belongs.</p>
          <SearchBar onSelect={recommend} onAnalyze={analyze} analyzing={analyzing} />
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
                <span>{weightLabels[name]}<strong>{Math.round(value * 100)}%</strong></span>
                <input type="range" min="0" max="1" step="0.05" value={value} onChange={(event) => updateWeight(name, event.target.value)} />
              </label>
            ))}
          </div>
          <button disabled={!selected || loading || Boolean(audioProfile)} onClick={() => recommend(selected)}>
            {loading ? "Listening…" : audioProfile ? "Acoustic analysis" : "Recalculate mix"}
          </button>
        </div>

        {error && <div className="notice error">{error}</div>}
        {!error && !selected && <div className="notice">Search 3,464 real songs plus live catalogue results. If yours is missing, upload its audio for transient acoustic analysis.</div>}
        {audioProfile && (
          <div className="audio-profile">
            <div><span>tempo</span><strong>{audioProfile.bpm} BPM</strong></div>
            <div><span>timbre</span><strong>{audioProfile.timbre}</strong></div>
            <div><span>key</span><strong>{audioProfile.key}</strong></div>
            <div><span>centroid</span><strong>{Math.round(audioProfile.spectral_centroid_hz)} Hz</strong></div>
            <div><span>rolloff</span><strong>{Math.round(audioProfile.spectral_rolloff_hz)} Hz</strong></div>
            <div><span>energy</span><strong>{Math.round(audioProfile.energy)}%</strong></div>
          </div>
        )}

        <div className="results-heading">
          <div><p className="eyebrow">Ranked for you</p><h2>{recommendations.length ? `${recommendations.length} ${scoreMode === "metadata" ? "metadata" : scoreMode === "acoustic-profile" ? "acoustic" : "hybrid"} matches` : "Recommendations will appear here"}</h2></div>
        </div>
        <div className="recommendation-grid">
          {recommendations.map((rec, index) => (
            <RecommendationCard
              key={rec.track_id}
              rec={rec}
              rank={index + 1}
              onClick={recommend}
              playingTrackId={playingTrackId}
              onPreviewChange={setPlayingTrackId}
            />
          ))}
        </div>
      </section>

      <footer>
        <span>MuRec2 · Real-song metadata via Apple Search API · Uploaded audio is not retained</span>
        <nav aria-label="Legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav>
      </footer>
    </main>
  );
}
