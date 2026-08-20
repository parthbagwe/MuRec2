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
from src.subgenres import subgenre_similarity

INDEX_PATH = ROOT_DIR / "data" / "acoustic-fingerprints.db"
MAX_PREVIEW_BYTES = 15 * 1024 * 1024
MODE_WEIGHTS = {
    "similar": (0.35, 0.40, 0.25),
    "rhythm": (0.65, 0.20, 0.15),
    "timbre": (0.15, 0.70, 0.15),
    "discover": (0.35, 0.40, 0.25),
    "personalized": (0.35, 0.40, 0.25),
    "transition": (0.42, 0.25, 0.33),
}
KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


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

    @staticmethod
    def transition_tempo_difference(first_bpm: float, second_bpm: float) -> float:
        return min(
            abs(first_bpm - second_bpm),
            abs(first_bpm - second_bpm * 2),
            abs(first_bpm * 2 - second_bpm),
        )

    @staticmethod
    def key_compatibility(first: dict, second: dict) -> float:
        try:
            first_key = KEY_NAMES.index(str(first["profile"].get("key", "")))
            second_key = KEY_NAMES.index(str(second["profile"].get("key", "")))
        except ValueError:
            return .45
        first_mode = str(first["profile"].get("mode", ""))
        second_mode = str(second["profile"].get("mode", ""))
        interval = (second_key - first_key) % 12
        if interval == 0 and first_mode == second_mode:
            return 1.0
        if first_mode == "major" and second_mode == "minor" and interval == 9:
            return .98
        if first_mode == "minor" and second_mode == "major" and interval == 3:
            return .98
        if first_mode == second_mode and interval in {5, 7}:
            return .92
        if interval == 0:
            return .84
        if first_mode == second_mode and interval in {2, 10}:
            return .72
        return .30

    @classmethod
    def transition_metrics(
        cls, previous: dict, candidate: dict, anchor: dict,
        previous_row: dict, candidate_row: dict, anchor_row: dict,
    ) -> dict:
        previous_profile, candidate_profile = previous["profile"], candidate["profile"]
        tempo_difference = cls.transition_tempo_difference(previous_profile["bpm"], candidate_profile["bpm"])
        tempo = math.exp(-tempo_difference / 12)
        chroma_a, chroma_b = np.asarray(previous["vector"][23:35]), np.asarray(candidate["vector"][23:35])
        chroma_direct = max(0.0, float(np.dot(chroma_a, chroma_b) / max(np.linalg.norm(chroma_a) * np.linalg.norm(chroma_b), 1e-10)))
        key = cls.key_compatibility(previous, candidate)
        harmony = float(np.clip(.72 * key + .28 * chroma_direct, 0, 1))
        _, timbre, _ = cls.components(previous, candidate)
        energy = cls._bounded_similarity(
            np.array([previous_profile["energy"], previous_profile["aggression"], previous_profile["dynamic_range"], previous_profile["danceability"]]),
            np.array([candidate_profile["energy"], candidate_profile["aggression"], candidate_profile["dynamic_range"], candidate_profile["danceability"]]),
            np.array([55, 1, 1, 1]), 1.7,
        )
        current_style = subgenre_similarity(previous_row.get("subgenre", ""), candidate_row.get("subgenre", ""))
        anchor_style = subgenre_similarity(anchor_row.get("subgenre", ""), candidate_row.get("subgenre", ""))
        base = .36 * tempo + .30 * harmony + .20 * timbre + .14 * energy
        score = float(np.clip(base * (.78 + .22 * current_style) * (.90 + .10 * anchor_style), 0, 1))
        reasons = []
        if tempo_difference <= 5:
            reasons.append(f"{round(previous_profile['bpm'])}→{round(candidate_profile['bpm'])} BPM")
        if key >= .90:
            reasons.append(f"{previous_profile['key']} {previous_profile['mode']}→{candidate_profile['key']} {candidate_profile['mode']}")
        if energy >= .88:
            reasons.append("steady energy handoff")
        if timbre >= .86:
            reasons.append("matched texture")
        if not reasons:
            reasons.append("balanced tempo and tone")
        return {
            "parts": (tempo, timbre, harmony), "score": score, "reasons": reasons[:3],
            "note": f"{round(previous_profile['bpm'])}→{round(candidate_profile['bpm'])} BPM · {previous_profile['key']} {previous_profile['mode']}→{candidate_profile['key']} {candidate_profile['mode']}",
        }

    @classmethod
    def transition_recommendations(
        cls, anchor: dict, anchor_fp: dict, indexed: dict, rows: dict, k: int,
    ) -> list[dict]:
        anchor_id = str(anchor["track_id"])
        used_ids = {anchor_id}
        used_recordings = {(str(anchor.get("title", "")).casefold().strip(), str(anchor.get("artist", "")).casefold().strip())}
        used_artists = {str(anchor.get("artist", "")).casefold().strip()}
        chain = []
        previous_fp, previous_row = anchor_fp, anchor
        for step in range(1, k + 1):
            shortlist = []
            for track_id, candidate_fp in indexed.items():
                if track_id in used_ids or track_id not in rows:
                    continue
                row = rows[track_id]
                recording_key = (str(row.get("title", "")).casefold().strip(), str(row.get("artist", "")).casefold().strip())
                preview_url = row.get("preview_url")
                if recording_key in used_recordings or not isinstance(preview_url, str) or not preview_url.strip():
                    continue
                tempo = math.exp(-cls.transition_tempo_difference(previous_fp["profile"]["bpm"], candidate_fp["profile"]["bpm"]) / 12)
                key = cls.key_compatibility(previous_fp, candidate_fp)
                style = subgenre_similarity(previous_row.get("subgenre", ""), row.get("subgenre", ""))
                shortlist.append((.50 * tempo + .32 * key + .18 * style, track_id, row, candidate_fp, recording_key))
            ranked = []
            for _, track_id, row, candidate_fp, recording_key in sorted(shortlist, reverse=True, key=lambda item: item[0])[:520]:
                metrics = cls.transition_metrics(previous_fp, candidate_fp, anchor_fp, previous_row, row, anchor)
                score = metrics["score"]
                artist_key = str(row.get("artist", "")).casefold().strip()
                if artist_key in used_artists:
                    score *= .62
                ranked.append((score, track_id, row, candidate_fp, recording_key, artist_key, metrics))
            if not ranked:
                break
            score, track_id, row, candidate_fp, recording_key, artist_key, metrics = max(ranked, key=lambda item: item[0])
            tempo, timbre, harmony = metrics["parts"]
            chain.append({
                "track_id": track_id, "title": row["title"], "artist": row["artist"],
                "genre": "MuRec2 acoustic", "subgenre": candidate_fp["acoustic_signature"],
                "year": int(row["year"]) if pd.notna(row.get("year")) else None,
                "album": row.get("album"), "artwork_url": row.get("artwork_url"),
                "preview_url": row.get("preview_url"), "external_url": row.get("external_url"),
                "source": row.get("source") or "Catalogue", "audio_similarity": round(tempo, 4),
                "lyric_similarity": round(timbre, 4), "collab_similarity": round(harmony, 4),
                "hybrid_score": round(score, 4), "score_mode": "acoustic-transition",
                "match_reasons": metrics["reasons"], "transition_step": step,
                "transition_from": f"{previous_row['title']} — {previous_row['artist']}",
                "transition_note": metrics["note"],
            })
            used_ids.add(track_id)
            used_recordings.add(recording_key)
            used_artists.add(artist_key)
            previous_fp, previous_row = candidate_fp, row
        return chain

    def recommendations(
        self, anchor: dict, catalog: pd.DataFrame, k: int = 12, mode: str = "similar",
        seen_track_ids: set[str] | None = None, favorite_track_ids: set[str] | None = None,
        disliked_track_ids: set[str] | None = None,
        weights: tuple[float, float, float] | None = None,
    ) -> list[dict]:
        indexed = self.all()
        rows = {str(row["track_id"]): row for row in catalog.to_dict("records")}
        anchor_id = str(anchor["track_id"])
        anchor_fp = indexed.get(anchor_id)
        if anchor_fp is None:
            anchor_fp = self.fingerprint_track(anchor)
            indexed[anchor_id] = anchor_fp
        favorites = [indexed[track_id] for track_id in (favorite_track_ids or set()) if track_id in indexed]
        disliked = [indexed[track_id] for track_id in (disliked_track_ids or set()) if track_id in indexed]
        chosen_weights = weights if mode == "similar" and weights else MODE_WEIGHTS.get(mode, MODE_WEIGHTS["similar"])
        if mode == "transition":
            return self.transition_recommendations(anchor, anchor_fp, indexed, rows, k)
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
                taste = max(favorite_components, key=lambda parts: sum(weight * part for weight, part in zip(chosen_weights, parts)))
                rhythm, timbre, harmony = tuple(.65 * anchor_part + .35 * taste_part for anchor_part, taste_part in zip((rhythm, timbre, harmony), taste))
            parts = (rhythm, timbre, harmony)
            base = sum(weight * part for weight, part in zip(chosen_weights, parts))
            style = subgenre_similarity(anchor.get("subgenre", ""), row.get("subgenre", ""))
            total = base * (.52 + .48 * style)
            if mode == "discover" and str(row.get("artist", "")).casefold() == str(anchor.get("artist", "")).casefold():
                total *= .72
            if track_id in seen:
                total *= .40 if mode == "discover" else .76
            if disliked:
                negative_affinity = max(
                    sum(weight * part for weight, part in zip(chosen_weights, self.components(item, candidate_fp)))
                    for item in disliked
                )
                if negative_affinity > .72:
                    total *= 1 - .45 * min(1, (negative_affinity - .72) / .28)
            signature = candidate_fp["acoustic_signature"]
            profile_a, profile_b = anchor_fp["profile"], candidate_fp["profile"]
            tempo_difference = min(
                abs(profile_a["bpm"] - profile_b["bpm"]),
                abs(profile_a["bpm"] - profile_b["bpm"] * 2),
                abs(profile_a["bpm"] * 2 - profile_b["bpm"]),
            )
            reasons = []
            if tempo_difference <= 8:
                reasons.append("close tempo")
            if profile_a.get("texture") == profile_b.get("texture"):
                reasons.append(f"{profile_a['texture'].replace('-', ' ')} texture")
            if abs(profile_a.get("aggression", 0) - profile_b.get("aggression", 0)) <= .09:
                reasons.append("matched intensity")
            if profile_a.get("rhythm_character") == profile_b.get("rhythm_character"):
                reasons.append(f"{profile_a['rhythm_character'].replace('-', ' ')} rhythm")
            if harmony >= .94:
                reasons.append("compatible harmony")
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
                "match_reasons": list(dict.fromkeys(reasons))[:3],
            })
        unique, recordings, artist_counts = [], set(), {}
        for item in sorted(scored, key=lambda value: value["hybrid_score"], reverse=True):
            key = (item["title"].casefold().strip(), item["artist"].casefold().strip())
            artist_key = item["artist"].casefold().strip()
            if key in recordings or artist_counts.get(artist_key, 0) >= 2:
                continue
            recordings.add(key)
            artist_counts[artist_key] = artist_counts.get(artist_key, 0) + 1
            unique.append(item)
            if len(unique) >= k:
                break
        if len(unique) < k:
            selected = {item["track_id"] for item in unique}
            for item in sorted(scored, key=lambda value: value["hybrid_score"], reverse=True):
                if item["track_id"] not in selected:
                    unique.append(item)
                    selected.add(item["track_id"])
                if len(unique) >= k:
                    break
        return unique
