from fastapi.testclient import TestClient
import io
import wave

import numpy as np

from src.api.main import app


def test_health_search_and_recommendation():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["models_loaded"] is True
        assert health.json()["total_tracks"] >= 100

        search = client.get("/api/tracks", params={"page_size": 2})
        assert search.status_code == 200
        track = search.json()["results"][0]
        assert track["source"] == "Apple Music"

        recommendations = client.post("/api/recommend", json={"track_id": track["track_id"], "k": 5})
        assert recommendations.status_code == 200
        payload = recommendations.json()
        assert len(payload["recommendations"]) == 5
        assert payload["anchor"]["track_id"] == track["track_id"]


def test_invalid_weights_are_rejected():
    with TestClient(app) as client:
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

    with TestClient(app) as client:
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
