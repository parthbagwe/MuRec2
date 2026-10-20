const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
// Music clips share substantial embedding structure. Keep strong matches apart
// instead of saturating every cosine above 0.75 to the same ranking value.
const scaledSimilarity = (cosineValue) => clamp((cosineValue - 0.35) / 0.65);
function unit(values) {
  const norm = Math.hypot(...values);
  return norm > 0 ? Float32Array.from(values, (v) => v / norm) : null;
}
export function cosine(left, right) {
  if (!left || !right || left.length !== right.length) return null;
  let total = 0;
  for (let i = 0; i < left.length; i++) total += left[i] * right[i];
  return clamp(total, -1, 1);
}
function moodDistribution(scores) {
  const max = Math.max(...scores);
  const weights = scores.map((x) => Math.exp((x - max) * 12));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((x) => x / sum);
}
export function createIntelligence(data) {
  const rows = new Map();
  const labels = data?.labels || [];
  if (data?.schema === 1 && data.dimensions === 512 && labels.length === 8) {
    for (const row of data.tracks || []) {
      if (!row.track_id || row.embedding?.length !== 512 || row.mood_scores?.length !== labels.length
        || !row.embedding.every((x) => Number.isInteger(x) && Math.abs(x) <= 127)
        || !row.mood_scores.every(Number.isFinite) || !Number.isFinite(row.preview_seconds)
        || row.preview_seconds < 1 || row.preview_seconds > 30) continue;
      const embedding = unit(row.embedding);
      if (!embedding) continue;
      const moods = moodDistribution(row.mood_scores);
      const order = row.mood_scores.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
      rows.set(String(row.track_id), { embedding, moods,
        // Margin is evidence strength, not a calibrated probability.
        mood: order[0].v - order[1].v >= 0.025 ? labels[order[0].i] : null });
    }
  }
  const get = (track) => rows.get(String(track?.track_id ?? track));
  const sadIndex = labels.indexOf('melancholic');
  const compatibility = (a, b) => clamp(1 - a.moods.reduce((sum, v, i) => sum + Math.abs(v - b.moods[i]), 0) / 2);
  return {
    indexed: rows.size,
    describe(track) {
      const row = get(track);
      return row ? { ai_indexed: true, ai_model: data.model, predicted_mood: row.mood } : { ai_indexed: false };
    },
    scorePair(anchor, candidate, { score, mode, preferences, previous }) {
      const a = get(anchor), b = get(candidate);
      let next = score;
      const reasons = [], metadata = { ...this.describe(candidate) };
      if (a && b) {
        const raw = cosine(a.embedding, b.embedding);
        const sound = scaledSimilarity(raw);
        const mood = compatibility(a, b);
        // Multiplicative adjustment retains the existing genre/vibe penalties.
        // Transition ranking stays dominated by measured tempo/key/entry/exit compatibility.
        const strength = mode === 'transition' ? 0.14 : ['rhythm', 'timbre'].includes(mode) ? 0.20 : 0.42;
        next *= (1 - strength) + strength * (0.35 + 1.10 * sound);
        next *= 0.72 + 0.28 * mood;
        if (mode === 'transition' && previous && get(previous)) {
          const flow = cosine(get(previous).embedding, b.embedding);
          next *= 0.94 + 0.06 * scaledSimilarity(flow);
        }
        metadata.neural_similarity = Number(raw.toFixed(4));
        metadata.predicted_mood_similarity = Number(mood.toFixed(4));
        metadata.ai_pair_indexed = true;
        if (raw >= 0.60) reasons.push('similar sound · audio model');
        if (a.mood && a.mood === b.mood) reasons.push(`predicted ${b.mood} mood`);
      }
      const feedback = preferences?.feedback || [];
      const direct = feedback.find((f) => String(f.track_id) === String(candidate.track_id));
      if (direct) next *= direct.reason === 'more_like_this' ? 1.12 : 0.12;
      if (b) {
        // A few recent explicit examples influence a listener, without requiring other users' data.
        for (const f of feedback.slice(0, 12)) {
          const reference = get(f.track_id);
          if (!reference || f.track_id === candidate.track_id) continue;
          const related = clamp(((cosine(reference.embedding, b.embedding) ?? 0) - 0.55) / 0.45);
          if (f.reason === 'more_like_this') next *= 1 + related * 0.07;
          if (f.reason === 'too_different' && a && get(f.track_id)) {
            // Tighten around the anchor rather than banning the rejected song's whole genre.
            next *= 0.90 + 0.10 * scaledSimilarity(cosine(a.embedding, b.embedding) ?? 0);
          }
          if (f.reason === 'too_sad' && sadIndex >= 0 && reference.moods[sadIndex] > 0.16) {
            next *= 1 - Math.min(0.18, b.moods[sadIndex] * 0.35);
          }
        }
      }
      if (feedback.length) metadata.feedback_applied = true;
      return { score: clamp(next), metadata, reasons };
    },
  };
}
