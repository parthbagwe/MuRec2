// Called in the catalogue worker only, after a recommendation is requested.
// Neither model weights nor inference are loaded onto the main/browser audio thread.
let pending;
export function loadIntelligence() {
  pending ??= (async () => {
    const response = await fetch('/intelligence/manifest.json', { signal: AbortSignal.timeout(6000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const manifest = await response.json();
    if (!/^\/intelligence\/index-[a-f0-9]+\.bin$/.test(manifest.file)) return null;
    const cache = typeof caches === 'undefined' ? null : await caches.open('cerum-audio-ai-v1').catch(() => null);
    let compressed = await cache?.match(manifest.file);
    if (!compressed) {
      compressed = await fetch(manifest.file, { signal: AbortSignal.timeout(8000) });
      if (!compressed.ok) return null;
      await cache?.put(manifest.file, compressed.clone()).catch(() => {});
    }
    try {
      const data = await new Response(compressed.body.pipeThrough(new DecompressionStream('gzip'))).json();
      if (data.model !== manifest.model || data.revision !== manifest.revision || data.tracks?.length !== manifest.indexed) throw new Error('AI index version mismatch');
      if (cache) for (const request of await cache.keys()) {
        if (new URL(request.url).pathname !== manifest.file) await cache.delete(request);
      }
      return data;
    } catch { await cache?.delete(manifest.file); return null; }
  })().catch(() => null);
  return pending;
}
