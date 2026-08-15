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

from src.pipeline import train_all


def main():
    train_all()


if __name__ == "__main__":
    main()
