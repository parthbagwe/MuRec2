"""Build a public, resumable CLAP index from permitted catalogue previews.

Only derived vectors are published. Raw audio and model weights remain local.
Run: .venv/Scripts/python scripts/index_music_ai.py --limit 240
Use --limit 0 for the entire catalogue. Cached successes are reused on every run.
"""
import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time

import imageio_ffmpeg
import numpy as np
import requests
import torch
import transformers
from transformers import ClapModel, ClapProcessor

ROOT = Path(__file__).resolve().parents[1]
MODEL = "laion/clap-htsat-unfused"
REVISION = "8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a"
CACHE = ROOT / ".cache/music-ai"
SESSIONS = threading.local()
LABELS = {
    "joyful": "The music sounds joyful, cheerful, bright and uplifting.",
    "melancholic": "The music sounds sad, melancholic, wistful and sorrowful.",
    "aggressive": "The music sounds aggressive, heavy, intense and confrontational.",
    "relaxed": "The music sounds calm, relaxed, gentle and peaceful.",
    "danceable": "The music sounds danceable, bouncy, rhythmic and energetic.",
    "dreamy": "The music sounds dreamy, atmospheric, spacious and ethereal.",
    "romantic": "The music sounds romantic, intimate, tender and warm.",
    "dark": "The music sounds dark, brooding, tense and ominous.",
}
SEEDS = ["blinding lights", "one love", "nenjukkul peidhidum", "kesariya", "duality",
         "tum se hi", "modern jam", "god's plan", "beikhayali", "lazarus"]


def catalogue():
    manifest = json.loads((ROOT / "frontend/public/catalogue/manifest.json").read_text())
    return json.loads(gzip.decompress((ROOT / "frontend/public" / manifest["file"].lstrip("/")).read_bytes()))


def select_tracks(data, limit, candidate_ids=()):
    """Cover seed neighbourhoods and the remaining genre families deterministically."""
    tracks = {t["track_id"]: t for t in data["tracks"] if t.get("preview_url")}
    rows = [r for r in data["fingerprints"] if r["track_id"] in tracks]
    picked = {}
    for track_id in candidate_ids:
        if track_id in tracks:
            picked[track_id] = tracks[track_id]
    for seed in SEEDS:
        anchors = [r for r in rows if tracks[r["track_id"]]["title"].lower() == seed]
        for anchor in anchors[:1]:
            picked[anchor["track_id"]] = tracks[anchor["track_id"]]
            # Acoustic neighbours give the first release meaningful comparable pairs.
            av = np.asarray(anchor["vector"], dtype=np.float32)
            neighbours = sorted(rows, key=lambda r: np.linalg.norm(np.asarray(r["vector"]) - av))
            for row in neighbours[:14]:
                picked.setdefault(row["track_id"], tracks[row["track_id"]])
    groups = {}
    for track in sorted(tracks.values(), key=lambda t: hashlib.sha256(t["track_id"].encode()).hexdigest()):
        groups.setdefault(track.get("provider_genre") or "Other", []).append(track)
    for index in range(max(map(len, groups.values()), default=0)):
        for group in groups.values():
            if index < len(group):
                track = group[index]
                picked.setdefault(track["track_id"], track)
    chosen = list(picked.values())
    return chosen[:limit] if limit else chosen


def load_preview(track):
    """Decode at most 30s and remove the temporary source immediately afterwards."""
    url = track["preview_url"]
    if not url.startswith("https://audio-ssl.itunes.apple.com/"):
        raise ValueError("Only the catalogue's permitted preview host is accepted")
    if not hasattr(SESSIONS, 'client'):
        SESSIONS.client = requests.Session()
    with SESSIONS.client.get(url, timeout=(10, 30), stream=True) as response:
        response.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as temp:
            path = Path(temp.name)
            try:
                size = 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 12_000_000:
                        raise ValueError("Preview exceeds the download bound")
                    temp.write(chunk)
            except Exception:
                temp.close()
                path.unlink(missing_ok=True)
                raise
    try:
        decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path),
                                  "-t", "30", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"],
                                 check=True, capture_output=True, timeout=40)
        audio = np.frombuffer(decoded.stdout, dtype="<f4").copy()
        if len(audio) < 48000 or not np.isfinite(audio).all():
            raise ValueError("Preview is empty, too short or invalid")
        return audio
    finally:
        path.unlink(missing_ok=True)


