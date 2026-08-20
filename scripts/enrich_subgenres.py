"""Apply MuRec2's fine-grained subgenre taxonomy to the real-song catalogue."""

from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.subgenres import infer_subgenre  # noqa: E402

CATALOG = ROOT / "data" / "catalog" / "apple_tracks.csv"


def enrich() -> pd.DataFrame:
    frame = pd.read_csv(CATALOG, dtype=str, keep_default_na=False)
    frame["subgenre"] = frame.apply(
        lambda row: infer_subgenre(
            artist=row.get("artist", ""),
            genre=row.get("genre", ""),
            seed_genre=row.get("seed_genre", ""),
            title=row.get("title", ""),
        ),
        axis=1,
    )
    frame.to_csv(CATALOG, index=False)
    print(f"Saved subgenres for {len(frame):,} songs ({frame['subgenre'].nunique()} distinct labels)")
    print(frame["subgenre"].value_counts().to_string())
    return frame


if __name__ == "__main__":
    enrich()
