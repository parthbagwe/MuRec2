"""Supabase Auth verification and RLS-scoped persistence for MuRec2 users."""

from __future__ import annotations

import os
from typing import Any

import requests


SUPABASE_URL = os.getenv("MUREC2_SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("MUREC2_SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = os.getenv("MUREC2_SUPABASE_SECRET_KEY", "")


class SupabaseStoreError(RuntimeError):
    pass


def configured() -> bool:
    return SUPABASE_URL.startswith("https://") and bool(SUPABASE_KEY)


def _headers(access_token: str, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _request(
    method: str,
    path: str,
    access_token: str,
    *,
    params: dict[str, Any] | None = None,
    payload: Any = None,
    prefer: str | None = None,
) -> Any:
    if not configured():
        raise SupabaseStoreError("Supabase is not configured")
    response = requests.request(
        method,
        f"{SUPABASE_URL}{path}",
        headers=_headers(access_token, prefer),
        params=params,
        json=payload,
        timeout=(5, 20),
    )
    if response.status_code >= 400:
        try:
            detail = response.json().get("message") or response.json().get("msg")
        except (ValueError, AttributeError):
            detail = response.text
        raise SupabaseStoreError(detail or f"Supabase returned HTTP {response.status_code}")
    return response.json() if response.content else None


def verify_access_token(access_token: str) -> dict | None:
    try:
        auth_user = _request("GET", "/auth/v1/user", access_token)
    except (requests.RequestException, SupabaseStoreError):
        return None
    if not auth_user or not auth_user.get("id"):
        return None

    user_id = auth_user["id"]
    profiles = _request(
        "GET", "/rest/v1/profiles", access_token,
        params={"id": f"eq.{user_id}", "select": "id,display_name,personalization_enabled,created_at"},
    )
    if profiles:
        profile = profiles[0]
    else:
        metadata = auth_user.get("user_metadata") or {}
        email = str(auth_user.get("email") or "listener")
        display_name = str(metadata.get("display_name") or email.split("@", 1)[0])[:60].strip() or "Listener"
        created = _request(
            "POST", "/rest/v1/profiles", access_token,
            payload={"id": user_id, "display_name": display_name},
            prefer="return=representation",
        )
        profile = created[0]
    return {
        **profile,
        "email": auth_user.get("email"),
        "_access_token": access_token,
    }


def list_favorites(access_token: str) -> list[dict]:
    return _request(
        "GET", "/rest/v1/favorites", access_token,
        params={
            "select": "track_id,title,artist,subgenre,artwork_url,preview_url,external_url,created_at",
            "order": "created_at.desc",
        },
    ) or []


def add_favorite(user_id: str, track: dict, access_token: str) -> None:
    _request(
        "POST", "/rest/v1/favorites", access_token,
        payload={
            "user_id": user_id,
            "track_id": str(track["track_id"]),
            "title": track["title"],
            "artist": track["artist"],
            "subgenre": track.get("subgenre"),
            "artwork_url": track.get("artwork_url"),
            "preview_url": track.get("preview_url"),
            "external_url": track.get("external_url"),
        },
        prefer="resolution=merge-duplicates,return=minimal",
    )


def remove_favorite(user_id: str, track_id: str, access_token: str) -> None:
    _request(
        "DELETE", "/rest/v1/favorites", access_token,
        params={"user_id": f"eq.{user_id}", "track_id": f"eq.{track_id}"},
    )


def record_recommendation(
    user_id: str, anchor: dict, mode: str, weights: dict, items: list[dict], access_token: str,
) -> None:
    runs = _request(
        "POST", "/rest/v1/recommendation_runs", access_token,
        payload={
            "user_id": user_id,
            "anchor_track_id": str(anchor["track_id"]),
            "anchor_title": anchor["title"],
            "anchor_artist": anchor["artist"],
            "mode": mode,
            "weights": weights,
        },
        prefer="return=representation",
    )
    run_id = runs[0]["id"]
    payload = [
        {
            "run_id": run_id,
            "track_id": str(item["track_id"]),
            "title": item["title"],
            "artist": item["artist"],
            "subgenre": item.get("subgenre"),
            "rank": rank,
            "score": item["hybrid_score"],
        }
        for rank, item in enumerate(items, start=1)
    ]
    try:
        _request("POST", "/rest/v1/recommendation_items", access_token, payload=payload)
    except Exception:
        _request("DELETE", "/rest/v1/recommendation_runs", access_token, params={"id": f"eq.{run_id}"})
        raise


def list_history(access_token: str, limit: int = 30) -> list[dict]:
    runs = _request(
        "GET", "/rest/v1/recommendation_runs", access_token,
        params={
            "select": "id,anchor_track_id,anchor_title,anchor_artist,mode,created_at",
            "order": "created_at.desc",
            "limit": str(limit),
        },
    ) or []
    if not runs:
        return []
    run_ids = ",".join(str(run["id"]) for run in runs)
    items = _request(
        "GET", "/rest/v1/recommendation_items", access_token,
        params={
            "select": "run_id,track_id,title,artist,subgenre,rank,score",
            "run_id": f"in.({run_ids})",
            "order": "rank.asc",
        },
    ) or []
    by_run: dict[int, list[dict]] = {}
    for item in items:
        by_run.setdefault(item.pop("run_id"), []).append(item)
    return [{**run, "suggestions": by_run.get(run["id"], [])[:12]} for run in runs]


def clear_history(user_id: str, access_token: str) -> None:
    _request("DELETE", "/rest/v1/recommendation_runs", access_token, params={"user_id": f"eq.{user_id}"})
    _request("DELETE", "/rest/v1/interactions", access_token, params={"user_id": f"eq.{user_id}"})


def record_interaction(user_id: str, track_id: str, event_type: str, value: float | None, access_token: str) -> None:
    _request(
        "POST", "/rest/v1/interactions", access_token,
        payload={"user_id": user_id, "track_id": track_id, "event_type": event_type, "value": value},
    )


def seen_track_ids(access_token: str) -> set[str]:
    items = _request("GET", "/rest/v1/recommendation_items", access_token, params={"select": "track_id"}) or []
    interactions = _request("GET", "/rest/v1/interactions", access_token, params={"select": "track_id"}) or []
    return {str(item["track_id"]) for item in [*items, *interactions]}


def taste_profile(access_token: str) -> dict[str, set[str]]:
    favorites = list_favorites(access_token)
    interactions = _request(
        "GET", "/rest/v1/interactions", access_token,
        params={"select": "track_id,event_type"},
    ) or []
    positive_events = {"liked", "preview_completed", "youtube_opened"}
    negative_events = {"disliked", "dismissed"}
    favorite_ids = {str(item["track_id"]) for item in favorites}
    return {
        "subgenres": {str(item["subgenre"]).lower() for item in favorites if item.get("subgenre")},
        "artists": {str(item["artist"]).lower() for item in favorites if item.get("artist")},
        "track_ids": favorite_ids | {
            str(item["track_id"]) for item in interactions if item.get("event_type") in positive_events
        },
        "disliked_track_ids": {
            str(item["track_id"]) for item in interactions if item.get("event_type") in negative_events
        },
    }


def sync_fingerprint(track_id: str, vector: list[float], profile: dict, acoustic_signature: str) -> bool:
    """Mirror a newly derived fingerprint when a backend-only secret key is configured."""
    if not configured() or not SUPABASE_SECRET_KEY:
        return False
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/acoustic_fingerprints?on_conflict=track_id",
        headers={
            "apikey": SUPABASE_SECRET_KEY,
            "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={
            "track_id": str(track_id),
            "vector": vector,
            "profile": profile,
            "acoustic_signature": acoustic_signature,
        },
        timeout=(5, 20),
    )
    if response.status_code >= 400:
        raise SupabaseStoreError(f"Could not sync fingerprint {track_id}: {response.text[:300]}")
    return True
