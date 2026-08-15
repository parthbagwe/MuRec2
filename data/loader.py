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
def generate_demo_dataset(size: int = 3000) -> pd.DataFrame:
    """Create a diverse, correlated catalogue so a fresh clone works immediately."""
    rng = np.random.default_rng(RANDOM_SEED)
    profiles = {
        "pop": (118, 68, .72, 2200, "bright"), "rock": (126, 76, .55, 2450, "gritty"),
        "hip-hop": (92, 66, .58, 1850, "punchy"), "electronic": (128, 84, .68, 3100, "glossy"),
        "jazz": (112, 46, .56, 1600, "warm"), "folk": (104, 38, .66, 1250, "acoustic"),
        "r&b": (94, 57, .70, 1750, "smooth"), "classical": (96, 40, .52, 1450, "orchestral"),
        "metal": (148, 92, .34, 3300, "distorted"), "indie": (116, 59, .57, 1950, "textured"),
        "country": (108, 52, .70, 1550, "twangy"), "reggae": (86, 53, .82, 1700, "rounded"),
        "blues": (96, 50, .40, 1500, "smoky"), "latin": (122, 79, .84, 2400, "percussive"),
        "ambient": (72, 24, .58, 1050, "airy"), "soul": (98, 63, .73, 1650, "rich"),
    }
    genres = np.array(list(profiles))
    keys = np.array(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])
    title_starts = ["Midnight", "Golden", "Electric", "Velvet", "Northern", "Quiet", "Neon", "Endless", "Silver", "Fading", "Wild", "Paper", "Crystal", "Burning", "Sunday", "Ocean", "Afterglow", "Satellite", "Honey", "Blue", "Distant", "Summer", "Broken", "Secret", "Last"]
    title_ends = ["Echo", "Sky", "Run", "Heart", "River", "Signal", "Dream", "Light", "Road", "Fire", "Garden", "Memory", "Motion", "Home", "Rain", "City", "Bloom", "Waves", "Hours", "Story", "Lines", "Moon", "Dance", "Shadow", "Promise"]
    artist_starts = ["Nova", "Glass", "Velvet", "Atlas", "Lunar", "Copper", "Static", "Juniper", "Ivory", "Echo", "Solar", "Willow", "Indigo", "Crimson", "Paper", "Wild", "Golden", "North", "Amber", "Silver"]
    artist_ends = ["Vale", "Harbor", "Youth", "Parade", "Theory", "Saints", "Club", "Bloom", "Signals", "Coast", "Hearts", "Assembly", "Motel", "Cinema", "Wolves"]
    rows = []
    for i in range(size):
        genre_index = i % len(genres)
        genre = genres[genre_index]
        base_bpm, base_energy, base_valence, base_centroid, timbre = profiles[genre]
        energy = float(np.clip(rng.normal(base_energy, 9), 4, 100))
        valence = float(np.clip(rng.normal(base_valence, .12), -1, 1))
        if valence < .42:
            theme_choices = [0, 3, 4, 9]
        elif energy > 72:
            theme_choices = [2, 6, 8]
        else:
            theme_choices = [1, 3, 5, 7, 9]
        theme_index = int(rng.choice(theme_choices))
        centroid = float(np.clip(rng.normal(base_centroid, 180), 500, 5000))
        key_index = int((i * 5 + genre_index) % len(keys))
        artist_index = (i * 7 + genre_index * 11) % (len(artist_starts) * len(artist_ends))
        artist = f"{artist_starts[artist_index % len(artist_starts)]} {artist_ends[(artist_index // len(artist_starts)) % len(artist_ends)]}"
        title_index = i % (len(title_starts) * len(title_ends))
        title = f"{title_starts[title_index % len(title_starts)]} {title_ends[(title_index // len(title_starts)) % len(title_ends)]}"
        if i >= len(title_starts) * len(title_ends):
            title += f" {i // (len(title_starts) * len(title_ends)) + 1}"
        row = {
            "track_id": f"demo-{i + 1:04d}",
            "title": title,
            "artist": artist,
            "genre": genre,
            "year": int(rng.integers(1975, 2027)),
            "primary_theme_pool": THEME_POOLS[theme_index],
            "vader_sentiment": valence,
            "arousal": float(np.clip(energy / 100 + rng.normal(0, 0.08), 0, 1)),
            "theme_1": THEME_POOLS[theme_index],
            "theme_2": THEME_POOLS[(theme_index + 1) % len(THEME_POOLS)],
            "theme_3": "none",
            "theme_4": "none",
            "lyric_snippet": f"A demo lyric about {THEME_POOLS[theme_index].replace('_', ' ')}.",
            "timbre": timbre,
            "chroma_key": keys[key_index],
            "duration_sec": int(rng.integers(150, 310)),
            "popularity": int(rng.integers(20, 100)),
            "bpm": float(np.clip(rng.normal(base_bpm, 7), 45, 210)),
            "energy": energy,
            "valence": valence,
            "brightness": float(np.clip(centroid / 5000, 0, 1)),
            "spectral_centroid_hz": centroid,
            "spectral_rolloff_hz": float(np.clip(rng.normal(centroid * 2.25, 250), 900, 10000)),
            "spectral_flux": float(np.clip(rng.normal(energy / 140, 0.08), 0, 1)),
            "rms_energy": float(np.clip(rng.normal(energy / 400, 0.025), 0, 1)),
            "zero_crossing_rate": float(np.clip(rng.normal(centroid / 22000, 0.015), 0, 1)),
            "tempo_confidence": float(np.clip(rng.normal(0.8, 0.1), 0, 1)),
        }
        row["mfcc_1"] = float(rng.normal(-260 + energy * 1.65, 18))
        row["mfcc_2"] = float(rng.normal(35 + centroid / 120, 8))
        for n in range(3, 14):
            row[f"mfcc_{n}"] = float(rng.normal(np.sin((genre_index + 1) * n) * 5, 7))
        chroma_alpha = np.full(12, .7)
        chroma_alpha[key_index] = 5.0
        chroma_alpha[(key_index + 7) % 12] = 2.5
        chroma = rng.dirichlet(chroma_alpha)
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
