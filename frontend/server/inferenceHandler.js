import { createHash } from 'node:crypto';
import { MAX_BYTES } from './aiConfig.js';

// No database, audio persistence, remote URL fetching, provider keys or user tokens.
// Instance-local admission limits complement deployment/platform quotas; not a global WAF.
export function createInferenceHandler(infer, { now = Date.now, maxPerMinute = 8 } = {}) {
  const cache = new Map(), clients = new Map();
  let busy = false;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ detail: 'Method not allowed' }); }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) throw new Error('origin'); }
      catch { return res.status(403).json({ detail: 'Use Cerum to request analysis.' }); }
    }
    if (String(req.headers['content-type']).split(';')[0] !== 'application/octet-stream') return res.status(415).json({ detail: 'Binary PCM audio required.' });
    if (Number(req.headers['content-length']) > MAX_BYTES) return res.status(413).json({ detail: 'Preview exceeds 30 seconds.' });
    const client = createHash('sha256').update(String(req.headers['x-forwarded-for'] || 'local')).digest('hex');
    const bucket = Math.floor(now() / 60000), usage = clients.get(client);
    if (usage?.bucket === bucket && usage.count >= maxPerMinute) { res.setHeader('Retry-After', '60'); return res.status(429).json({ detail: 'Analysis is busy. Acoustic matching remains available.' }); }
    if (clients.size >= 1000) clients.clear();
    clients.set(client, { bucket, count: usage?.bucket === bucket ? usage.count + 1 : 1 });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) return res.status(413).json({ detail: 'Preview exceeds 30 seconds.' });
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length < 96000 || bytes.length % 2) return res.status(400).json({ detail: 'Send 1–30 seconds of mono 48 kHz signed 16-bit PCM.' });
      const key = createHash('sha256').update(bytes).digest('hex');
      if (cache.has(key)) return res.status(200).json({ ...cache.get(key), cached: true });
      if (busy) { res.setHeader('Retry-After', '5'); return res.status(429).json({ detail: 'Analysis is busy. Acoustic matching remains available.' }); }
      busy = true;
      try {
        const start = now(), result = await infer(bytes);
        const output = { ...result, elapsed_ms: now() - start };
        if (cache.size >= 64) cache.delete(cache.keys().next().value);
        cache.set(key, output);
        return res.status(200).json({ ...output, cached: false });
      } finally { busy = false; }
    } catch (error) {
      console.warn('[audio-ai]', error.status || 'inference-unavailable');
      return res.status(error.status || 503).json({ detail: error.status === 400 ? error.message : 'AI analysis is unavailable. Acoustic matching remains available.' });
    }
  };
}
