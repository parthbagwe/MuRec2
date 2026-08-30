import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { addFavorite, analyzeUnknown, clearHistory, getAcousticStatus, getFavorites, getHistory, getMe, getRecommendations, getSoundBridge, hostedApiEnabled, logout, recordEvent, removeFavorite } from "./api";
import AuthPanel from "./components/AuthPanel";
import LibraryPanel from "./components/LibraryPanel";
import RecommendationCard from "./components/RecommendationBar";
import SearchBar from "./components/SearchBar";
import TrackPreview from "./components/TrackPreview";
import MixPlayer from "./components/MixPlayer";
import ChartsPanel from "./components/ChartsPanel";
import SoundBridge from "./components/SoundBridge";
import GenreGate from "./components/GenreGate";

const DEFAULT_WEIGHTS = { audio: 0.35, lyric: 0.4, collab: 0.25 };
const MODES = [
  { id: "similar", label: "Balanced", description: "The closest overall match in sound and mood" },
  { id: "rhythm", label: "Same groove", description: "Prioritise tempo, pulse, percussion and movement" },
  { id: "timbre", label: "Same texture", description: "Prioritise tone, brightness, density and colour" },
  { id: "discover", label: "Discovery", description: "Keep the feeling, introduce unfamiliar artists" },
];

const GENRE_STORAGE_KEY = "cerum.genre-scope.v1";
const GENRE_LABELS = { strict: "Same genre", nearby: "Nearby styles", open: "Any genre" };

