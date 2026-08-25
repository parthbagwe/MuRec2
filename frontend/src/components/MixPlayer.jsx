import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import FullscreenVisualizer from "./FullscreenVisualizer";

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

function transitionTempoDifference(currentTrack, nextTrack) {
  const [currentBpm, nextBpm] = transitionBpms(currentTrack, nextTrack);
  if (!currentBpm || !nextBpm) return 8;
  return Math.min(...[nextBpm, nextBpm / 2, nextBpm * 2].map((candidate) => Math.abs(currentBpm - candidate)));
}

function transitionBpms(currentTrack, nextTrack) {
  let currentBpm = Number(currentTrack?.bpm);
  let nextBpm = Number(nextTrack?.bpm);
  const edgeMatch = String(nextTrack?.transition_note || "").match(/([\d.]+)\s*→\s*([\d.]+)\s*BPM/i);
  if (!currentBpm && edgeMatch) currentBpm = Number(edgeMatch[1]);
  if (!nextBpm && edgeMatch) nextBpm = Number(edgeMatch[2]);
  return [currentBpm, nextBpm];
}

function blendLength(currentTrack, nextTrack) {
  if (!nextTrack) return 3;
  const score = Math.max(0, Math.min(1, Number(nextTrack.hybrid_score ?? 0.72)));
  const tempoFit = Math.max(0, 1 - transitionTempoDifference(currentTrack, nextTrack) / 18);
  return Math.max(2.4, Math.min(4.6, 2.4 + tempoFit * 1.35 + score * 0.85));
}

function tempoMatchRate(currentTrack, nextTrack) {
  const [currentBpm, nextBpm] = transitionBpms(currentTrack, nextTrack);
  if (!currentBpm || !nextBpm) return 1;
  const matchedNextBpm = [nextBpm, nextBpm / 2, nextBpm * 2]
    .sort((a, b) => Math.abs(currentBpm - a) - Math.abs(currentBpm - b))[0];
  return Math.max(0.94, Math.min(1.06, currentBpm / matchedNextBpm));
}

function beatAlignmentDelay(audio, currentTrack, nextTrack) {
  const [bpm] = transitionBpms(currentTrack, nextTrack);
  if (!bpm || !audio) return 0;
  const beatSeconds = 60 / bpm;
  const delay = (beatSeconds - (audio.currentTime % beatSeconds)) % beatSeconds;
  return delay < 0.06 ? 0 : Math.min(0.65, delay);
}

