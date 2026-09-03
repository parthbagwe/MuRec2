import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile } from "firebase/auth";
import { getFirestore, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";

let services;
let preferenceCache;
let preferencePending;
const namespace = "cerum-firebase-spark";

export function storageWarning() {
  window.dispatchEvent(new CustomEvent("cerum-storage-warning", {
    detail: "Music can still play, but Firebase could not sync your library. Check your connection or the free-plan quota.",
  }));
}

export async function getServices() {
  services ??= (async () => {
    // Firebase Hosting supplies public web-app configuration, NOT service-account credentials.
    // A local test can use the same public configuration via VITE_FIREBASE_CONFIG.
    let config;
    if (import.meta.env.VITE_FIREBASE_CONFIG) config = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
    else {
      const response = await fetch(import.meta.env.VITE_FIREBASE_CONFIG_URL || "/__/firebase/init.json", { signal: AbortSignal.timeout(5_000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) return null;
      config = await response.json();
    }
    if (!config?.projectId || !config?.apiKey || !config?.appId) return null;
    const app = initializeApp(config, namespace);
    const auth = getAuth(app);
    const db = getFirestore(app);
    await auth.authStateReady();
    return { auth, db };
  })().catch(() => null);
  const result = await services;
  if (!result) services = undefined;
  return result;
}

const account = (user) => user ? {
  id: user.uid, display_name: user.displayName || "Listener", email: user.email,
  personalization_enabled: true, created_at: user.metadata.creationTime,
} : null;

export async function currentAccount() { return account((await getServices())?.auth.currentUser); }

async function configured() {
  const service = await getServices();
  if (!service) throw new Error("Firebase sign-in is not configured in this preview yet. Music search and mixing work without signing in.");
  return service;
}

export async function createAccount(displayName, email, password) {
  if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
  const { auth } = await configured();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: String(displayName || "Listener").slice(0, 60) });
  preferenceCache = null;
  return { user: account(credential.user), confirmation_required: false };
}

export async function loginAccount(email, password) {
  const { auth } = await configured();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  preferenceCache = null;
  return { user: account(credential.user) };
}

export async function logoutAccount() {
  preferenceCache = null;
  preferencePending = null;
  const service = await getServices();
  if (service) await signOut(service.auth);
}

async function session(expectedUid) {
  const service = await configured();
  const uid = service.auth.currentUser?.uid;
  if (!uid || (expectedUid && uid !== expectedUid)) throw new Error("Sign in to save your music library.");
  return { ...service, uid };
}

const limits = { favorites: 100, history: 30, interactions: 100 };
const stateRef = (db, uid, kind) => doc(db, "users", uid, "library", kind);

async function readList(kind, expectedUid) {
  const { auth, db, uid } = await session(expectedUid);
  const snapshot = await getDoc(stateRef(db, uid, kind));
  if (auth.currentUser?.uid !== uid) throw new Error("Your account changed. Please retry.");
  return snapshot.data()?.entries ?? [];
}

async function changeList(kind, transform, expectedUid) {
  const { auth, db, uid } = await session(expectedUid);
  await runTransaction(db, async (transaction) => {
    const ref = stateRef(db, uid, kind);
    const snapshot = await transaction.get(ref);
    if (auth.currentUser?.uid !== uid) throw new Error("Your account changed. Please retry.");
    const entries = transform(snapshot.data()?.entries ?? []);
    if (entries.length > limits[kind]) throw new Error(`This free-plan library supports ${limits[kind]} favourites. Remove one before adding another.`);
    transaction.set(ref, { entries: JSON.parse(JSON.stringify(entries)), updated_at: serverTimestamp() });
  });
  preferenceCache = null;
}

export const loadFavorites = (uid) => readList("favorites", uid);
export const loadHistory = (uid) => readList("history", uid);
export const deleteHistory = (uid) => changeList("history", () => [], uid);
export const deleteFavorite = (trackId, uid) => changeList("favorites", (entries) => entries.filter((row) => row.track_id !== trackId), uid);
export async function saveFavorite(track, expectedUid) {
  await changeList("favorites", (entries) => [
    { ...track, created_at: new Date().toISOString() }, ...entries.filter((row) => row.track_id !== track.track_id),
  ], expectedUid);
}

export async function preferences(expectedUid) {
  const user = await currentAccount();
  if (!user) return null;
  if (expectedUid && user.id !== expectedUid) throw new Error("Your account changed. Please retry.");
  if (preferenceCache?.uid === user.id && preferenceCache.until > Date.now()) return preferenceCache;
  if (preferencePending?.uid === user.id) return preferencePending.promise;
  const promise = Promise.all([readList("favorites", user.id), readList("history", user.id), readList("interactions", user.id)])
    .then(async ([favorites, history, interactions]) => {
      if ((await currentAccount())?.id !== user.id) throw new Error("Your account changed. Please retry.");
      preferenceCache = { uid: user.id, until: Date.now() + 20_000, favorites: favorites.map(({ track_id }) => ({ track_id })),
        interactions, items: history.flatMap((run) => run.suggestions ?? []).map(({ track_id }) => ({ track_id })) };
      return preferenceCache;
    }).finally(() => { if (preferencePending?.promise === promise) preferencePending = null; });
  preferencePending = { uid: user.id, promise };
  return promise;
}

export async function saveRecommendation(result, mode, uid) {
  if (!uid) return;
  const run = { id: crypto.randomUUID(), anchor_track_id: result.anchor.track_id, anchor_title: result.anchor.title,
    anchor_artist: result.anchor.artist, mode, created_at: new Date().toISOString(),
    suggestions: result.recommendations.slice(0, 12).map((track, i) => ({ track_id: track.track_id, title: track.title,
      artist: track.artist, subgenre: track.subgenre ?? null, rank: i + 1, score: track.hybrid_score ?? null })) };
  await changeList("history", (entries) => [run, ...entries].slice(0, 30), uid);
}

export async function saveEvent(track_id, event_type, expectedUid) {
  if (!["preview_completed", "youtube_opened", "liked", "disliked", "dismissed"].includes(event_type)) return;
  const user = await currentAccount();
  if (!user) return;
  if (expectedUid && user.id !== expectedUid) throw new Error("Your account changed. Please retry.");
  await changeList("interactions", (entries) => [{ track_id, event_type },
    ...entries.filter((row) => row.track_id !== track_id || row.event_type !== event_type)].slice(0, 100), user.id);
}
