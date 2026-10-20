import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { inferAudio, normalize } from '../server/audioInference.js';
const base = new URL('../../.cache/on-demand-test/', import.meta.url);
const fixtures = JSON.parse(await readFile(new URL('fixtures.json', base)));
const report = [];
for (const { row, track, file } of fixtures) {
const bytes = await readFile(new URL(file, base));
const start = performance.now();
const result = await inferAudio(bytes);
const expected = normalize(row.embedding), actual = normalize(result.row.embedding);
const cosine = expected.reduce((sum, v, i) => sum + v * actual[i], 0);
const moodError = Math.max(...row.mood_scores.map((v, i) => Math.abs(v - result.row.mood_scores[i])));
const entry = { title: track.title, cosine, maxMoodError: moodError, elapsed_ms: performance.now() - start };
report.push(entry);
console.log(JSON.stringify(entry));
assert.ok(cosine >= .98, 'On-demand encoder must agree with the indexed model');
assert.ok(moodError < .04, 'Predicted mood scores must remain compatible');
}
await writeFile(new URL('report.json', base), JSON.stringify(report));
