# Cerum logo reveal

Status: animated in SVGator, exported, and integrated into Cerum.
`cerum-logo-svgator.svg` remains the editable static source artwork. The actual
SVGator export is `frontend/public/cerum-logo-reveal.svg`.

SVGator project: https://app.svgator.com/editor#/e80dc3e01a4c4115ab76b16a1bf7f45e

## SVGator timeline

Website display: 1.85 seconds on every full page load. Canvas: 400 × 400.
Charcoal background.

- 0.00–0.65s: four copper sound bars fade in on staggered timings.
- 0.00–1.10s: the Cerum wordmark fades in below the mark.
- 1.10–1.85s: the completed lockup holds for recognition before the page appears.

Keep each named bar on its own layer. Use Manrope ExtraBold for the wordmark;
confirm its appearance and convert text to outlines before the final export.
Choose eased transforms and opacity. Preserve any watermark required by the
account's export plan. Do not purchase an upgrade without the user's approval.

## Website integration after export

The introduction shows whenever Cerum is opened or fully refreshed, provides a
Skip button, bypasses itself when reduced motion is requested, and dismisses
itself if the SVG cannot load. The page renders underneath so the reveal never
delays application data.

The export comes from SVGator's free plan and preserves its required watermark.
