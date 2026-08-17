"""Account, favourites, history, and interaction endpoints."""

from __future__ import annotations

import math
import sqlite3

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from src.auth import clear_session, hash_password, issue_session, require_user, verify_password
from src.user_store import (
    add_favorite, clear_history, create_user, get_user_with_password,
    list_favorites, list_history, record_interaction, remove_favorite,
)

router = APIRouter()
_catalog_df = None

ALLOWED_EVENTS = {
    "selected", "preview_started", "preview_completed", "youtube_opened",
    "liked", "disliked", "dismissed",
}


def init_user_routes(catalog_df) -> None:
    global _catalog_df
    _catalog_df = catalog_df


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=60)


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)


class FavoriteRequest(BaseModel):
    track_id: str


class InteractionRequest(BaseModel):
    track_id: str
    event_type: str
    value: float | None = None


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"], "email": user["email"], "display_name": user["display_name"],
        "personalization_enabled": bool(user.get("personalization_enabled", 1)),
        "created_at": user["created_at"],
    }


def _clean(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return value


def _find_track(track_id: str) -> dict | None:
    if _catalog_df is None:
        return None
    match = _catalog_df[_catalog_df["track_id"].astype(str) == track_id]
    if match.empty:
        return None
    row = match.iloc[0].to_dict()
    return {
        "track_id": str(row["track_id"]), "title": row["title"], "artist": row["artist"],
        "subgenre": _clean(row.get("subgenre")), "artwork_url": _clean(row.get("artwork_url")),
        "preview_url": _clean(row.get("preview_url")), "external_url": _clean(row.get("external_url")),
    }


@router.post("/auth/register", status_code=201)
def register(payload: RegisterRequest, response: Response):
    email = payload.email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    display_name = payload.display_name.strip() or email.split("@", 1)[0]
    try:
        user = create_user(email, display_name, hash_password(payload.password))
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="An account already exists for this email") from error
    issue_session(response, user["id"])
    return {"user": _public_user(user)}


@router.post("/auth/login")
def login(payload: LoginRequest, response: Response):
    account = get_user_with_password(payload.email.strip().lower())
    if account is None or not verify_password(payload.password, account["password_hash"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    issue_session(response, account["id"])
    return {"user": _public_user(account)}


@router.post("/auth/logout", status_code=204)
def logout(response: Response):
    clear_session(response)


@router.get("/auth/me")
def me(request: Request):
    return {"user": _public_user(require_user(request))}


@router.get("/me/favorites")
def favorites(request: Request):
    user = require_user(request)
    return {"favorites": list_favorites(user["id"])}


@router.post("/me/favorites", status_code=201)
def favorite_track(payload: FavoriteRequest, request: Request):
    user = require_user(request)
    track = _find_track(payload.track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="This track is not available in the local catalogue")
    add_favorite(user["id"], track)
    record_interaction(user["id"], payload.track_id, "liked")
    return {"favorite": track}


@router.delete("/me/favorites/{track_id}", status_code=204)
def unfavorite_track(track_id: str, request: Request):
    user = require_user(request)
    remove_favorite(user["id"], track_id)


@router.get("/me/history")
def history(request: Request, limit: int = Query(default=30, ge=1, le=100)):
    user = require_user(request)
    return {"history": list_history(user["id"], limit=limit)}


@router.delete("/me/history", status_code=204)
def delete_history(request: Request):
    user = require_user(request)
    clear_history(user["id"])


@router.post("/events", status_code=202)
def event(payload: InteractionRequest, request: Request):
    user = require_user(request)
    if payload.event_type not in ALLOWED_EVENTS:
        raise HTTPException(status_code=422, detail="Unsupported interaction event")
    record_interaction(user["id"], payload.track_id, payload.event_type, payload.value)
    return {"recorded": True}
