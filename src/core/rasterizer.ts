import type { AnchorMode, Direction, TilePreset } from "./schema.js";
import { directionToRotationSteps, rotateFootprintTiles, VoxelGrid } from "./voxel-grid.js";

/** 0 = empty, 1 = top (+Z), 2 = left (+Y), 3 = right (+X) */
export type FaceKind = 0 | 1 | 2 | 3;

export interface TileMetrics {
  tileWidth: number;
  tileHeight: number;
  stepX: number;
  stepY: number;
  tileOverlapY: number;
  subVoxelsPerTile: 16 | 32;
}

export interface GBuffer {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  anchorX: number;
  anchorY: number;
  footprintTiles: [number, number];
  tileMetrics: TileMetrics;
  rotatedGrid: VoxelGrid;
  scaleFactor: 1 | 2;
  face: Uint8Array;
  depth: Int32Array;
  vx: Int16Array;
  vy: Int16Array;
  vz: Int16Array;
  materialIds: Int16Array;
  partIds: Int16Array;
  materialTable: string[];
  partTable: string[];
}

export function getTileMetrics(preset: TilePreset): TileMetrics {
  switch (preset) {
    case "64x32":
      return { tileWidth: 64, tileHeight: 32, stepX: 32, stepY: 16, tileOverlapY: 0, subVoxelsPerTile: 32 };
    case "64x31":
      return { tileWidth: 64, tileHeight: 31, stepX: 32, stepY: 15, tileOverlapY: 1, subVoxelsPerTile: 32 };
    case "32x16":
      return { tileWidth: 32, tileHeight: 16, stepX: 16, stepY: 8, tileOverlapY: 0, subVoxelsPerTile: 16 };
  }
}

function projectSubVoxel(sx: number, sy: number, sz: number): [number, number] {
  return [sx - sy, Math.floor((sx + sy) / 2) - sz];
}

