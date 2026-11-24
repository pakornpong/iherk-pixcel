import type { Direction } from "./schema.js";

export interface VoxelCell {
  material: string;
  part?: string;
}

export interface VoxelBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function packKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function directionToRotationSteps(dir: Direction): 0 | 1 | 2 | 3 {
  switch (dir) {
    case "se":
      return 0;
    case "sw":
      return 1;
    case "nw":
      return 2;
    case "ne":
      return 3;
  }
}

export function rotateFootprintTiles(footprint: [number, number], dir: Direction): [number, number] {
  const steps = directionToRotationSteps(dir);
  return steps % 2 === 0 ? [footprint[0], footprint[1]] : [footprint[1], footprint[0]];
}

export class VoxelGrid {
  private readonly cells = new Map<string, { x: number; y: number; z: number; cell: VoxelCell }>();

  get size(): number {
    return this.cells.size;
  }

  set(x: number, y: number, z: number, cell: VoxelCell): void {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    const iz = Math.trunc(z);
    this.cells.set(packKey(ix, iy, iz), { x: ix, y: iy, z: iz, cell: { ...cell } });
  }

  delete(x: number, y: number, z: number): void {
    this.cells.delete(packKey(Math.trunc(x), Math.trunc(y), Math.trunc(z)));
  }

  get(x: number, y: number, z: number): VoxelCell | undefined {
    return this.cells.get(packKey(Math.trunc(x), Math.trunc(y), Math.trunc(z)))?.cell;
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(packKey(Math.trunc(x), Math.trunc(y), Math.trunc(z)));
  }

  *entries(): IterableIterator<[number, number, number, VoxelCell]> {
    for (const entry of this.cells.values()) {
      yield [entry.x, entry.y, entry.z, entry.cell];
    }
  }

  getBounds(): VoxelBounds | null {
    if (this.cells.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const { x, y, z } of this.cells.values()) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  clone(): VoxelGrid {
    const copy = new VoxelGrid();
    for (const [x, y, z, cell] of this.entries()) {
      copy.set(x, y, z, cell);
    }
    return copy;
  }

  rotate90CW(
    steps: 0 | 1 | 2 | 3,
    footprintVoxelsX: number,
    footprintVoxelsY: number,
  ): { grid: VoxelGrid; footprintVoxelsX: number; footprintVoxelsY: number } {
    let cur: VoxelGrid = this;
    let fx = footprintVoxelsX;
    let fy = footprintVoxelsY;

    if (steps === 0) {
      return { grid: this.clone(), footprintVoxelsX: fx, footprintVoxelsY: fy };
    }

    for (let s = 0; s < steps; s++) {
      const next = new VoxelGrid();
      for (const [x, y, z, cell] of cur.entries()) {
        // 90deg CW around +Z: +X -> +Y, +Y -> -X
        const nx = fy - 1 - y;
        const ny = x;
        next.set(nx, ny, z, cell);
      }
      cur = next;
      const prevFx = fx;
      fx = fy;
      fy = prevFx;
    }

    return { grid: cur, footprintVoxelsX: fx, footprintVoxelsY: fy };
  }
}
