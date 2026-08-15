from pathlib import Path
ARTIFACT_VERSION = 2
ROOT_DIR = Path(__file__).resolve().parent.parent
RAW_DATA_PATH = ROOT_DIR / "data" / "raw" / "music_recommendation_dataset.xlsx"
RAW_CSV_PATH = ROOT_DIR / "data" / "raw" / "music_recommendation_dataset.csv"
APPLE_CATALOG_PATH = ROOT_DIR / "data" / "catalog" / "apple_tracks.csv"
TRACKS_CLEAN_PATH = ROOT_DIR / "data" / "processed" / "tracks_clean.csv"
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
SPLITS_DIR = ROOT_DIR / "data" / "splits"
TRACKS_CLEAN_PATH = PROCESSED_DIR / "tracks_clean.csv"
AUDIO_MATRIX_PATH = PROCESSED_DIR / "audio_feature_matrix.npy"
LYRIC_MATRIX_PATH = PROCESSED_DIR / "lyric_feature_matrix.npy"
COMBINED_MATRIX_PATH = PROCESSED_DIR / "combined_feature_matrix.npy"
TRAIN_SPLIT_PATH = SPLITS_DIR / "train.csv"
TEST_SPLIT_PATH = SPLITS_DIR / "test.csv"
MODELS_DIR = ROOT_DIR / "models"
ARTIFACT_METADATA_PATH = MODELS_DIR / "artifact_metadata.json"
SCALER_PATH = MODELS_DIR / "scaler.pkl"
CONTENT_MODEL_PATH = MODELS_DIR / "content_model.pkl"
COLLAB_MODEL_PATH = MODELS_DIR / "collab_model.pkl"
ID_COLUMNS = ["track_id", "title", "artist", "genre", "year"]
AUDIO_FEATURE_COLUMNS = [
    "bpm", "energy", "valence", "brightness",
    "spectral_centroid_hz", "spectral_rolloff_hz", "spectral_flux",
    "rms_energy", "zero_crossing_rate", "tempo_confidence",
] + [f"mfcc_{i}" for i in range(1, 14)] + [
    "chroma_c", "chroma_cs", "chroma_d", "chroma_ds", "chroma_e", "chroma_f",
    "chroma_fs", "chroma_g", "chroma_gs", "chroma_a", "chroma_as", "chroma_b",
]
THEME_POOLS = [
    "loss_longing", "self_identity", "joy_celebration", "nostalgia_memory",
    "anxiety_darkness", "romance_new", "empowerment", "spirituality",
    "social", "bittersweet",
]
LYRIC_FEATURE_COLUMNS = ["primary_theme_pool", "vader_sentiment", "arousal"]
CATEGORICAL_COLUMNS = ["genre", "timbre", "chroma_key", "primary_theme_pool"]
TEST_SIZE = 0.2
RANDOM_SEED = 42
STRATIFY_COLUMN = "genre"
HYBRID_WEIGHTS = {
    "audio": 0.35,
    "lyric": 0.35,
    "collab": 0.30,
}
DEFAULT_TOP_K = 10
MAX_TOP_K = 50
LATENT_FACTORS = 50
API_HOST = "0.0.0.0"
API_PORT = 8000
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
