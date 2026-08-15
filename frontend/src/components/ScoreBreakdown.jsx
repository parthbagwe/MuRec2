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
  const labels = rec.score_mode === "metadata"
    ? ["genre", "artist", "era"]
    : rec.score_mode === "acoustic-profile"
      ? ["profile", "genre", "era"]
      : ["audio", "lyrics", "collab"];
  return (
    <div className="score-breakdown">
      <Bar label={labels[0]} value={rec.audio_similarity} color="#7F77DD" />
      <Bar label={labels[1]} value={rec.lyric_similarity} color="#1D9E75" />
      <Bar label={labels[2]} value={rec.collab_similarity} color="#EF9F27" />
    </div>
  );
}
