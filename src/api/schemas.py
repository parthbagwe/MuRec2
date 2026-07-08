"""
Pydantic models for FastAPI request validation and response serialisation.
"""

from pydantic import BaseModel, Field
from typing import Optional


class TrackResponse(BaseModel):
    track_id: str
    title: str
    artist: str
    genre: str
    year: Optional[int] = None
    bpm: Optional[int] = None
    energy: Optional[int] = None
    valence: Optional[float] = None
    popularity: Optional[int] = None
    timbre: Optional[str] = None
    primary_theme_pool: Optional[str] = None
    lyric_snippet: Optional[str] = None


class RecommendationResponse(BaseModel):
    track_id: str
    title: str
    artist: str
    genre: str
    audio_similarity: float = Field(ge=0.0, le=1.0)
    lyric_similarity: float = Field(ge=0.0, le=1.0)
    collab_similarity: float = Field(ge=0.0, le=1.0)
    hybrid_score: float = Field(ge=0.0, le=1.0)


class RecommendRequest(BaseModel):
    track_id: str
    k: int = Field(default=10, ge=1, le=50)
    weights: Optional[dict[str, float]] = None


class RecommendListResponse(BaseModel):
    anchor: TrackResponse
    recommendations: list[RecommendationResponse]
    weights_used: dict[str, float]
    total: int


class SearchResponse(BaseModel):
    results: list[TrackResponse]
    total: int
    query: str


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    total_tracks: int