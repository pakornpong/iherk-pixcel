# Turntable Pixel-Grid Snapping — Design

Date: 2026-11-28
Scope: `src/preview/public/turntable.js`, `src/preview/public/app.js`, `src/preview/public/index.html`

## Intent and why

The WebGL2 turntable viewer renders geometry into a low-resolution FBO
(`floor(canvas / pixelSize)`) and blits it up with `NEAREST`. The pixel grid is
anchored to the canvas, not to the world, and the camera state is fully
continuous: drag inertia, `autoSpin` at 48 deg/s, a `×1.12`-per-click wheel zoom
and a world-unit `uPan`. So between frames every silhouette edge lands on a
different side of a grid boundary and shimmers — pixel crawl. That artifact is
what makes the preview read as "a low-res 3D model" rather than as pixel art.

A second, quieter cost: the viewer currently shows yaw angles the export never
produces. `renderTurntableSequence` emits 36 frames (10 deg steps), so a viewer
sitting at 37.4 deg is previewing a frame that does not exist in any artifact.

## Goals

- Remove crawl from the interactive viewer during spin, drag, zoom and pan.
- Make the viewer's reachable yaws a strict superset of what the export produces:
  every export angle is reachable in the viewer, and half the viewer's positions
  (the odd multiples of 5) are export frames, so those previews are real frames.
  A subset is unachievable. The reachable lattice is every multiple of 5 (72 yaws);
  `renderTurntableSequence` at 36 frames emits `45 + 10k`, the odd multiples of 5.
  The presets are not a subset of the export set: 0, 90, 180 and 270 are even
  multiples of 5 and are never exported, while 45 and 315 are odd and are. So no
  lattice can hold the presets and also be a subset of the export. Pitch is
  unaffected: the export takes pitch from the request, which the UI now fills with
  the snapped pitch.
- Keep it switchable, so smooth orbiting is still available.

## Non-goals

- The CPU export path. `renderTurntableSequence` already renders at discrete
  yaws onto one fixed canvas, anchored on a shared footprint centre, and
  rasterizes straight to output resolution with no low-res upscale. It has no
  sub-pixel grid misalignment, so there is nothing here for snapping to fix.
  Frame-to-frame difference in an exported GIF is genuine re-sampling of the
  geometry at a new angle.
- Interior normal/depth edge detection. Separate piece of work.
- `pixelMode === "3d"`, which renders at full canvas resolution and has no
  pixel grid to align to.

## Anti-goals

- Do not quantize the stored camera state. If `yawDeg`, `zoom` or `panX/Y` are
  rounded in place, the `snapTo()` easing in `_step()` cannot converge on its
  target and `autoSpin`'s per-frame `spinSpeed * dt` increment can be rounded
  away entirely.
- Do not make `snapTo()`'s animated transitions jump. Snapping is a render-time
  concern; the animation stays continuous underneath it.

## Constraints

- Zero dependencies; the projection is hand-rolled in `GEOM_VERT`, driven by
  `uCamRight` / `uCamUp` / `uCamForward` / `uHalfView` / `uPan`.
- `halfW / fboW == halfH / fboH` because `aspect` is derived from the FBO, so
  world-units-per-pixel is already square. One scalar covers both axes.

## Approaches considered

1. **Quantize the stored state** on input and in `_step()`. Simplest, but it
   breaks the existing easing and inertia (see Anti-goals). Rejected.
2. **Snap at render time** — keep continuous state, derive snapped values as
   locals in `render()` and feed those to the uniforms. This is what the
   three.js example does (it clones the camera transform, snaps, renders and
   restores, specifically to leave OrbitControls untouched). Here it is cheaper
   still: because the projection is built from uniforms rather than from a
   camera object, nothing needs cloning or restoring — the snapped values simply
   never reach `this`. **Chosen.**

## Design

All of this lives in `render()`, gated on
`this.pixelSnap && this.pixelMode === "pixelart"`.

**Yaw and pitch.** `yawRender = round(yawDeg / snapStepDeg) * snapStepDeg`, same
for pitch with the same step. A step of `0` or less passes the angle through (not reachable from the UI).

Default step `5`, revised from `10` during execution. The lattice has to contain
two existing angle sets: the eight 45 deg preset directions wired to the
`data-yaw` buttons in `index.html` (the viewer opens on 315), and the 36 angles
`renderTurntableSequence` emits (`startYawDeg` 45 plus 10 deg increments, i.e.
the odd multiples of 5). A step of 10 contains neither — it moves all eight
presets, 315 included. Steps 9, 15 and 45 contain the presets but not the export
angles. Only 5 contains both, giving 72 positions. Pitch 30 is on the lattice
either way.

**Zoom.** Snap so voxel edges land on pixel boundaries, which matters more for a
voxel model than three.js's arbitrary 0.1 zoom steps. Pixels per voxel is
`ppv = zoom * fboH / (2 * 1.32 * bounds.radius)`. Snap `ppv` to the nearest
integer when `ppv >= 1`, and to the nearest `1/n` when `ppv < 1`; then back out
the `halfH` that produces it, rather than writing a snapped zoom to state.

**Pan.** With `wpp` (world units per pixel) computed from the *snapped* `halfH`,
`panRender = round(pan / wpp) * wpp` on both axes.

**Order matters:** yaw/pitch first, then zoom (sets `wpp`), then pan (consumes
`wpp`).

**HUD.** `onHudUpdate` reports the snapped yaw and pitch, since the HUD
describes what is on screen. Add `ppv` to the payload so the effective voxel
scale is visible.

**Controls.** A "Pixel Snap" checkbox (default on) and a yaw-step control next
to it in the turntable panel of `index.html`, wired in `app.js` alongside the
existing `chk-tt-outline` handler. Disabled in 3D mode.

## Left to the builder

- Exact widget type for the yaw step (select with 5/9/10/15/45 vs. a range).
- Whether the step list is filtered to divisors of 360.
