import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { PixcelAssetSchema, RoomLayoutSchema, type Direction } from "../../src/core/schema.js";
import { loadPalette } from "../../src/core/palette.js";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import { renderRoom } from "../../src/core/room-compositor.js";
import { loadAllAssetsMap } from "../../src/core/workspace.js";

const EXPECTED_ASSETS = [
  "floor-wood-plank",
  "wall-slate-plain",
  "wall-night-window",
  "wall-corner-pillar",
  "desk-dev-dual",
  "desk-security-ops",
  "chair-office-swivel",
  "server-rack",
  "whiteboard-arch",
  "table-conference",
  "plant-potted",
  "bookshelf-wood",
];

describe("AI Agent Office starter pack", () => {
  it("validates and renders all 12 starter assets across 4 directions and all frames", async () => {
    const dir = path.resolve("assets/office-starter");
    const palette = await loadPalette("office-night");
    const assetsMap = new Map();

    for (const id of EXPECTED_ASSETS) {
      const raw = JSON.parse(await fs.readFile(path.join(dir, `${id}.pixcel.json`), "utf8"));
      const asset = PixcelAssetSchema.parse(raw);
      expect(asset.id).toBe(id);
      assetsMap.set(id, asset);

      const { frames } = compileAsset(asset);
      expect(frames.length).toBeGreaterThanOrEqual(1);
      for (const direction of ["se", "sw", "nw", "ne"] as Direction[]) {
        const res = renderAssetFrame(asset, frames[0].grid, palette, { direction, emissiveMode: "baked" });
        expect(res.main.width).toBeGreaterThan(0);
        expect(res.main.height).toBeGreaterThan(0);
      }
    }

    const roomRaw = JSON.parse(await fs.readFile(path.join(dir, "sample-office.room.json"), "utf8"));
    const room = RoomLayoutSchema.parse(roomRaw);
    const allAssets = await loadAllAssetsMap(process.cwd());
    const renderedRoom = renderRoom(room, allAssets, palette, { emissiveMode: "baked" });
    expect(renderedRoom.width).toBeGreaterThan(300);
    expect(renderedRoom.height).toBeGreaterThan(200);
  });
});
