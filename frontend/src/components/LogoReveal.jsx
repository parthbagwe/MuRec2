import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const DISPLAY_MS = 1500;

function shouldShowReveal() {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function LogoReveal() {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(shouldShowReveal);

  useEffect(() => {
    if (!visible) return undefined;

    if (reducedMotion) {
      setVisible(false);
      return undefined;
    }

    const timer = window.setTimeout(() => setVisible(false), DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, visible]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.section
          className="logo-reveal"
          role="dialog"
          aria-modal="true"
          aria-label="Cerum introduction"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="logo-reveal-native" aria-hidden="true">
            <span className="logo-reveal-kicker">LISTEN DIFFERENTLY</span>
            <div className="logo-reveal-lockup">
              <span className="logo-reveal-mark">
                <i /><i /><i /><i />
              </span>
              <strong>cerum<em>.</em></strong>
            </div>
            <span className="logo-reveal-progress"><i /></span>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
