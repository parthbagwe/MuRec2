"""
The hybrid fusion layer.

Combines content-based scores (audio + lyric, already blended inside
ContentModel) with collaborative filtering scores, using the weights
defined in config.py. Handles cold-start: if a track has no meaningful
collaborative signal, falls back to content-only scoring.
"""

import pandas as pd

from src.config import HYBRID_WEIGHTS, DEFAULT_TOP_K, MAX_TOP_K
from src.models.content_model import ContentModel
from src.models.collab_model import CollabModel


class HybridModel:
    def __init__(self, content_model: ContentModel, collab_model: CollabModel):
        self.content_model = content_model
        self.collab_model = collab_model

    def recommend(self, track_id: str, k: int = DEFAULT_TOP_K,
                  weights: dict | None = None) -> list[dict]:
        w = weights or HYBRID_WEIGHTS
        if set(w) != set(HYBRID_WEIGHTS) or any(value < 0 for value in w.values()):
            raise ValueError("Weights must contain non-negative audio, lyric, and collab values")
        if abs(sum(w.values()) - 1.0) >= 1e-6:
            raise ValueError("Weights must sum to 1.0")

        # Pull a generous candidate pool from each model so the hybrid
        # re-ranking has enough songs to choose from
        pool_k = min(MAX_TOP_K, k * 3)

        content_results = {
            r["track_id"]: r for r in self.content_model.recommend(track_id, k=pool_k)
        }
        try:
            collab_results = {
                r["track_id"]: r for r in self.collab_model.recommend(track_id, k=pool_k)
            }
        except KeyError:
            collab_results = {}

        all_track_ids = set(content_results) | set(collab_results)

        scored = []
        for tid in all_track_ids:
            c = content_results.get(tid)
            col = collab_results.get(tid)

            audio_sim = c["audio_similarity"] if c else 0.0
            lyric_sim = c["lyric_similarity"] if c else 0.0
            collab_sim = col["collab_similarity"] if col else 0.0
            collab_sim = max(0.0, collab_sim)  # clip negative cosine to 0

            hybrid_score = (
                w["audio"] * audio_sim +
                w["lyric"] * lyric_sim +
                w["collab"] * collab_sim
            )

            meta = c or col
            scored.append({
                "track_id": tid,
                "title": meta["title"],
                "artist": meta["artist"],
                "genre": meta["genre"],
                "audio_similarity": round(audio_sim, 4),
                "lyric_similarity": round(lyric_sim, 4),
                "collab_similarity": round(collab_sim, 4),
                "hybrid_score": round(hybrid_score, 4),
            })

        scored.sort(key=lambda x: x["hybrid_score"], reverse=True)
        return scored[:k]


if __name__ == "__main__":
    content_model = ContentModel.load()
    collab_model = CollabModel.load()
    hybrid = HybridModel(content_model, collab_model)

    sample_id = content_model.df.iloc[0]["track_id"]
    sample_title = content_model.df.iloc[0]["title"]
    print(f"Hybrid recommendations for '{sample_title}' ({sample_id}):\n")

    for rec in hybrid.recommend(sample_id, k=10):
        print(f"  {rec['hybrid_score']:.3f} | {rec['title']} — {rec['artist']} ({rec['genre']}) "
              f"[audio={rec['audio_similarity']} lyric={rec['lyric_similarity']} collab={rec['collab_similarity']}]")
