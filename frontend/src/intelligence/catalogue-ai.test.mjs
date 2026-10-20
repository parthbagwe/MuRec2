import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createLocalCatalogue } from '../spark/catalogue.js';
const root = new URL('../../public/', import.meta.url);
async function load(name) {
  const manifest = JSON.parse(await readFile(new URL(name, root)));
  return { manifest, data: JSON.parse(gunzipSync(await readFile(new URL(manifest.file.slice(1), root)))) };
}

test('published model coverage is genuine, bounded and tied to existing public previews', async () => {
  const { manifest, data: index } = await load('intelligence/manifest.json');
  const { data } = await load('catalogue/manifest.json');
  const ids = new Set(data.tracks.map((t) => t.track_id));
  assert.ok(manifest.indexed > 0 && manifest.indexed <= data.tracks.length);
  assert.equal(index.tracks.length, manifest.indexed);
  assert.equal(index.model, 'laion/clap-htsat-unfused');
  assert.equal(manifest.sanity_check.collapsed_embeddings_rejected, true);
  assert.ok(manifest.sanity_check.distinct_text_mean_cosine < .95);
  assert.match(index.revision, /^[a-f0-9]{40}$/);
  assert.equal(new Set(index.tracks.map((r) => r.track_id)).size, index.tracks.length);
  for (const row of index.tracks) {
    assert.ok(ids.has(row.track_id));
    assert.equal(row.embedding.length, 512);
    assert.ok(row.embedding.every((v) => Number.isInteger(v) && Math.abs(v) <= 127));
    assert.equal(row.mood_scores.length, 8);
    assert.ok(row.preview_seconds > 0 && row.preview_seconds <= 30);
    assert.match(row.source_preview_sha256, /^[a-f0-9]{64}$/);
    assert.ok(!('audio' in row) && !('user_id' in row));
  }
});

test('real indexed anchors retain distinct, playable five-song chains and strict genre constraints', async () => {
  const { data } = await load('catalogue/manifest.json');
  const { data: index } = await load('intelligence/manifest.json');
  const catalogue = createLocalCatalogue(data);
  await catalogue.call('setIntelligence', { index });
  for (const q of ['Blinding Lights The Weeknd', 'One Love Shubh', 'Duality Slipknot', 'Nenjukkul Peidhidum', 'Kesariya', 'Tum Se Hi']) {
    const anchor = (await catalogue.call('tracks', { q })).results[0];
    assert.ok(anchor?.ai_indexed, `${q} must actually be in the index`);
    const chain = await catalogue.call('recommend', { track_id: anchor.track_id, mode: 'transition', k: 5, genre_scope: 'strict' });
    assert.equal(chain.recommendations.length, 5);
    assert.equal(new Set(chain.recommendations.map((r) => r.track_id)).size, 5);
    assert.ok(chain.recommendations.every((r) => r.preview_url && r.genre_scope === undefined));
    // Existing primary-genre filtering happens before the neural hook.
    assert.ok(chain.recommendations.every((r) => r.provider_genre === anchor.provider_genre));
    assert.ok(chain.recommendations.every((r) => Number.isFinite(r.hybrid_score)));
  }
});

test('on-demand anchor compares with learned candidates without changing the transition algorithm', async () => {
  const { data } = await load('catalogue/manifest.json');
  const { data: index } = await load('intelligence/manifest.json');
  const catalogue = createLocalCatalogue(data);
  await catalogue.call('setIntelligence', { index });
  const anchor = (await catalogue.call('tracks', { q: 'One Dance Drake' })).results[0];
  assert.equal(anchor.ai_indexed, false);
  const input = { track_id: anchor.track_id, mode: 'transition', k: 5, genre_scope: 'strict' };
  // Fixture vector exercises candidate routing; real cross-runtime audio is tested separately.
  await catalogue.call('aiUpsert', { result: { ...index, row: { ...index.tracks[0], track_id: anchor.track_id } } });
  const ordinary = createLocalCatalogue(data);
  await ordinary.call('setIntelligence', { index: { ...index, tracks: [...index.tracks, { ...index.tracks[0], track_id: anchor.track_id }] } });
  const chain = await catalogue.call('recommend', input);
  const unchanged = await ordinary.call('recommend', input);
  assert.deepEqual(chain.recommendations, unchanged.recommendations, 'Dynamic discovery lane never replaces the existing AutoMix algorithm');
  const result = await catalogue.call('recommend', { ...input, mode: 'similar', k: 12 });
  assert.equal(result.intelligence.candidate_pool, 'learned-with-acoustic-fallback');
  assert.ok(result.intelligence.matched > 0);
  assert.equal(result.recommendations.length, 12);
  assert.equal(result.total, 12);
  assert.ok(result.recommendations.every((r) => r.provider_genre === anchor.provider_genre));
});
