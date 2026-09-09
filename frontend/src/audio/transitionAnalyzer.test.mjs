import assert from "node:assert/strict";
import test from "node:test";
import { createFadeCurves } from "./audioMixEngine.js";
import { buildTransitionPlan } from "./transitionAnalyzer.js";

function profile({ bpm = 120, confidence = 0.82, regularity = 0.84, energy = 58, brightness = 0.45, bass = 0.48, chromaRoot = 0, tonal = 0.72, flatness = 0.08 } = {}) {
  const frames = [];
  const hopSeconds = 0.25;
  for (let index = 0; index < 120; index += 1) {
    const time = index * hopSeconds;
    const beat = Math.abs((time * bpm / 60) - Math.round(time * bpm / 60)) < 0.08;
    frames.push({
      time,
      rms: 0.05 + energy / 1600 + (beat ? 0.018 : 0),
      onset: beat ? 0.88 : 0.06,
      lowRatio: bass,
      bass,
      brightness,
      vocalEstimate: 0.42,
    });
  }
  const chroma = Array.from({ length: 12 }, (_, index) => index === chromaRoot ? 0.72 : index === (chromaRoot + 7) % 12 ? 0.2 : 0.008);
  return {
    duration: 30,
    globalRms: 0.08,
    hopSeconds,
    frames,
    fingerprint: {
      vector: [bpm, energy, ...Array(13).fill(0), ...chroma],
      profile: {
        bpm,
        tempo_confidence: confidence,
        beat_regularity: regularity,
        energy,
        brightness,
        tonal_strength: tonal,
        spectral_flatness: flatness,
      },
    },
  };
}

test("stable compatible previews use a beat-aligned transition", () => {
  const plan = buildTransitionPlan(
    profile({ bpm: 120, chromaRoot: 0 }),
    profile({ bpm: 123, chromaRoot: 0 }),
    {},
    {},
  );
  assert.equal(plan.mode, "beat_aligned");
  assert.ok(plan.playbackRate >= 0.95 && plan.playbackRate <= 1.05);
  assert.ok(plan.duration >= 3.1 && plan.duration <= 5.8);
  assert.equal(plan.source, "preview-analysis");
});

test("rhythmically uncertain but similar previews get a gentle crossfade", () => {
  const plan = buildTransitionPlan(
    profile({ bpm: 82, confidence: 0.12, regularity: 0.2, energy: 31, chromaRoot: 4 }),
    profile({ bpm: 91, confidence: 0.16, regularity: 0.18, energy: 35, chromaRoot: 4 }),
    {},
    {},
  );
  assert.equal(plan.mode, "gentle_crossfade");
  assert.equal(plan.playbackRate, 1);
  assert.ok(plan.duration >= 2.4 && plan.duration <= 4.2);
});

test("incompatible previews use a short clean handoff", () => {
  const plan = buildTransitionPlan(
    profile({ bpm: 64, confidence: 0.08, regularity: 0.1, energy: 8, brightness: 0.05, bass: 0.05, chromaRoot: 0, tonal: 0.1, flatness: 0.65 }),
    profile({ bpm: 178, confidence: 0.08, regularity: 0.1, energy: 98, brightness: 0.98, bass: 1, chromaRoot: 1, tonal: 0.1, flatness: 0.65 }),
    {},
    {},
  );
  assert.equal(plan.mode, "clean_handoff");
  assert.equal(plan.playbackRate, 1);
  assert.ok(plan.duration <= 1.15);
  assert.equal(plan.estimates.vocalActivityUsed, false);
});

test("transition points and overlap stay inside each 30-second preview", () => {
  const plan = buildTransitionPlan(profile(), profile(), {}, {});
  assert.ok(plan.outgoingStart >= 0);
  assert.ok(plan.incomingStart >= 0);
  assert.ok(plan.outgoingStart + plan.duration <= 30);
  assert.ok(plan.incomingStart + plan.duration <= 30);
});

test("audio-clock fade curves are balanced and reach exact endpoints", () => {
  const { outgoing, incoming } = createFadeCurves(96, "equal_power", 0.82);
  assert.equal(outgoing[0], 1);
  assert.equal(outgoing.at(-1), 0);
  assert.equal(incoming[0], 0);
  assert.ok(Math.abs(incoming.at(-1) - 0.82) < 0.0001);
  const middle = Math.floor(outgoing.length / 2);
  assert.ok(outgoing[middle] > 0.65 && incoming[middle] > 0.5);
});
