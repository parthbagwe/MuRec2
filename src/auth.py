"""Authentication helpers using Argon2 password hashes and signed session cookies."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import secrets

from fastapi import HTTPException, Request, Response
import jwt
from pwdlib import PasswordHash

from src.config import ROOT_DIR
from src.user_store import get_user
from src import supabase_store

COOKIE_NAME = "murec2_session"
SESSION_DAYS = 30
PASSWORD_HASH = PasswordHash.recommended()


def _session_secret() -> str:
    configured = os.getenv("MUREC2_SECRET_KEY")
    if configured:
        return configured
    path = Path(ROOT_DIR) / "data" / ".session-secret"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    value = secrets.token_urlsafe(48)
    path.write_text(value, encoding="utf-8")
    return value


SECRET_KEY = _session_secret()


def hash_password(password: str) -> str:
    return PASSWORD_HASH.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return PASSWORD_HASH.verify(password, password_hash)


def issue_session(response: Response, user_id: str) -> None:
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    token = jwt.encode({"sub": user_id, "exp": expires}, SECRET_KEY, algorithm="HS256")
    response.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_DAYS * 86400, httponly=True,
        secure=os.getenv("MUREC2_COOKIE_SECURE", "0") == "1", samesite="lax", path="/",
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", samesite="lax")


def optional_user(request: Request) -> dict | None:
    authorization = request.headers.get("Authorization", "")
    if supabase_store.configured() and authorization.startswith("Bearer "):
        access_token = authorization.removeprefix("Bearer ").strip()
        return supabase_store.verify_access_token(access_token) if access_token else None
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user_id = str(payload.get("sub", ""))
    except jwt.InvalidTokenError:
        return None
    return get_user(user_id) if user_id else None


def require_user(request: Request) -> dict:
    user = optional_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to use this feature")
    return user
