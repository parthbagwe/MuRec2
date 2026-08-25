import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

const FullscreenVisualizer = lazy(() => import("./FullscreenVisualizer"));

function PlayIcon({ playing }) {
  return playing
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h5v14H6zM13 5h5v14h-5z" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function youtubeSearchUrl(track) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.title} ${track.artist} official audio`)}`;
}

function blendLength(nextTrack) {
  const score = Number(nextTrack?.hybrid_score ?? 0.72);
  return Math.max(3.2, Math.min(5.8, 3.2 + score * 2.6));
}

function compatiblePlaybackRate(currentTrack, nextTrack) {
  const currentBpm = Number(currentTrack?.bpm);
  const nextBpm = Number(nextTrack?.bpm);
  if (!currentBpm || !nextBpm) return 1;
  let ratio = currentBpm / nextBpm;
  while (ratio < 0.72) ratio *= 2;
  while (ratio > 1.4) ratio /= 2;
  return Math.abs(ratio - 1) <= 0.045 ? ratio : 1;
}

export default function MixPlayer({ queue, loading, autoPlayToken, playbackHandoff, externalPlayingTrackId, palette, onTrackChange, onInteraction }) {
  const audioRefs = useRef([]);
  const animationRef = useRef(null);
  const crossfadingRef = useRef(false);
  const activeIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [crossfading, setCrossfading] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const lastAutoPlayToken = useRef(0);
  const anchorKey = queue[0]?.track_id || "";
  const activeTrack = queue[activeIndex] || queue[0];
  const nextTrack = queue.slice(activeIndex + 1).find((track) => track.preview_url);
  const nextBlend = blendLength(nextTrack);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    window.clearInterval(animationRef.current);
    crossfadingRef.current = false;
    audioRefs.current.forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      audio.playbackRate = 1;
    });
    activeIndexRef.current = 0;
    isPlayingRef.current = false;
    setActiveIndex(0);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setCrossfading(false);
    setPlaybackError("");
    onTrackChange(null);
  }, [anchorKey, onTrackChange]);

  useEffect(() => {
    if (!playbackHandoff || playbackHandoff.trackId !== anchorKey) return undefined;
    const audio = playbackHandoff.audio;
    const track = queue[0];
    const previousAudio = audioRefs.current[0];
    if (previousAudio && previousAudio !== audio) {
      previousAudio.pause();
      previousAudio.currentTime = 0;
    }
    audioRefs.current[0] = audio;
    const syncTime = () => handleTimeUpdate(0);
    const syncDuration = () => setDuration(audio.duration || 0);
    const finish = () => handleEnded(0);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("ended", finish);
    setCurrentTime(audio.currentTime || 0);
    setDuration(audio.duration || 0);
    setPlaybackError("");
    playbackHandoff.playPromise
      .then(() => {
        setIsPlaying(true);
        isPlayingRef.current = true;
        onTrackChange(track);
        onInteraction(track, "preview_started");
      })
      .catch(() => {
        setIsPlaying(false);
        isPlayingRef.current = false;
        onTrackChange(null);
        setPlaybackError("This preview could not start. Try YouTube for the full song.");
      });
    return () => {
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("ended", finish);
    };
  }, [anchorKey, playbackHandoff?.token]);

  useEffect(() => {
    if (!anchorKey || !autoPlayToken || autoPlayToken === lastAutoPlayToken.current) return undefined;
    lastAutoPlayToken.current = autoPlayToken;
    if (playbackHandoff?.trackId === anchorKey) return undefined;
    const audio = audioRefs.current[0];
    if (!audio) return undefined;
    const begin = () => startAt(0);
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
    return () => audio.removeEventListener("loadedmetadata", begin);
  }, [anchorKey, autoPlayToken]);

  useEffect(() => {
    if (!externalPlayingTrackId || !isPlaying) return;
    window.clearInterval(animationRef.current);
    crossfadingRef.current = false;
    audioRefs.current.forEach((audio) => audio?.pause());
    setIsPlaying(false);
    setCrossfading(false);
  }, [externalPlayingTrackId, isPlaying]);

  useEffect(() => () => {
    window.clearInterval(animationRef.current);
    audioRefs.current.forEach((audio) => audio?.pause());
  }, []);

  function nextPlayableIndex(fromIndex) {
    return queue.findIndex((track, index) => index > fromIndex && Boolean(track.preview_url));
  }

  async function startAt(index, shouldPlay = true) {
    const track = queue[index];
    const audio = audioRefs.current[index];
    if (!track?.preview_url || !audio) {
      setPlaybackError("That preview is unavailable. Choose another song in the queue.");
      return;
    }
    window.clearInterval(animationRef.current);
    crossfadingRef.current = false;
    audioRefs.current.forEach((item, itemIndex) => {
      if (!item || itemIndex === index) return;
      item.pause();
      item.currentTime = 0;
      item.volume = 1;
      item.playbackRate = 1;
    });
    activeIndexRef.current = index;
    setActiveIndex(index);
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);
    setCrossfading(false);
    setPlaybackError("");
    if (!shouldPlay) return;
    audio.volume = 1;
    audio.playbackRate = 1;
    try {
      await audio.play();
      isPlayingRef.current = true;
      setIsPlaying(true);
      onTrackChange(track);
      onInteraction(track, "preview_started");
    } catch {
      isPlayingRef.current = false;
      setIsPlaying(false);
      onTrackChange(null);
      setPlaybackError("This preview could not start. Try YouTube for the full song.");
    }
  }

  function stopPlayback(reset = false) {
    window.clearInterval(animationRef.current);
    crossfadingRef.current = false;
    audioRefs.current.forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.volume = 1;
      audio.playbackRate = 1;
      if (reset) audio.currentTime = 0;
    });
    setCrossfading(false);
    isPlayingRef.current = false;
    setIsPlaying(false);
    onTrackChange(null);
  }

  async function togglePlayback() {
    if (!activeTrack?.preview_url) {
      const firstPlayable = queue.findIndex((track) => track.preview_url);
      if (firstPlayable >= 0) await startAt(firstPlayable);
      return;
    }
    if (isPlaying) {
      stopPlayback(false);
      return;
    }
    await startAt(activeIndex);
  }

  async function beginCrossfade(fromIndex) {
    if (crossfadingRef.current || !isPlayingRef.current) return;
    const toIndex = nextPlayableIndex(fromIndex);
    if (toIndex < 0) return;
    const outgoing = audioRefs.current[fromIndex];
    const incoming = audioRefs.current[toIndex];
    if (!outgoing || !incoming) return;
    crossfadingRef.current = true;
    setCrossfading(true);
    const seconds = blendLength(queue[toIndex]);
    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.playbackRate = compatiblePlaybackRate(queue[fromIndex], queue[toIndex]);
    try {
      await incoming.play();
    } catch {
      crossfadingRef.current = false;
      setCrossfading(false);
      return;
    }
    const startedAt = performance.now();
    const animateBlend = () => {
      const now = performance.now();
      const progress = Math.min(1, (now - startedAt) / (seconds * 1000));
      outgoing.volume = Math.max(0, Math.min(1, Math.cos(progress * Math.PI / 2)));
      incoming.volume = Math.max(0, Math.min(1, Math.sin(progress * Math.PI / 2)));
      if (progress < 1) return;
      window.clearInterval(animationRef.current);
      outgoing.pause();
      outgoing.currentTime = 0;
      outgoing.volume = 1;
      incoming.volume = 1;
      incoming.playbackRate = 1;
      activeIndexRef.current = toIndex;
      setActiveIndex(toIndex);
      setCurrentTime(incoming.currentTime);
      setDuration(incoming.duration || 0);
      setCrossfading(false);
      crossfadingRef.current = false;
      onTrackChange(queue[toIndex]);
      onInteraction(queue[fromIndex], "preview_completed");
      onInteraction(queue[toIndex], "preview_started");
    };
    animateBlend();
    animationRef.current = window.setInterval(animateBlend, 25);
  }

  function handleTimeUpdate(index) {
    if (index !== activeIndexRef.current) return;
    const audio = audioRefs.current[index];
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);
    const remaining = audio.duration - audio.currentTime;
    if (isPlayingRef.current && remaining > 0 && remaining <= blendLength(queue[nextPlayableIndex(index)])) beginCrossfade(index);
  }

  function handleEnded(index) {
    if (crossfadingRef.current || index !== activeIndexRef.current) return;
    onInteraction(queue[index], "preview_completed");
    const nextIndex = nextPlayableIndex(index);
    if (nextIndex >= 0) startAt(nextIndex);
    else stopPlayback(true);
  }

  function seek(value) {
    const audio = audioRefs.current[activeIndex];
    if (!audio) return;
    audio.currentTime = Number(value);
    setCurrentTime(audio.currentTime);
  }

  function previous() {
    const audio = audioRefs.current[activeIndex];
    if (audio?.currentTime > 3 || activeIndex === 0) {
      if (audio) audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    startAt(activeIndex - 1, isPlaying);
  }

  function next() {
    const nextIndex = nextPlayableIndex(activeIndex);
    if (nextIndex >= 0) startAt(nextIndex, isPlaying);
  }

  if (!activeTrack) return null;
  const artwork = activeTrack.artwork_url?.replace("100x100bb", "300x300bb");
  const playableFollowups = Math.max(0, queue.filter((track, index) => index > 0 && track.preview_url).length);

  return (
    <motion.aside className={`mix-player ${queueOpen ? "queue-open" : ""}`} initial={{ y: 140 }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 150, damping: 24 }} aria-label="Cerum AutoMix player">
      <AnimatePresence>
        {visualizerOpen && <Suspense fallback={null}><FullscreenVisualizer track={activeTrack} nextTrack={nextTrack} isPlaying={isPlaying} crossfading={crossfading} currentTime={currentTime} palette={palette} onClose={() => setVisualizerOpen(false)} /></Suspense>}
        {queueOpen && (
          <motion.div className="mix-queue" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 28 }} transition={{ duration: .22 }}>
            <div className="mix-queue-heading"><div><small>Acoustic AutoMix</small><strong>{loading ? "Building the next five…" : `${playableFollowups} transitions ready`}</strong></div><button onClick={() => setQueueOpen(false)} aria-label="Close queue">×</button></div>
            <ol>
              {queue.map((track, index) => (
                <li key={`${track.track_id}-${index}`} className={index === activeIndex ? "active" : ""}>
                  <button onClick={() => startAt(index, isPlaying)} disabled={!track.preview_url}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                    <em>{index === activeIndex && isPlaying ? "playing" : track.transition_note || (index === 0 ? "your starting song" : "preview unavailable")}</em>
                  </button>
                </li>
              ))}
              {loading && Array.from({ length: Math.max(0, 6 - queue.length) }, (_, index) => <li className="loading" key={index}><span>{String(queue.length + index + 1).padStart(2, "0")}</span><i /></li>)}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mix-player-bar">
        <div className="mix-now">
          <div className={`mix-artwork ${isPlaying ? "spinning" : ""}`}>{artwork ? <img src={artwork} alt="" /> : <span>{activeTrack.title.slice(0, 1)}</span>}</div>
          <div><small>{crossfading ? "Blending now" : "Now playing"}</small><strong>{activeTrack.title}</strong><span>{activeTrack.artist}</span></div>
        </div>
        <div className="mix-transport">
          <div className="mix-controls">
            <button onClick={previous} aria-label="Previous song">←</button>
            <button className="mix-play" onClick={togglePlayback} aria-label={isPlaying ? "Pause AutoMix" : "Play AutoMix"}><PlayIcon playing={isPlaying} /></button>
            <button onClick={next} aria-label="Next song" disabled={nextPlayableIndex(activeIndex) < 0}>→</button>
          </div>
          <div className="mix-progress"><span>{formatTime(currentTime)}</span><input type="range" min="0" max={duration || 30} step="0.1" value={Math.min(currentTime, duration || 30)} onChange={(event) => seek(event.target.value)} aria-label="Preview position" /><span>{formatTime(duration || 30)}</span></div>
        </div>
        <div className="mix-actions">
          <span className="blend-status">{crossfading ? "equal-power blend live" : nextTrack ? `${nextBlend.toFixed(1)}s adaptive blend` : "end of queue"}</span>
          <button className="visuals-button" onClick={() => setVisualizerOpen(true)}>Visuals ↗</button>
          <a href={youtubeSearchUrl(activeTrack)} target="_blank" rel="noreferrer" onClick={() => onInteraction(activeTrack, "youtube_opened")}>YouTube ↗</a>
          <button className="queue-button" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen}><span>Up next</span><strong>{loading ? "…" : playableFollowups}</strong></button>
        </div>
      </div>
      {playbackError && <p className="mix-error" role="alert">{playbackError}</p>}
      {queue.map((track, index) => track.preview_url && !(index === 0 && playbackHandoff?.trackId === track.track_id) && <audio key={`${track.track_id}-audio`} ref={(node) => { audioRefs.current[index] = node; }} src={track.preview_url} preload={index <= activeIndex + 2 ? "auto" : "metadata"} onLoadedMetadata={(event) => { if (index === activeIndexRef.current) setDuration(event.currentTarget.duration); }} onTimeUpdate={() => handleTimeUpdate(index)} onEnded={() => handleEnded(index)} />)}
    </motion.aside>
  );
}
