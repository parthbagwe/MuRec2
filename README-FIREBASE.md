# Cerum: independent no-billing Firebase edition

This is the `firebase-spark` working copy. The original checkout at
`D:/parthbagwe/MuRec2`, Supabase project and Vercel production are unchanged.

## Status

- Static Firebase Hosting build prepared; **not deployed until Firebase login and project setup are completed**.
- 5,896 public catalogue tracks; 5,893 measured acoustic fingerprints from the local read-only database.
- The public catalogue is about 3.2 MB compressed. It is downloaded on demand and cached in the browser, not loaded from Firestore for every search.
- The original recommendation/transition scoring functions run in a Web Worker. A parity test compares them with the server source using identical data.
- The audio player, 30-second preview limit, mixing, crossfades and visualiser implementation are unchanged.
- When a song is missing locally, Apple's documented browser Search API can find more tracks without a token. Search has provider rate limits and does not include every recording in the world.
- New previews use the existing browser audio analysis. New fingerprints currently last for the page session, not a shared online index.
- Firebase email/password accounts are **separate**. No existing passwords, users, favourites or private listening history have been exported.
- Firestore stores up to 100 favourites, the latest 30 recommendation runs and up to 100 feedback records per user in three private bounded documents. History and preferences are not public catalogue assets.
- The local snapshot does **not** contain derived lyric features. Lyrics influence is unavailable rather than fabricated. Existing acoustic scoring is identical given the same inputs, but results can differ from production when its data/lyrics differ.
- India/USA Top 50 are explicitly dated snapshots. Apple's RSS endpoint does not permit the browser access needed for a static live proxy. Refresh snapshots locally before publishing; no paid scheduled function is installed.

## No-billing boundary

Use a NEW Firebase project on **Spark**, with **no linked Cloud Billing account**.
Use only classic **Firebase Hosting**, **Firebase Authentication** (email/password),
and **Cloud Firestore Standard edition**. Do not select App Hosting, Cloud Functions,
Cloud Run, Cloud Storage, SQL Connect trials, Blaze or a paid integration.

Firebase limits still apply. As checked on 3 September 2026, Spark Hosting includes
360 MB/day transfer and 10 GB storage; Firestore includes 50,000 document reads/day,
20,000 writes/day, 1 GiB stored and 10 GiB/month outbound transfer. Check the live
[Firebase pricing page](https://firebase.google.com/pricing) before deployment.
Expect only roughly 100 completely uncached catalogue downloads per day after allowing
for other assets, not unlimited traffic. Existing browser caches reduce repeat downloads;
they cannot prevent denial of service or quota exhaustion. No billing means quota exhaustion
can make the copy unavailable, not automatically purchase more usage.

## Local preview

From `D:/parthbagwe/Cerum-Firebase/frontend`:

```powershell
npm ci
npm run dev:spark
```

Open `http://127.0.0.1:5174/`. Local music search works without Firebase configuration.
Signing in displays a clear setup message until Firebase is configured.
Use this command, not the original `npm run dev` / Vercel build, for the independent edition.

Firebase Hosting supplies public browser configuration at `/__/firebase/init.json`.
For a configured local preview, put the Firebase web app's public JSON configuration in
`frontend/.env.spark.local` as `VITE_FIREBASE_CONFIG='{"projectId":"...","apiKey":"...","appId":"...","authDomain":"..."}'`.
Never put service-account keys or private tokens there. Never paste an admin key into a browser build.

## Validation

```powershell
cd D:/parthbagwe/Cerum-Firebase/frontend
npm run test:spark
npm run build:spark
```

Security rules use the Firebase emulator only, with the non-production project ID `demo-cerum-spark`.
Java 21 is needed on the command's PATH:

```powershell
cd D:/parthbagwe/Cerum-Firebase
npx --yes firebase-tools@15.28.2 emulators:exec --project demo-cerum-spark --only firestore "node --test frontend/scripts/test-firestore-rules.mjs"
```

The tests check owner access, cross-account and guest denial, list limits and invalid writes.
On this Windows machine the Firestore emulator currently fails to start because Java cannot
create its loopback socket (`Invalid argument: connect`). These security tests are prepared
but have **not passed locally**. Run them in a working Java 21 environment before publishing.
Test real sign-up/sign-in, favourites, history, search and a complete five-song mix on the
Firebase URL after provisioning, before treating it as a production replacement.

## Publishing after Google sign-in

1. Authenticate using the official Firebase CLI login flow.
2. Create a **separate** Firebase project without billing or Analytics.
3. Register its web app; enable email/password sign-in. Add the actual Hosting domain to Auth's authorized domains if it is not already present.
4. Create the default Firestore database in **Standard edition / Native mode**, in a suitable region (for example Mumbai), without billing, in production/locked mode. Deploy `firestore.rules` before enabling public use.
5. Confirm the project's plan reads **Spark**, and that no billing account is linked.
6. From `frontend`, run `npm run charts:spark` (refresh dated charts), `npm run test:spark`, `npm run build:spark`.
7. From the new checkout root, deploy ONLY to the explicit new project:

```powershell
npx --yes firebase-tools@15.28.2 deploy --project NEW_FIREBASE_PROJECT_ID --only hosting,firestore:rules
```

Do not run Vercel, Supabase deploy/sync scripts, or Sites publishing from this copy.
The inherited `.openai/hosting.json` and original production environment belong to the
old site and are deliberately not used by `vite.spark.config.js`. The Spark build aliases
the original API module to the Firebase/browser adapter and does not load `.env.production`.
Do not push this branch to `main` or change the original production deployment settings.

## Updating the public snapshot

The exporter allows only song metadata and acoustic fingerprint fields, opens SQLite in
read-only mode and never opens the user database. Do not replace it with a blanket database dump.

```powershell
cd D:/parthbagwe/Cerum-Firebase
& D:/parthbagwe/MuRec2/.venv/Scripts/python.exe scripts/export_spark_catalogue.py --fingerprints D:/parthbagwe/MuRec2/data/acoustic-fingerprints.db
```

It creates a content-addressed compressed file and an updated manifest. Review output and
remove obsolete generated catalogue blobs deliberately before publishing a new version.
There is no live replication from Supabase and no audio files are hosted in the catalogue.
