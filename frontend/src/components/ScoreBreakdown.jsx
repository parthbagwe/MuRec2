function Bar({ label, value, color }) {
  return (
    <div className="flex items-center gap-3 mb-1.5">
      <span className="text-xs text-gray-400 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
      <span className="text-xs font-mono text-gray-500 w-8 text-right">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export default function ScoreBreakdown({ rec }) {
  return (
    <div className="mt-2">
      <Bar label="audio" value={rec.audio_similarity} color="#7F77DD" />
      <Bar label="lyrics" value={rec.lyric_similarity} color="#1D9E75" />
      <Bar label="collab" value={rec.collab_similarity} color="#EF9F27" />
    </div>
  );
}