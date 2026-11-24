import type { RGBAImage } from "./exporters/png.js";
import { findNearestPaletteColor } from "./palette.js";
import {
  PixcelAssetSchema,
  type MaterialDefinition,
  type PaletteDefinition,
  type PixcelAsset,
  type TilePreset,
  type VoxelDslOp,
} from "./schema.js";
import { VoxelGrid } from "./voxel-grid.js";

export interface OrthographicViews {
  front?: RGBAImage;
  side?: RGBAImage;
  top?: RGBAImage;
  back?: RGBAImage;
  left?: RGBAImage;
  bottom?: RGBAImage;
}

export interface CarveOptions {
  id: string;
  palette: PaletteDefinition;
  depth?: number;
  tilePreset?: TilePreset;
  voxelsPerTile?: 16 | 32;
  alphaThreshold?: number;
}

function getPixel(img: RGBAImage, x: number, y: number): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2], img.data[idx + 3]];
}

function resolveDimensions(views: OrthographicViews, defaultDepth: number): { dimX: number; dimY: number; dimZ: number } {
  let dimX: number | undefined;
  let dimY: number | undefined;
  let dimZ: number | undefined;

  const setOrCheck = (label: string, cur: number | undefined, next: number): number => {
    if (cur !== undefined && cur !== next) {
      throw new Error(`Orthographic view dimension mismatch on ${label}: expected ${cur}, got ${next}`);
    }
    return next;
  };

  if (views.front) {
    dimX = setOrCheck("width (X)", dimX, views.front.width);
    dimZ = setOrCheck("height (Z)", dimZ, views.front.height);
  }
  if (views.back) {
    dimX = setOrCheck("width (X)", dimX, views.back.width);
    dimZ = setOrCheck("height (Z)", dimZ, views.back.height);
  }
  if (views.side) {
    dimY = setOrCheck("depth (Y)", dimY, views.side.width);
    dimZ = setOrCheck("height (Z)", dimZ, views.side.height);
  }
  if (views.left) {
    dimY = setOrCheck("depth (Y)", dimY, views.left.width);
    dimZ = setOrCheck("height (Z)", dimZ, views.left.height);
  }
  if (views.top) {
    dimX = setOrCheck("width (X)", dimX, views.top.width);
    dimY = setOrCheck("depth (Y)", dimY, views.top.height);
  }
  if (views.bottom) {
    dimX = setOrCheck("width (X)", dimX, views.bottom.width);
    dimY = setOrCheck("depth (Y)", dimY, views.bottom.height);
  }

  if (dimX === undefined && dimY === undefined && dimZ === undefined) {
    throw new Error("At least one orthographic PNG view (front, side, top, back, left, or bottom) is required");
  }

  return {
    dimX: dimX ?? defaultDepth,
    dimY: dimY ?? defaultDepth,
    dimZ: dimZ ?? defaultDepth,
  };
}

function greedyBoxMerge(grid: VoxelGrid, dimX: number, dimY: number, dimZ: number): VoxelDslOp[] {
  const visited = new Uint8Array(dimX * dimY * dimZ);
  const idx = (x: number, y: number, z: number) => (z * dimY + y) * dimX + x;
  const ops: VoxelDslOp[] = [];

  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        if (visited[idx(x, y, z)]) continue;
        const cell = grid.get(x, y, z);
        if (!cell) continue;
        const mat = cell.material;

        // Expand X
        let x1 = x;
        while (x1 + 1 < dimX && !visited[idx(x1 + 1, y, z)] && grid.get(x1 + 1, y, z)?.material === mat) {
          x1++;
        }

        // Expand Y
        let y1 = y;
        outerY: while (y1 + 1 < dimY) {
          for (let xi = x; xi <= x1; xi++) {
            if (visited[idx(xi, y1 + 1, z)] || grid.get(xi, y1 + 1, z)?.material !== mat) break outerY;
          }
          y1++;
        }

        // Expand Z
        let z1 = z;
        outerZ: while (z1 + 1 < dimZ) {
          for (let yi = y; yi <= y1; yi++) {
            for (let xi = x; xi <= x1; xi++) {
              if (visited[idx(xi, yi, z1 + 1)] || grid.get(xi, yi, z1 + 1)?.material !== mat) break outerZ;
            }
          }
          z1++;
        }

        for (let zi = z; zi <= z1; zi++) {
          for (let yi = y; yi <= y1; yi++) {
            for (let xi = x; xi <= x1; xi++) {
              visited[idx(xi, yi, zi)] = 1;
            }
          }
        }

        if (x === x1 && y === y1 && z === z1) {
          ops.push({ op: "voxel", at: [x, y, z], material: mat });
        } else {
          ops.push({ op: "box", from: [x, y, z], to: [x1, y1, z1], material: mat });
        }
      }
    }
  }

  return ops;
}

