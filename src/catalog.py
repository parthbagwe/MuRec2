"""Real-song catalogue loading, live Apple search, and metadata recommendations."""

from functools import lru_cache
import math
import re

import pandas as pd
import requests

from src.config import APPLE_CATALOG_PATH

APPLE_SEARCH_URL = "https://itunes.apple.com/search"


def load_catalog() -> pd.DataFrame:
    if not APPLE_CATALOG_PATH.exists():
        return pd.DataFrame()
    frame = pd.read_csv(APPLE_CATALOG_PATH)
    frame["track_id"] = frame["track_id"].astype(str)
    return frame


def _normalize(result: dict) -> dict | None:
    track_id = result.get("trackId")
    title = result.get("trackName")
    artist = result.get("artistName")
    external_url = result.get("trackViewUrl")
    if not all((track_id, title, artist, external_url)):
        return None
    release = str(result.get("releaseDate", ""))
    genre = result.get("primaryGenreName") or "Music"
    return {
        "track_id": f"apple-{track_id}", "title": title, "artist": artist,
        "album": result.get("collectionName", ""), "genre": genre,
        "seed_genre": genre.lower(),
        "year": int(release[:4]) if release[:4].isdigit() else None,
        "duration_ms": result.get("trackTimeMillis"),
        "artwork_url": result.get("artworkUrl100", ""),
        "external_url": external_url, "source": "Apple Music",
    }


@lru_cache(maxsize=128)
def search_apple(query: str, country: str = "IN", limit: int = 25) -> tuple[dict, ...]:
    response = requests.get(
        APPLE_SEARCH_URL,
        params={"term": query, "media": "music", "entity": "song", "limit": limit, "country": country},
        headers={"User-Agent": "MuRec2/2.0 local music recommendation project"},
        timeout=12,
    )
    response.raise_for_status()
    rows = [_normalize(result) for result in response.json().get("results", [])]
    return tuple(row for row in rows if row)


def _number(value, default: float) -> float:
    try:
        numeric = float(value)
        return default if math.isnan(numeric) else numeric
    except (TypeError, ValueError):
        return default


def _artist_names(value: str) -> set[str]:
    """Split a multi-artist credit into comparable artist names."""
    parts = re.split(r"\s*(?:,|&|\bfeat\.?\b|\bfeaturing\b|\bx\b)\s*", value.lower())
    return {re.sub(r"[^a-z0-9]+", " ", part).strip() for part in parts if part.strip()}


def _unique_top(scored: list[dict], k: int) -> list[dict]:
    """Keep the strongest edition when Apple returns the same song on multiple releases."""
    unique = []
    seen = set()
    for item in sorted(scored, key=lambda row: row["hybrid_score"], reverse=True):
        key = (str(item["title"]).casefold().strip(), str(item["artist"]).casefold().strip())
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= k:
            break
    return unique


def recommend_metadata(
    anchor: dict,
    catalog: pd.DataFrame,
    k: int = 12,
    weights: dict[str, float] | None = None,
) -> list[dict]:
    anchor_seed = str(anchor.get("seed_genre", "")).lower()
    anchor_genre = str(anchor.get("genre", "")).lower()
    anchor_artist = str(anchor.get("artist", "")).lower()
    anchor_artists = _artist_names(anchor_artist)
    anchor_year = _number(anchor.get("year"), 2005)
    anchor_duration = _number(anchor.get("duration_ms"), 210_000)
    active_weights = weights or {"audio": 0.55, "lyric": 0.20, "collab": 0.25}
    scored = []
    for row in catalog.to_dict("records"):
        if str(row.get("track_id")) == str(anchor.get("track_id")):
            continue
        seed = str(row.get("seed_genre", "")).lower()
        genre = str(row.get("genre", "")).lower()
        artist = str(row.get("artist", "")).lower()
        genre_score = 1.0 if seed == anchor_seed else (0.75 if genre == anchor_genre else 0.15)
        artist_score = 1.0 if _artist_names(artist) & anchor_artists else 0.0
        year_score = math.exp(-abs(_number(row.get("year"), anchor_year) - anchor_year) / 12)
        duration_score = math.exp(-abs(_number(row.get("duration_ms"), anchor_duration) - anchor_duration) / 120_000)
        era_score = 0.65 * year_score + 0.35 * duration_score
        total = (
            active_weights["audio"] * genre_score
            + active_weights["lyric"] * artist_score
            + active_weights["collab"] * era_score
        )
        scored.append(_recommendation(row, genre_score, artist_score, era_score, total, "metadata"))
    return _unique_top(scored, k)


def recommend_from_genres(catalog: pd.DataFrame, genres: list[str], k: int = 12) -> list[dict]:
    ranks = {genre.lower(): index for index, genre in enumerate(genres)}
    scored = []
    for row in catalog.to_dict("records"):
        seed = str(row.get("seed_genre", "")).lower()
        rank = ranks.get(seed, len(ranks) + 2)
        profile_score = max(0.2, 1 - rank * 0.12)
        genre_score = 1.0 if seed in ranks else 0.25
        recency = math.exp(-abs(_number(row.get("year"), 2015) - 2015) / 20)
        total = 0.6 * profile_score + 0.3 * genre_score + 0.1 * recency
        scored.append(_recommendation(row, profile_score, genre_score, recency, total, "acoustic-profile"))
    return _unique_top(scored, k)


def _recommendation(row: dict, first: float, second: float, third: float, total: float, mode: str) -> dict:
    return {
        "track_id": str(row["track_id"]), "title": row["title"], "artist": row["artist"],
        "genre": row.get("genre") or "Music", "year": int(_number(row.get("year"), 0)) or None,
        "album": row.get("album"), "artwork_url": row.get("artwork_url"),
        "external_url": row.get("external_url"), "source": row.get("source", "Apple Music"),
        "audio_similarity": round(float(first), 4), "lyric_similarity": round(float(second), 4),
        "collab_similarity": round(float(third), 4), "hybrid_score": round(float(total), 4),
        "score_mode": mode,
    }
