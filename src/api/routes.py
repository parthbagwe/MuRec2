"""
All FastAPI route definitions.

GET /health                    — health check
GET /tracks                    — paginated + searchable track list
GET /tracks/{track_id}         — single track metadata
POST /recommend                — hybrid recommendations
GET /similar/{track_id}        — content-only recommendations (no collab)
GET /genres                    — list all genres
POST /analyze                  — analyze an uploaded unknown song
"""

import hashlib
import math
from pathlib import Path
import tempfile
import requests

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from src.api.schemas import (
    TrackResponse, RecommendRequest, RecommendListResponse,
    SearchResponse, HealthResponse, RecommendationResponse, AnalyzeResponse,
)
from src.config import HYBRID_WEIGHTS
from src.features.audio_analysis import analyze_audio
from src.catalog import recommend_from_genres, recommend_metadata, search_apple

router = APIRouter()

# These are set in main.py during startup
_df = None
_hybrid_model = None
_content_model = None
_catalog_df = None
_live_tracks = {}


def init_routes(df, hybrid_model, content_model, catalog_df):
    global _df, _hybrid_model, _content_model, _catalog_df
    _df = df
    _hybrid_model = hybrid_model
    _content_model = content_model
    _catalog_df = catalog_df


def _row_to_track(row) -> TrackResponse:
    def optional(name, cast=None):
        value = row.get(name)
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return None
        return cast(value) if cast else value

    return TrackResponse(
        track_id=row["track_id"],
        title=row["title"],
        artist=row["artist"],
        genre=row["genre"],
        year=optional("year", int),
        bpm=optional("bpm", int),
        energy=optional("energy", int),
        valence=optional("valence", float),
        popularity=optional("popularity", int),
        timbre=optional("timbre"),
        primary_theme_pool=optional("primary_theme_pool"),
        lyric_snippet=optional("lyric_snippet"),
        album=optional("album"),
        artwork_url=optional("artwork_url"),
        preview_url=optional("preview_url"),
        external_url=optional("external_url"),
        source=optional("source"),
    )


@router.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        models_loaded=_hybrid_model is not None,
        total_tracks=len(_catalog_df) if _catalog_df is not None else 0,
    )


@router.get("/genres")
def get_genres():
    if _catalog_df is None or _catalog_df.empty:
        raise HTTPException(status_code=503, detail="Models not loaded")
    return {"genres": sorted(_catalog_df["genre"].dropna().unique().tolist())}