export function carveFromOrthographicViews(views: OrthographicViews, opts: CarveOptions): PixcelAsset {
  const depth = Math.max(1, Math.trunc(opts.depth ?? 4));
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const voxelsPerTile = opts.voxelsPerTile ?? 32;
  const tilePreset = opts.tilePreset ?? "64x32";
  const { dimX, dimY, dimZ } = resolveDimensions(views, depth);

  // Pass 1: Silhouette intersection
  const occupancy = new Uint8Array(dimX * dimY * dimZ);
  const idx = (x: number, y: number, z: number) => (z * dimY + y) * dimX + x;
  let filledCount = 0;

  for (let z = 0; z < dimZ; z++) {
    const imgZ = dimZ - 1 - z;
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        if (views.front && getPixel(views.front, x, imgZ)[3] < alphaThreshold) continue;
        if (views.back && getPixel(views.back, dimX - 1 - x, imgZ)[3] < alphaThreshold) continue;
        if (views.side && getPixel(views.side, y, imgZ)[3] < alphaThreshold) continue;
        if (views.left && getPixel(views.left, dimY - 1 - y, imgZ)[3] < alphaThreshold) continue;
        if (views.top && getPixel(views.top, x, y)[3] < alphaThreshold) continue;
        if (views.bottom && getPixel(views.bottom, x, dimY - 1 - y)[3] < alphaThreshold) continue;
        occupancy[idx(x, y, z)] = 1;
        filledCount++;
      }
    }
  }

  if (filledCount === 0) {
    throw new Error("Orthographic carving produced zero opaque voxels — check that input PNG views overlap and are not empty");
  }

  // Pass 2: Surface color assignment from nearest visible orthographic view, quantized to palette
  const grid = new VoxelGrid();
  const materials: Record<string, MaterialDefinition> = {};
  const isOccupied = (x: number, y: number, z: number) =>
    x >= 0 && x < dimX && y >= 0 && y < dimY && z >= 0 && z < dimZ && occupancy[idx(x, y, z)] === 1;

  for (let z = 0; z < dimZ; z++) {
    const imgZ = dimZ - 1 - z;
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        if (!occupancy[idx(x, y, z)]) continue;

        let sampled: [number, number, number] | null = null;
        if (views.top && !isOccupied(x, y, z + 1)) {
          const p = getPixel(views.top, x, y);
          sampled = [p[0], p[1], p[2]];
        } else if (views.bottom && !isOccupied(x, y, z - 1)) {
          const p = getPixel(views.bottom, x, dimY - 1 - y);
          sampled = [p[0], p[1], p[2]];
        } else if (views.front && !isOccupied(x, y + 1, z)) {
          const p = getPixel(views.front, x, imgZ);
          sampled = [p[0], p[1], p[2]];
        } else if (views.back && !isOccupied(x, y - 1, z)) {
          const p = getPixel(views.back, dimX - 1 - x, imgZ);
          sampled = [p[0], p[1], p[2]];
        } else if (views.side && !isOccupied(x + 1, y, z)) {
          const p = getPixel(views.side, y, imgZ);
          sampled = [p[0], p[1], p[2]];
        } else if (views.left && !isOccupied(x - 1, y, z)) {
          const p = getPixel(views.left, dimY - 1 - y, imgZ);
          sampled = [p[0], p[1], p[2]];
        }

        // Fallback to any supplied view
        if (!sampled) {
          if (views.front) {
            const p = getPixel(views.front, x, imgZ);
            sampled = [p[0], p[1], p[2]];
          } else if (views.top) {
            const p = getPixel(views.top, x, y);
            sampled = [p[0], p[1], p[2]];
          } else if (views.side) {
            const p = getPixel(views.side, y, imgZ);
            sampled = [p[0], p[1], p[2]];
          } else if (views.back) {
            const p = getPixel(views.back, dimX - 1 - x, imgZ);
            sampled = [p[0], p[1], p[2]];
          } else if (views.left) {
            const p = getPixel(views.left, dimY - 1 - y, imgZ);
            sampled = [p[0], p[1], p[2]];
          } else if (views.bottom) {
            const p = getPixel(views.bottom, x, dimY - 1 - y);
            sampled = [p[0], p[1], p[2]];
          }
        }

        const matched = findNearestPaletteColor(sampled ?? [128, 128, 128], opts.palette);
        if (!(matched.name in materials)) {
          materials[matched.name] = { color: matched.hex, kind: "matte" };
        }
        grid.set(x, y, z, { material: matched.name });
      }
    }
  }

  const ops = greedyBoxMerge(grid, dimX, dimY, dimZ);
  const footprintTiles: [number, number] = [
    Math.max(1, Math.ceil(dimX / voxelsPerTile)),
    Math.max(1, Math.ceil(dimY / voxelsPerTile)),
  ];

  return PixcelAssetSchema.parse({
    schemaVersion: 1,
    id: opts.id,
    category: "carved",
    layer: "object",
    outlineMode: "silhouette",
    tilePreset,
    voxelsPerTile,
    footprintTiles,
    palette: opts.palette.name,
    materials,
    ops,
  });
}
