"""Real-song catalogue loading, live Apple search, and metadata recommendations."""

from functools import lru_cache
import math
import re

import pandas as pd
import requests

from src.config import APPLE_CATALOG_PATH
from src.subgenres import infer_subgenre, subgenre_similarity

APPLE_SEARCH_URL = "https://itunes.apple.com/search"


def load_catalog() -> pd.DataFrame:
    if not APPLE_CATALOG_PATH.exists():
        return pd.DataFrame()
    frame = pd.read_csv(APPLE_CATALOG_PATH)
    frame["track_id"] = frame["track_id"].astype(str)
    if "subgenre" not in frame.columns:
        frame["subgenre"] = frame.apply(
            lambda row: infer_subgenre(
                row.get("artist", ""), row.get("genre", ""),
                row.get("seed_genre", ""), row.get("title", ""),
            ), axis=1,
        )
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
    subgenre = infer_subgenre(artist, genre, genre.lower(), title)
    return {
        "track_id": f"apple-{track_id}", "title": title, "artist": artist,
        "album": result.get("collectionName", ""), "genre": genre, "subgenre": subgenre,
        "seed_genre": genre.lower(),
        "year": int(release[:4]) if release[:4].isdigit() else None,
        "duration_ms": result.get("trackTimeMillis"),
        "artwork_url": result.get("artworkUrl100", ""),
        "preview_url": result.get("previewUrl", ""),
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


def _text(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return str(value)


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
    mode: str = "similar",
    seen_track_ids: set[str] | None = None,
    preferences: dict[str, set[str]] | None = None,
) -> list[dict]:
    anchor_genre = str(anchor.get("genre", "")).lower()
    anchor_subgenre = str(anchor.get("subgenre") or infer_subgenre(
        anchor.get("artist", ""), anchor_genre, anchor.get("seed_genre", ""), anchor.get("title", ""),
    )).lower()
    anchor_artist = str(anchor.get("artist", "")).lower()
    anchor_artists = _artist_names(anchor_artist)
    anchor_year = _number(anchor.get("year"), 2005)
    anchor_duration = _number(anchor.get("duration_ms"), 210_000)
    active_weights = weights or {"audio": 0.65, "lyric": 0.10, "collab": 0.25}
    seen = seen_track_ids or set()
    taste = preferences or {"subgenres": set(), "artists": set()}
    anchor_title_key = str(anchor.get("title", "")).casefold().strip()
    anchor_artist_key = str(anchor.get("artist", "")).casefold().strip()
    scored = []
    for row in catalog.to_dict("records"):
        same_id = str(row.get("track_id")) == str(anchor.get("track_id"))
        same_recording = (
            str(row.get("title", "")).casefold().strip() == anchor_title_key
            and str(row.get("artist", "")).casefold().strip() == anchor_artist_key
        )
        if same_id or same_recording:
            continue
        genre = str(row.get("genre", "")).lower()
        subgenre = str(row.get("subgenre") or infer_subgenre(
            row.get("artist", ""), genre, row.get("seed_genre", ""), row.get("title", ""),
        )).lower()
        artist = str(row.get("artist", "")).lower()
        genre_score = subgenre_similarity(anchor_subgenre, subgenre)
        artist_score = 1.0 if _artist_names(artist) & anchor_artists else 0.0
        year_score = math.exp(-abs(_number(row.get("year"), anchor_year) - anchor_year) / 12)
        duration_score = math.exp(-abs(_number(row.get("duration_ms"), anchor_duration) - anchor_duration) / 120_000)
        era_score = 0.65 * year_score + 0.35 * duration_score
        if mode == "adjacent":
            adjacent_score = 0.25 if genre_score == 1.0 else genre_score
            new_artist_score = 0.1 if artist_score else 1.0
            total = 0.60 * adjacent_score + 0.25 * new_artist_score + 0.15 * era_score
            parts = (adjacent_score, new_artist_score, era_score, "metadata-adjacent")
        elif mode == "same-era":
            total = 0.20 * genre_score + 0.10 * artist_score + 0.70 * era_score
            parts = (genre_score, artist_score, era_score, "metadata-era")
        elif mode == "discover":
            new_artist_score = 0.1 if artist_score else 1.0
            repeat_penalty = 0.40 if str(row.get("track_id")) in seen else 0.0
            total = max(0.0, 0.45 * genre_score + 0.35 * new_artist_score + 0.20 * era_score - repeat_penalty)
            parts = (genre_score, new_artist_score, era_score, "metadata-discover")
        elif mode == "personalized" and (taste["subgenres"] or taste["artists"]):
            subgenre_taste = 1.0 if subgenre in taste["subgenres"] else 0.0
            artist_taste = 1.0 if artist in taste["artists"] else 0.0
            taste_score = min(1.0, subgenre_taste + 0.35 * artist_taste)
            novelty_score = 0.15 if str(row.get("track_id")) in seen else 1.0
            freshness_score = 0.625 * era_score + 0.375 * novelty_score
            total = 0.40 * taste_score + 0.20 * genre_score + 0.40 * freshness_score
            parts = (taste_score, genre_score, freshness_score, "metadata-personalized")
        else:
            total = (
                active_weights["audio"] * genre_score
                + active_weights["lyric"] * artist_score
                + active_weights["collab"] * era_score
            )
            parts = (genre_score, artist_score, era_score, "metadata")
        scored.append(_recommendation(row, parts[0], parts[1], parts[2], min(1.0, total), parts[3]))
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
        "genre": row.get("genre") or "Music", "subgenre": _text(row.get("subgenre")),
        "year": int(_number(row.get("year"), 0)) or None,
        "album": _text(row.get("album")), "artwork_url": _text(row.get("artwork_url")),
        "preview_url": _text(row.get("preview_url")),
        "external_url": _text(row.get("external_url")), "source": _text(row.get("source")) or "Apple Music",
        "audio_similarity": round(float(first), 4), "lyric_similarity": round(float(second), 4),
        "collab_similarity": round(float(third), 4), "hybrid_score": round(float(total), 4),
        "score_mode": mode,
    }
