import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const SESSION_KEY = "cerum.logo-reveal.v1";
const DISPLAY_MS = 1850;

function shouldShowReveal() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SESSION_KEY) !== "seen";
}

export default function LogoReveal() {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(shouldShowReveal);

  useEffect(() => {
    if (!visible) return undefined;

    window.sessionStorage.setItem(SESSION_KEY, "seen");
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
          <img
            src="/cerum-logo-reveal.svg"
            alt="Cerum"
            onError={() => setVisible(false)}
          />
          <button type="button" onClick={() => setVisible(false)}>
            Skip intro
          </button>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
