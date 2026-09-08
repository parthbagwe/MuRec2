import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export const PLAYBACK_REVEAL_MS = 1500;

export default function PlaybackReveal({ state }) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {state ? (
        <motion.section
          key={state.token}
          className={`logo-reveal playback-reveal ${reducedMotion ? "reduced-motion" : ""}`}
          role="status"
          aria-live="polite"
          aria-label={`Preparing ${state.track?.title || "song"} for playback`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.08 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="logo-reveal-native" aria-hidden="true">
            <span className="logo-reveal-kicker">CERUM / LOADING PREVIEW</span>
            <div className="logo-reveal-lockup">
              <span className="logo-reveal-mark">
                <i /><i /><i /><i />
              </span>
              <strong>cerum<em>.</em></strong>
            </div>
            <div className="playback-reveal-track">
              <span>UP NEXT</span>
              <strong>{state.track?.title || "Your song"}</strong>
              <small>{state.track?.artist || "Ready to play"}</small>
            </div>
            <span className="logo-reveal-progress"><i /></span>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
