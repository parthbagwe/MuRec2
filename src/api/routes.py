"""
All FastAPI route definitions.

GET /health                    — health check
GET /tracks                    — paginated + searchable track list
GET /tracks/{track_id}         — single track metadata
POST /recommend                — hybrid recommendations
GET /similar/{track_id}        — content-only recommendations (no collab)
GET /genres                    — list all genres
"""

from fastapi import APIRouter, HTTPException, Query
from src.api.schemas import (
    TrackResponse, RecommendRequest, RecommendListResponse,
    SearchResponse, HealthResponse, RecommendationResponse,
)
from src.config import HYBRID_WEIGHTS
import math

router = APIRouter()

# These are set in main.py during startup
_df = None
_hybrid_model = None
_content_model = None


def init_routes(df, hybrid_model, content_model):
    global _df, _hybrid_model, _content_model
    _df = df
    _hybrid_model = hybrid_model
    _content_model = content_model


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
    )


@router.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        models_loaded=_hybrid_model is not None,
        total_tracks=len(_df) if _df is not None else 0,
    )


@router.get("/genres")
def get_genres():
    if _df is None:
        raise HTTPException(status_code=503, detail="Models not loaded")
    return {"genres": sorted(_df["genre"].unique().tolist())}


@router.get("/tracks", response_model=SearchResponse)
def get_tracks(
    q: str = Query(default="", description="Search by title or artist"),
    genre: str = Query(default="", description="Filter by genre"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    if _df is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    filtered = _df.copy()

    if q:
        mask = (
            filtered["title"].str.contains(q, case=False, na=False) |
            filtered["artist"].str.contains(q, case=False, na=False)
        )
        filtered = filtered[mask]

    if genre:
        filtered = filtered[filtered["genre"].str.lower() == genre.lower()]

    total = len(filtered)
    start = (page - 1) * page_size
    paginated = filtered.iloc[start:start + page_size]

    results = [_row_to_track(row) for _, row in paginated.iterrows()]
    return SearchResponse(results=results, total=total, query=q)


@router.get("/tracks/{track_id}", response_model=TrackResponse)
def get_track(track_id: str):
    if _df is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    row = _df[_df["track_id"] == track_id]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Track '{track_id}' not found")

    return _row_to_track(row.iloc[0])


@router.post("/recommend", response_model=RecommendListResponse)
def recommend(req: RecommendRequest):
    if _hybrid_model is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

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
