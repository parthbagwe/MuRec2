import { supabase, createAccount } from '../supabase.js';

const take = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
let cachedProfile;
export async function current() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) { cachedProfile = null; return null; }
  const id = data.session.user.id;
  if (cachedProfile?.id === id && cachedProfile.until > Date.now()) return cachedProfile.user;
  const verified = await supabase.auth.getUser();
  if (verified.error) throw verified.error;
  if (!verified.data.user) return null;
  if (verified.data.user.id !== id) throw new Error('Your account changed. Please retry.');
  const profile = await take(supabase.from('profiles').select('id,display_name,personalization_enabled,created_at').eq('id', id).single());
  const user = { ...profile, email: verified.data.user.email };
  cachedProfile = { id, user, until: Date.now() + 30_000 };
  return user;
}
export const login = async (email, password) => {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  cachedProfile = null;
  return { user: await current() };
};
export const register = (...args) => createAccount(...args);
export async function logout() { cachedProfile = null; if (supabase) { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw error; } }
export const favorites = (uid) => take(supabase.from('favorites').select('track_id,title,artist,subgenre,artwork_url,preview_url,external_url,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(500));
export async function history(uid) {
  const runs = await take(supabase.from('recommendation_runs').select('id,anchor_track_id,anchor_title,anchor_artist,mode,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(30));
  if (!runs.length) return [];
  const items = await take(supabase.from('recommendation_items').select('run_id,track_id,title,artist,subgenre,rank,score').in('run_id', runs.map((run) => run.id)).order('rank').limit(360));
  return runs.map((run) => ({ ...run, suggestions: items.filter((item) => item.run_id === run.id).slice(0, 12) }));
}
export const interactions = (uid) => take(supabase.from('interactions').select('track_id,event_type').eq('user_id', uid).order('created_at', { ascending: false }).limit(100));
export function saveFavorite(uid, track) {
  const row = { user_id: uid };
  for (const key of ['track_id', 'title', 'artist', 'subgenre', 'artwork_url', 'preview_url', 'external_url']) row[key] = track[key] ?? null;
  return take(supabase.from('favorites').upsert(row, { onConflict: 'user_id,track_id' }));
}
export const removeFavorite = (uid, id) => take(supabase.from('favorites').delete().eq('user_id', uid).eq('track_id', id));
export async function clearHistory(uid) {
  await take(supabase.from('recommendation_runs').delete().eq('user_id', uid));
  await take(supabase.from('interactions').delete().eq('user_id', uid));
}
export async function saveRecommendation(uid, result, mode, guard) {
  await guard();
  const run = await take(supabase.from('recommendation_runs').insert({ user_id: uid,
    anchor_track_id: result.anchor.track_id, anchor_title: result.anchor.title, anchor_artist: result.anchor.artist,
    mode, weights: {} }).select('id').single());
  await guard();
  if (result.recommendations.length) await take(supabase.from('recommendation_items').insert(result.recommendations.slice(0, 12).map((track, index) => ({
    run_id: run.id, track_id: track.track_id, title: track.title, artist: track.artist, subgenre: track.subgenre ?? null,
    rank: index + 1, score: Math.min(1, Math.max(0, Number(track.hybrid_score ?? track.score ?? 0))),
  }))));
}
export const recordEvent = (uid, track_id, event_type) => take(supabase.from('interactions').insert({ user_id: uid, track_id, event_type }));
