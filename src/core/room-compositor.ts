import { compileAsset, type CompiledFrame } from "./dsl-compiler.js";
import { createRGBAImage, type RGBAImage } from "./exporters/png.js";
import { parseHexColor } from "./palette.js";
import { renderAssetFrame, type RenderResult } from "./postprocess.js";
import { getTileMetrics } from "./rasterizer.js";
import type { Direction, EmissiveMode, PaletteDefinition, PixcelAsset, RoomLayout, WallEdge } from "./schema.js";

export interface RoomRenderItem {
  id: string;
  tx: number;
  ty: number;
  footprintX: number;
  footprintY: number;
}

function isoScreenXRange(item: RoomRenderItem): [number, number] {
  // In isometric projection, x - y spans [tx - (ty + footprintY), (tx + footprintX) - ty]
  return [item.tx - (item.ty + item.footprintY), item.tx + item.footprintX - item.ty];
}

function depthSortKey(item: RoomRenderItem): number {
  return item.tx + item.footprintX + item.ty + item.footprintY;
}

export function sortIsometricObjects<T extends RoomRenderItem>(items: T[]): T[] {
  const n = items.length;
  if (n <= 1) return [...items];

  const adj: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const a = items[i];
    const [aMinSX, aMaxSX] = isoScreenXRange(a);
    const ax0 = a.tx;
    const ax1 = a.tx + a.footprintX;
    const ay0 = a.ty;
    const ay1 = a.ty + a.footprintY;

    for (let j = i + 1; j < n; j++) {
      const b = items[j];
      const [bMinSX, bMaxSX] = isoScreenXRange(b);
      // Only enforce ordering between objects whose horizontal screen projections can overlap
      if (aMaxSX <= bMinSX || bMaxSX <= aMinSX) continue;

      const bx0 = b.tx;
      const bx1 = b.tx + b.footprintX;
      const by0 = b.ty;
      const by1 = b.ty + b.footprintY;

      const aBehindB = ax1 <= bx0 || ay1 <= by0;
      const bBehindA = bx1 <= ax0 || by1 <= ay0;

      if (aBehindB && !bBehindA) {
        adj[i].push(j);
        inDeg[j]++;
      } else if (bBehindA && !aBehindB) {
        adj[j].push(i);
        inDeg[i]++;
      }
    }
  }

  const compareIdx = (ia: number, ib: number): number => {
    const a = items[ia];
    const b = items[ib];
    const dk = depthSortKey(a) - depthSortKey(b);
    if (dk !== 0) return dk;
    if (a.tx !== b.tx) return a.tx - b.tx;
    if (a.ty !== b.ty) return a.ty - b.ty;
    return a.id.localeCompare(b.id);
  };

  const emitted = new Uint8Array(n);
  const result: T[] = [];

  while (result.length < n) {
    const ready: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!emitted[i] && inDeg[i] === 0) ready.push(i);
    }

    let pick: number;
    if (ready.length > 0) {
      ready.sort(compareIdx);
      pick = ready[0];
    } else {
      // Deterministic cycle-breaking for overlapping footprints
      const remaining: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!emitted[i]) remaining.push(i);
      }
      remaining.sort(compareIdx);
      pick = remaining[0];
    }

    emitted[pick] = 1;
    result.push(items[pick]);
    for (const next of adj[pick]) {
      inDeg[next]--;
    }
  }

  return result;
}

function edgeToDirection(edge: WallEdge): Direction {
  if (edge === "ne") return "sw";
  return "se";
}

function alphaComposite(src: RGBAImage, dst: RGBAImage, dx: number, dy: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    const ty = dy + sy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const tx = dx + sx;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4;
      const sa = src.data[si + 3];
      if (sa === 0) continue;

      const di = (ty * dst.width + tx) * 4;
      if (sa === 255) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
      } else {
        const a = sa / 255;
        const invA = 1 - a;
        const da = dst.data[di + 3] / 255;
        const outA = a + da * invA;
        if (outA > 0) {
          dst.data[di] = Math.round((src.data[si] * a + dst.data[di] * da * invA) / outA);
          dst.data[di + 1] = Math.round((src.data[si + 1] * a + dst.data[di + 1] * da * invA) / outA);
          dst.data[di + 2] = Math.round((src.data[si + 2] * a + dst.data[di + 2] * da * invA) / outA);
          dst.data[di + 3] = Math.round(outA * 255);
        }
      }
    }
  }
}

