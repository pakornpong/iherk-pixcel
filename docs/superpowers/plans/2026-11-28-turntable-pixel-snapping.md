# Turntable Pixel-Grid Snapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop pixel crawl in the WebGL2 turntable viewer by snapping camera yaw, pitch, zoom and pan to the pixel grid at render time.

**Architecture:** Three pure functions exported from `turntable.js` do the arithmetic and are unit-tested in node. `render()` calls them to derive locals it feeds to the existing uniforms; the continuous camera state on `this` is never written. A checkbox and a step selector in the preview UI toggle it.

**Tech Stack:** Zero-dependency WebGL2 ES module (`src/preview/public/turntable.js`), vanilla DOM UI (`app.js` / `index.html`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-turntable-pixel-snapping-design.md`

## Global Constraints

- Zero new dependencies.
- Never assign snapped values back to `this.yawDeg`, `this.pitchDeg`, `this.zoom`, `this.panX` or `this.panY`. The easing in `_step()` and `autoSpin`'s per-frame increment both require continuous state.
- Snapping applies only when `pixelSnap` is on **and** `pixelMode === "pixelart"`.
- Pitch stays within the existing `±89` clamp after snapping.
- Default yaw/pitch step is `5` degrees. It is the only step that leaves every one of the viewer's eight
  45-degree preset directions unmoved AND contains all 36 angles the export produces (`startYawDeg` 45 plus
  10-degree increments, i.e. the odd multiples of 5). Steps 9, 15 and 45 hold the presets but not the export
  angles; 10 holds neither.

## Review Focus

1. **Step of `0`** (snap off via the step control) must return the angle untouched rather than dividing by zero and producing `NaN` uniforms. Test in Task 1.
2. **Pitch snapped past the clamp** — `-89` with step `10` rounds to `-90`, outside the `±89` range the rest of the viewer assumes. Must clamp after snapping. Test in Task 1.
3. **`ppv` well below 1** (large asset zoomed out) — the `1/n` branch must not yield `0` or `Infinity`. Test in Task 1.
4. **Degenerate bounds** — `bounds.radius === 0` (empty or single-voxel mesh) makes `halfH` zero and `ppv` infinite. Must fall back rather than emit `NaN`. Test in Task 1.
5. **3D mode unaffected** — with `pixelMode === "3d"` the FBO is the full canvas and there is no grid; `render()` must use the raw values. Test in Task 2.

---

### Task 1: Snapping arithmetic

**Files:**
- Modify: `src/preview/public/turntable.js` (add exports next to `computeCameraBasis`, around line 11)
- Test: `tests/preview/pixel-snapping.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `snapAngle(deg: number, stepDeg: number) => number`
  - `snapViewScale(halfH: number, fboH: number) => { halfH: number, worldPerPixel: number, pixelsPerVoxel: number }`
  - `snapPan(pan: number, worldPerPixel: number) => number`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { snapAngle, snapViewScale, snapPan } from "../../src/preview/public/turntable.js";

describe("snapAngle", () => {
  it("rounds to the nearest step", () => {
    expect(snapAngle(37.4, 10)).toBe(40);
    expect(snapAngle(312.6, 10)).toBe(310);
  });
  it("passes the angle through when the step is 0 or negative", () => {
    expect(snapAngle(37.4, 0)).toBe(37.4);
    expect(snapAngle(37.4, -5)).toBe(37.4);
  });
  it("leaves every viewer preset and every export angle untouched at the default step", () => {
    // The eight preset directions in index.html, and the viewer's 315/30 default pose
    for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(snapAngle(yaw, 5)).toBe(yaw);
    }
    expect(snapAngle(30, 5)).toBe(30);
    // The 36 angles renderTurntableSequence emits: startYawDeg 45 + 10k
    for (let i = 0; i < 36; i++) {
      const yaw = (45 + i * 10) % 360;
      expect(snapAngle(yaw, 5)).toBe(yaw);
    }
  });
  it("rounds negative angles", () => {
    expect(snapAngle(-24, 10)).toBe(-20);
  });
});

