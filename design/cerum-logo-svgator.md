# Cerum logo reveal

Status: animated in SVGator and exported as a retained design reference. Cerum
now uses a native full-screen implementation so the production introduction has
no third-party watermark.
`cerum-logo-svgator.svg` remains the editable static source artwork. The actual
SVGator export is `frontend/public/cerum-logo-reveal.svg`.

SVGator project: https://app.svgator.com/editor#/e80dc3e01a4c4115ab76b16a1bf7f45e

## SVGator timeline

Website display: 2.4 seconds on every full page load. It fills the viewport with
a black background and scales the mark responsively for desktop and mobile.

- 0.00–0.65s: four copper sound bars fade in on staggered timings.
- 0.00–1.10s: the Cerum wordmark fades in below the mark.
- 1.10–1.85s: the completed lockup holds for recognition before the page appears.

Keep each named bar on its own layer. Use Manrope ExtraBold for the wordmark;
confirm its appearance and convert text to outlines before the final export.
Choose eased transforms and opacity. Preserve any watermark required by the
account's export plan. Do not purchase an upgrade without the user's approval.

## Website integration after export

The introduction shows whenever Cerum is opened or fully refreshed, provides a
Skip button, and bypasses itself when reduced motion is requested. The page
renders underneath so the reveal never delays application data.

The original SVGator export remains unmodified in the repository and preserves
its required watermark, but it is no longer loaded by the production interface.
