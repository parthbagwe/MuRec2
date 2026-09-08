import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { STARTER_TRACKS } from './discoveryTracks.js';
import { startDiscoveryTrack } from './startDiscoveryTrack.js';

function mockAudio(t, implementation) {
  const previous = globalThis.Audio;
  globalThis.Audio = implementation;
  t.after(() => { if (previous === undefined) delete globalThis.Audio; else globalThis.Audio = previous; });
}

test('editorial shelf uses distinct real songs already in the public catalogue', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/catalogue/manifest.json', import.meta.url)));
  const catalogue = JSON.parse(gunzipSync(readFileSync(new URL(`../public${manifest.file}`, import.meta.url))));
  assert.equal(STARTER_TRACKS.length, 6);
  assert.equal(new Set(STARTER_TRACKS.map(t => t.track_id)).size, 6);
  for (const track of STARTER_TRACKS) {
    const original = catalogue.tracks.find(t => t.track_id === track.track_id);
    assert.ok(original, track.title);
    for (const field of ['title', 'artist', 'preview_url', 'artwork_url', 'provider_genre']) {
      assert.equal(track[field], original[field], `${track.title}: ${field}`);
    }
    assert.ok(track.preview_url.startsWith('https://audio-ssl.itunes.apple.com/'));
    assert.ok(track.artwork_url.startsWith('https://is1-ssl.mzstatic.com/'));
  }
});

test('shelf starts one audio element in the click and hands that exact element to AutoMix', async (t) => {
  const order = [];
  const playPromise = Promise.resolve();
  const instances = [];
  mockAudio(t, class FakeAudio {
    constructor(src) { this.src = src; instances.push(this); }
    play() { order.push('play'); return playPromise; }
  });
  let handoff;
  startDiscoveryTrack(STARTER_TRACKS[0], (track, value) => {
    order.push('select');
    assert.equal(track, STARTER_TRACKS[0]);
    handoff = value;
  });
  assert.deepEqual(order, ['play', 'select']);
  assert.equal(instances.length, 1);
  assert.equal(handoff.audio, instances[0]);
  assert.equal(handoff.audio.src, STARTER_TRACKS[0].preview_url);
  assert.equal(handoff.audio.preload, 'auto');
  assert.equal(handoff.audio.muted, false);
  assert.equal(handoff.audio.volume, 0);
  assert.equal(handoff.trackId, STARTER_TRACKS[0].track_id);
  assert.equal(handoff.playPromise, playPromise);
  assert.ok(Number.isFinite(handoff.token));
  await handoff.playPromise;
});

test('blocked autoplay still reaches the existing mixer error/retry flow', async (t) => {
  const error = new Error('NotAllowedError');
  mockAudio(t, class FakeAudio { play() { return Promise.reject(error); } });
  let handoff;
  startDiscoveryTrack(STARTER_TRACKS[1], (_track, value) => { handoff = value; });
  assert.ok(handoff);
  await assert.rejects(handoff.playPromise, error);
});
