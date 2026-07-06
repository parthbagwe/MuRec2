"""
Content-based recommendation model.

Concatenates the audio matrix (28-dim) and lyric matrix (12-dim) into a
single 40-dim combined vector per track, then builds a k-NN index using
cosine similarity. This is the model that answers "which songs sound and
mean something similar to this one?"
"""

import numpy as np
import pandas as pd
import joblib
from sklearn.neighbors import NearestNeighbors

from src.config import (
    TRACKS_CLEAN_PATH, AUDIO_MATRIX_PATH, LYRIC_MATRIX_PATH,
    COMBINED_MATRIX_PATH, CONTENT_MODEL_PATH, MAX_TOP_K,
)


class ContentModel:
    def __init__(self):
        self.df: pd.DataFrame | None = None
        self.audio_matrix: np.ndarray | None = None
        self.lyric_matrix: np.ndarray | None = None
        self.combined_matrix: np.ndarray | None = None
        self.nn_index: NearestNeighbors | None = None
        self.track_id_to_idx: dict[str, int] = {}

    def fit(self):
        self.df = pd.read_csv(TRACKS_CLEAN_PATH)
        self.audio_matrix = np.load(AUDIO_MATRIX_PATH)
        self.lyric_matrix = np.load(LYRIC_MATRIX_PATH)

        if len(self.df) != self.audio_matrix.shape[0]:
            raise ValueError(
                f"Row mismatch: df has {len(self.df)} rows, "
                f"audio matrix has {self.audio_matrix.shape[0]}"
            )

        self.combined_matrix = np.hstack([self.audio_matrix, self.lyric_matrix])
        np.save(COMBINED_MATRIX_PATH, self.combined_matrix)

        self.track_id_to_idx = {tid: i for i, tid in enumerate(self.df["track_id"])}

        self.nn_index = NearestNeighbors(
            n_neighbors=MAX_TOP_K + 1,  # +1 because the song itself is always the nearest match
            metric="cosine",
        )
        self.nn_index.fit(self.combined_matrix)

        print(f"Content model fitted on {self.combined_matrix.shape[0]} tracks, "
              f"{self.combined_matrix.shape[1]}-dim combined vectors")
        return self

    def recommend(self, track_id: str, k: int = 10) -> list[dict]:
        if track_id not in self.track_id_to_idx:
            raise KeyError(f"track_id '{track_id}' not found")

        idx = self.track_id_to_idx[track_id]
        query_vec = self.combined_matrix[idx].reshape(1, -1)

        distances, indices = self.nn_index.kneighbors(query_vec, n_neighbors=min(k + 1, MAX_TOP_K + 1))

        results = []
        for dist, neighbor_idx in zip(distances[0], indices[0]):
            if neighbor_idx == idx:
                continue  # skip the song itself
            similarity = 1 - dist  # cosine distance -> similarity
            row = self.df.iloc[neighbor_idx]

            # Per-component breakdown for transparency
            audio_sim = self._cosine(self.audio_matrix[idx], self.audio_matrix[neighbor_idx])
            lyric_sim = self._cosine(self.lyric_matrix[idx], self.lyric_matrix[neighbor_idx])

            results.append({
                "track_id": row["track_id"],
                "title": row["title"],
                "artist": row["artist"],
                "genre": row["genre"],
                "content_similarity": round(float(similarity), 4),
                "audio_similarity": round(float(audio_sim), 4),
                "lyric_similarity": round(float(lyric_sim), 4),
            })
            if len(results) >= k:
                break

        return results

    @staticmethod
    def _cosine(a: np.ndarray, b: np.ndarray) -> float:
        denom = (np.linalg.norm(a) * np.linalg.norm(b))
        return float(np.dot(a, b) / denom) if denom != 0 else 0.0

    def save(self, path=CONTENT_MODEL_PATH):
        joblib.dump(self, path)
        print(f"Saved content model: {path}")

    @staticmethod
    def load(path=CONTENT_MODEL_PATH) -> "ContentModel":
        return joblib.load(path)


if __name__ == "__main__":
    model = ContentModel().fit()
    model.save()

    sample_id = model.df.iloc[0]["track_id"]
    sample_title = model.df.iloc[0]["title"]
    print(f"\nTest recommendation for '{sample_title}' ({sample_id}):")
    for rec in model.recommend(sample_id, k=5):
        print(f"  {rec['title']} — {rec['artist']} | content={rec['content_similarity']} "
              f"audio={rec['audio_similarity']} lyric={rec['lyric_similarity']}")