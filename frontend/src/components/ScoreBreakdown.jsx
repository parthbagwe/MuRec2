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
  return (
    <div className="score-breakdown">
      <Bar label="audio" value={rec.audio_similarity} color="#7F77DD" />
      <Bar label="lyrics" value={rec.lyric_similarity} color="#1D9E75" />
      <Bar label="collab" value={rec.collab_similarity} color="#EF9F27" />
    </div>
  );
}
