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
    subgenre: Optional[str] = None
    year: Optional[int] = None
    bpm: Optional[int] = None
    energy: Optional[int] = None
    valence: Optional[float] = None
    popularity: Optional[int] = None
    timbre: Optional[str] = None
    primary_theme_pool: Optional[str] = None
    lyric_snippet: Optional[str] = None
    album: Optional[str] = None
    artwork_url: Optional[str] = None
    preview_url: Optional[str] = None
    external_url: Optional[str] = None
    source: Optional[str] = None
    acoustic_signature: Optional[str] = None
    analysis_status: str = "pending"


class RecommendationResponse(BaseModel):
    track_id: str
    title: str
    artist: str
    genre: str
    subgenre: Optional[str] = None
    audio_similarity: float = Field(ge=0.0, le=1.0)
    lyric_similarity: float = Field(ge=0.0, le=1.0)
    collab_similarity: float = Field(ge=0.0, le=1.0)
    hybrid_score: float = Field(ge=0.0, le=1.0)
    year: Optional[int] = None
    album: Optional[str] = None
    artwork_url: Optional[str] = None
    preview_url: Optional[str] = None
    external_url: Optional[str] = None
    source: Optional[str] = None
    score_mode: str = "hybrid"


class RecommendRequest(BaseModel):
    track_id: str
    k: int = Field(default=10, ge=1, le=50)
    weights: Optional[dict[str, float]] = None
    mode: str = "similar"


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
    acoustic_indexed: int = 0
    acoustic_indexing: bool = False


class AudioProfileResponse(BaseModel):
    bpm: float
    energy: float
    brightness: float
    spectral_centroid_hz: float
    spectral_rolloff_hz: float
    zero_crossing_rate: float
    key: str
    timbre: str
    tempo_band: Optional[str] = None
    intensity: Optional[str] = None
    texture: Optional[str] = None
    rhythm_character: Optional[str] = None
    harmonic_character: Optional[str] = None
    acoustic_signature: Optional[str] = None
    onset_density: Optional[float] = None
    beat_regularity: Optional[float] = None
    harmonic_ratio: Optional[float] = None
    percussive_ratio: Optional[float] = None
    danceability: Optional[float] = None
    aggression: Optional[float] = None


class AcousticIndexStatusResponse(BaseModel):
    indexed: int
    total: int
    remaining: int
    failures: int
    building: bool


class AnalyzeResponse(BaseModel):
    anchor: TrackResponse
    recommendations: list[RecommendationResponse]
    audio_profile: AudioProfileResponse
    total: int
    model: str = "uploaded-audio-similarity"
