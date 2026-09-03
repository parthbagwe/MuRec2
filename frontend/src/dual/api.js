import * as browserMusic from '../spark/api.js';
import * as firebase from '../spark/firebase.js';
import * as legacy from './supabaseLibrary.js';
import { musicRequest } from '../spark/workerClient.js';
import { createSessions } from './session.js';
import { createMusicRouter } from './musicRouter.js';

export const hostedApiEnabled = true;
export const accountProviders = ['firebase', 'supabase'];
export const defaultAccountProvider = import.meta.env.VITE_CERUM_PRIMARY_PROVIDER === 'supabase' ? 'supabase' : 'firebase';
let storage;
try { storage = window.localStorage; } catch { /* optional preference */ }
const sessions = createSessions({ firebase: { current: firebase.currentAccount, login: firebase.loginAccount,
  register: firebase.createAccount, logout: firebase.logoutAccount }, supabase: legacy }, storage);
const response = async (promise) => {
  try { return { data: await promise }; }
  catch (error) {
    let message = error.message || 'The service is unavailable. Please try again.';
    if (error.code?.startsWith('auth/')) message = error.code === 'auth/email-already-in-use'
      ? 'This Firebase account already exists. Use Sign in.'
      : error.code === 'auth/invalid-credential' ? 'Check your email, password and selected account service.'
        : `Firebase could not complete sign-in (${error.code}). Please try again.`;
    if (/exceed_egress_quota/i.test(message)) message = 'Supabase is temporarily limited. Your old account and saved music remain there. Firebase accounts are separate.';
    error.response = { data: { detail: message } };
    throw error;
  }
};
export function storageWarning() { window.dispatchEvent(new CustomEvent('cerum-storage-warning', { detail:
  'Music can keep playing, but your account service could not sync the library. Nothing was moved to the other service.' })); }
const guard = (session) => sessions.assert(session);
const required = async () => { const session = await sessions.capture(); if (!session) throw new Error('Sign in to save your library.'); return session; };
async function privateOperation(callback) { const session = await required(); await guard(session); const result = await callback(session); await guard(session); preferenceCache = null; return result; }
const favRows = (s) => s.provider === 'firebase' ? firebase.loadFavorites(s.uid) : legacy.favorites(s.uid);
const historyRows = (s) => s.provider === 'firebase' ? firebase.loadHistory(s.uid) : legacy.history(s.uid);
export const getMe = () => response(sessions.current().then((user) => ({ user })));
export const register = (name, email, password, provider = defaultAccountProvider) => response(sessions.register(provider, name, email, password));
export const login = (email, password, provider = defaultAccountProvider) => response(sessions.login(provider, email, password));
export const logout = () => response(sessions.logout());
export const getFavorites = () => response(privateOperation(async (s) => ({ favorites: await musicRequest('hydrate', { tracks: await favRows(s) }) })));
export const getHistory = () => response(privateOperation(async (s) => ({ history: await historyRows(s) })));
export const addFavorite = (track_id) => response(privateOperation(async (s) => {
  const track = (await getTrack(track_id)).data;
  await guard(s);
  if (s.provider === 'firebase') await firebase.saveFavorite(track, s.uid);
  else await legacy.saveFavorite(s.uid, track);
  return { favorite: track };
}));
export const removeFavorite = (id) => response(privateOperation((s) => s.provider === 'firebase'
  ? firebase.deleteFavorite(id, s.uid) : legacy.removeFavorite(s.uid, id)));
export const clearHistory = () => response(privateOperation((s) => s.provider === 'firebase'
  ? firebase.deleteHistory(s.uid) : legacy.clearHistory(s.uid)));
export const recordEvent = (id, event) => response(privateOperation((s) => {
  if (!['preview_completed', 'youtube_opened', 'liked', 'disliked', 'dismissed'].includes(event)) return;
  return s.provider === 'firebase' ? firebase.saveEvent(id, event, s.uid) : legacy.recordEvent(s.uid, id, event);
}));

