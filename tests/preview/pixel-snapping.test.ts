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
