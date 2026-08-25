import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getCharts } from "../api";

const REGIONS = [{ id: "in", label: "India" }, { id: "us", label: "USA" }];

function PlayIcon({ playing }) {
  return playing
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
}

export default function ChartsPanel({ onSelect, onPreviewChange, onInteraction }) {
  const [region, setRegion] = useState("in");
  const [charts, setCharts] = useState({});
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (charts[region]) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    async function loadCharts() {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await getCharts(region);
          if (active) setCharts((current) => ({ ...current, [region]: response.data.tracks }));
          return;
        } catch {
          if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }
      }
      if (active) setError("The live chart feed did not answer.");
    }
    loadCharts().finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [region, charts, retryToken]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const tracks = charts[region] || [];
  const visible = expanded ? tracks : tracks.slice(0, 8);

  async function togglePreview(track) {
    if (!track.preview_url) return;
    if (playingId === track.track_id) {
      audioRef.current?.pause();
      setPlayingId(null);
      onPreviewChange(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(track.preview_url);
    audioRef.current = audio;
    setPlayingId(track.track_id);
    onPreviewChange(track);
    audio.onended = () => { setPlayingId(null); onPreviewChange(null); onInteraction(track, "preview_completed"); };
    try { await audio.play(); onInteraction(track, "preview_started"); }
    catch { setPlayingId(null); onPreviewChange(null); }
  }

  function choose(track) {
    if (!track.catalogued) return;
    audioRef.current?.pause();
    setPlayingId(null);
    onPreviewChange(null);
    onInteraction(track, "selected");
    onSelect(track);
  }

  return (
    <motion.section className={`charts-panel ${error ? "has-error" : ""} ${loading && !tracks.length ? "is-loading" : ""}`} initial={{ opacity: 0, x: 90 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 90, damping: 22, delay: .08 }} aria-labelledby="charts-title">
      <header className="charts-header">
        <div><p className="kicker">Live chart pulse</p><h2 id="charts-title">Top 50</h2></div>
        <div className="chart-tabs" role="tablist" aria-label="Country chart">
          {REGIONS.map((item) => <button key={item.id} role="tab" aria-selected={region === item.id} className={region === item.id ? "active" : ""} onClick={() => { setRegion(item.id); setExpanded(false); }}>{item.label}</button>)}
        </div>
      </header>
      <div className="chart-list-shell">
        {loading && !tracks.length && <p className="chart-state loading">Loading today’s songs…<span aria-hidden="true" /></p>}
        {error && (
          <motion.div className="chart-state error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
            <span>Feed temporarily quiet</span>
            <strong>{error}</strong>
            <p>Search and instant playback are still ready.</p>
            <button onClick={() => setRetryToken((value) => value + 1)}>Retry live charts ↗</button>
          </motion.div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.ol key={`${region}-${expanded}`} className="chart-list" initial={{ opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -36 }} transition={{ duration: .35, ease: [0.22, 1, 0.36, 1] }}>
            {visible.map((track) => (
              <li key={track.track_id}>
                <span className="chart-rank">{String(track.chart_rank).padStart(2, "0")}</span>
                {track.artwork_url ? <img src={track.artwork_url} alt="" /> : <span className="chart-artwork">{track.title.slice(0, 1)}</span>}
                <button className="chart-track" onClick={() => choose(track)} disabled={!track.catalogued} title={track.catalogued ? "Build a Cerum mix from this song" : "Preview available; acoustic analysis pending"}>
                  <strong>{track.title}</strong><small>{track.artist}</small>
                </button>
                <button className="chart-preview" onClick={() => togglePreview(track)} disabled={!track.preview_url} aria-label={`${playingId === track.track_id ? "Pause" : "Preview"} ${track.title}`}><PlayIcon playing={playingId === track.track_id} /></button>
              </li>
            ))}
          </motion.ol>
        </AnimatePresence>
      </div>
      {tracks.length > 8 && <button className="chart-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse chart" : `View all ${tracks.length}`} <span>{expanded ? "↑" : "↓"}</span></button>}
      <small className="chart-source">Current chart positions from Apple Music’s public RSS feed · recommendations remain Cerum acoustic scores</small>
    </motion.section>
  );
}
