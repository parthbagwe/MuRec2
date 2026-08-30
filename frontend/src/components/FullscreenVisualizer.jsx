import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function seedFor(track) {
  return [...`${track?.title || "Cerum"}${track?.artist || ""}`]
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function trackMetric(track, name, fallback) {
  if (track?.[name] === null || track?.[name] === undefined) return fallback;
  const raw = Number(track[name]);
  if (!Number.isFinite(raw)) return fallback;
  return clamp(raw > 1 ? raw / 100 : raw);
}

function fallbackTelemetry(track, time) {
  const bpm = Math.max(55, Number(track?.bpm) || 96);
  const energy = trackMetric(track, "energy", 0.55);
  const aggression = trackMetric(track, "aggression", 0.28);
  const phase = time * bpm / 60 * Math.PI * 2;
  const beat = Math.pow(0.5 + Math.sin(phase) * 0.5, 5);
  return {
    level: clamp(0.34 + energy * 0.48 + beat * 0.12),
    bass: clamp(0.28 + trackMetric(track, "percussive_ratio", energy) * 0.45 + beat * 0.26),
    brightness: trackMetric(track, "brightness", 0.42 + aggression * 0.26),
    texture: clamp(0.35 + aggression * 0.48),
    transient: beat * (0.35 + energy * 0.55),
    crest: 0.42,
  };
}

function mixTelemetry(first, second, amount) {
  if (!second || amount <= 0) return first;
  const mixed = {};
  for (const key of ["level", "bass", "brightness", "texture", "transient", "crest"]) {
    mixed[key] = Number(first?.[key] ?? 0) * (1 - amount) + Number(second?.[key] ?? 0) * amount;
  }
  return mixed;
}

function rgba(hex, alpha) {
  const value = String(hex || "#ffffff").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value.padEnd(6, "f").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
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
  palette,
  getAudioTelemetry,
  onClose,
  onTogglePlayback,
  onPrevious,
  onNext,
  onSeek,
  onChooseTrack,
}) {
  const canvasRef = useRef(null);
  const modeLabelRef = useRef(null);
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
    const colors = palette?.length >= 3 ? palette : ["#f0ff37", "#6c57ff", "#ff5aa5"];
    const seed = seedFor(track);
    const smoothed = fallbackTelemetry(track, timeRef.current);
    let animationFrame = 0;
    let visualTime = timeRef.current;
    let previousTimestamp = performance.now();
    let frameCount = 0;

    const draw = (timestamp = performance.now()) => {
      const ratio = Math.min(1.6, window.devicePixelRatio || 1);
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

      const telemetry = getAudioTelemetry?.();
      const fallback = fallbackTelemetry(track, visualTime);
      const target = telemetry?.primary
        ? mixTelemetry(telemetry.primary, telemetry.secondary, telemetry.blend)
        : fallback;
      const response = 1 - Math.exp(-delta * (target.transient > smoothed.transient ? 15 : 5));
      for (const key of Object.keys(smoothed)) smoothed[key] += (target[key] - smoothed[key]) * response;
      const centerX = width * 0.5;
      const centerY = height * 0.47;
      const shortSide = Math.min(width, height);
      const beatKick = clamp(smoothed.transient * 0.75 + smoothed.bass * 0.25);

      context.clearRect(0, 0, width, height);
      const backdrop = context.createRadialGradient(centerX, centerY, shortSide * 0.03, centerX, centerY, Math.max(width, height) * 0.76);
      backdrop.addColorStop(0, rgba(colors[0], 0.12 + smoothed.level * 0.15));
      backdrop.addColorStop(0.34, rgba(colors[1], 0.09 + smoothed.bass * 0.08));
      backdrop.addColorStop(0.72, rgba(colors[2], 0.045 + smoothed.brightness * 0.055));
      backdrop.addColorStop(1, "#030305");
      context.fillStyle = backdrop;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";

      const guideCount = width < 720 ? 8 : 14;
      for (let guide = 0; guide < guideCount; guide += 1) {
        const y = height * (0.15 + guide / Math.max(1, guideCount - 1) * 0.66);
        context.beginPath();
        context.moveTo(width * 0.04, y);
        context.lineTo(width * 0.96, y);
        context.strokeStyle = "rgba(255,255,255,0.035)";
        context.lineWidth = 1;
        context.stroke();
      }

      const waveCount = width < 720 ? 12 : 22;
      for (let row = 0; row < waveCount; row += 1) {
        const lane = row / Math.max(1, waveCount - 1);
        const baseY = height * (0.16 + lane * 0.64);
        const centreWeight = Math.sin(lane * Math.PI);
        const amplitude = (10 + smoothed.level * 54 + beatKick * 16) * (0.3 + centreWeight * 0.92);
        const frequency = 1.25 + smoothed.brightness * 2.25 + lane * 0.55;
        const phase = visualTime * (0.55 + smoothed.bass * 0.85) + row * 0.34 + seed * 0.002;
        context.beginPath();
        for (let x = -10; x <= width + 10; x += 8) {
          const nx = x / Math.max(1, width);
          const envelope = Math.pow(Math.sin(clamp(nx) * Math.PI), 0.62);
          const fundamental = Math.sin(nx * Math.PI * 2 * frequency + phase);
          const harmonic = Math.sin(nx * Math.PI * (5.5 + smoothed.texture * 5.5) - phase * 0.62 + row * 0.21) * (0.16 + smoothed.texture * 0.24);
          const transient = Math.sin(nx * Math.PI * 18 - phase * 1.8) * smoothed.transient * 0.18;
          const y = baseY + (fundamental + harmonic + transient) * amplitude * envelope;
          if (x < 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const lineColor = row % 4 === 0 ? colors[0] : row % 2 === 0 ? colors[2] : colors[1];
        context.strokeStyle = rgba(lineColor, 0.08 + centreWeight * 0.3 + smoothed.level * 0.08);
        context.lineWidth = 0.65 + centreWeight * 1.15 + beatKick * 0.75;
        context.stroke();
      }

      const heroAmplitude = shortSide * (0.055 + smoothed.bass * 0.075 + beatKick * 0.035);
      context.beginPath();
      for (let x = 0; x <= width; x += 4) {
        const nx = x / Math.max(1, width);
        const envelope = Math.pow(Math.sin(nx * Math.PI), 0.5);
        const low = Math.sin(nx * Math.PI * (3.1 + smoothed.bass * 1.8) - visualTime * (1 + smoothed.bass));
        const high = Math.sin(nx * Math.PI * (11 + smoothed.brightness * 10) + visualTime * 1.6) * smoothed.texture * 0.22;
        const y = centerY + (low + high) * heroAmplitude * envelope;
        if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = rgba(colors[0], 0.58 + smoothed.level * 0.34);
      context.lineWidth = 1.8 + beatKick * 3.4;
      context.shadowBlur = 12 + smoothed.transient * 24;
      context.shadowColor = colors[0];
      context.stroke();

      if (crossfadingRef.current) {
        context.beginPath();
        for (let x = 0; x <= width; x += 5) {
          const nx = x / Math.max(1, width);
          const envelope = Math.pow(Math.sin(nx * Math.PI), 0.52);
          const y = centerY + Math.sin(nx * Math.PI * 4.4 + visualTime * 1.18) * heroAmplitude * 0.78 * envelope;
          if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.strokeStyle = rgba(colors[2], 0.72);
        context.lineWidth = 2.2;
        context.shadowColor = colors[2];
        context.stroke();
      }
      context.restore();

      const vignette = context.createRadialGradient(centerX, centerY, shortSide * 0.18, centerX, centerY, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(0.7, "rgba(0, 0, 0, 0.12)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.82)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      frameCount += 1;
      if (frameCount % 12 === 0) {
        if (modeLabelRef.current) modeLabelRef.current.textContent = `sine field · ${telemetry?.analyzed ? "preview analyzed" : "acoustic profile"}`;
      }
      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [getAudioTelemetry, palette, reducedMotion, track]);

  const playableNext = queue?.findIndex((item, index) => index > activeIndex && item.preview_url) ?? -1;
  const progressMax = duration || 30;

  return createPortal((
    <motion.div
      className={`fullscreen-visualizer ${crossfading ? "is-blending" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Adaptive visuals and mix controls for ${track.title}`}
      initial={{ opacity: 0, y: "6%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "6%" }}
      transition={{ duration: reducedMotion ? 0.15 : 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="heightmap-grain" aria-hidden="true" />

      <header className="heightmap-header">
        <span>Cerum / live sine field</span>
        <div className="heightmap-telemetry">
          <span ref={modeLabelRef}>listening to preview</span>
          <span>{track.bpm ? `${Math.round(track.bpm)} bpm` : "tempo measured"}</span>
          <span>{track.musical_key || track.key || "harmony measured"}</span>
          <strong>{crossfading ? "two signals blending" : "audio reactive"}</strong>
        </div>
        <button onClick={onClose} aria-label="Close full-screen visuals">Exit visuals <kbd>Esc</kbd></button>
      </header>

      <div className="heightmap-title" aria-live="polite">
        <motion.span key={`${track.track_id}-state`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}>
          {crossfading ? "Two audio signatures are becoming one" : isPlaying ? "Listening to this exact section" : "Audio field paused"}
        </motion.span>
        <motion.h2 key={track.track_id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>{track.title}</motion.h2>
        <strong>{track.artist}</strong>
      </div>

      <section className="heightmap-deck" aria-label="AutoMix controls">
        <div className="heightmap-now">
          <small>{crossfading ? "Phrase-aware blend live" : "Now playing"}</small>
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
          <div><small>{crossfading ? "Blending now" : "Up next / five-song mix"}</small>{nextTrack ? <strong>{nextTrack.title} · {nextTrack.artist}</strong> : null}</div>
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
