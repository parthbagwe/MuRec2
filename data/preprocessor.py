import pandas as pd
from sklearn.preprocessing import LabelEncoder
import joblib
from src.config import (
    PROCESSED_DIR, TRACKS_CLEAN_PATH, CATEGORICAL_COLUMNS, MODELS_DIR
)
from data.loader import load_raw_dataset
def clean_and_encode(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Fill nulls, label-encode categoricals. Returns cleaned df + encoders."""
    df = df.copy()
    for col in ["theme_1", "theme_2", "theme_3", "theme_4"]:
        df[col] = df[col].fillna("none")
    encoders = {}
    for col in CATEGORICAL_COLUMNS:
        le = LabelEncoder()
        df[f"{col}_encoded"] = le.fit_transform(df[col].astype(str))
        encoders[col] = le
    before = len(df)
    df = df.drop_duplicates(subset=["title", "artist"], keep="first").reset_index(drop=True)
    if len(df) < before:
        print(f"Dropped {before - len(df)} duplicate title/artist rows")
    return df, encoders
def run_preprocessing() -> pd.DataFrame:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    df = load_raw_dataset()
    df_clean, encoders = clean_and_encode(df)
    df_clean.to_csv(TRACKS_CLEAN_PATH, index=False)
    joblib.dump(encoders, MODELS_DIR / "label_encoders.pkl")
    print(f"Saved cleaned dataset: {TRACKS_CLEAN_PATH} ({len(df_clean)} rows)")
    print(f"Saved encoders: {MODELS_DIR / 'label_encoders.pkl'}")
    return df_clean
if __name__ == "__main__":
    run_preprocessing()