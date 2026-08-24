import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, any>;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const musixmatchKey = Deno.env.get("MUSIXMATCH_API_KEY") ?? "";
const ingestToken = Deno.env.get("LYRICS_INGEST_TOKEN") ?? "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const themes: Record<string, string[]> = {
  love: ["love", "lover", "heart", "kiss", "romance", "pyaar", "ishq", "kadhal", "anbu"],
  loss: ["lost", "goodbye", "gone", "miss", "tears", "broken", "alone", "judai", "tanha", "pirivu"],
  confidence: ["strong", "power", "king", "queen", "win", "rise", "fearless", "jeet", "veeram"],
  celebration: ["party", "dance", "tonight", "club", "celebrate", "happy", "nach", "aadu"],
  isolation: ["lonely", "empty", "silence", "nobody", "distant", "darkness", "tanha", "thanimai"],
  struggle: ["fight", "pain", "war", "survive", "hurt", "battle", "sangharsh", "vali"],
  hope: ["hope", "dream", "tomorrow", "light", "believe", "free", "umeed", "nambikkai"],
  anger: ["anger", "hate", "rage", "enemy", "burn", "revenge", "gussa", "kobam"],
  nostalgia: ["remember", "memory", "yesterday", "home", "childhood", "again", "yaad", "ninaivu"],
  spirituality: ["god", "heaven", "pray", "soul", "faith", "divine", "bhagwan", "rab", "kadavul"],
};

const positiveWords = new Set(["love", "happy", "joy", "hope", "dream", "smile", "free", "light", "win", "beautiful", "pyaar", "khushi", "anbu"]);
const negativeWords = new Set(["hate", "pain", "hurt", "sad", "lonely", "lost", "cry", "dark", "death", "broken", "gussa", "tanha", "vali"]);
const arousalWords = new Set(["dance", "party", "run", "fire", "fight", "rage", "tonight", "loud", "burn", "power", "nach", "aadu"]);

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function analyzeLyrics(text: string, language: string | null) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const counts: Record<string, number> = {};
  for (const [theme, vocabulary] of Object.entries(themes)) {
    counts[theme] = words.reduce((total, word) => total + Number(vocabulary.includes(word)), 0);
  }
  const maximum = Math.max(1, ...Object.values(counts));
  const vector = Object.fromEntries(Object.entries(counts).map(([theme, count]) => [theme, Number((count / maximum).toFixed(4))]));
  const rankedThemes = Object.entries(counts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([theme]) => theme);
  const positive = words.reduce((total, word) => total + Number(positiveWords.has(word)), 0);
  const negative = words.reduce((total, word) => total + Number(negativeWords.has(word)), 0);
  const arousal = words.reduce((total, word) => total + Number(arousalWords.has(word)), 0);
  const emotionalCount = positive + negative;
  return {
    language,
    instrumental: words.length < 8,
    themes: rankedThemes,
    theme_vector: vector,
    sentiment: emotionalCount ? Math.max(-1, Math.min(1, (positive - negative) / emotionalCount)) : 0,
    arousal: Math.max(0, Math.min(1, arousal / Math.max(8, words.length * .035))),
    confidence: Math.max(.25, Math.min(.95, .45 + words.length / 900 + rankedThemes.length * .06)),
  };
}

async function musixmatch(path: string, params: Record<string, string>) {
  const url = new URL(`https://api.musixmatch.com/ws/1.1/${path}`);
  Object.entries({ ...params, apikey: musixmatchKey, format: "json" }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Musixmatch returned ${response.status}`);
  const body = await response.json();
  const status = Number(body?.message?.header?.status_code ?? 500);
  if (status !== 200) return null;
  return body.message.body;
}

async function analyzeTrack(track: JsonRecord) {
  const search = await musixmatch("track.search", { q_track: track.title, q_artist: track.artist, page_size: "1", s_track_rating: "desc" });
  const match = search?.track_list?.[0]?.track;
  if (!match?.track_id || Number(match.track_spotify_id === "" && match.track_rating === 0)) return { status: "not-found", track };
  const response = await musixmatch("track.lyrics.get", { track_id: String(match.track_id) });
  const lyrics = response?.lyrics;
  if (!lyrics?.lyrics_body) return { status: "no-lyrics", track };
  const features = analyzeLyrics(String(lyrics.lyrics_body), lyrics.lyrics_language ?? match.track_language ?? null);
  const { error } = await admin.from("lyric_features").upsert({
    track_id: track.track_id,
    provider: "musixmatch",
    provider_track_id: String(match.track_id),
    ...features,
    analyzed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { status: "analyzed", track_id: track.track_id, themes: features.themes, language: features.language };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply({ detail: "Method not allowed" }, 405);
  if (!musixmatchKey || !ingestToken) return reply({ detail: "Lyric enrichment is not configured" }, 503);
  if (request.headers.get("x-ingest-token") !== ingestToken) return reply({ detail: "Unauthorized" }, 401);
  try {
    const input = await request.json().catch(() => ({}));
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 10)));
    const { data: analyzed, error: analyzedError } = await admin.from("lyric_features").select("track_id");
    if (analyzedError) throw new Error(analyzedError.message);
    const analyzedIds = new Set((analyzed ?? []).map((row: JsonRecord) => String(row.track_id)));
    const { data: candidates, error } = await admin.from("tracks").select("track_id,title,artist").order("track_id").limit(1000);
    if (error) throw new Error(error.message);
    const batch = (candidates ?? []).filter((track: JsonRecord) => !analyzedIds.has(String(track.track_id))).slice(0, limit);
    const results = [];
    for (const track of batch) {
      try { results.push(await analyzeTrack(track)); }
      catch (error) { results.push({ status: "error", track_id: track.track_id, detail: error instanceof Error ? error.message : String(error) }); }
    }
    return reply({ processed: results.length, analyzed: results.filter((item) => item.status === "analyzed").length, results });
  } catch (error) {
    return reply({ detail: error instanceof Error ? error.message : String(error) }, 500);
  }
});
