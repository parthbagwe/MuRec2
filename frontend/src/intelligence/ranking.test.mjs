import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntelligence } from './ranking.js';
import { combinedFeedback, readFeedback, saveFeedback } from './feedback.js';

const embedding = (x, y = 0) => [x, y, ...Array(510).fill(0)];
const row = (id, vector, mood = 0) => ({ track_id: id, embedding: vector,
  mood_scores: Array.from({ length: 8 }, (_, i) => i === mood ? .6 : .1), preview_seconds: 30 });
const index = (tracks) => ({ schema: 1, model: 'test-fixture', revision: 'test', dimensions: 512,
  labels: ['joyful', 'melancholic', 'aggressive', 'relaxed', 'danceable', 'dreamy', 'romantic', 'dark'], tracks });
const options = { score: .6, mode: 'similar', preferences: null };

test('learned sound and predicted mood influence ranking independently of the base score', () => {
  const ai = createIntelligence(index([row('anchor', embedding(127)), row('close', embedding(125, 12)),
    row('unlike', embedding(0, 127)), row('sad', embedding(125, 12), 1)]));
  const close = ai.scorePair('anchor', 'close', options);
  const unlike = ai.scorePair('anchor', 'unlike', options);
  const sad = ai.scorePair('anchor', 'sad', options);
  assert.ok(close.score > unlike.score);
  assert.ok(close.score > sad.score);
  assert.equal(close.metadata.ai_pair_indexed, true);
  assert.equal(close.metadata.predicted_mood, 'joyful');
  assert.ok(close.metadata.neural_similarity > .9);
});

test('missing or malformed embeddings use unchanged acoustic scores and do not invent AI matches', () => {
  const ai = createIntelligence(index([row('bad', [NaN]), row('too-long', embedding(127), 0)]));
  assert.equal(ai.scorePair('missing', 'missing-too', options).score, .6);
  assert.equal(ai.scorePair('bad', 'missing', options).metadata.ai_pair_indexed, undefined);
  assert.equal(ai.describe('bad').ai_indexed, false);
  assert.equal(createIntelligence(index([{ ...row('long', embedding(127)), preview_seconds: 31 }])).indexed, 0);
});

test('strong audio matches retain distinct scores instead of saturating to the same boost', () => {
  const ai = createIntelligence(index([row('anchor', embedding(127)), row('very-close', embedding(125, 12)),
    row('fairly-close', embedding(100, 75))]));
  assert.ok(ai.scorePair('anchor', 'very-close', options).score > ai.scorePair('anchor', 'fairly-close', options).score);
});

test('mood labels are withheld when evidence has no clear margin', () => {
  const ai = createIntelligence(index([{ ...row('uncertain', embedding(127)), mood_scores: Array(8).fill(.2) }]));
  assert.equal(ai.describe('uncertain').predicted_mood, null);
});

test('genre penalty cannot be undone by learned similarity; transition adjustment remains bounded', () => {
  const ai = createIntelligence(index([row('anchor', embedding(127)), row('close', embedding(127))]));
  const low = ai.scorePair('anchor', 'close', { ...options, score: .05 }).score;
  assert.ok(low < .07);
  const transition = ai.scorePair('anchor', 'close', { ...options, mode: 'transition' }).score;
  assert.ok(Math.abs(transition - options.score) < .05);
});

test('explicit feedback changes subsequent scores even without a neural fingerprint', () => {
  const ai = createIntelligence(null);
  const negative = ai.scorePair('anchor', { track_id: 'bad' }, { ...options,
    preferences: { feedback: [{ track_id: 'bad', reason: 'too_different' }] } });
  const positive = ai.scorePair('anchor', { track_id: 'good' }, { ...options,
    preferences: { feedback: [{ track_id: 'good', reason: 'more_like_this' }] } });
  assert.ok(negative.score < options.score);
  assert.ok(positive.score > options.score);
});

test('guest and matching IDs on different account providers never share feedback', () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
  saveFeedback(null, 'guest-song', 'too_sad', storage);
  saveFeedback('firebase:123', 'my-song', 'more_like_this', storage);
  assert.equal(readFeedback('firebase:123', storage)[0].track_id, 'my-song');
  assert.deepEqual(readFeedback('supabase:123', storage), []);
  assert.equal(readFeedback(null, storage)[0].track_id, 'guest-song');
  saveFeedback('firebase:123', 'my-song', 'too_sad', storage);
  assert.equal(readFeedback('firebase:123', storage).length, 1);
  assert.equal(readFeedback('firebase:123', storage)[0].reason, 'too_sad');
});

test('account feedback reloads from existing numeric interaction values without changing schema', () => {
  const result = combinedFeedback([{ track_id: 'a', reason: 'more_like_this' }], [
    { track_id: 'a', value: -2 }, { track_id: 'b', value: -3 }, { track_id: 'c', value: null },
  ]);
  assert.deepEqual(result.map((r) => r.reason), ['more_like_this', 'too_different']);
});

test('blocked or corrupted device storage does not break music', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readFeedback('user', blocked), []);
  const saved = saveFeedback('user', 'song', 'too_sad', blocked);
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.persisted, false);
  assert.equal(readFeedback('user', blocked)[0].reason, 'too_sad');
});