function rememberedGenreScope() {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(GENRE_STORAGE_KEY);
  return ["strict", "nearby", "open"].includes(saved) ? saved : null;
}

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
  const [mixQueue, setMixQueue] = useState([]);
  const [mixLoading, setMixLoading] = useState(false);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [genreScope, setGenreScope] = useState(rememberedGenreScope);
  const [genrePrompt, setGenrePrompt] = useState(null);
  const [modeFeedback, setModeFeedback] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  function stageSelection(track, handoff = null) {
    handlePreviewChange(null);
    setSelected(track);
    setRecommendations([]);
    setError("");
    setAudioProfile(null);
    setPlaybackHandoff(handoff);
    setMixQueue([track]);
    setAutoPlayToken((token) => token + 1);
  }

  function requestGenreChoice(track, handoff = null) {
    stageSelection(track, handoff);
    const rememberedScope = rememberedGenreScope();
    if (rememberedScope) {
      setGenreScope(rememberedScope);
      setGenrePrompt(null);
      setModeFeedback("Using your saved genre range");
      recommend(track, weights, mode, handoff, rememberedScope, false);
      return;
    }
    setGenreScope(null);
    setModeFeedback("Choose a genre range once; Cerum will remember it");
    setGenrePrompt({ track, handoff });
  }

  async function recommend(track, nextWeights = weights, nextMode = mode, handoff = null, nextGenreScope = genreScope || "nearby", restartPlayback = true) {
    if (nextMode === "personalized" && !user) {
      if (restartPlayback) handoff?.audio.pause();
      setAuthOpen(true);
      return;
    }
    if (restartPlayback) stageSelection(track, handoff);
    else setSelected(track);
    setLoading(true);
    setError("");
    setMixLoading(true);
    setModeFeedback(`Re-ranking by ${MODES.find((item) => item.id === nextMode)?.label || nextMode}`);
    const requestId = ++recommendationRequest.current;
    try {
      const mixPromise = getRecommendations(track.track_id, 5, nextWeights, "transition", nextGenreScope, true);
      const recommendationPromise = nextMode === "transition"
        ? mixPromise
        : getRecommendations(track.track_id, 12, nextWeights, nextMode, nextGenreScope, true);
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
      if (requestId === recommendationRequest.current) { setLoading(false); setMixLoading(false); setModeFeedback(""); }
    }
  }

  async function confirmGenreScope(nextScope) {
    const pending = genrePrompt;
    if (!pending) return;
    setGenreScope(nextScope);
    window.localStorage.setItem(GENRE_STORAGE_KEY, nextScope);
    setGenrePrompt(null);
    await recommend(pending.track, weights, mode, pending.handoff, nextScope, false);
  }

  async function chooseMode(nextMode) {
    if (nextMode === "personalized" && !user) { setAuthOpen(true); return; }
    setMode(nextMode);
    if (selected && !audioProfile && !genrePrompt) await recommend(selected, weights, nextMode, null, genreScope || "nearby", false);
  }

  async function buildBridge(start, destination, handoff) {
    handlePreviewChange(null);
    setGenrePrompt(null);
    setGenreScope("open");
    setMode("transition");
    setSelected(start);
    setRecommendations([]);
    setAudioProfile(null);
    setError("");
    setLoading(true);
    setMixLoading(true);
    setBridgeLoading(true);
    setPlaybackHandoff(handoff);
    setMixQueue([start]);
    setAutoPlayToken((token) => token + 1);
    const requestId = ++recommendationRequest.current;
    try {
      const response = await getSoundBridge(start.track_id, destination.track_id);
      if (requestId !== recommendationRequest.current) return;
      const path = response.data.recommendations || [];
      setRecommendations(path);
      setMixQueue([start, ...path]);
      if (user) getHistory().then((result) => setHistory(result.data.history)).catch(() => {});
    } catch (requestError) {
      handoff?.audio.pause();
      if (requestId !== recommendationRequest.current) return;
      setPlaybackHandoff(null);
      setMixQueue([start]);
      setError(requestError.response?.data?.detail || "Cerum could not calculate this bridge. Try a different destination song.");
    } finally {
      if (requestId === recommendationRequest.current) {
        setLoading(false);
        setMixLoading(false);
        setBridgeLoading(false);
      }
    }
  }

  async function analyze(file, title) {
    handlePreviewChange(null);
    setAnalyzing(true);
    setError("");
    try {
      const response = await analyzeUnknown(file, title, 12);
      setSelected(response.data.anchor);
      setGenreScope("nearby");
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
    setMode("similar"); setSelected(null); setRecommendations([]); setAudioProfile(null); setError(""); setGenreScope(rememberedGenreScope()); setGenrePrompt(null);
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
        <div className="header-brand-cluster">
          <a className="logo" href="#top" aria-label="Cerum home"><span>C</span><strong>Cerum</strong></a>
          <a className="home-button" href="#top" aria-label="Home">⌂</a>
        </div>
        <div className="header-search">
          <SearchBar onSelect={requestGenreChoice} onAnalyze={analyze} analyzing={analyzing} />
          {indexStatus ? <span className="search-health" title={indexStatus.building ? "Acoustic analysis updating" : "Acoustic analysis ready"}><i className={indexStatus.building ? "status-dot building" : "status-dot"} />Acoustic search</span> : null}
        </div>
        <nav className="header-links" aria-label="Primary navigation"><a href="#discover">Discover</a><a href="#mix">Mix studio</a><a href="#charts">Charts</a></nav>
        <nav className="account-nav" aria-label="Account">
          {user ? <><button className="header-button" onClick={() => setLibraryOpen(true)}>Library <span>{favorites.length}</span></button><span className="account-name">{user.display_name}</span><button className="text-button" onClick={signOut}>Sign out</button></> : <><button className="text-button" onClick={() => setAuthOpen(true)}>Sign up</button><button className="header-button" onClick={() => setAuthOpen(true)}>Log in</button></>}
        </nav>
      </motion.header>

      <div className="app-layout">
        <aside className="app-sidebar" aria-label="Cerum library and shortcuts">
          <div className="sidebar-heading"><strong>Your Library</strong><button onClick={() => user ? setLibraryOpen(true) : setAuthOpen(true)}>＋ Open</button></div>
          {user ? (
            <button className="sidebar-library-card" onClick={() => setLibraryOpen(true)}>
              <span className="sidebar-cover-grid" aria-hidden="true"><i /><i /><i /><i /></span>
              <span><strong>Saved music</strong><small>{favorites.length} favourites · {history.length} recent mixes</small></span>
            </button>
          ) : (
            <>
              <div className="sidebar-promo"><strong>Save songs you love</strong><p>Keep favourites and previous recommendations together.</p><button onClick={() => setAuthOpen(true)}>Create your library</button></div>
              <div className="sidebar-promo"><strong>Your mixes, remembered</strong><p>Sign in to let Cerum learn from what you play.</p><button onClick={() => setAuthOpen(true)}>Sign in</button></div>
            </>
          )}
          <nav className="sidebar-shortcuts" aria-label="Library shortcuts">
            <a href="#discover"><span>◉</span> Discover</a>
            <a href="#mix"><span>⇄</span> Transition Studio</a>
            <a href="#charts"><span>↗</span> Top charts</a>
          </nav>
          <div className="sidebar-legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><span>Audio previews only</span></div>
        </aside>

        <div className="app-content">
          <section className="discover-hero" id="top">
            <motion.div className="discover-copy" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 88, damping: 22 }}>
              <p className="hero-eyebrow"><span>Acoustic discovery</span>{activeMood.name}</p>
              <h1>Your next song,<br /><span>shaped by sound.</span></h1>
              <p>Search above. Cerum listens to rhythm, texture, harmony and energy, then queues five songs that belong together.</p>
              <div className="hero-actions"><a href="#discover">Start discovering</a><a href="#mix">Build a transition</a></div>
            </motion.div>
            <div className="hero-orbit" aria-hidden="true"><span>C</span><i /><i /><i /></div>
          </section>

          <section className="workspace" id="discover">
        <motion.div className="controls-card" initial={{ opacity: 0, x: 110 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .18 }} transition={{ type: "spring", stiffness: 78, damping: 20 }}>
          <div className="reference-track">
            <p className="kicker">Current song</p>
            {selected
              ? <TrackPreview track={selected} playingTrackId={playingTrackId} onPreviewChange={handlePreviewChange} onInteraction={handleInteraction} />
              : <div className="empty-current"><h2>Choose a song from search</h2><p>Playback and full-screen sine visuals begin immediately.</p></div>}
          </div>
          <div className="recommendation-actions">
            <span className="preference-label">Recommendation range</span>
            {selected ? <div className="preference-locks"><span>Vibe locked</span><button onClick={() => setGenrePrompt({ track: selected, handoff: null })}>{GENRE_LABELS[genreScope] || "Choose genre"}</button></div> : <p className="preference-placeholder">Select a song to set its genre range.</p>}
            <button className="advanced-toggle" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? "Hide match controls" : "Adjust match"}<span>{advancedOpen ? "−" : "+"}</span></button>
            <button className="primary-button" disabled={!selected || loading || Boolean(audioProfile) || !genreScope} onClick={() => recommend(selected, weights, mode, null, genreScope, false)}>{loading ? "Finding matches…" : audioProfile ? "Acoustic analysis" : genreScope ? "Recalculate" : "Choose genre first"}</button>
          </div>
          {advancedOpen ? <div className="sliders advanced-sliders">
            {Object.entries(weights).map(([name, value]) => <label key={name}><span>{weightLabels[name]}<strong>{Math.round(value * 100)}%</strong></span><input type="range" min="0" max="1" step="0.05" value={value} disabled={mode !== "similar"} onChange={(event) => updateWeight(name, event.target.value)} /></label>)}
          </div> : null}
        </motion.div>

        <motion.div className="mode-section" initial={{ opacity: 0, x: -110 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .18 }} transition={{ type: "spring", stiffness: 78, damping: 20 }}>
          <div className="section-title"><p className="kicker">Match direction</p><h2>Choose the<br />connection.</h2><button className={`personalized-mode ${mode === "personalized" ? "active" : ""}`} onClick={() => chooseMode("personalized")}>{user ? "Use my listening history" : "Sign in for personal picks"} →</button></div>
          <div className="mode-selector">
            {MODES.map((item, index) => <motion.button key={item.id} className={mode === item.id ? "active" : ""} aria-pressed={mode === item.id} onClick={() => chooseMode(item.id)} whileHover={{ y: -4 }} whileTap={{ scale: .98 }}><em>{String(index + 1).padStart(2, "0")}</em><strong>{item.label}</strong><span>{item.description}</span></motion.button>)}
          </div>
          <p className="mode-feedback" role="status" aria-live="polite">{modeFeedback}</p>
        </motion.div>

        {mode === "transition" && selected && <div className="transition-explainer"><strong>Your starting song is track 01.</strong><span>Cerum chooses five playable follow-ups in order. Every handoff is scored against the song immediately before it, while the original sound keeps the sequence from drifting.</span></div>}

        {error && <div className="notice error" role="alert">{error}</div>}
        {!error && !selected && <div className="notice">{hostedApiEnabled ? "Search the hosted acoustic catalogue above. Cerum ranks measured sound first, then applies its own microgenre compatibility guardrail—not an Apple or Spotify recommendation score." : "Search the catalogue above. Cerum transiently analyzes an available preview; for a missing or unavailable song, upload audio you are allowed to use. Raw audio is not retained."}</div>}
        {audioProfile && <><p className="acoustic-signature">{audioProfile.acoustic_signature}</p><div className="audio-profile"><div><span>tempo</span><strong>{audioProfile.bpm} BPM</strong></div><div><span>texture</span><strong>{audioProfile.texture}</strong></div><div><span>rhythm</span><strong>{audioProfile.rhythm_character}</strong></div><div><span>harmony</span><strong>{audioProfile.harmonic_character}</strong></div><div><span>intensity</span><strong>{audioProfile.intensity}</strong></div><div><span>aggression</span><strong>{Math.round(audioProfile.aggression * 100)}%</strong></div></div></>}

        <motion.div className="results-heading" initial={{ opacity: 0, x: -90 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .3 }} transition={{ type: "spring", stiffness: 80, damping: 20 }}><div><p className="kicker">{mode === "transition" ? "Ordered transition path" : "Made for this signal"}</p><h2>{recommendations.length ? (mode === "transition" ? `${recommendations.length + 1}-song continuous run` : `${recommendations.length} songs that fit`) : "Recommendations appear here."}</h2></div>{scoreMode && <p>{scoreMode === "acoustic-transition" ? "tempo · key · energy · texture" : "Acoustic match · vibe locked"}</p>}</motion.div>
        <div className={`recommendation-grid ${mode === "transition" ? "transition-grid" : ""}`}>
          {recommendations.map((rec, index) => <RecommendationCard key={rec.track_id} rec={rec} rank={index + 1} onClick={(track) => { handleInteraction(track, "selected"); requestGenreChoice(track); }} playingTrackId={playingTrackId} onPreviewChange={handlePreviewChange} isFavorite={favoriteIds.has(rec.track_id)} onToggleFavorite={toggleFavorite} onInteraction={handleInteraction} onDismiss={dismissRecommendation} />)}
        </div>
          </section>

          <section className="secondary-experiences" id="mix">
            <header className="secondary-heading"><div><p className="kicker">Transition Studio</p><h2>Build a deliberate journey.</h2></div><p>Start and finish anywhere. Cerum finds three playable handoffs between the songs.</p></header>
            <div className="secondary-grid">
              <SoundBridge building={bridgeLoading} onBuild={buildBridge} />
              <div id="charts"><ChartsPanel onSelect={requestGenreChoice} onPreviewChange={handlePreviewChange} onInteraction={handleInteraction} /></div>
            </div>
          </section>

          <footer><span>Cerum · Acoustic scoring with fine-style guardrails · Raw audio is not retained</span><nav aria-label="Legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav></footer>
        </div>
      </div>
      <GenreGate track={genrePrompt?.track} onChoose={confirmGenreScope} onCancel={() => setGenrePrompt(null)} />
      <AuthPanel open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} />
      <LibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} favorites={favorites} history={history} onRemoveFavorite={async (id) => { await removeFavorite(id); refreshLibrary(); }} onClearHistory={eraseHistory} onChooseFavorite={requestGenreChoice} />
      <MixPlayer queue={mixQueue} loading={mixLoading} autoPlayToken={autoPlayToken} playbackHandoff={playbackHandoff} externalPlayingTrackId={playingTrackId} palette={activeMood.colors} onTrackChange={handleMixTrackChange} onInteraction={handleInteraction} />
    </main>
  );
}
