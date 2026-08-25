import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

function seedFor(track) {
  return [...`${track?.title || "Cerum"}${track?.artist || ""}`]
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function normalizedEnergy(track) {
  const raw = Number(track?.energy);
  if (!Number.isFinite(raw)) return 0.68;
  return Math.max(0.2, Math.min(1, raw > 1 ? raw / 100 : raw));
}

export default function FullscreenVisualizer({
  track,
  nextTrack,
  queue,
  activeIndex,
  isPlaying,
  crossfading,
  currentTime,
  duration,
  onClose,
  onTogglePlayback,
  onPrevious,
  onNext,
  onSeek,
  onChooseTrack,
}) {
  const canvasRef = useRef(null);
  const timeRef = useRef(currentTime);
  const playingRef = useRef(isPlaying);
  const crossfadingRef = useRef(crossfading);
  const actionRef = useRef({ onClose, onTogglePlayback });
  const reducedMotion = useReducedMotion();

  useEffect(() => { timeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { crossfadingRef.current = crossfading; }, [crossfading]);
  useEffect(() => { actionRef.current = { onClose, onTogglePlayback }; }, [onClose, onTogglePlayback]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") actionRef.current.onClose();
      if (event.code === "Space" && event.target?.tagName !== "INPUT") {
        event.preventDefault();
        actionRef.current.onTogglePlayback();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    const bpm = Math.max(55, Number(track?.bpm) || 96);
    const energy = normalizedEnergy(track);
    const seed = seedFor(track);
    let animationFrame = 0;
    let visualTime = timeRef.current;
    let previousTimestamp = performance.now();

    const draw = (timestamp = performance.now()) => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      const delta = Math.min(0.05, Math.max(0, (timestamp - previousTimestamp) / 1000));
      previousTimestamp = timestamp;
      if (playingRef.current && !reducedMotion) visualTime += delta;
      else visualTime = timeRef.current;

      const beatPhase = visualTime * bpm / 60 * Math.PI * 2;
      const beat = Math.pow(0.5 + Math.sin(beatPhase) * 0.5, 3);
      const blend = crossfadingRef.current ? 1 : 0;
      const horizon = height * 0.19;
      const floorBottom = height * 0.79;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "#030305";
      context.fillRect(0, 0, width, height);

      const bloom = context.createRadialGradient(width * 0.53, height * 0.46, 0, width * 0.53, height * 0.46, width * 0.47);
      bloom.addColorStop(0, `rgba(188, 205, 228, ${0.06 + energy * 0.035 + blend * 0.035})`);
      bloom.addColorStop(0.42, "rgba(72, 86, 105, 0.025)");
      bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = bloom;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "screen";
      context.lineJoin = "round";
      context.lineCap = "round";

      const rows = width < 720 ? 30 : 44;
      for (let row = 0; row < rows; row += 1) {
        const depth = row / (rows - 1);
        const perspective = Math.pow(depth, 1.65);
        const baseY = horizon + perspective * (floorBottom - horizon);
        const amplitude = (12 + perspective * 68) * (0.7 + energy * 0.65);
        const step = width < 720 ? 11 : 14;

        context.beginPath();
        for (let x = -step; x <= width + step; x += step) {
          const nx = (x / width - 0.5) * 2;
          const ridgeA = Math.exp(-Math.pow((nx - 0.08 - Math.sin(visualTime * 0.12) * 0.08) / 0.34, 2));
          const ridgeB = Math.exp(-Math.pow((nx + 0.46 + Math.cos(visualTime * 0.09) * 0.06) / 0.24, 2));
          const traveling = Math.sin(nx * 8.2 - visualTime * (0.65 + energy * 0.4) + row * 0.24 + seed * 0.01);
          const fine = Math.sin(nx * 17.5 + visualTime * 0.42 - row * 0.17) * 0.24;
          const kick = beat * ridgeA * (15 + energy * 26);
          const heightMap = (ridgeA * 1.25 - ridgeB * 0.48 + traveling * 0.32 + fine) * amplitude + kick;
          const y = baseY - heightMap * (0.34 + perspective * 0.82);
          if (x === -step) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const alpha = 0.1 + perspective * 0.54 + (row % 7 === 0 ? 0.16 : 0);
        context.strokeStyle = blend && row % 6 === 0
          ? `rgba(240, 255, 55, ${Math.min(0.9, alpha + 0.18)})`
          : `rgba(230, 239, 250, ${alpha})`;
        context.lineWidth = 0.45 + perspective * 0.95 + (row % 7 === 0 ? 0.45 : 0);
        context.shadowBlur = row % 7 === 0 ? 9 + beat * 7 : 3;
        context.shadowColor = blend && row % 6 === 0 ? "#f0ff37" : "#9fc9ff";
        context.stroke();
      }

      context.restore();

      const vignette = context.createRadialGradient(width / 2, height * 0.48, Math.min(width, height) * 0.14, width / 2, height * 0.48, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.12)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.78)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      if (playingRef.current && !reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [track, isPlaying, reducedMotion]);

  const playableNext = queue?.findIndex((item, index) => index > activeIndex && item.preview_url) ?? -1;
  const progressMax = duration || 30;

  return createPortal((
    <motion.div
      className={`fullscreen-visualizer ${crossfading ? "is-blending" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Visuals and mix controls for ${track.title}`}
      initial={{ opacity: 0, y: "6%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "6%" }}
      transition={{ duration: reducedMotion ? 0.15 : 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="heightmap-grain" aria-hidden="true" />

      <header className="heightmap-header">
        <span>Cerum / live height map</span>
        <div className="heightmap-telemetry">
          <span>{track.bpm ? `${Math.round(track.bpm)} bpm` : "tempo live"}</span>
          <span>{track.key || track.musical_key || "key listening"}</span>
          <strong>{crossfading ? "mixing now" : "mixing on"}</strong>
        </div>
        <button onClick={onClose} aria-label="Close full-screen visuals">Exit visuals <kbd>Esc</kbd></button>
      </header>

      <div className="heightmap-title" aria-live="polite">
        <motion.span key={`${track.track_id}-state`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}>
          {crossfading ? "Blending into the next contour" : isPlaying ? "Sound field active" : "Sound field paused"}
        </motion.span>
        <motion.h2 key={track.track_id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>{track.title}</motion.h2>
        <strong>{track.artist}</strong>
      </div>

      <section className="heightmap-deck" aria-label="AutoMix controls">
        <div className="heightmap-now">
          <small>{crossfading ? "Beat-matched blend live" : "Now playing"}</small>
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </div>

        <div className="heightmap-transport">
          <div className="heightmap-buttons">
            <button onClick={onPrevious} aria-label="Previous song">←</button>
            <button className="heightmap-play" onClick={onTogglePlayback} aria-label={isPlaying ? "Pause AutoMix" : "Play AutoMix"}>{isPlaying ? "Ⅱ" : "▶"}</button>
            <button onClick={onNext} aria-label="Next song" disabled={playableNext < 0}>→</button>
          </div>
          <div className="heightmap-progress">
            <span>{formatTime(currentTime)}</span>
            <input type="range" min="0" max={progressMax} step="0.1" value={Math.min(currentTime, progressMax)} onChange={(event) => onSeek(event.target.value)} aria-label="Preview position" />
            <span>{formatTime(progressMax)}</span>
          </div>
        </div>

        <div className="heightmap-up-next">
          <div><small>{crossfading ? "Blending now" : "Up next / five-song mix"}</small>{nextTrack && <strong>{nextTrack.title} · {nextTrack.artist}</strong>}</div>
          <ol>
            {queue?.slice(0, 6).map((item, index) => (
              <li key={`${item.track_id}-${index}`} className={index === activeIndex ? "active" : ""}>
                <button onClick={() => onChooseTrack(index)} disabled={!item.preview_url} aria-label={`Play ${item.title} by ${item.artist}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </motion.div>
  ), document.body);
}
