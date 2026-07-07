"""
Collaborative filtering model using ALS (Alternating Least Squares).

Since we don't have real user listening logs, we build a SYNTHETIC
interaction matrix: we simulate "users" as listener archetypes biased
toward certain genres/themes, and generate plausible play counts. This
mimics what real user-item data looks like and lets you build + test
the ALS pipeline now. When you plug in real Last.fm data later, this
file's build_synthetic_interactions() is the only function you replace.
"""

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
import joblib

try:
    from implicit.als import AlternatingLeastSquares
except ImportError:
    raise ImportError("Run: pip install implicit")

from src.config import (
    TRACKS_CLEAN_PATH, COLLAB_MODEL_PATH, ALS_FACTORS,
    ALS_REGULARIZATION, ALS_ITERATIONS, RANDOM_SEED,
)

N_SYNTHETIC_USERS = 800
INTERACTIONS_PER_USER = (15, 60)  # min, max songs each user has played


def build_synthetic_interactions(df: pd.DataFrame) -> csr_matrix:
    """
    Simulates user listening behaviour: each synthetic user has a
    preferred genre and theme pool, and is more likely to play tracks
    matching those preferences — exactly how real listeners cluster.
    """
    rng = np.random.default_rng(RANDOM_SEED)
    n_tracks = len(df)

    genres = df["genre"].unique()
    theme_pools = df["primary_theme_pool"].unique()

    rows, cols, data = [], [], []

    for user_id in range(N_SYNTHETIC_USERS):
        pref_genre = rng.choice(genres)
        pref_theme = rng.choice(theme_pools)

        # Tracks matching preference get boosted probability of being played
        match_mask = (df["genre"] == pref_genre) | (df["primary_theme_pool"] == pref_theme)
        weights = np.where(match_mask, 5.0, 0.5)
        weights = weights / weights.sum()

        n_interactions = rng.integers(*INTERACTIONS_PER_USER)
        track_indices = rng.choice(n_tracks, size=n_interactions, replace=False, p=weights)

        for track_idx in track_indices:
            play_count = rng.integers(1, 25)
            rows.append(user_id)
            cols.append(track_idx)
            data.append(play_count)

    matrix = csr_matrix((data, (rows, cols)), shape=(N_SYNTHETIC_USERS, n_tracks))
    print(f"Synthetic interaction matrix: {matrix.shape}, "
          f"{matrix.nnz} interactions, density={matrix.nnz / (matrix.shape[0]*matrix.shape[1]):.4f}")
    return matrix


class CollabModel:
    def __init__(self):
        self.df: pd.DataFrame | None = None
        self.als_model: AlternatingLeastSquares | None = None
        self.item_factors: np.ndarray | None = None
        self.track_id_to_idx: dict[str, int] = {}

    def fit(self):
        self.df = pd.read_csv(TRACKS_CLEAN_PATH)
        interactions = build_synthetic_interactions(self.df)

        self.als_model = AlternatingLeastSquares(
            factors=ALS_FACTORS,
            regularization=ALS_REGULARIZATION,
            iterations=ALS_ITERATIONS,
            random_state=RANDOM_SEED,
        )
        # implicit expects item-user matrix (transpose of user-item)
        self.als_model.fit(interactions)

        self.item_factors = self.als_model.item_factors
        self.track_id_to_idx = {tid: i for i, tid in enumerate(self.df["track_id"])}

        print(f"ALS fitted. Item factors shape: {self.item_factors.shape}")
        return self

    def recommend(self, track_id: str, k: int = 10) -> list[dict]:
        if track_id not in self.track_id_to_idx:
            raise KeyError(f"track_id '{track_id}' not found")

        idx = self.track_id_to_idx[track_id]
        query_vec = self.item_factors[idx]

        norms = np.linalg.norm(self.item_factors, axis=1)
        query_norm = np.linalg.norm(query_vec)
        denom = norms * query_norm
        denom[denom == 0] = 1e-10

        sims = (self.item_factors @ query_vec) / denom
        top_indices = np.argsort(-sims)[:k + 1]

        results = []
        for i in top_indices:
            if i == idx:
                continue
            row = self.df.iloc[i]
            results.append({
                "track_id": row["track_id"],
                "title": row["title"],
                "artist": row["artist"],
                "genre": row["genre"],
                "collab_similarity": round(float(sims[i]), 4),
            })
            if len(results) >= k:
                break

        return results

    def save(self, path=COLLAB_MODEL_PATH):
        joblib.dump(self, path)
        print(f"Saved collab model: {path}")

    @staticmethod
    def load(path=COLLAB_MODEL_PATH) -> "CollabModel":
        return joblib.load(path)


if __name__ == "__main__":
    model = CollabModel().fit()
    model.save()

    sample_id = model.df.iloc[0]["track_id"]
    sample_title = model.df.iloc[0]["title"]
    print(f"\nTest recommendation for '{sample_title}' ({sample_id}):")
    for rec in model.recommend(sample_id, k=5):
        print(f"  {rec['title']} — {rec['artist']} | collab={rec['collab_similarity']}")