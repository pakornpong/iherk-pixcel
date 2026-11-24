import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPreviewServer } from "../../src/preview/server.js";

describe("local web preview server", () => {
  let closeFn: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeFn) {
      await closeFn();
      closeFn = undefined;
    }
  });

  it("serves HTML UI, lists starter assets, renders sprite PNG with anchor headers, and saves/loads rooms", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-preview-"));
    const srv = await startPreviewServer({ rootDir: tmpDir, port: 0 });
    closeFn = srv.close;

    const htmlRes = await fetch(srv.url);
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain("iherk-pixcel");
    expect(htmlText).toContain("outline-select");
    expect(htmlText).toContain("frame-range");
    expect(htmlText).toContain("anim-select");
    expect(htmlText).toContain("btn-sandbox-load");

    const listRes = await fetch(`${srv.url}/api/assets`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { assets: Array<{ id: string; animations?: string[] }> };
    expect(listData.assets.some((a) => a.id === "desk-dev-dual")).toBe(true);
    const devAgent = listData.assets.find((a) => a.id === "agent-dev");
    expect(devAgent?.animations).toEqual(expect.arrayContaining(["idle", "walk", "sit_type", "inspect"]));

    const charPngRes = await fetch(`${srv.url}/api/render/agent-dev?dir=se&anim=sit_type&frame=1`);
    expect(charPngRes.status).toBe(200);
    expect(charPngRes.headers.get("content-type")).toBe("image/png");

    const pngRes = await fetch(`${srv.url}/api/render/desk-dev-dual?dir=sw&frame=0`);
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get("content-type")).toBe("image/png");
    expect(pngRes.headers.get("x-pixcel-footprint")).toBe("1,2");
    const pngBuf = Buffer.from(await pngRes.arrayBuffer());
    expect(pngBuf.subarray(1, 4).toString("ascii")).toBe("PNG");

    const badRes = await fetch(`${srv.url}/api/render/..%2F..%2Fsecret`);
    expect(badRes.status).toBe(400);

    const badUri = await fetch(`${srv.url}/api/render/%E0%A4%A`);
    expect(badUri.status).toBe(400);

    const badJson = await fetch(`${srv.url}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(badJson.status).toBe(400);

    const badRoomPal = await fetch(`${srv.url}/api/room/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        room: {
          schemaVersion: 1, id: "evil", tilePreset: "64x32", palette: "../../package.json",
          widthTiles: 2, depthTiles: 2, floors: [], walls: [], wallDecor: [], objects: [],
        },
      }),
    });
    expect(badRoomPal.status).toBe(400);

    const saveRes = await fetch(`${srv.url}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: "custom.room.json",
        room: {
          schemaVersion: 1,
          id: "custom",
          tilePreset: "64x32",
          widthTiles: 4,
          depthTiles: 4,
          floors: [{ assetId: "floor-wood-plank", tx: 0, ty: 0 }],
          walls: [],
          wallDecor: [],
          objects: [],
        },
      }),
    });
    expect(saveRes.status).toBe(200);
    expect(await fs.stat(path.join(tmpDir, "custom.room.json"))).toBeDefined();
  });
});
