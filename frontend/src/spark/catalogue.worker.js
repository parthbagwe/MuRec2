import { createLocalCatalogue } from "./catalogue.js";

let pendingCatalogue;
async function loadCatalogue() {
  const response = await fetch("/catalogue/manifest.json");
  if (!response.ok) throw new Error("The downloadable music catalogue is unavailable. Please retry.");
  const manifest = await response.json();
  if (!/^\/catalogue\/music-[a-f0-9]+\.bin$/.test(manifest.file)) throw new Error("Invalid catalogue manifest");
  const cache = typeof caches !== "undefined" ? await caches.open("cerum-spark-public-catalogue-v1").catch(() => null) : null;
  let compressed = await cache?.match(manifest.file);
  if (!compressed) {
    compressed = await fetch(manifest.file);
    if (!compressed.ok) throw new Error("The initial catalogue download failed. Please retry.");
    await cache?.put(manifest.file, compressed.clone()).catch(() => {});
  }
  if (typeof DecompressionStream === "undefined") throw new Error("Please update your browser to download the music catalogue.");
  let json;
  try { json = await new Response(compressed.body.pipeThrough(new DecompressionStream("gzip"))).json(); }
  catch (error) { await cache?.delete(manifest.file); throw error; }
  // Retain the current catalogue only; this cache never stores account data or audio.
  if (cache) for (const request of await cache.keys()) {
    if (new URL(request.url).pathname !== manifest.file) await cache.delete(request);
  }
  return createLocalCatalogue(json);
}
self.onmessage = async ({ data: { id, action, input } }) => {
  try {
    pendingCatalogue ??= loadCatalogue().catch((error) => { pendingCatalogue = null; throw error; });
    const catalogue = await pendingCatalogue;
    self.postMessage({ id, data: await catalogue.call(action, input) });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "The music catalogue could not be decoded. Please retry." });
  }
};
