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

function visualWeights(signal, track) {
  const energy = trackMetric(track, "energy", signal.level);
  const aggression = trackMetric(track, "aggression", signal.texture * 0.65);
  const harmonic = trackMetric(track, "harmonic_ratio", 0.52);
  const rawOnsetDensity = Number(track?.onset_density);
  const onsetDensity = Number.isFinite(rawOnsetDensity)
    ? clamp(rawOnsetDensity > 1 ? rawOnsetDensity / 5 : rawOnsetDensity)
    : signal.transient;
  const raw = {
    flow: clamp(0.92 - energy * 0.52 - signal.transient * 0.5 + harmonic * 0.34),
    pulse: clamp(signal.bass * 0.52 + signal.transient * 0.32 + energy * 0.28),
    fracture: clamp(aggression * 0.62 + signal.texture * 0.3 + onsetDensity * 0.24 + signal.transient * 0.2 - 0.2),
    orbit: clamp(harmonic * 0.52 + (1 - aggression) * 0.2 + signal.brightness * 0.22 + 0.12),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / total]));
}

function rgba(hex, alpha) {
  const value = String(hex || "#ffffff").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value.padEnd(6, "f").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function dominantMode(weights) {
  return Object.entries(weights).sort((left, right) => right[1] - left[1])[0]?.[0] || "flow";
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
  const modeLegendRef = useRef(null);
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
      const weights = visualWeights(smoothed, track);
      const activeMode = dominantMode(weights);
      const centerX = width * (0.52 + Math.sin(seed) * 0.025);
      const centerY = height * 0.46;
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

      const flowLines = width < 720 ? 8 : 13;
      for (let row = 0; row < flowLines; row += 1) {
        const lane = row / Math.max(1, flowLines - 1);
        const baseY = height * (0.2 + lane * 0.56);
        const amplitude = (18 + smoothed.level * 70) * (0.45 + weights.flow);
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 22) {
          const nx = x / Math.max(1, width);
          const wave = Math.sin(nx * Math.PI * (2.2 + smoothed.texture * 3.4) + visualTime * (0.24 + smoothed.level * 0.5) + row * 0.72 + seed * 0.013);
          const voice = Math.sin(nx * Math.PI * 7.5 - visualTime * 0.19 + row * 0.31) * smoothed.brightness * 0.36;
          const y = baseY + (wave + voice) * amplitude * (0.25 + Math.sin(nx * Math.PI) * 0.75);
          if (x < 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.strokeStyle = rgba(row % 3 === 0 ? colors[2] : colors[1], (0.06 + weights.flow * 0.32) * (0.45 + lane * 0.55));
        context.lineWidth = 0.7 + smoothed.level * 1.4;
        context.stroke();
      }

      const ringCount = width < 720 ? 5 : 8;
      for (let ring = 0; ring < ringCount; ring += 1) {
        const phase = (visualTime * (0.08 + smoothed.bass * 0.18) + ring / ringCount) % 1;
        const radius = shortSide * (0.07 + phase * 0.48) * (1 + beatKick * 0.07);
        context.beginPath();
        context.ellipse(centerX, centerY, radius * (1.04 + weights.orbit * 0.32), radius * (0.66 + weights.flow * 0.17), visualTime * 0.025 + ring * 0.08, 0, Math.PI * 2);
        context.strokeStyle = rgba(ring % 2 ? colors[0] : colors[1], (1 - phase) * (0.035 + weights.pulse * 0.34));
        context.lineWidth = 0.8 + beatKick * 2.2;
        context.stroke();
      }

      const points = width < 720 ? 36 : 68;
      context.beginPath();
      for (let point = 0; point <= points; point += 1) {
        const angle = point / points * Math.PI * 2;
        const jagged = Math.sin(angle * (7 + Math.round(smoothed.texture * 9)) + visualTime * 1.8 + seed) * smoothed.texture;
        const transientSpike = Math.pow(Math.abs(Math.sin(angle * 5 + seed)), 8) * smoothed.transient;
        const radius = shortSide * (0.19 + weights.fracture * 0.15 + jagged * 0.08 + transientSpike * 0.13);
        const x = centerX + Math.cos(angle) * radius * 1.16;
        const y = centerY + Math.sin(angle) * radius * 0.82;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath();
      context.strokeStyle = rgba(colors[0], 0.14 + weights.fracture * 0.58);
      context.lineWidth = 0.8 + weights.fracture * 2.2 + smoothed.transient * 1.6;
      context.shadowBlur = 8 + smoothed.transient * 16;
      context.shadowColor = colors[0];
      context.stroke();

      const particles = width < 720 ? 34 : 74;
      context.shadowBlur = 0;
      for (let index = 0; index < particles; index += 1) {
        const angle = seed * 0.1 + index * 2.399 + visualTime * (0.012 + smoothed.brightness * 0.035);
        const orbit = shortSide * (0.16 + ((index * 37) % 100) / 100 * 0.39);
        const drift = Math.sin(visualTime * 0.21 + index) * 10 * smoothed.texture;
        const x = centerX + Math.cos(angle) * (orbit + drift) * (1.04 + weights.orbit * 0.28);
        const y = centerY + Math.sin(angle) * orbit * 0.64;
        const size = 0.6 + smoothed.brightness * 1.8 + (index % 9 === 0 ? smoothed.transient * 2.6 : 0);
        context.fillStyle = rgba(index % 3 === 0 ? colors[2] : "#ffffff", 0.12 + weights.orbit * 0.52 + smoothed.brightness * 0.12);
        context.beginPath();
        context.arc(x, y, size, 0, Math.PI * 2);
        context.fill();
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
        if (modeLabelRef.current) modeLabelRef.current.textContent = `${activeMode} · ${telemetry?.analyzed ? "preview analyzed" : "acoustic profile"}`;
        if (modeLegendRef.current) modeLegendRef.current.dataset.active = activeMode;
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
        <span>Cerum / adaptive audio field</span>
        <div className="heightmap-telemetry">
          <span ref={modeLabelRef}>listening to preview</span>
          <span>{track.bpm ? `${Math.round(track.bpm)} bpm` : "tempo measured"}</span>
          <span>{track.musical_key || track.key || "harmony measured"}</span>
          <strong>{crossfading ? "two signals blending" : "audio reactive"}</strong>
        </div>
        <button onClick={onClose} aria-label="Close full-screen visuals">Exit visuals <kbd>Esc</kbd></button>
      </header>

      <div className="visual-mode-legend" ref={modeLegendRef} data-active="flow" aria-hidden="true">
        <span data-mode="flow">Flow</span>
        <span data-mode="pulse">Pulse</span>
        <span data-mode="fracture">Fracture</span>
        <span data-mode="orbit">Orbit</span>
      </div>

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