@router.get("/tracks", response_model=SearchResponse)
def get_tracks(
    q: str = Query(default="", description="Search by title or artist"),
    genre: str = Query(default="", description="Filter by genre"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    if _catalog_df is None or _catalog_df.empty:
        raise HTTPException(status_code=503, detail="Real-song catalogue is not loaded")

    filtered = _catalog_df.copy()

    if q:
        mask = (
            filtered["title"].str.contains(q, case=False, na=False) |
            filtered["artist"].str.contains(q, case=False, na=False) |
            filtered["album"].str.contains(q, case=False, na=False)
        )
        filtered = filtered[mask]

    if genre:
        filtered = filtered[filtered["genre"].str.lower() == genre.lower()]

    total = len(filtered)
    start = (page - 1) * page_size
    paginated = filtered.iloc[start:start + page_size]
    result_rows = [row.to_dict() for _, row in paginated.iterrows()]

    # Supplement sparse local matches with a live, cached Apple search.
    if q and page == 1 and len(result_rows) < page_size:
        try:
            live_rows = search_apple(q, limit=min(25, page_size))
            known_ids = {str(row["track_id"]) for row in result_rows}
            for row in live_rows:
                _live_tracks[str(row["track_id"])] = row
                if str(row["track_id"]) not in known_ids:
                    result_rows.append(row)
                    known_ids.add(str(row["track_id"]))
                if len(result_rows) >= page_size:
                    break
        except requests.RequestException:
            pass

    total = max(total, len(result_rows))
    results = [_row_to_track(row) for row in result_rows]
    return SearchResponse(results=results, total=total, query=q)


@router.get("/tracks/{track_id}", response_model=TrackResponse)
def get_track(track_id: str):
    if _catalog_df is None:
        raise HTTPException(status_code=503, detail="Models not loaded")
    row = _catalog_df[_catalog_df["track_id"].astype(str) == track_id]
    if not row.empty:
        return _row_to_track(row.iloc[0])
    if track_id in _live_tracks:
        return _row_to_track(_live_tracks[track_id])
    raise HTTPException(status_code=404, detail=f"Track '{track_id}' not found")


@router.post("/recommend", response_model=RecommendListResponse)
def recommend(req: RecommendRequest):
    if _hybrid_model is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    if req.track_id.startswith("apple-"):
        anchor_match = _catalog_df[_catalog_df["track_id"].astype(str) == req.track_id]
        anchor = anchor_match.iloc[0].to_dict() if not anchor_match.empty else _live_tracks.get(req.track_id)
        if anchor is None:
            raise HTTPException(status_code=404, detail=f"Track '{req.track_id}' not found")
        weights = req.weights or {"audio": 0.55, "lyric": 0.20, "collab": 0.25}
        if set(weights) != set(HYBRID_WEIGHTS) or any(value < 0 for value in weights.values()):
            raise HTTPException(status_code=400, detail="Weights must contain non-negative genre, artist, and era values")
        if abs(sum(weights.values()) - 1.0) > 0.01:
            raise HTTPException(status_code=400, detail="Recommendation weights must sum to 1.0")
        recs = recommend_metadata(anchor, _catalog_df, k=req.k, weights=weights)
        return RecommendListResponse(
            anchor=_row_to_track(anchor),
            recommendations=[RecommendationResponse(**item) for item in recs],
            weights_used=weights,
            total=len(recs),
        )

    anchor_row = _df[_df["track_id"] == req.track_id]
    if anchor_row.empty:
        raise HTTPException(status_code=404, detail=f"Track '{req.track_id}' not found")

    weights = req.weights or HYBRID_WEIGHTS
    if set(weights) != set(HYBRID_WEIGHTS) or any(value < 0 for value in weights.values()):
        raise HTTPException(status_code=400, detail="Weights must contain non-negative audio, lyric, and collab values")
    if abs(sum(weights.values()) - 1.0) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Weights must sum to 1.0, got {sum(weights.values()):.2f}"
        )

    try:
        recs = _hybrid_model.recommend(req.track_id, k=req.k, weights=weights)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return RecommendListResponse(
        anchor=_row_to_track(anchor_row.iloc[0]),
        recommendations=[RecommendationResponse(**r) for r in recs],
        weights_used=weights,
        total=len(recs),
    )


@router.get("/similar/{track_id}")
def similar(track_id: str, k: int = Query(default=10, ge=1, le=50)):
    """Content-only recommendations — useful for cold-start (no collab needed)."""
    if _content_model is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    try:
        recs = _content_model.recommend(track_id, k=k)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Track '{track_id}' not found")

    return {"track_id": track_id, "recommendations": recs, "model": "content-only"}


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_unknown_song(
    file: UploadFile = File(..., description="WAV, MP3, FLAC, OGG, or M4A audio"),
    title: str = Form(default="Unknown song"),
    k: int = Form(default=12, ge=1, le=30),
):
    """Analyze an unknown song without retaining the uploaded audio."""
    if _content_model is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    suffix = Path(file.filename or "audio.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}:
        raise HTTPException(status_code=415, detail="Upload WAV, MP3, FLAC, OGG, M4A, or AAC audio")
    payload = await file.read(30 * 1024 * 1024 + 1)
    if len(payload) > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio files must be 30 MB or smaller")
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty")

    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(payload)
            temporary_path = Path(temporary.name)
        raw_vector, profile = analyze_audio(temporary_path)
        acoustic_candidates = _content_model.recommend_from_audio(raw_vector, k=30)
        inferred_genres = list(dict.fromkeys(item["genre"] for item in acoustic_candidates))
        recommendations = recommend_from_genres(_catalog_df, inferred_genres, k=k)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Could not decode or analyze this audio: {error}") from error
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    estimated_genre = recommendations[0]["genre"] if recommendations else "unknown"
    anchor = TrackResponse(
        track_id=f"upload-{hashlib.sha256(payload).hexdigest()[:12]}",
        title=title.strip() or Path(file.filename or "Unknown song").stem,
        artist="Uploaded audio",
        genre=estimated_genre,
        bpm=round(profile["bpm"]),
        energy=round(profile["energy"]),
        timbre=profile["timbre"],
    )
    return AnalyzeResponse(
        anchor=anchor,
        recommendations=[RecommendationResponse(**item) for item in recommendations],
        audio_profile=profile,
        total=len(recommendations),
    )
