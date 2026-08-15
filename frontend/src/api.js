import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

export const searchTracks = (q, genre, page = 1) =>
  axios.get(`${BASE}/tracks`, { params: { q, genre, page, page_size: 20 } });

export const getTrack = (track_id) =>
  axios.get(`${BASE}/tracks/${track_id}`);

export const getRecommendations = (track_id, k = 10, weights = null) =>
  axios.post(`${BASE}/recommend`, { track_id, k, weights });

export const getSimilar = (track_id, k = 10) =>
  axios.get(`${BASE}/similar/${track_id}`, { params: { k } });

export const getGenres = () =>
  axios.get(`${BASE}/genres`);
