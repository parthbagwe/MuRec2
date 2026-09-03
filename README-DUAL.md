# Cerum: one main site, two account providers

The main site is https://cerum.vercel.app. The existing Firebase-only site,
https://cerum-spark-parth-2026.web.app, remains independent and unchanged.

## Current operation

- `frontend/vite.dual.config.js` builds the main site. Vercel runs `npm run build:dual` from `frontend`.
- `frontend/public/service-config.json` chooses the **primary public music service and default registration provider**, currently `firebase`. It is imported at build time: editing it requires rebuilding and deploying.
- Both account options remain visible. Firebase users use Firebase Auth and their own Firestore library; original users use Supabase Auth and their existing RLS-protected tables. Passwords are submitted only to the explicitly selected service. There is no automatic account linking, private-data duplication, or credential migration.
- Existing provider selection survives reload and a change of primary. An existing Supabase session is restored on the first dual-site visit where possible. Sessions do not automatically transfer between the Firebase Hosting and Vercel domains; use the same Firebase credentials on either.
- Firebase-primary public search/recommendations use the browser worker and a versioned public catalogue, with Apple catalogue lookup for missing songs. Firebase stores private libraries, not full music files. Previews remain 30 seconds; the player, transitions, and visualizer are unchanged.
- Supabase-primary public calls use only the publishable API key, never Firebase tokens or private preferences. Public service failure falls back to the browser engine, with a 5-minute cooldown for quota errors. Personal picks are computed locally using only the current user's provider-specific preferences.
- Private library failures are reported, never silently redirected to the other database. Supabase quota restrictions can still prevent original account access until the service recovers.
- Firebase bounds remain 100 favourites, 30 mixes, 100 feedback entries. No billing, Cloud Functions, Cloud Run, or new paid services were enabled. Firebase configuration in `public/firebase-config.json` is intentionally public web-app configuration; security is enforced by Auth and Firestore rules.
- Browser catalogue excludes derived lyric vectors. While browser fallback is active, do not claim server-side lyric matching or live charts: its charts are dated snapshots. The Supabase path can restore live/server features once healthy.

## September 14, 2026 switch

A one-off Codex thread heartbeat, `restore-cerum-supabase-primary`, is scheduled for September 14 at 09:00 Asia/Kolkata. It must verify the quota reset and public health/search/recommendation responses before changing the primary. It is not a blind browser date switch.

1. Check live Supabase project `cslrzklwebgmsjznadki` with small public requests. If still restricted, leave Firebase primary and report the limitation. Do not upgrade billing or remove spend caps.
2. Set `primary` to `supabase` in `frontend/public/service-config.json`. Preserve both account options and Firebase config.
3. Run `npm ci`, `npm run test:dual`, `npm run test:spark`, `node --test src/serviceRequests.test.js server/chartFeed.test.js`, and `npm run build:dual` from `frontend`.
4. Verify both sign-in choices, public search, recommendation queue, playback, fallback behaviour, and account-specific library isolation. Do not access unrelated real-user data. Never publish untested schema or rule changes.
5. Use the linked project `cerum` from the repository root (its Vercel root directory is `frontend`). Pull production settings, stage a production deployment with `--prod --skip-domain`, validate, then promote that exact artifact. A local `vercel build` can fail with Windows `spawn cmd.exe ENOENT`; in that case use the remote Vercel build, not a different project. `.vercelignore` limits uploaded source to the frontend and excludes local secrets and build output. Commit and push main to GitHub without force-pushing.
6. Verify https://cerum.vercel.app/service-config.json and the live UI, then report the result. Keep Firebase logins and its independent Hosting site working.

The scheduler needs this local Codex environment and deployment credentials available when it runs. If unavailable, the site safely stays Firebase-primary until the task can run.

## Development and rollback

Validation on September 3: 17 dual-routing/session tests, 21 browser-engine/scoring parity tests, 10 request/chart regression tests, and 25 live Firebase Auth/Firestore security checks. Browser checks exercise both account choices, Firebase login, search/playback, favourite saves, history and favourites after reload, sign-out, and registration error handling. Temporary test accounts and their documents are removed by the verification script. Supabase live health currently returns HTTP 402 (`exceed_egress_quota`), so original-account live verification must wait for recovery; it is not represented as passing.

`frontend/scripts/test-dual-browser.mjs` is an opt-in live test for the local dual URL or main Vercel URL. Set `CERUM_AGENT_BROWSER_CLI` to an installed agent-browser entry point. The `--registration-only` option tests duplicate-email handling separately. The script only creates/removes its own randomized Firebase test account.

`npm run dev:dual` starts the combined site on port 5175. The old `npm run dev` / Sites path and `build:spark` are independent targets.

For a service-only rollback, change `primary` back to `firebase`, test, rebuild, and redeploy. No database rollback or account deletion is needed. For a full deployment rollback, inspect Vercel's deployment history and promote the exact verified prior artifact. The pre-dual production artifact was `dpl_FGBLyX4b11e2DdmcteGR5Mri2TQh`; it does not contain Firebase account UI.
