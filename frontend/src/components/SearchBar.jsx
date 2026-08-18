import { useEffect, useRef, useState } from "react";
import { hostedApiEnabled, searchTracks } from "../api";

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
          setSearchError(hostedApiEnabled ? "Cerum cannot reach the hosted music service. Try again shortly." : "Cerum cannot reach the API. Make sure start-backend.cmd is running.");
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
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m20 20-4.6-4.6m2.5-5.4a7.9 7.9 0 1 1-15.8 0 7.9 7.9 0 0 1 15.8 0Z" /></svg>
      <input aria-label="Search songs" placeholder="Search a song or artist…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {loading && <span className="search-status">searching</span>}
      {(results.length > 0 || searched || searchError) && (
        <div className="search-results">
          {results.map((track) => (
            <button key={track.track_id} onClick={() => select(track)}>
              <span><strong>{track.title}</strong><small>{track.artist} · {track.subgenre || "audio analysis pending"}</small></span>
              <em>{track.year}</em>
            </button>
          ))}
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
