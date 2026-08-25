const previewAnalysisCache = new Map();

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values, amount) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

function normalizedTempoPair(outgoingBpm, incomingBpm) {
  const first = Number(outgoingBpm) || 96;
  const rawSecond = Number(incomingBpm) || first;
  const second = [rawSecond, rawSecond / 2, rawSecond * 2]
    .sort((a, b) => Math.abs(first - a) - Math.abs(first - b))[0];
  return [clamp(first, 55, 190), clamp(second, 55, 190)];
}

function frameAt(profile, time) {
  const index = Math.round(time / profile.hopSeconds);
  return profile.frames[clamp(index, 0, profile.frames.length - 1)] || profile.frames[0];
}

function windowRms(profile, start, end) {
  let total = 0;
  let count = 0;
  for (const frame of profile.frames) {
    if (frame.time < start || frame.time > end) continue;
    total += frame.rms * frame.rms;
    count += 1;
  }
  return count ? Math.sqrt(total / count) : profile.globalRms;
}

function beatPhase(profile, bpm) {
  const beatSeconds = 60 / bpm;
  const bins = 48;
  const histogram = new Float32Array(bins);
  for (const frame of profile.frames) {
    if (frame.onset < 0.08) continue;
    const phase = ((frame.time % beatSeconds) + beatSeconds) % beatSeconds;
    const bin = Math.round(phase / beatSeconds * bins) % bins;
    histogram[bin] += frame.onset * (0.65 + frame.lowRatio * 0.7);
    histogram[(bin + 1) % bins] += frame.onset * 0.35;
    histogram[(bin + bins - 1) % bins] += frame.onset * 0.35;
  }
  let strongest = 0;
  for (let index = 1; index < bins; index += 1) {
    if (histogram[index] > histogram[strongest]) strongest = index;
  }
  return strongest / bins * beatSeconds;
}

function beatCandidates(profile, bpm, earliest, latest) {
  const beatSeconds = 60 / bpm;
  const phase = beatPhase(profile, bpm);
  const candidates = [];
  let time = phase + Math.ceil((earliest - phase) / beatSeconds) * beatSeconds;
  for (; time <= latest; time += beatSeconds) candidates.push(time);
  return candidates;
}

function downbeatPhase(profile, bpm) {
  const beatSeconds = 60 / bpm;
  const phase = beatPhase(profile, bpm);
  const positions = new Float32Array(4);
  for (const frame of profile.frames) {
    if (frame.onset < 0.08) continue;
    const beatIndex = Math.round((frame.time - phase) / beatSeconds);
    const position = ((beatIndex % 4) + 4) % 4;
    positions[position] += frame.onset * (0.55 + frame.lowRatio * 0.9);
  }
  let strongest = 0;
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] > positions[strongest]) strongest = index;
  }
  return phase + strongest * beatSeconds;
}

function phraseCandidates(profile, bpm, earliest, latest) {
  const beatSeconds = 60 / bpm;
  const phraseSeconds = beatSeconds * 4;
  const phase = downbeatPhase(profile, bpm);
  const candidates = [];
  let time = phase + Math.ceil((earliest - phase) / phraseSeconds) * phraseSeconds;
  for (; time <= latest; time += phraseSeconds) candidates.push(time);
  return candidates.length ? candidates : beatCandidates(profile, bpm, earliest, latest);
}

function incomingEntry(profile, bpm, latest) {
  const candidates = phraseCandidates(profile, bpm, 0, Math.max(0, latest));
  if (!candidates.length) return 0;
  let best = { time: candidates[0], score: -Infinity };
  for (const time of candidates) {
    const frame = frameAt(profile, time);
    const before = windowRms(profile, Math.max(0, time - 0.7), time);
    const after = windowRms(profile, time, Math.min(profile.duration, time + 1.8));
    const lift = clamp((after - before) / Math.max(after, 0.001), -1, 1);
    const earlyPreference = 1 - time / Math.max(1, latest + 1);
    const score = frame.onset * 1.4 + frame.lowRatio * 0.5 + lift * 0.75 + earlyPreference * 0.18;
    if (score > best.score) best = { time, score };
  }
  return Math.max(0, best.time - 0.025);
}

function outgoingBoundary(profile, bpm, mixSeconds) {
  const latest = Math.max(0, profile.duration - mixSeconds - 0.18);
  const earliest = Math.max(0, latest - Math.min(8, mixSeconds * 1.35));
  const candidates = phraseCandidates(profile, bpm, earliest, latest);
  if (!candidates.length) return latest;
  let best = { time: latest, score: -Infinity };
  for (const time of candidates) {
    const frame = frameAt(profile, time);
    const before = windowRms(profile, Math.max(0, time - 1.8), time);
    const after = windowRms(profile, time, Math.min(profile.duration, time + mixSeconds));
    const release = clamp((before - after) / Math.max(before, 0.001), -1, 1);
    const proximity = 1 - Math.abs(latest - time) / Math.max(1, latest - earliest);
    const score = frame.onset * 0.85 + frame.lowRatio * 0.3 + release * 0.8 + proximity * 0.45;
    if (score > best.score) best = { time, score };
  }
  return best.time;
}

