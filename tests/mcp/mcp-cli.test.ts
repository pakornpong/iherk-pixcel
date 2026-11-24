import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

describe("CLI and Stdio MCP server", () => {
  it("runs CLI render and render-room end-to-end producing valid PNGs and TexturePacker atlas", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-cli-"));
    const tsxBin = path.resolve("node_modules/.bin/tsx");
    const cliEntry = path.resolve("src/cli/index.ts");

    await execFileAsync(tsxBin, [cliEntry, "validate", "assets/office-starter/desk-dev-dual.pixcel.json"]);
    await execFileAsync(tsxBin, [
      cliEntry, "render", "assets/office-starter/desk-dev-dual.pixcel.json",
      "--out", tmpDir, "--format", "atlas", "--emissive", "both",
    ]);
    const atlasJson = JSON.parse(await fs.readFile(path.join(tmpDir, "desk-dev-dual.atlas.json"), "utf8"));
    expect(Object.keys(atlasJson.frames).length).toBeGreaterThanOrEqual(4);

    const roomOut = path.join(tmpDir, "office.png");
    await execFileAsync(tsxBin, [cliEntry, "render-room", "assets/office-starter/sample-office.room.json", "--out", roomOut, "--emissive", "both"]);
    const roomStat = await fs.stat(roomOut);
    expect(roomStat.size).toBeGreaterThan(1000);
    const roomEmissiveStat = await fs.stat(path.join(tmpDir, "office_emissive.png"));
    expect(roomEmissiveStat.size).toBeGreaterThan(100);
  }, 30000);

  it("spawns pixcel mcp over stdio, creates & renders an asset with base64 PNG, and rejects path traversal", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-mcp-"));
    const transport = new StdioClientTransport({
      command: path.resolve("node_modules/.bin/tsx"),
      args: [path.resolve("src/cli/index.ts"), "mcp", "--root", tmpDir],
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_palettes",
        "list_assets",
        "create_asset",
        "render_asset",
        "render_room",
        "pack_atlas",
        "carve_from_views",
      ]),
    );

    const created = await client.callTool({
      name: "create_asset",
      arguments: {
        asset: {
          schemaVersion: 1,
          id: "mcp-cube",
          footprintTiles: [1, 1],
          voxelsPerTile: 16,
          materials: { c: { color: "#38bdf8", kind: "emissive" } },
          ops: [{ op: "box", from: [4, 4, 0], to: [11, 11, 7], material: "c" }],
        },
      },
    });
    expect(created.isError).toBeFalsy();

    const rendered = await client.callTool({
      name: "render_asset",
      arguments: { id: "mcp-cube", includePreviewImage: true },
    });
    expect(rendered.isError).toBeFalsy();
    const hasImage = (rendered.content as Array<{ type: string }>).some((c) => c.type === "image");
    expect(hasImage).toBe(true);

    const bad = await client.callTool({ name: "read_asset", arguments: { id: "../../etc/passwd" } });
    expect(bad.isError).toBe(true);

    // Palette confinement across MCP tools
    const badPal = await client.callTool({ name: "get_palette", arguments: { name: "../../package.json" } });
    expect(badPal.isError).toBe(true);
    const badCwdPal = await client.callTool({ name: "get_palette", arguments: { name: "package.json" } });
    expect(badCwdPal.isError).toBe(true);

    // MCP render_room with emissiveMode: "both" must also emit *_emissive.png
    const roomRes = await client.callTool({
      name: "render_room",
      arguments: { outPath: "out/mcp-room.png", emissiveMode: "both", includePreviewImage: false },
    });
    expect(roomRes.isError).toBeFalsy();
    const mcpEmissiveStat = await fs.stat(path.join(tmpDir, "out/mcp-room_emissive.png"));
    expect(mcpEmissiveStat.size).toBeGreaterThan(100);

    await client.close();
  }, 30000);
});
