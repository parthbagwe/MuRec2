import axios from "axios";
import { createAccount, currentAccount, signIn, signOut, supabase, supabaseEnabled } from "./supabase";

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

export const searchTracks = (q, genre, page = 1) =>
  api.get("/tracks", { params: { q, genre, page, page_size: 20 } });

export const getTrack = (track_id) =>
  api.get(`/tracks/${track_id}`);

export const getRecommendations = (track_id, k = 10, weights = null, mode = "similar") =>
  api.post("/recommend", { track_id, k, weights, mode });

export const getSimilar = (track_id, k = 10) =>
  api.get(`/similar/${track_id}`, { params: { k } });

export const getGenres = () =>
  api.get("/genres");

export const getAcousticStatus = () => api.get("/acoustic-index/status");

export const analyzeUnknown = (file, title, k = 12) => {
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

export const getFavorites = () => api.get("/me/favorites");

export const addFavorite = (track_id) => api.post("/me/favorites", { track_id });

export const removeFavorite = (track_id) => api.delete(`/me/favorites/${track_id}`);

export const getHistory = () => api.get("/me/history");

export const clearHistory = () => api.delete("/me/history");

export const recordEvent = (track_id, event_type, value = null) =>
  api.post("/events", { track_id, event_type, value });
