import pandas as pd
from sklearn.model_selection import train_test_split
from src.config import (
    TRACKS_CLEAN_PATH, TRAIN_SPLIT_PATH, TEST_SPLIT_PATH,
    SPLITS_DIR, TEST_SIZE, RANDOM_SEED, STRATIFY_COLUMN,
)
def run_split() -> tuple[pd.DataFrame, pd.DataFrame]:
    SPLITS_DIR.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(TRACKS_CLEAN_PATH)
    train_df, test_df = train_test_split(
        df,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=df[STRATIFY_COLUMN],
    )
    train_df.to_csv(TRAIN_SPLIT_PATH, index=False)
    test_df.to_csv(TEST_SPLIT_PATH, index=False)
    print(f"Train: {len(train_df)} rows -> {TRAIN_SPLIT_PATH}")
    print(f"Test:  {len(test_df)} rows -> {TEST_SPLIT_PATH}")
    print("\nGenre distribution check (train vs test, top 5):")
    print(pd.DataFrame({
        "train_pct": train_df[STRATIFY_COLUMN].value_counts(normalize=True).head(5),
        "test_pct": test_df[STRATIFY_COLUMN].value_counts(normalize=True).head(5),
    }).round(3))
    return train_df, test_df
if __name__ == "__main__":
    run_split()