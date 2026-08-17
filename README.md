# MuRec2

MuRec2 is an explainable music recommendation app backed by a real-song metadata catalogue. Pick a track and it ranks real songs using genre, artist, release era, and duration metadata.

- **Real catalogue search** — 3,464 real songs imported through Apple's official iTunes Search API, plus live Apple search results.
- **Subgenre-aware recommendations** — 84 fine-grained labels such as nu metal, alternative metal, progressive rock, indie rock, shoegaze, metalcore, trap, and neo soul.
- **Metadata recommendations** — transparent subgenre, artist, and era/duration affinity scores.
- **Streamed previews** — 3,461 short samples that play on demand, with an animated circular visualizer.
- **YouTube discovery** — every recommendation has a YouTube search link for the song and artist.
- **Unknown-song analysis** — transient analysis of user-provided audio for tempo, timbre, spectral measurements, MFCCs, chroma, and key.
- **Multiple discovery modes** — closest matches, adjacent sounds, same-era music, novelty-first discovery, and favourite-informed personalization.
- **Local listener accounts** — password-protected accounts with favourites, automatically recorded recommendation history, and interaction signals.

YouTube is the prominent listening destination. Because preview samples are supplied by Apple's Search API, the UI retains the required iTunes attribution and store-source link beside each preview. Preview audio is streamed only after a click and is never downloaded, cached, synchronized, or analyzed.

For catalogue songs, the default recommendation mix is 65% subgenre, 10% shared artist, and 25% era/duration. Closely related subgenres receive partial credit, while broad-category matches such as nu metal versus progressive rock receive only a small similarity score.

## How it works

```text
catalogue -> cleaning -> audio/lyric vectors -> nearest-neighbour model
                            interactions -> latent-factor model
                                         \  /
                                      weighted fusion -> FastAPI -> React
```

The committed catalogue lives at `data/catalog/apple_tracks.csv`. Refresh it responsibly with `python scripts/import_apple_catalog.py`, apply the fine-grained taxonomy with `python scripts/enrich_subgenres.py`, then enrich preview URLs with `python scripts/enrich_apple_previews.py`; networked scripts space requests to respect Apple's documented Search API guidance. Spotify can be added only with a registered Spotify developer app and OAuth credentials, and Spotify content must not be used to train an ML/AI model.

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

On Windows, `start-backend.cmd` and `start-frontend.cmd` launch the two services. Open `http://localhost:5173`; API documentation is available at `http://localhost:8010/docs`. Vite forwards `/api` to the local backend so signed session cookies stay same-origin during development.

Account data is stored locally in `data/murec2-users.db` and is excluded from Git. Passwords use Argon2 hashes; the browser receives a signed, HttpOnly session cookie rather than an exposed token. Set `MUREC2_SECRET_KEY` for a deployed installation and `MUREC2_COOKIE_SECURE=1` when serving over HTTPS. The generated local secret and account database are not committed.

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
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Local account session |
| GET/POST/DELETE | `/api/me/favorites` | Saved tracks for the signed-in listener |
| GET/DELETE | `/api/me/history` | Recommendation history for the signed-in listener |
| POST | `/api/events` | Preview, selection, and YouTube interaction signals |

Example request:

```json
{
  "track_id": "demo-0001",
  "k": 10,
  "mode": "similar",
  "weights": { "audio": 0.35, "lyric": 0.35, "collab": 0.30 }
}
```

## Verification

```bash
pytest
cd frontend && npm run build
```

The collaborative data is synthetic unless replaced with real listening events, so the demo validates the architecture and user experience—not production recommendation quality.
