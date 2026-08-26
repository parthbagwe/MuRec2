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

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from src.api.schemas import (
    TrackResponse, RecommendRequest, RecommendListResponse,
    SearchResponse, HealthResponse, RecommendationResponse, AnalyzeResponse,
    AcousticIndexStatusResponse,
)
from src.config import HYBRID_WEIGHTS
from src.features.audio_analysis import analyze_audio
from src.catalog import search_apple
from src.acoustic_index import MODE_WEIGHTS as ACOUSTIC_MODE_WEIGHTS
from src.auth import optional_user
from src.user_store import record_recommendation, seen_track_ids, taste_profile

router = APIRouter()

# These are set in main.py during startup
_df = None
_hybrid_model = None
_content_model = None
_catalog_df = None
_live_tracks = {}
_acoustic_index = None

RECOMMENDATION_MODES = {"similar", "rhythm", "timbre", "discover", "personalized", "transition"}
MODE_WEIGHTS = {
    name: {"audio": values[0], "lyric": values[1], "collab": values[2]}
    for name, values in ACOUSTIC_MODE_WEIGHTS.items()
}


def _recording_key(row) -> tuple[str, str]:
    return (
        str(row.get("title", "")).casefold().strip(),
        str(row.get("artist", "")).casefold().strip(),
    )


def init_routes(df, hybrid_model, content_model, catalog_df, acoustic_index=None):
    global _df, _hybrid_model, _content_model, _catalog_df, _acoustic_index
    _df = df
    _hybrid_model = hybrid_model
    _content_model = content_model
    _catalog_df = catalog_df
    _acoustic_index = acoustic_index


def _row_to_track(row) -> TrackResponse:
    def optional(name, cast=None):
        value = row.get(name)
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return None
        return cast(value) if cast else value

    fingerprint = _acoustic_index.get(str(row["track_id"])) if _acoustic_index else None
    fingerprint_bpm = (fingerprint or {}).get("profile", {}).get("bpm")
    return TrackResponse(
        track_id=row["track_id"],
        title=row["title"],
        artist=row["artist"],
        genre="MuRec2 acoustic" if fingerprint else "Audio analysis pending",
        subgenre=fingerprint["acoustic_signature"] if fingerprint else None,
        year=optional("year", int),
        bpm=round(fingerprint_bpm) if fingerprint_bpm is not None else optional("bpm", int),
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
        acoustic_signature=fingerprint["acoustic_signature"] if fingerprint else None,
        analysis_status="complete" if fingerprint else "pending",
    )


@router.get("/health", response_model=HealthResponse)
def health():
    index_status = _acoustic_index.status(len(_catalog_df)) if _acoustic_index and _catalog_df is not None else {"indexed": 0, "building": False}
    return HealthResponse(
        status="ok",
        models_loaded=_hybrid_model is not None,
        total_tracks=len(_catalog_df) if _catalog_df is not None else 0,
        acoustic_indexed=index_status["indexed"],
        acoustic_indexing=index_status["building"],
    )


@router.get("/acoustic-index/status", response_model=AcousticIndexStatusResponse)
def acoustic_index_status():
    if _acoustic_index is None or _catalog_df is None:
        raise HTTPException(status_code=503, detail="Acoustic index is not loaded")
    return _acoustic_index.status(len(_catalog_df))


@router.get("/genres")
def get_genres():
    if _catalog_df is None or _catalog_df.empty:
        raise HTTPException(status_code=503, detail="Models not loaded")
    fingerprints = _acoustic_index.all() if _acoustic_index else {}
    profiles = [item["profile"] for item in fingerprints.values()]
    return {
        "genres": sorted({profile["texture"] for profile in profiles}),
        "subgenres": sorted({item["acoustic_signature"] for item in fingerprints.values()}),
        "dimensions": ["tempo", "intensity", "texture", "rhythm character", "harmonic character"],
    }


