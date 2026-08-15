"""
Builds the lyric feature vector for every track:
- One-hot encodes primary_theme_pool (10 dims)
- Appends vader_sentiment and arousal (2 dims)
Total: 12-dim lyric vector per track.

This is a lightweight stand-in for full SBERT embeddings — when you
move to real lyrics data (e.g. via Genius API), swap this file's
encode_themes() for a sentence-transformers call and everything
downstream (content_model.py) stays unchanged.
"""

import numpy as np
import pandas as pd

from src.config import TRACKS_CLEAN_PATH, THEME_POOLS, LYRIC_MATRIX_PATH


def build_lyric_matrix() -> np.ndarray:
    LYRIC_MATRIX_PATH.parent.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(TRACKS_CLEAN_PATH)

    # One-hot encode primary_theme_pool against the fixed list of 10 pools
    theme_onehot = np.zeros((len(df), len(THEME_POOLS)))
    for i, pool in enumerate(df["primary_theme_pool"]):
        if pool in THEME_POOLS:
            theme_onehot[i, THEME_POOLS.index(pool)] = 1.0

    sentiment = df["vader_sentiment"].values.reshape(-1, 1)
    arousal = df["arousal"].values.reshape(-1, 1)

    lyric_matrix = np.hstack([theme_onehot, sentiment, arousal])

    np.save(LYRIC_MATRIX_PATH, lyric_matrix)

    print(f"Lyric matrix shape: {lyric_matrix.shape}")
    print(f"Saved matrix: {LYRIC_MATRIX_PATH}")
    print(f"Theme pool columns: {THEME_POOLS}")
    print(f"Sample row: {lyric_matrix[0].round(2)}")

    return lyric_matrix


if __name__ == "__main__":
    build_lyric_matrix()