export function renderRoom(
  room: RoomLayout,
  assetsById: Map<string, PixcelAsset>,
  palette: PaletteDefinition,
  opts?: { frameIndex?: number; background?: string; emissiveMode?: EmissiveMode },
): { main: RGBAImage; emissive?: RGBAImage; width: number; height: number; originX: number; originY: number } {
  const frameIndex = opts?.frameIndex ?? 0;
  const emissiveMode: EmissiveMode = opts?.emissiveMode ?? "baked";
  const metrics = getTileMetrics(room.tilePreset);

  const compiledCache = new Map<string, CompiledFrame[]>();
  const renderCache = new Map<string, RenderResult>();

  const getSprite = (assetId: string, direction: Direction): RenderResult => {
    const key = `${assetId}::${direction}::${frameIndex}`;
    const cached = renderCache.get(key);
    if (cached) return cached;

    const asset = assetsById.get(assetId);
    if (!asset) {
      throw new Error(`Room "${room.id}" references unknown asset "${assetId}"`);
    }
    let frames = compiledCache.get(assetId);
    if (!frames) {
      frames = compileAsset(asset).frames;
      compiledCache.set(assetId, frames);
    }
    const frame = frames[frameIndex % frames.length];
    const rendered = renderAssetFrame(asset, frame.grid, palette, {
      direction,
      emissiveMode,
    });
    renderCache.set(key, rendered);
    return rendered;
  };

  interface DrawCall {
    sprite: RenderResult;
    worldX: number;
    worldY: number;
  }

  const drawCalls: DrawCall[] = [];

  const toWorldAnchor = (tx: number, ty: number, fx: number, fy: number): [number, number] => {
    const ax = tx + fx - 1;
    const ay = ty + fy - 1;
    return [(ax - ay) * metrics.stepX, (ax + ay) * metrics.stepY];
  };

  // 1. Floors sorted by (tx + ty)
  const floors = [...room.floors].sort((a, b) => a.tx + a.ty - (b.tx + b.ty) || a.tx - b.tx);
  for (const f of floors) {
    const sprite = getSprite(f.assetId, f.direction);
    const [wx, wy] = toWorldAnchor(f.tx, f.ty, sprite.footprintTiles[0], sprite.footprintTiles[1]);
    drawCalls.push({ sprite, worldX: wx, worldY: wy });
  }

  // 2. Walls + wall-decor (walls first, decor immediately after at same depth band)
  const wallEvents: Array<{
    tx: number;
    ty: number;
    isDecor: boolean;
    sprite: RenderResult;
    worldX: number;
    worldY: number;
  }> = [];

  for (const w of room.walls) {
    const dir = edgeToDirection(w.edge);
    const sprite = getSprite(w.assetId, dir);
    const [wx, wy] = toWorldAnchor(w.tx, w.ty, sprite.footprintTiles[0], sprite.footprintTiles[1]);
    wallEvents.push({ tx: w.tx, ty: w.ty, isDecor: false, sprite, worldX: wx, worldY: wy });
  }
  for (const d of room.wallDecor) {
    const dir = edgeToDirection(d.edge);
    const sprite = getSprite(d.assetId, dir);
    const [wx, wy] = toWorldAnchor(d.tx, d.ty, sprite.footprintTiles[0], sprite.footprintTiles[1]);
    wallEvents.push({ tx: d.tx, ty: d.ty, isDecor: true, sprite, worldX: wx, worldY: wy });
  }
  wallEvents.sort((a, b) => {
    if (a.isDecor !== b.isDecor) return a.isDecor ? 1 : -1;
    const da = a.tx + a.ty;
    const db = b.tx + b.ty;
    if (da !== db) return da - db;
    return a.tx - b.tx;
  });
  for (const we of wallEvents) {
    drawCalls.push({ sprite: we.sprite, worldX: we.worldX, worldY: we.worldY });
  }

  // 3. Objects sorted via Kahn's topological isometric depth-sorter
  const objectItems = room.objects.map((o, idx) => {
    const sprite = getSprite(o.assetId, o.direction);
    return {
      id: `${o.assetId}#${idx}`,
      tx: o.tx,
      ty: o.ty,
      footprintX: sprite.footprintTiles[0],
      footprintY: sprite.footprintTiles[1],
      sprite,
    };
  });
  for (const item of sortIsometricObjects(objectItems)) {
    const [wx, wy] = toWorldAnchor(item.tx, item.ty, item.footprintX, item.footprintY);
    drawCalls.push({ sprite: item.sprite, worldX: wx, worldY: wy });
  }

  if (drawCalls.length === 0) {
    const blank = createRGBAImage(metrics.tileWidth, metrics.tileHeight);
    return { main: blank, width: blank.width, height: blank.height, originX: Math.floor(blank.width / 2), originY: blank.height - 1 };
  }

  // Compute tight bounding canvas with small margin
  const margin = 12;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const dc of drawCalls) {
    const x0 = dc.worldX - dc.sprite.anchor.x;
    const y0 = dc.worldY - dc.sprite.anchor.y;
    const x1 = x0 + dc.sprite.main.width;
    const y1 = y0 + dc.sprite.main.height;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }

  const width = Math.max(1, maxX - minX + margin * 2);
  const height = Math.max(1, maxY - minY + margin * 2);
  const main = createRGBAImage(width, height);
  const wantSplit = emissiveMode === "split" || emissiveMode === "both";
  const emissive = wantSplit ? createRGBAImage(width, height) : undefined;

  const bgHex = opts?.background ?? room.background ?? "#0a0e1a";
  if (bgHex !== "transparent") {
    const bg = parseHexColor(bgHex);
    for (let i = 0; i < main.data.length; i += 4) {
      main.data[i] = bg[0];
      main.data[i + 1] = bg[1];
      main.data[i + 2] = bg[2];
      main.data[i + 3] = bg[3];
    }
  }

  for (const dc of drawCalls) {
    const dx = dc.worldX - dc.sprite.anchor.x - minX + margin;
    const dy = dc.worldY - dc.sprite.anchor.y - minY + margin;
    alphaComposite(dc.sprite.main, main, dx, dy);
    if (emissive && dc.sprite.emissive) {
      alphaComposite(dc.sprite.emissive, emissive, dx, dy);
    }
  }

  return { main, emissive, width, height, originX: -minX + margin, originY: -minY + margin };
}
