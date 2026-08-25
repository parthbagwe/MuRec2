import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { addFavorite, analyzeUnknown, clearHistory, getAcousticStatus, getFavorites, getHistory, getLyricStatus, getMe, getRecommendations, hostedApiEnabled, logout, recordEvent, removeFavorite } from "./api";
import AuthPanel from "./components/AuthPanel";
import LibraryPanel from "./components/LibraryPanel";
import RecommendationCard from "./components/RecommendationBar";
import SearchBar from "./components/SearchBar";
import TrackPreview from "./components/TrackPreview";
import MixPlayer from "./components/MixPlayer";
import ChartsPanel from "./components/ChartsPanel";

const DEFAULT_WEIGHTS = { audio: 0.35, lyric: 0.4, collab: 0.25 };
const MODES = [
  { id: "similar", label: "Closest", description: "Acoustic match with a fine-style compatibility guardrail" },
  { id: "rhythm", label: "Rhythm", description: "Tempo, onset pattern, pulse, and percussion" },
  { id: "timbre", label: "Timbre", description: "Spectral texture, brightness, density, and MFCC shape" },
  { id: "discover", label: "Surprise me", description: "A related sound from new artists—not a random detour" },
  { id: "personalized", label: "For you", description: "Learns from favourites, full previews, YouTube opens, and dislikes" },
  { id: "transition", label: "Transition run", description: "Five ordered songs matched step by step for tempo, key, energy, and texture" },
];

const MOODS = {
  idle: { name: "ready to listen", meaning: "curiosity · possibility", colors: ["#f0ff37", "#6c57ff", "#ff5aa5"] },
  red: { name: "red frequency", meaning: "love · excitement", colors: ["#ff3d2e", "#ff8a00", "#ffb7c8"] },
  blue: { name: "blue frequency", meaning: "calmness · introspection", colors: ["#2f67ff", "#8fc7ff", "#7654dc"] },
  yellow: { name: "yellow frequency", meaning: "warmth · energy", colors: ["#f7ff30", "#ffbe28", "#ff6544"] },
  purple: { name: "purple frequency", meaning: "mystery · depth", colors: ["#6540c9", "#b37bff", "#263ca8"] },
  green: { name: "green frequency", meaning: "organic · grounded", colors: ["#32c45b", "#b9ee45", "#37a3a3"] },
  white: { name: "white frequency", meaning: "clarity · stillness", colors: ["#f7f5ed", "#cbeeff", "#ded6ff"] },
  brown: { name: "earth frequency", meaning: "strength · warmth", colors: ["#9a4f22", "#e49948", "#6d3824"] },
  black: { name: "black frequency", meaning: "weight · intensity", colors: ["#121212", "#402c63", "#a32945"] },
};

