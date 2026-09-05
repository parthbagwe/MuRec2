# Cerum listening room · September 2026

Art-led music discovery with warm charcoal, muted copper, restrained motion and
a dedicated phone composition. The homepage now provides real playable starting
points instead of a promotional slogan. The record sleeve and grooves are CSS,
not a heavyweight WebGL embed. Original React/CSS components use the existing
Motion dependency; no new design subscriptions or packages were added.

## Research and references

- Music-app critique: https://www.reddit.com/r/UI_Design/comments/ma0rp8
  Keep the current track clear and maintain consistent spacing and metadata.
- Queue usability discussion: https://www.reddit.com/r/YoutubeMusic/comments/1st9ui8/i_got_the_new_ui/
  Do not let artwork crowd playback controls or the queue. Forum comments are
  qualitative inspiration, not a representative usability study.
- Spline: https://spline.design/ and
  https://docs.spline.design/exporting-your-scene/how-to-optimize-your-scene
  Dimensional artwork inspired the lightweight CSS record scene. No Spline scene
  was embedded or created, and no fabricated scene URL is used.
- Recent Design: https://recent.design/
  Editorial hierarchy, considered type scale and art-led layouts.
- Skiper: https://skiper-ui.com/ and https://skiper-ui.com/docs/quick-start
  Tactile buttons and compact player treatment. No Skiper components were copied
  or installed; its free-component attribution conditions therefore do not apply.
- Aceternity: https://ui.aceternity.com/components/apple-cards-carousel and
  https://ui.aceternity.com/components/floating-dock
  Album shelves and a phone dock informed original implementations, not imports.
- Manus: https://manus.im/
  Reviewed as a product/interface reference, not invoked as an app-building service.

## Boundaries

- The recommendation engine, public catalogue, provider routing, private account
  storage and September 14 Supabase review schedule are unchanged.
- The existing AutoMix, 30-second limit, playback handoff, preview analyzer and
  fullscreen sine-wave renderer are unchanged. Shelf selection hands a single
  gesture-started audio element into the same mixer used by search.
- The small editorial shelf comes from existing public song metadata. It is not
  represented as a personal recommendation or a current chart.
- Charts explicitly identify snapshots instead of calling them live.
- Phone navigation includes safe-area space. The mini-player sits above it.
  Search remains anchored to its input; overlays appear above navigation.
- Motion honors reduced-motion settings. The album scene is decorative; every
  playable shelf item has an accessible title and artist label.

## Checks

`npm run build:dual`

`npm run test:dual`

`npm run test:spark`

`node --test src/discovery.test.mjs src/serviceRequests.test.js`

The discovery tests verify catalogue membership and single-element playback
handoff, including blocked autoplay. Existing tests cover search ranking,
recommendation parity, caching, account-provider isolation and mixer source
preservation. Browser-based visual QA was not performed in this pass.
