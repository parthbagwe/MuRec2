import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheResult, readCached, validResult } from './onDemand.js';
import { createIntelligence } from './ranking.js';
const result = () => ({ schema: 1, model: 'laion/clap-htsat-unfused', revision: '8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a',
  runtime: 'onnx-q8-3x10-v1', dimensions: 512,
  labels: ['joyful', 'melancholic', 'aggressive', 'relaxed', 'danceable', 'dreamy', 'romantic', 'dark'],
  row: { embedding: Array(512).fill(2), mood_scores: [.4, .1, .1, .1, .2, .1, .1, .1], preview_seconds: 30 } });
function storage() { const m = new Map(); return { getItem: (k) => m.get(k), setItem: (k, v) => m.set(k, v) }; }
test('on-demand cache is bounded, model-versioned, and contains derived vectors only', () => {
  const s = storage();
  for (let i = 0; i < 30; i++) cacheResult(String(i), result(), s);
  assert.equal(readCached('0', s), null);
  assert.ok(readCached('29', s));
  assert.equal(JSON.parse(s.getItem('cerum.on-demand-ai.v1')).length, 24);
  assert.equal(readCached('anything', { getItem: () => 'not JSON' }), null);
  assert.doesNotThrow(() => cacheResult('1', result(), { setItem() { throw Error('quota'); } }));
});
test('reject incompatible, corrupt, non-finite and over-limit inference results', () => {
  assert.ok(validResult(result()));
  for (const change of [{ model: 'another-model' }, { runtime: 'old' }, { labels: [] }]) assert.equal(validResult({ ...result(), ...change }), false);
  for (const change of [{ preview_seconds: 31 }, { embedding: Array(512).fill(0) }, { mood_scores: Array(8).fill(NaN) }]) {
    assert.equal(validResult({ ...result(), row: { ...result().row, ...change } }), false);
  }
});
test('dynamic embeddings keep existing rows and reject other model spaces', () => {
  const r = result();
  const ranker = createIntelligence({ ...r, tracks: [{ ...r.row, track_id: 'known' }] });
  assert.ok(ranker.add({ ...r, row: { ...r.row, track_id: 'new' } }));
  assert.equal(ranker.indexed, 2);
  assert.ok(ranker.describe('known').ai_indexed);
  assert.ok(ranker.describe('new').ai_indexed);
  assert.equal(ranker.add({ ...r, revision: 'other', row: { ...r.row, track_id: 'bad' } }), false);
  assert.equal(createIntelligence(null).add(r), false);
});
