import { useEffect, useRef, useState } from "react";
import { searchTracks } from "../api";

export default function SearchBar({ onSelect, onAnalyze, analyzing }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const requestId = useRef(0);
  const suppressSearch = useRef(false);

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
          setSearchError("MuRec2 cannot reach the API. Make sure start-backend.cmd is running.");
        }
      } finally {
        if (currentId === requestId.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  function select(track) {
    suppressSearch.current = true;
    setQuery(`${track.title} — ${track.artist}`);
    setResults([]);
    setSearched(false);
    setSearchError("");
    onSelect(track);
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
      <span className="search-icon">⌕</span>
      <input aria-label="Search songs" placeholder="Search a song or artist…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {loading && <span className="search-status">searching</span>}
      {(results.length > 0 || searched || searchError) && (
        <div className="search-results">
          {results.map((track) => (
            <button key={track.track_id} onClick={() => select(track)}>
              <span><strong>{track.title}</strong><small>{track.artist} · {track.genre}</small></span>
              <em>{track.year}</em>
            </button>
          ))}
          {searchError && <div className="search-message error">{searchError}</div>}
          {!searchError && searched && results.length === 0 && (
            <div className="unknown-song">
              <strong>No catalogue match for “{query}”</strong>
              <small>Upload a clip or song file. MuRec2 will measure its tempo, timbre, frequency spectrum, MFCCs and key, then find acoustic matches. The audio is not retained.</small>
              <label className="upload-action">
                {analyzing ? "Analyzing audio…" : "Choose audio file"}
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/flac,audio/ogg,audio/mp4,audio/aac,.m4a"
                  disabled={analyzing}
                  onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
