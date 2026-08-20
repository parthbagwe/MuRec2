import { useEffect, useRef } from "react";
import ScoreBreakdown from "./ScoreBreakdown";

function youtubeSearchUrl(rec) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${rec.title} ${rec.artist} official audio`)}`;
}

function PlayIcon({ paused }) {
  return paused
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;
}

function HeartIcon({ filled }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" fill={filled ? "currentColor" : "none"} /></svg>;
}

export default function RecommendationCard({ rec, rank, onClick, playingTrackId, onPreviewChange, isFavorite, onToggleFavorite, onInteraction, onDismiss }) {
  const audioRef = useRef(null);
  const isPlaying = playingTrackId === rec.track_id;

  useEffect(() => {
    if (!isPlaying && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [isPlaying]);

  useEffect(() => () => audioRef.current?.pause(), []);

  async function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      onPreviewChange(null);
      return;
    }
    onPreviewChange(rec.track_id);
    try {
      await audio.play();
      onInteraction(rec, "preview_started");
    } catch {
      onPreviewChange(null);
    }
  }

  const artwork = rec.artwork_url?.replace("100x100bb", "300x300bb");

  return (
    <article className={`recommendation-card ${isPlaying ? "is-playing" : ""}`}>
      <div className="card-heading">
        <span className="rank">{String(rank).padStart(2, "0")}</span>
        <span className="score">{Math.round(rec.hybrid_score * 100)}% match</span>
        <button className={`favorite-button ${isFavorite ? "active" : ""}`} onClick={() => onToggleFavorite(rec)} aria-label={`${isFavorite ? "Remove" : "Add"} ${rec.title} ${isFavorite ? "from" : "to"} favourites`}>
          <HeartIcon filled={isFavorite} />
        </button>
      </div>
      <button className="card-main" onClick={() => onClick(rec)} aria-label={`Recommend songs like ${rec.title} by ${rec.artist}`}>
        <div className="track-identity">
          <div className="artwork-disc">
            <span className="visualizer-ring" aria-hidden="true" />
            {artwork ? <img src={artwork} alt={`${rec.title} cover artwork`} /> : <span className="artwork-fallback">{rec.title.slice(0, 1)}</span>}
          </div>
          <div><h3>{rec.title}</h3><p>{rec.artist}</p><small>{rec.subgenre || rec.genre}{rec.year ? ` · ${rec.year}` : ""}</small></div>
        </div>
        <ScoreBreakdown rec={rec} />
        {rec.match_reasons?.length > 0 && <div className="match-reasons" aria-label="Why this matches">{rec.match_reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>}
      </button>

      <div className="card-actions">
        {rec.preview_url ? (
          <button className="preview-button" onClick={togglePreview} aria-label={`${isPlaying ? "Pause" : "Play"} preview of ${rec.title}`}>
            <PlayIcon paused={!isPlaying} />{isPlaying ? "Pause" : "Preview"}
          </button>
        ) : <span className="preview-unavailable">No preview</span>}
        <a className="youtube-button" href={youtubeSearchUrl(rec)} target="_blank" rel="noreferrer" onClick={() => onInteraction(rec, "youtube_opened")}>YouTube ↗</a>
        <button className="dismiss-button" onClick={() => onDismiss(rec)} aria-label={`Show fewer songs like ${rec.title}`}>Not for me</button>
      </div>
      {rec.preview_url && <small className="preview-credit">30-second preview courtesy of iTunes</small>}
      {rec.preview_url && (
        <audio ref={audioRef} src={rec.preview_url} preload="none" onEnded={() => { onPreviewChange(null); onInteraction(rec, "preview_completed"); }} onPause={() => isPlaying && audioRef.current?.currentTime > 0 && onPreviewChange(null)} />
      )}
    </article>
  );
}
