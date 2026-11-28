import { describe, it, expect } from "vitest";
import {
  snapAngle,
  snapViewScale,
  snapPan,
  computeRenderCamera,
  DEFAULT_SNAP_STEP_DEG,
} from "../../src/preview/public/turntable.js";

describe("snapAngle", () => {
  it("rounds to the nearest step", () => {
    expect(snapAngle(37.4, 10)).toBe(40);
    expect(snapAngle(312.6, 10)).toBe(310);
  });
  it("passes the angle through when the step is 0 or negative", () => {
    expect(snapAngle(37.4, 0)).toBe(37.4);
    expect(snapAngle(37.4, -5)).toBe(37.4);
  });
  it("defaults to the one step that fits both the presets and the export lattice", () => {
    expect(DEFAULT_SNAP_STEP_DEG).toBe(5);
  });
  it("leaves every viewer preset and every export angle untouched at the default step", () => {
    // The eight preset directions in index.html, and the viewer's 315/30 default pose
    for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(snapAngle(yaw, DEFAULT_SNAP_STEP_DEG)).toBe(yaw);
    }
    expect(snapAngle(30, DEFAULT_SNAP_STEP_DEG)).toBe(30);
    // The 36 angles renderTurntableSequence emits: startYawDeg 45 + 10k
    for (let i = 0; i < 36; i++) {
      const yaw = (45 + i * 10) % 360;
      expect(snapAngle(yaw, DEFAULT_SNAP_STEP_DEG)).toBe(yaw);
    }
  });
  it("rounds negative angles", () => {
    expect(snapAngle(-24, 10)).toBe(-20);
  });
});

describe("snapViewScale", () => {
  it("snaps a fractional pixels-per-voxel to the nearest whole number", () => {
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
  it("substitutes 1 for an unusable halfH, which zooms in hard rather than passing through", () => {
    for (const bad of [0, NaN, -5]) {
      const r = snapViewScale(bad, 48);
      expect(r.pixelsPerVoxel).toBe(24); // h = 1 -> 48 / 2
      expect(r.halfH).toBeCloseTo(1);
      expect(r.worldPerPixel).toBeCloseTo(1 / 24);
    }
  });
  it("substitutes 1 for an unusable fboH", () => {
    // f = 1, halfH 10 -> ppv 0.05 -> 1/20
    const r = snapViewScale(10, 0);
    expect(r.pixelsPerVoxel).toBeCloseTo(0.05);
    expect(r.halfH).toBeCloseTo(10);
    expect(r.worldPerPixel).toBeCloseTo(20);
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

const base = {
  yawDeg: 37.4, pitchDeg: 30, panX: 2.37, panY: -1.1, zoom: 1,
  pixelSnap: true, snapStepDeg: DEFAULT_SNAP_STEP_DEG, pixelMode: "pixelart",
  radius: 22, fboW: 160, fboH: 120,
};

describe("computeRenderCamera", () => {
  it("never writes through its state object", () => {
    const frozen = Object.freeze({ ...base });
    const before = JSON.stringify(frozen);
    expect(() => computeRenderCamera(frozen)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
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
