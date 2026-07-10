import { useState } from "react";

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(q) {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `http://localhost:8000/api/tracks?q=${encodeURIComponent(q)}&page_size=8`
      );
      const data = await res.json();
      setResults(data.results || []);
    } catch { setResults([]); }
    setLoading(false);
  }

  function select(track) {
    setQuery(`${track.title} — ${track.artist}`);
    setResults([]);
    onSelect(track);
  }

  return (
    <div className="relative w-full max-w-xl mx-auto">
      <input
        className="w-full px-4 py-3 rounded-xl border border-gray-200 
                   bg-white shadow-sm text-sm focus:outline-none 
                   focus:ring-2 focus:ring-indigo-300"
        placeholder="Search by song title or artist..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
      />
      {loading && (
        <div className="absolute right-4 top-3.5 text-xs text-gray-400">
          searching...
        </div>
      )}
      {results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border 
                        border-gray-100 rounded-xl shadow-lg overflow-hidden">
          {results.map((t) => (
            <div
              key={t.track_id}
              className="px-4 py-2.5 hover:bg-indigo-50 cursor-pointer 
                         border-b border-gray-50 last:border-0"
              onClick={() => select(t)}
            >
              <div className="text-sm font-medium text-gray-800">{t.title}</div>
              <div className="text-xs text-gray-400">
                {t.artist} · {t.genre} · {t.year}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}