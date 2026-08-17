"""Build or resume MuRec2's provider-neutral acoustic fingerprint index."""

import argparse
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.acoustic_index import AcousticIndex
from src.catalog import load_catalog


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze catalogue preview audio and cache only derived fingerprints")
    parser.add_argument("--limit", type=int, default=None, help="Maximum new tracks to analyze; omit to index all")
    parser.add_argument("--workers", type=int, default=2, choices=range(1, 7))
    args = parser.parse_args()
    catalog = load_catalog()
    index = AcousticIndex()
    before = index.status(len(catalog))
    print(f"Acoustic index: {before['indexed']:,}/{before['total']:,} tracks")
    after = index.build(catalog, limit=args.limit, workers=args.workers)
    print(f"Acoustic index: {after['indexed']:,}/{after['total']:,} tracks; {after['failures']:,} unavailable")


if __name__ == "__main__":
    main()
