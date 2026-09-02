import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { createLocalCatalogue } from "./catalogue.js";
import { createEngine } from "./engine.generated.js";

const manifest = JSON.parse(await readFile(new URL("../../public/catalogue/manifest.json", import.meta.url)));
const data = JSON.parse(gunzipSync(await readFile(new URL(`../../public${manifest.file}`, import.meta.url))));
const trackMap = new Map(data.tracks.map((track) => [track.track_id, track]));
const library = data.fingerprints.map((row) => ({ ...row, track: trackMap.get(row.track_id) }));
const engine = createEngine(library);
const local = createLocalCatalogue(data);
// Verified Apple Search response. This song is outside the local CSV and arrives
// through global search; it must be analyzed before becoming a recommendation anchor.
await local.call("addTracks", { tracks: [{ track_id: "apple-1708274565", title: "MODERN JAM (feat. Teezo Touchdown)", artist: "Travis Scott",
  preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/b6/46/06/b64606ec-c8e5-d03a-6f26-4913aaa919ed/mzaf_2341617216758565677.plus.aac.p.m4a",
  external_url: "https://music.apple.com/us/album/modern-jam-feat-teezo-touchdown/1708274558?i=1708274565",
  provider_genre: "Hip-Hop/Rap", provider_subgenre: "Hip-Hop/Rap" }] });
const originalSource = stripTypeScriptTypes((await readFile(new URL("../../../supabase/functions/murec2-api/index.ts", import.meta.url), "utf8"))
  .replace(/^import .*;\r?$/gm, ""));
const context = vm.createContext({ createClient: () => ({}), createCatalogue: () => ({ loadLibrary: async () => library }),
  corsHeaders: {}, Deno: { env: { get: () => undefined }, serve() {} }, Response });
vm.runInContext(`${originalSource}\nthis.original = { recommend, bridge };`, context);
const canonical = (value) => JSON.parse(JSON.stringify(value));
const anchor = library.find((row) => row.track.title.toLowerCase() === "duality") ?? library[0];

test("public snapshot contains only music data, not accounts or audio", () => {
  assert.equal(data.tracks.length, manifest.total);
  assert.equal(data.fingerprints.length, manifest.indexed);
  assert.equal(manifest.indexed, 5893);
  assert.equal(manifest.total, 5896);
  for (const track of data.tracks) assert.ok(!("email" in track) && !("password" in track) && !("user_id" in track));
  for (const row of data.fingerprints) { assert.equal(row.vector.length, 35); assert.ok(row.vector.every(Number.isFinite)); assert.equal(row.lyrics, null); }
});

for (const [query, title, artist] of [
  ["modern jam", "MODERN JAM", "Travis Scott"],
  ["modern jam by travis scott", "MODERN JAM", "Travis Scott"],
  ["modren jam", "MODERN JAM", "Travis Scott"],
  ["gods plan drake", "God's Plan", "Drake"],
  ["duality slipknot", "Duality", "Slipknot"],
]) test(`search ranks ${query} first`, async () => {
  const result = await local.call("tracks", { q: query });
  assert.ok(result.results[0].title.toLowerCase().startsWith(title.toLowerCase()));
  assert.ok(result.results[0].artist.includes(artist));
});

for (const mode of ["similar", "rhythm", "timbre", "discover", "transition"]) {
  test(`${mode} scoring equals existing server algorithm on the same catalogue`, async () => {
    const input = { track_id: anchor.track_id, mode, k: 5, genre_scope: "nearby", vibe_lock: true };
    const expected = await context.original.recommend(input, null);
    const actual = await engine.recommend(input, null);
    assert.deepEqual(canonical(actual), canonical(expected));
    assert.equal(actual.recommendations.length, 5);
    assert.equal(new Set(actual.recommendations.map((row) => row.track_id)).size, 5);
    assert.ok(actual.recommendations.every((row) => Number.isFinite(row.hybrid_score)));
  });
}

test("personalized scoring reads only the supplied private snapshot", async () => {
  const preferences = { favorites: [{ track_id: library[4].track_id }], interactions: [{ track_id: library[6].track_id, event_type: "disliked" }], items: [] };
  const tables = { favorites: preferences.favorites, interactions: preferences.interactions, recommendation_items: preferences.items };
  const originalContext = { user: { id: "test-user" }, client: { from(table) {
    return { select: async () => ({ data: tables[table] }), insert: () => ({ select: () => ({ single: async () => ({ data: null }) }) }) };
  } } };
  const input = { track_id: anchor.track_id, mode: "personalized", k: 5 };
  assert.deepEqual(canonical(await engine.recommend(input, preferences)), canonical(await context.original.recommend(input, originalContext)));
  await assert.rejects(engine.recommend(input, null), /Sign in/);
});

test("bridge destination and all scores match original algorithm", async () => {
  const destination = library.find((row) => row.track_id !== anchor.track_id && row.track.preview_url);
  const input = { track_id: anchor.track_id, destination_track_id: destination.track_id };
  const result = await engine.bridge(input, null);
  assert.deepEqual(canonical(result), canonical(await context.original.bridge(input, null)));
  assert.equal(result.recommendations.at(-1).track_id, destination.track_id);
});

test("new browser-analyzed song can anchor a mix, and invalid vectors are rejected", async () => {
  const track = { ...anchor.track, track_id: "test-new-song", title: "Test new song" };
  const input = { track_id: track.track_id, anchor_track: track,
    anchor_analysis: { vector: anchor.vector, profile: anchor.profile, acoustic_signature: anchor.acoustic_signature }, mode: "transition", k: 5 };
  const catalogue = createLocalCatalogue(data);
  const result = await catalogue.call("recommend", input);
  assert.equal(result.anchor.track_id, track.track_id);
  assert.equal(result.recommendations.length, 5);
  assert.equal((await catalogue.call("track", { track_id: track.track_id })).analysis_status, "complete");
  await assert.rejects(catalogue.call("recommend", { ...input, anchor_analysis: { ...input.anchor_analysis, vector: [NaN] } }), /fingerprint is invalid/);
});

test("unknown saved songs are not falsely marked analyzed after a page reload", async () => {
  const restored = await local.call("hydrate", { tracks: [{ ...anchor.track, track_id: "saved-new", analysis_status: "complete" }] });
  assert.equal(restored[0].analysis_status, "pending");
});

test("UI playback and mixing source are not changed", async () => {
  const { execFileSync } = await import("node:child_process");
  const diff = execFileSync("git", ["diff", "abbcb1f", "--", "frontend/src/components/MixPlayer.jsx", "frontend/src/components/TrackPreview.jsx", "frontend/src/audio"], { encoding: "utf8", cwd: new URL("../../../", import.meta.url) });
  assert.equal(diff, "");
});
