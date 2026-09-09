const channelByAudio = new WeakMap();

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createFadeCurves(length = 96, curve = "equal_power", incomingGain = 1) {
  const outgoing = new Float32Array(length);
  const incoming = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const progress = index / Math.max(1, length - 1);
    if (curve === "short_s") {
      const smooth = progress * progress * (3 - 2 * progress);
      outgoing[index] = 1 - smooth;
      incoming[index] = smooth * incomingGain;
    } else {
      outgoing[index] = Math.cos(progress * Math.PI / 2);
      incoming[index] = Math.sin(progress * Math.PI / 2) * incomingGain;
    }
  }
  outgoing[length - 1] = 0;
  incoming[0] = 0;
  incoming[length - 1] = incomingGain;
  return { outgoing, incoming };
}

function cancelParam(param, time, value) {
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
  else {
    param.cancelScheduledValues(time);
    param.setValueAtTime(value, time);
  }
}

export class AudioMixEngine {
  constructor() {
    this.context = null;
    this.compressor = null;
    this.transition = null;
  }

  ensureContext() {
    if (this.context) return this.context;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    this.context = new Context({ latencyHint: "playback" });
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -4;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.compressor.connect(this.context.destination);
    return this.context;
  }

  async activate() {
    const context = this.ensureContext();
    if (context?.state === "suspended") await context.resume();
    return context;
  }

  connect(audio) {
    if (!audio) return null;
    const existing = channelByAudio.get(audio);
    if (existing) return existing;
    const context = this.ensureContext();
    if (!context) return null;
    try {
      const source = context.createMediaElementSource(audio);
      const bass = context.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 180;
      bass.gain.value = 0;
      const gain = context.createGain();
      gain.gain.value = 1;
      source.connect(bass).connect(gain).connect(this.compressor);
      const channel = { audio, source, bass, gain };
      channelByAudio.set(audio, channel);
      return channel;
    } catch {
      return null;
    }
  }

  reset(audio, gainValue = 1) {
    const channel = channelByAudio.get(audio);
    if (!channel || !this.context) {
      if (audio) audio.volume = clamp(gainValue);
      return;
    }
    const now = this.context.currentTime;
    cancelParam(channel.gain.gain, now, channel.gain.gain.value);
    cancelParam(channel.bass.gain, now, channel.bass.gain.value);
    channel.gain.gain.setValueAtTime(gainValue, now);
    channel.bass.gain.setValueAtTime(0, now);
    audio.volume = 1;
  }

  scheduleTransition(outgoingAudio, incomingAudio, plan) {
    const context = this.ensureContext();
    const outgoingChannel = this.connect(outgoingAudio);
    const incomingChannel = this.connect(incomingAudio);
    if (!context || !outgoingChannel || !incomingChannel) return null;
    const now = context.currentTime;
    const startAt = now + 0.035;
    const duration = Math.max(0.5, Number(plan.duration) || 2.5);
    const endAt = startAt + duration;
    const incomingGain = clamp(Number(plan.incomingGain) || 1, 0.5, 1);
    const curves = createFadeCurves(96, plan.curve, incomingGain);
    for (const channel of [outgoingChannel, incomingChannel]) {
      cancelParam(channel.gain.gain, now, channel.gain.gain.value);
      cancelParam(channel.bass.gain, now, channel.bass.gain.value);
    }
    outgoingChannel.gain.gain.setValueAtTime(1, now);
    incomingChannel.gain.gain.setValueAtTime(0, now);
    outgoingChannel.gain.gain.setValueCurveAtTime(curves.outgoing, startAt, duration);
    incomingChannel.gain.gain.setValueCurveAtTime(curves.incoming, startAt, duration);
    const bassCut = Math.min(0, Number(plan.bassCutDb) || 0);
    if (bassCut < 0) {
      outgoingChannel.bass.gain.linearRampToValueAtTime(bassCut, startAt + duration * 0.34);
      incomingChannel.bass.gain.linearRampToValueAtTime(bassCut, startAt + duration * 0.34);
      incomingChannel.bass.gain.linearRampToValueAtTime(0, endAt);
    }
    this.transition = { startAt, endAt, outgoingAudio, incomingAudio, incomingGain };
    outgoingAudio.volume = 1;
    incomingAudio.volume = 1;
    return { context, startAt, endAt, duration };
  }

  transitionProgress() {
    if (!this.transition || !this.context) return 0;
    const duration = this.transition.endAt - this.transition.startAt;
    return clamp((this.context.currentTime - this.transition.startAt) / Math.max(duration, 0.001));
  }

  cancelTransition() {
    if (!this.transition) return;
    this.reset(this.transition.outgoingAudio, 1);
    this.reset(this.transition.incomingAudio, 1);
    this.transition = null;
  }

  completeTransition() {
    if (!this.transition) return;
    const { outgoingAudio, incomingAudio, incomingGain } = this.transition;
    this.reset(outgoingAudio, 1);
    const incomingChannel = channelByAudio.get(incomingAudio);
    if (incomingChannel && this.context) {
      const now = this.context.currentTime;
      cancelParam(incomingChannel.gain.gain, now, incomingGain);
      incomingChannel.gain.gain.setValueAtTime(incomingGain, now);
      incomingChannel.gain.gain.linearRampToValueAtTime(1, now + 3.8);
      incomingAudio.volume = 1;
    } else this.reset(incomingAudio, 1);
    this.transition = null;
  }

  dispose() {
    this.cancelTransition();
    if (this.context && this.context.state !== "closed") this.context.close().catch(() => {});
    this.context = null;
    this.compressor = null;
  }
}