def run(limit, threads, candidate_ids):
    CACHE.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(threads)
    torch.manual_seed(0)
    data = catalogue()
    prioritized = json.loads(candidate_ids.read_text()) if candidate_ids else []
    chosen = select_tracks(data, limit, prioritized)
    print(f"Loading {MODEL}@{REVISION}; {len(chosen)} previews selected", flush=True)
    local_model = CACHE / 'model' / REVISION
    source = str(local_model) if (local_model / 'pytorch_model.bin').exists() else MODEL
    processor = ClapProcessor.from_pretrained(source, revision=REVISION)
    model = ClapModel.from_pretrained(source, revision=REVISION).eval()
    with torch.inference_mode():
        text = model.get_text_features(**processor(text=list(LABELS.values()), padding=True, return_tensors="pt"))
        text = torch.nn.functional.normalize(text, dim=-1)
        probes = model.get_text_features(**processor(text=['A dog barking loudly.', 'A piano playing a sad melody.',
            'Electronic dance music with a fast beat.', 'Heavy metal music with distorted electric guitars.'], padding=True, return_tensors='pt'))
        probes = torch.nn.functional.normalize(probes, dim=-1)
        similarities = probes @ probes.T
        mean_off_diagonal = similarities[~torch.eye(4, dtype=torch.bool)].mean().item()
        if mean_off_diagonal > 0.95:
            raise RuntimeError('Text embeddings are collapsed; refusing to publish an unreliable model index')
        print(f'Model sanity check passed: distinct-prompt mean cosine {mean_off_diagonal:.3f}', flush=True)
    rows, failures = [], []
    started = time.monotonic()

    def prepare(track):
        digest = hashlib.sha256((MODEL + REVISION + track["preview_url"] + json.dumps(LABELS, sort_keys=True) + "windows-3x10-v1").encode()).hexdigest()
        saved = CACHE / f"{digest}.json"
        if saved.exists():
            return track, saved, json.loads(saved.read_text()), None
        try:
            return track, saved, None, load_preview(track)
        except Exception as error:
            return track, saved, None, error

    # Download ahead without running unbounded inference or retaining audio on disk.
    def prepared(pool):
        source = iter(chosen)
        pending = deque(pool.submit(prepare, track) for track in list(chosen)[:6])
        for _ in range(min(6, len(chosen))):
            next(source)
        while pending:
            result = pending.popleft().result()
            following = next(source, None)
            if following is not None:
                pending.append(pool.submit(prepare, following))
            yield result

    with ThreadPoolExecutor(max_workers=6) as pool:
        for index, (track, saved, cached, audio) in enumerate(prepared(pool), 1):
            try:
                if isinstance(audio, Exception):
                    raise audio
                if cached is None:
                    window = 480000
                    windows = [audio[start:start + window] for start in (0, 480000, 960000) if len(audio[start:start + window]) >= 48000]
                    vectors = []
                    with torch.inference_mode():
                        for samples in windows:
                            features = processor(audio=samples, sampling_rate=48000, return_tensors="pt")
                            vector = model.get_audio_features(**features)
                            vectors.append(torch.nn.functional.normalize(vector, dim=-1)[0])
                        vector = torch.nn.functional.normalize(torch.stack(vectors).mean(dim=0), dim=-1)
                        moods = vector @ text.T
                    cached = {"track_id": track["track_id"], "embedding": np.rint(vector.numpy() * 127).astype(int).tolist(),
                              "mood_scores": [round(float(x), 5) for x in moods],
                              "preview_seconds": round(min(len(audio) / 48000, 30), 3),
                              "source_preview_sha256": hashlib.sha256(track["preview_url"].encode()).hexdigest()}
                    saved.write_text(json.dumps(cached, separators=(",", ":")))
                rows.append(cached)
                print(f"[{index}/{len(chosen)}] {track['title']} | {track['artist']} ({time.monotonic() - started:.1f}s)", flush=True)
            except Exception as error:
                failures.append({"track_id": track["track_id"], "error": str(error)[:160]})
                print(f"[{index}/{len(chosen)}] unavailable {track['track_id']}: {type(error).__name__}", flush=True)
    if not rows:
        raise RuntimeError("No preview could be indexed; nothing was published")
    payload = {"schema": 1, "model": MODEL, "revision": REVISION, "dimensions": 512, "quantization": 127,
               "runtime": {"torch": torch.__version__, "transformers": transformers.__version__},
               "labels": list(LABELS), "prompts": LABELS, "tracks": rows}
    compressed = gzip.compress(json.dumps(payload, separators=(",", ":")).encode(), mtime=0)
    version = hashlib.sha256(compressed).hexdigest()[:16]
    target = ROOT / "frontend/public/intelligence"
    target.mkdir(parents=True, exist_ok=True)
    filename = f"index-{version}.bin"
    (target / filename).write_bytes(compressed)
    manifest = {"schema": 1, "version": version, "model": MODEL, "revision": REVISION,
                "file": f"/intelligence/{filename}", "bytes": len(compressed), "indexed": len(rows),
                "total": len(data["tracks"]), "preview_limit_seconds": 30, "window_seconds": 10,
                "updated_at": datetime.now(timezone.utc).isoformat(), "failed": len(failures),
                "mood_method": "Zero-shot audio/text similarity; predictions, not measured emotion or calibrated probabilities",
                "license": "Apache-2.0 (model card)", "fallback": "measured acoustic fingerprints"}
    manifest['sanity_check'] = {"distinct_text_mean_cosine": round(mean_off_diagonal, 5), "collapsed_embeddings_rejected": True}
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (CACHE / "failures.json").write_text(json.dumps(failures, indent=2))
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=240)
    parser.add_argument("--threads", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--candidate-ids", type=Path, help="Public baseline IDs from frontend/scripts/select-ai-candidates.mjs")
    args = parser.parse_args()
    if args.limit < 0 or args.threads < 1:
        parser.error("limit must be nonnegative and threads must be positive")
    run(args.limit, args.threads, args.candidate_ids)
