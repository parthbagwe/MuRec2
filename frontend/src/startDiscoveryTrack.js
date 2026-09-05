// Unlock audio in the user's click gesture. The shared mixer adopts this
// element, so the shelf does not own another player or another playback loop.
export function startDiscoveryTrack(track, onSelect) {
  const audio = new Audio(track.preview_url);
  audio.preload = "auto";
  const playPromise = audio.play();
  playPromise.catch(() => {});
  onSelect(track, { trackId: track.track_id, audio, playPromise, token: Date.now() });
}
