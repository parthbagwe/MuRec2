"""Fetch a balanced, playable Cerum catalogue expansion as JSON.

This script deliberately does not rewrite the catalogue.  It retrieves real song
metadata and preview URLs from Apple's public Search API, removes recordings that
Cerum already knows, and leaves the final CSV merge to the spreadsheet workflow.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import re
import sys
import time
import unicodedata

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.subgenres import infer_subgenre  # noqa: E402

CATALOGUE = ROOT / "data" / "catalog" / "apple_tracks.csv"
SEARCH_URL = "https://itunes.apple.com/search"


LANGUAGE_SEEDS: dict[str, list[str]] = {
    "english": [
        "Taylor Swift", "Billie Eilish", "The Weeknd", "Dua Lipa",
        "Ariana Grande", "Ed Sheeran", "Bruno Mars", "Beyonce",
        "Rihanna", "SZA", "Coldplay", "Radiohead", "Nirvana",
        "Foo Fighters", "Linkin Park", "Metallica", "Queen",
        "Fleetwood Mac", "ABBA", "Arctic Monkeys", "Tame Impala",
        "Kendrick Lamar", "Eminem", "Drake", "Tyler the Creator",
        "Daft Punk", "Adele", "Lana Del Rey", "The Beatles", "Elton John",
    ],
    "hindi": [
        "Arijit Singh Hindi", "Shreya Ghoshal Hindi", "A R Rahman Hindi",
        "Pritam Hindi", "Vishal Shekhar Hindi", "Amit Trivedi Hindi",
        "Sonu Nigam Hindi", "Alka Yagnik Hindi", "Kishore Kumar Hindi",
        "Lata Mangeshkar Hindi", "Mohammed Rafi Hindi", "Asha Bhosle Hindi",
        "Udit Narayan Hindi", "KK Hindi", "Atif Aslam Hindi",
        "Neha Kakkar Hindi", "Badshah Hindi", "Vishal Dadlani Hindi",
        "Sunidhi Chauhan Hindi", "Mohit Chauhan Hindi", "Shaan Hindi",
        "Bollywood romantic songs", "Bollywood dance songs", "Hindi indie music",
        "Hindi rap", "90s Bollywood songs", "2000s Bollywood songs",
        "2010s Bollywood songs", "2020s Bollywood songs", "Hindi film classics",
    ],
    "tamil": [
        "A R Rahman Tamil", "Ilaiyaraaja Tamil", "Anirudh Ravichander Tamil",
        "Yuvan Shankar Raja Tamil", "Harris Jayaraj Tamil",
        "Santhosh Narayanan Tamil", "D Imman Tamil", "G V Prakash Tamil",
        "Vidyasagar Tamil", "Deva Tamil", "Sid Sriram Tamil",
        "S P Balasubrahmanyam Tamil", "K S Chithra Tamil", "Hariharan Tamil",
        "Dhanush Tamil songs", "Shreya Ghoshal Tamil", "Karthik Tamil songs",
        "Chinmayi Tamil", "Shankar Mahadevan Tamil", "S Janaki Tamil",
        "Tamil romantic songs", "Tamil dance songs", "Tamil indie music",
        "90s Tamil songs", "2000s Tamil songs", "2010s Tamil songs",
        "2020s Tamil songs", "Tamil film classics", "Tamil kuthu songs",
        "Tamil melody songs",
    ],
}


def normalized_text(value: object) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).strip()


def recording_key(row: dict) -> tuple[str, str]:
    return normalized_text(row.get("title")), normalized_text(row.get("artist"))


def existing_keys() -> tuple[set[str], set[tuple[str, str]]]:
    with CATALOGUE.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    return (
        {str(row.get("track_id", "")) for row in rows},
        {recording_key(row) for row in rows},
    )


def normalize(result: dict, language: str) -> dict | None:
    track_id = result.get("trackId")
    title = result.get("trackName")
    artist = result.get("artistName")
    preview_url = result.get("previewUrl")
    external_url = result.get("trackViewUrl")
    if not all((track_id, title, artist, preview_url, external_url)):
        return None
    genre = result.get("primaryGenreName") or "Music"
    release_date = str(result.get("releaseDate", ""))
    return {
        "track_id": f"apple-{track_id}",
        "title": title,
        "artist": artist,
        "album": result.get("collectionName", ""),
        "genre": genre,
        "seed_genre": language,
        "year": int(release_date[:4]) if release_date[:4].isdigit() else None,
        "duration_ms": result.get("trackTimeMillis"),
        "artwork_url": result.get("artworkUrl100", ""),
        "external_url": external_url,
        "source": "Apple Music",
        "preview_url": preview_url,
        "subgenre": infer_subgenre(artist, genre, language, title),
        "language_group": language,
    }


def search(session: requests.Session, query: str, country: str, limit: int) -> list[dict]:
    last_error: requests.RequestException | None = None
    for attempt in range(4):
        try:
            response = session.get(
                SEARCH_URL,
                params={
                    "term": query,
                    "media": "music",
                    "entity": "song",
                    "limit": limit,
                    "country": country,
                },
                timeout=(5, 35),
            )
        except requests.RequestException as error:
            last_error = error
            session.close()
            time.sleep(2.0 * (attempt + 1))
            continue
        if response.status_code == 200:
            return response.json().get("results", [])
        if response.status_code not in {429, 500, 502, 503, 504}:
            response.raise_for_status()
        time.sleep(1.5 * (attempt + 1))
    if last_error is not None:
        raise last_error
    response.raise_for_status()
    return []


def fetch_group(
    session: requests.Session,
    language: str,
    country: str,
    target: int,
    per_query: int,
    delay: float,
    known_ids: set[str],
    known_recordings: set[tuple[str, str]],
) -> list[dict]:
    pools: list[list[dict]] = []
    seeds = LANGUAGE_SEEDS[language]
    for index, query in enumerate(seeds, start=1):
        raw_results = search(session, query, country, per_query)
        pool: list[dict] = []
        query_seen: set[tuple[str, str]] = set()
        for result in raw_results:
            row = normalize(result, language)
            if not row or row["track_id"] in known_ids:
                continue
            key = recording_key(row)
            if key in known_recordings or key in query_seen:
                continue
            query_seen.add(key)
            pool.append(row)
        pools.append(pool)
        print(f"[{language} {index:02d}/{len(seeds)}] {query}: {len(pool)} candidates", flush=True)
        if delay and index < len(seeds):
            time.sleep(delay)

    # Round-robin selection prevents the first few popular artists from filling
    # the whole group and produces a substantially broader catalogue.
    chosen: list[dict] = []
    offset = 0
    while len(chosen) < target:
        added_this_round = 0
        for pool in pools:
            if offset >= len(pool):
                continue
            row = pool[offset]
            key = recording_key(row)
            if row["track_id"] not in known_ids and key not in known_recordings:
                chosen.append(row)
                known_ids.add(row["track_id"])
                known_recordings.add(key)
                added_this_round += 1
                if len(chosen) >= target:
                    break
        if not added_this_round and all(offset + 1 >= len(pool) for pool in pools):
            break
        offset += 1
    return chosen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--country", default="IN")
    parser.add_argument("--per-language", type=int, default=500)
    parser.add_argument("--per-query", type=int, default=100, choices=range(1, 201))
    parser.add_argument("--delay", type=float, default=0.25)
    arguments = parser.parse_args()

    known_ids, known_recordings = existing_keys()
    session = requests.Session()
    session.headers["User-Agent"] = "Cerum/2.0 balanced acoustic catalogue expansion"
    additions: list[dict] = []
    for language in ("english", "hindi", "tamil"):
        group = fetch_group(
            session,
            language,
            arguments.country.upper(),
            arguments.per_language,
            arguments.per_query,
            arguments.delay,
            known_ids,
            known_recordings,
        )
        additions.extend(group)
        print(f"Selected {len(group):,} new {language} recordings.", flush=True)

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(additions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(additions):,} additions to {arguments.output}")
    return 0 if all(sum(row["language_group"] == language for row in additions) >= arguments.per_language for language in LANGUAGE_SEEDS) else 2


if __name__ == "__main__":
    raise SystemExit(main())
