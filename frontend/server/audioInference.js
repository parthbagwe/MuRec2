import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MODEL, REVISION, SAMPLE_RATE, MAX_BYTES } from './aiConfig.js';

export function decodePCM(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < SAMPLE_RATE * 2 || bytes.length > MAX_BYTES || bytes.length % 2) {
    throw Object.assign(new Error('Send 1–30 seconds of mono 48 kHz signed 16-bit PCM.'), { status: 400 });
  }
  return Float32Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2) / 32768);
}
export function normalize(vector) {
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-8) throw new Error('Invalid audio embedding');
  return Array.from(vector, (value) => value / norm);
}
let runtime;
async function loadRuntime() {
  runtime ??= (async () => {
    const { env, AutoProcessor, ClapAudioModelWithProjection } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    const path = fileURLToPath(new URL('./models/clap/', import.meta.url));
    const [processor, model, references] = await Promise.all([
      AutoProcessor.from_pretrained(path, { local_files_only: true }),
      ClapAudioModelWithProjection.from_pretrained(path, { local_files_only: true, dtype: 'q8',
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } }),
      readFile(new URL('./aiMoodVectors.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);
    if (references.model !== MODEL || references.revision !== REVISION) throw new Error('Model references do not match');
    return { processor, model, references };
  })().catch((error) => { runtime = null; throw error; });
  return runtime;
}
export async function inferAudio(bytes) {
  const audio = decodePCM(bytes);
  const { processor, model, references } = await loadRuntime();
  const vectors = [];
  for (let start = 0; start < audio.length; start += SAMPLE_RATE * 10) {
    const window = audio.subarray(start, Math.min(audio.length, start + SAMPLE_RATE * 10));
    if (window.length < SAMPLE_RATE) break;
    const inputs = await processor(window);
    const result = await model(inputs);
    vectors.push(normalize(result.audio_embeds.data));
    for (const value of Object.values(inputs)) value.dispose?.();
    for (const value of Object.values(result)) value.dispose?.();
  }
  const vector = normalize(Array.from({ length: 512 }, (_, i) => vectors.reduce((sum, row) => sum + row[i], 0) / vectors.length));
  return { schema: 1, model: MODEL, revision: REVISION, labels: references.labels,
    runtime: 'onnx-q8-3x10-v1', dimensions: 512,
    row: { embedding: vector.map((v) => Math.round(v * 127)),
      mood_scores: references.vectors.map((ref) => Number(ref.reduce((sum, v, i) => sum + v * vector[i], 0).toFixed(5))),
      preview_seconds: audio.length / SAMPLE_RATE },
    pcm_sha256: createHash('sha256').update(bytes).digest('hex') };
}
