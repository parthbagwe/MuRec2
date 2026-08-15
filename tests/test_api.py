from fastapi.testclient import TestClient

from src.api.main import app


def test_health_search_and_recommendation():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["models_loaded"] is True
        assert health.json()["total_tracks"] >= 100

        search = client.get("/api/tracks", params={"q": "Midnight", "page_size": 2})
        assert search.status_code == 200
        track = search.json()["results"][0]

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
