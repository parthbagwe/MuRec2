# MuRec2

MuRec2 is an explainable, provider-neutral acoustic recommendation app. Pick a track and it analyzes available audio, then ranks songs by rhythm, timbre/texture, harmony, and dynamics—not Spotify or Apple genre tags.

- **Real catalogue search** — 3,464 real songs imported through Apple's official iTunes Search API, plus live Apple search results.
- **Audio-derived categories** — MuRec2 assigns a five-part signature covering intensity, texture, rhythm character, harmonic character, and tempo band.
- **Acoustic recommendations** — transparent rhythm, timbre, and harmony scores derived from actual audio fingerprints.
- **Streamed previews** — 3,461 short samples that play on demand, with an animated circular visualizer.
- **YouTube discovery** — every recommendation has a YouTube search link for the song and artist.
- **Unknown-song analysis** — transient analysis of user-provided audio for tempo, timbre, spectral measurements, MFCCs, chroma, and key.
- **Multiple discovery modes** — balanced similarity, rhythm-first, timbre-first, novelty-first, and favourite-informed acoustic personalization.
- **Local listener accounts** — password-protected accounts with favourites, automatically recorded recommendation history, and interaction signals.

YouTube is the prominent listening destination. Apple is used only for catalogue lookup, artwork, and available preview audio. MuRec2 does not use Apple's genre or subgenre classifications in ranking. Preview audio used for fingerprinting is downloaded to a temporary file, analyzed locally, and deleted immediately; only numerical features and MuRec2's category signature are retained.

The default mix is 35% rhythm, 40% timbre/texture, and 25% harmony. Rhythm includes tempo, onset density, beat regularity, percussion balance, and danceability. Timbre includes MFCC shape, brightness, spectral flatness/contrast, zero-crossing rate, harmonic balance, aggression, and dynamic range. Harmony compares chroma in a transposition-tolerant way plus tonality and harmonic balance.

## How it works

```text
catalogue lookup -> transient audio decode -> 35-D fingerprint + deep sound profile
                                             |
                      rhythm / timbre / harmony similarities
                                             |
                         discovery mode + favourite fingerprints -> FastAPI -> React
```

The committed lookup catalogue lives at `data/catalog/apple_tracks.csv`. Its provider genre columns are ignored by the acoustic recommender. The resumable derived-feature index lives at `data/acoustic-fingerprints.db` and is excluded from Git. `start-backend.cmd` builds it gradually in the background; keep the backend open and the available candidate library improves continuously.

Build or resume the full index manually:

```bash
python scripts/build_acoustic_index.py --workers 2
```

Use `--limit 50` for a bounded batch. The full 3,464-song catalogue takes time because every available preview is decoded and analyzed rather than classified from metadata.

If a title is not in the local catalogue, MuRec2 supplements lookup results with a live search and fingerprints an available preview on demand. If usable audio is unavailable, the UI offers an upload fallback. MuRec2 analyzes up to 45 seconds, extracts tempo, energy, spectral measurements, MFCCs, chroma, harmonic/percussive balance, onset density, beat regularity, dynamics, tonal strength, danceability, and aggression, then compares that fingerprint directly with the acoustic index. Uploaded audio is deleted immediately and never added to the repository.

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
| GET | `/api/health` | Model, catalogue, and acoustic-index status |
| GET | `/api/acoustic-index/status` | Acoustic indexing progress |
| GET | `/api/tracks?q=...&genre=...` | Search and paginate tracks |
| GET | `/api/tracks/{track_id}` | Track metadata |
| GET | `/api/genres` | MuRec2-derived acoustic categories |
| GET | `/api/similar/{track_id}` | Content-only neighbours |
| POST | `/api/recommend` | Provider-neutral acoustic recommendations |
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
  "weights": { "audio": 0.35, "lyric": 0.40, "collab": 0.25 }
}
```

## Verification

```bash
pytest
cd frontend && npm run build
```

The API field names `audio`, `lyric`, and `collab` are retained for backward compatibility; for real catalogue songs they mean rhythm, timbre, and harmony respectively. Recommendation quality grows as the local acoustic index fills.
