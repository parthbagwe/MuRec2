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
    "heavy metal", "nu metal", "alternative metal", "metalcore", "deathcore", "thrash metal",
    "death metal", "melodic death metal", "black metal", "doom metal", "sludge metal", "groove metal",
    "progressive metal", "industrial metal", "power metal", "symphonic metal", "gothic metal", "folk metal", "glam metal",
  ]),
  rock: new Set([
    "rock", "classic rock", "alternative rock", "indie rock", "hard rock", "soft rock", "progressive rock",
    "psychedelic rock", "garage rock", "blues rock", "southern rock", "post-rock", "math rock", "grunge", "shoegaze", "noise rock",
  ]),
  punk: new Set(["punk rock", "pop punk", "post punk", "hardcore punk", "post-hardcore", "emo", "screamo", "skate punk", "crust punk", "anarcho-punk"]),
  pop: new Set(["pop", "dance pop", "electropop", "synthpop", "indie pop", "dream pop", "art pop", "bedroom pop", "hyperpop", "teen pop", "psychedelic pop", "chamber pop", "k-pop", "j-pop"]),
  "hip-hop": new Set(["hip-hop", "boom bap", "trap", "drill", "conscious hip-hop", "alternative hip-hop", "cloud rap", "jazz rap", "gangsta rap", "lo-fi hip-hop", "rage", "grime", "desi hip-hop", "tamil hip-hop"]),
  "r&b": new Set(["r&b", "contemporary r&b", "alternative r&b", "neo soul", "soul", "classic soul", "funk", "quiet storm", "motown", "gospel soul"]),
  electronic: new Set(["electronic", "house", "deep house", "progressive house", "techno", "trance", "ambient", "downtempo", "trip-hop", "drum and bass", "jungle", "dubstep", "uk garage", "breakbeat", "idm", "future bass", "disco", "electro", "amapiano"]),
  "indian-film": new Set(["bollywood", "hindi film romantic", "hindi film dance", "tamil film melody", "tamil kuthu", "tamil gaana", "telugu film music", "malayalam film music", "indian film orchestral", "indian soundtrack"]),
  "indian-classical": new Set(["hindustani classical", "carnatic classical", "thumri", "dhrupad", "khayal", "instrumental raga", "semi-classical indian", "tarana"]),
  "indian-folk": new Set(["bhangra", "punjabi folk", "rajasthani folk", "baul", "qawwali", "ghazal", "bhajan", "sufi", "devotional", "lavani", "bhojpuri folk", "garba"]),
  global: new Set(["afrobeat", "afrobeats", "reggae", "dancehall", "reggaeton", "latin pop", "salsa", "bachata", "bossa nova", "samba", "flamenco", "arabic pop", "c-pop", "mandopop"]),
  "jazz-blues": new Set(["jazz", "bebop", "cool jazz", "modal jazz", "jazz fusion", "smooth jazz", "vocal jazz", "blues", "delta blues", "electric blues", "soul blues"]),
  "folk-country": new Set(["folk", "singer-songwriter", "indie folk", "folk rock", "americana", "country", "country pop", "alt-country", "bluegrass"]),
  "classical-cinematic": new Set(["classical", "baroque", "romantic classical", "modern classical", "minimalism", "orchestral", "film score", "game soundtrack", "musical theatre", "opera"]),
};
const providerTaxonomy = [...new Set(Object.values(styleFamilies).flatMap((styles) => [...styles]))].sort();
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
const globalSearchCache = new Map<string, { expiresAt: number; rows: JsonRecord[] }>();

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
    provider_genre: track.provider_genre ?? null,
    provider_subgenre: track.provider_subgenre ?? null,
    seed_genre: track.seed_genre ?? null,
    acoustic_signature: signature,
    analysis_status: signature ? "complete" : "pending",
    lyrics_available: Boolean(fingerprint?.lyrics?.confidence > 0),
    lyric_themes: fingerprint?.lyrics?.themes ?? [],
    lyric_language: fingerprint?.lyrics?.language ?? null,
  };
}

