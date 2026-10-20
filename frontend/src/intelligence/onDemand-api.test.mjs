import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createInferenceHandler } from '../../server/inferenceHandler.js';
import { decodePCM } from '../../server/audioInference.js';
import { MAX_BYTES } from '../../server/aiConfig.js';
function request(bytes = Buffer.alloc(96000), headers = {}, method = 'POST') {
  return Object.assign(Readable.from([bytes]), { method, headers: { 'content-type': 'application/octet-stream', host: 'cerum.vercel.app', ...headers } });
}
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(x) { this.body = x; return this; } }; }
test('server accepts bounded PCM and rejects oversized, short or odd payloads', () => {
  assert.equal(decodePCM(Buffer.alloc(MAX_BYTES)).length, 48000 * 30);
  for (const size of [0, 2, 96001, MAX_BYTES + 2]) assert.throws(() => decodePCM(Buffer.alloc(size)));
});
test('API enforces method, origin, type and streaming limits before inference', async () => {
  let calls = 0;
  const handler = createInferenceHandler(async () => { calls++; return {}; });
  for (const [req, code] of [[request(undefined, {}, 'GET'), 405], [request(undefined, { origin: 'https://attacker.example' }), 403],
    [request(undefined, { origin: 'invalid' }), 403], [request(undefined, { 'content-type': 'application/json' }), 415],
    [request(undefined, { 'content-length': MAX_BYTES + 1 }), 413], [request(Buffer.alloc(MAX_BYTES + 2)), 413], [request(Buffer.alloc(20)), 400]]) {
    const res = response(); await handler(req, res); assert.equal(res.code, code);
  }
  assert.equal(calls, 0);
});
test('API caches results by PCM, returns no-store and bounds repeated requests', async () => {
  let calls = 0;
  const handler = createInferenceHandler(async () => { calls++; return { row: { embedding: [1] } }; }, { maxPerMinute: 2 });
  const a = response(), b = response(), c = response();
  await handler(request(), a); await handler(request(), b); await handler(request(), c);
  assert.equal(a.code, 200); assert.equal(a.body.cached, false);
  assert.equal(b.body.cached, true); assert.equal(c.code, 429); assert.equal(calls, 1);
  assert.equal(a.headers['Cache-Control'], 'no-store');
});
test('API does not queue unlimited concurrent inference and recovers after failure', async () => {
  let release;
  const handler = createInferenceHandler(() => new Promise((resolve) => { release = resolve; }));
  const first = handler(request(), response());
  await new Promise((resolve) => setImmediate(resolve));
  const second = response(); await handler(request(Buffer.alloc(96000, 1)), second);
  assert.equal(second.code, 429); release({}); await first;
  const failing = createInferenceHandler(async () => { throw new Error('private internal data'); });
  const res = response(); await failing(request(), res);
  assert.equal(res.code, 503); assert.ok(!res.body.detail.includes('private'));
});
