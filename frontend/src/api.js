import axios from "axios";
import { createAccount, currentAccount, signIn, signOut, supabase, supabaseEnabled } from "./supabase";
import { createHostedRequests } from "./serviceRequests";

export const hostedApiEnabled = import.meta.env.VITE_MUREC2_API === "supabase";
export const accountProviders = ['supabase'];
export const defaultAccountProvider = 'supabase';

function requestError(message) {
  const error = new Error(message);
  error.response = { data: { detail: message } };
  return error;
}

const edge = createHostedRequests((name, options) => supabase.functions.invoke(name, options));

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  withCredentials: true,
});

api.interceptors.request.use(async (config) => {
  if (supabaseEnabled) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) config.headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  return config;
});

export const searchTracks = (q, genre, page = 1, { signal } = {}) => hostedApiEnabled
  ? edge("tracks", { q, genre, page, page_size: 20 }, { signal })
  : api.get("/tracks", { params: { q, genre, page, page_size: 20 }, signal });

export const getTrack = (track_id) => hostedApiEnabled
  ? edge("track", { track_id })
  : api.get(`/tracks/${track_id}`);

export const getRecommendations = (track_id, k = 10, weights = null, mode = "similar", genre_scope = "nearby", vibe_lock = true, liveAnchor = null) => hostedApiEnabled
  ? edge("recommend", {
    track_id, k, weights, mode, genre_scope, vibe_lock,
    ...(liveAnchor ? { anchor_track: liveAnchor.track, anchor_analysis: liveAnchor.analysis } : {}),
  })
  : api.post("/recommend", { track_id, k, weights, mode, genre_scope, vibe_lock });

export const getSoundBridge = async (track_id, destination_track_id) => {
  if (hostedApiEnabled) return edge("bridge", { track_id, destination_track_id, k: 5 });
  const response = await api.post("/recommend", { track_id, k: 3, mode: "transition" });
  const destination = await getTrack(destination_track_id);
  return {
    data: {
      anchor: response.data.anchor,
      destination: destination.data,
      recommendations: [...response.data.recommendations.slice(0, 3), destination.data],
      score_mode: "acoustic-bridge-fallback",
    },
  };
};

export const getSimilar = (track_id, k = 10) => hostedApiEnabled
  ? edge("similar", { track_id, k })
  : api.get(`/similar/${track_id}`, { params: { k } });

export const getGenres = () => hostedApiEnabled ? edge("genres") : api.get("/genres");

export const getAcousticStatus = () => hostedApiEnabled ? edge("acousticStatus") : api.get("/acoustic-index/status");

export const getCharts = async (country = "us") => {
  if (hostedApiEnabled) {
    try {
      return await edge("charts", { country });
    } catch { /* Use the public chart fallback while the hosted catalogue is unavailable. */ }
  }
  return axios.get("/apple-charts", { params: { country } });
};

export const getLyricStatus = () => hostedApiEnabled
  ? edge("lyricStatus")
  : Promise.resolve({ data: { analyzed: 0, total: 0, provider_configured: false, stores_raw_lyrics: false } });

export const analyzeUnknown = (file, title, k = 12) => {
  if (hostedApiEnabled) return Promise.reject(requestError("Audio-file analysis is available in the local Cerum desktop version. Search the hosted acoustic catalogue instead."));
  const form = new FormData();
  form.append("file", file);
  form.append("title", title || file.name.replace(/\.[^.]+$/, ""));
  form.append("k", String(k));
  return api.post("/analyze", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
};

export const register = async (display_name, email, password) => {
  if (!supabaseEnabled) return api.post("/auth/register", { display_name, email, password });
  return { data: await createAccount(display_name, email, password) };
};

export const login = async (email, password) => {
  if (!supabaseEnabled) return api.post("/auth/login", { email, password });
  return { data: { user: await signIn(email, password) } };
};

export const logout = () => supabaseEnabled ? signOut() : api.post("/auth/logout");

export const getMe = async () => supabaseEnabled ? { data: { user: await currentAccount() } } : api.get("/auth/me");

export const getFavorites = () => hostedApiEnabled ? edge("favorites") : api.get("/me/favorites");

export const addFavorite = (track_id) => hostedApiEnabled ? edge("addFavorite", { track_id }) : api.post("/me/favorites", { track_id });

export const removeFavorite = (track_id) => hostedApiEnabled ? edge("removeFavorite", { track_id }) : api.delete(`/me/favorites/${track_id}`);

export const getHistory = () => hostedApiEnabled ? edge("history") : api.get("/me/history");

export const clearHistory = () => hostedApiEnabled ? edge("clearHistory") : api.delete("/me/history");

export const recordEvent = (track_id, event_type, value = null) =>
  hostedApiEnabled ? edge("event", { track_id, event_type, value }) : api.post("/events", { track_id, event_type, value });
