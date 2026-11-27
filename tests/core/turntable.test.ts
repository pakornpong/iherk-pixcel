import { describe, expect, it } from "vitest";
import { buildCharacterAsset } from "../../src/core/character-builder.js";
import { compileAssetAnimations } from "../../src/core/dsl-compiler.js";
import { encodeAnimatedGIF } from "../../src/core/exporters/gif.js";
import { buildVoxelMesh, serializeVoxelMesh } from "../../src/core/mesh-builder.js";
import { loadPalette } from "../../src/core/palette.js";
import {
  computeOrthoCameraBasis,
  renderAssetAtAngle,
  renderTurntableSequence,
} from "../../src/core/turntable-rasterizer.js";
import { VoxelGrid } from "../../src/core/voxel-grid.js";
import { PixcelAssetSchema } from "../../src/core/schema.js";

describe("Phase 3: 360° Orthographic Mesh Builder & Turntable Rasterizer", () => {
  it("computes orthonormal camera basis vectors without gimbal singularity even at pitch=90", () => {
    for (const yaw of [0, 45, 90, 135, 180, 270, 315]) {
      for (const pitch of [-90, 0, 30, 45, 90]) {
        const cam = computeOrthoCameraBasis(yaw, pitch);
        const lenF = Math.hypot(...cam.forward);
        const lenR = Math.hypot(...cam.right);
        const lenU = Math.hypot(...cam.up);
        expect(lenF).toBeCloseTo(1, 5);
        expect(lenR).toBeCloseTo(1, 5);
        expect(lenU).toBeCloseTo(1, 5);
        const dotFR = cam.forward[0] * cam.right[0] + cam.forward[1] * cam.right[1] + cam.forward[2] * cam.right[2];
        const dotFU = cam.forward[0] * cam.up[0] + cam.forward[1] * cam.up[1] + cam.forward[2] * cam.up[2];
        const dotRU = cam.right[0] * cam.up[0] + cam.right[1] * cam.up[1] + cam.right[2] * cam.up[2];
        expect(Math.abs(dotFR)).toBeLessThan(1e-5);
        expect(Math.abs(dotFU)).toBeLessThan(1e-5);
        expect(Math.abs(dotRU)).toBeLessThan(1e-5);
      }
    }
  });

  it("culls interior faces and serializes compact base64 mesh buffers", () => {
    const asset = PixcelAssetSchema.parse({
      id: "cube-test",
      materials: { solid: { color: "#38bdf8", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [1, 1, 1], material: "solid" }],
    });
    const grid = new VoxelGrid();
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          grid.set(x, y, z, { material: "solid" });
        }
      }
    }
    const mesh = buildVoxelMesh(grid, asset);
    // 2x2x2 cube has 6 sides * 4 exposed voxel faces = 24 faces (not 8*6=48)
    expect(mesh.faceCount).toBe(24);
    expect(mesh.triangleCount).toBe(48);
    expect(mesh.bounds.minX).toBe(0);
    expect(mesh.bounds.maxX).toBe(2);

    const ser = serializeVoxelMesh(mesh);
    expect(ser.faceCount).toBe(24);
    expect(Buffer.from(ser.positionsB64, "base64").byteLength).toBe(mesh.positions.byteLength);
  });

  it("renders smooth 360° turntable frames of a rigged character with identical canvas bounds and distinct views", async () => {
    const charAsset = buildCharacterAsset({
      id: "turntable-char",
      hairStyle: "parted",
      outfitStyle: "hoodie",
      glasses: true,
      emissiveAccent: true,
    });
    const palette = await loadPalette("office-night");
    const clips = compileAssetAnimations(charAsset);
    const grid = clips.get("idle")![0].grid;

    const seq = renderTurntableSequence(charAsset, grid, palette, {
      frames: 16,
      pitchDeg: 30,
      outlineMode: "silhouette",
    });

    expect(seq).toHaveLength(16);
    const w = seq[0].image.width;
    const h = seq[0].image.height;
    expect(w).toBeGreaterThan(20);
    expect(h).toBeGreaterThan(30);

    // Every frame shares identical dimensions and has visible opaque pixels
    for (const f of seq) {
      expect(f.image.width).toBe(w);
      expect(f.image.height).toBe(h);
      let opaque = 0;
      for (let i = 3; i < f.image.data.length; i += 4) {
        if (f.image.data[i] > 0) opaque++;
      }
      expect(opaque).toBeGreaterThan(100);
    }

    // Opposite angles (0 vs 8) must be visually distinct (front vs back of character)
    expect(Buffer.from(seq[0].image.data)).not.toEqual(Buffer.from(seq[8].image.data));

    // Encodes cleanly into an animated 360° GIF
    const gif = encodeAnimatedGIF(
      seq.map((f) => ({ image: f.image, durationMs: 60 })),
    );
    expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");
  });

  it("supports arbitrary single-angle orthographic views (Front, Side, Top-Down) and world vs camera light lock", async () => {
    const charAsset = buildCharacterAsset({
      id: "angle-char",
      hairStyle: "spiky",
      outfitStyle: "blazer",
    });
    const palette = await loadPalette("office-night");
    const grid = compileAssetAnimations(charAsset).get("idle")![0].grid;

    const front = renderAssetAtAngle(charAsset, grid, palette, { yawDeg: 0, pitchDeg: 0 });
    const top = renderAssetAtAngle(charAsset, grid, palette, { yawDeg: 0, pitchDeg: 90 });
    const worldLit = renderAssetAtAngle(charAsset, grid, palette, { yawDeg: 180, pitchDeg: 30, lightLock: "world" });
    const camLit = renderAssetAtAngle(charAsset, grid, palette, { yawDeg: 180, pitchDeg: 30, lightLock: "camera" });

    expect(front.image.height).toBeGreaterThan(top.image.height);
    expect(Buffer.from(worldLit.image.data)).not.toEqual(Buffer.from(camLit.image.data));
  });
});
