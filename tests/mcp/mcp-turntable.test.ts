import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const TSX_BIN = path.resolve("node_modules/.bin/tsx");
const CLI_ENTRY = path.resolve("src/cli/index.ts");

describe("Phase 3: CLI turntable & MCP render_turntable", () => {
  it("runs CLI turntable for 16-dir atlas and 360° GIF export", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-cli-tt-"));
    const outDir = path.join(tmpDir, "out");

    await execFileAsync(TSX_BIN, [
      CLI_ENTRY,
      "turntable",
      "agent-dev",
      "--frames",
      "12",
      "--format",
      "gif",
      "--out",
      outDir,
    ]);
    const gifBytes = await fs.readFile(path.join(outDir, "agent-dev_360.gif"));
    expect(gifBytes.subarray(0, 6).toString("ascii")).toBe("GIF89a");

    await execFileAsync(TSX_BIN, [
      CLI_ENTRY,
      "turntable",
      "agent-dev",
      "--frames",
      "8",
      "--format",
      "atlas",
      "--out",
      outDir,
    ]);
    const atlasJson = JSON.parse(await fs.readFile(path.join(outDir, "agent-dev_turntable_8.atlas.json"), "utf8"));
    expect(Object.keys(atlasJson.frames)).toHaveLength(8);
  });

  it("exposes render_turntable over Stdio MCP and returns preview PNG + GIF output", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-mcp-tt-"));
    const transport = new StdioClientTransport({
      command: TSX_BIN,
      args: [CLI_ENTRY, "mcp", "--root", tmpDir],
    });
    const client = new Client({ name: "test-tt-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const res = await client.callTool({
        name: "render_turntable",
        arguments: {
          id: "agent-dev",
          frames: 8,
          pitchDeg: 30,
          format: "gif",
          outDir: "out/tt",
        },
      });
      expect(res.isError).not.toBe(true);
      const content = res.content as Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
      const imgItem = content.find((c) => c.type === "image");
      expect(imgItem?.mimeType).toBe("image/png");
      expect(Buffer.from(imgItem!.data!, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
      const gifBuf = await fs.readFile(path.join(tmpDir, "out/tt/agent-dev_360.gif"));
      expect(gifBuf.subarray(0, 6).toString("ascii")).toBe("GIF89a");
    } finally {
      await client.close();
    }
  });
});
