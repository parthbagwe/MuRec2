import { createEngine } from "./engine.generated.js";
import { createIntelligence } from "../intelligence/ranking.js";

export function createLocalCatalogue(data) {
  const tracks = new Map(data.tracks.map((track) => [String(track.track_id), track]));
  const library = data.fingerprints.map((row) => ({ ...row, track: tracks.get(String(row.track_id)) })).filter((row) => row.track);
  const fingerprints = new Map(library.map((row) => [String(row.track_id), row]));
  let intelligence = createIntelligence(null);
  const onDemandAnchors = new Set();
  // The indirection allows a lazily downloaded index without rebuilding the catalogue.
  const engine = createEngine(library, { scorePair: (...args) => intelligence.scorePair(...args) });
  const vocabulary = new Set([...tracks.values()].flatMap((track) => engine.normalizedSearchText(`${track.title} ${track.artist}`).split(" ")));
  function correctTranspositions(query) {
    return engine.normalizedSearchText(query).split(" ").map((word) => {
      if (word.length < 4 || vocabulary.has(word)) return word;
      const candidates = new Set();
      for (let i = 0; i < word.length - 1; i++) {
        const candidate = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
        if (vocabulary.has(candidate)) candidates.add(candidate);
      }
      return candidates.size === 1 ? [...candidates][0] : word;
    }).join(" ");
  }
  const view = (track) => ({ ...engine.cleanTrack(track, fingerprints.get(String(track.track_id))), ...intelligence.describe(track) });
  function addTracks(rows) {
    for (const row of rows) if (row?.track_id && !tracks.has(String(row.track_id))) {
      tracks.set(String(row.track_id), row);
      for (const word of engine.normalizedSearchText(`${row.title} ${row.artist}`).split(" ")) vocabulary.add(word);
    }
  }
  function search(input) {
    const query = String(input.q ?? "").trim().slice(0, 200);
    const corrected = correctTranspositions(query);
    const correctionApplied = corrected !== engine.normalizedSearchText(query);
    const genre = String(input.genre ?? "").toLowerCase();
    const ranked = [];
    for (const track of tracks.values()) {
      const fingerprint = fingerprints.get(String(track.track_id));
      if (genre && ![track.provider_genre, track.provider_subgenre, fingerprint?.profile?.texture, fingerprint?.acoustic_signature]
        .some((value) => String(value ?? "").toLowerCase().includes(genre))) continue;
      const candidate = { ...track, analysis_status: fingerprint ? "complete" : "pending" };
      let score = query ? engine.searchRelevance(candidate, query) : 1;
      if (query && correctionApplied) score = Math.max(score, engine.searchRelevance(candidate, corrected));
      if (!query || score >= 24) ranked.push({ track, score, indexed: Boolean(fingerprint) });
    }
    ranked.sort((a, b) => b.score - a.score || Number(b.indexed) - Number(a.indexed));
    const identities = new Set();
    const unique = ranked.filter(({ track }) => {
      const identity = engine.recordingIdentity(track.title, track.artist);
      if (identities.has(identity)) return false;
      identities.add(identity);
      return true;
    });
    const page = Math.max(1, Number(input.page) || 1);
    return { results: unique.slice((page - 1) * 20, page * 20).map(({ track }) => view(track)), total: unique.length, page, page_size: 20,
      best_score: unique[0]?.score ?? 0, corrected_query: corrected };
  }
  return {
    async call(action, input = {}) {
      if (action === 'setIntelligence') { intelligence = createIntelligence(input.index); return { indexed: intelligence.indexed }; }
      if (action === 'aiStatus') return intelligence.describe(input.track_id);
      if (action === 'aiUpsert') {
        const added = intelligence.add(input.result);
        if (added) onDemandAnchors.add(String(input.result.row.track_id));
        return { added };
      }
      if (action === "addTracks") { addTracks(input.tracks ?? []); return true; }
      if (action === "hydrate") { addTracks(input.tracks ?? []); return (input.tracks ?? []).map((track) => view(tracks.get(String(track.track_id)))); }
      if (action === "tracks") return search(input);
      if (action === "track") {
        const track = tracks.get(String(input.track_id));
        if (!track) throw new Error("This song is not in the downloaded catalogue. Search for it again.");
        return view(track);
      }
      if (action === "recommend" || action === "bridge") {
        if (input.anchor_analysis) {
          const row = engine.transientAnchor(input);
          if (row && !fingerprints.has(String(row.track_id))) {
            tracks.set(String(row.track_id), row.track);
            fingerprints.set(String(row.track_id), row);
            library.push(row);
          }
        }
        // A newly inferred anchor needs actual learned comparables, not thousands
        // of unindexed candidates whose unchanged acoustic scores mask the AI.
        // Keep all original genre/vibe/feedback rules. AutoMix/bridges stay on the
        // full acoustic pool; only discovery suggestions use this candidate lane.
        const learnedLane = action === 'recommend' && input.mode !== 'transition' && onDemandAnchors.has(String(input.track_id));
        const matchingEngine = learnedLane ? createEngine(library.filter((row) => intelligence.describe(row.track_id).ai_indexed),
          { scorePair: (...args) => intelligence.scorePair(...args) }) : engine;
        const result = await matchingEngine[action](input, input.preferences ?? null);
        if (learnedLane && result.recommendations.length < Math.min(Number(input.k) || 10, 30)) {
          const fallback = await engine[action](input, input.preferences ?? null);
          const identities = new Set(result.recommendations.map((r) => engine.recordingIdentity(r.title, r.artist)));
          for (const row of fallback.recommendations) {
            const identity = engine.recordingIdentity(row.title, row.artist);
            if (!identities.has(identity)) { result.recommendations.push(row); identities.add(identity); }
            if (result.recommendations.length >= (Number(input.k) || 10)) break;
          }
          result.total = result.recommendations.length;
        }
        return { ...result, anchor: { ...result.anchor, ...intelligence.describe(result.anchor) },
          intelligence: { indexed: intelligence.indexed, anchor_indexed: intelligence.describe(result.anchor).ai_indexed,
            method: action === 'bridge' ? 'acoustic-bridge' : 'learned-blend',
            candidate_pool: learnedLane ? 'learned-with-acoustic-fallback' : 'full-catalogue',
            matched: result.recommendations.filter((r) => r.ai_pair_indexed).length } };
      }
      if (action === "genres") return {
        genres: [...new Set(library.map((row) => row.profile.texture).filter(Boolean))].sort(),
        subgenres: [...new Set(library.map((row) => row.acoustic_signature).filter(Boolean))].sort(),
        provider_taxonomy: engine.providerTaxonomy, genre_families: Object.keys(engine.styleFamilies).sort(),
        dimensions: ["tempo", "intensity", "texture", "rhythm character", "harmonic character"],
      };
      if (action === "acousticStatus") return { indexed: library.length, total: tracks.size, remaining: tracks.size - library.length, building: false, failures: 0 };
      if (action === "lyricStatus") return { analyzed: library.filter((row) => row.lyrics).length, total: tracks.size, provider_configured: false, stores_raw_lyrics: false };
      throw new Error("Unknown music action");
    },
  };
}
