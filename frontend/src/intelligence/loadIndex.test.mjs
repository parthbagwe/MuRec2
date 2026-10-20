import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
let version = 0;
const data = { schema: 1, model: 'test-model', revision: 'version-1', tracks: [] };
const manifest = { model: data.model, revision: data.revision, indexed: 0, file: '/intelligence/index-aabbcc.bin' };
const encoded = () => new Response(gzipSync(JSON.stringify(data)));

async function setup({ brokenManifest = false, badCache = false, mismatch = false } = {}) {
  const calls = [];
  let evicted = false;
  globalThis.caches = { open: async () => ({ match: async () => badCache ? new Response('corrupt') : null,
    put: async () => {}, keys: async () => [], delete: async () => { evicted = true; } }) };
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('manifest.json')) return brokenManifest ? new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } })
      : Response.json(mismatch ? { ...manifest, revision: 'wrong' } : manifest);
    return encoded();
  };
  const { loadIntelligence } = await import(`./loadIndex.js?test=${++version}`);
  return { loadIntelligence, calls, evicted: () => evicted };
}
test('concurrent recommendations share one lazy AI download', async () => {
  const app = await setup();
  const [first, second] = await Promise.all([app.loadIntelligence(), app.loadIntelligence()]);
  assert.equal(first, second);
  assert.equal(first.model, data.model);
  assert.deepEqual(app.calls, ['/intelligence/manifest.json', manifest.file]);
});
test('HTML route fallbacks do not masquerade as a loaded AI index', async () => {
  const app = await setup({ brokenManifest: true });
  assert.equal(await app.loadIntelligence(), null);
  assert.equal(app.calls.length, 1);
});
test('corrupt or mismatched cache data is evicted and acoustic fallback remains available', async () => {
  for (const settings of [{ badCache: true }, { mismatch: true }]) {
    const app = await setup(settings);
    assert.equal(await app.loadIntelligence(), null);
    assert.equal(app.evicted(), true);
  }
});
