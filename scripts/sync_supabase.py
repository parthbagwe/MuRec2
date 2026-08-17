"""Sync MuRec2 catalogue metadata and derived fingerprints to Supabase.

This maintenance script requires the backend-only MUREC2_SUPABASE_SECRET_KEY.
Never put that key in frontend/.env.local or any VITE_ variable.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
import sqlite3
import sys

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent


def _configuration() -> tuple[str, str]:
    url = os.getenv("MUREC2_SUPABASE_URL", "").rstrip("/")
    key = os.getenv("MUREC2_SUPABASE_SECRET_KEY", "")
    if not url.startswith("https://") or not key:
        raise SystemExit("Set MUREC2_SUPABASE_URL and the backend-only MUREC2_SUPABASE_SECRET_KEY first.")
    return url, key


def _headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _upsert(url: str, key: str, table: str, rows: list[dict]) -> None:
    response = requests.post(
        f"{url}/rest/v1/{table}?on_conflict=track_id",
        headers=_headers(key),
        json=rows,
        timeout=(5, 45),
    )
    if response.status_code >= 400:
        raise RuntimeError(f"{table} sync failed: {response.status_code} {response.text[:500]}")


def _batches(rows, size: int = 200):
    batch = []
    for row in rows:
        batch.append(row)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def _optional(value: str | None):
    value = (value or "").strip()
    return value or None


def _integer(value: str | None):
    value = _optional(value)
    return int(float(value)) if value else None


def catalogue_rows():
    with (ROOT_DIR / "data" / "catalog" / "apple_tracks.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            yield {
                "track_id": _optional(row.get("track_id")),
                "title": _optional(row.get("title")),
                "artist": _optional(row.get("artist")),
                "album": _optional(row.get("album")),
                "provider_genre": _optional(row.get("genre")),
                "seed_genre": _optional(row.get("seed_genre")),
                "year": _integer(row.get("year")),
                "duration_ms": _integer(row.get("duration_ms")),
                "artwork_url": _optional(row.get("artwork_url")),
                "external_url": _optional(row.get("external_url")),
                "source": _optional(row.get("source")) or "Catalogue",
                "preview_url": _optional(row.get("preview_url")),
                "provider_subgenre": _optional(row.get("subgenre")),
            }


def fingerprint_rows(valid_track_ids: set[str]):
    database = sqlite3.connect(ROOT_DIR / "data" / "acoustic-fingerprints.db")
    database.row_factory = sqlite3.Row
    try:
        for row in database.execute(
            "select track_id,vector_json,profile_json,acoustic_signature,analyzed_at from fingerprints"
        ):
            if row["track_id"] not in valid_track_ids:
                continue
            yield {
                "track_id": row["track_id"],
                "vector": json.loads(row["vector_json"]),
                "profile": json.loads(row["profile_json"]),
                "acoustic_signature": row["acoustic_signature"],
                "analyzed_at": row["analyzed_at"],
            }
    finally:
        database.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog-only", action="store_true")
    arguments = parser.parse_args()
    url, key = _configuration()
    tracks = list(catalogue_rows())
    for batch in _batches(iter(tracks)):
        _upsert(url, key, "tracks", batch)
    print(f"Synced {len(tracks):,} catalogue tracks.")
    if not arguments.catalog_only:
        count = 0
        for batch in _batches(fingerprint_rows({row["track_id"] for row in tracks}), size=100):
            _upsert(url, key, "acoustic_fingerprints", batch)
            count += len(batch)
        print(f"Synced {count:,} acoustic fingerprints.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
