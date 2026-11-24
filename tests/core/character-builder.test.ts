import { describe, it, expect } from "vitest";
import { CharacterSpecSchema, buildCharacterAsset } from "../../src/core/character-builder.js";
import { compileAssetAnimations } from "../../src/core/dsl-compiler.js";
import { loadPalette } from "../../src/core/palette.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import type { Direction } from "../../src/core/schema.js";

describe("parametric character builder", () => {
  it("builds a complete 4-clip rigged chibi character asset across all hair styles and outfits", async () => {
    const palette = await loadPalette("office-night");
    const styles = [
      { id: "c-dev", hairStyle: "short", outfitStyle: "hoodie", glasses: true, emissiveAccent: true },
      { id: "c-sec", hairStyle: "ponytail", outfitStyle: "hoodie", headset: true },
      { id: "c-pm", hairStyle: "parted", outfitStyle: "blazer" },
      { id: "c-op", hairStyle: "hood_up", outfitStyle: "hoodie", headset: true, emissiveAccent: true },
      { id: "c-auto", hairStyle: "spiky", outfitStyle: "tshirt", glasses: true },
      { id: "c-bob", hairStyle: "bob", outfitStyle: "sweater" },
    ] as const;

    for (const s of styles) {
      const spec = CharacterSpecSchema.parse({
        id: s.id,
        hairStyle: s.hairStyle,
        outfitStyle: s.outfitStyle,
        glasses: "glasses" in s ? s.glasses : false,
        headset: "headset" in s ? s.headset : false,
        emissiveAccent: "emissiveAccent" in s ? s.emissiveAccent : false,
      });
      const asset = buildCharacterAsset(spec);
      expect(asset.id).toBe(s.id);
      expect(asset.category).toBe("character");
      expect(asset.parts).toBeDefined();

      const clips = compileAssetAnimations(asset);
      expect([...clips.keys()].sort()).toEqual(["idle", "inspect", "sit_type", "walk"]);
      expect(clips.get("idle")!.length).toBe(2);
      expect(clips.get("walk")!.length).toBe(4);
      expect(clips.get("sit_type")!.length).toBe(2);
      expect(clips.get("inspect")!.length).toBe(2);

      // Verify all 4 isometric directions render cleanly
      for (const dir of ["se", "sw", "nw", "ne"] as Direction[]) {
        const rendered = renderAssetFrame(asset, clips.get("sit_type")![0].grid, palette, { direction: dir });
        expect(rendered.main.width).toBeGreaterThan(20);
        expect(rendered.main.height).toBeGreaterThan(25);
      }
    }
  });

  it("produces distinct voxel silhouettes between standing idle, walking stride, and seated typing poses", () => {
    const asset = buildCharacterAsset(CharacterSpecSchema.parse({ id: "c-poses", glasses: true }));
    const clips = compileAssetAnimations(asset);
    const idle0 = clips.get("idle")![0].grid;
    const walk0 = clips.get("walk")![0].grid;
    const sit0 = clips.get("sit_type")![0].grid;
    const sit1 = clips.get("sit_type")![1].grid;

    // Seated pose lowers maxZ vs standing idle and extends legs forward (+Y)
    const idleBounds = idle0.getBounds()!;
    const sitBounds = sit0.getBounds()!;
    expect(sitBounds.maxY).toBeGreaterThan(idleBounds.maxY);

    // Walk frame 0 differs from idle frame 0; sit_type frames animate hands
    const serialize = (g: typeof idle0) =>
      [...g.entries()]
        .map(([x, y, z, c]) => `${x},${y},${z}:${c.material}`)
        .sort()
        .join("|");
    expect(serialize(walk0)).not.toBe(serialize(idle0));
    expect(serialize(sit0)).not.toBe(serialize(sit1));
  });
});
