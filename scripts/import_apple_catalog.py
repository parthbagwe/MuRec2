"""Build or expand the real-song catalogue using Apple's official Search API."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
import time

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.subgenres import infer_subgenre  # noqa: E402

OUTPUT = ROOT / "data" / "catalog" / "apple_tracks.csv"
SEARCH_URL = "https://itunes.apple.com/search"

CORE_SEEDS = [
    ("top pop songs", "pop"), ("rock classics", "rock"),
    ("hip hop hits", "hip-hop"), ("electronic dance music", "electronic"),
    ("jazz essentials", "jazz"), ("folk songs", "folk"),
    ("r&b hits", "r&b"), ("classical essentials", "classical"),
    ("heavy metal", "metal"), ("indie hits", "indie"),
    ("country hits", "country"), ("reggae classics", "reggae"),
    ("blues essentials", "blues"), ("latin hits", "latin"),
    ("ambient music", "ambient"), ("soul classics", "soul"),
    ("bollywood hits", "bollywood"), ("punjabi hits", "punjabi"),
    ("tamil hits", "tamil"), ("telugu hits", "telugu"),
]

# Interleaved so bounded imports add breadth instead of filling one family first.
EXPANSION_SEEDS = [
    ("nu metal essentials", "nu-metal"),
    ("afrobeats hits", "afrobeats"),
    ("jazz fusion essentials", "jazz-fusion"),
    ("house music classics", "house"),
    ("qawwali classics", "qawwali"),
    ("punk rock essentials", "punk"),
    ("neo soul essentials", "neo-soul"),
    ("k-pop hits", "k-pop"),
    ("death metal essentials", "death-metal"),
    ("drum and bass classics", "drum-and-bass"),
    ("ghazal classics", "ghazal"),
    ("shoegaze essentials", "shoegaze"),
    ("reggaeton hits", "reggaeton"),
    ("baroque classical essentials", "baroque"),
    ("trap rap essentials", "trap"),
    ("synthwave essentials", "synthwave"),
    ("Indian classical ragas", "indian-classical"),
    ("post punk essentials", "post-punk"),
    ("amapiano hits", "amapiano"),
    ("city pop essentials", "city-pop"),
    ("thrash metal essentials", "thrash-metal"),
    ("trip hop essentials", "trip-hop"),
    ("bossa nova classics", "bossa-nova"),
    ("dream pop essentials", "dream-pop"),
    ("metalcore essentials", "metalcore"),
    ("techno classics", "techno"),
    ("gospel soul classics", "gospel"),
    ("j-pop hits", "j-pop"),
    ("black metal essentials", "black-metal"),
    ("ambient electronic essentials", "ambient-electronic"),
    ("salsa classics", "salsa"),
    ("progressive rock essentials", "progressive-rock"),
    ("drill rap essentials", "drill"),
    ("trance classics", "trance"),
    ("Malayalam film songs", "malayalam"),
    ("emo rock essentials", "emo"),
    ("funk classics", "funk"),
    ("Arabic pop hits", "arabic-pop"),
    ("doom metal essentials", "doom-metal"),
    ("dub reggae classics", "dub"),
    ("Bengali songs classics", "bengali"),
    ("alternative hip hop essentials", "alternative-hip-hop"),
    ("bluegrass classics", "bluegrass"),
    ("Kannada film songs", "kannada"),
    ("industrial rock essentials", "industrial"),
    ("dancehall classics", "dancehall"),
    ("psychedelic rock essentials", "psychedelic-rock"),
    ("video game soundtrack essentials", "game-soundtrack"),
]


def normalize(result: dict, seed_genre: str) -> dict | None:
    track_id = result.get("trackId")
    title = result.get("trackName")
    artist = result.get("artistName")
    external_url = result.get("trackViewUrl")
    if not all((track_id, title, artist, external_url)):
        return None
    release_date = str(result.get("releaseDate", ""))
    genre = result.get("primaryGenreName") or seed_genre
    return {
        "track_id": f"apple-{track_id}",
        "title": title,
        "artist": artist,
        "album": result.get("collectionName", ""),
        "genre": genre,
        "subgenre": infer_subgenre(artist, genre, seed_genre, title),
        "seed_genre": seed_genre,
        "year": int(release_date[:4]) if release_date[:4].isdigit() else None,
        "duration_ms": result.get("trackTimeMillis"),
        "artwork_url": result.get("artworkUrl100", ""),
        "preview_url": result.get("previewUrl", ""),
        "external_url": external_url,
        "source": "Apple Music",
    }


def recording_key(row: dict) -> tuple[str, str]:
    def normalize(value: str) -> str:
        return re.sub(r"[^\w]+", " ", str(value).casefold(), flags=re.UNICODE).strip()

    return normalize(row.get("title", "")), normalize(row.get("artist", ""))


def import_catalog(
    country: str = "IN",
    delay: float = 3.1,
    merge: bool = True,
    max_new: int | None = 1_000,
    per_query: int = 100,
) -> pd.DataFrame:
    if merge and OUTPUT.exists():
        existing = pd.read_csv(OUTPUT).fillna("").to_dict("records")
        rows: dict[str, dict] = {str(row["track_id"]): row for row in existing}
    else:
        rows = {}
    recordings = {recording_key(row) for row in rows.values()}
    starting_count = len(rows)
    seeds = EXPANSION_SEEDS if merge else [*CORE_SEEDS, *EXPANSION_SEEDS]
    session = requests.Session()
    session.headers["User-Agent"] = "Cerum/1.0 acoustic music recommendation project"
    for index, (query, seed_genre) in enumerate(seeds, start=1):
        response = session.get(
            SEARCH_URL,
            params={"term": query, "media": "music", "entity": "song", "limit": per_query, "country": country},
            timeout=30,
        )
        response.raise_for_status()
        added = 0
        for result in response.json().get("results", []):
            row = normalize(result, seed_genre)
            if not row:
                continue
            if row["track_id"] in rows:
                rows[row["track_id"]].update(row)
                continue
            key = recording_key(row)
            if key in recordings:
                continue
            rows[row["track_id"]] = row
            recordings.add(key)
            added += 1
            if max_new is not None and len(rows) - starting_count >= max_new:
                break
        print(f"[{index:02d}/{len(seeds)}] {query}: +{added} unique tracks")
        if max_new is not None and len(rows) - starting_count >= max_new:
            break
        if index < len(seeds) and delay:
            time.sleep(delay)

    frame = pd.DataFrame(rows.values()).sort_values(["seed_genre", "artist", "title"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(OUTPUT, index=False)
    print(f"Saved {len(frame):,} real songs to {OUTPUT} (+{len(frame) - starting_count:,})")
    return frame


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", default="IN", help="Two-letter Apple storefront country")
    parser.add_argument("--delay", type=float, default=3.1, help="Seconds between API requests")
    parser.add_argument("--max-new", type=int, default=1000, help="Maximum new recordings to add; 0 means no limit")
    parser.add_argument("--per-query", type=int, default=100, choices=range(1, 201))
    parser.add_argument("--replace", action="store_true", help="Rebuild from all core and expansion seeds instead of merging")
    arguments = parser.parse_args()
    import_catalog(
        country=arguments.country.upper(),
        delay=arguments.delay,
        merge=not arguments.replace,
        max_new=arguments.max_new or None,
        per_query=arguments.per_query,
    )
