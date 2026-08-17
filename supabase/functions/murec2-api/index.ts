import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "@supabase/supabase-js/cors";

type JsonRecord = Record<string, any>;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const publishableKey = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" };
const modeWeights: Record<string, [number, number, number]> = {
  similar: [0.35, 0.40, 0.25],
  rhythm: [0.65, 0.20, 0.15],
  timbre: [0.15, 0.70, 0.15],
  discover: [0.35, 0.40, 0.25],
  personalized: [0.35, 0.40, 0.25],
};
const allowedEvents = new Set([
  "selected", "preview_started", "preview_completed", "youtube_opened",
  "liked", "disliked", "dismissed",
]);

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let libraryCache: JsonRecord[] | null = null;
let libraryCachedAt = 0;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

function cleanTrack(track: JsonRecord, fingerprint?: JsonRecord | null) {
  const signature = fingerprint?.acoustic_signature ?? null;
  return {
    track_id: String(track.track_id),
    title: track.title,
    artist: track.artist,
    genre: signature ? "MuRec2 acoustic" : "Audio analysis pending",
    subgenre: signature,
    year: track.year,
    bpm: fingerprint?.profile?.bpm ?? null,
    energy: null,
    valence: null,
    popularity: null,
    timbre: fingerprint?.profile?.texture ?? null,
    primary_theme_pool: null,
    lyric_snippet: null,
    album: track.album,
    artwork_url: track.artwork_url,
    preview_url: track.preview_url,
    external_url: track.external_url,
    source: track.source ?? "Catalogue",
    acoustic_signature: signature,
    analysis_status: signature ? "complete" : "pending",
  };
}

async function loadLibrary() {
  if (libraryCache && Date.now() - libraryCachedAt < 5 * 60_000) return libraryCache;
  const rows: JsonRecord[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin
      .from("acoustic_fingerprints")
      .select("track_id,vector,profile,acoustic_signature,tracks!inner(track_id,title,artist,album,year,artwork_url,preview_url,external_url,source)")
      .range(start, start + 999);
    if (error) throw new ApiError(503, `Could not load the acoustic library: ${error.message}`);
    const batch = (data ?? []).map((row: JsonRecord) => ({
      ...row,
      track: Array.isArray(row.tracks) ? row.tracks[0] : row.tracks,
    }));
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  libraryCache = rows;
  libraryCachedAt = Date.now();
  return rows;
}

async function userContext(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const accessToken = authorization.slice(7).trim();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  return error || !data.user ? null : { user: data.user, client };
}

function requireUser(context: Awaited<ReturnType<typeof userContext>>) {
  if (!context) throw new ApiError(401, "Sign in to use this feature");
  return context;
}

function meanScaledDifference(first: number[], second: number[], scales: number[], sharpness: number) {
  let total = 0;
  for (let index = 0; index < scales.length; index += 1) {
    total += Math.abs((first[index] ?? 0) - (second[index] ?? 0)) / scales[index];
  }
  return Math.max(0, Math.min(1, Math.exp(-sharpness * total / scales.length)));
}

function cosine(first: number[], second: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < first.length; index += 1) {
    dot += first[index] * second[index];
    normA += first[index] ** 2;
    normB += second[index] ** 2;
  }
  return dot / Math.max(Math.sqrt(normA * normB), 1e-10);
}

