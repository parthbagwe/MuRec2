import { useState } from "react";

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function LibraryPanel({ open, onClose, favorites, history, onRemoveFavorite, onClearHistory, onChooseFavorite }) {
  const [tab, setTab] = useState("favorites");
  if (!open) return null;

  return (
    <div className="modal-backdrop library-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="library-panel" role="dialog" aria-modal="true" aria-labelledby="library-title">
        <div className="library-header">
          <div><p className="kicker">Personal library</p><h2 id="library-title">Saved music</h2></div>
          <button className="modal-close" onClick={onClose} aria-label="Close library">×</button>
        </div>
        <div className="library-tabs">
          <button className={tab === "favorites" ? "active" : ""} onClick={() => setTab("favorites")}>Favourites <span>{favorites.length}</span></button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History <span>{history.length}</span></button>
        </div>

        {tab === "favorites" && (
          <div className="library-list">
            {favorites.length === 0 && <p className="empty-state">No favourites yet. Use the heart on any recommendation to save it here.</p>}
            {favorites.map((track) => (
              <article className="saved-track" key={track.track_id}>
                <button className="saved-track-main" onClick={() => { onChooseFavorite(track); onClose(); }}>
                  {track.artwork_url ? <img src={track.artwork_url} alt="" /> : <span className="saved-artwork">{track.title.slice(0, 1)}</span>}
                  <span><strong>{track.title}</strong><small>{track.artist} · {track.subgenre || "Unclassified"}</small></span>
                </button>
                <button className="text-button danger" onClick={() => onRemoveFavorite(track.track_id)} aria-label={`Remove ${track.title} from favourites`}>Remove</button>
              </article>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div className="history-wrap">
            <div className="history-tools"><p>Recommendations are saved automatically while signed in.</p>{history.length > 0 && <button className="text-button danger" onClick={onClearHistory}>Clear history</button>}</div>
            {history.length === 0 && <p className="empty-state">No recommendation history yet.</p>}
            {history.map((run) => (
              <article className="history-run" key={run.id}>
                <div><span className="mode-label">{run.mode.replace("-", " ")}</span><time>{formatDate(run.created_at)}</time></div>
                <h3>{run.anchor_title} <span>by {run.anchor_artist}</span></h3>
                <p>{run.suggestions.slice(0, 4).map((item) => item.title).join(" · ")}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
