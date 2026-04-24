# Servo media controls style clones

This folder contains **standalone HTML pages** that clone Servo’s built-in media controls widgets so you can iterate on styling quickly in a regular browser (e.g. Chrome), then port the final changes back into Servo.

## Files

- `video-controls-clone.html`: video-style controls clone (includes fullscreen button).
- `audio-controls-clone.html`: audio-style controls clone (no fullscreen button).
- `shared/media-controls.css`: starts as a direct copy of Servo’s internal stylesheet and then includes a clearly marked section for the 2-row “beautified” layout work.
- `shared/harness.js`: small interaction harness to toggle the same state classes Servo uses (`playing/paused/ended`, `muted/volumeup`, `fullscreen-active`).
- `shared/page.css`: page-only scaffolding (mock video surface, typography). Not intended to be ported.

## Port-back strategy (keeping it Servo-internal-compatible)

Servo’s source of truth is:

- `components/script/resources/media-controls.js` (markup template in `generateMarkup(isAudioOnly)`)
- `components/script/resources/media-controls.css` (controls styling injected into the UA shadow root)

To port changes back:

1. **DOM structure**: apply the same wrapper structure used in `video-controls-clone.html` to Servo’s `generateMarkup(false)` output (keep the existing IDs intact).
   - The Servo JS queries elements by `id` (`getElementById`), so adding wrapper `<div>`s is safe as long as the IDs remain unchanged.
2. **CSS**: copy the “beautified 2-row layout” section from `shared/media-controls.css` into Servo’s `components/script/resources/media-controls.css`.
   - Avoid bringing over anything from `shared/page.css` (that’s clone-only scaffolding).

## Quick usage

Open these files directly in Chrome:

- `tests/manual/media-controls-style-clone/video-controls-clone.html`
- `tests/manual/media-controls-style-clone/audio-controls-clone.html`

