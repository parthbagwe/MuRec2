# Hosted catalogue bandwidth

## September 2026 incident

Supabase's gateway rejected search requests with HTTP 402 and
`exceed_egress_quota`. The project remained active, but requests were blocked
before the Edge Function could run. Deploying code does not reset that allowance.
The account owner must review Usage/Billing or contact Supabase support to
restore service. No billing settings were changed by this patch.

Read-only database inspection found 5,893 fingerprints. Serializing the old
full-library projection was approximately 13.64 MB, excluding lyric features.
The genre-only projection was approximately 0.77 MB (94% smaller). These are
uncompressed payload estimates, not metered monthly egress totals. Query
statistics showed tens of thousands of executions of the paginated full-library
query; statistics do not establish which billing period or client caused them.

## Changes

- Track details and saving favourites query a single track and its lyric features.
- Genre menus read only textures/signatures, without vectors or track metadata.
- Concurrent recommendations and mixes share one in-flight catalogue load per
  worker, retained for 30 minutes. Ranking still uses the complete acoustic and
  lyric feature set, with unchanged scoring.
- Small status responses are cached for one minute per worker. Count queries
  request headers only, and failures are not cached as zero counts.
- Public catalogue reads skip unnecessary user-authentication requests.
- The browser caches only allowlisted public reads, with bounded size and TTL.
  Favourites, history, writes and personalized recommendations are never cached.
- Status polling continues only while the backend reports an active build. It
  pauses in hidden tabs and stops on errors. Search cancels obsolete requests.
- Explicit quota responses get an actionable message and a one-minute retry
  cooldown. Browsers may hide gateway failures behind CORS/network errors; in
  that case the app cannot reliably identify the quota error from the response.

## Limits and verification

Worker caches do **not** survive cold starts or share memory across instances.
Recommendations still load the complete corpus on a cold worker. This reduces
avoidable traffic but does not guarantee the app will remain within a free
allowance. A larger deployment should move candidate selection/scoring near the
database or use a versioned shared catalogue cache; that is a separate change.

From `frontend`, run:

```sh
node --test server/chartFeed.test.js src/serviceRequests.test.js ../supabase/functions/murec2-api/*.test.mjs
npm run build
```

From the repository root, run the existing Python tests and:

```sh
npx deno check --no-lock --config supabase/functions/murec2-api/deno.json supabase/functions/murec2-api/index.ts
```

After service is restored, check real search/recommendation requests and compare
egress against the previous usage period. Do not reset query statistics during
the comparison. An open idle tab should not send status requests every 10 seconds.