// Public music requests NEVER attach either provider's user token or private preferences.
async function remote(action, payload, { signal } = {}) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured.');
  const timeout = AbortSignal.timeout(action === 'tracks' ? 6000 : 15_000);
  const result = await fetch(`${url}/functions/v1/murec2-api`, { method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, body: JSON.stringify({ action, ...payload }) });
  if (!result.ok) throw Object.assign(new Error('Public music service is unavailable.'), { status: result.status });
  const data = await result.json();
  if (action === 'tracks' && !Array.isArray(data.results)) throw new Error('Invalid search response');
  if (['recommend', 'bridge'].includes(action) && (!data.anchor || !Array.isArray(data.recommendations))) throw new Error('Invalid recommendation response');
  return { data };
}
const route = createMusicRouter({ primary: defaultAccountProvider, remote });
export const searchTracks = (q, genre, page = 1, options = {}) => route('tracks', { q, genre, page, page_size: 20 }, () => browserMusic.searchTracks(q, genre, page, options), options).then(async (result) => {
  await musicRequest('addTracks', { tracks: result.data.results }, options); return result;
});
export const getTrack = async (id) => {
  try { return await browserMusic.getTrack(id); }
  catch { const result = await route('track', { track_id: id }, () => browserMusic.getTrack(id)); await musicRequest('addTracks', { tracks: [result.data] }); return result; }
};
export const getGenres = () => route('genres', {}, browserMusic.getGenres);
export const getAcousticStatus = () => route('acousticStatus', {}, browserMusic.getAcousticStatus);
export const getLyricStatus = () => route('lyricStatus', {}, browserMusic.getLyricStatus);
export const getCharts = (country = 'us') => route('charts', { country }, () => browserMusic.getCharts(country));
export const analyzeUnknown = browserMusic.analyzeUnknown;
let preferenceCache;
async function preferences(s) {
  if (!s) return null;
  await guard(s);
  if (preferenceCache?.key === s.user.account_key && preferenceCache.until > Date.now()) return preferenceCache.data;
  let data;
  if (s.provider === 'firebase') data = await firebase.preferences(s.uid);
  else {
    const [favorites, history, interactions] = await Promise.all([favRows(s), historyRows(s), legacy.interactions(s.uid)]);
    data = { favorites: favorites.map(({ track_id }) => ({ track_id })), interactions,
      items: history.flatMap((run) => run.suggestions ?? []).map(({ track_id }) => ({ track_id })) };
  }
  await guard(s);
  preferenceCache = { key: s.user.account_key, until: Date.now() + 10_000, data };
  return data;
}
async function recommend(action, input) {
  const session = await sessions.capture().catch(() => null);
  const local = async () => {
    let prefs;
    try { prefs = await preferences(session); }
    catch (error) { if (input.mode === 'personalized') throw error; storageWarning(); }
    if (input.mode === 'personalized' && !session) throw new Error('Sign in for personal recommendations.');
    return { data: await musicRequest(action, { ...input, preferences: prefs }) };
  };
  // Personal picks stay in-browser: Firebase private history must never be sent to Supabase.
  const result = input.mode === 'personalized' ? await local() : await route(action, input, local);
  await musicRequest('addTracks', { tracks: [result.data.anchor, ...result.data.recommendations] });
  if (session) (async () => {
    await guard(session);
    if (session.provider === 'firebase') await firebase.saveRecommendation(result.data, input.mode ?? 'transition', session.uid);
    else await legacy.saveRecommendation(session.uid, result.data, input.mode ?? 'transition', () => guard(session));
    await guard(session);
    preferenceCache = null;
    window.dispatchEvent(new Event('cerum-history-saved'));
  })().catch(storageWarning);
  return result;
}
export const getRecommendations = (track_id, k = 10, weights = null, mode = 'similar', genre_scope = 'nearby', vibe_lock = true, liveAnchor = null) => response(recommend('recommend', {
  track_id, k, weights, mode, genre_scope, vibe_lock,
  ...(liveAnchor ? { anchor_track: liveAnchor.track, anchor_analysis: liveAnchor.analysis } : {}),
}).then((result) => result.data));
export const getSimilar = (id, k = 10) => getRecommendations(id, k);
export const getSoundBridge = (track_id, destination_track_id) => response(recommend('bridge', { track_id, destination_track_id }).then((result) => result.data));
