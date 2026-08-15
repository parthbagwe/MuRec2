import ScoreBreakdown from "./ScoreBreakdown";

export default function RecommendationCard({ rec, rank, onClick }) {
  return (
    <button
      className="recommendation-card"
      onClick={() => onClick(rec)}
    >
      <div className="card-top">
        <span className="rank">#{String(rank).padStart(2, "0")}</span>
        <span className="score">
          {rec.hybrid_score.toFixed(2)}
        </span>
      </div>
      <h3>{rec.title}</h3>
      <p>{rec.artist} · {rec.genre}</p>
      <ScoreBreakdown rec={rec} />
    </button>
  );
}
