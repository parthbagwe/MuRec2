import { useEffect, useRef, useState } from "react";
import { searchTracks } from "../api";

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const currentId = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchTracks(query.trim(), "", 1);
        if (currentId === requestId.current) setResults(response.data.results || []);
      } catch {
        if (currentId === requestId.current) setResults([]);
      } finally {
        if (currentId === requestId.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  function select(track) {
    setQuery(`${track.title} — ${track.artist}`);
    setResults([]);
    onSelect(track);
  }

  return (
    <div className="search-wrap">
      <span className="search-icon">⌕</span>
      <input aria-label="Search songs" placeholder="Search a song or artist…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {loading && <span className="search-status">searching</span>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((track) => (
            <button key={track.track_id} onClick={() => select(track)}>
              <span><strong>{track.title}</strong><small>{track.artist} · {track.genre}</small></span>
              <em>{track.year}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