function analyzeDecodedBuffer(buffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) mono[index] += samples[index] / channels;
  }

  const frameSize = 2048;
  const hopSize = 1024;
  const hopSeconds = hopSize / sampleRate;
  const low180Coefficient = Math.exp(-2 * Math.PI * 180 / sampleRate);
  const low40Coefficient = Math.exp(-2 * Math.PI * 40 / sampleRate);
  let low180 = 0;
  let low40 = 0;
  const bandEnergy = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    low180 = (1 - low180Coefficient) * mono[index] + low180Coefficient * low180;
    low40 = (1 - low40Coefficient) * mono[index] + low40Coefficient * low40;
    bandEnergy[index] = low180 - low40;
  }

  const frames = [];
  let totalSquare = 0;
  let previousRms = 0;
  let previousHigh = 0;
  let previousLow = 0;
  const rawOnsets = [];
  for (let start = 0; start + frameSize < length; start += hopSize) {
    let square = 0;
    let differenceSquare = 0;
    let lowSquare = 0;
    let previousSample = mono[start];
    for (let offset = 0; offset < frameSize; offset += 1) {
      const sample = mono[start + offset];
      const difference = sample - previousSample;
      square += sample * sample;
      differenceSquare += difference * difference;
      lowSquare += bandEnergy[start + offset] * bandEnergy[start + offset];
      previousSample = sample;
    }
    const rms = Math.sqrt(square / frameSize);
    const high = Math.sqrt(differenceSquare / frameSize);
    const low = Math.sqrt(lowSquare / frameSize);
    const onsetRaw = Math.max(0, Math.log1p(rms * 160) - Math.log1p(previousRms * 160))
      + Math.max(0, Math.log1p(high * 130) - Math.log1p(previousHigh * 130)) * 0.8
      + Math.max(0, Math.log1p(low * 180) - Math.log1p(previousLow * 180)) * 0.55;
    frames.push({
      time: (start + frameSize / 2) / sampleRate,
      rms,
      lowRatio: clamp(low / Math.max(rms, 0.0001), 0, 1.5),
      onsetRaw,
      onset: 0,
    });
    rawOnsets.push(onsetRaw);
    totalSquare += square;
    previousRms = rms;
    previousHigh = high;
    previousLow = low;
  }
  const onsetCeiling = Math.max(0.001, percentile(rawOnsets, 0.94));
  for (const frame of frames) frame.onset = clamp(frame.onsetRaw / onsetCeiling, 0, 1);
  return {
    duration: buffer.duration,
    globalRms: Math.sqrt(totalSquare / Math.max(1, frames.length * frameSize)),
    hopSeconds,
    frames,
  };
}

export function analyzePreview(previewUrl) {
  if (!previewUrl) return Promise.reject(new Error("A preview URL is required."));
  if (previewAnalysisCache.has(previewUrl)) return previewAnalysisCache.get(previewUrl);
  const analysis = (async () => {
    const response = await fetch(previewUrl, { mode: "cors", cache: "force-cache" });
    if (!response.ok) throw new Error(`Preview analysis failed with ${response.status}.`);
    const encodedAudio = await response.arrayBuffer();
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = OfflineContext ? new OfflineContext(1, 1, 44100) : new AudioContextClass();
    const buffer = await context.decodeAudioData(encodedAudio.slice(0));
    const profile = analyzeDecodedBuffer(buffer);
    if (typeof context.close === "function") await context.close();
    return profile;
  })().catch((error) => {
    previewAnalysisCache.delete(previewUrl);
    throw error;
  });
  previewAnalysisCache.set(previewUrl, analysis);
  return analysis;
}

export function buildTransitionPlan(outgoingProfile, incomingProfile, outgoingTrack, incomingTrack) {
  const [outgoingBpm, matchedIncomingBpm] = normalizedTempoPair(outgoingTrack?.bpm, incomingTrack?.bpm);
  const rawIncomingBpm = Number(incomingTrack?.bpm) || matchedIncomingBpm;
  const playbackRate = clamp(outgoingBpm / matchedIncomingBpm, 0.94, 1.06);
  const phraseBeats = outgoingBpm >= 132 ? 12 : 8;
  const mixSeconds = clamp(phraseBeats * 60 / outgoingBpm, 3.4, 7.2);
  const outgoingStart = outgoingBoundary(outgoingProfile, outgoingBpm, mixSeconds);
  const latestEntry = Math.min(10, Math.max(0, incomingProfile.duration - mixSeconds - 2));
  const incomingStart = incomingEntry(incomingProfile, rawIncomingBpm, latestEntry);
  const outgoingLoudness = windowRms(outgoingProfile, outgoingStart, Math.min(outgoingProfile.duration, outgoingStart + mixSeconds));
  const incomingLoudness = windowRms(incomingProfile, incomingStart, Math.min(incomingProfile.duration, incomingStart + mixSeconds));
  const incomingGain = clamp(outgoingLoudness / Math.max(incomingLoudness, 0.001), 0.68, 1);
  const confidence = clamp(
    (percentile(outgoingProfile.frames.map((frame) => frame.onset), 0.85)
      + percentile(incomingProfile.frames.map((frame) => frame.onset), 0.85)) / 2,
    0,
    1,
  );
  return {
    outgoingStart,
    incomingStart,
    duration: Math.min(mixSeconds, outgoingProfile.duration - outgoingStart - 0.08),
    playbackRate,
    incomingGain,
    confidence,
    source: "preview-analysis",
  };
}