function components(first: JsonRecord, second: JsonRecord): [number, number, number] {
  const a = first.profile;
  const b = second.profile;
  const rhythmA = [a.bpm, a.tempo_confidence ?? 0.5, a.onset_density, a.beat_regularity, a.percussive_ratio, a.danceability];
  const rhythmB = [b.bpm, b.tempo_confidence ?? 0.5, b.onset_density, b.beat_regularity, b.percussive_ratio, b.danceability];
  const rhythm = meanScaledDifference(rhythmA, rhythmB, [70, 1, 5, 1, 1, 1], 2.2);

  const mfccScales = [180, 90, 70, 60, 55, 50, 45, 42, 40, 38, 36, 34, 32];
  const mfcc = meanScaledDifference(first.vector.slice(10, 23), second.vector.slice(10, 23), mfccScales, 1.8);
  const profileA = [a.brightness, a.spectral_flatness, a.spectral_contrast, a.zero_crossing_rate, a.harmonic_ratio, a.aggression, a.dynamic_range];
  const profileB = [b.brightness, b.spectral_flatness, b.spectral_contrast, b.zero_crossing_rate, b.harmonic_ratio, b.aggression, b.dynamic_range];
  const profileSimilarity = meanScaledDifference(profileA, profileB, [1, 0.35, 35, 0.25, 1, 1, 1], 2.2);
  const timbre = 0.55 * mfcc + 0.45 * profileSimilarity;

  const chromaA = first.vector.slice(23, 35);
  const chromaB = second.vector.slice(23, 35);
  let chromaSimilarity = -1;
  for (let shift = 0; shift < 12; shift += 1) {
    const rotated = chromaB.map((_: number, index: number) => chromaB[(index - shift + 12) % 12]);
    chromaSimilarity = Math.max(chromaSimilarity, cosine(chromaA, rotated));
  }
  const harmonic = meanScaledDifference(
    [a.tonal_strength, a.harmonic_ratio, first.vector[2]],
    [b.tonal_strength, b.harmonic_ratio, second.vector[2]],
    [1, 1, 1],
    1.7,
  );
  const harmony = Math.max(0, Math.min(1, 0.65 * chromaSimilarity + 0.35 * harmonic));
  return [rhythm, timbre, harmony];
}

async function searchTracks(input: JsonRecord) {
  const q = String(input.q ?? "").trim().replace(/[%_,()]/g, " ");
  const page = Math.max(1, Number(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.page_size ?? 20)));
  let query = admin
    .from("tracks")
    .select("track_id,title,artist,album,year,artwork_url,preview_url,external_url,source,acoustic_fingerprints(acoustic_signature,profile)", { count: "exact" });
  if (q) query = query.or(`title.ilike.%${q}%,artist.ilike.%${q}%`);
  const { data, error, count } = await query
    .order("title", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(503, error.message);
  const results = (data ?? []).map((row: JsonRecord) => {
    const fingerprint = Array.isArray(row.acoustic_fingerprints) ? row.acoustic_fingerprints[0] : row.acoustic_fingerprints;
    return cleanTrack(row, fingerprint);
  });
  return { results, total: count ?? results.length, page, page_size: pageSize };
}