export default function MixPlayer({ queue, loading, autoPlayToken, playbackHandoff, externalPlayingTrackId, palette, onTrackChange, onInteraction }) {
  const audioRefs = useRef([]);
  const animationRef = useRef(null);
  const rateAnimationRef = useRef(null);
  const blendFallbackRef = useRef(null);
  const finishBlendRef = useRef(null);
  const crossfadingRef = useRef(false);
  const activeIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const queueRef = useRef(queue);
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
  const nextBlend = blendLength(activeTrack, nextTrack);

  function clearBlendCompletion() {
    cancelAnimationFrame(animationRef.current);
    window.clearTimeout(blendFallbackRef.current);
    animationRef.current = null;
    blendFallbackRef.current = null;
    finishBlendRef.current = null;
  }

  function clearRateAutomation() {
    cancelAnimationFrame(rateAnimationRef.current);
    rateAnimationRef.current = null;
  }

  function settlePlaybackRate(audio, startingRate) {
    clearRateAutomation();
    if (!audio || Math.abs(startingRate - 1) < 0.002) {
      if (audio) audio.playbackRate = 1;
      return;
    }
    const startedAt = performance.now();
    const durationMs = 6000;
    const animateRate = () => {
      if (audio.paused || audio.ended) {
        audio.playbackRate = 1;
        rateAnimationRef.current = null;
        return;
      }
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      audio.playbackRate = startingRate + (1 - startingRate) * eased;
      if (progress < 1) rateAnimationRef.current = requestAnimationFrame(animateRate);
      else rateAnimationRef.current = null;
    };
    rateAnimationRef.current = requestAnimationFrame(animateRate);
  }

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    clearBlendCompletion();
    clearRateAutomation();
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
    clearBlendCompletion();
    clearRateAutomation();
    crossfadingRef.current = false;
    audioRefs.current.forEach((audio) => audio?.pause());
    setIsPlaying(false);
    setCrossfading(false);
  }, [externalPlayingTrackId, isPlaying]);

  useEffect(() => () => {
    clearBlendCompletion();
    clearRateAutomation();
    audioRefs.current.forEach((audio) => audio?.pause());
  }, []);

  function nextPlayableIndex(fromIndex) {
    return queueRef.current.findIndex((track, index) => index > fromIndex && Boolean(track.preview_url));
  }

  async function startAt(index, shouldPlay = true) {
    const track = queueRef.current[index];
    const audio = audioRefs.current[index];
    if (!track?.preview_url || !audio) {
      setPlaybackError("That preview is unavailable. Choose another song in the queue.");
      return;
    }
    clearBlendCompletion();
    clearRateAutomation();
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
    clearBlendCompletion();
    clearRateAutomation();
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
    const currentQueue = queueRef.current;
    const seconds = blendLength(currentQueue[fromIndex], currentQueue[toIndex]);
    const matchedRate = tempoMatchRate(currentQueue[fromIndex], currentQueue[toIndex]);
    const beatDelay = beatAlignmentDelay(outgoing, currentQueue[fromIndex], currentQueue[toIndex]);
    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.playbackRate = matchedRate;
    incoming.preservesPitch = true;
    if (beatDelay > 0) await new Promise((resolve) => window.setTimeout(resolve, beatDelay * 1000));
    if (!crossfadingRef.current || !isPlayingRef.current || outgoing.ended) {
      crossfadingRef.current = false;
      setCrossfading(false);
      return;
    }
    try {
      await incoming.play();
    } catch {
      clearBlendCompletion();
      crossfadingRef.current = false;
      setCrossfading(false);
      return;
    }
    const startedAt = performance.now();
    let finished = false;
    const finishBlend = () => {
      if (finished) return;
      finished = true;
      clearBlendCompletion();
      outgoing.pause();
      outgoing.currentTime = 0;
      outgoing.volume = 1;
      incoming.volume = 1;
      settlePlaybackRate(incoming, matchedRate);
      activeIndexRef.current = toIndex;
      setActiveIndex(toIndex);
      setCurrentTime(incoming.currentTime);
      setDuration(incoming.duration || 0);
      setCrossfading(false);
      crossfadingRef.current = false;
      onTrackChange(currentQueue[toIndex]);
      onInteraction(currentQueue[fromIndex], "preview_completed");
      onInteraction(currentQueue[toIndex], "preview_started");
    };
    finishBlendRef.current = finishBlend;
    blendFallbackRef.current = window.setTimeout(finishBlend, seconds * 1000 + 250);
    if (outgoing.ended) {
      finishBlend();
      return;
    }
    const animateBlend = () => {
      const now = performance.now();
      const progress = Math.min(1, (now - startedAt) / (seconds * 1000));
      outgoing.volume = Math.max(0, Math.min(1, Math.cos(progress * Math.PI / 2)));
      incoming.volume = Math.max(0, Math.min(1, Math.sin(progress * Math.PI / 2)));
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateBlend);
        return;
      }
      finishBlend();
    };
    animationRef.current = requestAnimationFrame(animateBlend);
  }

  function handleTimeUpdate(index) {
    if (index !== activeIndexRef.current) return;
    const audio = audioRefs.current[index];
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);
    const remaining = audio.duration - audio.currentTime;
    const nextIndex = nextPlayableIndex(index);
    if (isPlayingRef.current && nextIndex >= 0 && remaining > 0 && remaining <= blendLength(queueRef.current[index], queueRef.current[nextIndex]) + 0.7) beginCrossfade(index);
  }

  function handleEnded(index) {
    if (index !== activeIndexRef.current) return;
    if (crossfadingRef.current) {
      finishBlendRef.current?.();
      return;
    }
    onInteraction(queueRef.current[index], "preview_completed");
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
    if (nextIndex < 0) return;
    if (isPlaying) beginCrossfade(activeIndex);
    else startAt(nextIndex, false);
  }

  if (!activeTrack) return null;
  const artwork = activeTrack.artwork_url?.replace("100x100bb", "300x300bb");
  const playableFollowups = Math.max(0, queue.filter((track, index) => index > 0 && track.preview_url).length);

  return (
    <motion.aside className={`mix-player ${queueOpen ? "queue-open" : ""}`} initial={{ y: 140 }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 150, damping: 24 }} aria-label="Cerum AutoMix player">
      <AnimatePresence>
        {visualizerOpen && (
          <FullscreenVisualizer
            track={activeTrack}
            nextTrack={nextTrack}
            queue={queue}
            activeIndex={activeIndex}
            isPlaying={isPlaying}
            crossfading={crossfading}
            currentTime={currentTime}
            duration={duration}
            palette={palette}
            onClose={() => setVisualizerOpen(false)}
            onTogglePlayback={togglePlayback}
            onPrevious={previous}
            onNext={next}
            onSeek={seek}
            onChooseTrack={(index) => startAt(index, isPlaying)}
          />
        )}
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
          <span className="blend-status">{crossfading ? "beat-matched blend live" : nextTrack ? `${nextBlend.toFixed(1)}s beat-matched blend` : "end of queue"}</span>
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
