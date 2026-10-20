import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createLocalCatalogue } from '../src/spark/catalogue.js';
const publicDir = new URL('../public/', import.meta.url);
async function unpack(manifestPath) {
  const manifest = JSON.parse(await readFile(new URL(manifestPath, publicDir)));
  return { manifest, data: JSON.parse(gunzipSync(await readFile(new URL(manifest.file.slice(1), publicDir)))) };
}
const { data } = await unpack('catalogue/manifest.json');
const { manifest, data: index } = await unpack('intelligence/manifest.json');
const baseline = createLocalCatalogue(data);
const enhanced = createLocalCatalogue(data);
await enhanced.call('setIntelligence', { index });
const queries = ['Blinding Lights The Weeknd', 'One Love Shubh', 'Duality Slipknot',
  'Nenjukkul Peidhidum', 'Kesariya', 'Tum Se Hi'];
const cases = [];
for (const q of queries) {
  const track = (await baseline.call('tracks', { q })).results[0];
  if (!track) throw new Error(`Missing evaluation anchor: ${q}`);
  const input = { track_id: track.track_id, k: 5, mode: 'similar', genre_scope: 'nearby', vibe_lock: true };
  const before = await baseline.call('recommend', input);
  const after = await enhanced.call('recommend', input);
  const chain = await enhanced.call('recommend', { ...input, mode: 'transition' });
  const summarize = (rows) => rows.map((r) => ({ title: r.title, artist: r.artist, track_id: r.track_id,
    score: r.hybrid_score, neural_similarity: r.neural_similarity ?? null,
    predicted_mood: r.predicted_mood ?? null, ai_pair_indexed: r.ai_pair_indexed ?? false }));
  cases.push({ query: q, anchor: { title: track.title, artist: track.artist },
    coverage: after.intelligence, before: summarize(before.recommendations), after: summarize(after.recommendations),
    transition: { length: chain.recommendations.length, unique: new Set(chain.recommendations.map((r) => r.track_id)).size,
      playable: chain.recommendations.every((r) => r.preview_url) } });
}
const report = { model: manifest.model, revision: manifest.revision, indexed: manifest.indexed, total: manifest.total,
  note: 'Computed ranking comparison; human listening preference is not established by this report.', cases };
const directory = new URL('../../.cache/ai-evaluation/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('rankings.json', directory), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
