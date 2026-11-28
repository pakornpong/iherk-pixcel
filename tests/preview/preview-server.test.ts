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
    expect(htmlText).toContain('id="chk-tt-snap"');
    expect(htmlText).toContain('id="tt-snap-select"');

    const listRes = await fetch(`${srv.url}/api/assets`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { assets: Array<{ id: string; animations?: string[] }> };
    expect(listData.assets.some((a) => a.id === "desk-dev-dual")).toBe(true);
    const devAgent = listData.assets.find((a) => a.id === "agent-dev");
    expect(devAgent?.animations).toEqual(expect.arrayContaining(["idle", "walk", "sit_type", "inspect"]));

    const charPngRes = await fetch(`${srv.url}/api/render/agent-dev?dir=se&anim=sit_type&frame=1`);
    expect(charPngRes.status).toBe(200);
    expect(charPngRes.headers.get("content-type")).toBe("image/png");

    const badAnimRes = await fetch(`${srv.url}/api/render/agent-dev?dir=se&anim=..%2Fevil`);
    expect(badAnimRes.status).toBe(400);

    const unknownAnimRes = await fetch(`${srv.url}/api/render/agent-dev?dir=se&anim=does_not_exist`);
    expect(unknownAnimRes.status).toBe(400);

    const badFrameRes = await fetch(`${srv.url}/api/room/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        frameIndex: -1,
        room: {
          schemaVersion: 1, id: "neg-frame", tilePreset: "64x32",
          widthTiles: 2, depthTiles: 2, floors: [], walls: [], wallDecor: [], objects: [],
          characters: [{ assetId: "agent-dev", tx: 0, ty: 0, direction: "se", animation: "idle" }],
        },
      }),
    });
    expect(badFrameRes.status).toBe(400);

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

  it("serves 360° turntable module, /api/mesh/:id, and /api/turntable/:id GIF export with strict validation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-turntable-"));
    const srv = await startPreviewServer({ rootDir: tmpDir, port: 0 });
    closeFn = srv.close;

    const jsRes = await fetch(`${srv.url}/turntable.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toContain("javascript");
    const jsText = await jsRes.text();
    expect(jsText).toContain("VoxelTurntableViewport");

    const meshRes = await fetch(`${srv.url}/api/mesh/agent-dev?anim=walk&frame=1`);
    expect(meshRes.status).toBe(200);
    const meshData = (await meshRes.json()) as {
      id: string;
      anim: string;
      frameCount: number;
      mesh: { faceCount: number; triangleCount: number; positionsB64: string };
    };
    expect(meshData.id).toBe("agent-dev");
    expect(meshData.anim).toBe("walk");
    expect(meshData.frameCount).toBeGreaterThanOrEqual(4);
    expect(meshData.mesh.faceCount).toBeGreaterThan(50);
    expect(meshData.mesh.triangleCount).toBe(meshData.mesh.faceCount * 2);

    const badMesh = await fetch(`${srv.url}/api/mesh/..%2Fsecret`);
    expect(badMesh.status).toBe(400);

    const gifRes = await fetch(`${srv.url}/api/turntable/agent-dev?frames=8&pitch=30&fps=12`);
    expect(gifRes.status).toBe(200);
    expect(gifRes.headers.get("content-type")).toBe("image/gif");
    const gifBuf = Buffer.from(await gifRes.arrayBuffer());
    expect(gifBuf.subarray(0, 6).toString("ascii")).toBe("GIF89a");

    const badGif = await fetch(`${srv.url}/api/turntable/agent-dev?frames=999`);
    expect(badGif.status).toBe(400);
  });
});
