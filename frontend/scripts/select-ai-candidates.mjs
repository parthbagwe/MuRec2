// Prioritise public baseline recommendations so the first AI release covers
// the actual candidates listeners encounter, across the existing scoring modes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createLocalCatalogue } from '../src/spark/catalogue.js';
const root = new URL('../public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('catalogue/manifest.json', root)));
const data = JSON.parse(gunzipSync(await readFile(new URL(manifest.file.slice(1), root))));
const catalogue = createLocalCatalogue(data);
const ids = new Set();
for (const q of ['Blinding Lights The Weeknd', 'One Love Shubh', 'Duality Slipknot', 'Nenjukkul Peidhidum', 'Kesariya', 'Tum Se Hi', "God's Plan Drake"]) {
  const anchor = (await catalogue.call('tracks', { q })).results[0];
  ids.add(anchor.track_id);
  for (const mode of ['similar', 'rhythm', 'timbre', 'transition']) {
    const result = await catalogue.call('recommend', { track_id: anchor.track_id, k: mode === 'transition' ? 5 : 12,
      mode, genre_scope: 'nearby', vibe_lock: true });
    for (const track of result.recommendations) if (track.preview_url) ids.add(track.track_id);
  }
}
const target = new URL('../../.cache/music-ai/', import.meta.url);
await mkdir(target, { recursive: true });
await writeFile(new URL('candidate-ids.json', target), JSON.stringify([...ids], null, 2));
console.log(`Selected ${ids.size} real baseline candidates for the initial neural index.`);
