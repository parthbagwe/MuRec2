import { useEffect, useRef, useState } from "react";

function youtubeSearchUrl(track) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.title} ${track.artist} official audio`)}`;
}

function PlayIcon({ paused }) {
  return paused
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;
}

export default function TrackPreview({ track, playingTrackId, onPreviewChange, onInteraction }) {
  const audioRef = useRef(null);
  const [playbackError, setPlaybackError] = useState("");
  const isPlaying = playingTrackId === track.track_id;
  const artwork = track.artwork_url?.replace("100x100bb", "300x300bb");

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
    setPlaybackError("");
    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      onPreviewChange(null);
      return;
    }
    onPreviewChange(track);
    try {
      await audio.play();
      onInteraction(track, "preview_started");
    } catch {
      onPreviewChange(null);
      setPlaybackError("This preview is temporarily unavailable. Try YouTube instead.");
    }
  }

  return (
    <div className={`reference-preview ${isPlaying ? "is-playing" : ""}`}>
      <div className="artwork-disc">
        <span className="visualizer-ring" aria-hidden="true" />
        {artwork ? <img src={artwork} alt={`${track.title} cover artwork`} /> : <span className="artwork-fallback">{track.title.slice(0, 1)}</span>}
      </div>
      <div className="reference-preview-copy">
        <h2>{track.title}</h2>
        <p>{track.artist}{track.provider_genre ? ` · ${track.provider_genre}` : ""}{track.subgenre ? ` · ${track.subgenre}` : ""}</p>
        <div className="reference-preview-actions">
          {track.preview_url ? (
            <button className="preview-button" onClick={togglePreview} aria-label={`${isPlaying ? "Pause" : "Play"} preview of searched song ${track.title}`}>
              <PlayIcon paused={!isPlaying} />{isPlaying ? "Pause searched song" : "Hear searched song"}
            </button>
          ) : <span className="preview-unavailable">Preview unavailable</span>}
          <a href={youtubeSearchUrl(track)} target="_blank" rel="noreferrer" onClick={() => onInteraction(track, "youtube_opened")}>YouTube ↗</a>
        </div>
        {playbackError && <small className="preview-error" role="status">{playbackError}</small>}
      </div>
      {track.preview_url && (
        <audio
          ref={audioRef}
          src={track.preview_url}
          preload="none"
          onEnded={() => { onPreviewChange(null); onInteraction(track, "preview_completed"); }}
        />
      )}
    </div>
  );
}
