"""Transient feature extraction for an uploaded, previously unknown song."""

from pathlib import Path

import librosa
import numpy as np

from src.config import AUDIO_FEATURE_COLUMNS

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CHROMA_NAMES = ["c", "cs", "d", "ds", "e", "f", "fs", "g", "gs", "a", "as", "b"]


def analyze_audio(path: Path) -> tuple[np.ndarray, dict]:
    """Return the model's raw 35-feature vector and a readable acoustic profile."""
    y, sample_rate = librosa.load(path, sr=22_050, mono=True, duration=45)
    if y.size < sample_rate:
        raise ValueError("The audio must contain at least one second of sound")

    y, _ = librosa.effects.trim(y, top_db=35)
    if y.size < sample_rate:
        raise ValueError("The audio is silent or too short to analyze")

    magnitude = np.abs(librosa.stft(y))
    onset = librosa.onset.onset_strength(y=y, sr=sample_rate)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sample_rate)
    bpm = float(np.asarray(tempo).reshape(-1)[0])
    centroid = float(librosa.feature.spectral_centroid(S=magnitude, sr=sample_rate).mean())
    rolloff = float(librosa.feature.spectral_rolloff(S=magnitude, sr=sample_rate).mean())
    rms = float(librosa.feature.rms(S=magnitude).mean())
    zcr = float(librosa.feature.zero_crossing_rate(y).mean())
    mfcc = librosa.feature.mfcc(y=y, sr=sample_rate, n_mfcc=13).mean(axis=1)
    chroma = librosa.feature.chroma_stft(S=magnitude, sr=sample_rate).mean(axis=1)
    chroma = chroma / max(float(chroma.sum()), 1e-10)

    normalized = magnitude / np.maximum(magnitude.sum(axis=0, keepdims=True), 1e-10)
    spectral_flux = float(np.sqrt(np.square(np.diff(normalized, axis=1)).sum(axis=0)).mean())
    duration = len(y) / sample_rate
    expected_beats = max(bpm * duration / 60, 1)
    tempo_confidence = float(np.clip(len(beat_frames) / expected_beats, 0, 1))

    major_score = max(sum(chroma[(root + interval) % 12] for interval in (0, 4, 7)) for root in range(12))
    minor_score = max(sum(chroma[(root + interval) % 12] for interval in (0, 3, 7)) for root in range(12))
    valence = float(np.clip(0.35 + 0.4 * major_score / max(major_score + minor_score, 1e-10), 0, 1))
    energy = float(np.clip(rms * 400, 0, 100))
    brightness = float(np.clip(centroid / 5000, 0, 1))

    if zcr > .16:
        timbre = "percussive"
    elif centroid > 3000:
        timbre = "bright"
    elif centroid < 1300:
        timbre = "warm"
    elif rms > .22:
        timbre = "punchy"
    else:
        timbre = "balanced"

    features = {
        "bpm": bpm,
        "energy": energy,
        "valence": valence,
        "brightness": brightness,
        "spectral_centroid_hz": centroid,
        "spectral_rolloff_hz": rolloff,
        "spectral_flux": spectral_flux,
        "rms_energy": rms,
        "zero_crossing_rate": zcr,
        "tempo_confidence": tempo_confidence,
        **{f"mfcc_{index + 1}": float(value) for index, value in enumerate(mfcc)},
        **{f"chroma_{name}": float(value) for name, value in zip(CHROMA_NAMES, chroma)},
    }
    vector = np.array([features[name] for name in AUDIO_FEATURE_COLUMNS], dtype=float)
    key_index = int(np.argmax(chroma))
    profile = {
        "bpm": round(bpm, 1),
        "energy": round(energy, 1),
        "brightness": round(brightness, 3),
        "spectral_centroid_hz": round(centroid, 1),
        "spectral_rolloff_hz": round(rolloff, 1),
        "zero_crossing_rate": round(zcr, 4),
        "key": KEY_NAMES[key_index],
        "timbre": timbre,
    }
    return vector, profile
