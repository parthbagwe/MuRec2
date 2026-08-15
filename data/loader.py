import numpy as np
import pandas as pd

from src.config import (
    AUDIO_FEATURE_COLUMNS,
    ID_COLUMNS,
    LYRIC_FEATURE_COLUMNS,
    RAW_CSV_PATH,
    RAW_DATA_PATH,
    RANDOM_SEED,
    THEME_POOLS,
)
REQUIRED_COLUMNS = ID_COLUMNS + AUDIO_FEATURE_COLUMNS + LYRIC_FEATURE_COLUMNS + [
    "theme_1", "theme_2", "theme_3", "theme_4", "lyric_snippet",
    "timbre", "chroma_key", "duration_sec", "popularity",
]
def generate_demo_dataset(size: int = 320) -> pd.DataFrame:
    """Create deterministic catalogue data so a fresh clone works immediately."""
    rng = np.random.default_rng(RANDOM_SEED)
    genres = np.array(["pop", "rock", "hip-hop", "electronic", "jazz", "folk", "r&b", "classical"])
    timbres = np.array(["warm", "bright", "dark", "acoustic", "punchy"])
    keys = np.array(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])
    title_words = ["Midnight", "Golden", "Electric", "Velvet", "Northern", "Quiet", "Neon", "Endless"]
    rows = []
    for i in range(size):
        genre_index = i % len(genres)
        theme_index = (i * 3 + genre_index) % len(THEME_POOLS)
        energy = float(np.clip(35 + genre_index * 6 + rng.normal(0, 12), 0, 100))
        valence = float(np.clip(0.2 + (theme_index % 5) * 0.15 + rng.normal(0, 0.08), -1, 1))
        row = {
            "track_id": f"demo-{i + 1:04d}",
            "title": f"{title_words[i % len(title_words)]} {i + 1}",
            "artist": f"Demo Artist {(i % 24) + 1}",
            "genre": genres[genre_index],
            "year": int(1995 + i % 31),
            "primary_theme_pool": THEME_POOLS[theme_index],
            "vader_sentiment": valence,
            "arousal": float(np.clip(energy / 100 + rng.normal(0, 0.08), 0, 1)),
            "theme_1": THEME_POOLS[theme_index],
            "theme_2": THEME_POOLS[(theme_index + 1) % len(THEME_POOLS)],
            "theme_3": "none",
            "theme_4": "none",
            "lyric_snippet": f"A demo lyric about {THEME_POOLS[theme_index].replace('_', ' ')}.",
            "timbre": timbres[i % len(timbres)],
            "chroma_key": keys[i % len(keys)],
            "duration_sec": int(rng.integers(150, 310)),
            "popularity": int(rng.integers(20, 100)),
            "bpm": float(np.clip(75 + genre_index * 8 + rng.normal(0, 8), 55, 190)),
            "energy": energy,
            "valence": valence,
            "brightness": float(np.clip(0.3 + genre_index * 0.06 + rng.normal(0, 0.08), 0, 1)),
            "spectral_centroid_hz": float(900 + genre_index * 210 + rng.normal(0, 120)),
            "spectral_rolloff_hz": float(2200 + genre_index * 320 + rng.normal(0, 180)),
            "spectral_flux": float(np.clip(rng.normal(0.5, 0.15), 0, 1)),
            "rms_energy": float(np.clip(energy / 100 + rng.normal(0, 0.05), 0, 1)),
            "zero_crossing_rate": float(np.clip(rng.normal(0.1 + genre_index * 0.01, 0.02), 0, 1)),
            "tempo_confidence": float(np.clip(rng.normal(0.8, 0.1), 0, 1)),
        }
        for n in range(1, 14):
            row[f"mfcc_{n}"] = float(rng.normal(genre_index * 0.3, 1))
        chroma = rng.dirichlet(np.ones(12))
        for name, value in zip(["c", "cs", "d", "ds", "e", "f", "fs", "g", "gs", "a", "as", "b"], chroma):
            row[f"chroma_{name}"] = float(value)
        rows.append(row)
    return pd.DataFrame(rows)


def load_raw_dataset() -> pd.DataFrame:
    """Load XLSX/CSV input, falling back to a deterministic demo catalogue."""
    if RAW_DATA_PATH.exists():
        df = pd.read_excel(RAW_DATA_PATH, sheet_name="dataset")
        source = RAW_DATA_PATH.name
    elif RAW_CSV_PATH.exists():
        df = pd.read_csv(RAW_CSV_PATH)
        source = RAW_CSV_PATH.name
    else:
        df = generate_demo_dataset()
        source = "built-in demo generator"
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")
    null_counts = df[REQUIRED_COLUMNS].isnull().sum()
    problematic_nulls = null_counts[null_counts > 0]
    if len(problematic_nulls) > 0:
        print("Warning — null values found in:")
        print(problematic_nulls)
    print(f"Loaded {len(df)} rows, {len(df.columns)} columns from {source}")
    print(f"Genres: {df['genre'].nunique()} unique")
    print(f"Artists: {df['artist'].nunique()} unique")
    return df
if __name__ == "__main__":
    df = load_raw_dataset()
    print(df.head(3))
