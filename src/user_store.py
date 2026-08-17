"""Small SQLite persistence layer for local MuRec2 accounts and listening history."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import uuid

from src.config import ROOT_DIR

DB_PATH = ROOT_DIR / "data" / "murec2-users.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    try:
        yield db
        db.commit()
    finally:
        db.close()


def init_user_store() -> None:
    with connection() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                personalization_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS favorites (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                subgenre TEXT,
                artwork_url TEXT,
                preview_url TEXT,
                external_url TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, track_id)
            );
            CREATE TABLE IF NOT EXISTS recommendation_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                anchor_track_id TEXT NOT NULL,
                anchor_title TEXT NOT NULL,
                anchor_artist TEXT NOT NULL,
                mode TEXT NOT NULL,
                weights_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS recommendation_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                subgenre TEXT,
                rank INTEGER NOT NULL,
                score REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                value REAL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_runs_user_created ON recommendation_runs(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_items_track ON recommendation_items(track_id);
            CREATE INDEX IF NOT EXISTS idx_interactions_user_created ON interactions(user_id, created_at DESC);
        """)


def create_user(email: str, display_name: str, password_hash: str) -> dict:
    user_id = str(uuid.uuid4())
    with connection() as db:
        db.execute(
            "INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)",
            (user_id, email, display_name, password_hash, _now()),
        )
    return get_user(user_id)


def get_user(user_id: str) -> dict | None:
    with connection() as db:
        row = db.execute(
            "SELECT id,email,display_name,personalization_enabled,created_at FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def get_user_with_password(email: str) -> dict | None:
    with connection() as db:
        row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    return dict(row) if row else None


def add_favorite(user_id: str, track: dict) -> None:
    with connection() as db:
        db.execute("""
            INSERT INTO favorites(user_id,track_id,title,artist,subgenre,artwork_url,preview_url,external_url,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(user_id,track_id) DO UPDATE SET
              title=excluded.title, artist=excluded.artist, subgenre=excluded.subgenre,
              artwork_url=excluded.artwork_url, preview_url=excluded.preview_url,
              external_url=excluded.external_url
        """, (
            user_id, str(track["track_id"]), track["title"], track["artist"], track.get("subgenre"),
            track.get("artwork_url"), track.get("preview_url"), track.get("external_url"), _now(),
        ))


def remove_favorite(user_id: str, track_id: str) -> None:
    with connection() as db:
        db.execute("DELETE FROM favorites WHERE user_id=? AND track_id=?", (user_id, track_id))


def list_favorites(user_id: str) -> list[dict]:
    with connection() as db:
        rows = db.execute(
            "SELECT track_id,title,artist,subgenre,artwork_url,preview_url,external_url,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def record_recommendation(user_id: str, anchor: dict, mode: str, weights: dict, items: list[dict]) -> None:
    with connection() as db:
        cursor = db.execute("""
            INSERT INTO recommendation_runs(user_id,anchor_track_id,anchor_title,anchor_artist,mode,weights_json,created_at)
            VALUES(?,?,?,?,?,?,?)
        """, (
            user_id, str(anchor["track_id"]), anchor["title"], anchor["artist"], mode,
            json.dumps(weights, sort_keys=True), _now(),
        ))
        run_id = cursor.lastrowid
        db.executemany("""
            INSERT INTO recommendation_items(run_id,track_id,title,artist,subgenre,rank,score)
            VALUES(?,?,?,?,?,?,?)
        """, [
            (run_id, str(item["track_id"]), item["title"], item["artist"], item.get("subgenre"), rank, item["hybrid_score"])
            for rank, item in enumerate(items, start=1)
        ])


def list_history(user_id: str, limit: int = 30) -> list[dict]:
    with connection() as db:
        runs = db.execute("""
            SELECT id,anchor_track_id,anchor_title,anchor_artist,mode,created_at
            FROM recommendation_runs WHERE user_id=? ORDER BY created_at DESC LIMIT ?
        """, (user_id, limit)).fetchall()
        result = []
        for run in runs:
            items = db.execute("""
                SELECT track_id,title,artist,subgenre,rank,score
                FROM recommendation_items WHERE run_id=? ORDER BY rank LIMIT 12
            """, (run["id"],)).fetchall()
            result.append({**dict(run), "suggestions": [dict(item) for item in items]})
    return result


def clear_history(user_id: str) -> None:
    with connection() as db:
        db.execute("DELETE FROM recommendation_runs WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM interactions WHERE user_id=?", (user_id,))


def record_interaction(user_id: str, track_id: str, event_type: str, value: float | None = None) -> None:
    with connection() as db:
        db.execute(
            "INSERT INTO interactions(user_id,track_id,event_type,value,created_at) VALUES(?,?,?,?,?)",
            (user_id, track_id, event_type, value, _now()),
        )


def seen_track_ids(user_id: str) -> set[str]:
    with connection() as db:
        rows = db.execute("""
            SELECT track_id FROM recommendation_items ri
            JOIN recommendation_runs rr ON rr.id=ri.run_id WHERE rr.user_id=?
            UNION SELECT track_id FROM interactions WHERE user_id=?
        """, (user_id, user_id)).fetchall()
    return {str(row["track_id"]) for row in rows}


def taste_profile(user_id: str) -> dict[str, set[str]]:
    favorites = list_favorites(user_id)
    return {
        "subgenres": {str(item["subgenre"]).lower() for item in favorites if item.get("subgenre")},
        "artists": {str(item["artist"]).lower() for item in favorites if item.get("artist")},
        "track_ids": {str(item["track_id"]) for item in favorites},
    }
