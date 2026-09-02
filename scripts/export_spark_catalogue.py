"""Export PUBLIC music metadata/features only. Never opens the user database.

Usage: python scripts/export_spark_catalogue.py --fingerprints PATH
The source SQLite file is opened read-only; no Supabase requests are made.
"""
import argparse
import csv
import gzip
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ("track_id", "title", "artist", "album", "artwork_url", "external_url", "source", "preview_url", "seed_genre")
PROFILE_FIELDS = {
    "bpm", "energy", "brightness", "spectral_centroid_hz", "spectral_rolloff_hz", "zero_crossing_rate",
    "tempo_confidence", "spectral_flatness", "spectral_contrast", "onset_density", "beat_regularity",
    "dynamic_range", "harmonic_ratio", "percussive_ratio", "tonal_strength", "danceability", "aggression",
    "key", "mode", "timbre", "texture", "tempo_band", "intensity", "rhythm_character", "harmonic_character",
    "acoustic_signature", "analysis_source",
}


def export(fingerprints):
    with (ROOT / "data/catalog/apple_tracks.csv").open(encoding="utf-8-sig", newline="") as stream:
        tracks = {}
        for row in csv.DictReader(stream):
            track = {key: row.get(key, "") for key in FIELDS}
            track.update(provider_genre=row.get("genre", ""), provider_subgenre=row.get("subgenre", ""),
                         year=int(float(row["year"])) if row.get("year") else None)
            tracks[track["track_id"]] = track
    library = []
    with sqlite3.connect(f"{Path(fingerprints).resolve().as_uri()}?mode=ro", uri=True) as db:
        for track_id, vector, profile, signature in db.execute(
            "SELECT track_id, vector_json, profile_json, acoustic_signature FROM fingerprints ORDER BY track_id"
        ):
            if track_id not in tracks:
                continue
            values = json.loads(vector)
            if len(values) != 35:
                raise ValueError(f"Invalid fingerprint for {track_id}")
            safe_profile = {key: value for key, value in json.loads(profile).items() if key in PROFILE_FIELDS}
            library.append(dict(track_id=track_id, vector=values, profile=safe_profile,
                                acoustic_signature=signature, lyrics=None))
    payload = json.dumps(dict(tracks=list(tracks.values()), fingerprints=library), ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    compressed = gzip.compress(payload, mtime=0)
    version = hashlib.sha256(compressed).hexdigest()[:16]
    target = ROOT / "frontend/public/catalogue"
    target.mkdir(parents=True, exist_ok=True)
    filename = f"music-{version}.bin"
    (target / filename).write_bytes(compressed)
    manifest = dict(version=version, file=f"/catalogue/{filename}", encoding="gzip", bytes=len(compressed),
                    total=len(tracks), indexed=len(library), lyrics_analyzed=0,
                    updated_at=datetime.now(timezone.utc).isoformat(),
                    source="Local public catalogue and measured acoustic fingerprints. No user data or raw audio.")
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fingerprints", required=True, type=Path)
    export(parser.parse_args().fingerprints)
