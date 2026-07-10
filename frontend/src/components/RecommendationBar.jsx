import ScoreBreakdown from "./ScoreBreakdown";

export default function RecommendationCard({ rec, rank, onClick }) {
  return (
    <div
      className="bg-white border border-gray-100 rounded-2xl p-4 
                 hover:border-indigo-200 hover:shadow-md transition-all 
                 cursor-pointer"
      onClick={() => onClick(rec)}
    >
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs text-gray-300 font-mono">#{rank}</span>
        <span className="text-lg font-semibold text-gray-800">
          {rec.hybrid_score.toFixed(2)}
        </span>
      </div>
      <div className="text-sm font-medium text-gray-800 leading-tight">
        {rec.title}
      </div>
      <div className="text-xs text-gray-400 mb-3">
        {rec.artist} · {rec.genre}
      </div>
      <ScoreBreakdown rec={rec} />
    </div>
  );
}