@router.get("/tracks", response_model=SearchResponse)
def get_tracks(
    q: str = Query(default="", description="Search by title or artist"),
    genre: str = Query(default="", description="Filter by a MuRec2-derived acoustic category"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    if _catalog_df is None or _catalog_df.empty:
        raise HTTPException(status_code=503, detail="Real-song catalogue is not loaded")

    filtered = _catalog_df.copy()

    if q:
        searchable = (
            filtered["title"].fillna("").astype(str) + " " +
            filtered["artist"].fillna("").astype(str) + " " +
            filtered["album"].fillna("").astype(str)
        )
        mask = searchable.notna()
        for term in q.split():
            mask &= searchable.str.contains(term, case=False, regex=False)
        filtered = filtered[mask]

    if genre:
        fingerprints = _acoustic_index.all() if _acoustic_index else {}
        category = genre.casefold().strip()
        matching_ids = {
            track_id for track_id, item in fingerprints.items()
            if category in item["acoustic_signature"].casefold()
        }
        filtered = filtered[filtered["track_id"].astype(str).isin(matching_ids)]

    # Apple often exposes the same recording on several album editions.
    filtered = filtered.assign(
        _title_key=filtered["title"].astype(str).str.casefold().str.strip(),
        _artist_key=filtered["artist"].astype(str).str.casefold().str.strip(),
    ).drop_duplicates(subset=["_title_key", "_artist_key"])

    total = len(filtered)
    start = (page - 1) * page_size
    paginated = filtered.iloc[start:start + page_size]
    result_rows = [row.to_dict() for _, row in paginated.iterrows()]

    # Supplement sparse local matches with a live, cached Apple search.
    if q and page == 1 and len(result_rows) < page_size:
        try:
            live_rows = search_apple(q, limit=min(25, page_size))
            known_ids = {str(row["track_id"]) for row in result_rows}
            known_recordings = {_recording_key(row) for row in result_rows}
            for row in live_rows:
                _live_tracks[str(row["track_id"])] = row
                recording_key = _recording_key(row)
                if str(row["track_id"]) not in known_ids and recording_key not in known_recordings:
                    result_rows.append(row)
                    known_ids.add(str(row["track_id"]))
                    known_recordings.add(recording_key)
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
def recommend(req: RecommendRequest, request: Request):
    if _hybrid_model is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    if req.track_id.startswith("apple-"):
        if req.mode not in RECOMMENDATION_MODES:
            raise HTTPException(status_code=422, detail="Unknown recommendation mode")
        anchor_match = _catalog_df[_catalog_df["track_id"].astype(str) == req.track_id]
        anchor = anchor_match.iloc[0].to_dict() if not anchor_match.empty else _live_tracks.get(req.track_id)
        if anchor is None:
            raise HTTPException(status_code=404, detail=f"Track '{req.track_id}' not found")
        weights = req.weights or MODE_WEIGHTS["similar"]
        if set(weights) != set(HYBRID_WEIGHTS) or any(value < 0 for value in weights.values()):
            raise HTTPException(status_code=400, detail="Weights must contain non-negative rhythm, timbre, and harmony values")
        if abs(sum(weights.values()) - 1.0) > 0.01:
            raise HTTPException(status_code=400, detail="Recommendation weights must sum to 1.0")
        user = optional_user(request)
        access_token = user.get("_access_token") if user else None
        user_seen = seen_track_ids(user["id"], access_token) if user else set()
        preferences = taste_profile(user["id"], access_token) if user else None
        if _acoustic_index is None:
            raise HTTPException(status_code=503, detail="Acoustic fingerprint index is unavailable")
        try:
            _acoustic_index.ensure_minimum(_catalog_df, minimum=max(req.k + 6, 18))
            recs = _acoustic_index.recommendations(
                anchor, _catalog_df, k=req.k, mode=req.mode, seen_track_ids=user_seen,
                favorite_track_ids=preferences.get("track_ids", set()) if preferences else set(),
                disliked_track_ids=preferences.get("disliked_track_ids", set()) if preferences else set(),
                weights=(weights["audio"], weights["lyric"], weights["collab"]),
                genre_scope=req.genre_scope, vibe_lock=req.vibe_lock,
            )
        except (requests.RequestException, ValueError) as error:
            raise HTTPException(status_code=422, detail=f"MuRec2 could not analyze this track's audio: {error}") from error
        if len(recs) < req.k:
            raise HTTPException(
                status_code=503,
                detail=f"The acoustic index is still warming up ({len(recs)} matches ready). Keep the backend running and try again shortly.",
            )
        anchor_fingerprint = _acoustic_index.get(str(anchor["track_id"]))
        if anchor_fingerprint:
            anchor["genre"] = "MuRec2 acoustic"
            anchor["subgenre"] = anchor_fingerprint["acoustic_signature"]
            anchor["acoustic_signature"] = anchor_fingerprint["acoustic_signature"]
            anchor["analysis_status"] = "complete"
        response_weights = weights if req.mode == "similar" else MODE_WEIGHTS[req.mode]
        if user:
            record_recommendation(user["id"], anchor, req.mode, response_weights, recs, access_token)
        return RecommendListResponse(
            anchor=_row_to_track(anchor),
            recommendations=[RecommendationResponse(**item) for item in recs],
            weights_used=response_weights,
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
    upload_track_id = f"upload-{hashlib.sha256(payload).hexdigest()[:12]}"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(payload)
            temporary_path = Path(temporary.name)
        raw_vector, profile = analyze_audio(temporary_path)
        if _acoustic_index is None:
            raise ValueError("Acoustic fingerprint index is unavailable")
        _acoustic_index.put(upload_track_id, raw_vector, profile)
        _acoustic_index.ensure_minimum(_catalog_df, minimum=max(k + 6, 18))
        upload_anchor = {
            "track_id": upload_track_id,
            "title": title.strip() or Path(file.filename or "Unknown song").stem,
            "artist": "Uploaded audio",
            "preview_url": "",
        }
        recommendations = _acoustic_index.recommendations(upload_anchor, _catalog_df, k=k, mode="similar")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Could not decode or analyze this audio: {error}") from error
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    anchor = TrackResponse(
        track_id=upload_track_id,
        title=title.strip() or Path(file.filename or "Unknown song").stem,
        artist="Uploaded audio",
        genre="MuRec2 acoustic",
        subgenre=profile["acoustic_signature"],
        bpm=round(profile["bpm"]),
        energy=round(profile["energy"]),
        timbre=profile["timbre"],
        acoustic_signature=profile["acoustic_signature"],
        analysis_status="complete",
    )
    return AnalyzeResponse(
        anchor=anchor,
        recommendations=[RecommendationResponse(**item) for item in recommendations],
        audio_profile=profile,
        total=len(recommendations),
    )