describe("snapViewScale", () => {
  it("snaps a fractional pixels-per-voxel up to a whole number", () => {
    // halfH 10, fboH 48 -> ppv 2.4 -> 2 -> halfH 12
    const r = snapViewScale(10, 48);
    expect(r.pixelsPerVoxel).toBe(2);
    expect(r.halfH).toBeCloseTo(12);
    expect(r.worldPerPixel).toBeCloseTo(0.5);
  });
  it("snaps sub-1 pixels-per-voxel to a unit fraction", () => {
    // halfH 60, fboH 48 -> ppv 0.4 -> 1/round(2.5)=1/3 (ties round up)
    const r = snapViewScale(60, 48);
    expect(r.pixelsPerVoxel).toBeCloseTo(1 / 3);
    expect(r.worldPerPixel).toBeCloseTo(3);
  });
  it("never returns 0 or a non-finite scale for an extreme zoom-out", () => {
    const r = snapViewScale(1e6, 48);
    expect(r.pixelsPerVoxel).toBeGreaterThan(0);
    expect(Number.isFinite(r.worldPerPixel)).toBe(true);
    expect(Number.isFinite(r.halfH)).toBe(true);
  });
  it("falls back to unsnapped values for degenerate bounds", () => {
    const r = snapViewScale(0, 48);
    expect(Number.isFinite(r.halfH)).toBe(true);
    expect(Number.isFinite(r.worldPerPixel)).toBe(true);
    expect(r.worldPerPixel).toBeGreaterThan(0);
  });
});

