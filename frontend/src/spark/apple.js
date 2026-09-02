// Apple's documented browser Search API uses JSONP; no paid key or proxy is needed.
let serial = 0;
const cache = new Map();
const requestTimes = [];

export function appleSearch(query, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached?.until > Date.now()) return Promise.resolve(cached.rows);
  while (requestTimes.length && requestTimes[0] < Date.now() - 60_000) requestTimes.shift();
  if (requestTimes.length >= 15) return Promise.reject(new Error("Global search is cooling down. Try again in a minute."));
  requestTimes.push(Date.now());
  return new Promise((resolve, reject) => {
    const callback = `cerumApple${++serial}`;
    const script = document.createElement("script");
    const cleanup = () => {
      clearTimeout(timer); script.remove(); signal?.removeEventListener("abort", abort);
      // A cancelled JSONP response may arrive late; leave a harmless callback briefly.
      window[callback] = () => {};
      setTimeout(() => { delete window[callback]; }, 60_000);
    };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Global music search did not answer. Local songs are still available.")); }, 6_000);
    window[callback] = (data) => {
      cleanup();
      const rows = (data.results ?? []).filter((row) => row.trackId && row.trackName && row.artistName && row.previewUrl).map((row) => ({
        track_id: `apple-${row.trackId}`, title: row.trackName, artist: row.artistName, album: row.collectionName ?? "",
        year: Number(String(row.releaseDate).slice(0, 4)) || null, artwork_url: row.artworkUrl100 ?? "",
        preview_url: row.previewUrl, external_url: row.trackViewUrl ?? "", source: "Apple Music", seed_genre: null,
        provider_genre: row.primaryGenreName ?? null, provider_subgenre: row.primaryGenreName ?? null,
      }));
      cache.set(key, { rows, until: Date.now() + 10 * 60_000 });
      if (cache.size > 40) cache.delete(cache.keys().next().value);
      resolve(rows);
    };
    script.onerror = () => { cleanup(); reject(new Error("Global search is temporarily unavailable.")); };
    const params = new URLSearchParams({ term: query.slice(0, 200), country: "US", media: "music", entity: "song", limit: "40", callback });
    script.src = `https://itunes.apple.com/search?${params}`;
    signal?.addEventListener("abort", abort, { once: true });
    document.head.append(script);
  });
}
