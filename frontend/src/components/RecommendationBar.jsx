import { useEffect, useRef } from "react";
import ScoreBreakdown from "./ScoreBreakdown";

function youtubeSearchUrl(rec) {
  const query = encodeURIComponent(`${rec.title} ${rec.artist} official audio`);
  return `https://www.youtube.com/results?search_query=${query}`;
}

function PlayIcon({ paused }) {
  return paused ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>
  );
}

function YouTubeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12s0-3.3-.4-4.9a2.6 2.6 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.3a2.6 2.6 0 0 0-1.8 1.8C2 8.7 2 12 2 12s0 3.3.4 4.9a2.6 2.6 0 0 0 1.8 1.8c1.5.3 7.8.3 7.8.3s6.3 0 7.8-.3a2.6 2.6 0 0 0 1.8-1.8C22 15.3 22 12 22 12Zm-12 3.5v-7l6 3.5-6 3.5Z" /></svg>;
}

export default function RecommendationCard({ rec, rank, onClick, playingTrackId, onPreviewChange }) {
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
    } catch {
      onPreviewChange(null);
    }
  }

  const artwork = rec.artwork_url?.replace("100x100bb", "300x300bb");

  return (
    <article className={`recommendation-card ${isPlaying ? "is-playing" : ""}`}>
      <button className="card-main" onClick={() => onClick(rec)} aria-label={`Recommend songs like ${rec.title} by ${rec.artist}`}>
        <div className="card-top">
          <span className="rank">#{String(rank).padStart(2, "0")}</span>
          <span className="score">{Math.round(rec.hybrid_score * 100)}%</span>
        </div>
        <div className="track-identity">
          <div className="artwork-disc">
            <span className="visualizer-ring" aria-hidden="true" />
            {artwork ? <img src={artwork} alt={`${rec.title} cover artwork`} /> : <span className="artwork-fallback">{rec.title.slice(0, 1)}</span>}
          </div>
          <div><h3>{rec.title}</h3><p>{rec.artist}</p><small>{rec.genre}{rec.year ? ` · ${rec.year}` : ""}</small></div>
        </div>
        <ScoreBreakdown rec={rec} />
      </button>

      <div className="card-actions">
        {rec.preview_url ? (
          <button className="preview-button" onClick={togglePreview} aria-label={`${isPlaying ? "Pause" : "Play"} preview of ${rec.title}`}>
            <PlayIcon paused={!isPlaying} />{isPlaying ? "Pause" : "Preview"}
          </button>
        ) : <span className="preview-unavailable">Preview unavailable</span>}
        <a className="youtube-button" href={youtubeSearchUrl(rec)} target="_blank" rel="noreferrer" aria-label={`Find ${rec.title} by ${rec.artist} on YouTube`}>
          <YouTubeIcon />YouTube
        </a>
      </div>

      {rec.preview_url && (
        <small className="preview-credit">
          Preview provided courtesy of iTunes · <a href={rec.external_url} target="_blank" rel="noreferrer">store source</a>
        </small>
      )}
      {rec.preview_url && (
        <audio
          ref={audioRef}
          src={rec.preview_url}
          preload="none"
          onEnded={() => onPreviewChange(null)}
          onPause={() => isPlaying && audioRef.current?.currentTime > 0 && onPreviewChange(null)}
        />
      )}
    </article>
  );
}
