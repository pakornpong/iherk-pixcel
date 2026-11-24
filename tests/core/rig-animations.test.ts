import { describe, it, expect } from "vitest";
import { PixcelAssetSchema, RoomLayoutSchema } from "../../src/core/schema.js";
import { compileAsset, compileAssetAnimations } from "../../src/core/dsl-compiler.js";

describe("hierarchical part rig and multi-clip animations", () => {
  it("propagates parent->child transforms, rotates around pivot, and supports part hide + frame ops", () => {
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "rig-test",
      footprintTiles: [1, 1],
      voxelsPerTile: 32,
      materials: {
        body: { color: "#252e45", kind: "matte" },
        head: { color: "#e5c1a1", kind: "matte" },
        leg: { color: "#1f2430", kind: "matte" },
      },
      parts: {
        torso: { pivot: [10, 10, 10] },
        head: { pivot: [10, 10, 15], parent: "torso" },
        leg_l: { pivot: [10, 10, 5] },
      },
      ops: [
        { op: "voxel", at: [10, 10, 10], material: "body", part: "torso" },
        { op: "voxel", at: [11, 10, 15], material: "head", part: "head" },
        { op: "voxel", at: [10, 10, 2], material: "leg", part: "leg_l" },
      ],
      animations: {
        idle: {
          loop: true,
          frames: [
            { name: "idle_0", durationMs: 400, ops: [] },
            {
              name: "idle_1",
              durationMs: 400,
              ops: [],
              partTransforms: {
                torso: { translate: [0, 0, 2] },
                head: { rotateZSteps: 1 }, // (11,10) around pivot (10,10) CW -> (10,11), plus parent torso dz=+2 -> (10,11,17)
              },
            },
          ],
        },
        sit: {
          loop: true,
          frames: [
            {
              name: "sit_0",
              durationMs: 300,
              partTransforms: { leg_l: { hide: true } },
              ops: [{ op: "voxel", at: [10, 13, 6], material: "leg", part: "leg_l" }],
            },
          ],
        },
      },
    });

    const clips = compileAssetAnimations(asset);
    expect([...clips.keys()]).toEqual(["idle", "sit"]);

    const idle1 = clips.get("idle")![1].grid;
    expect(idle1.has(10, 10, 12)).toBe(true); // torso shifted +2 Z
    expect(idle1.has(10, 11, 17)).toBe(true); // head rotated 90 CW around (10,10) AND inherited torso +2 Z
    expect(idle1.has(11, 10, 15)).toBe(false);

    const sit0 = clips.get("sit")![0].grid;
    expect(sit0.has(10, 10, 2)).toBe(false); // hidden standing leg
    expect(sit0.has(10, 13, 6)).toBe(true); // seated replacement leg

    // Backward-compatible compileAsset falls back to idle clip
    const compat = compileAsset(asset);
    expect(compat.frames).toHaveLength(2);
    expect(compat.frames[0].name).toBe("idle_0");
  });

  it("rejects cyclic part parent chains cleanly", () => {
    const cyclic = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "cyclic-rig",
      materials: { a: { color: "#ffffff", kind: "matte" } },
      parts: {
        p1: { pivot: [5, 5, 5], parent: "p2" },
        p2: { pivot: [5, 5, 5], parent: "p1" },
      },
      ops: [{ op: "voxel", at: [5, 5, 5], material: "a", part: "p1" }],
      animations: {
        idle: { frames: [{ name: "f0", durationMs: 100, ops: [], partTransforms: { p1: { translate: [1, 0, 0] } } }] },
      },
    });
    expect(() => compileAssetAnimations(cyclic)).toThrow(/cycle|parent/i);
  });

  it("validates characters array in RoomLayoutSchema", () => {
    const room = RoomLayoutSchema.parse({
      schemaVersion: 1,
      id: "office-chars",
      widthTiles: 5,
      depthTiles: 5,
      characters: [
        { assetId: "agent-dev", tx: 2, ty: 2, direction: "se", animation: "sit_type", roleLabel: "DEV AGENT" },
      ],
    });
    expect(room.characters[0].animation).toBe("sit_type");
    expect(room.characters[0].roleLabel).toBe("DEV AGENT");
  });

  it("cascades parent hide to child parts and rejects path traversal in frame.name", () => {
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "cascade-hide",
      materials: { a: { color: "#ffffff", kind: "matte" } },
      parts: {
        torso: { pivot: [10, 10, 10] },
        head: { pivot: [10, 10, 15], parent: "torso" },
      },
      ops: [
        { op: "voxel", at: [10, 10, 10], material: "a", part: "torso" },
        { op: "voxel", at: [10, 10, 15], material: "a", part: "head" },
      ],
      animations: {
        gone: { frames: [{ name: "gone_0", durationMs: 100, ops: [], partTransforms: { torso: { hide: true } } }] },
      },
    });
    const clips = compileAssetAnimations(asset);
    expect(clips.get("gone")![0].grid.size).toBe(0);

    expect(() =>
      PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: "evil-frame",
        materials: { a: { color: "#ffffff", kind: "matte" } },
        ops: [],
        frames: [{ name: "../../evil", durationMs: 100, ops: [] }],
      }),
    ).toThrow();
  });
});
