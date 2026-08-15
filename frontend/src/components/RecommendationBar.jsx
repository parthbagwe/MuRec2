import ScoreBreakdown from "./ScoreBreakdown";

export default function RecommendationCard({ rec, rank, onClick }) {
  return (
    <article className="recommendation-card">
      <button className="card-main" onClick={() => onClick(rec)}>
        <div className="card-top">
          <span className="rank">#{String(rank).padStart(2, "0")}</span>
          <span className="score">{rec.hybrid_score.toFixed(2)}</span>
        </div>
        <div className="track-identity">
          {rec.artwork_url && <img src={rec.artwork_url} alt="" />}
          <div><h3>{rec.title}</h3><p>{rec.artist} · {rec.genre}</p></div>
        </div>
        <ScoreBreakdown rec={rec} />
      </button>
      {rec.external_url && <a href={rec.external_url} target="_blank" rel="noreferrer">Open in Apple Music ↗</a>}
    </article>
  );
}
