function Bar({ label, value, color }) {
  return (
    <div className="score-row">
      <span>{label}</span>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
      <strong>
        {value.toFixed(2)}
      </strong>
    </div>
  );
}

export default function ScoreBreakdown({ rec }) {
  const labels = rec.score_mode === "acoustic-transition"
    ? ["tempo", "texture", "key"]
    : rec.score_mode?.startsWith("acoustic-fingerprint")
    ? ["rhythm", "timbre", "harmony"]
    : ({
    "metadata": ["subgenre", "artist", "era"],
    "metadata-adjacent": ["adjacency", "new artist", "era"],
    "metadata-era": ["subgenre", "artist", "era"],
    "metadata-discover": ["subgenre", "new artist", "era"],
    "metadata-personalized": ["your taste", "reference", "freshness"],
    "acoustic-profile": ["profile", "genre", "era"],
    }[rec.score_mode] || ["audio", "lyrics", "collab"]);
  return (
    <div className="score-breakdown">
      <Bar label={labels[0]} value={rec.audio_similarity} color="#f0ff37" />
      <Bar label={labels[1]} value={rec.lyric_similarity} color="#ff5aa5" />
      <Bar label={labels[2]} value={rec.collab_similarity} color="#6c57ff" />
    </div>
  );
}
