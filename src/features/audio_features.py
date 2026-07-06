import numpy as np
import pandas as pd
import joblib
from src.config import (
    TRACKS_CLEAN_PATH, AUDIO_FEATURE_COLUMNS, AUDIO_MATRIX_PATH, SCALER_PATH
)
from sklearn.preprocessing import StandardScaler
def build_audio_matrix() -> np.ndarray:
    df = pd.read_csv(TRACKS_CLEAN_PATH)
    missing = [c for c in AUDIO_FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing audio columns: {missing}")
    raw_matrix = df[AUDIO_FEATURE_COLUMNS].values.astype(float)
    scaler = StandardScaler()
    scaled_matrix = scaler.fit_transform(raw_matrix)
    np.save(AUDIO_MATRIX_PATH, scaled_matrix)
    joblib.dump(scaler, SCALER_PATH)
    print(f"Audio matrix shape: {scaled_matrix.shape}")
    print(f"Saved matrix: {AUDIO_MATRIX_PATH}")
    print(f"Saved scaler: {SCALER_PATH}")
    print(f"Feature means after scaling (should be ~0): {scaled_matrix.mean(axis=0)[:3].round(3)}")
    print(f"Feature stds after scaling (should be ~1): {scaled_matrix.std(axis=0)[:3].round(3)}")
    return scaled_matrix
if __name__ == "__main__":
    build_audio_matrix()