import { useEffect, useMemo, useState } from "react";
import { addFavorite, analyzeUnknown, clearHistory, getAcousticStatus, getFavorites, getHistory, getMe, getRecommendations, hostedApiEnabled, logout, recordEvent, removeFavorite } from "./api";
import AuthPanel from "./components/AuthPanel";
import LibraryPanel from "./components/LibraryPanel";
import RecommendationCard from "./components/RecommendationBar";
import SearchBar from "./components/SearchBar";

const DEFAULT_WEIGHTS = { audio: 0.35, lyric: 0.4, collab: 0.25 };
const MODES = [
  { id: "similar", label: "Closest", description: "Balanced rhythm, timbre, texture, and harmony" },
  { id: "rhythm", label: "Rhythm", description: "Tempo, onset pattern, pulse, and percussion" },
  { id: "timbre", label: "Timbre", description: "Spectral texture, brightness, density, and MFCC shape" },
  { id: "discover", label: "Surprise me", description: "A new artist at a believable acoustic distance" },
  { id: "personalized", label: "For you", description: "Compares the audio fingerprints in your favourites" },
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
  const [indexStatus, setIndexStatus] = useState(null);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.track_id)), [favorites]);
  const scoreMode = recommendations[0]?.score_mode;
  const weightLabels = { audio: "rhythm", lyric: "timbre", collab: "harmony" };

  useEffect(() => {
    getMe().then((response) => { setUser(response.data.user); refreshLibrary(); }).catch(() => {});
    const updateIndexStatus = () => getAcousticStatus().then((response) => setIndexStatus(response.data)).catch(() => {});
    updateIndexStatus();
    const timer = window.setInterval(updateIndexStatus, 10000);
    return () => window.clearInterval(timer);
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
        <a className="logo" href="#top" aria-label="Cerum home">Cerum</a>
        <nav aria-label="Account">
          {user ? <><button className="header-button" onClick={() => setLibraryOpen(true)}>Library <span>{favorites.length}</span></button><span className="account-name">{user.display_name}</span><button className="text-button" onClick={signOut}>Sign out</button></> : <button className="header-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
        </nav>
      </header>

      <section className="intro-section" id="top">
        <p className="kicker">Provider-neutral acoustic discovery</p>
        <h1>Matched by sound, not a genre tag.</h1>
        <p>Cerum listens to available audio and compares rhythm, timbre, texture, dynamics, and harmony. Catalogue services supply song details and previews—not the categories.</p>
        <SearchBar onSelect={recommend} onAnalyze={analyze} analyzing={analyzing} />
        {indexStatus && <p className="index-status">Acoustic library: {indexStatus.indexed.toLocaleString()} of {indexStatus.total.toLocaleString()} songs analyzed{indexStatus.building ? " · listening in the background" : ""}</p>}
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
        {!error && !selected && <div className="notice">{hostedApiEnabled ? "Search the hosted acoustic catalogue above. Every available match is ranked from Cerum’s stored audio measurements, not provider genre labels." : "Search the catalogue above. Cerum transiently analyzes an available preview; for a missing or unavailable song, upload audio you are allowed to use. Raw audio is not retained."}</div>}
        {audioProfile && <><p className="acoustic-signature">{audioProfile.acoustic_signature}</p><div className="audio-profile"><div><span>tempo</span><strong>{audioProfile.bpm} BPM</strong></div><div><span>texture</span><strong>{audioProfile.texture}</strong></div><div><span>rhythm</span><strong>{audioProfile.rhythm_character}</strong></div><div><span>harmony</span><strong>{audioProfile.harmonic_character}</strong></div><div><span>intensity</span><strong>{audioProfile.intensity}</strong></div><div><span>aggression</span><strong>{Math.round(audioProfile.aggression * 100)}%</strong></div></div></>}

        <div className="results-heading"><div><p className="kicker">Ranked suggestions</p><h2>{recommendations.length ? `${recommendations.length} matches` : "Recommendations will appear here"}</h2></div>{scoreMode && <p>{scoreMode.replace("metadata-", "").replace("metadata", "closest").replace("acoustic-profile", "acoustic")} model</p>}</div>
        <div className="recommendation-grid">
          {recommendations.map((rec, index) => <RecommendationCard key={rec.track_id} rec={rec} rank={index + 1} onClick={(track) => { handleInteraction(track, "selected"); recommend(track); }} playingTrackId={playingTrackId} onPreviewChange={setPlayingTrackId} isFavorite={favoriteIds.has(rec.track_id)} onToggleFavorite={toggleFavorite} onInteraction={handleInteraction} />)}
        </div>
      </section>

      <footer><span>Cerum · Categories derived from audio · Raw audio is not retained</span><nav aria-label="Legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav></footer>
      <AuthPanel open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} />
      <LibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} favorites={favorites} history={history} onRemoveFavorite={async (id) => { await removeFavorite(id); refreshLibrary(); }} onClearHistory={eraseHistory} onChooseFavorite={(track) => recommend(track)} />
    </main>
  );
}