function moodForTrack(track) {
  if (!track) return { id: "idle", ...MOODS.idle };
  const words = `${track.acoustic_signature || ""} ${track.subgenre || ""}`.toLowerCase();
  const energy = Number(track.energy ?? 50);
  const valence = Number(track.valence ?? .5);
  if (/aggressive|ferocious|extreme|metalcore|death|industrial|hardcore|nu metal|dense-noisy|noisy-distorted/.test(words) || energy >= 82) return { id: "black", ...MOODS.black };
  if (/dark|minor|melanch|sad|goth|doom|restrained/.test(words) || valence < .32) return { id: "blue", ...MOODS.blue };
  if (/ambient|airy|sparse|minimal|ethereal/.test(words) || energy < 28) return { id: "white", ...MOODS.white };
  if (/psychedelic|experimental|dream|mystery|art rock|progressive/.test(words)) return { id: "purple", ...MOODS.purple };
  if (/folk|organic|country|roots|earth|gentle/.test(words)) return { id: "green", ...MOODS.green };
  if (/soul|warm|blues|jazz|classic|harmonic/.test(words)) return { id: "brown", ...MOODS.brown };
  if (/bright|dance|pop|funk|rhythm-forward|upbeat/.test(words) || valence > .68) return { id: "yellow", ...MOODS.yellow };
  return { id: "red", ...MOODS.red };
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const [selected, setSelected] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [mode, setMode] = useState("similar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioProfile, setAudioProfile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [moodTrack, setMoodTrack] = useState(null);
  const [user, setUser] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [indexStatus, setIndexStatus] = useState(null);
  const [lyricStatus, setLyricStatus] = useState(null);
  const [mixQueue, setMixQueue] = useState([]);
  const [mixLoading, setMixLoading] = useState(false);
  const [autoPlayToken, setAutoPlayToken] = useState(0);
  const [playbackHandoff, setPlaybackHandoff] = useState(null);
  const recommendationRequest = useRef(0);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.track_id)), [favorites]);
  const scoreMode = recommendations[0]?.score_mode;
  const weightLabels = { audio: "rhythm", lyric: "timbre", collab: "harmony" };
  const activeMood = useMemo(() => moodForTrack(moodTrack), [moodTrack]);

  useEffect(() => {
    getMe().then((response) => { setUser(response.data.user); if (response.data.user) refreshLibrary(); }).catch(() => {});
    const updateIndexStatus = () => getAcousticStatus().then((response) => setIndexStatus(response.data)).catch(() => {});
    updateIndexStatus();
    getLyricStatus().then((response) => setLyricStatus(response.data)).catch(() => {});
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

  async function recommend(track, nextWeights = weights, nextMode = mode, handoff = null) {
    if (nextMode === "personalized" && !user) {
      handoff?.audio.pause();
      setAuthOpen(true);
      return;
    }
    handlePreviewChange(null);
    setSelected(track);
    setLoading(true);
    setError("");
    setAudioProfile(null);
    setPlaybackHandoff(handoff);
    setMixQueue([track]);
    setAutoPlayToken((token) => token + 1);
    setMixLoading(true);
    const requestId = ++recommendationRequest.current;
    try {
      const mixPromise = getRecommendations(track.track_id, 5, nextWeights, "transition");
      const recommendationPromise = nextMode === "transition"
        ? mixPromise
        : getRecommendations(track.track_id, 12, nextWeights, nextMode);
      const [recommendationResult, mixResult] = await Promise.allSettled([recommendationPromise, mixPromise]);
      if (requestId !== recommendationRequest.current) return;
      if (mixResult.status === "fulfilled") setMixQueue([track, ...mixResult.value.data.recommendations.slice(0, 5)]);
      if (recommendationResult.status === "rejected") throw recommendationResult.reason;
      setRecommendations(recommendationResult.value.data.recommendations);
      if (user) getHistory().then((result) => setHistory(result.data.history)).catch(() => {});
    } catch (requestError) {
      setRecommendations([]);
      setError(requestError.response?.data?.detail || "The API is unavailable. Run start-backend.cmd and try again.");
    } finally {
      if (requestId === recommendationRequest.current) { setLoading(false); setMixLoading(false); }
    }
  }

  async function chooseMode(nextMode) {
    if (nextMode === "personalized" && !user) { setAuthOpen(true); return; }
    setMode(nextMode);
    if (selected && !audioProfile) await recommend(selected, weights, nextMode);
  }

  async function analyze(file, title) {
    handlePreviewChange(null);
    setAnalyzing(true);
    setError("");
    try {
      const response = await analyzeUnknown(file, title, 12);
      setSelected(response.data.anchor);
      setRecommendations(response.data.recommendations);
      setMixQueue([response.data.anchor, ...response.data.recommendations.filter((track) => track.preview_url).slice(0, 5)]);
      setAutoPlayToken((token) => token + 1);
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
  function handlePreviewChange(track) {
    setPlayingTrackId(track?.track_id || null);
    setMoodTrack(track || null);
  }
  const handleMixTrackChange = useCallback((track) => {
    setPlayingTrackId(null);
    setMoodTrack(track || null);
  }, []);
  function dismissRecommendation(track) {
    setRecommendations((items) => items.filter((item) => item.track_id !== track.track_id));
    if (user) recordEvent(track.track_id, "disliked").catch(() => {});
  }
  async function eraseHistory() { await clearHistory(); setHistory([]); }
  function authenticated(account) { setUser(account); refreshLibrary(); }

  return (
    <main className={`app-shell mood-${activeMood.id}`}>
      <motion.div
        className="mood-color-base"
        initial={false}
        animate={{ backgroundColor: activeMood.colors[0] }}
        transition={{ duration: reducedMotion ? .2 : 3, ease: "linear" }}
        aria-hidden="true"
      />
      <AnimatePresence initial={false}>
        <motion.div
          key={activeMood.id}
          className="mood-layer"
          style={{ "--mood-a": activeMood.colors[0], "--mood-b": activeMood.colors[1], "--mood-c": activeMood.colors[2] }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? .2 : 3, ease: "linear" }}
          aria-hidden="true"
        />
      </AnimatePresence>
      <div className="flow-field" aria-hidden="true" />
      <motion.header className="app-header" initial={{ y: -64 }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 160, damping: 24 }}>
        <a className="logo" href="#top" aria-label="Cerum home">Cerum</a>
        <p className="header-manifesto">Sound has shape. Find its echo.</p>
        <nav aria-label="Account">
          {user ? <><button className="header-button" onClick={() => setLibraryOpen(true)}>Library <span>{favorites.length}</span></button><span className="account-name">{user.display_name}</span><button className="text-button" onClick={signOut}>Sign out</button></> : <button className="header-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
        </nav>
      </motion.header>

      <section className="intro-section" id="top">
        <div className="hero-grid">
          <motion.div className="hero-copy" initial={{ opacity: 0, x: -120 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 86, damping: 20 }}>
            <p className="kicker">01 / Acoustic discovery engine</p>
            <h1>Don’t sort music.<br /><span>Feel its shape.</span></h1>
            <p>Cerum hears rhythm, timbre, texture, dynamics and harmony—then finds the songs that live near the same feeling.</p>
          </motion.div>
          <ChartsPanel onSelect={recommend} onPreviewChange={handlePreviewChange} onInteraction={handleInteraction} />
        </div>
        <motion.div className="search-stage" initial={{ opacity: 0, x: -120 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 92, damping: 22, delay: .18 }}>
          <p className="search-label">Start with one song</p>
          <SearchBar onSelect={(track, handoff) => recommend(track, weights, mode, handoff)} onAnalyze={analyze} analyzing={analyzing} />
          {indexStatus && <p className="index-status"><span className={indexStatus.building ? "status-dot building" : "status-dot"} />{indexStatus.indexed.toLocaleString()} / {indexStatus.total.toLocaleString()} acoustic fingerprints ready{lyricStatus ? ` · ${lyricStatus.analyzed.toLocaleString()} licensed lyric maps ready` : ""}</p>}
        </motion.div>
      </section>

      <div className="kinetic-marquee" aria-hidden="true">
        <motion.div animate={reducedMotion ? {} : { x: ["0%", "-50%"] }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }}>
          {[0, 1].map((group) => <span key={group}>RHYTHM ↗ TIMBRE ↗ TEXTURE ↗ HARMONY ↗ YOUR NEXT SOUND ↗ </span>)}
        </motion.div>
      </div>

      <section className="workspace">
        <motion.div className="mode-section" initial={{ opacity: 0, x: -110 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .18 }} transition={{ type: "spring", stiffness: 78, damping: 20 }}>
          <div className="section-title"><p className="kicker">02 / Recommendation path</p><h2>Choose how<br />to move.</h2></div>
          <div className="mode-selector">
            {MODES.map((item, index) => <motion.button key={item.id} className={mode === item.id ? "active" : ""} onClick={() => chooseMode(item.id)} whileHover={{ y: -4 }} whileTap={{ scale: .98 }}><em>{String(index + 1).padStart(2, "0")}</em><strong>{item.label}{item.id === "personalized" && !user ? " · sign in" : ""}</strong><span>{item.description}</span></motion.button>)}
          </div>
        </motion.div>

        <motion.div className="controls-card" initial={{ opacity: 0, x: 110 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .18 }} transition={{ type: "spring", stiffness: 78, damping: 20 }}>
          <div className="reference-track">
            <p className="kicker">03 / Current signal</p>
            {selected
              ? <TrackPreview track={selected} playingTrackId={playingTrackId} onPreviewChange={handlePreviewChange} onInteraction={handleInteraction} />
              : <h2>Select a track above</h2>}
          </div>
          <div className="sliders">
            {Object.entries(weights).map(([name, value]) => <label key={name}><span>{weightLabels[name]}<strong>{Math.round(value * 100)}%</strong></span><input type="range" min="0" max="1" step="0.05" value={value} disabled={mode !== "similar"} onChange={(event) => updateWeight(name, event.target.value)} /></label>)}
          </div>
          <button className="primary-button" disabled={!selected || loading || Boolean(audioProfile)} onClick={() => recommend(selected)}>{loading ? "Finding matches…" : audioProfile ? "Acoustic analysis" : "Recalculate"}</button>
        </motion.div>

        {mode === "transition" && selected && <div className="transition-explainer"><strong>Your starting song is track 01.</strong><span>Cerum chooses five playable follow-ups in order. Every handoff is scored against the song immediately before it, while the original sound keeps the sequence from drifting.</span></div>}

        {error && <div className="notice error" role="alert">{error}</div>}
        {!error && !selected && <div className="notice">{hostedApiEnabled ? "Search the hosted acoustic catalogue above. Cerum ranks measured sound first, then applies its own microgenre compatibility guardrail—not an Apple or Spotify recommendation score." : "Search the catalogue above. Cerum transiently analyzes an available preview; for a missing or unavailable song, upload audio you are allowed to use. Raw audio is not retained."}</div>}
        {audioProfile && <><p className="acoustic-signature">{audioProfile.acoustic_signature}</p><div className="audio-profile"><div><span>tempo</span><strong>{audioProfile.bpm} BPM</strong></div><div><span>texture</span><strong>{audioProfile.texture}</strong></div><div><span>rhythm</span><strong>{audioProfile.rhythm_character}</strong></div><div><span>harmony</span><strong>{audioProfile.harmonic_character}</strong></div><div><span>intensity</span><strong>{audioProfile.intensity}</strong></div><div><span>aggression</span><strong>{Math.round(audioProfile.aggression * 100)}%</strong></div></div></>}

        <motion.div className="results-heading" initial={{ opacity: 0, x: -90 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .3 }} transition={{ type: "spring", stiffness: 80, damping: 20 }}><div><p className="kicker">04 / {mode === "transition" ? "Ordered transition path" : "Ranked suggestions"}</p><h2>{recommendations.length ? (mode === "transition" ? `${recommendations.length + 1}-song continuous run` : `${recommendations.length} sonic neighbours`) : "Your next sound starts here."}</h2></div>{scoreMode && <p>{scoreMode === "acoustic-transition" ? "tempo · key · energy · texture" : `${scoreMode.replace("metadata-", "").replace("metadata", "closest").replace("acoustic-profile", "acoustic")} model`}</p>}</motion.div>
        <div className={`recommendation-grid ${mode === "transition" ? "transition-grid" : ""}`}>
          {recommendations.map((rec, index) => <RecommendationCard key={rec.track_id} rec={rec} rank={index + 1} onClick={(track) => { handleInteraction(track, "selected"); recommend(track); }} playingTrackId={playingTrackId} onPreviewChange={handlePreviewChange} isFavorite={favoriteIds.has(rec.track_id)} onToggleFavorite={toggleFavorite} onInteraction={handleInteraction} onDismiss={dismissRecommendation} />)}
        </div>
      </section>

      <footer><span>Cerum · Acoustic scoring with fine-style guardrails · Raw audio is not retained</span><nav aria-label="Legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav></footer>
      <AuthPanel open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} />
      <LibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} favorites={favorites} history={history} onRemoveFavorite={async (id) => { await removeFavorite(id); refreshLibrary(); }} onClearHistory={eraseHistory} onChooseFavorite={(track) => recommend(track)} />
      <MixPlayer queue={mixQueue} loading={mixLoading} autoPlayToken={autoPlayToken} playbackHandoff={playbackHandoff} externalPlayingTrackId={playingTrackId} palette={activeMood.colors} onTrackChange={handleMixTrackChange} onInteraction={handleInteraction} />
    </main>
  );
}
