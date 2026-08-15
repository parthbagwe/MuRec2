# MuRec2

MuRec2 is an explainable hybrid music recommendation demo. Pick a track and it ranks similar songs using three signals:

- **Audio similarity** — tempo, energy, spectral measurements, MFCCs, and chroma features.
- **Lyric similarity** — lyrical theme, sentiment, and arousal.
- **Collaborative similarity** — latent listening patterns learned from a user–track interaction matrix.

Every result exposes the three component scores and the combined score, and the web UI lets you rebalance their weights.

## How it works

```text
catalogue -> cleaning -> audio/lyric vectors -> nearest-neighbour model
                            interactions -> latent-factor model
                                         \  /
                                      weighted fusion -> FastAPI -> React
```

The repository includes a deterministic 320-track demo catalogue generator, so it runs from a fresh clone without private data. To use real data, place `music_recommendation_dataset.xlsx` (sheet `dataset`) or `music_recommendation_dataset.csv` in `data/raw/`. The schema is validated by `data/loader.py`.

## Quick start

Python 3.10+ and Node.js 20+ are recommended.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python train.py
uvicorn src.api.main:app --reload
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. API documentation is available at `http://localhost:8000/docs`.

The API automatically trains missing artifacts at startup, so `python train.py` is optional for the demo. Run it explicitly whenever a real dataset changes.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Model and catalogue status |
| GET | `/api/tracks?q=...&genre=...` | Search and paginate tracks |
| GET | `/api/tracks/{track_id}` | Track metadata |
| GET | `/api/genres` | Available genres |
| GET | `/api/similar/{track_id}` | Content-only neighbours |
| POST | `/api/recommend` | Weighted hybrid recommendations |

Example request:

```json
{
  "track_id": "demo-0001",
  "k": 10,
  "weights": { "audio": 0.35, "lyric": 0.35, "collab": 0.30 }
}
```

## Verification

```bash
pytest
cd frontend && npm run build
```

The collaborative data is synthetic unless replaced with real listening events, so the demo validates the architecture and user experience—not production recommendation quality.