async function recommend(input: JsonRecord, context: Awaited<ReturnType<typeof userContext>>) {
  const mode = String(input.mode ?? "similar");
  if (!(mode in modeWeights)) throw new ApiError(422, "Unknown recommendation mode");
  if (mode === "personalized" && !context) throw new ApiError(401, "Sign in to use personalized recommendations");
  const k = Math.min(50, Math.max(1, Number(input.k ?? 12)));
  const library = await loadLibrary();
  const anchor = library.find((item) => String(item.track_id) === String(input.track_id));
  if (!anchor) throw new ApiError(404, "This track has not been acoustically analyzed yet");

  const seen = new Set<string>();
  const favoriteFingerprints: JsonRecord[] = [];
  if (context) {
    const [{ data: favorites }, { data: interactions }, { data: items }] = await Promise.all([
      context.client.from("favorites").select("track_id"),
      context.client.from("interactions").select("track_id"),
      context.client.from("recommendation_items").select("track_id"),
    ]);
    const favoriteIds = new Set((favorites ?? []).map((row: JsonRecord) => String(row.track_id)));
    for (const row of interactions ?? []) seen.add(String(row.track_id));
    for (const row of items ?? []) seen.add(String(row.track_id));
    favoriteFingerprints.push(...library.filter((row) => favoriteIds.has(String(row.track_id))));
  }

  const chosenWeights = mode === "similar" && input.weights
    ? [Number(input.weights.audio), Number(input.weights.lyric), Number(input.weights.collab)] as [number, number, number]
    : modeWeights[mode];
  if (chosenWeights.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(chosenWeights.reduce((a, b) => a + b, 0) - 1) > 0.01) {
    throw new ApiError(400, "Recommendation weights must be non-negative and sum to 1");
  }

  const scored = library.flatMap((candidate) => {
    if (candidate.track_id === anchor.track_id) return [];
    if (candidate.track.title.trim().toLowerCase() === anchor.track.title.trim().toLowerCase() && candidate.track.artist.trim().toLowerCase() === anchor.track.artist.trim().toLowerCase()) return [];
    let [rhythm, timbre, harmony] = components(anchor, candidate);
    if (mode === "personalized" && favoriteFingerprints.length) {
      const taste = favoriteFingerprints.map((favorite) => components(favorite, candidate));
      const best = [0, 1, 2].map((index) => Math.max(...taste.map((parts) => parts[index])));
      rhythm = 0.4 * rhythm + 0.6 * best[0];
      timbre = 0.4 * timbre + 0.6 * best[1];
      harmony = 0.4 * harmony + 0.6 * best[2];
    }
    const base = chosenWeights[0] * rhythm + chosenWeights[1] * timbre + chosenWeights[2] * harmony;
    let total = mode === "discover" ? Math.max(0, 1 - Math.abs(base - 0.68) / 0.68) : base;
    if (seen.has(String(candidate.track_id))) total *= mode === "discover" ? 0.45 : 0.82;
    return [{
      ...cleanTrack(candidate.track, candidate),
      audio_similarity: Number(rhythm.toFixed(4)),
      lyric_similarity: Number(timbre.toFixed(4)),
      collab_similarity: Number(harmony.toFixed(4)),
      hybrid_score: Number(Math.max(0, Math.min(1, total)).toFixed(4)),
      score_mode: `acoustic-fingerprint-${mode}`,
    }];
  }).sort((a, b) => b.hybrid_score - a.hybrid_score);

  const recordings = new Set<string>();
  const recommendations = scored.filter((item) => {
    const key = `${item.title.trim().toLowerCase()}::${item.artist.trim().toLowerCase()}`;
    if (recordings.has(key)) return false;
    recordings.add(key);
    return true;
  }).slice(0, k);

  if (context) {
    const weights = { audio: chosenWeights[0], lyric: chosenWeights[1], collab: chosenWeights[2] };
    const { data: run, error } = await context.client.from("recommendation_runs").insert({
      user_id: context.user.id,
      anchor_track_id: String(anchor.track_id),
      anchor_title: anchor.track.title,
      anchor_artist: anchor.track.artist,
      mode,
      weights,
    }).select("id").single();
    if (!error && run) {
      await context.client.from("recommendation_items").insert(recommendations.map((item, index) => ({
        run_id: run.id,
        track_id: item.track_id,
        title: item.title,
        artist: item.artist,
        subgenre: item.subgenre,
        rank: index + 1,
        score: item.hybrid_score,
      })));
    }
  }

  return {
    anchor: cleanTrack(anchor.track, anchor),
    recommendations,
    weights_used: { audio: chosenWeights[0], lyric: chosenWeights[1], collab: chosenWeights[2] },
    total: recommendations.length,
  };
}

