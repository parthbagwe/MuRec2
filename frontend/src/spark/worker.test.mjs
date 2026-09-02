import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../../public/catalogue/manifest.json", import.meta.url)));
const bytes = await readFile(new URL(`../../public${manifest.file}`, import.meta.url));
let moduleVersion = 0;
async function worker({ cached = null, cacheSupported = true, failDownload = false } = {}) {
  const sent = [];
  const calls = [];
  let saved = cached;
  globalThis.self = { postMessage: (message) => sent.push(message) };
  if (cacheSupported) globalThis.caches = { open: async () => ({
    match: async () => saved?.clone(), put: async (_key, value) => { saved = value; },
    keys: async () => [], delete: async () => { saved = null; },
  }) };
  else delete globalThis.caches;
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url === "/catalogue/manifest.json") return Response.json(manifest);
    return failDownload ? new Response("Unavailable", { status: 503 }) : new Response(bytes);
  };
  await import(`./catalogue.worker.js?test=${++moduleVersion}`);
  return { calls, sent, cached: () => saved, request: (id, action, input = {}) => self.onmessage({ data: { id, action, input } }) };
}

test("concurrent worker requests share a single catalogue download", async () => {
  const app = await worker();
  await Promise.all([app.request(1, "acousticStatus"), app.request(2, "genres")]);
  assert.equal(app.calls.filter((url) => url === manifest.file).length, 1);
  assert.equal(app.sent.find((row) => row.id === 1).data.indexed, 5893);
  assert.ok(app.sent.find((row) => row.id === 2).data.provider_taxonomy.length > 100);
});

test("cached public catalogue avoids a second binary download", async () => {
  const app = await worker({ cached: new Response(bytes) });
  await app.request(1, "acousticStatus");
  assert.deepEqual(app.calls, ["/catalogue/manifest.json"]);
  assert.equal(app.sent[0].data.indexed, 5893);
});

test("worker still functions if browser cache storage is unavailable", async () => {
  const app = await worker({ cacheSupported: false });
  await app.request(1, "acousticStatus");
  assert.equal(app.sent[0].data.indexed, 5893);
});

test("failed downloads return an error and a later request can retry", async () => {
  const app = await worker({ failDownload: true });
  await app.request(1, "acousticStatus");
  await app.request(2, "acousticStatus");
  assert.ok(app.sent.every((row) => row.error.includes("download failed")));
  assert.equal(app.calls.filter((url) => url === manifest.file).length, 2);
});

test("corrupt cache entry is evicted, allowing recovery on retry", async () => {
  const app = await worker({ cached: new Response("invalid gzip") });
  await app.request(1, "acousticStatus");
  assert.ok(app.sent[0].error);
  assert.equal(app.cached(), null);
  await app.request(2, "acousticStatus");
  assert.equal(app.sent[1].data.indexed, 5893);
});
