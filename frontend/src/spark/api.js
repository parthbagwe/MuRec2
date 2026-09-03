import { musicRequest } from "./workerClient.js";
import { appleSearch } from "./apple.js";
import { createAccount, currentAccount, loginAccount, logoutAccount, loadFavorites, loadHistory, saveFavorite,
  deleteFavorite, deleteHistory, saveEvent, preferences, saveRecommendation, storageWarning } from "./firebase.js";

export const hostedApiEnabled = true;
export const accountProviders = ['firebase'];
export const defaultAccountProvider = 'firebase';
const response = async (promise) => {
  try { return { data: await promise }; }
  catch (error) {
    const message = error.code === "auth/invalid-credential" ? "Email or password is incorrect. Firebase accounts are separate from the original Cerum site."
      : error.code === "auth/email-already-in-use" ? "An account already exists for this email. Please sign in."
      : error.code === "auth/operation-not-allowed" ? "Email sign-in must be enabled in this Firebase project first."
      : error.code === "permission-denied" ? "Firebase could not save your library. Please sign in again or check the security rules."
      : error.message;
    error.response = { data: { detail: message } };
    throw error;
  }
};

export const searchTracks = (q, genre, page = 1, options = {}) => response((async () => {
  const local = await musicRequest("tracks", { q, genre, page }, options);
  // Exact/strong local matches return immediately; only broaden searches when needed.
  if (page !== 1 || local.best_score >= 90 || q.trim().length < 3) return local;
  try {
    const tracks = await appleSearch(local.corrected_query || q, options);
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    await musicRequest("addTracks", { tracks }, options);
    return await musicRequest("tracks", { q, genre, page }, options);
  } catch (error) {
    if (options.signal?.aborted || !local.results.length) throw error;
    return local;
  }
})());

export const getTrack = (track_id) => response(musicRequest("track", { track_id }));
async function recommend(action, input) {
  let prefs;
  try { prefs = await preferences(); }
  catch (error) { if (input.mode === "personalized") throw error; storageWarning(); }
  const result = await musicRequest(action, { ...input, preferences: prefs });
  // A library outage must not stop the mix or delay the next song.
  saveRecommendation(result, input.mode ?? "transition", prefs?.uid).then(() => {
    if (prefs?.uid) window.dispatchEvent(new Event("cerum-history-saved"));
  }).catch(storageWarning);
  return result;
}
export const getRecommendations = (track_id, k = 10, weights = null, mode = "similar", genre_scope = "nearby", vibe_lock = true, liveAnchor = null) => response(
  recommend("recommend", { track_id, k, weights, mode, genre_scope, vibe_lock,
    ...(liveAnchor ? { anchor_track: liveAnchor.track, anchor_analysis: liveAnchor.analysis } : {}) }));
export const getSoundBridge = (track_id, destination_track_id) => response(recommend("bridge", { track_id, destination_track_id }));
export const getSimilar = (track_id, k = 10) => getRecommendations(track_id, k);
export const getGenres = () => response(musicRequest("genres"));
let manifestPromise;
const manifest = () => manifestPromise ??= fetch("/catalogue/manifest.json").then((res) => {
  if (!res.ok) throw new Error("The catalogue summary is unavailable.");
  return res.json();
}).catch((error) => { manifestPromise = null; throw error; });
// A landing-page visit needs only a tiny summary, not the full acoustic corpus.
export const getAcousticStatus = () => response(manifest().then((info) => ({ indexed: info.indexed, total: info.total,
  remaining: info.total - info.indexed, failures: 0, building: false })));
export const getLyricStatus = () => response(manifest().then((info) => ({ analyzed: info.lyrics_analyzed, total: info.total,
  provider_configured: false, stores_raw_lyrics: false })));
export const getCharts = (country = "us") => response((async () => {
  const region = country === "in" ? "in" : "us";
  const res = await fetch(`/catalogue/charts-${region}.json`);
  if (!res.ok) throw new Error("The chart snapshot is unavailable. Search is still ready.");
  const chart = await res.json();
  return { ...chart, snapshot: true, stale: true, fallback: false,
    tracks: chart.tracks.map((track, i) => ({ ...track, chart_rank: i + 1, catalogued: true })) };
})());
export const analyzeUnknown = () => response(Promise.reject(new Error("Search for a song to analyse its preview. Audio uploads are available in the original desktop version.")));
export const register = (name, email, password) => response(createAccount(name, email, password));
export const login = (email, password) => response(loginAccount(email, password));
export const logout = () => response(logoutAccount());
export const getMe = () => response(currentAccount().then((user) => ({ user })));
export const getFavorites = () => response(loadFavorites().then(async (tracks) => ({ favorites: await musicRequest("hydrate", { tracks }) })));
export const addFavorite = (track_id) => response((async () => {
  const uid = (await currentAccount())?.id;
  if (!uid) throw new Error("Sign in to save favourites.");
  const track = await musicRequest("track", { track_id });
  await saveFavorite(track, uid);
  return { favorite: track };
})());
export const removeFavorite = (track_id) => response(deleteFavorite(track_id));
export const getHistory = () => response(loadHistory().then((history) => ({ history })));
export const clearHistory = () => response(deleteHistory());
export const recordEvent = (track_id, event_type) => response(saveEvent(track_id, event_type));
