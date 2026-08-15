"""End-to-end training orchestration and artifact bootstrapping."""

from data.preprocessor import run_preprocessing
from data.splitter import run_split
from src.config import COLLAB_MODEL_PATH, CONTENT_MODEL_PATH, TRACKS_CLEAN_PATH
from src.features.audio_features import build_audio_matrix
from src.features.lyric_features import build_lyric_matrix
from src.models.collab_model import CollabModel
from src.models.content_model import ContentModel


def train_all() -> None:
    steps = [
        ("Preprocessing", run_preprocessing),
        ("Train/test split", run_split),
        ("Audio feature matrix", build_audio_matrix),
        ("Lyric feature matrix", build_lyric_matrix),
    ]
    for index, (label, action) in enumerate(steps, start=1):
        print(f"\n{'=' * 60}\nSTEP {index}/6 — {label}\n{'=' * 60}")
        action()

    print(f"\n{'=' * 60}\nSTEP 5/6 — Content model\n{'=' * 60}")
    ContentModel().fit().save()

    print(f"\n{'=' * 60}\nSTEP 6/6 — Collaborative model\n{'=' * 60}")
    CollabModel().fit().save()
    print(f"\n{'=' * 60}\nDONE — model artifacts are ready\n{'=' * 60}")


def ensure_artifacts() -> None:
    required = (TRACKS_CLEAN_PATH, CONTENT_MODEL_PATH, COLLAB_MODEL_PATH)
    if not all(path.exists() and path.stat().st_size > 0 for path in required):
        print("Model artifacts are missing; training the demo pipeline now.")
        train_all()
