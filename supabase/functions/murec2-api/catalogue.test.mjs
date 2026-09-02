import test from "node:test";
import assert from "node:assert/strict";
import { cachedLoad, createCatalogue } from "./catalogue.ts";

function database(fingerprints = [], lyrics = []) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table };
      calls.push(call);
      const query = {
        select(fields) { call.fields = fields; return query; },
        order(field) { call.order = field; return query; },
        eq(field, value) { call.filter = [field, value]; return query; },
        range(start, end) {
          call.range = [start, end];
          const rows = (table === "lyric_features" ? lyrics : fingerprints).slice(start, end + 1);
          const data = call.fields.startsWith("texture:")
            ? rows.map((row) => ({ texture: row.profile.texture, acoustic_signature: row.acoustic_signature })) : rows;
          return Promise.resolve({ data, error: null });
        },
        maybeSingle() {
          const rows = table === "lyric_features" ? lyrics : fingerprints;
          return Promise.resolve({ data: rows.find((row) => row[call.filter[0]] === call.filter[1]) ?? null, error: null });
        },
      };
      return query;
    },
  };
}
const fingerprint = (id) => ({ track_id: String(id), vector: [1, 2, 3], profile: { texture: "warm", bpm: 100 }, acoustic_signature: "warm-steady", tracks: { track_id: String(id), title: `Song ${id}` } });

test("single-track lookup is filtered, includes lyrics, and never downloads the library", async () => {
  const db = database([fingerprint(1), fingerprint(2)], [{ track_id: "2", sentiment: 0.8, confidence: 1 }]);
  const catalogue = createCatalogue(db, (message) => new Error(message));
  const track = await catalogue.loadTrack("2");
  assert.equal(track.track.title, "Song 2");
  assert.equal(track.lyrics.sentiment, 0.8);
  assert.equal(db.calls.length, 2);
  for (const call of db.calls) {
    assert.deepEqual(call.filter, ["track_id", "2"]);
    assert.equal(call.range, undefined);
  }
  assert.ok(!db.calls[0].fields.split(",").includes("vector"));
  assert.equal(await catalogue.loadTrack("missing"), null);
});

test("genre menu fetches only category fields and is cached", async () => {
  const db = database([fingerprint(1), fingerprint(2)]);
  const catalogue = createCatalogue(db, (message) => new Error(message));
  assert.deepEqual(await catalogue.loadGenres(), { genres: ["warm"], subgenres: ["warm-steady"] });
  await catalogue.loadGenres();
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].fields, "texture:profile->>texture,acoustic_signature");
});

test("concurrent full-library loads share pagination and preserve every vector and lyric feature", async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => fingerprint(id));
  const db = database(rows, [{ track_id: "1000", themes: ["hope"], theme_vector: [0.5] }]);
  const catalogue = createCatalogue(db, (message) => new Error(message));
  const [first, second] = await Promise.all([catalogue.loadLibrary(), catalogue.loadLibrary()]);
  assert.strictEqual(first, second);
  assert.equal(first.length, 1001);
  assert.deepEqual(first[1000].vector, [1, 2, 3]);
  assert.deepEqual(first[1000].lyrics.theme_vector, [0.5]);
  assert.equal(first[1000].tracks, undefined);
  assert.equal(db.calls.length, 3);
  assert.ok(db.calls.every((call) => call.order === "track_id"));
  await catalogue.loadTrack("1000");
  await catalogue.loadGenres();
  assert.equal(db.calls.length, 3, "warm library is reused by track and genre reads");
});

test("cached loads expire, coalesce, and recover after failures", async () => {
  let now = 100;
  let calls = 0;
  const cache = cachedLoad(async () => {
    calls++;
    if (calls === 1) throw new Error("temporary");
    return calls;
  }, 60, () => now);
  await assert.rejects(cache.load(), /temporary/);
  assert.equal(await cache.load(), 2);
  now = 159;
  assert.equal(await cache.load(), 2);
  now = 160;
  assert.deepEqual(await Promise.all([cache.load(), cache.load()]), [3, 3]);
  assert.equal(calls, 3);
});
