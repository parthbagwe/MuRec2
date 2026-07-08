import pandas as pd
from src.config import RAW_DATA_PATH, AUDIO_FEATURE_COLUMNS, LYRIC_FEATURE_COLUMNS, ID_COLUMNS
REQUIRED_COLUMNS = ID_COLUMNS + AUDIO_FEATURE_COLUMNS + LYRIC_FEATURE_COLUMNS + [
    "theme_1", "theme_2", "theme_3", "theme_4", "lyric_snippet",
    "timbre", "chroma_key", "duration_sec", "popularity",
]
def load_raw_dataset() -> pd.DataFrame:
    """Load the dataset sheet from the xlsx file and validate its schema."""
    if not RAW_DATA_PATH.exists():
        raise FileNotFoundError(
            f"Dataset not found at {RAW_DATA_PATH}. "
            f"Place music_recommendation_dataset.xlsx in data/raw/"
        )
    df = pd.read_excel(RAW_DATA_PATH, sheet_name="dataset")
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")
    null_counts = df[REQUIRED_COLUMNS].isnull().sum()
    problematic_nulls = null_counts[null_counts > 0]
    if len(problematic_nulls) > 0:
        print("Warning — null values found in:")
        print(problematic_nulls)
    print(f"Loaded {len(df)} rows, {len(df.columns)} columns from {RAW_DATA_PATH.name}")
    print(f"Genres: {df['genre'].nunique()} unique")
    print(f"Artists: {df['artist'].nunique()} unique")
    return df
if __name__ == "__main__":
    df = load_raw_dataset()
    print(df.head(3))