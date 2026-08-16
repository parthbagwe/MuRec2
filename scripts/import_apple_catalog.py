"""Build a real-song metadata catalogue using Apple's official Search API."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import time

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.subgenres import infer_subgenre  # noqa: E402

OUTPUT = ROOT / "data" / "catalog" / "apple_tracks.csv"
SEARCH_URL = "https://itunes.apple.com/search"

SEEDS = [
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


def import_catalog(country: str = "IN", delay: float = 3.1) -> pd.DataFrame:
    rows: dict[str, dict] = {}
    session = requests.Session()
    session.headers["User-Agent"] = "MuRec2/2.0 local music recommendation project"
    for index, (query, seed_genre) in enumerate(SEEDS, start=1):
        response = session.get(
            SEARCH_URL,
            params={"term": query, "media": "music", "entity": "song", "limit": 200, "country": country},
            timeout=30,
        )
        response.raise_for_status()
        added = 0
        for result in response.json().get("results", []):
            row = normalize(result, seed_genre)
            if row and row["track_id"] not in rows:
                rows[row["track_id"]] = row
                added += 1
        print(f"[{index:02d}/{len(SEEDS)}] {query}: +{added} unique tracks")
        if index < len(SEEDS) and delay:
            time.sleep(delay)

    frame = pd.DataFrame(rows.values()).sort_values(["seed_genre", "artist", "title"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(OUTPUT, index=False)
    print(f"Saved {len(frame):,} real songs to {OUTPUT}")
    return frame


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", default="IN", help="Two-letter Apple storefront country")
    parser.add_argument("--delay", type=float, default=3.1, help="Seconds between API requests")
    arguments = parser.parse_args()
    import_catalog(country=arguments.country.upper(), delay=arguments.delay)