function transientAnchor(input: JsonRecord) {
  const track = input.anchor_track;
  const analysis = input.anchor_analysis;
  if (!track || !analysis) return null;
  const trackId = String(input.track_id ?? "");
  if (!trackId || String(track.track_id ?? "") !== trackId) throw new ApiError(422, "The live analysis does not match the selected track");
  const vector = Array.isArray(analysis.vector) ? analysis.vector.map(Number) : [];
  if (vector.length !== 35 || vector.some((value: number) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)) {
    throw new ApiError(422, "The live acoustic fingerprint is invalid");
  }
  const rawProfile = analysis.profile ?? {};
  const numericKeys = [
    "bpm", "energy", "brightness", "spectral_centroid_hz", "spectral_rolloff_hz", "zero_crossing_rate",
    "tempo_confidence", "spectral_flatness", "spectral_contrast", "onset_density", "beat_regularity",
    "dynamic_range", "harmonic_ratio", "percussive_ratio", "tonal_strength", "danceability", "aggression",
  ];
  const profile: JsonRecord = {};
  for (const key of numericKeys) {
    const value = Number(rawProfile[key]);
    if (!Number.isFinite(value)) throw new ApiError(422, `The live acoustic profile is missing ${key}`);
    profile[key] = value;
  }
  for (const key of ["key", "mode", "timbre", "texture", "tempo_band", "intensity", "rhythm_character", "harmonic_character"]) {
    profile[key] = String(rawProfile[key] ?? "unknown").slice(0, 64);
  }
  profile.analysis_source = "client-preview-v1";
  const acousticSignature = String(analysis.acoustic_signature ?? rawProfile.acoustic_signature ?? "live acoustic scan").slice(0, 240);
  profile.acoustic_signature = acousticSignature;
  const safeTrack = {
    track_id: trackId,
    title: String(track.title ?? "Unknown title").slice(0, 180),
    artist: String(track.artist ?? "Unknown artist").slice(0, 180),
    album: String(track.album ?? "").slice(0, 240),
    year: Number.isFinite(Number(track.year)) ? Number(track.year) : null,
    artwork_url: String(track.artwork_url ?? "").slice(0, 1200),
    preview_url: String(track.preview_url ?? "").slice(0, 1200),
    external_url: String(track.external_url ?? "").slice(0, 1200),
    source: String(track.source ?? "Live preview").slice(0, 80),
    provider_genre: String(track.provider_genre ?? "").slice(0, 120),
    provider_subgenre: String(track.provider_subgenre ?? track.provider_genre ?? "").slice(0, 120),
    seed_genre: String(track.seed_genre ?? "").slice(0, 120),
  };
  return { track_id: trackId, track: safeTrack, vector, profile, acoustic_signature: acousticSignature, lyrics: null };
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

function normalizedSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function editSimilarity(first: string, second: string) {
  if (first === second) return 1;
  if (!first || !second) return 0;
  const left = first.slice(0, 180);
  const right = second.slice(0, 180);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return Math.max(0, 1 - previous[right.length] / Math.max(left.length, right.length));
}

function fuzzyTokenMatch(queryToken: string, candidateToken: string) {
  if (queryToken === candidateToken) return true;
  if (queryToken.length < 4 || candidateToken.length < 4) return false;
  return editSimilarity(queryToken, candidateToken) >= (Math.max(queryToken.length, candidateToken.length) <= 5 ? 0.8 : 0.72);
}

function tokenCoverage(queryTokens: string[], candidateTokens: string[]) {
  if (!queryTokens.length) return 0;
  return queryTokens.filter((queryToken) => candidateTokens.some((candidateToken) => fuzzyTokenMatch(queryToken, candidateToken))).length / queryTokens.length;
}

function searchRelevance(track: JsonRecord, query: string) {
  const normalizedQuery = normalizedSearchText(query);
  const title = normalizedSearchText(track.title);
  const artist = normalizedSearchText(track.artist);
  const combined = `${title} ${artist}`.trim();
  const artistFirst = `${artist} ${title}`.trim();
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const titleTokens = title.split(" ").filter(Boolean);
  const artistTokens = artist.split(" ").filter(Boolean);
  const combinedTokens = [...titleTokens, ...artistTokens];
  const coverage = tokenCoverage(queryTokens, combinedTokens);
  const titleCoverage = tokenCoverage(queryTokens, titleTokens);
  const artistCoverage = tokenCoverage(queryTokens, artistTokens);
  let score = coverage * 40 + titleCoverage * 10 + artistCoverage * 6;
  if (combined === normalizedQuery || artistFirst === normalizedQuery) score += 80;
  if (title === normalizedQuery) score += 65;
  if (combined.includes(normalizedQuery) || artistFirst.includes(normalizedQuery)) score += 30;
  if (normalizedQuery.includes(title) && title.length >= 3) score += 22;
  if (combined.startsWith(normalizedQuery) || artistFirst.startsWith(normalizedQuery)) score += 12;
  score += editSimilarity(normalizedQuery, combined) * 14;
  score += editSimilarity(normalizedQuery, title) * 6;
  if (coverage < 1) score -= (1 - coverage) * 18;
  if (track.analysis_status === "complete") score += 0.35;
  if (track.preview_url) score += 0.15;
  return score;
}

function preferSearchDuplicate(first: JsonRecord, second: JsonRecord) {
  if (first.analysis_status !== second.analysis_status) return first.analysis_status === "complete" ? first : second;
  if (Boolean(first.preview_url) !== Boolean(second.preview_url)) return first.preview_url ? first : second;
  return first;
}

function appleTrack(item: JsonRecord) {
  if (!item.trackId || !item.trackName || !item.artistName || !item.trackViewUrl) return null;
  const release = String(item.releaseDate ?? "");
  return {
    track_id: `apple-${item.trackId}`,
    title: item.trackName,
    artist: item.artistName,
    album: item.collectionName ?? "",
    year: /^\d{4}/.test(release) ? Number(release.slice(0, 4)) : null,
    artwork_url: item.artworkUrl100 ?? "",
    preview_url: item.previewUrl ?? "",
    external_url: item.trackViewUrl,
    source: "Apple Music",
    provider_genre: item.primaryGenreName ?? null,
    provider_subgenre: item.primaryGenreName ?? null,
    seed_genre: null,
  };
}

async function searchGlobalCatalogue(query: string, limit: number) {
  const key = `${normalizedStyle(query)}:${limit}`;
  const cached = globalSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows.slice(0, limit);

  const rows: JsonRecord[] = [];
  const seen = new Set<string>();
  for (const country of ["IN", "US", "GB"]) {
    const url = new URL("https://itunes.apple.com/search");
    url.search = new URLSearchParams({ term: query, media: "music", entity: "song", limit: String(limit), country }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => ({ results: [] }));
    for (const item of payload.results ?? []) {
      const track = appleTrack(item);
      if (!track) continue;
      const identity = recordingIdentity(track.title, track.artist);
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push(track);
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
  }

  if (rows.length < limit) {
    const url = new URL("https://musicbrainz.org/ws/2/recording/");
    url.search = new URLSearchParams({ query, fmt: "json", limit: String(Math.min(25, limit)) }).toString();
    const response = await fetch(url, {
      headers: { "User-Agent": "Cerum/3.0 (https://cerum.vercel.app)" },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (response?.ok) {
      const payload = await response.json().catch(() => ({ recordings: [] }));
      for (const recording of payload.recordings ?? []) {
        const title = String(recording.title ?? "").trim();
        const artist = (recording["artist-credit"] ?? [])
          .map((part: JsonRecord) => `${part.name ?? part.artist?.name ?? ""}${part.joinphrase ?? ""}`)
          .join("").trim();
        if (!title || !artist || !recording.id) continue;
        const identity = recordingIdentity(title, artist);
        if (seen.has(identity)) continue;
        const release = recording.releases?.[0] ?? {};
        const releaseDate = String(release.date ?? recording["first-release-date"] ?? "");
        const tags = [...(recording.tags ?? [])].sort((a: JsonRecord, b: JsonRecord) => Number(b.count ?? 0) - Number(a.count ?? 0));
        rows.push({
          track_id: `mb-${recording.id}`,
          title,
          artist,
          album: release.title ?? "",
          year: /^\d{4}/.test(releaseDate) ? Number(releaseDate.slice(0, 4)) : null,
          artwork_url: "",
          preview_url: "",
          external_url: `https://musicbrainz.org/recording/${recording.id}`,
          source: "MusicBrainz",
          provider_genre: tags[0]?.name ?? null,
          provider_subgenre: tags[0]?.name ?? null,
          seed_genre: null,
        });
        seen.add(identity);
        if (rows.length >= limit) break;
      }
    }
  }
  globalSearchCache.set(key, { expiresAt: Date.now() + 15 * 60_000, rows });
  return rows.slice(0, limit);
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

function primaryGenre(row: JsonRecord) {
  return normalizedStyle(row.track?.provider_genre ?? row.provider_genre ?? row.track?.provider_subgenre ?? row.provider_subgenre);
}

function genreSimilarity(first: JsonRecord, second: JsonRecord) {
  const firstPrimary = primaryGenre(first);
  const secondPrimary = primaryGenre(second);
  if (firstPrimary && firstPrimary === secondPrimary) return 1;
  const firstSubgenre = normalizedStyle(first.track?.provider_subgenre ?? first.provider_subgenre ?? first.track?.seed_genre ?? first.seed_genre);
  const secondSubgenre = normalizedStyle(second.track?.provider_subgenre ?? second.provider_subgenre ?? second.track?.seed_genre ?? second.seed_genre);
  if (firstSubgenre && firstSubgenre === secondSubgenre) return 0.90;
  const subgenreScore = styleSimilarity(firstSubgenre, secondSubgenre);
  const primaryScore = styleSimilarity(firstPrimary, secondPrimary);
  return Math.max(subgenreScore, primaryScore * 0.82);
}

function titleMood(row: JsonRecord) {
  const value = normalizedStyle(`${row.track?.title ?? row.title ?? ""} ${row.track?.album ?? row.album ?? ""}`);
  if (/\b(?:sad|cry|crying|tears?|heartbreak|broken|goodbye|alone|lonely|without you|miss you|lost love|when i was|no love|hate|hurt|pain|bek?hayali|bewafa|judaai?|tadap|dard|channa mereya|agar tum saath ho)\b/.test(value)) return -1;
  if (/\b(?:happy|happiness|celebrate|celebration|party|dance|sunshine|beautiful|good time|one love|in love|love me|marry you|on top|victory|alive|freedom)\b/.test(value)) return 1;
  return null;
}

function vibeSimilarity(first: JsonRecord, second: JsonRecord) {
  const left = first.profile;
  const right = second.profile;
  const acoustic = meanScaledDifference(
    [left.energy, left.danceability, left.brightness, left.aggression, left.dynamic_range, left.onset_density, left.percussive_ratio, left.harmonic_ratio],
    [right.energy, right.danceability, right.brightness, right.aggression, right.dynamic_range, right.onset_density, right.percussive_ratio, right.harmonic_ratio],
    [38, 0.45, 0.45, 0.45, 0.55, 3.5, 0.45, 0.50],
    2.35,
  );
  const character = (
    Number(left.intensity === right.intensity) +
    Number(left.rhythm_character === right.rhythm_character) +
    Number(left.tempo_band === right.tempo_band)
  ) / 3;
  const leftMood = titleMood(first);
  const rightMood = titleMood(second);
  const title = leftMood === null || rightMood === null ? null : leftMood === rightMood ? 1 : 0;
  const lyric = lyricSimilarity(first, second);
  const semanticSignals = [title, lyric].filter((value): value is number => value !== null);
  const semantic = semanticSignals.length
    ? semanticSignals.reduce((sum, value) => sum + value, 0) / semanticSignals.length
    : null;
  const value = semantic === null
    ? 0.78 * acoustic + 0.22 * character
    : 0.62 * acoustic + 0.18 * character + 0.20 * semantic;
  return { value: Math.max(0, Math.min(1, value)), title, acoustic };
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
  const livePreview = previous.profile.analysis_source === "client-preview-v1" || candidate.profile.analysis_source === "client-preview-v1";
  const harmony = Math.max(0, Math.min(1, (livePreview ? 0.86 : 0.72) * key + (livePreview ? 0.14 : 0.28) * chromaDirect));
  const [, timbre] = components(previous, candidate);
  const energy = meanScaledDifference(
    [previousProfile.energy, previousProfile.aggression, previousProfile.dynamic_range, previousProfile.danceability],
    [candidateProfile.energy, candidateProfile.aggression, candidateProfile.dynamic_range, candidateProfile.danceability],
    [55, 1, 1, 1],
    1.7,
  );
  const currentStyle = styleSimilarity(previous.track.provider_subgenre, candidate.track.provider_subgenre);
  const anchorStyle = styleSimilarity(anchor.track.provider_subgenre, candidate.track.provider_subgenre);
  const genre = genreSimilarity(previous, candidate);
  const vibe = vibeSimilarity(previous, candidate).value;
  const lyrics = lyricSimilarity(previous, candidate);
  const base = lyrics === null
    ? 0.31 * tempo + 0.27 * harmony + 0.17 * timbre + 0.11 * energy + 0.14 * vibe
    : 0.29 * tempo + 0.25 * harmony + 0.16 * timbre + 0.10 * energy + 0.12 * vibe + 0.08 * lyrics;
  const score = base * (0.80 + 0.12 * currentStyle + 0.08 * genre) * (0.92 + 0.08 * anchorStyle);
  const reasons: string[] = [];
  if (tempoDifference <= 5) reasons.push(`${Math.round(previousProfile.bpm)}→${Math.round(candidateProfile.bpm)} BPM`);
  if (key >= 0.90) reasons.push(`${previousProfile.key} ${previousProfile.mode}→${candidateProfile.key} ${candidateProfile.mode}`);
  if (energy >= 0.88) reasons.push("steady energy handoff");
  if (timbre >= 0.86) reasons.push("matched texture");
  if (vibe >= 0.86) reasons.push("same vibe");
  if (lyrics !== null && lyrics >= 0.82) reasons.push("lyrical mood continuity");
  if (!reasons.length) reasons.push("balanced tempo and tone");
  return {
    parts: [tempo, timbre, harmony] as [number, number, number],
    score: Math.max(0, Math.min(1, score)),
    reasons: reasons.slice(0, 3),
    lyrics,
    vibe,
    genre,
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
  const livePreview = first.profile.analysis_source === "client-preview-v1" || second.profile.analysis_source === "client-preview-v1";
  const timbre = (livePreview ? 0.20 : 0.55) * mfcc + (livePreview ? 0.80 : 0.45) * profileSimilarity;

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
  const harmony = Math.max(0, Math.min(1, (livePreview ? 0.35 : 0.65) * chromaSimilarity + (livePreview ? 0.65 : 0.35) * harmonic));
  return [rhythm, timbre, harmony];
}

async function searchTracks(input: JsonRecord) {
  const q = String(input.q ?? "").trim().replace(/[%_,()]/g, " ");
  const page = Math.max(1, Number(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.page_size ?? 20)));
  const selection = "track_id,title,artist,album,year,artwork_url,preview_url,external_url,source,provider_genre,seed_genre,provider_subgenre,acoustic_fingerprints(acoustic_signature,profile)";
  let rows: JsonRecord[] = [];
  let rankedRows: JsonRecord[] = [];
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
    rankedRows = rows;
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
  }
  let results = rows.map((row: JsonRecord) => {
    const fingerprint = Array.isArray(row.acoustic_fingerprints) ? row.acoustic_fingerprints[0] : row.acoustic_fingerprints;
    return cleanTrack(row, fingerprint);
  });
  if (q && page === 1) {
    const catalogueLimit = Math.min(80, Math.max(40, pageSize * 2));
    const external = await searchGlobalCatalogue(q, catalogueLimit);
    const databaseResults = rankedRows.map((row: JsonRecord) => {
      const fingerprint = Array.isArray(row.acoustic_fingerprints) ? row.acoustic_fingerprints[0] : row.acoustic_fingerprints;
      return cleanTrack(row, fingerprint);
    });
    const merged = new Map<string, { track: JsonRecord; order: number }>();
    [...databaseResults, ...external.map((track) => cleanTrack(track))].forEach((track, order) => {
      const identity = recordingIdentity(track.title, track.artist);
      const existing = merged.get(identity);
      merged.set(identity, existing ? { track: preferSearchDuplicate(existing.track, track), order: existing.order } : { track, order });
    });
    results = [...merged.values()]
      .map((entry) => ({ ...entry, relevance: searchRelevance(entry.track, q) }))
      .sort((first, second) => second.relevance - first.relevance || first.order - second.order)
      .slice(0, pageSize)
      .map((entry) => entry.track);
  }
  total = Math.max(total, results.length);
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
    vibe_similarity: Number(metrics.vibe.toFixed(4)),
    genre_similarity: Number(metrics.genre.toFixed(4)),
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
  const genreScope = ["strict", "nearby", "open"].includes(String(input.genre_scope)) ? String(input.genre_scope) : "nearby";
  const vibeLock = input.vibe_lock !== false;
  const k = Math.min(50, Math.max(1, Number(input.k ?? 12)));
  const library = await loadLibrary();
  const anchor = library.find((item) => String(item.track_id) === String(input.track_id)) ?? transientAnchor(input);
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
        const anchorGenre = genreSimilarity(anchor, candidate);
        if (genreScope === "strict" && primaryGenre(anchor) !== primaryGenre(candidate)) return [];
        if (genreScope === "nearby" && anchorGenre < 0.10) return [];
        const tempo = Math.exp(-transitionTempoDifference(previous.profile.bpm, candidate.profile.bpm) / 12);
        const key = keyCompatibility(previous, candidate);
        const style = styleSimilarity(previous.track.provider_subgenre, candidate.track.provider_subgenre);
        return [{ candidate, recordingKey, roughScore: 0.47 * tempo + 0.30 * key + 0.13 * style + 0.10 * anchorGenre }];
      }).sort((left, right) => right.roughScore - left.roughScore).slice(0, 520);
      const ranked = shortlist.map(({ candidate, recordingKey }) => {
        const metrics = transitionMetrics(previous, candidate, anchor);
        let score = metrics.score;
        const anchorVibe = vibeSimilarity(anchor, candidate).value;
        const genre = genreSimilarity(anchor, candidate);
        if (vibeLock) score *= 0.58 + 0.42 * anchorVibe;
        score *= genreScope === "open" ? 0.88 + 0.12 * genre : 0.60 + 0.40 * genre;
        if (usedArtists.has(normalizedStyle(candidate.track.artist))) score *= 0.62;
        return { candidate, recordingKey, metrics, score, anchorVibe, genre };
      }).sort((left, right) => right.score - left.score);
      const next = ranked[0];
      if (!next) break;
      chain.push({
        ...cleanTrack(next.candidate.track, next.candidate),
        audio_similarity: Number(next.metrics.parts[0].toFixed(4)),
        timbre_similarity: Number(next.metrics.parts[1].toFixed(4)),
        lyric_similarity: next.metrics.lyrics === null ? null : Number(next.metrics.lyrics.toFixed(4)),
        vibe_similarity: Number(next.anchorVibe.toFixed(4)),
        genre_similarity: Number(next.genre.toFixed(4)),
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
      const genre = genreSimilarity(anchor, candidate);
      if (genreScope === "strict" && primaryGenre(anchor) !== primaryGenre(candidate)) return [];
      if (genreScope === "nearby" && genre < 0.10) return [];
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
      const vibe = vibeSimilarity(anchor, candidate);
      const lyricWeight = lyricWeights[mode];
      let base = lyrics === null
        ? acousticScore
        : (1 - lyricWeight) * acousticScore + lyricWeight * lyrics;
      if (mode === "rhythm") base = 0.72 * rhythm + 0.12 * vibe.value + 0.10 * harmony + 0.06 * timbre;
      if (mode === "timbre") base = 0.72 * timbre + 0.12 * vibe.value + 0.10 * harmony + 0.06 * rhythm;
      if (mode === "discover") {
        const idHash = [...String(candidate.track_id)].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 997, 7) / 997;
        base = 0.42 * acousticScore + 0.30 * vibe.value + 0.18 * genre + 0.10 * idHash;
      }
      const genreFactor = genreScope === "open" ? 0.86 + 0.14 * genre : 0.56 + 0.44 * genre;
      const vibeFactor = vibeLock ? 0.42 + 0.58 * vibe.value : 1;
      let total = base * genreFactor * vibeFactor;
      if (vibe.title === 0) total *= 0.52;
      if (mode === "discover" && normalizedStyle(candidate.track.artist) === normalizedStyle(anchor.track.artist)) total *= 0.58;
      if (seen.has(String(candidate.track_id))) total *= mode === "discover" ? 0.36 : 0.76;
      if (negativeFingerprints.length) {
        const negativeAffinity = Math.max(...negativeFingerprints.map((negative) => weightedScore(components(negative, candidate), chosenWeights)));
        if (negativeAffinity > 0.72) total *= 1 - 0.45 * Math.min(1, (negativeAffinity - 0.72) / 0.28);
      }
      const reasons = matchReasons(anchor, candidate, parts);
      if (vibe.value >= 0.78) reasons.unshift("same vibe");
      if (genre >= 0.90) reasons.unshift(`same ${primaryGenre(anchor) || "genre"} lane`);
      if (lyrics !== null && lyrics >= 0.82) reasons.unshift("related lyrical themes");
      return [{
        ...cleanTrack(candidate.track, candidate),
        audio_similarity: Number(rhythm.toFixed(4)),
        timbre_similarity: Number(timbre.toFixed(4)),
        lyric_similarity: lyrics === null ? null : Number(lyrics.toFixed(4)),
        collab_similarity: Number(harmony.toFixed(4)),
        vibe_similarity: Number(vibe.value.toFixed(4)),
        genre_similarity: Number(genre.toFixed(4)),
        genre_scope: genreScope,
        hybrid_score: Number(Math.max(0, Math.min(1, total)).toFixed(4)),
        score_mode: `acoustic-fingerprint-${mode}`,
        match_reasons: [...new Set(reasons)].slice(0, 3),
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
    const weights = { rhythm: chosenWeights[0], timbre: chosenWeights[1], harmony: chosenWeights[2], lyrics: lyricWeights[mode], vibe_lock: vibeLock, genre_scope: genreScope };
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
    weights_used: { rhythm: chosenWeights[0], timbre: chosenWeights[1], harmony: chosenWeights[2], lyrics: lyricWeights[mode], vibe_lock: vibeLock, genre_scope: genreScope },
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
      genre_families: Object.keys(styleFamilies).sort(),
      provider_taxonomy: providerTaxonomy,
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