async function listHistory(context: NonNullable<Awaited<ReturnType<typeof userContext>>>) {
  const { data: runs, error } = await context.client
    .from("recommendation_runs")
    .select("id,anchor_track_id,anchor_title,anchor_artist,mode,created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new ApiError(500, error.message);
  if (!runs?.length) return { history: [] };
  const { data: items } = await context.client
    .from("recommendation_items")
    .select("run_id,track_id,title,artist,subgenre,rank,score")
    .in("run_id", runs.map((run) => run.id))
    .order("rank", { ascending: true });
  return {
    history: runs.map((run) => ({
      ...run,
      suggestions: (items ?? []).filter((item) => item.run_id === run.id).slice(0, 12).map(({ run_id: _runId, ...item }) => item),
    })),
  };
}

async function handleAction(input: JsonRecord, request: Request) {
  const action = String(input.action ?? "");
  const context = await userContext(request);
  if (action === "health") {
    const [{ count: tracks }, library] = await Promise.all([
      admin.from("tracks").select("track_id", { count: "exact" }).limit(1),
      loadLibrary(),
    ]);
    return { status: "ok", models_loaded: true, total_tracks: tracks ?? library.length, acoustic_indexed: library.length, acoustic_indexing: false };
  }
  if (action === "acousticStatus") {
    const [{ count: tracks }, { count: failures }, library] = await Promise.all([
      admin.from("tracks").select("track_id", { count: "exact" }).limit(1),
      admin.from("fingerprint_failures").select("track_id", { count: "exact" }).limit(1),
      loadLibrary(),
    ]);
    const total = tracks ?? library.length;
    return { indexed: library.length, total, remaining: Math.max(0, total - library.length), failures: failures ?? 0, building: false };
  }
  if (action === "tracks") return searchTracks(input);
  if (action === "track") {
    const library = await loadLibrary();
    const row = library.find((item) => String(item.track_id) === String(input.track_id));
    if (!row) throw new ApiError(404, "Track not found");
    return cleanTrack(row.track, row);
  }
  if (action === "genres") {
    const library = await loadLibrary();
    return {
      genres: [...new Set(library.map((row) => row.profile.texture).filter(Boolean))].sort(),
      subgenres: [...new Set(library.map((row) => row.acoustic_signature).filter(Boolean))].sort(),
      dimensions: ["tempo", "intensity", "texture", "rhythm character", "harmonic character"],
    };
  }
  if (action === "recommend" || action === "similar") return recommend({ ...input, mode: action === "similar" ? "similar" : input.mode }, context);
  if (action === "analyze") throw new ApiError(501, "Audio-file analysis currently requires the MuRec2 desktop backend. Search the hosted acoustic catalogue instead.");

  if (action === "favorites") {
    const current = requireUser(context);
    const { data, error } = await current.client.from("favorites")
      .select("track_id,title,artist,subgenre,artwork_url,preview_url,external_url,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new ApiError(500, error.message);
    return { favorites: data ?? [] };
  }
  if (action === "addFavorite") {
    const current = requireUser(context);
    const library = await loadLibrary();
    const row = library.find((item) => String(item.track_id) === String(input.track_id));
    if (!row) throw new ApiError(404, "This track is not available in the hosted acoustic catalogue");
    const track = cleanTrack(row.track, row);
    const { error } = await current.client.from("favorites").upsert({
      user_id: current.user.id,
      track_id: track.track_id,
      title: track.title,
      artist: track.artist,
      subgenre: track.subgenre,
      artwork_url: track.artwork_url,
      preview_url: track.preview_url,
      external_url: track.external_url,
    });
    if (error) throw new ApiError(500, error.message);
    await current.client.from("interactions").insert({ user_id: current.user.id, track_id: track.track_id, event_type: "liked" });
    return { favorite: track };
  }
  if (action === "removeFavorite") {
    const current = requireUser(context);
    const { error } = await current.client.from("favorites").delete().eq("track_id", String(input.track_id));
    if (error) throw new ApiError(500, error.message);
    return { removed: true };
  }
  if (action === "history") return listHistory(requireUser(context));
  if (action === "clearHistory") {
    const current = requireUser(context);
    const { error: runError } = await current.client.from("recommendation_runs").delete().eq("user_id", current.user.id);
    const { error: interactionError } = await current.client.from("interactions").delete().eq("user_id", current.user.id);
    if (runError || interactionError) throw new ApiError(500, runError?.message ?? interactionError?.message ?? "Could not clear history");
    return { cleared: true };
  }
  if (action === "event") {
    const current = requireUser(context);
    const eventType = String(input.event_type ?? "");
    if (!allowedEvents.has(eventType)) throw new ApiError(422, "Unsupported interaction event");
    const { error } = await current.client.from("interactions").insert({
      user_id: current.user.id,
      track_id: String(input.track_id),
      event_type: eventType,
      value: input.value ?? null,
    });
    if (error) throw new ApiError(500, error.message);
    return { recorded: true };
  }
  throw new ApiError(404, "Unknown API action");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ detail: "Use POST" }, 405);
  try {
    const input = await request.json();
    return json(await handleAction(input, request));
  } catch (error) {
    console.error(error);
    return json({ detail: error instanceof Error ? error.message : "Unexpected server error" }, error instanceof ApiError ? error.status : 500);
  }
});
