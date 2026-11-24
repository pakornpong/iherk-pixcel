import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

describe("Phase 2 CLI & MCP character workflow", () => {
  it("runs CLI create-character and renders all clips into TexturePacker atlas + GIF", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-char-cli-"));
    const tsxBin = path.resolve("node_modules/.bin/tsx");
    const cliEntry = path.resolve("src/cli/index.ts");
    const charFile = path.join(tmpDir, "custom-agent.pixcel.json");

    await execFileAsync(tsxBin, [
      cliEntry,
      "create-character",
      "--id",
      "custom-agent",
      "--hair",
      "spiky",
      "--outfit",
      "blazer",
      "--glasses",
      "--out",
      charFile,
    ]);
    expect((await fs.stat(charFile)).size).toBeGreaterThan(500);

    const outDir = path.join(tmpDir, "out");
    await execFileAsync(tsxBin, [
      cliEntry,
      "render",
      charFile,
      "--out",
      outDir,
      "--format",
      "atlas",
      "--animation",
      "all",
      "--directions",
      "se,sw",
    ]);
    const atlas = JSON.parse(await fs.readFile(path.join(outDir, "custom-agent.atlas.json"), "utf8"));
    const keys = Object.keys(atlas.frames);
    // 2 dirs * (2 idle + 4 walk + 2 sit_type + 2 inspect) = 20 frames
    expect(keys.length).toBe(20);
    expect(keys.some((k) => k.includes("/walk/"))).toBe(true);
    expect(keys.some((k) => k.includes("/sit_type/"))).toBe(true);
    expect(atlas.frames[keys[0]].isometric.animation).toBeDefined();
  }, 30000);

  it("exposes create_character and animation-aware render_asset over Stdio MCP", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-char-mcp-"));
    const transport = new StdioClientTransport({
      command: path.resolve("node_modules/.bin/tsx"),
      args: [path.resolve("src/cli/index.ts"), "mcp", "--root", tmpDir],
    });
    const client = new Client({ name: "test-char-client", version: "1.0.0" });
    await client.connect(transport);

    const created = await client.callTool({
      name: "create_character",
      arguments: {
        id: "mcp-agent",
        hairStyle: "ponytail",
        outfitStyle: "hoodie",
        glasses: true,
        emissiveAccent: true,
        includePreviewImage: true,
      },
    });
    expect(created.isError).toBeFalsy();
    const content = created.content as Array<{ type: string }>;
    expect(content.some((c) => c.type === "image")).toBe(true);

    const rendered = await client.callTool({
      name: "render_asset",
      arguments: {
        id: "mcp-agent",
        animation: "walk",
        directions: ["se"],
        format: "gif",
        includePreviewImage: true,
      },
    });
    expect(rendered.isError).toBeFalsy();
    expect((await fs.stat(path.join(tmpDir, "out/mcp-agent/mcp-agent.gif"))).size).toBeGreaterThan(200);

    await client.close();
  }, 30000);
});
