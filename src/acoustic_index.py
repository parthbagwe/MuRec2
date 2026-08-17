"""Provider-neutral acoustic fingerprint index built from transient audio analysis."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
import json
import math
from pathlib import Path
import sqlite3
import tempfile
import threading
import time

import numpy as np
import pandas as pd
import requests

from src.config import ROOT_DIR
from src.features.audio_analysis import analyze_audio
from src import supabase_store

INDEX_PATH = ROOT_DIR / "data" / "acoustic-fingerprints.db"
MAX_PREVIEW_BYTES = 15 * 1024 * 1024
MODE_WEIGHTS = {
    "similar": (0.35, 0.40, 0.25),
    "rhythm": (0.65, 0.20, 0.15),
    "timbre": (0.15, 0.70, 0.15),
    "discover": (0.35, 0.40, 0.25),
    "personalized": (0.35, 0.40, 0.25),
}


class AcousticIndex:
    def __init__(self, path: Path = INDEX_PATH):
        self.path = path
        self._build_lock = threading.Lock()
        self._building = False
        self._worker: threading.Thread | None = None
        self.init()

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def init(self) -> None:
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS fingerprints (
                    track_id TEXT PRIMARY KEY,
                    vector_json TEXT NOT NULL,
                    profile_json TEXT NOT NULL,
                    acoustic_signature TEXT NOT NULL,
                    analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS failures (
                    track_id TEXT PRIMARY KEY,
                    attempts INTEGER NOT NULL DEFAULT 1,
                    last_error TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)

    def get(self, track_id: str) -> dict | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT track_id,vector_json,profile_json,acoustic_signature FROM fingerprints WHERE track_id=?",
                (str(track_id),),
            ).fetchone()
        if not row:
            return None
        return {
            "track_id": row["track_id"],
            "vector": np.asarray(json.loads(row["vector_json"]), dtype=float),
            "profile": json.loads(row["profile_json"]),
            "acoustic_signature": row["acoustic_signature"],
        }

    def all(self) -> dict[str, dict]:
        with self.connection() as db:
            rows = db.execute(
                "SELECT track_id,vector_json,profile_json,acoustic_signature FROM fingerprints"
            ).fetchall()
        return {
            row["track_id"]: {
                "track_id": row["track_id"],
                "vector": np.asarray(json.loads(row["vector_json"]), dtype=float),
                "profile": json.loads(row["profile_json"]),
                "acoustic_signature": row["acoustic_signature"],
            }
            for row in rows
        }

    def put(self, track_id: str, vector: np.ndarray, profile: dict) -> dict:
        signature = profile["acoustic_signature"]
        with self.connection() as db:
            db.execute("""
                INSERT INTO fingerprints(track_id,vector_json,profile_json,acoustic_signature)
                VALUES(?,?,?,?)
                ON CONFLICT(track_id) DO UPDATE SET
                  vector_json=excluded.vector_json, profile_json=excluded.profile_json,
                  acoustic_signature=excluded.acoustic_signature, analyzed_at=CURRENT_TIMESTAMP
            """, (str(track_id), json.dumps(vector.tolist()), json.dumps(profile), signature))
            db.execute("DELETE FROM failures WHERE track_id=?", (str(track_id),))
        try:
            supabase_store.sync_fingerprint(str(track_id), vector.tolist(), profile, signature)
        except (requests.RequestException, supabase_store.SupabaseStoreError) as error:
            print(f"Supabase fingerprint sync warning: {error}")
        return {"track_id": str(track_id), "vector": vector, "profile": profile, "acoustic_signature": signature}

    def record_failure(self, track_id: str, error: Exception) -> None:
        with self.connection() as db:
            db.execute("""
                INSERT INTO failures(track_id,last_error) VALUES(?,?)
                ON CONFLICT(track_id) DO UPDATE SET attempts=attempts+1,
                  last_error=excluded.last_error, updated_at=CURRENT_TIMESTAMP
            """, (str(track_id), str(error)[:400]))

    def _download_and_analyze(self, track: dict) -> dict:
        existing = self.get(str(track["track_id"]))
        if existing:
            return existing
        preview_url = str(track.get("preview_url") or "")
        if not preview_url.startswith("https://"):
            raise ValueError("No analyzable preview audio is available")
        temporary_path: Path | None = None
        try:
            response = None
            last_network_error: Exception | None = None
            for attempt in range(4):
                try:
                    response = requests.get(
                        preview_url, stream=True, timeout=(8, 25),
                        headers={"User-Agent": "MuRec2/2.0 acoustic fingerprint index"},
                    )
                    response.raise_for_status()
                    break
                except requests.RequestException as error:
                    last_network_error = error
                    if response is not None:
                        response.close()
                    if attempt < 3:
                        time.sleep(.6 * (2 ** attempt))
            if response is None or last_network_error is not None and not response.ok:
                raise last_network_error or ValueError("Preview audio request failed")
            with response:
                with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as temporary:
                    temporary_path = Path(temporary.name)
                    total = 0
                    for chunk in response.iter_content(64 * 1024):
                        total += len(chunk)
                        if total > MAX_PREVIEW_BYTES:
                            raise ValueError("Preview audio exceeds the analysis limit")
                        temporary.write(chunk)
            vector, profile = analyze_audio(temporary_path)
            return self.put(str(track["track_id"]), vector, profile)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def fingerprint_track(self, track: dict) -> dict:
        try:
            return self._download_and_analyze(track)
        except Exception as error:
            self.record_failure(str(track.get("track_id", "unknown")), error)
            raise

    def fingerprint_file(self, track_id: str, path: Path) -> dict:
        vector, profile = analyze_audio(path)
        return self.put(track_id, vector, profile)

    def status(self, total_tracks: int) -> dict:
        with self.connection() as db:
            indexed = int(db.execute("SELECT COUNT(*) FROM fingerprints").fetchone()[0])
            failures = int(db.execute("SELECT COUNT(*) FROM failures").fetchone()[0])
        return {
            "indexed": indexed,
            "total": int(total_tracks),
            "remaining": max(0, int(total_tracks) - indexed),
            "failures": failures,
            "building": self._building,
        }

    def build(self, catalog: pd.DataFrame, limit: int | None = None, workers: int = 3) -> dict:
        if not self._build_lock.acquire(blocking=False):
            return self.status(len(catalog))
        self._building = True
        try:
            indexed_ids = set(self.all())
            candidates = [
                row for row in catalog.sample(frac=1, random_state=42).to_dict("records")
                if str(row.get("track_id")) not in indexed_ids and str(row.get("preview_url") or "").startswith("https://")
            ]
            if limit is not None:
                candidates = candidates[:limit]
            with ThreadPoolExecutor(max_workers=max(1, min(workers, 6))) as pool:
                futures = {pool.submit(self.fingerprint_track, track): track for track in candidates}
                for future in as_completed(futures):
                    try:
                        future.result()
                    except Exception:
                        pass
                    time.sleep(.04)
            return self.status(len(catalog))
        finally:
            self._building = False
            self._build_lock.release()

    def ensure_minimum(self, catalog: pd.DataFrame, minimum: int = 18) -> None:
        current = self.status(len(catalog))["indexed"]
        if current < minimum:
            self.build(catalog, limit=minimum - current, workers=3)

    def start_background_build(self, catalog: pd.DataFrame) -> None:
        if self._worker and self._worker.is_alive():
            return
        self._worker = threading.Thread(
            target=self.build, args=(catalog,), kwargs={"workers": 2}, daemon=True,
            name="murec2-acoustic-indexer",
        )
        self._worker.start()

    @staticmethod
    def _bounded_similarity(first: np.ndarray, second: np.ndarray, scales: np.ndarray, sharpness: float = 2.4) -> float:
        difference = np.abs(first - second) / scales
        return float(np.clip(math.exp(-sharpness * float(np.mean(difference))), 0, 1))

    @classmethod
    def components(cls, first: dict, second: dict) -> tuple[float, float, float]:
        a, b = first["profile"], second["profile"]
        rhythm_a = np.array([a["bpm"], a["tempo_confidence"] if "tempo_confidence" in a else .5, a["onset_density"], a["beat_regularity"], a["percussive_ratio"], a["danceability"]])
        rhythm_b = np.array([b["bpm"], b["tempo_confidence"] if "tempo_confidence" in b else .5, b["onset_density"], b["beat_regularity"], b["percussive_ratio"], b["danceability"]])
        rhythm = cls._bounded_similarity(rhythm_a, rhythm_b, np.array([70, 1, 5, 1, 1, 1]), 2.2)

        mfcc_scales = np.array([180, 90, 70, 60, 55, 50, 45, 42, 40, 38, 36, 34, 32])
        mfcc_a, mfcc_b = first["vector"][10:23], second["vector"][10:23]
        profile_a = np.array([a["brightness"], a["spectral_flatness"], a["spectral_contrast"], a["zero_crossing_rate"], a["harmonic_ratio"], a["aggression"], a["dynamic_range"]])
        profile_b = np.array([b["brightness"], b["spectral_flatness"], b["spectral_contrast"], b["zero_crossing_rate"], b["harmonic_ratio"], b["aggression"], b["dynamic_range"]])
        timbre_mfcc = cls._bounded_similarity(mfcc_a, mfcc_b, mfcc_scales, 1.8)
        timbre_profile = cls._bounded_similarity(profile_a, profile_b, np.array([1, .35, 35, .25, 1, 1, 1]), 2.2)
        timbre = .55 * timbre_mfcc + .45 * timbre_profile

        chroma_a, chroma_b = first["vector"][23:35], second["vector"][23:35]
        chroma_norm = max(float(np.linalg.norm(chroma_a) * np.linalg.norm(chroma_b)), 1e-10)
        chroma_similarity = max(float(np.dot(chroma_a, np.roll(chroma_b, shift)) / chroma_norm) for shift in range(12))
        harmonic_profile = cls._bounded_similarity(
            np.array([a["tonal_strength"], a["harmonic_ratio"], first["vector"][2]]),
            np.array([b["tonal_strength"], b["harmonic_ratio"], second["vector"][2]]),
            np.array([1, 1, 1]), 1.7,
        )
        harmony = float(np.clip(.65 * chroma_similarity + .35 * harmonic_profile, 0, 1))
        return rhythm, timbre, harmony

    def recommendations(
        self, anchor: dict, catalog: pd.DataFrame, k: int = 12, mode: str = "similar",
        seen_track_ids: set[str] | None = None, favorite_track_ids: set[str] | None = None,
    ) -> list[dict]:
        indexed = self.all()
        rows = {str(row["track_id"]): row for row in catalog.to_dict("records")}
        anchor_id = str(anchor["track_id"])
        anchor_fp = indexed.get(anchor_id)
        if anchor_fp is None:
            anchor_fp = self.fingerprint_track(anchor)
            indexed[anchor_id] = anchor_fp
        favorites = [indexed[track_id] for track_id in (favorite_track_ids or set()) if track_id in indexed]
        weights = MODE_WEIGHTS.get(mode, MODE_WEIGHTS["similar"])
        seen = seen_track_ids or set()
        scored = []
        for track_id, candidate_fp in indexed.items():
            if track_id == anchor_id or track_id not in rows:
                continue
            row = rows[track_id]
            if str(row.get("title", "")).casefold() == str(anchor.get("title", "")).casefold() and str(row.get("artist", "")).casefold() == str(anchor.get("artist", "")).casefold():
                continue
            rhythm, timbre, harmony = self.components(anchor_fp, candidate_fp)
            if mode == "personalized" and favorites:
                favorite_components = [self.components(favorite, candidate_fp) for favorite in favorites]
                taste = tuple(max(parts[index] for parts in favorite_components) for index in range(3))
                rhythm, timbre, harmony = tuple(.40 * anchor_part + .60 * taste_part for anchor_part, taste_part in zip((rhythm, timbre, harmony), taste))
            base = weights[0] * rhythm + weights[1] * timbre + weights[2] * harmony
            if mode == "discover":
                total = max(0.0, 1 - abs(base - .68) / .68)
                if track_id in seen:
                    total *= .45
            else:
                total = base * (.82 if track_id in seen else 1.0)
            signature = candidate_fp["acoustic_signature"]
            scored.append({
                "track_id": track_id, "title": row["title"], "artist": row["artist"],
                "genre": "MuRec2 acoustic", "subgenre": signature,
                "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                "album": row.get("album"), "artwork_url": row.get("artwork_url"),
                "preview_url": row.get("preview_url"), "external_url": row.get("external_url"),
                "source": row.get("source") or "Catalogue", "audio_similarity": round(rhythm, 4),
                "lyric_similarity": round(timbre, 4), "collab_similarity": round(harmony, 4),
                "hybrid_score": round(float(np.clip(total, 0, 1)), 4),
                "score_mode": f"acoustic-fingerprint-{mode}",
            })
        unique, recordings = [], set()
        for item in sorted(scored, key=lambda value: value["hybrid_score"], reverse=True):
            key = (item["title"].casefold().strip(), item["artist"].casefold().strip())
            if key in recordings:
                continue
            recordings.add(key)
            unique.append(item)
            if len(unique) >= k:
                break
        return unique
