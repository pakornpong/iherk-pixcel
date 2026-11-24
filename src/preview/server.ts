import fsSync, { type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { compileAsset } from "../core/dsl-compiler.js";
import { encodePNG } from "../core/exporters/png.js";
import { renderAssetFrame } from "../core/postprocess.js";
import { renderRoom } from "../core/room-compositor.js";
import {
  DirectionSchema,
  EmissiveModeSchema,
  OutlineModeSchema,
  RoomLayoutSchema,
  SafeIdSchema,
  type Direction,
  type EmissiveMode,
  type OutlineMode,
} from "../core/schema.js";
import {
  BUILTIN_ASSETS_DIR,
  listAssetFiles,
  loadAllAssetsMap,
  loadAssetByIdOrPath,
  loadWorkspaceSafePalette,
  PACKAGE_ROOT,
  resolveSafeWorkspacePath,
} from "../core/workspace.js";
import { ZodError } from "zod";

const PUBLIC_DIR = path.join(PACKAGE_ROOT, "src", "preview", "public");

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("Request body exceeds maximum size");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startPreviewServer(opts: {
  rootDir: string;
  port?: number;
  host?: string;
}): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const absRoot = path.resolve(opts.rootDir);
  const host = opts.host ?? "127.0.0.1";
  const requestedPort = opts.port ?? 4173;

  const sseClients = new Set<ServerResponse>();
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const notifyReload = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const client of sseClients) {
        client.write(`event: reload\ndata: ${Date.now()}\n\n`);
      }
    }, 120);
  };

  for (const watchDir of [path.join(absRoot, "assets"), BUILTIN_ASSETS_DIR]) {
    try {
      if (fsSync.existsSync(watchDir)) {
        const w = fsSync.watch(watchDir, { recursive: false }, (_evt, filename) => {
          if (filename && filename.endsWith(".json")) notifyReload();
        });
        watchers.push(w);
      }
    } catch {
      // fs.watch is optional
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", `http://${host}`);
      const pathname = reqUrl.pathname;

      // Static files
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html" || pathname === "/app.js" || pathname === "/style.css")) {
        const file = pathname === "/" ? "index.html" : pathname.slice(1);
        const contentTypes: Record<string, string> = {
          "index.html": "text/html; charset=utf-8",
          "app.js": "application/javascript; charset=utf-8",
          "style.css": "text/css; charset=utf-8",
        };
        const data = await fs.readFile(path.join(PUBLIC_DIR, file));
        res.writeHead(200, { "content-type": contentTypes[file] });
        res.end(data);
        return;
      }

      // SSE live reload
      if (req.method === "GET" && pathname === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      // GET /api/assets
      if (req.method === "GET" && pathname === "/api/assets") {
        const files = await listAssetFiles(absRoot);
        const assets = [];
        for (const f of files) {
          try {
            const { asset } = await loadAssetByIdOrPath(absRoot, f.id);
            assets.push({
              id: asset.id,
              category: asset.category,
              layer: asset.layer,
              outlineMode: asset.outlineMode,
              tilePreset: asset.tilePreset,
              footprintTiles: asset.footprintTiles,
              frameCount: Math.max(1, asset.frames?.length ?? 1),
            });
          } catch {
            // Skip invalid
          }
        }
        sendJson(res, 200, { assets });
        return;
      }

      // GET /api/render/:id
      if (req.method === "GET" && pathname.startsWith("/api/render/")) {
        const rawId = decodeURIComponent(pathname.slice("/api/render/".length));
        const idCheck = SafeIdSchema.safeParse(rawId);
        if (!idCheck.success) {
          sendJson(res, 400, { error: `Invalid asset ID: "${rawId}"` });
          return;
        }
        const dirParam = reqUrl.searchParams.get("dir") ?? "se";
        const dirCheck = DirectionSchema.safeParse(dirParam);
        if (!dirCheck.success) {
          sendJson(res, 400, { error: `Invalid direction "${dirParam}"` });
          return;
        }
        const frameIdx = Math.max(0, Number.parseInt(reqUrl.searchParams.get("frame") ?? "0", 10) || 0);
        const outlineParam = reqUrl.searchParams.get("outline");
        const outlineMode: OutlineMode | undefined = outlineParam ? OutlineModeSchema.parse(outlineParam) : undefined;
        const emissiveParam = reqUrl.searchParams.get("emissive") ?? "baked";
        const emissiveMode: EmissiveMode = EmissiveModeSchema.parse(emissiveParam);
        const layerParam = reqUrl.searchParams.get("layer") ?? "main";

        const { asset } = await loadAssetByIdOrPath(absRoot, idCheck.data);
        const pal = await loadWorkspaceSafePalette(absRoot, asset.palette);
        const { frames } = compileAsset(asset);
        const frame = frames[frameIdx % frames.length];
        const rendered = renderAssetFrame(asset, frame.grid, pal, {
          direction: dirCheck.data as Direction,
          outlineMode,
          emissiveMode: layerParam === "emissive" ? "both" : emissiveMode,
        });

        const img = layerParam === "emissive" && rendered.emissive ? rendered.emissive : rendered.main;
        const png = encodePNG(img);
        res.writeHead(200, {
          "content-type": "image/png",
          "content-length": png.length,
          "cache-control": "no-store",
          "x-pixcel-anchor-x": String(rendered.anchor.x),
          "x-pixcel-anchor-y": String(rendered.anchor.y),
          "x-pixcel-footprint": `${rendered.footprintTiles[0]},${rendered.footprintTiles[1]}`,
          "x-pixcel-step-x": String(rendered.tileMetrics.stepX),
          "x-pixcel-step-y": String(rendered.tileMetrics.stepY),
        });
        res.end(png);
        return;
      }

      // GET /api/room
      if (req.method === "GET" && pathname === "/api/room") {
        const fileParam = reqUrl.searchParams.get("file");
        const roomPath = fileParam
          ? resolveSafeWorkspacePath(absRoot, fileParam)
          : path.join(BUILTIN_ASSETS_DIR, "sample-office.room.json");
        const room = RoomLayoutSchema.parse(JSON.parse(await fs.readFile(roomPath, "utf8")));
        sendJson(res, 200, { file: fileParam ?? "sample-office.room.json", room });
        return;
      }

      // POST /api/room
      if (req.method === "POST" && pathname === "/api/room") {
        const body = JSON.parse(await readBody(req)) as { file?: string; room?: unknown };
        const room = RoomLayoutSchema.parse(body.room);
        const relFile = body.file ?? `${room.id}.room.json`;
        const target = resolveSafeWorkspacePath(absRoot, relFile);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(room, null, 2)}\n`, "utf8");
        sendJson(res, 200, { saved: target, room });
        return;
      }

      // POST /api/room/render
      if (req.method === "POST" && pathname === "/api/room/render") {
        const body = JSON.parse(await readBody(req)) as { room?: unknown; frameIndex?: number; emissiveMode?: string };
        const room = RoomLayoutSchema.parse(body.room);
        const pal = await loadWorkspaceSafePalette(absRoot, room.palette);
        const assetsMap = await loadAllAssetsMap(absRoot);
        const rendered = renderRoom(room, assetsMap, pal, {
          frameIndex: body.frameIndex ?? 0,
          emissiveMode: EmissiveModeSchema.parse(body.emissiveMode ?? "baked"),
        });
        const png = encodePNG(rendered.main);
        res.writeHead(200, {
          "content-type": "image/png",
          "content-length": png.length,
          "cache-control": "no-store",
          "x-pixcel-origin-x": String(rendered.originX),
          "x-pixcel-origin-y": String(rendered.originY),
        });
        res.end(png);
        return;
      }

      sendJson(res, 404, { error: `Not found: ${pathname}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isClientError =
        err instanceof URIError ||
        err instanceof SyntaxError ||
        err instanceof ZodError ||
        msg.includes("Path traversal") ||
        msg.includes("escapes workspace") ||
        msg.includes("Invalid");
      const status = isClientError ? 400 : 500;
      sendJson(res, status, { error: msg });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const url = `http://${host}:${port}`;

  return {
    url,
    port,
    close: async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) w.close();
      for (const client of sseClients) client.end();
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
