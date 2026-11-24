import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { loadAllAssetsMap, listAssetFiles } from "../../src/core/workspace.js";
import { loadPalette } from "../../src/core/palette.js";
import { compileAssetAnimations } from "../../src/core/dsl-compiler.js";
import { renderRoom } from "../../src/core/room-compositor.js";
import { RoomLayoutSchema } from "../../src/core/schema.js";

const STARTER_AGENTS = [
  "agent-dev",
  "agent-security",
  "agent-pm",
  "agent-operator",
  "agent-automation",
];

describe("Phase 2 starter AI Agent characters & populated room", () => {
  it("discovers all 5 starter agents via workspace and compiles all 8 animation clips", async () => {
    const files = await listAssetFiles(process.cwd());
    const ids = files.map((f) => f.id);
    for (const agentId of STARTER_AGENTS) {
      expect(ids).toContain(agentId);
    }

    const assetsMap = await loadAllAssetsMap(process.cwd());
    for (const agentId of STARTER_AGENTS) {
      const asset = assetsMap.get(agentId);
      expect(asset).toBeDefined();
      const clips = compileAssetAnimations(asset!);
      expect([...clips.keys()].sort()).toEqual(["assign", "idle", "inspect", "rest_coffee", "rest_sleep", "sit_type", "talk", "walk"]);
    }
  });

  it("renders sample-office.room.json with seated and standing characters animating across frames", async () => {
    const roomRaw = JSON.parse(await fs.readFile(path.resolve("assets/office-starter/sample-office.room.json"), "utf8"));
    const room = RoomLayoutSchema.parse(roomRaw);
    expect(room.characters.length).toBeGreaterThanOrEqual(5);

    const palette = await loadPalette("office-night");
    const assetsMap = await loadAllAssetsMap(process.cwd());
    const f0 = renderRoom(room, assetsMap, palette, { frameIndex: 0, emissiveMode: "both" });
    const f1 = renderRoom(room, assetsMap, palette, { frameIndex: 1, emissiveMode: "both" });
    expect(f0.width).toBeGreaterThan(300);
    expect(f0.height).toBeGreaterThan(200);
    expect(Buffer.from(f0.main.data)).not.toEqual(Buffer.from(f1.main.data));
  });
});
