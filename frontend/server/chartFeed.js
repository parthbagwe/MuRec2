const REGIONS = new Set(["in", "us"]);

function releaseYear(value) {
  const match = String(value || "").match(/^\d{4}/);
  return match ? Number(match[0]) : null;
}

function largerArtwork(value) {
  return String(value || "").replace(/100x100bb/, "300x300bb");
}

export async function fetchAppleCharts(countryInput) {
  const country = REGIONS.has(String(countryInput || "").toLowerCase())
    ? String(countryInput).toLowerCase()
    : "us";
  const feedUrl = `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/50/songs.json`;
  const feedResponse = await fetch(feedUrl, { signal: AbortSignal.timeout(8_000) });
  if (!feedResponse.ok) throw new Error(`Apple chart feed returned ${feedResponse.status}`);
  const feed = await feedResponse.json();
  const results = Array.isArray(feed?.feed?.results) ? feed.feed.results : [];
  if (!results.length) throw new Error("Apple chart feed returned no songs");

  const ids = results.map((item) => String(item.id || "")).filter(Boolean);
  const lookupById = new Map();
  if (ids.length) {
    const lookupUrl = `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}&entity=song`;
    const lookupResponse = await fetch(lookupUrl, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (lookupResponse?.ok) {
      const lookup = await lookupResponse.json();
      for (const item of lookup.results || []) {
        if (item.trackId) lookupById.set(String(item.trackId), item);
      }
    }
  }

  const tracks = results.map((item, index) => {
    const lookup = lookupById.get(String(item.id)) || {};
    const genre = lookup.primaryGenreName || item.genres?.[0]?.name || null;
    return {
      track_id: `chart-${country}-${item.id}`,
      title: item.name || lookup.trackName || "Unknown title",
      artist: item.artistName || lookup.artistName || "Unknown artist",
      album: lookup.collectionName || "",
      year: releaseYear(lookup.releaseDate || item.releaseDate),
      artwork_url: largerArtwork(lookup.artworkUrl100 || item.artworkUrl100),
      preview_url: lookup.previewUrl || "",
      external_url: item.url || lookup.trackViewUrl || "",
      source: "Apple Music chart fallback",
      provider_genre: genre,
      provider_subgenre: genre,
      seed_genre: null,
      acoustic_signature: null,
      analysis_status: "pending",
      lyrics_available: false,
      lyric_themes: [],
      lyric_language: null,
      catalogued: false,
      chart_rank: index + 1,
      chart_country: country,
    };
  });

  return {
    country,
    updated_at: new Date().toISOString(),
    tracks,
    fallback: true,
  };
}
