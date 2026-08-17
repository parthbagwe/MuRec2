import { useEffect, useMemo, useState } from "react";
import { addFavorite, analyzeUnknown, clearHistory, getFavorites, getHistory, getMe, getRecommendations, logout, recordEvent, removeFavorite } from "./api";
import AuthPanel from "./components/AuthPanel";
import LibraryPanel from "./components/LibraryPanel";
import RecommendationCard from "./components/RecommendationBar";
import SearchBar from "./components/SearchBar";

const DEFAULT_WEIGHTS = { audio: 0.65, lyric: 0.1, collab: 0.25 };
const MODES = [
  { id: "similar", label: "Closest", description: "Same subgenre, artist context, and era" },
  { id: "adjacent", label: "Adjacent", description: "A nearby sound without repeating the exact lane" },
  { id: "same-era", label: "Same era", description: "Music shaped by a similar point in time" },
  { id: "discover", label: "Surprise me", description: "More new artists and less repetition" },
  { id: "personalized", label: "For you", description: "Uses the artists and subgenres in your favourites" },
];

export default function App() {
  const [selected, setSelected] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [mode, setMode] = useState("similar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioProfile, setAudioProfile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [user, setUser] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.track_id)), [favorites]);
  const scoreMode = recommendations[0]?.score_mode;
  const weightLabels = selected?.source === "Apple Music" ? { audio: "subgenre", lyric: "artist", collab: "era" } : { audio: "audio", lyric: "lyric", collab: "collab" };

  useEffect(() => {
    getMe().then((response) => { setUser(response.data.user); refreshLibrary(); }).catch(() => {});
  }, []);

  async function refreshLibrary() {
    try {
      const [favoriteResponse, historyResponse] = await Promise.all([getFavorites(), getHistory()]);
      setFavorites(favoriteResponse.data.favorites);
      setHistory(historyResponse.data.history);
    } catch {
      setFavorites([]);
      setHistory([]);
    }
  }

  async function recommend(track, nextWeights = weights, nextMode = mode) {
    if (nextMode === "personalized" && !user) { setAuthOpen(true); return; }
    setPlayingTrackId(null);
    setSelected(track);
    setLoading(true);
    setError("");
    setAudioProfile(null);
    try {
      const response = await getRecommendations(track.track_id, 12, nextWeights, nextMode);
      setRecommendations(response.data.recommendations);
      if (user) getHistory().then((result) => setHistory(result.data.history)).catch(() => {});
    } catch (requestError) {
      setRecommendations([]);
      setError(requestError.response?.data?.detail || "The API is unavailable. Run start-backend.cmd and try again.");
    } finally { setLoading(false); }
  }

  async function chooseMode(nextMode) {
    if (nextMode === "personalized" && !user) { setAuthOpen(true); return; }
    setMode(nextMode);
    if (selected && !audioProfile) await recommend(selected, weights, nextMode);
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
      setError(requestError.response?.data?.detail || "This audio could not be analyzed. Try a common audio format under 30 MB.");
      return false;
    } finally { setAnalyzing(false); }
  }

  function updateWeight(name, value) {
    const changed = Number(value);
    const otherNames = Object.keys(weights).filter((key) => key !== name);
    const otherTotal = otherNames.reduce((sum, key) => sum + weights[key], 0);
    const remainder = 1 - changed;
    const next = { ...weights, [name]: changed };
    otherNames.forEach((key) => { next[key] = otherTotal === 0 ? remainder / 2 : (weights[key] / otherTotal) * remainder; });
    setWeights(next);
  }

  async function toggleFavorite(track) {
    if (!user) { setAuthOpen(true); return; }
    try {
      if (favoriteIds.has(track.track_id)) await removeFavorite(track.track_id);
      else await addFavorite(track.track_id);
      await refreshLibrary();
    } catch (requestError) { setError(requestError.response?.data?.detail || "Could not update favourites."); }
  }

  async function signOut() {
    await logout().catch(() => {});
    setUser(null); setFavorites([]); setHistory([]); setLibraryOpen(false);
    setMode("similar"); setSelected(null); setRecommendations([]); setAudioProfile(null); setError("");
  }

  function handleInteraction(track, eventType) { if (user) recordEvent(track.track_id, eventType).catch(() => {}); }
  async function eraseHistory() { await clearHistory(); setHistory([]); }
  function authenticated(account) { setUser(account); refreshLibrary(); }

  return (
    <main>
      <header className="app-header">
        <a className="logo" href="#top" aria-label="MuRec2 home">MuRec<span>2</span></a>
        <nav aria-label="Account">
          {user ? <><button className="header-button" onClick={() => setLibraryOpen(true)}>Library <span>{favorites.length}</span></button><span className="account-name">{user.display_name}</span><button className="text-button" onClick={signOut}>Sign out</button></> : <button className="header-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
        </nav>
      </header>

      <section className="intro-section" id="top">
        <p className="kicker">Explainable music discovery</p>
        <h1>Recommendations with a reason.</h1>
        <p>Search a track, decide how far you want to wander, and hear a preview before opening YouTube.</p>
        <SearchBar onSelect={recommend} onAnalyze={analyze} analyzing={analyzing} />
      </section>

      <section className="workspace">
        <div className="mode-section">
          <div className="section-title"><p className="kicker">Recommendation approach</p><h2>Choose a direction</h2></div>
          <div className="mode-selector">
            {MODES.map((item) => <button key={item.id} className={mode === item.id ? "active" : ""} onClick={() => chooseMode(item.id)}><strong>{item.label}{item.id === "personalized" && !user ? " · sign in" : ""}</strong><span>{item.description}</span></button>)}
          </div>
        </div>

        <div className="controls-card">
          <div><p className="kicker">Current reference</p><h2>{selected ? `${selected.title} — ${selected.artist}` : "Select a track above"}</h2></div>
          <div className="sliders">
            {Object.entries(weights).map(([name, value]) => <label key={name}><span>{weightLabels[name]}<strong>{Math.round(value * 100)}%</strong></span><input type="range" min="0" max="1" step="0.05" value={value} disabled={mode !== "similar"} onChange={(event) => updateWeight(name, event.target.value)} /></label>)}
          </div>
          <button className="primary-button" disabled={!selected || loading || Boolean(audioProfile)} onClick={() => recommend(selected)}>{loading ? "Finding matches…" : audioProfile ? "Acoustic analysis" : "Recalculate"}</button>
        </div>

        {error && <div className="notice error" role="alert">{error}</div>}
        {!error && !selected && <div className="notice">Search the real-song catalogue above. If a track is missing, upload audio and MuRec2 will compare its tempo, timbre, key, and frequency profile.</div>}
        {audioProfile && <div className="audio-profile"><div><span>tempo</span><strong>{audioProfile.bpm} BPM</strong></div><div><span>timbre</span><strong>{audioProfile.timbre}</strong></div><div><span>key</span><strong>{audioProfile.key}</strong></div><div><span>centroid</span><strong>{Math.round(audioProfile.spectral_centroid_hz)} Hz</strong></div><div><span>rolloff</span><strong>{Math.round(audioProfile.spectral_rolloff_hz)} Hz</strong></div><div><span>energy</span><strong>{Math.round(audioProfile.energy)}%</strong></div></div>}

        <div className="results-heading"><div><p className="kicker">Ranked suggestions</p><h2>{recommendations.length ? `${recommendations.length} matches` : "Recommendations will appear here"}</h2></div>{scoreMode && <p>{scoreMode.replace("metadata-", "").replace("metadata", "closest").replace("acoustic-profile", "acoustic")} model</p>}</div>
        <div className="recommendation-grid">
          {recommendations.map((rec, index) => <RecommendationCard key={rec.track_id} rec={rec} rank={index + 1} onClick={(track) => { handleInteraction(track, "selected"); recommend(track); }} playingTrackId={playingTrackId} onPreviewChange={setPlayingTrackId} isFavorite={favoriteIds.has(rec.track_id)} onToggleFavorite={toggleFavorite} onInteraction={handleInteraction} />)}
        </div>
      </section>

      <footer><span>MuRec2 · Real catalogue metadata · Uploaded audio is not retained</span><nav aria-label="Legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav></footer>
      <AuthPanel open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} />
      <LibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} favorites={favorites} history={history} onRemoveFavorite={async (id) => { await removeFavorite(id); refreshLibrary(); }} onClearHistory={eraseHistory} onChooseFavorite={(track) => recommend(track)} />
    </main>
  );
}
