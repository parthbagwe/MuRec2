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

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function fftMagnitudes(samples) {
  const size = samples.length;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    real[index] = samples[index] * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1)));
  }
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const baseReal = Math.cos(angle);
    const baseImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * rotationReal - imaginary[odd] * rotationImaginary;
        const oddImaginary = real[odd] * rotationImaginary + imaginary[odd] * rotationReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = rotationReal * baseReal - rotationImaginary * baseImaginary;
        rotationImaginary = rotationReal * baseImaginary + rotationImaginary * baseReal;
        rotationReal = nextReal;
      }
    }
  }
  return Array.from({ length: size / 2 }, (_, index) => Math.hypot(real[index], imaginary[index]));
}

function estimateTempo(frames, hopSeconds) {
  const envelope = frames.map((frame) => frame.onset);
  let best = { bpm: 96, score: 0 };
  for (let lag = Math.round(60 / (190 * hopSeconds)); lag <= Math.round(60 / (58 * hopSeconds)); lag += 1) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = lag; index < envelope.length; index += 1) {
      dot += envelope[index] * envelope[index - lag];
      normA += envelope[index] ** 2;
      normB += envelope[index - lag] ** 2;
    }
    const score = dot / Math.max(Math.sqrt(normA * normB), 1e-9);
    const bpm = 60 / (lag * hopSeconds);
    const pulsePrior = Math.exp(-Math.abs(bpm - 112) / 150);
    if (score * pulsePrior > best.score) best = { bpm, score: score * pulsePrior };
  }
  return { bpm: clamp(best.bpm, 58, 190), confidence: clamp((best.score - 0.08) / 0.72, 0, 1), regularity: clamp(best.score, 0, 1) };
}

async function spectralFingerprint(mono, sampleRate, onProgress) {
  const fftSize = 2048;
  const frameCount = 42;
  const chroma = new Float64Array(12);
  const logBands = new Float64Array(26);
  let centroidTotal = 0;
  let rolloffTotal = 0;
  let flatnessTotal = 0;
  let contrastTotal = 0;
  let fluxTotal = 0;
  let previousSpectrum = null;
  const frequencyResolution = sampleRate / fftSize;
  const usableLength = Math.max(1, mono.length - fftSize - 1);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = Math.floor(usableLength * (frameIndex + 0.5) / frameCount);
    const magnitudes = fftMagnitudes(mono.subarray(start, start + fftSize));
    let magnitudeTotal = 0;
    let weightedFrequency = 0;
    let logMagnitude = 0;
    const spectrumValues = [];
    for (let bin = 1; bin < magnitudes.length; bin += 1) {
      const frequency = bin * frequencyResolution;
      if (frequency > 11025) break;
      const magnitude = magnitudes[bin] + 1e-10;
      magnitudeTotal += magnitude;
      weightedFrequency += magnitude * frequency;
      logMagnitude += Math.log(magnitude);
      spectrumValues.push(magnitude);
      if (frequency >= 55 && frequency <= 5000) {
        const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
        chroma[((midi % 12) + 12) % 12] += magnitude;
      }
      const logarithmicPosition = Math.log2(Math.max(40, frequency) / 40) / Math.log2(11025 / 40);
      const band = clamp(Math.floor(logarithmicPosition * logBands.length), 0, logBands.length - 1);
      logBands[band] += magnitude;
    }
    centroidTotal += weightedFrequency / Math.max(magnitudeTotal, 1e-10);
    let running = 0;
    const target = magnitudeTotal * 0.85;
    let rolloff = 0;
    for (let bin = 1; bin < magnitudes.length; bin += 1) {
      running += magnitudes[bin];
      if (running >= target) { rolloff = bin * frequencyResolution; break; }
    }
    rolloffTotal += rolloff;
    flatnessTotal += Math.exp(logMagnitude / Math.max(1, spectrumValues.length)) / Math.max(magnitudeTotal / Math.max(1, spectrumValues.length), 1e-10);
    const sorted = spectrumValues.sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const high = sorted[Math.floor(sorted.length * 0.9)] ?? low;
    contrastTotal += 20 * Math.log10((high + 1e-10) / (low + 1e-10));
    if (previousSpectrum) {
      let change = 0;
      for (let index = 0; index < magnitudes.length; index += 1) {
        const difference = magnitudes[index] / Math.max(magnitudeTotal, 1e-10) - previousSpectrum[index];
        if (difference > 0) change += difference * difference;
      }
      fluxTotal += Math.sqrt(change);
    }
    previousSpectrum = magnitudes.map((value) => value / Math.max(magnitudeTotal, 1e-10));
    if (frameIndex % 7 === 6) {
      onProgress?.({ progress: 0.54 + 0.30 * (frameIndex + 1) / frameCount, stage: "Mapping spectrum and timbre" });
      await yieldToBrowser();
    }
  }

  const chromaTotal = chroma.reduce((sum, value) => sum + value, 0) || 1;
  const normalizedChroma = Array.from(chroma, (value) => value / chromaTotal);
  const bandLogs = Array.from(logBands, (value) => Math.log1p(value / frameCount));
  const mfcc = Array.from({ length: 13 }, (_, coefficient) => {
    let total = 0;
    for (let band = 0; band < bandLogs.length; band += 1) total += bandLogs[band] * Math.cos(Math.PI * coefficient * (band + 0.5) / bandLogs.length);
    return coefficient === 0 ? total * 12 - 420 : total * 8;
  });
  return {
    centroid: centroidTotal / frameCount,
    rolloff: rolloffTotal / frameCount,
    flatness: clamp(flatnessTotal / frameCount, 0, 1),
    contrast: clamp(contrastTotal / frameCount, 0, 80),
    flux: fluxTotal / Math.max(1, frameCount - 1),
    chroma: normalizedChroma,
    mfcc,
  };
}

