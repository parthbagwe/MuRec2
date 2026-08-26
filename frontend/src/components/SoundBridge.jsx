import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { hostedApiEnabled, searchTracks } from "../api";

function BridgeTrackSearch({ label, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const selectedLabel = selected ? `${selected.title} — ${selected.artist}` : "";

  useEffect(() => {
    if (selectedLabel) setQuery(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    if (selectedLabel && query === selectedLabel) return undefined;
    if (query.trim().length < 2) {
      setResults([]);
      setError("");
      return undefined;
    }
    const currentId = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await searchTracks(query.trim(), "", 1);
        if (currentId === requestId.current) setResults((response.data.results || []).slice(0, 6));
      } catch {
        if (currentId === requestId.current) setError(hostedApiEnabled ? "Music service unavailable" : "Start the local API first");
      } finally {
        if (currentId === requestId.current) setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, selectedLabel]);

  function choose(track) {
    onSelect(track);
    setQuery(`${track.title} — ${track.artist}`);
    setResults([]);
    setError("");
  }

  return (
    <label className="bridge-search">
      <span>{label}</span>
      <input
        value={query}
        placeholder={label === "Start" ? "First song" : "Final song"}
        onChange={(event) => { setQuery(event.target.value); onSelect(null); }}
        aria-label={`${label} song for Sound Bridge`}
        autoComplete="off"
      />
      {loading ? <small>Searching</small> : null}
      <AnimatePresence>
        {results.length || error ? (
          <motion.div className="bridge-results" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {results.map((track) => (
              <button key={track.track_id} type="button" onClick={() => choose(track)} disabled={!track.preview_url}>
                <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                <em>{track.preview_url ? `${Math.round(track.bpm || 0) || "—"} BPM` : "No preview"}</em>
              </button>
            ))}
            {error ? <p>{error}</p> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </label>
  );
}

function preparePlayback(track) {
  if (!track?.preview_url) return null;
  const audio = new Audio(track.preview_url);
  audio.preload = "auto";
  const playPromise = audio.play();
  playPromise.catch(() => {});
  return { trackId: track.track_id, audio, playPromise, token: Date.now() };
}

export default function SoundBridge({ building, onBuild }) {
  const [start, setStart] = useState(null);
  const [destination, setDestination] = useState(null);
  const sameTrack = start?.track_id && start.track_id === destination?.track_id;

  function submit(event) {
    event.preventDefault();
    if (!start || !destination || sameTrack || building) return;
    onBuild(start, destination, preparePlayback(start));
  }

  return (
    <motion.form className="sound-bridge" onSubmit={submit} initial={{ opacity: 0, x: -90 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 88, damping: 21 }}>
      <div className="bridge-heading">
        <p className="kicker">01 / Sound Bridge</p>
        <h1>Build a five-song path.</h1>
        <p>Choose where the mix begins and where it should land. Cerum calculates the three playable handoffs between them.</p>
      </div>

      <div className="bridge-fields">
        <BridgeTrackSearch label="Start" selected={start} onSelect={setStart} />
        <button
          className="bridge-swap"
          type="button"
          aria-label="Swap starting and final songs"
          onClick={() => { const previous = start; setStart(destination); setDestination(previous); }}
          disabled={!start && !destination}
        >
          ⇄
        </button>
        <BridgeTrackSearch label="Finish" selected={destination} onSelect={setDestination} />
      </div>

      <div className="bridge-route" aria-hidden="true">
        <span>01</span><i /><b /><i /><b /><i /><span>05</span>
      </div>

      <div className="bridge-action">
        <span>{sameTrack ? "Choose two different songs" : "Tempo · key · energy · timbre"}</span>
        <button className="primary-button" type="submit" disabled={!start || !destination || sameTrack || building}>
          {building ? "Calculating path…" : "Build and play"}
        </button>
      </div>
    </motion.form>
  );
}
