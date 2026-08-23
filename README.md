# Cerum

Cerum is an explainable, provider-neutral music recommendation app. Pick a track and it analyzes available audio, ranks songs by rhythm, timbre/texture, harmony, and dynamics, then applies Cerum's own fine-grained style compatibility guardrail to prevent broad-category collisions. Spotify and Apple recommendation scores are not used.

- **Real catalogue search** — 5,896 distinct real songs imported through Apple's official iTunes Search API, including a balanced 1,500-song English, Hindi, and Tamil expansion alongside nuanced metal, electronic, jazz, soul, Latin, Indian, African, and East Asian coverage.
- **Audio-derived categories** — Cerum assigns a five-part signature covering intensity, texture, rhythm character, harmonic character, and tempo band.
- **Acoustic-first recommendations** — transparent rhythm, timbre, and harmony scores derived from actual audio fingerprints, with a microgenre guardrail that separates cases such as nu metal and alternative rock.
- **Streamed previews** — 5,893 short samples that play on demand, with an animated circular visualizer.
- **YouTube discovery** — every recommendation has a YouTube search link for the song and artist.
- **Unknown-song analysis** — transient analysis of user-provided audio for tempo, timbre, spectral measurements, MFCCs, chroma, and key.
- **Multiple discovery modes** — balanced similarity, rhythm-first, timbre-first, relevant discovery, personalization, and a five-step transition run.
- **Ordered transition runs** — the selected song becomes track 01 and Cerum builds five playable follow-ups, scoring every handoff against the previous song using BPM, exact-key compatibility, energy, texture, and style continuity.
- **Cloud listener accounts** — Supabase Auth accounts with favourites, automatically recorded recommendation history, and interaction signals protected by row-level security.

YouTube is the prominent listening destination. Apple is used for catalogue lookup, artwork, and available preview audio. Cerum's primary score comes from its own audio measurements. A separately maintained Cerum microgenre taxonomy acts as a compatibility guardrail; Apple and Spotify recommendation scores are never used. Preview audio used for fingerprinting is downloaded to a temporary file, analyzed locally, and deleted immediately; only numerical features and Cerum's category signature are retained.

The default acoustic mix is 35% rhythm, 40% timbre/texture, and 25% harmony. Rhythm includes tempo, onset density, beat regularity, percussion balance, and danceability. Timbre includes MFCC shape, brightness, spectral flatness/contrast, zero-crossing rate, harmonic balance, aggression, and dynamic range. Harmony compares chroma in a transposition-tolerant way plus tonality and harmonic balance. The resulting acoustic score is then adjusted by style compatibility; it cannot turn a poor acoustic match into a good one.

## How it works

```text
catalogue lookup -> transient audio decode -> 35-D fingerprint + deep sound profile
                                             |
                      rhythm / timbre / harmony similarities
                                             |
                         discovery mode + favourite fingerprints -> FastAPI -> React
```

The committed lookup catalogue lives at `data/catalog/apple_tracks.csv`. Its provider genre columns are ignored by the acoustic recommender. The resumable derived-feature index lives at `data/acoustic-fingerprints.db` and is excluded from Git. Catalogue metadata and derived fingerprints are also stored in Supabase; raw audio is not uploaded. `start-backend.cmd` builds the local index gradually in the background, and mirrors new fingerprints when a backend-only Supabase secret key is configured.

Build or resume the full index manually:

```bash
python scripts/build_acoustic_index.py --workers 2
```

Use `--limit 50` for a bounded batch. The full 5,896-song catalogue takes time because every available preview is decoded and analyzed rather than classified from metadata.

If a title is not in the local catalogue, Cerum supplements lookup results with a live search and fingerprints an available preview on demand. If usable audio is unavailable, the UI offers an upload fallback. Cerum analyzes up to 45 seconds, extracts tempo, energy, spectral measurements, MFCCs, chroma, harmonic/percussive balance, onset density, beat regularity, dynamics, tonal strength, danceability, and aggression, then compares that fingerprint directly with the acoustic index. Uploaded audio is deleted immediately and never added to the repository.

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

On Windows, `start-backend.cmd` and `start-frontend.cmd` launch the two services. Open `http://localhost:5173`; API documentation is available at `http://localhost:8010/docs`. Vite forwards `/api` to the local backend. Supabase Auth maintains the browser session; API requests include its access token, which the backend verifies with Supabase before performing user-owned writes under row-level security.

Copy `.env.example` and `frontend/.env.example` to their local equivalents and set the project URL plus publishable key. The publishable key is safe in the browser because every exposed table has explicit grants and row-level security policies. Never place a Supabase secret/service-role key in `frontend/`, a `VITE_` variable, or committed source.

The local `data/murec2-users.db` path remains only as an offline/test fallback. Production accounts, profiles, favourites, recommendation runs/items, and interactions live in Supabase. Catalogue maintenance can be run from a trusted backend terminal after setting `MUREC2_SUPABASE_SECRET_KEY`:

```bash
python scripts/sync_supabase.py
```

The API automatically trains missing artifacts at startup, so `python train.py` is optional for the demo. Run it explicitly whenever a real dataset changes.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Model, catalogue, and acoustic-index status |
| GET | `/api/acoustic-index/status` | Acoustic indexing progress |
| GET | `/api/tracks?q=...&genre=...` | Search and paginate tracks |
| GET | `/api/tracks/{track_id}` | Track metadata |
| GET | `/api/genres` | Cerum-derived acoustic categories |
| GET | `/api/similar/{track_id}` | Content-only neighbours |
| POST | `/api/recommend` | Provider-neutral acoustic recommendations |
| POST | `/api/analyze` | Transiently analyze an unknown audio file and return acoustic matches |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Offline/local fallback account session |
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
