// Explicit preferences are isolated by authenticated provider + user ID.
// Guests keep device-local feedback; it is never adopted by a signed-in account.
export const FEEDBACK = {
  more_like_this: { label: 'More like this', event: 'liked', value: 2 },
  too_sad: { label: 'Too sad', event: 'disliked', value: -2 },
  too_different: { label: 'Too different', event: 'disliked', value: -3 },
};
const key = (accountKey) => `cerum.feedback.v1:${accountKey || 'guest'}`;
const volatileFeedback = new Map();
export function readFeedback(accountKey, storage) {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(key(accountKey));
    if (!raw) return volatileFeedback.get(key(accountKey)) || [];
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows.filter((r) => r?.track_id && FEEDBACK[r.reason]).slice(0, 100) : [];
  } catch { return volatileFeedback.get(key(accountKey)) || []; }
}
export function saveFeedback(accountKey, trackId, reason, storage) {
  if (!FEEDBACK[reason]) throw new Error('Choose a feedback reason.');
  const row = { track_id: String(trackId), reason, created_at: new Date().toISOString() };
  const rows = [row, ...readFeedback(accountKey, storage).filter((old) => old.track_id !== row.track_id)].slice(0, 100);
  volatileFeedback.set(key(accountKey), rows);
  let persisted = false;
  try {
    const target = storage ?? globalThis.localStorage;
    if (target) { target.setItem(key(accountKey), JSON.stringify(rows)); persisted = true; }
  } catch { /* applies for this session when storage is blocked */ }
  return { rows, persisted };
}
export function combinedFeedback(local = [], interactions = []) {
  const seen = new Set();
  return [...local, ...interactions.map((r) => ({ track_id: String(r.track_id),
    reason: r.value === -2 ? 'too_sad' : r.value === -3 ? 'too_different' : r.value === 2 ? 'more_like_this' : null }))]
    .filter((r) => r.reason && !seen.has(String(r.track_id)) && seen.add(String(r.track_id))).slice(0, 100);
}
