import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const OPTIONS = [
  {
    id: "strict",
    label: (genre) => `Stay in ${genre}`,
    description: "Only the same primary genre. Best when you want a focused lane.",
  },
  {
    id: "nearby",
    label: () => "Nearby styles",
    description: "Allow closely related genres, while keeping the same emotional and acoustic character.",
  },
  {
    id: "open",
    label: () => "Any genre",
    description: "Let the genre change, but keep the vibe locked so the result still feels coherent.",
  },
];

export default function GenreGate({ track, onChoose, onCancel }) {
  const firstOptionRef = useRef(null);
  const cancelRef = useRef(onCancel);

  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    if (!track) return undefined;
    const previousFocus = document.activeElement;
    const focusTimer = window.setTimeout(() => firstOptionRef.current?.focus(), 80);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [track]);

  if (!track) return null;
  const genre = track.provider_genre || track.provider_subgenre || "this genre";

  return createPortal((
    <div className="modal-backdrop genre-gate-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <motion.section
        className="modal genre-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="genre-gate-title"
        initial={{ opacity: 0, y: 28, scale: .98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 190, damping: 24 }}
      >
        <button className="modal-close" onClick={onCancel} aria-label="Cancel recommendations">×</button>
        <p className="kicker">Before Cerum suggests</p>
        <h2 id="genre-gate-title">Stay inside {genre}?</h2>
        <p className="modal-copy">
          “{track.title}” is already playing. Choose how far the recommendations may travel; its energy, groove and emotional colour remain locked either way.
        </p>
        <div className="vibe-lock-note"><span aria-hidden="true">●</span><strong>Vibe lock on</strong><small>energy · danceability · brightness · intensity · lyrical mood when available</small></div>
        <div className="genre-options">
          {OPTIONS.map((option, index) => (
            <button ref={index === 0 ? firstOptionRef : null} key={option.id} onClick={() => onChoose(option.id)}>
              <em>{String(index + 1).padStart(2, "0")}</em>
              <span><strong>{option.label(genre)}</strong><small>{option.description}</small></span>
              <b aria-hidden="true">→</b>
            </button>
          ))}
        </div>
      </motion.section>
    </div>
  ), document.body);
}
