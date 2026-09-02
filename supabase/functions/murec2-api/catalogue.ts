type Row = Record<string, any>;

const TRACK_FIELDS = "track_id,title,artist,album,year,artwork_url,preview_url,external_url,source,provider_genre,seed_genre,provider_subgenre";
const LYRIC_FIELDS = "track_id,language,instrumental,themes,theme_vector,sentiment,arousal,confidence";

// A warm worker shares one load, including concurrent recommendations and mixes.
// This is an optimisation, not a persistent cache across worker cold starts.
export function cachedLoad<T>(loader: () => Promise<T>, ttl: number, now = Date.now) {
  let value: T;
  let expiresAt = 0;
  let pending: Promise<T> | null = null;
  const peek = () => now() < expiresAt ? value : undefined;
  const load = () => {
    if (now() < expiresAt) return Promise.resolve(value);
    if (pending) return pending;
    pending = Promise.resolve().then(loader).then((result) => {
      value = result;
      expiresAt = now() + ttl;
      return result;
    }).finally(() => { pending = null; });
    return pending;
  };
  return { load, peek };
}

export function createCatalogue(admin: any, fail: (message: string) => Error, now = Date.now) {
  async function pages(table: string, fields: string) {
    const rows: Row[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await admin.from(table).select(fields)
        .order("track_id", { ascending: true }).range(start, start + 999);
      if (error) throw fail(`Could not load ${table}: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) return rows;
    }
  }

  const library = cachedLoad(async () => {
    const rows = await pages("acoustic_fingerprints", `track_id,vector,profile,acoustic_signature,tracks!inner(${TRACK_FIELDS})`);
    const lyrics = await pages("lyric_features", LYRIC_FIELDS);
    const byTrack = new Map(lyrics.map((row) => [String(row.track_id), row]));
    return rows.map<Row>(({ tracks, ...row }) => ({
      ...row,
      track: Array.isArray(tracks) ? tracks[0] : tracks,
      lyrics: byTrack.get(String(row.track_id)) ?? null,
    }));
  }, 30 * 60_000, now);

  const genres = cachedLoad(async () => {
    // Never download vectors, lyric features or artwork URLs for a menu.
    const warm = library.peek();
    const rows = warm
      ? warm.map((row: Row) => ({ texture: row.profile?.texture, acoustic_signature: row.acoustic_signature }))
      : await pages("acoustic_fingerprints", "texture:profile->>texture,acoustic_signature");
    return {
      genres: [...new Set(rows.map((row: Row) => row.texture).filter(Boolean))].sort(),
      subgenres: [...new Set(rows.map((row: Row) => row.acoustic_signature).filter(Boolean))].sort(),
    };
  }, 30 * 60_000, now);

  async function track(trackId: string): Promise<Row | null> {
    const warm = library.peek()?.find((row: Row) => String(row.track_id) === trackId);
    if (warm) return warm;
    const { data, error } = await admin.from("acoustic_fingerprints")
      .select(`track_id,profile,acoustic_signature,tracks!inner(${TRACK_FIELDS})`)
      .eq("track_id", trackId).maybeSingle();
    if (error) throw fail(`Could not load track: ${error.message}`);
    if (!data) return null;
    const { data: lyrics, error: lyricError } = await admin.from("lyric_features")
      .select(LYRIC_FIELDS).eq("track_id", trackId).maybeSingle();
    if (lyricError) throw fail(`Could not load lyric features: ${lyricError.message}`);
    const { tracks, ...row } = data;
    return { ...row, track: Array.isArray(tracks) ? tracks[0] : tracks, lyrics };
  }

  return { loadLibrary: library.load, loadGenres: genres.load, loadTrack: track };
}
