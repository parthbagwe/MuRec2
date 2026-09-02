// Only public, read-only responses may enter this bounded, per-tab cache.
const PUBLIC_TTLS = { tracks: 120_000, track: 300_000, genres: 300_000, charts: 300_000, acousticStatus: 60_000, lyricStatus: 60_000 };
const QUOTA_MESSAGE = "Search and recommendations are unavailable because Cerum’s hosting bandwidth limit has been reached. The site owner needs to restore service; changing your search will not fix it.";

export function createHostedRequests(invoke, { now = Date.now, maxEntries = 50 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let restrictedUntil = 0;

  function requestError(message, status) {
    const error = new Error(message);
    error.response = { status, data: { detail: message } };
    return error;
  }

  return async function edge(action, payload = {}, { signal } = {}) {
    signal?.throwIfAborted();
    const ttl = PUBLIC_TTLS[action] || 0;
    const key = JSON.stringify([action, payload]);
    const hit = cache.get(key);
    if (hit && now() < hit.expiresAt) return structuredClone(hit.value);
    cache.delete(key);
    if (now() < restrictedUntil) throw requestError(QUOTA_MESSAGE, 402);
    // Cancellable typeahead requests must not share another caller's signal.
    if (ttl && !signal && pending.has(key)) return structuredClone(await pending.get(key));

    const request = (async () => {
      const { data, error } = await invoke("murec2-api", { body: { action, ...payload }, signal });
      signal?.throwIfAborted();
      if (error) {
        let message = error.message || "The hosted music service is unavailable.";
        const status = error.context?.status;
        try {
          const body = await error.context?.json();
          message = body?.detail || body?.message || message;
        } catch { /* Network/CORS failures may not expose a response body. */ }
        if (status === 402 && /exceed_egress_quota/.test(message)) {
          restrictedUntil = now() + 60_000;
          message = QUOTA_MESSAGE;
        }
        throw requestError(message, status);
      }
      const value = { data };
      // An active local index must stay observable; never memoize its progress.
      if (ttl && !(action === "acousticStatus" && data?.building)) {
        cache.delete(key);
        cache.set(key, { value: structuredClone(value), expiresAt: now() + ttl });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return value;
    })();
    if (ttl && !signal) pending.set(key, request);
    try { return await request; }
    finally { if (pending.get(key) === request) pending.delete(key); }
  };
}