describe("snapPan", () => {
  it("quantizes to whole pixels", () => {
    expect(snapPan(2.37, 0.5)).toBeCloseTo(2.5);
    expect(snapPan(-2.37, 0.5)).toBeCloseTo(-2.5);
    expect(snapPan(0, 0.5)).toBe(0);
  });
  it("passes through when the pixel size is not usable", () => {
    expect(snapPan(2.37, 0)).toBe(2.37);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/preview/pixel-snapping.test.ts`
Expected: FAIL — `snapAngle` is not exported.

- [ ] **Step 3: Implement the three functions in `src/preview/public/turntable.js`**

`snapAngle` returns `deg` unchanged when `stepDeg <= 0` or either argument is not finite; otherwise `Math.round(deg / stepDeg) * stepDeg`.

`snapViewScale` computes `ppv = fboH / (2 * halfH)`. When `halfH`, `fboH` or `ppv` is not finite or not positive, substitute `halfH = 1` and `fboH = 1` for whichever is unusable and carry on through the same snapping path, so every returned field is finite and `worldPerPixel > 0`. Otherwise snap: `ppv >= 1` gives `Math.round(ppv)`; `ppv < 1` gives `1 / Math.max(1, Math.round(1 / ppv))`. Derive `halfH = fboH / (2 * ppvSnapped)` and `worldPerPixel = 1 / ppvSnapped`.

`snapPan` returns `pan` unchanged when `worldPerPixel` is not finite or `<= 0`; otherwise `Math.round(pan / worldPerPixel) * worldPerPixel`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/preview/pixel-snapping.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/preview/public/turntable.js tests/preview/pixel-snapping.test.ts
git commit -m "feat(preview): add pixel-grid snapping arithmetic for the turntable camera"
```

---

### Task 2: Apply snapping in the render path

**Files:**
- Modify: `src/preview/public/turntable.js` — constructor state (around line 262-280), `render()` (around line 544-625)
- Test: `tests/preview/pixel-snapping.test.ts` (extend)

**Interfaces:**
- Consumes: `snapAngle`, `snapViewScale`, `snapPan` from Task 1.
- Produces:
  - Instance fields `pixelSnap: boolean` (default `true`) and `yawSnapDeg: number` (default `DEFAULT_SNAP_STEP_DEG` = `5`; renamed to `snapStepDeg` in Task 3).
  - `computeRenderCamera(state: { yawDeg, pitchDeg, panX, panY, zoom, pixelSnap, yawSnapDeg, pixelMode, radius, fboW, fboH }) => { yawDeg, pitchDeg, halfW, halfH, panX, panY, pixelsPerVoxel }`, exported, so the whole snapped camera is testable without a GL context.

- [ ] **Step 1: Write the failing tests**

```ts
import { computeRenderCamera } from "../../src/preview/public/turntable.js";

const base = {
  yawDeg: 37.4, pitchDeg: 30, panX: 2.37, panY: -1.1, zoom: 1,
  pixelSnap: true, yawSnapDeg: 5, pixelMode: "pixelart",
  radius: 22, fboW: 160, fboH: 120,
};

describe("computeRenderCamera", () => {
  it("snaps yaw, pan and view scale in pixelart mode", () => {
    // radius 22, zoom 1 -> halfH 29.04; fboH 120 -> ppv 2.066 -> 2 -> halfH 30, worldPerPixel 0.5
    const c = computeRenderCamera(base);
    expect(c.yawDeg).toBe(35); // 37.4 / 5 -> 7 -> 35
    expect(c.pixelsPerVoxel).toBe(2);
    expect(c.halfH).toBeCloseTo(30);
    expect(c.panX).toBeCloseTo(2.5);   // 2.37 / 0.5 -> 5 -> 2.5
    expect(c.panY).toBeCloseTo(-1.0);  // -1.1 / 0.5 -> -2 -> -1.0
  });
  it("leaves 3D mode untouched", () => {
    const c = computeRenderCamera({ ...base, pixelMode: "3d" });
    expect(c.yawDeg).toBe(37.4);
    expect(c.panX).toBe(2.37);
    expect(c.halfH).toBeCloseTo((22 * 1.32) / 1);
  });
  it("leaves everything untouched when pixelSnap is off", () => {
    const c = computeRenderCamera({ ...base, pixelSnap: false });
    expect(c.yawDeg).toBe(37.4);
    expect(c.panX).toBe(2.37);
  });
  it("clamps a snapped pitch back inside the +/-89 range", () => {
    expect(computeRenderCamera({ ...base, pitchDeg: -89 }).pitchDeg).toBe(-89);
    expect(computeRenderCamera({ ...base, pitchDeg: 89 }).pitchDeg).toBe(89);
  });
  it("keeps halfW consistent with the FBO aspect", () => {
    const c = computeRenderCamera(base);
    expect(c.halfW / c.halfH).toBeCloseTo(160 / 120);
  });
  it("survives a zero radius", () => {
    const c = computeRenderCamera({ ...base, radius: 0 });
    expect(Number.isFinite(c.halfH)).toBe(true);
    expect(Number.isFinite(c.halfW)).toBe(true);
    expect(Number.isFinite(c.panX)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/preview/pixel-snapping.test.ts`
Expected: FAIL — `computeRenderCamera` is not exported.

- [ ] **Step 3: Implement `computeRenderCamera` and call it from `render()`**

`computeRenderCamera` holds the order the spec fixes: snap yaw and pitch (then re-clamp pitch to `±89`), then `snapViewScale` for `halfH`, then `snapPan` for both axes using that scale's `worldPerPixel`. `halfW = halfH * (fboW / fboH)`. When snapping is off or the mode is `"3d"`, it returns the unsnapped values, with `halfH = (radius * 1.32) / zoom` as `render()` computes today.

In `render()`, replace the inline `aspect` / `halfH` / `halfW` block and the `uPan` / `computeCameraBasis` call sites with one `computeRenderCamera` call, then feed its fields to the existing uniforms. The light direction uses the same snapped basis, so `computeCameraBasis` is called with the snapped angles.

- [ ] **Step 4: Add `pixelSnap` and `yawSnapDeg` to the constructor**

Set `this.pixelSnap = true` and `this.yawSnapDeg = 5` beside `this.pixelSize` (around line 268).

- [ ] **Step 5: Report the snapped camera in the HUD**

Extend the `onHudUpdate` payload (around line 616) with the snapped `yawDeg` and `pitchDeg` from `computeRenderCamera` in place of the raw state, plus `pixelsPerVoxel`.

- [ ] **Step 6: Run the whole suite to verify nothing regressed**

Run: `npm test`
Expected: PASS, including the pre-existing `tests/core/turntable.test.ts` and `tests/preview/preview-server.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/preview/public/turntable.js tests/preview/pixel-snapping.test.ts
git commit -m "feat(preview): snap the turntable camera to the pixel grid at render time"
```

---

### Task 3: Viewer controls

**Files:**
- Modify: `src/preview/public/index.html` — turntable panel, after the outline checkbox (line 52)
- Modify: `src/preview/public/app.js` — control wiring, beside the `chk-tt-outline` handler (line 317); HUD rendering wherever `onHudUpdate`'s payload is consumed
- Test: `tests/preview/preview-server.test.ts` (extend the existing served-HTML assertions)

**Interfaces:**
- Consumes: `turntable.pixelSnap`, `turntable.yawSnapDeg` from Task 2 (which this task renames to `snapStepDeg`).
- Produces: no new module surface.

- [ ] **Step 1: Write the failing test**

```ts
// in the existing "serves HTML UI..." test, beside the current htmlText assertions
expect(htmlText).toContain('id="chk-tt-snap"');
expect(htmlText).toContain('id="tt-snap-select"');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/preview/preview-server.test.ts`
Expected: FAIL — the served HTML has neither id.

- [ ] **Step 3: Add the controls to `index.html`**

A `label.check` holding `<input id="chk-tt-snap" type="checkbox" checked />` labelled "Pixel Snap (Stepped Rotation)", and a `<label>` holding `<select id="tt-snap-select">` with options `5` (selected), `9`, `15`, `45` — the divisors of 45 that also divide 360, so every one of them leaves the eight preset directions unmoved — plus a `0` option labelled "Off". `10` is deliberately absent: it moves all eight presets. Follow the markup shape of the surrounding `chk-tt-outline` and `tt-light-select` blocks.

- [ ] **Step 4: Wire them in `app.js`**

`el("chk-tt-snap").onchange` sets `turntable.pixelSnap`; `el("tt-snap-select").onchange` sets `turntable.snapStepDeg = Number(e.target.value)`. Both follow the existing one-line handler style. In the render-mode buttons (around line 289-302), disable both controls when the mode is `3d`, since snapping does not apply there.

- [ ] **Step 4b: Rename `yawSnapDeg` to `snapStepDeg`**

The field quantizes pitch as well as yaw, so the name is wrong. Rename every reader in the same commit: 4 sites in `src/preview/public/turntable.js` (the constructor, the state object `render()` builds, and the two uses inside `computeRenderCamera`) and 1 fixture key in `tests/preview/pixel-snapping.test.ts`. `index.html` has no reader. `DEFAULT_SNAP_STEP_DEG` keeps its name.

- [ ] **Step 4c: Pin the default constant's value**

`tests/preview/pixel-snapping.test.ts`: add `expect(DEFAULT_SNAP_STEP_DEG).toBe(5);` and change the `computeRenderCamera` base fixture to use the constant instead of a literal. Without this the lattice test passes even if the constant goes missing, because `snapAngle` passes angles through on a non-finite step — so nothing currently pins the design's central invariant, that 5 is the only step fitting both lattices.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/preview/preview-server.test.ts`
Expected: PASS

- [ ] **Step 6: Verify in a browser**

Start the preview server, open the turntable tab, set Pixel Size to 8 so the grid is obvious, and press Spin 360°. Expected: with Pixel Snap on, the rotation advances in visible 10 degree steps and silhouette edges hold still between steps; with it off, edges shimmer continuously. Screenshot both.

- [ ] **Step 7: Commit**

```bash
git add src/preview/public/index.html src/preview/public/app.js tests/preview/preview-server.test.ts
git commit -m "feat(preview): add Pixel Snap controls to the turntable panel"
```
