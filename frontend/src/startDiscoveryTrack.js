// Unlock audio silently inside the user's click gesture. The shared mixer
// rewinds and releases this exact element after the full-screen reveal.
export function createPreviewAudio(previewUrl) {
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = previewUrl;
  return audio;
}

export function prepareTrackPlayback(track, existingAudio = null) {
  if (!track?.preview_url) return null;
  const audio = existingAudio || createPreviewAudio(track.preview_url);
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.muted = false;
  audio.volume = 0;
  const playPromise = audio.play();
  playPromise.catch(() => {});
  return { trackId: track.track_id, audio, playPromise, token: Date.now() };
}

export async function playTrackAfterReveal(audio, track, onBeforePlayback, { preservePosition = false } = {}) {
  if (!audio) return false;
  const resumeAt = preservePosition ? Number(audio.currentTime) || 0 : 0;
  audio.muted = false;
  audio.volume = 0;
  const unlockPromise = audio.play();
  unlockPromise.catch(() => {});
  const proceed = onBeforePlayback ? await onBeforePlayback(track) : true;
  if (!proceed) {
    audio.pause();
    audio.muted = false;
    audio.volume = 1;
    return false;
  }
  await unlockPromise.catch(() => {});
  audio.currentTime = resumeAt;
  audio.muted = false;
  audio.volume = 1;
  if (audio.paused) await audio.play();
  return true;
}

export async function releasePreparedPlayback(handoff, track, onBeforePlayback) {
  if (!handoff?.audio) return false;
  const proceed = onBeforePlayback ? await onBeforePlayback(track) : true;
  if (!proceed) {
    handoff.audio.pause();
    handoff.audio.muted = false;
    handoff.audio.volume = 1;
    return false;
  }
  await handoff.playPromise.catch(() => {});
  handoff.audio.currentTime = 0;
  handoff.audio.muted = false;
  handoff.audio.volume = 1;
  if (handoff.audio.paused) await handoff.audio.play();
  return true;
}

export function startDiscoveryTrack(track, onSelect) {
  onSelect(track, prepareTrackPlayback(track));
}
