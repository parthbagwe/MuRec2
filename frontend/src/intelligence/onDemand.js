import { musicRequest } from '../spark/workerClient.js';

export const AI_CACHE_VERSION = 'clap-8fa0f1c6-onnx-q8-3x10-v1';
const CACHE_KEY = 'cerum.on-demand-ai.v1';
const LABELS = ['joyful', 'melancholic', 'aggressive', 'relaxed', 'danceable', 'dreamy', 'romantic', 'dark'];
export function validResult(result) {
  return result?.schema === 1 && result.model === 'laion/clap-htsat-unfused'
    && result.revision === '8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a'
    && result.runtime === 'onnx-q8-3x10-v1' && result.dimensions === 512
    && JSON.stringify(result.labels) === JSON.stringify(LABELS)
    && Array.isArray(result.row?.embedding) && result.row.embedding.length === 512 && result.row.embedding.every((v) => Number.isInteger(v) && Math.abs(v) <= 127)
    && result.row.embedding.some((v) => v !== 0)
    && Array.isArray(result.row.mood_scores) && result.row.mood_scores.length === 8 && result.row.mood_scores.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)
    && Number.isFinite(result.row.preview_seconds) && result.row.preview_seconds >= 1 && result.row.preview_seconds <= 30;
}
export function readCached(key, storage) {
  try {
    const rows = JSON.parse(storage.getItem(CACHE_KEY) || '[]');
    const item = rows.find((row) => row.key === key && row.version === AI_CACHE_VERSION);
    return validResult(item?.result) ? item.result : null;
  } catch { return null; }
}
export function cacheResult(key, result, storage) {
  if (!validResult(result)) return;
  try {
    let rows;
    try { rows = JSON.parse(storage.getItem(CACHE_KEY) || '[]'); } catch { rows = []; }
    rows = Array.isArray(rows) ? rows : [];
    storage.setItem(CACHE_KEY, JSON.stringify([{ key, version: AI_CACHE_VERSION, result }, ...rows.filter((r) => r.key !== key)].slice(0, 24)));
  } catch { /* optional device cache; never blocks playback */ }
}

async function previewPCM(url, signal) {
  // Accept only the existing catalogue preview provider. Never upload microphones/files.
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'audio-ssl.itunes.apple.com') throw new Error('Unsupported preview provider');
  const response = await fetch(url, { signal, mode: 'cors', cache: 'force-cache' });
  if (!response.ok || Number(response.headers.get('content-length')) > 12_000_000) throw new Error('Preview unavailable');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 12_000_000) { await reader.cancel(); throw new Error('Preview too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const encoded = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { encoded.set(chunk, offset); offset += chunk.length; }
  signal.throwIfAborted();
  const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Context) throw new Error('Local decoding unavailable');
  const decoder = new Context(1, 1, 48000);
  const audio = await decoder.decodeAudioData(encoded.buffer);
  signal.throwIfAborted();
  const length = Math.min(audio.length, 48000 * 30);
  if (length < 48000) throw new Error('Preview too short');
  const pcm = new ArrayBuffer(length * 2), view = new DataView(pcm);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  for (let i = 0; i < length; i++) {
    const value = channels.reduce((sum, samples) => sum + samples[i], 0) / channels.length;
    view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(value * 32768))), true);
    if (i % 48000 === 0) { await new Promise((r) => setTimeout(r, 0)); signal.throwIfAborted(); }
  }
  return pcm;
}

export async function analyzeSongOnDemand(track, { signal, onStage = () => {} } = {}) {
  const timeout = AbortSignal.timeout(45000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  combined.throwIfAborted();
  if ((await musicRequest('aiStatus', { track_id: track.track_id }, { signal: combined })).ai_indexed) return { state: 'indexed' };
  if (!track.preview_url) return { state: 'unavailable', reason: 'No preview is available for AI analysis.' };
  let storage;
  try { storage = window.localStorage; } catch { /* optional */ }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(track.preview_url));
  const key = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
  let result = readCached(key, storage), cached = Boolean(result);
  if (!result) {
    onStage('Preparing the preview for AI');
    const pcm = await previewPCM(track.preview_url, combined);
    onStage('AI is listening · acoustic matches are already playing');
    const response = await fetch('/api/analyze-audio', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
      body: pcm, signal: combined, credentials: 'omit' });
    if (!response.ok) throw new Error(response.status === 429 ? 'AI is busy; acoustic matching is still active.' : 'AI analysis is unavailable; acoustic matching is still active.');
    result = await response.json();
    if (!validResult(result)) throw new Error('AI returned an incompatible result; acoustic matching is still active.');
    cacheResult(key, result, storage);
    cached = result.cached;
  }
  combined.throwIfAborted();
  const attached = await musicRequest('aiUpsert', { result: { ...result, row: { ...result.row, track_id: track.track_id } } }, { signal: combined });
  if (!attached.added) throw new Error('AI index could not be updated; acoustic matching is still active.');
  return { state: 'ready', cached, elapsed_ms: result.elapsed_ms };
}
