# MuRec2

MuRec2 is an explainable music recommendation app backed by a real-song metadata catalogue. Pick a track and it ranks real songs using genre, artist, release era, and duration metadata.

- **Real catalogue search** — 3,464 real songs imported through Apple's official iTunes Search API, plus live Apple search results.
- **Metadata recommendations** — transparent genre, artist, and era/duration affinity scores.
- **Streamed previews** — 3,461 short samples that play on demand, with an animated circular visualizer.
- **YouTube discovery** — every recommendation has a YouTube search link for the song and artist.
- **Unknown-song analysis** — transient analysis of user-provided audio for tempo, timbre, spectral measurements, MFCCs, chroma, and key.

YouTube is the prominent listening destination. Because preview samples are supplied by Apple's Search API, the UI retains the required iTunes attribution and store-source link beside each preview. Preview audio is streamed only after a click and is never downloaded, cached, synchronized, or analyzed.

## How it works

```text
catalogue -> cleaning -> audio/lyric vectors -> nearest-neighbour model
                            interactions -> latent-factor model
                                         \  /
                                      weighted fusion -> FastAPI -> React
```

The committed catalogue lives at `data/catalog/apple_tracks.csv`. Refresh it responsibly with `python scripts/import_apple_catalog.py`, then enrich preview URLs with `python scripts/enrich_apple_previews.py`; both scripts space requests to respect Apple's documented Search API guidance. Spotify can be added only with a registered Spotify developer app and OAuth credentials, and Spotify content must not be used to train an ML/AI model.

If a title is not in the local catalogue, MuRec2 supplements results with a live Apple search. If no result exists, the UI offers an audio upload fallback. MuRec2 analyzes up to 45 seconds of the file, extracts tempo, RMS energy, spectral centroid and rolloff, spectral flux, zero-crossing rate, 13 MFCCs, chroma/key, and a timbre label, estimates a genre profile, and returns real Apple catalogue songs from matching genre families. Uploaded audio is deleted immediately after analysis and is never added to the repository.

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
| POST | `/api/analyze` | Transiently analyze an unknown audio file and return acoustic matches |

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
