# Cerum sound intelligence: first release

The main Vercel app now supports an optional learned audio index, predicted mood,
and explicit recommendation feedback. This release does not replace the playback
engine, preview cap, genre gate, account services, or full-screen visuals.

## What runs where

- `scripts/index_music_ai.py` runs the pretrained `laion/clap-htsat-unfused` model
  locally, pinned to revision `8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a`.
  The upstream model card specifies Apache-2.0. See
  <https://huggingface.co/laion/clap-htsat-unfused> and <https://github.com/LAION-AI/CLAP>.
  A larger music checkpoint was rejected after distinct text probes produced nearly
  identical embeddings. This reproduces the upstream issue at
  <https://huggingface.co/laion/larger_clap_music/discussions/2>.
  The builder refuses publication when its distinct-text sanity probe collapses.
- Each successful preview contributes up to three deterministic 10-second windows,
  never beyond the first 30 seconds. Normalized window embeddings are averaged,
  normalized again, and quantized into a 512-dimensional signed-byte vector.
- Eight explicit text prompts provide zero-shot mood similarities. These are
  predictions from audio, not lyric analysis or calibrated emotion probabilities.
  Ambiguous mood labels are withheld when the top two prompt similarities are
  within 0.025. English prompts do not establish accuracy for Tamil or Hindi;
  language-specific quality needs listener evaluation.
- Only the derived index, model/revision, prompt definitions, preview URL hashes,
  and coverage manifest are deployed. Raw audio is removed after decoding. Model
  weights and resumable work stay in ignored `.cache/music-ai/`.
- The browser lazily downloads the compact index inside its existing catalogue
  worker. There is no model inference on the UI/audio thread and no paid inference
  endpoint. Unsupported or missing indexes retain acoustic ranking.

## Ranking and feedback

The existing generated acoustic engine accepts an optional ranking hook. Learned
sound and mood adjust candidate scores **after** genre filtering and vibe penalties.
Rhythm/texture modes keep lower neural weights than Balanced. Transition sequences
use a smaller adjustment and remain predominantly controlled by measured acoustic
compatibility. Playback timing and fades are untouched. Exact cosine scores and
predicted mood compatibility appear under "Why this fits" for indexed pairs.
Destination-based sound bridges retain the original acoustic algorithm; their
feedback controls are withheld so a rerank cannot remove the chosen destination.

The main dual app ranks suggestions locally for either account provider, so private
preferences never go to the other provider. Supabase public search/fallback is still
available according to `service-config.json`.

"More like this", "Too sad", and "Too different" rerank suggestions without changing
the currently playing queue. Guest feedback is device-local. Signed-in feedback is
isolated by `provider:user-id` and synced through the original provider's existing
interaction records (`liked`/`disliked`, numeric values 2/-2/-3). These use the existing
schema, Firestore security rules and 100-entry bound. A sync failure is surfaced and
does not claim account persistence. No accounts, passwords or private libraries move.

## Rebuild or extend the index

```powershell
.venv/Scripts/python.exe -m pip install -r requirements-ai.txt
node frontend/scripts/select-ai-candidates.mjs
.venv/Scripts/python.exe scripts/index_music_ai.py --limit 400 --threads 4 --candidate-ids .cache/music-ai/candidate-ids.json
# Index the full available catalogue, reusing cached successes:
.venv/Scripts/python.exe scripts/index_music_ai.py --limit 0 --threads 4
```

Process only previews for which you have permission to perform analysis. The builder
accepts the catalogue's existing iTunes preview host, bounds downloads and decode
duration, and logs unavailable previews rather than inventing embeddings. If the
single checkpoint transfer stalls, `scripts/download_clap_checkpoint.py` downloads
bounded resumable chunks and verifies the upstream SHA-256 before local loading.
No new hosting or billing configuration is required.

The coverage manifest in `frontend/public/intelligence/manifest.json` records the
actual successful count. New searches outside this index still receive acoustic
analysis; they do not automatically become CLAP-indexed in this release. Extend the
offline index before deploying updated coverage. This is a limited first release,
not an analysis of all songs in the world.
The first release prioritises real baseline recommendations for seven English,
Tamil, Hindi and Punjabi anchors across the Balanced, groove, texture and transition
modes, then fills seed neighbourhoods and additional catalogue genres.

## Verification

From `frontend`, run `npm run test:ai`, `npm run test:dual`, `npm run test:spark`,
`npm run test:playback`, `node --test src/serviceRequests.test.js server/chartFeed.test.js`,
and `npm run build:dual`. `scripts/evaluate-ai.mjs` records real catalogue rankings
and model coverage against the original baseline. Its scores are diagnostics, not
proof of human preference.
Vercel runs the AI invariant tests before the production build.

`scripts/test-ai-browser.mjs` tests the local dual app or main Vercel URL using
Playwright Chromium: desktop and phone emulation, real audio-graph signal, feedback,
pause/resume, manual skip and desktop automatic overlap/advancement. Supply a local
Playwright installation via `CERUM_PLAYWRIGHT_MODULE` if necessary. This does not
claim testing on physical phones, Safari, or Firefox.

Validation on October 20, 2026: 70 Node regression/AI tests passed. Edge 155
(Chromium), desktop 1440×1000 and phone emulation 390×844, passed feedback persistence
and reranking, non-silent audio-graph sampling, pause/resume, manual skip, and layout
overflow checks. Desktop also observed two playing audio elements during a real
overlap followed by automatic advancement. Firebase feedback save/reload and denial
of unauthenticated reads passed using a temporary account, which was removed.
The initial published index contains 400 successfully analysed previews; no download
failures occurred. Subjective recommendation quality still needs listener feedback.
