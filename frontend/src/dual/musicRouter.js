export function createMusicRouter({ primary, remote, now = Date.now }) {
  let unavailableUntil = 0;
  return async (action, payload, fallback, options = {}) => {
    options.signal?.throwIfAborted();
    if (primary === 'supabase' && now() >= unavailableUntil) {
      try { return await remote(action, payload, options); }
      catch (error) {
        options.signal?.throwIfAborted();
        if (error.name === 'AbortError') throw error;
        unavailableUntil = now() + (error.status === 402 ? 300_000 : 60_000);
      }
    }
    return fallback();
  };
}
