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
        assert track["subgenre"]
        assert track["preview_url"].startswith("https://")

        recommendations = client.post("/api/recommend", json={"track_id": track["track_id"], "k": 5})
        assert recommendations.status_code == 200
        payload = recommendations.json()
        assert len(payload["recommendations"]) == 5
        assert payload["anchor"]["track_id"] == track["track_id"]
        assert all(item["preview_url"].startswith("https://") for item in payload["recommendations"])


def test_subgenres_separate_nu_metal_from_alternative_rock():
    with TestClient(app) as client:
        search = client.get("/api/tracks", params={"q": "Duality Slipknot", "page_size": 10})
        assert search.status_code == 200
        search_results = search.json()["results"]
        recording_keys = {(item["title"].casefold(), item["artist"].casefold()) for item in search_results}
        assert len(recording_keys) == len(search_results)
        duality = next(
            item for item in search_results
            if item["title"] == "Duality" and item["artist"] == "Slipknot"
        )
        assert duality["subgenre"] == "nu metal"

        response = client.post("/api/recommend", json={"track_id": duality["track_id"], "k": 20})
        assert response.status_code == 200
        recommendations = response.json()["recommendations"]
        assert all(not (item["title"] == "Duality" and item["artist"] == "Slipknot") for item in recommendations)
        assert all(item["title"] != "Lazarus (2017 Remaster)" for item in recommendations)
        assert recommendations[0]["audio_similarity"] >= recommendations[-1]["audio_similarity"]

        lazarus = client.get("/api/tracks", params={"q": "Lazarus Porcupine Tree", "page_size": 10})
        porcupine_tree = next(
            item for item in lazarus.json()["results"]
            if item["artist"] == "Porcupine Tree" and item["title"].startswith("Lazarus")
        )
        assert porcupine_tree["subgenre"] == "alternative rock"


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
