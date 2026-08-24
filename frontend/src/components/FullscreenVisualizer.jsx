import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

function seedFor(track) {
  return [...`${track?.title || "Cerum"}${track?.artist || ""}`].reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function paletteFor(track, palette) {
  if (palette?.length >= 3) return palette;
  const seed = seedFor(track);
  return [`hsl(${seed % 360} 90% 58%)`, `hsl(${(seed + 92) % 360} 82% 52%)`, `hsl(${(seed + 188) % 360} 84% 64%)`];
}

export default function FullscreenVisualizer({ track, nextTrack, isPlaying, crossfading, currentTime, palette, onClose }) {
  const canvasRef = useRef(null);
  const currentTimeRef = useRef(currentTime);
  const reducedMotion = useReducedMotion();
  const colors = useMemo(() => paletteFor(track, palette), [track, palette]);

  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    let frame = 0;
    let animationFrame = 0;
    const bpm = Math.max(55, Number(track?.bpm) || 96);
    const energy = Math.max(.2, Math.min(1, Number(track?.energy) > 1 ? Number(track.energy) / 100 : Number(track?.energy) || .66));
    const seed = seedFor(track);

    function draw() {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      const seconds = currentTimeRef.current + frame / 60;
      const beat = (seconds * bpm / 60) * Math.PI * 2;
      const pulse = .5 + .5 * Math.sin(beat);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#090908";
      context.fillRect(0, 0, width, height);

      const gradient = context.createRadialGradient(width * .5, height * .48, 10, width * .5, height * .5, Math.max(width, height) * .72);
      gradient.addColorStop(0, `${colors[0]}dd`);
      gradient.addColorStop(.45, `${colors[1]}88`);
      gradient.addColorStop(1, "#090908");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(width / 2, height / 2);
      context.globalCompositeOperation = "screen";
      for (let ring = 0; ring < 7; ring += 1) {
        const radius = 58 + ring * 45 + pulse * energy * 16;
        context.beginPath();
        for (let point = 0; point <= 180; point += 1) {
          const angle = point / 180 * Math.PI * 2;
          const wave = Math.sin(angle * (3 + ring % 3) + seconds * (1.1 + ring * .09) + seed) * (8 + energy * 14);
          const x = Math.cos(angle) * (radius + wave);
          const y = Math.sin(angle) * (radius + wave) * .72;
          if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.closePath();
        context.strokeStyle = colors[ring % colors.length];
        context.globalAlpha = .18 + ring * .045;
        context.lineWidth = crossfading ? 3 : 1.25;
        context.stroke();
      }
      context.restore();

      frame += isPlaying && !reducedMotion ? 1 : 0;
      if (isPlaying && !reducedMotion) animationFrame = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [track, colors, crossfading, isPlaying, reducedMotion]);

  return createPortal((
    <motion.div className="fullscreen-visualizer" role="dialog" aria-modal="true" aria-label={`Visuals for ${track.title}`} initial={{ opacity: 0, y: "100%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "100%" }} transition={{ duration: reducedMotion ? .15 : .72, ease: [0.22, 1, 0.36, 1] }}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <header><span>Cerum / live sound field</span><button onClick={onClose} aria-label="Close full-screen visuals">Close ×</button></header>
      <div className="visualizer-copy">
        <motion.p key={track.track_id} initial={{ opacity: 0, x: 80 }} animate={{ opacity: 1, x: 0 }}>{crossfading ? "Blending into" : isPlaying ? "Now playing" : "Paused"}</motion.p>
        <motion.h2 key={`${track.track_id}-title`} initial={{ opacity: 0, x: -120 }} animate={{ opacity: 1, x: 0 }}>{track.title}</motion.h2>
        <strong>{track.artist}</strong>
        <span>{track.bpm ? `${Math.round(track.bpm)} BPM` : "tempo listening"} · {track.acoustic_signature || "acoustic shape"}</span>
      </div>
      {nextTrack && <div className="visualizer-next"><small>flowing next</small><strong>{nextTrack.title}</strong><span>{nextTrack.artist}</span></div>}
      <div className={`visualizer-orbit ${isPlaying ? "active" : ""}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
    </motion.div>
  ), document.body);
}
