import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzePreview, buildTransitionPlan, samplePreviewProfile } from "../audio/transitionAnalyzer";
import { AudioMixEngine, createFadeCurves } from "../audio/audioMixEngine";
import FullscreenVisualizer from "./FullscreenVisualizer";
import { playTrackAfterReveal, releasePreparedPlayback } from "../startDiscoveryTrack";

const PREVIEW_LIMIT_SECONDS = 30;
const previewDuration = (audio) => Math.min(Number(audio?.duration) || PREVIEW_LIMIT_SECONDS, PREVIEW_LIMIT_SECONDS);

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

function transitionKey(currentTrack, nextTrack) {
  return `${currentTrack?.track_id || currentTrack?.preview_url || "current"}→${nextTrack?.track_id || nextTrack?.preview_url || "next"}`;
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

export default function MixPlayer({ queue, loading, autoPlayToken, playbackHandoff, externalPlayingTrackId, palette, onTrackChange, onInteraction, onBeforePlayback }) {
  const audioRefs = useRef([]);
  const mixEngineRef = useRef(null);
  const animationRef = useRef(null);
  const rateAnimationRef = useRef(null);
  const blendFallbackRef = useRef(null);
  const finishBlendRef = useRef(null);
  const transitionPlansRef = useRef(new Map());
  const analysisProfilesRef = useRef(new Map());
  const crossfadingRef = useRef(false);
  const playbackRequestRef = useRef(0);
  const transitionClockRef = useRef(null);
  const transitionPairRef = useRef(null);
  const activeIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const queueRef = useRef(queue);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [crossfading, setCrossfading] = useState(false);
  const [mixPlanStatus, setMixPlanStatus] = useState("idle");
  const [activeTransition, setActiveTransition] = useState(null);
  const [playbackError, setPlaybackError] = useState("");
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const lastAutoPlayToken = useRef(0);
  const lastVisualizerToken = useRef(0);
  const anchorKey = queue[0]?.track_id || "";
  const activeTrack = queue[activeIndex] || queue[0];
  const nextTrack = queue.slice(activeIndex + 1).find((track) => track.preview_url);
  const nextBlend = blendLength(activeTrack, nextTrack);

  const getAudioTelemetry = useCallback(() => {
    const pair = transitionPairRef.current;
    const fromIndex = pair?.fromIndex ?? activeIndexRef.current;
    const toIndex = pair?.toIndex ?? queueRef.current.findIndex((item, index) => index > fromIndex && Boolean(item.preview_url));
    const outgoing = audioRefs.current[fromIndex];
    const incoming = toIndex >= 0 ? audioRefs.current[toIndex] : null;
    const outgoingTrack = queueRef.current[fromIndex];
    const incomingTrack = toIndex >= 0 ? queueRef.current[toIndex] : null;
    const primary = samplePreviewProfile(
      analysisProfilesRef.current.get(outgoingTrack?.preview_url),
      outgoing?.currentTime || 0,
    );
    const secondary = samplePreviewProfile(
      analysisProfilesRef.current.get(incomingTrack?.preview_url),
      incoming?.currentTime || 0,
    );
    const clockBlend = mixEngineRef.current?.transitionProgress() || 0;
    const outgoingVolume = crossfadingRef.current ? Math.cos(clockBlend * Math.PI / 2) : 1;
    const incomingVolume = crossfadingRef.current ? Math.sin(clockBlend * Math.PI / 2) : 0;
    const totalVolume = Math.max(0.001, outgoingVolume + incomingVolume);
    return {
      primary,
      secondary,
      blend: crossfadingRef.current ? incomingVolume / totalVolume : 0,
      analyzed: Boolean(primary),
    };
  }, []);

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

  function abortTransition({ resetIncoming = true } = {}) {
    clearBlendCompletion();
    mixEngineRef.current?.cancelTransition();
    transitionClockRef.current = null;
    transitionPairRef.current = null;
    crossfadingRef.current = false;
    setCrossfading(false);
    setActiveTransition(null);
    if (resetIncoming) {
      const fromIndex = activeIndexRef.current;
      audioRefs.current.forEach((audio, index) => {
        if (!audio || index === fromIndex) return;
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
        audio.playbackRate = 1;
      });
    }
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
    for (let index = activeIndex; index <= Math.min(queue.length - 1, activeIndex + 2); index += 1) {
      const audio = audioRefs.current[index];
      if (audio && audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) audio.load();
    }
  }, [activeIndex, queue]);

  useEffect(() => {
    mixEngineRef.current = new AudioMixEngine();
    return () => {
      mixEngineRef.current?.dispose();
      mixEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const playable = queue
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => Boolean(track.preview_url));
    const pairs = playable.slice(0, -1).map((entry, index) => ({ from: entry.track, to: playable[index + 1].track }));
    const activeToIndex = queue.findIndex((track, index) => index > activeIndex && Boolean(track.preview_url));
    const activeKey = activeToIndex >= 0 ? transitionKey(queue[activeIndex], queue[activeToIndex]) : null;
    if (!activeKey) {
      setMixPlanStatus("idle");
      return undefined;
    }
    if (transitionPlansRef.current.has(activeKey)) {
      setMixPlanStatus("ready");
    } else {
      setMixPlanStatus("analyzing");
    }
    let cancelled = false;
    Promise.allSettled(pairs.map(async ({ from, to }) => {
      const key = transitionKey(from, to);
      if (transitionPlansRef.current.has(key)) return;
      const [outgoingProfile, incomingProfile] = await Promise.all([
        analyzePreview(from.preview_url),
        analyzePreview(to.preview_url),
      ]);
      analysisProfilesRef.current.set(from.preview_url, outgoingProfile);
      analysisProfilesRef.current.set(to.preview_url, incomingProfile);
      transitionPlansRef.current.set(key, buildTransitionPlan(outgoingProfile, incomingProfile, from, to));
    })).then(() => {
      if (cancelled) return;
      setMixPlanStatus(transitionPlansRef.current.has(activeKey) ? "ready" : "fallback");
    });
    return () => { cancelled = true; };
  }, [activeIndex, queue]);

  useEffect(() => {
    if (!activeTrack?.preview_url || analysisProfilesRef.current.has(activeTrack.preview_url)) return undefined;
    let cancelled = false;
    analyzePreview(activeTrack.preview_url)
      .then((profile) => {
        if (!cancelled) analysisProfilesRef.current.set(activeTrack.preview_url, profile);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTrack?.preview_url]);

  useEffect(() => {
    playbackRequestRef.current += 1;
    abortTransition();
    clearRateAutomation();
    transitionPlansRef.current.clear();
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
    setActiveTransition(null);
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
    mixEngineRef.current?.connect(audio);
    const syncTime = () => handleTimeUpdate(0);
    const syncDuration = () => setDuration(previewDuration(audio));
    const finish = () => handleEnded(0);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("ended", finish);
    setCurrentTime(audio.currentTime || 0);
    setDuration(previewDuration(audio));
    setPlaybackError("");
    const requestId = ++playbackRequestRef.current;
    let cancelled = false;
    mixEngineRef.current?.activate().catch(() => {});
    releasePreparedPlayback(playbackHandoff, track, onBeforePlayback)
      .then((started) => {
        if (cancelled || requestId !== playbackRequestRef.current) {
          audio.pause();
          return;
        }
        if (!started) return;
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
      cancelled = true;
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("ended", finish);
    };
  }, [anchorKey, playbackHandoff?.token, onBeforePlayback]);

  useEffect(() => {
    if (!anchorKey || !autoPlayToken || autoPlayToken === lastAutoPlayToken.current) return undefined;
    lastAutoPlayToken.current = autoPlayToken;
    if (playbackHandoff?.trackId === anchorKey) return undefined;
    const audio = audioRefs.current[0];
    if (!audio) return undefined;
    const begin = () => startAt(0, { reveal: true, preservePosition: false, reason: "selection" });
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
    return () => audio.removeEventListener("loadedmetadata", begin);
  }, [anchorKey, autoPlayToken]);

  useEffect(() => {
    if (!anchorKey || !autoPlayToken || autoPlayToken === lastVisualizerToken.current) return;
    lastVisualizerToken.current = autoPlayToken;
    setVisualizerOpen(true);
    setQueueOpen(false);
  }, [anchorKey, autoPlayToken]);

  useEffect(() => {
    if (!externalPlayingTrackId || !isPlaying) return;
    playbackRequestRef.current += 1;
    abortTransition();
    clearRateAutomation();
    audioRefs.current.forEach((audio) => audio?.pause());
    setIsPlaying(false);
    setCrossfading(false);
  }, [externalPlayingTrackId, isPlaying]);

  useEffect(() => () => {
    playbackRequestRef.current += 1;
    clearBlendCompletion();
    clearRateAutomation();
    audioRefs.current.forEach((audio) => audio?.pause());
  }, []);

  function nextPlayableIndex(fromIndex) {
    return queueRef.current.findIndex((track, index) => index > fromIndex && Boolean(track.preview_url));
  }

  function transitionPlanFor(fromIndex, toIndex) {
    return transitionPlansRef.current.get(transitionKey(queueRef.current[fromIndex], queueRef.current[toIndex])) || null;
  }

  async function startAt(index, {
    shouldPlay = true,
    advanceOnFailure = false,
    reveal = false,
    preservePosition = false,
    reason = "manual",
  } = {}) {
    const track = queueRef.current[index];
    const audio = audioRefs.current[index];
    if (!track?.preview_url || !audio) {
      setPlaybackError("That preview is unavailable. Choose another song in the queue.");
      return;
    }
    const requestId = ++playbackRequestRef.current;
    abortTransition();
    clearRateAutomation();
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
    setDuration(previewDuration(audio));
    setCrossfading(false);
    setPlaybackError("");
    if (!shouldPlay) return;
    audio.volume = 1;
    audio.playbackRate = 1;
    audio.preservesPitch = true;
    audio.webkitPreservesPitch = true;
    mixEngineRef.current?.connect(audio);
    await mixEngineRef.current?.activate().catch(() => null);
    let started = false;
    try {
      if (reveal) started = await playTrackAfterReveal(audio, track, onBeforePlayback, { preservePosition });
      else {
        if (!preservePosition) audio.currentTime = 0;
        await audio.play();
        started = true;
      }
    } catch {
      if (requestId !== playbackRequestRef.current) return false;
      try {
        await audio.play();
        started = true;
      } catch { /* handled below */ }
    }
    if (requestId !== playbackRequestRef.current) {
      audio.pause();
      return false;
    }
    if (started) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      onTrackChange(track);
      onInteraction(track, reason === "resume" ? "preview_resumed" : "preview_started");
      return true;
    }
    if (advanceOnFailure) {
      const nextIndex = nextPlayableIndex(index);
      if (nextIndex >= 0) return startAt(nextIndex, { shouldPlay: true, advanceOnFailure: true, reveal: false, preservePosition: false, reason: "automatic" });
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    onTrackChange(null);
    setPlaybackError("This preview could not start. Try YouTube for the full song.");
    return false;
  }

  function stopPlayback(reset = false) {
    playbackRequestRef.current += 1;
    abortTransition();
    clearRateAutomation();
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
      if (firstPlayable >= 0) await startAt(firstPlayable, { reveal: true, preservePosition: false, reason: "selection" });
      return;
    }
    if (isPlaying) {
      stopPlayback(false);
      return;
    }
    await startAt(activeIndex, { preservePosition: true, reason: "resume" });
  }

  function waitForPlayable(audio, requestId, timeoutMs = 1400) {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        audio.removeEventListener("canplay", readyHandler);
        audio.removeEventListener("error", errorHandler);
        resolve(ready && requestId === playbackRequestRef.current);
      };
      const readyHandler = () => finish(true);
      const errorHandler = () => finish(false);
      const timer = window.setTimeout(() => finish(audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA), timeoutMs);
      audio.addEventListener("canplay", readyHandler, { once: true });
      audio.addEventListener("error", errorHandler, { once: true });
      audio.load();
    });
  }

  async function beginCrossfade(fromIndex) {
    if (crossfadingRef.current || !isPlayingRef.current) return false;
    const toIndex = nextPlayableIndex(fromIndex);
    if (toIndex < 0) return false;
    const outgoing = audioRefs.current[fromIndex];
    const incoming = audioRefs.current[toIndex];
    if (!outgoing || !incoming) return false;
    const requestId = playbackRequestRef.current;
    const currentQueue = queueRef.current;
    const analyzedPlan = transitionPlanFor(fromIndex, toIndex);
    const fallbackDuration = blendLength(currentQueue[fromIndex], currentQueue[toIndex]);
    const plan = analyzedPlan || {
      mode: "gentle_crossfade",
      curve: "equal_power",
      duration: fallbackDuration,
      outgoingStart: Math.max(0, previewDuration(outgoing) - fallbackDuration),
      incomingStart: 0,
      incomingGain: 0.9,
      playbackRate: 1,
      bassCutDb: -2.2,
      confidence: 0,
      source: "safe-fallback",
    };
    const ready = await waitForPlayable(incoming, requestId);
    if (!ready || requestId !== playbackRequestRef.current || !isPlayingRef.current || outgoing.paused) return false;

    const pitchPreservingRateSupported = "preservesPitch" in incoming || "webkitPreservesPitch" in incoming;
    const matchedRate = plan.mode === "beat_aligned" && pitchPreservingRateSupported ? plan.playbackRate : 1;
    const lateness = Math.max(0, outgoing.currentTime - plan.outgoingStart);
    const latestSafeEntry = Math.max(0, previewDuration(incoming) - plan.duration - 0.08);
    incoming.currentTime = Math.min(latestSafeEntry, Math.max(0, plan.incomingStart + lateness * matchedRate));
    incoming.playbackRate = matchedRate;
    incoming.preservesPitch = true;
    incoming.webkitPreservesPitch = true;
    incoming.volume = 0;
    mixEngineRef.current?.connect(incoming);
    await mixEngineRef.current?.activate().catch(() => null);
    if (requestId !== playbackRequestRef.current) return false;
    try {
      await incoming.play();
    } catch {
      incoming.volume = 1;
      setPlaybackError(`Could not preload ${currentQueue[toIndex].title}. Cerum will try the next playable preview.`);
      return false;
    }
    if (requestId !== playbackRequestRef.current || !isPlayingRef.current) {
      incoming.pause();
      incoming.currentTime = 0;
      return false;
    }

    crossfadingRef.current = true;
    transitionPairRef.current = { fromIndex, toIndex };
    setCrossfading(true);
    setActiveTransition({ ...plan, fromTrack: currentQueue[fromIndex], toTrack: currentQueue[toIndex] });
    setPlaybackError("");
    const clock = mixEngineRef.current?.scheduleTransition(outgoing, incoming, plan);
    transitionClockRef.current = clock;
    const startedAt = performance.now();
    const seconds = Math.max(0.5, plan.duration);
    const fallbackCurves = clock ? null : createFadeCurves(96, plan.curve, plan.incomingGain);
    if (!clock) outgoing.volume = 1;
    let finished = false;
    let promoted = false;

    const promoteIncoming = () => {
      if (promoted) return;
      promoted = true;
      activeIndexRef.current = toIndex;
      setActiveIndex(toIndex);
      setCurrentTime(incoming.currentTime);
      setDuration(previewDuration(incoming));
      onTrackChange(currentQueue[toIndex]);
      onInteraction(currentQueue[toIndex], "preview_started");
    };
    const finishBlend = () => {
      if (finished) return;
      finished = true;
      promoteIncoming();
      clearBlendCompletion();
      mixEngineRef.current?.completeTransition();
      transitionClockRef.current = null;
      transitionPairRef.current = null;
      outgoing.pause();
      outgoing.currentTime = 0;
      outgoing.volume = 1;
      incoming.volume = 1;
      settlePlaybackRate(incoming, matchedRate);
      setCrossfading(false);
      setActiveTransition(null);
      crossfadingRef.current = false;
      onInteraction(currentQueue[fromIndex], "preview_completed");
    };
    finishBlendRef.current = finishBlend;
    blendFallbackRef.current = window.setTimeout(finishBlend, seconds * 1000 + 450);
    const monitorBlend = () => {
      if (finished || requestId !== playbackRequestRef.current) return;
      const progress = clock
        ? mixEngineRef.current.transitionProgress()
        : Math.min(1, (performance.now() - startedAt) / (seconds * 1000));
      if (!clock) {
        const curveIndex = Math.min(fallbackCurves.outgoing.length - 1, Math.round(progress * (fallbackCurves.outgoing.length - 1)));
        outgoing.volume = fallbackCurves.outgoing[curveIndex];
        incoming.volume = fallbackCurves.incoming[curveIndex];
      }
      if (progress >= 0.55) promoteIncoming();
      if (progress >= 1 || outgoing.ended) finishBlend();
      else animationRef.current = requestAnimationFrame(monitorBlend);
    };
    animationRef.current = requestAnimationFrame(monitorBlend);
    return true;
  }

  function handleTimeUpdate(index) {
    if (index !== activeIndexRef.current) return;
    const audio = audioRefs.current[index];
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    const cappedDuration = previewDuration(audio);
    setDuration(cappedDuration);
    const remaining = cappedDuration - audio.currentTime;
    const nextIndex = nextPlayableIndex(index);
    const plan = nextIndex >= 0 ? transitionPlanFor(index, nextIndex) : null;
    const reachedAnalyzedBoundary = plan && audio.currentTime >= plan.outgoingStart;
    const reachedFallbackBoundary = !plan && remaining > 0 && remaining <= blendLength(queueRef.current[index], queueRef.current[nextIndex]) + 0.7;
    if (isPlayingRef.current && nextIndex >= 0 && (reachedAnalyzedBoundary || reachedFallbackBoundary)) beginCrossfade(index);
    if (audio.currentTime >= PREVIEW_LIMIT_SECONDS && !crossfadingRef.current) {
      audio.pause();
      handleEnded(index);
    }
  }

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
      const fromIndex = activeIndexRef.current;
      const toIndex = nextPlayableIndex(fromIndex);
      const audio = audioRefs.current[fromIndex];
      const plan = toIndex >= 0 ? transitionPlanFor(fromIndex, toIndex) : null;
      if (!audio || !plan || crossfadingRef.current || audio.paused || audio.ended) return;
      if (audio.currentTime >= plan.outgoingStart) beginCrossfade(fromIndex);
    }, 40);
    return () => window.clearInterval(timer);
  }, [activeIndex, anchorKey, isPlaying, mixPlanStatus]);

  function handleEnded(index) {
    if (index !== activeIndexRef.current) return;
    if (crossfadingRef.current) {
      if (finishBlendRef.current) finishBlendRef.current();
      else {
        crossfadingRef.current = false;
        setCrossfading(false);
        onInteraction(queueRef.current[index], "preview_completed");
        const nextIndex = nextPlayableIndex(index);
        if (nextIndex >= 0) startAt(nextIndex, { shouldPlay: true, advanceOnFailure: true, reveal: false, preservePosition: false, reason: "automatic" });
        else stopPlayback(true);
      }
      return;
    }
    onInteraction(queueRef.current[index], "preview_completed");
    const nextIndex = nextPlayableIndex(index);
    if (nextIndex >= 0) startAt(nextIndex, { shouldPlay: true, advanceOnFailure: true, reveal: false, preservePosition: false, reason: "automatic" });
    else stopPlayback(true);
  }

  function handleAudioError(index) {
    const track = queueRef.current[index];
    const pair = transitionPairRef.current;
    if (crossfadingRef.current && pair?.toIndex === index) {
      abortTransition();
      setPlaybackError(`${track?.title || "The next preview"} could not load. Cerum will try the next playable song at the boundary.`);
      return;
    }
    if (index !== activeIndexRef.current) return;
    const shouldContinue = isPlayingRef.current;
    const nextIndex = nextPlayableIndex(index);
    if (shouldContinue && nextIndex >= 0) {
      startAt(nextIndex, { shouldPlay: true, advanceOnFailure: true, reveal: false, preservePosition: false, reason: "automatic" });
      return;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    onTrackChange(null);
    setPlaybackError(`${track?.title || "This preview"} is unavailable right now.`);
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
    startAt(activeIndex - 1, { shouldPlay: isPlaying, reveal: false, preservePosition: false, reason: "skip" });
  }

  function next() {
    const nextIndex = nextPlayableIndex(activeIndex);
    if (nextIndex < 0) return;
    if (isPlaying) beginCrossfade(activeIndex);
    else startAt(nextIndex, { shouldPlay: false });
  }

  if (!activeTrack) return null;
  const artwork = activeTrack.artwork_url?.replace("100x100bb", "300x300bb");
  const playableFollowups = Math.max(0, queue.filter((track, index) => index > 0 && track.preview_url).length);

  return (
    <motion.aside
      className={`mix-player ${queueOpen ? "queue-open" : ""}`}
      initial={{ y: 140 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 150, damping: 24 }}
      aria-label="Cerum AutoMix player"
      data-playing={isPlaying ? "true" : "false"}
      data-active-index={activeIndex}
      data-crossfading={crossfading ? "true" : "false"}
      data-transition-mode={activeTransition?.mode || "none"}
    >
      <AnimatePresence>
        {visualizerOpen && (
          <FullscreenVisualizer
            key="fullscreen-visualizer"
            track={activeTrack}
            nextTrack={nextTrack}
            queue={queue}
            activeIndex={activeIndex}
            isPlaying={isPlaying}
            crossfading={crossfading}
            transition={activeTransition}
            currentTime={currentTime}
            duration={duration}
            palette={palette}
            getAudioTelemetry={getAudioTelemetry}
            onClose={() => setVisualizerOpen(false)}
            onTogglePlayback={togglePlayback}
            onPrevious={previous}
            onNext={next}
            onSeek={seek}
            onChooseTrack={(index) => startAt(index, { shouldPlay: true, reveal: true, preservePosition: false, reason: "selection" })}
          />
        )}
        {queueOpen && (
          <motion.div key="mix-queue" className="mix-queue" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 28 }} transition={{ duration: .22 }}>
            <div className="mix-queue-heading"><div><small>Acoustic AutoMix</small><strong>{loading ? "Building the next five…" : `${playableFollowups} transitions ready`}</strong></div><button onClick={() => setQueueOpen(false)} aria-label="Close queue">×</button></div>
            <ol>
              {queue.map((track, index) => (
                <li key={`${track.track_id}-${index}`} className={index === activeIndex ? "active" : ""}>
                  <button onClick={() => startAt(index, { shouldPlay: true, reveal: true, preservePosition: false, reason: "selection" })} disabled={!track.preview_url}>
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
          <span className="blend-status">{loading ? "Building your mix…" : crossfading ? `${activeTransition?.mode === "beat_aligned" ? "beat-aligned" : activeTransition?.mode === "clean_handoff" ? "clean" : "adaptive"} transition live` : nextTrack ? (mixPlanStatus === "ready" ? "adaptive preview mix ready" : mixPlanStatus === "analyzing" ? "preparing the next transition" : `${nextBlend.toFixed(1)}s safe crossfade ready`) : "end of queue"}</span>
          <button className="visuals-button" onClick={() => setVisualizerOpen(true)}>Visuals ↗</button>
          <a href={youtubeSearchUrl(activeTrack)} target="_blank" rel="noreferrer" onClick={() => onInteraction(activeTrack, "youtube_opened")}>YouTube ↗</a>
          <button className="queue-button" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen}><span>{loading ? "Building mix" : "Up next"}</span><strong>{loading ? "…" : playableFollowups}</strong></button>
        </div>
      </div>
      {playbackError && <p className="mix-error" role="alert">{playbackError}</p>}
      {queue.map((track, index) => track.preview_url && !(index === 0 && playbackHandoff?.trackId === track.track_id) && <audio key={`${track.track_id}-${index}-audio`} ref={(node) => { audioRefs.current[index] = node; }} crossOrigin="anonymous" src={track.preview_url} preload={index <= activeIndex + 2 ? "auto" : "metadata"} onLoadedMetadata={(event) => { if (index === activeIndexRef.current) setDuration(previewDuration(event.currentTarget)); }} onTimeUpdate={() => handleTimeUpdate(index)} onEnded={() => handleEnded(index)} onError={() => handleAudioError(index)} />)}
    </motion.aside>
  );
}
