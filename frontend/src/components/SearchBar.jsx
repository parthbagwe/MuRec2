import { useEffect, useRef, useState } from "react";
import { hostedApiEnabled, searchTracks } from "../api";

export default function SearchBar({ onSelect, onAnalyze, analyzing }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const requestId = useRef(0);
  const suppressSearch = useRef(false);
  const preparedAudio = useRef(null);

  useEffect(() => {
    if (suppressSearch.current) {
      suppressSearch.current = false;
      return undefined;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setSearchError("");
      return undefined;
    }
    const currentId = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const response = await searchTracks(query.trim(), "", 1);
        if (currentId === requestId.current) {
          setResults(response.data.results || []);
          setSearched(true);
        }
      } catch {
        if (currentId === requestId.current) {
          setResults([]);
          setSearched(false);
          setSearchError(hostedApiEnabled ? "Cerum cannot reach the hosted music service. Try again shortly." : "Cerum cannot reach the API. Make sure start-backend.cmd is running.");
        }
      } finally {
        if (currentId === requestId.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const track = results[0];
    if (!track?.preview_url) return undefined;
    const prepared = {
      trackId: track.track_id,
      audio: new Audio(track.preview_url),
      adopted: false,
    };
    prepared.audio.preload = "auto";
    prepared.audio.load();
    preparedAudio.current = prepared;
    return () => {
      if (preparedAudio.current === prepared) preparedAudio.current = null;
      if (prepared.adopted) return;
      prepared.audio.pause();
      prepared.audio.removeAttribute("src");
      prepared.audio.load();
    };
  }, [results]);

  function select(track) {
    let playbackHandoff = null;
    if (track.preview_url) {
      let prepared = preparedAudio.current;
      if (!prepared || prepared.trackId !== track.track_id) {
        prepared = { trackId: track.track_id, audio: new Audio(track.preview_url), adopted: false };
        prepared.audio.preload = "auto";
      }
      prepared.adopted = true;
      preparedAudio.current = null;
      const playPromise = prepared.audio.play();
      playPromise.catch(() => {});
      playbackHandoff = { trackId: track.track_id, audio: prepared.audio, playPromise, token: Date.now() };
    }
    suppressSearch.current = true;
    setQuery(`${track.title} — ${track.artist}`);
    setResults([]);
    setSearched(false);
    setSearchError("");
    onSelect(track, playbackHandoff);
  }

  function clearSearch() {
    requestId.current += 1;
    setQuery("");
    setResults([]);
    setSearched(false);
    setSearchError("");
    setShowAll(false);
  }

  async function upload(file) {
    const succeeded = await onAnalyze(file, query);
    if (succeeded) {
      setResults([]);
      setSearched(false);
    }
  }

  return (
    <div className="search-wrap">
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m20 20-4.6-4.6m2.5-5.4a7.9 7.9 0 1 1-15.8 0 7.9 7.9 0 0 1 15.8 0Z" /></svg>
      <input
        aria-label="Search songs"
        placeholder="Search a song or artist…"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setShowAll(false); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && results[0]) {
            event.preventDefault();
            select(results[0]);
          }
        }}
      />
      {loading && <span className="search-status">searching</span>}
      {!loading && query ? <button className="search-clear" type="button" onClick={clearSearch} aria-label="Clear song search">×</button> : null}
      {(results.length > 0 || searched || searchError) && (
        <div className="search-results">
          {results.length ? <div className="search-results-label"><span>Best matches</span><small>Enter selects the first result</small></div> : null}
          {(showAll ? results : results.slice(0, 8)).map((track) => (
            <button key={track.track_id} onClick={() => select(track)}>
              {track.artwork_url ? <img src={track.artwork_url} alt="" /> : <span className="search-artwork">{track.title.slice(0, 1)}</span>}
              <span><strong>{track.title}</strong><small>{track.artist} · {track.provider_genre || "Genre pending"}</small></span>
              <em>{track.year}</em>
            </button>
          ))}
          {results.length > 8 ? <button className="search-more" type="button" onClick={() => setShowAll((open) => !open)}>{showAll ? "Show fewer results" : `Show all ${results.length} results`}<span>{showAll ? "↑" : "↓"}</span></button> : null}
          {searchError && <div className="search-message error">{searchError}</div>}
          {!searchError && searched && results.length === 0 && (
            <div className="unknown-song">
              <strong>No catalogue match for “{query}”</strong>
              {hostedApiEnabled ? (
                <small>Try the artist name or another spelling. Audio-file analysis remains available in the local Cerum desktop version.</small>
              ) : (
                <>
                  <small>Upload a clip or song file. Cerum will measure its tempo, timbre, frequency spectrum, MFCCs and key, then find acoustic matches. The audio is not retained.</small>
                  <label className="upload-action">
                    {analyzing ? "Analyzing audio…" : "Choose audio file"}
                    <input
                      type="file"
                      accept="audio/wav,audio/mpeg,audio/flac,audio/ogg,audio/mp4,audio/aac,.m4a"
                      disabled={analyzing}
                      onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}
                    />
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
