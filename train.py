"""
Master training script. Runs the entire pipeline in order:
  1. Load + clean + encode raw data
  2. Stratified train/test split
  3. Build audio feature matrix
  4. Build lyric feature matrix
  5. Fit + save content model
  6. Fit + save collaborative model

Run once whenever the dataset changes:  python train.py
"""

from src.data.preprocessor import run_preprocessing
from src.data.splitter import run_split
from src.features.audio_features import build_audio_matrix
from src.features.lyric_features import build_lyric_matrix
from src.models.content_model import ContentModel
from src.models.collab_model import CollabModel


def main():
    print("=" * 60)
    print("STEP 1/6 — Preprocessing")
    print("=" * 60)
    run_preprocessing()

    print("\n" + "=" * 60)
    print("STEP 2/6 — Train/test split")
    print("=" * 60)
    run_split()

    print("\n" + "=" * 60)
    print("STEP 3/6 — Audio feature matrix")
    print("=" * 60)
    build_audio_matrix()

    print("\n" + "=" * 60)
    print("STEP 4/6 — Lyric feature matrix")
    print("=" * 60)
    build_lyric_matrix()

    print("\n" + "=" * 60)
    print("STEP 5/6 — Content model")
    print("=" * 60)
    content_model = ContentModel().fit()
    content_model.save()

    print("\n" + "=" * 60)
    print("STEP 6/6 — Collaborative model")
    print("=" * 60)
    collab_model = CollabModel().fit()
    collab_model.save()

    print("\n" + "=" * 60)
    print("DONE — all artifacts saved to models/ and data/processed/")
    print("=" * 60)


if __name__ == "__main__":
    main()