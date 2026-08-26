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
  transition: [0.42, 0.25, 0.33],
};
const lyricWeights: Record<string, number> = {
  similar: 0.18,
  rhythm: 0.05,
  timbre: 0.08,
  discover: 0.25,
  personalized: 0.25,
  transition: 0.08,
};
const allowedEvents = new Set([
  "selected", "preview_started", "preview_completed", "youtube_opened",
  "liked", "disliked", "dismissed",
]);

const styleFamilies: Record<string, Set<string>> = {
  metal: new Set([
    "nu metal", "alternative metal", "metalcore", "thrash metal", "death metal",
    "black metal", "doom metal", "progressive metal", "industrial metal",
    "power metal", "symphonic metal", "glam metal", "heavy metal",
  ]),
  rock: new Set([
    "progressive rock", "grunge", "alternative rock", "indie rock", "shoegaze",
    "post punk", "pop punk", "emo", "hard rock", "psychedelic rock", "punk rock", "rock",
  ]),
  electronic: new Set(["electronic", "house", "techno", "drum and bass", "jungle/drum'n'bass", "dubstep", "ambient", "synthpop", "downtempo", "amapiano"]),
  pop: new Set(["pop", "dance pop", "dream pop", "synthpop", "indie pop", "k-pop", "j-pop"]),
  "hip-hop": new Set(["hip-hop", "trap", "boom bap", "drill"]),
  "r&b": new Set(["r&b", "neo soul", "neo-soul", "soul", "funk"]),
};
const styleAdjacency: Record<string, Record<string, number>> = {
  "nu metal": { "alternative metal": 0.78, "industrial metal": 0.62, metalcore: 0.58, "hard rock": 0.42 },
  "alternative metal": { "progressive metal": 0.62, metalcore: 0.60, "hard rock": 0.55 },
  "progressive metal": { "progressive rock": 0.72, "alternative metal": 0.62, "heavy metal": 0.48 },
  "heavy metal": { "thrash metal": 0.65, "power metal": 0.58, "glam metal": 0.52, "hard rock": 0.46 },
  "indie rock": { "alternative rock": 0.75, "post punk": 0.58, "dream pop": 0.52 },
  "alternative rock": { grunge: 0.66, "indie rock": 0.75, "hard rock": 0.52, "progressive rock": 0.42 },
  "progressive rock": { "psychedelic rock": 0.62, "alternative rock": 0.42, "progressive metal": 0.72 },
  "pop punk": { emo: 0.74, "punk rock": 0.66, "alternative rock": 0.48 },
  shoegaze: { "dream pop": 0.74, "indie rock": 0.58, "alternative rock": 0.52 },
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let libraryCache: JsonRecord[] | null = null;
let libraryCachedAt = 0;
const chartCache = new Map<string, { expiresAt: number; rows: JsonRecord[] }>();

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
    energy: fingerprint?.profile?.energy ?? null,
    valence: fingerprint?.lyrics?.sentiment === undefined
      ? null
      : Math.max(0, Math.min(1, (Number(fingerprint.lyrics.sentiment) + 1) / 2)),
    popularity: null,
    timbre: fingerprint?.profile?.texture ?? null,
    aggression: fingerprint?.profile?.aggression ?? null,
    brightness: fingerprint?.profile?.brightness ?? null,
    dynamic_range: fingerprint?.profile?.dynamic_range ?? null,
    danceability: fingerprint?.profile?.danceability ?? null,
    onset_density: fingerprint?.profile?.onset_density ?? null,
    percussive_ratio: fingerprint?.profile?.percussive_ratio ?? null,
    harmonic_ratio: fingerprint?.profile?.harmonic_ratio ?? null,
    key: fingerprint?.profile?.key ?? null,
    mode: fingerprint?.profile?.mode ?? null,
    musical_key: fingerprint?.profile?.key
      ? `${fingerprint.profile.key} ${fingerprint.profile.mode ?? ""}`.trim()
      : null,
    primary_theme_pool: null,
    lyric_snippet: null,
    album: track.album,
    artwork_url: track.artwork_url,
    preview_url: track.preview_url,
    external_url: track.external_url,
    source: track.source ?? "Catalogue",
    acoustic_signature: signature,
    analysis_status: signature ? "complete" : "pending",
    lyrics_available: Boolean(fingerprint?.lyrics?.confidence > 0),
    lyric_themes: fingerprint?.lyrics?.themes ?? [],
    lyric_language: fingerprint?.lyrics?.language ?? null,
  };
}

