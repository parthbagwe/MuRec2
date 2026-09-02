import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { createCatalogue, cachedLoad } from "./catalogue.ts";

// Exercise the actual HTTP handler with a recording database client. No live
// credentials or database writes are used by this regression suite.
const source = stripTypeScriptTypes((await readFile(new URL("./index.ts", import.meta.url), "utf8"))
  .replace(/^import .*;\r?$/gm, ""));

function app() {
  const calls = [];
  let authCalls = 0;
  let failCounts = false;
  let handler;
  const rows = {
    acoustic_fingerprints: [{ track_id: "song-1", acoustic_signature: "warm-steady", profile: { texture: "warm", bpm: 100 }, tracks: { track_id: "song-1", title: "Song", artist: "Artist" } }],
    lyric_features: [{ track_id: "song-1", sentiment: 0.6, confidence: 1, themes: ["hope"] }],
    favorites: [{ track_id: "song-1", title: "Song" }],
  };
  const client = {
    auth: { async getUser() { authCalls++; return { data: { user: { id: "test-user" } }, error: null }; } },
    from(table) {
      const call = { table };
      calls.push(call);
      const result = () => {
        let data = rows[table] ?? [];
        if (call.filter) data = data.filter((row) => row[call.filter[0]] === call.filter[1]);
        if (call.fields?.startsWith("texture:")) data = data.map((row) => ({ texture: row.profile.texture, acoustic_signature: row.acoustic_signature }));
        return { data: call.single ? data[0] ?? null : data, count: 1, error: call.options?.head && failCounts ? { message: "unavailable" } : null };
      };
      const query = {
        select(fields, options) { call.fields = fields; call.options = options; return query; },
        order() { return query; },
        range(start, end) { call.range = [start, end]; return query; },
        eq(field, value) { call.filter = [field, value]; return query; },
        maybeSingle() { call.single = true; return query; },
        upsert(value) { call.write = value; return query; },
        insert(value) { call.write = value; return query; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
  };
  vm.runInNewContext(source, {
    createClient: () => client, createCatalogue, cachedLoad, corsHeaders: {}, Response,
    console: { error() {} },
    Deno: { env: { get: (key) => ({ SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "test-anon" })[key] }, serve: (fn) => { handler = fn; } },
  });
  return {
    calls, authCalls: () => authCalls, failCounts: (value) => { failCounts = value; },
    async request(action, payload = {}, token = "") {
      const response = await handler(new Request("https://example.test", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, ...payload }),
      }));
      return { status: response.status, data: await response.json() };
    },
  };
}

test("public track and genre HTTP actions avoid Auth and full-library reads", async () => {
  const server = app();
  const track = await server.request("track", { track_id: "song-1" }, "test-user-token");
  assert.equal(track.status, 200);
  assert.equal(track.data.bpm, 100);
  assert.equal(track.data.valence, 0.8);
  assert.deepEqual(track.data.lyric_themes, ["hope"]);
  assert.ok(server.calls.every((call) => call.single && call.filter[1] === "song-1"));
  assert.equal((await server.request("track", { track_id: "missing" })).status, 404);
  const genres = await server.request("genres");
  assert.deepEqual(genres.data.genres, ["warm"]);
  assert.ok(genres.data.provider_taxonomy.includes("nu metal"));
  assert.equal(server.authCalls(), 0);
});

test("saving a favourite authenticates and looks up only the requested song", async () => {
  const server = app();
  assert.equal((await server.request("addFavorite", { track_id: "song-1" }, "test-anon")).status, 401);
  assert.equal(server.calls.length, 0);
  const result = await server.request("addFavorite", { track_id: "song-1" }, "test-user-token");
  assert.equal(result.status, 200);
  assert.equal(server.authCalls(), 1);
  const lookup = server.calls.find((call) => call.table === "acoustic_fingerprints");
  assert.equal(lookup.single, true);
  assert.equal(lookup.range, undefined);
  assert.equal(server.calls.find((call) => call.table === "favorites").write.user_id, "test-user");
});

test("HTTP status reads are cached, use head-only counts, and don't cache failures", async () => {
  const server = app();
  server.failCounts(true);
  assert.equal((await server.request("acousticStatus")).status, 503);
  server.failCounts(false);
  assert.equal((await server.request("acousticStatus")).data.building, false);
  const count = server.calls.length;
  assert.equal((await server.request("acousticStatus")).status, 200);
  assert.equal(server.calls.length, count);
  assert.ok(server.calls.every((call) => call.options.head === true));
});