export function rasterizeIsometric(
  grid: VoxelGrid,
  opts: {
    tilePreset: TilePreset;
    voxelsPerTile: 16 | 32;
    footprintTiles: [number, number];
    direction: Direction;
    anchorMode?: AnchorMode;
  },
): GBuffer {
  const tileMetrics = getTileMetrics(opts.tilePreset);
  const steps = directionToRotationSteps(opts.direction);
  const rotatedFootprintTiles = rotateFootprintTiles(opts.footprintTiles, opts.direction);
  const baseFx = opts.footprintTiles[0] * opts.voxelsPerTile;
  const baseFy = opts.footprintTiles[1] * opts.voxelsPerTile;
  const { grid: rotatedGrid, footprintVoxelsX, footprintVoxelsY } = grid.rotate90CW(steps, baseFx, baseFy);

  // Determine integer upscale factor into tileMetrics.subVoxelsPerTile
  // 64x32/64x31 @ vpt=16 -> 2x2x2 sub-voxels per voxel; 64x32 @ vpt=32 or 32x16 @ vpt=16 -> 1x
  const scaleFactor: 1 | 2 = tileMetrics.subVoxelsPerTile === 32 && opts.voxelsPerTile === 16 ? 2 : 1;
  const subFx = footprintVoxelsX * scaleFactor;
  const subFy = footprintVoxelsY * scaleFactor;

  const anchorMode = opts.anchorMode ?? "bottom-diamond";
  const [rawAnchorSx, rawAnchorSy] =
    anchorMode === "center-floor"
      ? projectSubVoxel(Math.floor(subFx / 2), Math.floor(subFy / 2), 0)
      : projectSubVoxel(subFx - 1, subFy - 1, 0);

  // Material & part interning tables
  const matIndexMap = new Map<string, number>();
  const materialTable: string[] = [];
  const partIndexMap = new Map<string, number>();
  const partTable: string[] = [];

  const getMatId = (name: string): number => {
    let idx = matIndexMap.get(name);
    if (idx === undefined) {
      idx = materialTable.length;
      materialTable.push(name);
      matIndexMap.set(name, idx);
    }
    return idx;
  };
  const getPartId = (name?: string): number => {
    if (!name) return -1;
    let idx = partIndexMap.get(name);
    if (idx === undefined) {
      idx = partTable.length;
      partTable.push(name);
      partIndexMap.set(name, idx);
    }
    return idx;
  };

  // Collect voxels and sort back-to-front by (x + y, z)
  const voxels: Array<{ x: number; y: number; z: number; matId: number; partId: number }> = [];
  for (const [x, y, z, cell] of rotatedGrid.entries()) {
    voxels.push({
      x,
      y,
      z,
      matId: getMatId(cell.material),
      partId: getPartId(cell.part),
    });
  }

  voxels.sort((a, b) => {
    const da = a.x + a.y;
    const db = b.x + b.y;
    if (da !== db) return da - db;
    if (a.z !== b.z) return a.z - b.z;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });

  const maxVoxelZ = voxels.reduce((acc, v) => (v.z > acc ? v.z : acc), 0);
  const flatFloorOnly = voxels.length > 0 && maxVoxelZ === 0;
  const effectiveZScale = flatFloorOnly ? 1 : scaleFactor;

  // Compute screen bounds across all projected sub-voxels + anchor
  let minPx = rawAnchorSx;
  let maxPx = rawAnchorSx;
  let minPy = rawAnchorSy;
  let maxPy = rawAnchorSy;

  if (voxels.length > 0) {
    minPx = Infinity;
    maxPx = -Infinity;
    minPy = Infinity;
    maxPy = -Infinity;
    for (const v of voxels) {
      const bx = v.x * scaleFactor;
      const by = v.y * scaleFactor;
      const bz = v.z * effectiveZScale;
      const endXY = scaleFactor - 1;
      const endZ = effectiveZScale - 1;
      // Check corners of sub-voxel block
      const corners: Array<[number, number, number]> =
        scaleFactor === 1
          ? [[bx, by, bz]]
          : [
              [bx, by, bz],
              [bx + endXY, by, bz],
              [bx, by + endXY, bz],
              [bx + endXY, by + endXY, bz],
              [bx, by, bz + endZ],
              [bx + endXY, by + endXY, bz + endZ],
            ];
      for (const [cx, cy, cz] of corners) {
        const [px, py] = projectSubVoxel(cx, cy, cz);
        if (px < minPx) minPx = px;
        if (px > maxPx) maxPx = px;
        if (py < minPy) minPy = py;
        if (py > maxPy) maxPy = py;
      }
    }
  }

  // Clamp 64x31 Tiled tight-lock floor tip row if asset sits strictly on z=0
  const clamp64x31Bottom = opts.tilePreset === "64x31" && flatFloorOnly;
  if (clamp64x31Bottom && maxPy - minPy + 1 === 32) {
    maxPy -= 1;
  }

  // Ensure anchor is inside bounds
  const effectiveAnchorSy = clamp64x31Bottom ? Math.min(rawAnchorSy, maxPy) : rawAnchorSy;
  if (rawAnchorSx < minPx) minPx = rawAnchorSx;
  if (rawAnchorSx > maxPx) maxPx = rawAnchorSx;
  if (effectiveAnchorSy < minPy) minPy = effectiveAnchorSy;
  if (effectiveAnchorSy > maxPy) maxPy = effectiveAnchorSy;

  const width = Math.max(1, maxPx - minPx + 1);
  const height = Math.max(1, maxPy - minPy + 1);
  const pixelCount = width * height;

  const face = new Uint8Array(pixelCount);
  const depth = new Int32Array(pixelCount).fill(-0x3fffffff);
  const vx = new Int16Array(pixelCount);
  const vy = new Int16Array(pixelCount);
  const vz = new Int16Array(pixelCount);
  const materialIds = new Int16Array(pixelCount).fill(-1);
  const partIds = new Int16Array(pixelCount).fill(-1);

  for (const v of voxels) {
    const hasTopNeighbor = rotatedGrid.has(v.x, v.y, v.z + 1);
    const hasRightNeighbor = rotatedGrid.has(v.x + 1, v.y, v.z);
    const hasLeftNeighbor = rotatedGrid.has(v.x, v.y + 1, v.z);

    // Completely hidden interior voxel
    if (hasTopNeighbor && hasRightNeighbor && hasLeftNeighbor) continue;

    for (let dz = 0; dz < effectiveZScale; dz++) {
      for (let dy = 0; dy < scaleFactor; dy++) {
        for (let dx = 0; dx < scaleFactor; dx++) {
          const sx = v.x * scaleFactor + dx;
          const sy = v.y * scaleFactor + dy;
          const sz = v.z * effectiveZScale + dz;

          const subTopExposed = dz === effectiveZScale - 1 ? !hasTopNeighbor : false;
          const subRightExposed = dx === scaleFactor - 1 ? !hasRightNeighbor : false;
          const subLeftExposed = dy === scaleFactor - 1 ? !hasLeftNeighbor : false;

          let fKind: FaceKind = 0;
          if (subTopExposed) {
            fKind = 1; // top (+Z)
          } else if (subLeftExposed && !subRightExposed) {
            fKind = 2; // left (+Y)
          } else if (subRightExposed && !subLeftExposed) {
            fKind = 3; // right (+X)
          } else if (subLeftExposed && subRightExposed) {
            // Front corner vertical ridge: left vs right split on sub-voxel or left by convention
            fKind = dx >= dy && scaleFactor === 2 ? 3 : 2;
          } else {
            continue;
          }

          const [projX, projY] = projectSubVoxel(sx, sy, sz);
          if (clamp64x31Bottom && projY > maxPy) continue;

          const px = projX - minPx;
          const py = projY - minPy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const idx = py * width + px;
          const dKey = (sx + sy) * 1024 + sz;
          if (dKey >= depth[idx]) {
            depth[idx] = dKey;
            face[idx] = fKind;
            vx[idx] = v.x;
            vy[idx] = v.y;
            vz[idx] = v.z;
            materialIds[idx] = v.matId;
            partIds[idx] = v.partId;
          }
        }
      }
    }
  }

  return {
    width,
    height,
    offsetX: minPx,
    offsetY: minPy,
    anchorX: rawAnchorSx - minPx,
    anchorY: effectiveAnchorSy - minPy,
    footprintTiles: rotatedFootprintTiles,
    tileMetrics,
    rotatedGrid,
    scaleFactor,
    face,
    depth,
    vx,
    vy,
    vz,
    materialIds,
    partIds,
    materialTable,
    partTable,
  };
}
