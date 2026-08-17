from fastapi.testclient import TestClient
from contextlib import contextmanager
import io
import uuid
import wave

import numpy as np

from src.api.main import app


class FakeAcousticIndex:
    signature = "driving · dense-balanced · steady-pulse · dark-minor · fast-drive"

    def get(self, track_id):
        return {"track_id": str(track_id), "acoustic_signature": self.signature, "profile": {"acoustic_signature": self.signature}}

    def all(self):
        return {}

    def status(self, total_tracks):
        return {"indexed": total_tracks, "total": total_tracks, "remaining": 0, "failures": 0, "building": False}

    def ensure_minimum(self, catalog, minimum=18):
        return None

    def put(self, track_id, vector, profile):
        return {"track_id": track_id, "vector": vector, "profile": profile, "acoustic_signature": profile["acoustic_signature"]}

    def recommendations(self, anchor, catalog, k=12, mode="similar", **_):
        results = []
        for row in catalog.to_dict("records"):
            if str(row["track_id"]) == str(anchor["track_id"]):
                continue
            results.append({
                "track_id": str(row["track_id"]), "title": row["title"], "artist": row["artist"],
                "genre": "MuRec2 acoustic", "subgenre": self.signature, "year": int(row["year"]) if not np.isnan(row["year"]) else None,
                "album": row.get("album"), "artwork_url": row.get("artwork_url"), "preview_url": row.get("preview_url"),
                "external_url": row.get("external_url"), "source": row.get("source"),
                "audio_similarity": .91, "lyric_similarity": .84, "collab_similarity": .79,
                "hybrid_score": .86, "score_mode": f"acoustic-fingerprint-{mode}",
            })
            if len(results) >= k:
                break
        return results


@contextmanager
def api_client():
    with TestClient(app) as client:
        from src.api import routes, user_routes
        fake_index = FakeAcousticIndex()
        routes._acoustic_index = fake_index
        user_routes._acoustic_index = fake_index
        yield client


def test_health_search_and_recommendation():
    with api_client() as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["models_loaded"] is True
        assert health.json()["total_tracks"] >= 100

        search = client.get("/api/tracks", params={"page_size": 2})
        assert search.status_code == 200
        track = search.json()["results"][0]
        assert track["source"] == "Apple Music"
        assert track["genre"] == "MuRec2 acoustic"
        assert track["subgenre"] == FakeAcousticIndex.signature
        assert track["preview_url"].startswith("https://")

        recommendations = client.post("/api/recommend", json={"track_id": track["track_id"], "k": 5})
        assert recommendations.status_code == 200
        payload = recommendations.json()
        assert len(payload["recommendations"]) == 5
        assert payload["anchor"]["track_id"] == track["track_id"]
        assert payload["recommendations"][0]["score_mode"] == "acoustic-fingerprint-similar"
        assert all(item["preview_url"].startswith("https://") for item in payload["recommendations"])


def test_provider_genres_are_not_used_for_ranking():
    with api_client() as client:
        search = client.get("/api/tracks", params={"q": "Duality Slipknot", "page_size": 10})
        assert search.status_code == 200
        search_results = search.json()["results"]
        recording_keys = {(item["title"].casefold(), item["artist"].casefold()) for item in search_results}
        assert len(recording_keys) == len(search_results)
        duality = next(
            item for item in search_results
            if item["title"] == "Duality" and item["artist"] == "Slipknot"
        )
        assert duality["genre"] == "MuRec2 acoustic"
        assert "metal" not in duality["subgenre"]

        response = client.post("/api/recommend", json={"track_id": duality["track_id"], "k": 20, "mode": "timbre"})
        assert response.status_code == 200
        recommendations = response.json()["recommendations"]
        assert all(not (item["title"] == "Duality" and item["artist"] == "Slipknot") for item in recommendations)
        assert all(item["score_mode"] == "acoustic-fingerprint-timbre" for item in recommendations)
        assert all(item["subgenre"] == FakeAcousticIndex.signature for item in recommendations)


def test_invalid_weights_are_rejected():
    with api_client() as client:
        response = client.post(
            "/api/recommend",
            json={"track_id": "demo-0001", "weights": {"audio": 1, "lyric": 1, "collab": -1}},
        )
        assert response.status_code == 400


def test_unknown_audio_is_analyzed_and_recommended():
    sample_rate = 22_050
    time = np.arange(sample_rate * 3) / sample_rate
    audio = (np.sin(2 * np.pi * 440 * time) * 16_000).astype(np.int16)
    payload = io.BytesIO()
    with wave.open(payload, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio.tobytes())

    with api_client() as client:
        response = client.post(
            "/api/analyze",
            data={"title": "Uncatalogued test tone", "k": "5"},
            files={"file": ("tone.wav", payload.getvalue(), "audio/wav")},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["anchor"]["title"] == "Uncatalogued test tone"
        assert len(result["recommendations"]) == 5
        assert all(item["source"] == "Apple Music" for item in result["recommendations"])
        assert result["audio_profile"]["spectral_centroid_hz"] > 0
        assert 40 <= result["audio_profile"]["bpm"] <= 300
        assert result["audio_profile"]["texture"]
        assert result["audio_profile"]["rhythm_character"]
        assert result["audio_profile"]["harmonic_character"]


def test_account_favorites_and_recommendation_history(monkeypatch, tmp_path):
    import src.user_store as user_store
    monkeypatch.setattr(user_store, "DB_PATH", tmp_path / "test-users.db")
    email = f"test-{uuid.uuid4()}@example.test"
    with api_client() as client:
        registration = client.post("/api/auth/register", json={
            "display_name": "Test listener", "email": email, "password": "a-safe-test-password",
        })
        assert registration.status_code == 201
        assert registration.json()["user"]["display_name"] == "Test listener"
        assert client.get("/api/auth/me").status_code == 200

        track = client.get("/api/tracks", params={"page_size": 1}).json()["results"][0]
        favorite = client.post("/api/me/favorites", json={"track_id": track["track_id"]})
        assert favorite.status_code == 201
        favorites = client.get("/api/me/favorites").json()["favorites"]
        assert favorites[0]["track_id"] == track["track_id"]

        recommendation = client.post("/api/recommend", json={
            "track_id": track["track_id"], "k": 5, "mode": "discover",
        })
        assert recommendation.status_code == 200
        assert recommendation.json()["recommendations"][0]["score_mode"] == "acoustic-fingerprint-discover"
        history = client.get("/api/me/history").json()["history"]
        assert history[0]["anchor_track_id"] == track["track_id"]
        assert history[0]["mode"] == "discover"
        assert len(history[0]["suggestions"]) == 5

        assert client.delete(f"/api/me/favorites/{track['track_id']}").status_code == 204
        assert client.get("/api/me/favorites").json()["favorites"] == []
        assert client.post("/api/auth/logout").status_code == 204
        assert client.get("/api/auth/me").status_code == 401