export function samplePreviewProfile(profile, time = 0) {
  if (!profile?.frames?.length) return null;
  const position = clamp(time / profile.hopSeconds, 0, profile.frames.length - 1);
  const first = profile.frames[Math.floor(position)] || profile.frames[0];
  const second = profile.frames[Math.min(profile.frames.length - 1, Math.ceil(position))] || first;
  const mix = position - Math.floor(position);
  const interpolate = (name) => Number(first[name] ?? 0) + (Number(second[name] ?? 0) - Number(first[name] ?? 0)) * mix;
  return {
    level: interpolate("level"),
    bass: interpolate("bass"),
    brightness: interpolate("brightness"),
    texture: interpolate("texture"),
    transient: interpolate("onset"),
    crest: interpolate("crest"),
  };
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

async function analyzeDecodedBuffer(buffer, onProgress) {
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
    let peak = 0;
    let zeroCrossings = 0;
    let previousSample = mono[start];
    for (let offset = 0; offset < frameSize; offset += 1) {
      const sample = mono[start + offset];
      const difference = sample - previousSample;
      square += sample * sample;
      differenceSquare += difference * difference;
      lowSquare += bandEnergy[start + offset] * bandEnergy[start + offset];
      peak = Math.max(peak, Math.abs(sample));
      if ((sample >= 0) !== (previousSample >= 0)) zeroCrossings += 1;
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
      highRatio: clamp(high / Math.max(rms, 0.0001), 0, 2.5),
      crestRaw: clamp(peak / Math.max(rms, 0.0001), 1, 12),
      zeroCrossingRate: zeroCrossings / frameSize,
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
  const levelCeiling = Math.max(0.001, percentile(frames.map((frame) => frame.rms), 0.94));
  const brightnessFloor = percentile(frames.map((frame) => frame.highRatio), 0.12);
  const brightnessCeiling = Math.max(brightnessFloor + 0.001, percentile(frames.map((frame) => frame.highRatio), 0.92));
  for (const frame of frames) {
    frame.onset = clamp(frame.onsetRaw / onsetCeiling, 0, 1);
    frame.level = clamp(frame.rms / levelCeiling, 0, 1);
    frame.bass = clamp(frame.lowRatio / 1.12, 0, 1);
    frame.brightness = clamp((frame.highRatio - brightnessFloor) / (brightnessCeiling - brightnessFloor), 0, 1);
    frame.crest = clamp((frame.crestRaw - 1) / 7, 0, 1);
    frame.texture = clamp(frame.brightness * 0.58 + frame.zeroCrossingRate * 5.2 * 0.42, 0, 1);
  }
  onProgress?.({ progress: 0.50, stage: "Reading rhythm and transients" });
  await yieldToBrowser();

  const spectrum = await spectralFingerprint(mono, sampleRate, onProgress);
  const tempo = estimateTempo(frames, hopSeconds);
  const onsetThreshold = 0.44;
  let onsets = 0;
  let lastOnsetTime = -1;
  for (let index = 1; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    if (frame.onset >= onsetThreshold && frame.onset >= frames[index - 1].onset && frame.onset > frames[index + 1].onset && frame.time - lastOnsetTime >= 0.11) {
      onsets += 1;
      lastOnsetTime = frame.time;
    }
  }
  const rmsValues = frames.map((frame) => frame.rms);
  const globalRms = Math.sqrt(totalSquare / Math.max(1, frames.length * frameSize));
  const zeroCrossingRate = frames.reduce((sum, frame) => sum + frame.zeroCrossingRate, 0) / Math.max(1, frames.length);
  const percussiveRatio = clamp(0.20 + tempo.confidence * 0.22 + onsets / Math.max(buffer.duration, 1) * 0.085 + spectrum.flux * 2.4, 0, 1);
  const chromaPeak = Math.max(...spectrum.chroma);
  const tonalStrength = clamp((chromaPeak - 1 / 12) / 0.12, 0, 1);
  const harmonicRatio = clamp(0.22 + tonalStrength * 0.5 + (1 - percussiveRatio) * 0.24, 0, 1);
  const energy = clamp(globalRms * 400, 0, 100);
  const brightness = clamp(spectrum.centroid / 5000, 0, 1);
  const dynamicRange = clamp((percentile(rmsValues, 0.9) - percentile(rmsValues, 0.1)) * 8, 0, 1);
  const tempoFit = Math.exp(-Math.abs(tempo.bpm - 118) / 48);
  const danceability = clamp(0.35 * tempoFit + 0.30 * tempo.regularity + 0.20 * percussiveRatio + 0.15 * tempo.confidence, 0, 1);
  const aggression = clamp(0.30 * Math.min(globalRms * 5, 1) + 0.25 * Math.min(zeroCrossingRate / 0.18, 1) + 0.25 * brightness + 0.20 * percussiveRatio, 0, 1);
  const majorScores = spectrum.chroma.map((_, root) => [0, 4, 7].reduce((sum, interval) => sum + spectrum.chroma[(root + interval) % 12], 0));
  const minorScores = spectrum.chroma.map((_, root) => [0, 3, 7].reduce((sum, interval) => sum + spectrum.chroma[(root + interval) % 12], 0));
  const majorScore = Math.max(...majorScores);
  const minorScore = Math.max(...minorScores);
  const mode = majorScore >= minorScore ? "major" : "minor";
  const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const key = keyNames[spectrum.chroma.indexOf(chromaPeak)];
  const valence = clamp(0.35 + 0.4 * majorScore / Math.max(majorScore + minorScore, 1e-10), 0, 1);
  const onsetDensity = onsets / Math.max(buffer.duration, 1);
  let texture = "dense-balanced";
  if (spectrum.flatness > 0.18 || (zeroCrossingRate > 0.14 && aggression > 0.58)) texture = "noisy-distorted";
  else if (percussiveRatio > 0.56 && brightness > 0.42) texture = "bright-percussive";
  else if (harmonicRatio > 0.64 && brightness < 0.38) texture = "warm-harmonic";
  else if (globalRms < 0.08 && brightness > 0.35) texture = "airy-sparse";
  const tempoBand = tempo.bpm < 70 ? "slow-drift" : tempo.bpm < 96 ? "measured-groove" : tempo.bpm < 126 ? "mid-pulse" : tempo.bpm < 156 ? "fast-drive" : "high-velocity";
  const intensity = aggression > 0.72 ? "ferocious" : energy > 55 || aggression > 0.55 ? "driving" : energy > 28 ? "restrained" : "low-intensity";
  const rhythmCharacter = onsetDensity > 3.6 && percussiveRatio > 0.48 ? "rhythm-forward" : tempo.regularity > 0.72 ? "steady-pulse" : onsetDensity < 1.2 ? "sparse-rhythm" : "loose-flow";
  const harmonicCharacter = tonalStrength < 0.16 ? "tonally-ambiguous" : mode === "minor" && valence < 0.57 ? "dark-minor" : mode === "major" ? "bright-major" : "harmonically-rich";
  const acousticSignature = [intensity, texture, rhythmCharacter, harmonicCharacter, tempoBand].join(" · ");
  const vector = [tempo.bpm, energy, valence, brightness, spectrum.centroid, spectrum.rolloff, spectrum.flux, globalRms, zeroCrossingRate, tempo.confidence, ...spectrum.mfcc, ...spectrum.chroma];
  const fingerprint = {
    vector: vector.map((value) => Number(value.toFixed(6))),
    acoustic_signature: acousticSignature,
    profile: {
      bpm: Number(tempo.bpm.toFixed(1)), energy: Number(energy.toFixed(1)), brightness: Number(brightness.toFixed(3)),
      spectral_centroid_hz: Number(spectrum.centroid.toFixed(1)), spectral_rolloff_hz: Number(spectrum.rolloff.toFixed(1)),
      zero_crossing_rate: Number(zeroCrossingRate.toFixed(4)), tempo_confidence: Number(tempo.confidence.toFixed(3)),
      spectral_flatness: Number(spectrum.flatness.toFixed(4)), spectral_contrast: Number(spectrum.contrast.toFixed(3)),
      onset_density: Number(onsetDensity.toFixed(3)), beat_regularity: Number(tempo.regularity.toFixed(3)),
      dynamic_range: Number(dynamicRange.toFixed(3)), harmonic_ratio: Number(harmonicRatio.toFixed(3)),
      percussive_ratio: Number(percussiveRatio.toFixed(3)), tonal_strength: Number(tonalStrength.toFixed(3)),
      danceability: Number(danceability.toFixed(3)), aggression: Number(aggression.toFixed(3)), key, mode,
      timbre: texture, texture, tempo_band: tempoBand, intensity, rhythm_character: rhythmCharacter,
      harmonic_character: harmonicCharacter, acoustic_signature: acousticSignature, analysis_source: "client-preview-v1",
    },
  };
  onProgress?.({ progress: 0.92, stage: "Building acoustic fingerprint" });
  await yieldToBrowser();
  return {
    duration: buffer.duration,
    globalRms,
    hopSeconds,
    frames,
    fingerprint,
  };
}

export function analyzePreview(previewUrl, onProgress = null) {
  if (!previewUrl) return Promise.reject(new Error("A preview URL is required."));
  if (previewAnalysisCache.has(previewUrl)) {
    onProgress?.({ progress: 1, stage: "Fingerprint ready" });
    return previewAnalysisCache.get(previewUrl);
  }
  const analysis = (async () => {
    onProgress?.({ progress: 0.06, stage: "Loading the 30-second preview" });
    const proxyUrl = `/preview-analysis?source=${encodeURIComponent(previewUrl)}`;
    let response = await fetch(proxyUrl, { cache: "force-cache" });
    const proxyType = response.headers.get("content-type") || "";
    if (!response.ok || !proxyType.toLowerCase().startsWith("audio/")) {
      response = await fetch(previewUrl, { mode: "cors", cache: "force-cache" });
    }
    if (!response.ok) throw new Error(`Preview analysis failed with ${response.status}.`);
    const encodedAudio = await response.arrayBuffer();
    onProgress?.({ progress: 0.22, stage: "Decoding audio locally" });
    await yieldToBrowser();
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = OfflineContext ? new OfflineContext(1, 1, 44100) : new AudioContextClass();
    const buffer = await context.decodeAudioData(encodedAudio.slice(0));
    onProgress?.({ progress: 0.34, stage: "Reading rhythm and transients" });
    const profile = await analyzeDecodedBuffer(buffer, onProgress);
    if (typeof context.close === "function") await context.close();
    onProgress?.({ progress: 1, stage: "Fingerprint ready" });
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