async function loadLibrary() {
  if (libraryCache && Date.now() - libraryCachedAt < 5 * 60_000) return libraryCache;
  const rows: JsonRecord[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin
      .from("acoustic_fingerprints")
      .select("track_id,vector,profile,acoustic_signature,tracks!inner(track_id,title,artist,album,year,artwork_url,preview_url,external_url,source,provider_genre,seed_genre,provider_subgenre)")
      .range(start, start + 999);
    if (error) throw new ApiError(503, `Could not load the acoustic library: ${error.message}`);
    const batch = (data ?? []).map((row: JsonRecord) => ({
      ...row,
      track: Array.isArray(row.tracks) ? row.tracks[0] : row.tracks,
    }));
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  const lyricRows: JsonRecord[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin.from("lyric_features")
      .select("track_id,language,instrumental,themes,theme_vector,sentiment,arousal,confidence")
      .range(start, start + 999);
    if (error) throw new ApiError(503, `Could not load lyric features: ${error.message}`);
    lyricRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const lyricsByTrack = new Map(lyricRows.map((row) => [String(row.track_id), row]));
  rows.forEach((row) => { row.lyrics = lyricsByTrack.get(String(row.track_id)) ?? null; });
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

function normalizedStyle(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function recordingIdentity(title: unknown, artist: unknown) {
  const baseTitle = normalizedStyle(title)
    .replace(/\s+(?:[-–—]\s*)?(?:\(|\[)?(?:from\b|.*\bremaster(?:ed)?\b|radio edit|single version|album version|soundtrack).*?(?:\)|\])?$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const artistKey = normalizedStyle(artist).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${baseTitle}::${artistKey}`;
}

function styleFamily(value: string) {
  for (const [family, members] of Object.entries(styleFamilies)) {
    if (members.has(value)) return family;
  }
  return value;
}

function styleSimilarity(first: unknown, second: unknown) {
  const left = normalizedStyle(first);
  const right = normalizedStyle(second);
  if (!left || !right) return 0.25;
  if (left === right) return 1;
  if (styleAdjacency[left]?.[right] !== undefined) return styleAdjacency[left][right];
  if (styleAdjacency[right]?.[left] !== undefined) return styleAdjacency[right][left];
  const leftFamily = styleFamily(left);
  const rightFamily = styleFamily(right);
  if (leftFamily === rightFamily) return 0.34;
  if (new Set([leftFamily, rightFamily]).size === 2 && [leftFamily, rightFamily].includes("metal") && [leftFamily, rightFamily].includes("rock")) return 0.14;
  const pair = new Set([leftFamily, rightFamily]);
  if ((pair.has("pop") && pair.has("rock")) || (pair.has("pop") && pair.has("electronic")) || (pair.has("hip-hop") && pair.has("r&b"))) return 0.12;
  return 0.04;
}

function weightedScore(parts: [number, number, number], weights: [number, number, number]) {
  return weights[0] * parts[0] + weights[1] * parts[1] + weights[2] * parts[2];
}

function lyricSimilarity(first: JsonRecord, second: JsonRecord) {
  const left = first.lyrics;
  const right = second.lyrics;
  if (!left?.confidence || !right?.confidence || left.instrumental || right.instrumental) return null;
  const keys = [...new Set([...Object.keys(left.theme_vector ?? {}), ...Object.keys(right.theme_vector ?? {})])];
  const vectorA = keys.map((key) => Number(left.theme_vector?.[key] ?? 0));
  const vectorB = keys.map((key) => Number(right.theme_vector?.[key] ?? 0));
  const theme = keys.length ? Math.max(0, cosine(vectorA, vectorB)) : 0;
  const sentiment = 1 - Math.min(1, Math.abs(Number(left.sentiment ?? 0) - Number(right.sentiment ?? 0)) / 2);
  const arousal = 1 - Math.min(1, Math.abs(Number(left.arousal ?? 0.5) - Number(right.arousal ?? 0.5)));
  const language = left.language && left.language === right.language ? 1 : 0.65;
  return Math.max(0, Math.min(1, 0.55 * theme + 0.20 * sentiment + 0.15 * arousal + 0.10 * language));
}

function matchReasons(anchor: JsonRecord, candidate: JsonRecord, parts: [number, number, number]) {
  const reasons: string[] = [];
  const a = anchor.profile;
  const b = candidate.profile;
  const tempoDifference = Math.min(Math.abs(a.bpm - b.bpm), Math.abs(a.bpm - b.bpm * 2), Math.abs(a.bpm * 2 - b.bpm));
  if (tempoDifference <= 8) reasons.push("close tempo");
  if (a.texture === b.texture) reasons.push(`${String(a.texture).replaceAll("-", " ")} texture`);
  if (Math.abs(a.aggression - b.aggression) <= 0.09) reasons.push("matched intensity");
  if (a.rhythm_character === b.rhythm_character) reasons.push(`${String(a.rhythm_character).replaceAll("-", " ")} rhythm`);
  if (parts[2] >= 0.94) reasons.push("compatible harmony");
  return [...new Set(reasons)].slice(0, 3);
}

const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function transitionTempoDifference(firstBpm: number, secondBpm: number) {
  return Math.min(
    Math.abs(firstBpm - secondBpm),
    Math.abs(firstBpm - secondBpm * 2),
    Math.abs(firstBpm * 2 - secondBpm),
  );
}

function keyCompatibility(first: JsonRecord, second: JsonRecord) {
  const firstKey = keyNames.indexOf(String(first.profile.key ?? ""));
  const secondKey = keyNames.indexOf(String(second.profile.key ?? ""));
  const firstMode = String(first.profile.mode ?? "");
  const secondMode = String(second.profile.mode ?? "");
  if (firstKey < 0 || secondKey < 0) return 0.45;
  const interval = (secondKey - firstKey + 12) % 12;
  if (interval === 0 && firstMode === secondMode) return 1;
  if (firstMode === "major" && secondMode === "minor" && interval === 9) return 0.98;
  if (firstMode === "minor" && secondMode === "major" && interval === 3) return 0.98;
  if (firstMode === secondMode && [5, 7].includes(interval)) return 0.92;
  if (interval === 0) return 0.84;
  if (firstMode === secondMode && [2, 10].includes(interval)) return 0.72;
  return 0.30;
}

function transitionMetrics(previous: JsonRecord, candidate: JsonRecord, anchor: JsonRecord) {
  const previousProfile = previous.profile;
  const candidateProfile = candidate.profile;
  const tempoDifference = transitionTempoDifference(previousProfile.bpm, candidateProfile.bpm);
  const tempo = Math.exp(-tempoDifference / 12);
  const chromaDirect = Math.max(0, cosine(previous.vector.slice(23, 35), candidate.vector.slice(23, 35)));
  const key = keyCompatibility(previous, candidate);
  const harmony = Math.max(0, Math.min(1, 0.72 * key + 0.28 * chromaDirect));
  const [, timbre] = components(previous, candidate);
  const energy = meanScaledDifference(
    [previousProfile.energy, previousProfile.aggression, previousProfile.dynamic_range, previousProfile.danceability],
    [candidateProfile.energy, candidateProfile.aggression, candidateProfile.dynamic_range, candidateProfile.danceability],
    [55, 1, 1, 1],
    1.7,
  );
  const currentStyle = styleSimilarity(previous.track.provider_subgenre, candidate.track.provider_subgenre);
  const anchorStyle = styleSimilarity(anchor.track.provider_subgenre, candidate.track.provider_subgenre);
  const lyrics = lyricSimilarity(previous, candidate);
  const base = lyrics === null
    ? 0.36 * tempo + 0.30 * harmony + 0.20 * timbre + 0.14 * energy
    : 0.34 * tempo + 0.28 * harmony + 0.18 * timbre + 0.12 * energy + 0.08 * lyrics;
  const score = base * (0.78 + 0.22 * currentStyle) * (0.90 + 0.10 * anchorStyle);
  const reasons: string[] = [];
  if (tempoDifference <= 5) reasons.push(`${Math.round(previousProfile.bpm)}→${Math.round(candidateProfile.bpm)} BPM`);
  if (key >= 0.90) reasons.push(`${previousProfile.key} ${previousProfile.mode}→${candidateProfile.key} ${candidateProfile.mode}`);
  if (energy >= 0.88) reasons.push("steady energy handoff");
  if (timbre >= 0.86) reasons.push("matched texture");
  if (lyrics !== null && lyrics >= 0.82) reasons.push("lyrical mood continuity");
  if (!reasons.length) reasons.push("balanced tempo and tone");
  return {
    parts: [tempo, timbre, harmony] as [number, number, number],
    score: Math.max(0, Math.min(1, score)),
    reasons: reasons.slice(0, 3),
    lyrics,
    note: `${Math.round(previousProfile.bpm)}→${Math.round(candidateProfile.bpm)} BPM · ${previousProfile.key} ${previousProfile.mode}→${candidateProfile.key} ${candidateProfile.mode}`,
  };
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
  const selection = "track_id,title,artist,album,year,artwork_url,preview_url,external_url,source,provider_genre,seed_genre,provider_subgenre,acoustic_fingerprints(acoustic_signature,profile)";
  let rows: JsonRecord[] = [];
  let total = 0;
  if (!q) {
    const { data, error, count } = await admin.from("tracks").select(selection, { count: "exact" })
      .order("title", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new ApiError(503, error.message);
    rows = data ?? [];
    total = count ?? rows.length;
  } else {
    const { data: ranked, error: rankError } = await admin.rpc("search_tracks_fuzzy", {
      search_query: q,
      result_limit: Math.min(200, page * pageSize + 40),
    });
    if (rankError) throw new ApiError(503, rankError.message);
    const ids = (ranked ?? []).map((row: JsonRecord) => String(row.track_id));
    if (ids.length) {
      const { data, error } = await admin.from("tracks").select(selection).in("track_id", ids);
      if (error) throw new ApiError(503, error.message);
      const byId = new Map((data ?? []).map((row: JsonRecord) => [String(row.track_id), row]));
      rows = ids.map((id: string) => byId.get(id)).filter(Boolean) as JsonRecord[];
    }
    total = rows.length;
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
  }
  const results = rows.map((row: JsonRecord) => {
    const fingerprint = Array.isArray(row.acoustic_fingerprints) ? row.acoustic_fingerprints[0] : row.acoustic_fingerprints;
    return cleanTrack(row, fingerprint);
  });
  return { results, total, page, page_size: pageSize };
}

async function chartTracks(input: JsonRecord) {
  const country = String(input.country ?? "us").toLowerCase() === "in" ? "in" : "us";
  const cached = chartCache.get(country);
  if (cached && cached.expiresAt > Date.now()) return { country, updated_at: new Date(cached.expiresAt - 30 * 60_000).toISOString(), tracks: cached.rows };
  const feedResponse = await fetch(`https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/50/songs.json`, { signal: AbortSignal.timeout(8_000) });
  if (!feedResponse.ok) throw new ApiError(503, "The country chart is temporarily unavailable");
  const feed = await feedResponse.json();
  const results = Array.isArray(feed?.feed?.results) ? feed.feed.results : [];
  const ids = results.map((item: JsonRecord) => String(item.id)).filter(Boolean);
  let lookupById = new Map<string, JsonRecord>();
  if (ids.length) {
    const lookupResponse = await fetch(`https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}&entity=song`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (lookupResponse?.ok) {
      const lookup = await lookupResponse.json();
      lookupById = new Map((lookup.results ?? []).map((item: JsonRecord) => [String(item.trackId), item]));
    }
  }
  const { data: matches, error: matchError } = await admin.rpc("match_chart_tracks", {
    chart_items: results.map((item: JsonRecord) => ({ id: String(item.id), title: item.name, artist: item.artistName })),
  });
  if (matchError) throw new ApiError(503, `Could not match the country chart: ${matchError.message}`);
  const catalogByChartId = new Map((matches ?? []).map((row: JsonRecord) => [String(row.chart_id), row]));
  const tracks = results.map((item: JsonRecord, index: number) => {
    const lookup = lookupById.get(String(item.id));
    const catalog = catalogByChartId.get(String(item.id));
    const base = catalog ? cleanTrack(catalog.track_row, catalog.fingerprint_row) : {
      track_id: `chart-${country}-${item.id}`,
      title: item.name,
      artist: item.artistName,
      album: item.collectionName ?? null,
      artwork_url: item.artworkUrl100,
      preview_url: lookup?.previewUrl ?? null,
      external_url: item.url,
      source: "Country chart",
      bpm: null,
      acoustic_signature: null,
      lyrics_available: false,
    };
    return {
      ...base,
      title: item.name,
      artist: item.artistName,
      artwork_url: String(item.artworkUrl100 ?? base.artwork_url ?? "").replace("100x100", "600x600"),
      preview_url: base.preview_url ?? lookup?.previewUrl ?? null,
      chart_rank: index + 1,
      chart_country: country,
      catalogued: Boolean(catalog),
    };
  });
  chartCache.set(country, { expiresAt: Date.now() + 30 * 60_000, rows: tracks });
  return { country, updated_at: feed?.feed?.updated ?? new Date().toISOString(), tracks };
}

function transitionTrack(previous: JsonRecord, candidate: JsonRecord, anchor: JsonRecord, step: number, score?: number) {
  const metrics = transitionMetrics(previous, candidate, anchor);
  return {
    ...cleanTrack(candidate.track, candidate),
    audio_similarity: Number(metrics.parts[0].toFixed(4)),
    timbre_similarity: Number(metrics.parts[1].toFixed(4)),
    lyric_similarity: metrics.lyrics === null ? null : Number(metrics.lyrics.toFixed(4)),
    collab_similarity: Number(metrics.parts[2].toFixed(4)),
    hybrid_score: Number((score ?? metrics.score).toFixed(4)),
    score_mode: "acoustic-bridge",
    match_reasons: metrics.reasons,
    transition_step: step,
    transition_from: `${previous.track.title} — ${previous.track.artist}`,
    transition_note: metrics.note,
  };
}

async function bridge(input: JsonRecord, context: Awaited<ReturnType<typeof userContext>>) {
  const library = await loadLibrary();
  const anchor = library.find((item) => String(item.track_id) === String(input.track_id));
  const destination = library.find((item) => String(item.track_id) === String(input.destination_track_id));
  if (!anchor || !destination) throw new ApiError(404, "Both Sound Bridge tracks must have acoustic fingerprints");
  if (String(anchor.track_id) === String(destination.track_id)) throw new ApiError(422, "Choose two different songs for a Sound Bridge");
  if (!anchor.track.preview_url || !destination.track.preview_url) throw new ApiError(422, "Both Sound Bridge tracks need playable previews");

  const usedTrackIds = new Set<string>([String(anchor.track_id), String(destination.track_id)]);
  const usedRecordings = new Set<string>([
    recordingIdentity(anchor.track.title, anchor.track.artist),
    recordingIdentity(destination.track.title, destination.track.artist),
  ]);
  const usedArtists = new Set<string>([normalizedStyle(anchor.track.artist), normalizedStyle(destination.track.artist)]);
  const intermediates: Array<{ row: JsonRecord; score: number }> = [];
  let previous = anchor;

  for (let step = 1; step <= 3; step += 1) {
    const progress = step / 4;
    const goalWeight = 0.22 + progress * 0.46;
    const expectedEnergy = Number(anchor.profile.energy) * (1 - progress) + Number(destination.profile.energy) * progress;
    const expectedBrightness = Number(anchor.profile.brightness) * (1 - progress) + Number(destination.profile.brightness) * progress;
    const ranked = library.flatMap((candidate) => {
      const recordingKey = recordingIdentity(candidate.track.title, candidate.track.artist);
      if (!candidate.track.preview_url || usedTrackIds.has(String(candidate.track_id)) || usedRecordings.has(recordingKey)) return [];
      const handoff = transitionMetrics(previous, candidate, anchor);
      const arrival = transitionMetrics(candidate, destination, destination);
      const energyTrajectory = Math.exp(-Math.abs(Number(candidate.profile.energy) - expectedEnergy) / 18);
      const brightnessTrajectory = Math.exp(-Math.abs(Number(candidate.profile.brightness) - expectedBrightness) / 0.24);
      let score = handoff.score * (1 - goalWeight) + arrival.score * goalWeight;
      score = score * 0.84 + energyTrajectory * 0.10 + brightnessTrajectory * 0.06;
      if (usedArtists.has(normalizedStyle(candidate.track.artist))) score *= 0.68;
      return [{ candidate, recordingKey, score }];
    }).sort((left, right) => right.score - left.score);
    const next = ranked[0];
    if (!next) break;
    intermediates.push({ row: next.candidate, score: next.score });
    usedTrackIds.add(String(next.candidate.track_id));
    usedRecordings.add(next.recordingKey);
    usedArtists.add(normalizedStyle(next.candidate.track.artist));
    previous = next.candidate;
  }

  const recommendations = intermediates.map((item, index) => {
    const prior = index === 0 ? anchor : intermediates[index - 1].row;
    return transitionTrack(prior, item.row, anchor, index + 1, item.score);
  });
  recommendations.push(transitionTrack(previous, destination, anchor, recommendations.length + 1));

  if (context) {
    const { data: run, error } = await context.client.from("recommendation_runs").insert({
      user_id: context.user.id,
      anchor_track_id: String(anchor.track_id),
      anchor_title: anchor.track.title,
      anchor_artist: anchor.track.artist,
      mode: "transition",
      weights: { rhythm: 0.42, timbre: 0.25, harmony: 0.33, bridge_destination: String(destination.track_id) },
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
    destination: cleanTrack(destination.track, destination),
    recommendations,
    score_mode: "acoustic-bridge",
    total: recommendations.length,
  };
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
  const positiveFingerprints: JsonRecord[] = [];
  const negativeFingerprints: JsonRecord[] = [];
  if (context) {
    const [{ data: favorites }, { data: interactions }, { data: items }] = await Promise.all([
      context.client.from("favorites").select("track_id"),
      context.client.from("interactions").select("track_id,event_type"),
      context.client.from("recommendation_items").select("track_id"),
    ]);
    const favoriteIds = new Set((favorites ?? []).map((row: JsonRecord) => String(row.track_id)));
    const positiveIds = new Set<string>(favoriteIds);
    const negativeIds = new Set<string>();
    for (const row of interactions ?? []) {
      seen.add(String(row.track_id));
      if (["liked", "preview_completed", "youtube_opened"].includes(row.event_type)) positiveIds.add(String(row.track_id));
      if (["disliked", "dismissed"].includes(row.event_type)) negativeIds.add(String(row.track_id));
    }
    for (const row of items ?? []) seen.add(String(row.track_id));
    positiveFingerprints.push(...library.filter((row) => positiveIds.has(String(row.track_id))));
    negativeFingerprints.push(...library.filter((row) => negativeIds.has(String(row.track_id))));
  }

  const chosenWeights = mode === "similar" && input.weights
    ? [Number(input.weights.audio), Number(input.weights.lyric), Number(input.weights.collab)] as [number, number, number]
    : modeWeights[mode];
  if (chosenWeights.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(chosenWeights.reduce((a, b) => a + b, 0) - 1) > 0.01) {
    throw new ApiError(400, "Recommendation weights must be non-negative and sum to 1");
  }

  let recommendations: JsonRecord[];
  if (mode === "transition") {
    const usedTrackIds = new Set<string>([String(anchor.track_id)]);
    const usedRecordings = new Set<string>([recordingIdentity(anchor.track.title, anchor.track.artist)]);
    const usedArtists = new Set<string>([normalizedStyle(anchor.track.artist)]);
    const chain: JsonRecord[] = [];
    let previous = anchor;
    for (let step = 1; step <= k; step += 1) {
      const shortlist = library.flatMap((candidate) => {
        const recordingKey = recordingIdentity(candidate.track.title, candidate.track.artist);
        if (usedTrackIds.has(String(candidate.track_id)) || usedRecordings.has(recordingKey)) return [];
        if (!candidate.track.preview_url) return [];
        const tempo = Math.exp(-transitionTempoDifference(previous.profile.bpm, candidate.profile.bpm) / 12);
        const key = keyCompatibility(previous, candidate);
        const style = styleSimilarity(previous.track.provider_subgenre, candidate.track.provider_subgenre);
        return [{ candidate, recordingKey, roughScore: 0.50 * tempo + 0.32 * key + 0.18 * style }];
      }).sort((left, right) => right.roughScore - left.roughScore).slice(0, 520);
      const ranked = shortlist.map(({ candidate, recordingKey }) => {
        const metrics = transitionMetrics(previous, candidate, anchor);
        let score = metrics.score;
        if (usedArtists.has(normalizedStyle(candidate.track.artist))) score *= 0.62;
        return { candidate, recordingKey, metrics, score };
      }).sort((left, right) => right.score - left.score);
      const next = ranked[0];
      if (!next) break;
      chain.push({
        ...cleanTrack(next.candidate.track, next.candidate),
        audio_similarity: Number(next.metrics.parts[0].toFixed(4)),
        timbre_similarity: Number(next.metrics.parts[1].toFixed(4)),
        lyric_similarity: next.metrics.lyrics === null ? null : Number(next.metrics.lyrics.toFixed(4)),
        collab_similarity: Number(next.metrics.parts[2].toFixed(4)),
        hybrid_score: Number(next.score.toFixed(4)),
        score_mode: "acoustic-transition",
        match_reasons: next.metrics.reasons,
        transition_step: step,
        transition_from: `${previous.track.title} — ${previous.track.artist}`,
        transition_note: next.metrics.note,
      });
      usedTrackIds.add(String(next.candidate.track_id));
      usedRecordings.add(next.recordingKey);
      usedArtists.add(normalizedStyle(next.candidate.track.artist));
      previous = next.candidate;
    }
    recommendations = chain;
  } else {
    const scored = library.flatMap((candidate) => {
    if (candidate.track_id === anchor.track_id) return [];
    if (recordingIdentity(candidate.track.title, candidate.track.artist) === recordingIdentity(anchor.track.title, anchor.track.artist)) return [];
    let parts = components(anchor, candidate);
    if (mode === "personalized" && positiveFingerprints.length) {
      const taste = positiveFingerprints.map((positive) => components(positive, candidate));
      const best = taste.sort((left, right) => weightedScore(right, chosenWeights) - weightedScore(left, chosenWeights))[0];
      parts = [
        0.65 * parts[0] + 0.35 * best[0],
        0.65 * parts[1] + 0.35 * best[1],
        0.65 * parts[2] + 0.35 * best[2],
      ] as [number, number, number];
    }
    const [rhythm, timbre, harmony] = parts;
    const acousticScore = weightedScore(parts, chosenWeights);
    const lyrics = lyricSimilarity(anchor, candidate);
    const lyricWeight = lyricWeights[mode];
    const base = lyrics === null
      ? acousticScore
      : (1 - lyricWeight) * acousticScore + lyricWeight * lyrics;
    const style = styleSimilarity(anchor.track.provider_subgenre, candidate.track.provider_subgenre);
    let total = base * (0.52 + 0.48 * style);
    if (mode === "discover" && normalizedStyle(candidate.track.artist) === normalizedStyle(anchor.track.artist)) total *= 0.72;
    if (seen.has(String(candidate.track_id))) total *= mode === "discover" ? 0.40 : 0.76;
    if (negativeFingerprints.length) {
      const negativeAffinity = Math.max(...negativeFingerprints.map((negative) => weightedScore(components(negative, candidate), chosenWeights)));
      if (negativeAffinity > 0.72) total *= 1 - 0.45 * Math.min(1, (negativeAffinity - 0.72) / 0.28);
    }
    return [{
      ...cleanTrack(candidate.track, candidate),
      audio_similarity: Number(rhythm.toFixed(4)),
      timbre_similarity: Number(timbre.toFixed(4)),
      lyric_similarity: lyrics === null ? null : Number(lyrics.toFixed(4)),
      collab_similarity: Number(harmony.toFixed(4)),
      hybrid_score: Number(Math.max(0, Math.min(1, total)).toFixed(4)),
      score_mode: `acoustic-fingerprint-${mode}`,
      match_reasons: lyrics !== null && lyrics >= 0.82
        ? [...matchReasons(anchor, candidate, parts), "related lyrical themes"].slice(0, 3)
        : matchReasons(anchor, candidate, parts),
    }];
    }).sort((a, b) => b.hybrid_score - a.hybrid_score);

    const recordings = new Set<string>();
    const artistCounts = new Map<string, number>();
    const diverse = scored.filter((item) => {
      const key = recordingIdentity(item.title, item.artist);
      if (recordings.has(key)) return false;
      const artistKey = item.artist.trim().toLowerCase();
      if ((artistCounts.get(artistKey) ?? 0) >= 2) return false;
      recordings.add(key);
      artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
      return true;
    });
    recommendations = diverse.slice(0, k);
    if (recommendations.length < k) {
      const selected = new Set(recommendations.map((item) => item.track_id));
      const selectedRecordings = new Set(recommendations.map((item) => recordingIdentity(item.title, item.artist)));
      for (const item of scored) {
        const key = recordingIdentity(item.title, item.artist);
        if (!selected.has(item.track_id) && !selectedRecordings.has(key)) {
          recommendations.push(item);
          selected.add(item.track_id);
          selectedRecordings.add(key);
        }
        if (recommendations.length >= k) break;
      }
    }
  }

  if (context) {
    const weights = { rhythm: chosenWeights[0], timbre: chosenWeights[1], harmony: chosenWeights[2], lyrics: lyricWeights[mode] };
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
    weights_used: { rhythm: chosenWeights[0], timbre: chosenWeights[1], harmony: chosenWeights[2], lyrics: lyricWeights[mode] },
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
    const [{ count: tracks }, { count: indexed }] = await Promise.all([
      admin.from("tracks").select("track_id", { count: "exact" }).limit(1),
      admin.from("acoustic_fingerprints").select("track_id", { count: "exact", head: true }),
    ]);
    return { status: "ok", models_loaded: true, total_tracks: tracks ?? indexed ?? 0, acoustic_indexed: indexed ?? 0, acoustic_indexing: false };
  }
  if (action === "acousticStatus") {
    const [{ count: tracks }, { count: failures }, { count: indexed }] = await Promise.all([
      admin.from("tracks").select("track_id", { count: "exact" }).limit(1),
      admin.from("fingerprint_failures").select("track_id", { count: "exact" }).limit(1),
      admin.from("acoustic_fingerprints").select("track_id", { count: "exact", head: true }),
    ]);
    const total = tracks ?? indexed ?? 0;
    return { indexed: indexed ?? 0, total, remaining: Math.max(0, total - (indexed ?? 0)), failures: failures ?? 0, building: false };
  }
  if (action === "tracks") return searchTracks(input);
  if (action === "charts") return chartTracks(input);
  if (action === "lyricStatus") {
    const [{ count: analyzed }, { count: total }] = await Promise.all([
      admin.from("lyric_features").select("track_id", { count: "exact", head: true }),
      admin.from("acoustic_fingerprints").select("track_id", { count: "exact", head: true }),
    ]);
    return {
      analyzed: analyzed ?? 0,
      total: total ?? 0,
      provider_configured: Boolean(Deno.env.get("MUSIXMATCH_API_KEY")),
      stores_raw_lyrics: false,
    };
  }
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
      dimensions: ["tempo", "intensity", "texture", "rhythm character", "harmonic character", "lyrical themes"],
    };
  }
  if (action === "bridge") return bridge(input, context);
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
