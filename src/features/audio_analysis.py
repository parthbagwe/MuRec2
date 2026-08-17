"""Transient feature extraction for an uploaded, previously unknown song."""

from pathlib import Path
import math
import subprocess
import tempfile

import imageio_ffmpeg
import librosa
import numpy as np

from src.config import AUDIO_FEATURE_COLUMNS

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CHROMA_NAMES = ["c", "cs", "d", "ds", "e", "f", "fs", "g", "gs", "a", "as", "b"]


def _load_audio(path: Path) -> tuple[np.ndarray, int]:
    """Decode common formats, falling back to the bundled FFmpeg binary for M4A/AAC."""
    original_error: Exception | None = None
    if path.suffix.lower() not in {".m4a", ".aac"}:
        try:
            return librosa.load(path, sr=22_050, mono=True, duration=45)
        except Exception as error:
            original_error = error
    try:
        converted_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as converted:
                converted_path = Path(converted.name)
            subprocess.run(
                [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-i", str(path),
                 "-t", "45", "-ac", "1", "-ar", "22050", str(converted_path)],
                check=True, capture_output=True, timeout=90,
            )
            return librosa.load(converted_path, sr=22_050, mono=True, duration=45)
        except Exception as decoder_error:
            raise ValueError(f"This audio format could not be decoded: {decoder_error}") from original_error
        finally:
            if converted_path is not None:
                converted_path.unlink(missing_ok=True)
    except ValueError:
        raise


def analyze_audio(path: Path) -> tuple[np.ndarray, dict]:
    """Return a raw feature vector and MuRec2's provider-neutral acoustic profile."""
    y, sample_rate = _load_audio(path)
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
    frame_rms = librosa.feature.rms(S=magnitude)[0]
    zcr = float(librosa.feature.zero_crossing_rate(y).mean())
    flatness = float(librosa.feature.spectral_flatness(S=magnitude).mean())
    contrast = float(librosa.feature.spectral_contrast(S=magnitude, sr=sample_rate).mean())
    mfcc = librosa.feature.mfcc(y=y, sr=sample_rate, n_mfcc=13).mean(axis=1)
    chroma = librosa.feature.chroma_stft(S=magnitude, sr=sample_rate).mean(axis=1)
    chroma = chroma / max(float(chroma.sum()), 1e-10)

    normalized = magnitude / np.maximum(magnitude.sum(axis=0, keepdims=True), 1e-10)
    spectral_flux = float(np.sqrt(np.square(np.diff(normalized, axis=1)).sum(axis=0)).mean())
    duration = len(y) / sample_rate
    expected_beats = max(bpm * duration / 60, 1)
    tempo_confidence = float(np.clip(len(beat_frames) / expected_beats, 0, 1))
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset, sr=sample_rate)
    onset_density = float(len(onset_frames) / max(duration, 1))
    if len(beat_frames) > 2:
        beat_intervals = np.diff(librosa.frames_to_time(beat_frames, sr=sample_rate))
        beat_regularity = float(np.clip(1 - np.std(beat_intervals) / max(np.mean(beat_intervals), 1e-6), 0, 1))
    else:
        beat_regularity = 0.0

    harmonic, percussive = librosa.effects.hpss(y)
    harmonic_rms = float(np.sqrt(np.mean(np.square(harmonic))))
    percussive_rms = float(np.sqrt(np.mean(np.square(percussive))))
    component_total = max(harmonic_rms + percussive_rms, 1e-10)
    harmonic_ratio = harmonic_rms / component_total
    percussive_ratio = percussive_rms / component_total
    dynamic_range = float(np.clip((np.percentile(frame_rms, 90) - np.percentile(frame_rms, 10)) * 8, 0, 1))

    major_score = max(sum(chroma[(root + interval) % 12] for interval in (0, 4, 7)) for root in range(12))
    minor_score = max(sum(chroma[(root + interval) % 12] for interval in (0, 3, 7)) for root in range(12))
    valence = float(np.clip(0.35 + 0.4 * major_score / max(major_score + minor_score, 1e-10), 0, 1))
    energy = float(np.clip(rms * 400, 0, 100))
    brightness = float(np.clip(centroid / 5000, 0, 1))
    chroma_entropy = float(-np.sum(chroma * np.log(chroma + 1e-10)) / np.log(12))
    tonal_strength = float(np.clip((float(chroma.max()) - (1 / 12)) / .10, 0, 1))
    tempo_fit = math.exp(-abs(bpm - 118) / 48)
    danceability = float(np.clip(.35 * tempo_fit + .30 * beat_regularity + .20 * percussive_ratio + .15 * tempo_confidence, 0, 1))
    aggression = float(np.clip(.30 * min(rms * 5, 1) + .25 * min(zcr / .18, 1) + .25 * brightness + .20 * percussive_ratio, 0, 1))

    if flatness > .18 or (zcr > .14 and aggression > .58):
        texture = "noisy-distorted"
    elif percussive_ratio > .56 and brightness > .42:
        texture = "bright-percussive"
    elif harmonic_ratio > .64 and brightness < .38:
        texture = "warm-harmonic"
    elif rms < .08 and brightness > .35:
        texture = "airy-sparse"
    else:
        texture = "dense-balanced"

    if bpm < 70:
        tempo_band = "slow-drift"
    elif bpm < 96:
        tempo_band = "measured-groove"
    elif bpm < 126:
        tempo_band = "mid-pulse"
    elif bpm < 156:
        tempo_band = "fast-drive"
    else:
        tempo_band = "high-velocity"

    if aggression > .72:
        intensity = "ferocious"
    elif energy > 55 or aggression > .55:
        intensity = "driving"
    elif energy > 28:
        intensity = "restrained"
    else:
        intensity = "low-intensity"

    if onset_density > 3.6 and percussive_ratio > .48:
        rhythm_character = "rhythm-forward"
    elif beat_regularity > .72:
        rhythm_character = "steady-pulse"
    elif onset_density < 1.2:
        rhythm_character = "sparse-rhythm"
    else:
        rhythm_character = "loose-flow"

    mode_name = "major" if major_score >= minor_score else "minor"
    if tonal_strength < .16:
        harmonic_character = "tonally-ambiguous"
    elif mode_name == "minor" and valence < .57:
        harmonic_character = "dark-minor"
    elif mode_name == "major":
        harmonic_character = "bright-major"
    else:
        harmonic_character = "harmonically-rich"

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
        "tempo_confidence": round(tempo_confidence, 3),
        "spectral_flatness": round(flatness, 4),
        "spectral_contrast": round(contrast, 3),
        "onset_density": round(onset_density, 3),
        "beat_regularity": round(beat_regularity, 3),
        "dynamic_range": round(dynamic_range, 3),
        "harmonic_ratio": round(harmonic_ratio, 3),
        "percussive_ratio": round(percussive_ratio, 3),
        "tonal_strength": round(tonal_strength, 3),
        "danceability": round(danceability, 3),
        "aggression": round(aggression, 3),
        "key": KEY_NAMES[key_index],
        "mode": mode_name,
        "timbre": texture,
        "tempo_band": tempo_band,
        "intensity": intensity,
        "texture": texture,
        "rhythm_character": rhythm_character,
        "harmonic_character": harmonic_character,
        "acoustic_signature": " · ".join((intensity, texture, rhythm_character, harmonic_character, tempo_band)),
    }
    return vector, profile
