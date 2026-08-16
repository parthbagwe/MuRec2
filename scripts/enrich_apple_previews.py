"""Add stream-only Apple preview URLs to the existing real-song catalogue.

The files are never downloaded. The frontend streams these URLs on demand and
shows the attribution/store link required by Apple's promotional-content terms.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import time

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data" / "catalog" / "apple_tracks.csv"
LOOKUP_URL = "https://itunes.apple.com/lookup"


def chunks(values: list[str], size: int):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def enrich(country: str = "IN", batch_size: int = 180, delay: float = 3.1) -> pd.DataFrame:
    frame = pd.read_csv(CATALOG)
    if "preview_url" not in frame.columns:
        frame["preview_url"] = ""

    apple_ids = frame["track_id"].astype(str).str.removeprefix("apple-").tolist()
    previews: dict[str, str] = {}
    session = requests.Session()
    session.headers["User-Agent"] = "MuRec2/2.0 local music recommendation project"
    batches = list(chunks(apple_ids, batch_size))

    for index, batch in enumerate(batches, start=1):
        response = session.get(
            LOOKUP_URL,
            params={"id": ",".join(batch), "country": country, "entity": "song"},
            timeout=30,
        )
        response.raise_for_status()
        for result in response.json().get("results", []):
            track_id = result.get("trackId")
            preview_url = result.get("previewUrl")
            if track_id and preview_url:
                previews[f"apple-{track_id}"] = preview_url
        print(f"[{index:02d}/{len(batches)}] found {len(previews):,} previews")
        if index < len(batches) and delay:
            time.sleep(delay)

    frame["preview_url"] = frame["track_id"].astype(str).map(previews).fillna(frame["preview_url"])
    frame.to_csv(CATALOG, index=False)
    print(f"Saved {frame['preview_url'].fillna('').ne('').sum():,} streamable previews to {CATALOG}")
    return frame


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", default="IN")
    parser.add_argument("--batch-size", type=int, default=180)
    parser.add_argument("--delay", type=float, default=3.1)
    args = parser.parse_args()
    enrich(country=args.country.upper(), batch_size=args.batch_size, delay=args.delay)
