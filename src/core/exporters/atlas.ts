import { getTileMetrics } from "../rasterizer.js";
import type { AssetLayer, AtlasFrame, AtlasMetadata, Direction, TilePreset } from "../schema.js";
import { createRGBAImage, type RGBAImage } from "./png.js";

export interface AtlasInputSprite {
  key: string;
  assetId: string;
  direction: Direction;
  animation?: string;
  frameName: string;
  durationMs: number;
  layer: AssetLayer;
  footprintTiles: [number, number];
  anchor: { x: number; y: number };
  image: RGBAImage;
  emissive?: RGBAImage;
}

function blitImage(src: RGBAImage, dst: RGBAImage, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const srcRow = y * src.width * 4;
    const dstRow = ((dy + y) * dst.width + dx) * 4;
    dst.data.set(src.data.subarray(srcRow, srcRow + src.width * 4), dstRow);
  }
}

export function packSpriteAtlas(
  sprites: AtlasInputSprite[],
  opts: {
    imageName: string;
    emissiveImageName?: string;
    tilePreset: TilePreset;
    padding?: number;
  },
): { sheet: RGBAImage; emissiveSheet?: RGBAImage; atlas: AtlasMetadata } {
  if (sprites.length === 0) {
    throw new Error("Cannot pack an empty sprite list into an atlas");
  }

  const padding = opts.padding ?? 2;
  const sorted = [...sprites].sort((a, b) => {
    if (b.image.height !== a.image.height) return b.image.height - a.image.height;
    return a.key.localeCompare(b.key);
  });

  // Choose target shelf width near sqrt(totalArea) * 1.25 for compact power-friendly sheets
  let totalArea = 0;
  let maxSpriteW = 0;
  for (const s of sorted) {
    totalArea += (s.image.width + padding) * (s.image.height + padding);
    if (s.image.width > maxSpriteW) maxSpriteW = s.image.width;
  }
  const targetWidth = Math.max(maxSpriteW + padding * 2, Math.ceil(Math.sqrt(totalArea) * 1.25));

  interface Placed {
    sprite: AtlasInputSprite;
    x: number;
    y: number;
  }
  const placed: Placed[] = [];
  let curX = padding;
  let curY = padding;
  let shelfH = 0;
  let sheetW = 0;

  for (const s of sorted) {
    const sw = s.image.width;
    const sh = s.image.height;
    if (curX > padding && curX + sw + padding > targetWidth) {
      curX = padding;
      curY += shelfH + padding;
      shelfH = 0;
    }
    placed.push({ sprite: s, x: curX, y: curY });
    curX += sw + padding;
    if (curX > sheetW) sheetW = curX;
    if (sh > shelfH) shelfH = sh;
  }

  const sheetH = Math.max(1, curY + shelfH + padding);
  sheetW = Math.max(1, sheetW);

  const hasAnyEmissive = placed.some((p) => p.sprite.emissive !== undefined);
  const sheet = createRGBAImage(sheetW, sheetH);
  const emissiveSheet = hasAnyEmissive ? createRGBAImage(sheetW, sheetH) : undefined;
  const frames: Record<string, AtlasFrame> = {};

  for (const { sprite, x, y } of placed) {
    const w = sprite.image.width;
    const h = sprite.image.height;
    blitImage(sprite.image, sheet, x, y);
    if (emissiveSheet && sprite.emissive) {
      if (sprite.emissive.width !== w || sprite.emissive.height !== h) {
        throw new Error(`Emissive layer dimensions mismatch for sprite "${sprite.key}"`);
      }
      blitImage(sprite.emissive, emissiveSheet, x, y);
    }

    frames[sprite.key] = {
      frame: { x, y, w, h },
      sourceSize: { w, h },
      spriteSourceSize: { x: 0, y: 0, w, h },
      pivot: {
        x: Number((sprite.anchor.x / w).toFixed(4)),
        y: Number((sprite.anchor.y / h).toFixed(4)),
      },
      isometric: {
        assetId: sprite.assetId,
        direction: sprite.direction,
        ...(sprite.animation ? { animation: sprite.animation } : {}),
        frameName: sprite.frameName,
        durationMs: sprite.durationMs,
        layer: sprite.layer,
        footprintTiles: sprite.footprintTiles,
        anchor: sprite.anchor,
      },
    };
  }

  const metrics = getTileMetrics(opts.tilePreset);
  const emissiveImageName = hasAnyEmissive
    ? (opts.emissiveImageName ?? opts.imageName.replace(/\.png$/i, "_emissive.png"))
    : undefined;

  const atlas: AtlasMetadata = {
    frames,
    meta: {
      app: "iherk-pixcel",
      version: "1",
      image: opts.imageName,
      ...(emissiveImageName ? { emissiveImage: emissiveImageName } : {}),
      format: "RGBA8888",
      size: { w: sheetW, h: sheetH },
      scale: "1",
      tilePreset: opts.tilePreset,
      stepX: metrics.stepX,
      stepY: metrics.stepY,
      tileOverlapY: metrics.tileOverlapY,
    },
  };

  return { sheet, emissiveSheet, atlas };
}
