import { MAX_VOXEL_COORD, type Decal, type FrameDefinition, type PartTransform, type PixcelAsset, type VoxelDslOp } from "./schema.js";
import { VoxelGrid } from "./voxel-grid.js";

export interface CompiledFrame {
  name: string;
  durationMs: number;
  grid: VoxelGrid;
}

function assertInBounds(asset: PixcelAsset, x: number, y: number, z: number, context: string): void {
  if (x < 0 || y < 0 || z < 0 || x > MAX_VOXEL_COORD || y > MAX_VOXEL_COORD || z > MAX_VOXEL_COORD) {
    throw new Error(
      `Asset "${asset.id}" ${context} produced out-of-bounds/negative voxel coordinate (${x}, ${y}, ${z}); valid range is 0..${MAX_VOXEL_COORD}`,
    );
  }
}

function assertMaterialValid(asset: PixcelAsset, material: string | null, context: string): void {
  if (material === null) return;
  if (!(material in asset.materials)) {
    const available = Object.keys(asset.materials).join(", ");
    throw new Error(
      `Asset "${asset.id}" ${context} references unknown material "${material}". Available: [${available}]`,
    );
  }
}

function writeVoxel(grid: VoxelGrid, x: number, y: number, z: number, material: string | null, part?: string): void {
  if (material === null) {
    grid.delete(x, y, z);
  } else {
    grid.set(x, y, z, part ? { material, part } : { material });
  }
}

function applyOp(grid: VoxelGrid, asset: PixcelAsset, op: VoxelDslOp): void {
  if (op.op === "mirror") {
    const temp = new VoxelGrid();
    for (const child of op.ops) {
      applyOp(temp, asset, child);
    }
    const keepOriginal = op.keepOriginal ?? true;
    for (const [x, y, z, cell] of temp.entries()) {
      if (keepOriginal) {
        grid.set(x, y, z, cell);
      }
      const mx = op.axis === "x" ? Math.round(2 * op.pivot - x) : x;
      const my = op.axis === "y" ? Math.round(2 * op.pivot - y) : y;
      const mz = op.axis === "z" ? Math.round(2 * op.pivot - z) : z;
      assertInBounds(asset, mx, my, mz, `mirror op (${op.axis})`);
      grid.set(mx, my, mz, cell);
    }
    return;
  }

  assertMaterialValid(asset, op.material, `op "${op.op}"`);

  switch (op.op) {
    case "voxel": {
      writeVoxel(grid, op.at[0], op.at[1], op.at[2], op.material, op.part);
      break;
    }

    case "box": {
      const x0 = Math.min(op.from[0], op.to[0]);
      const x1 = Math.max(op.from[0], op.to[0]);
      const y0 = Math.min(op.from[1], op.to[1]);
      const y1 = Math.max(op.from[1], op.to[1]);
      const z0 = Math.min(op.from[2], op.to[2]);
      const z1 = Math.max(op.from[2], op.to[2]);
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            writeVoxel(grid, x, y, z, op.material, op.part);
          }
        }
      }
      break;
    }

    case "hollowBox": {
      const x0 = Math.min(op.from[0], op.to[0]);
      const x1 = Math.max(op.from[0], op.to[0]);
      const y0 = Math.min(op.from[1], op.to[1]);
      const y1 = Math.max(op.from[1], op.to[1]);
      const z0 = Math.min(op.from[2], op.to[2]);
      const z1 = Math.max(op.from[2], op.to[2]);
      const t = op.thickness;
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const onShell =
              x - x0 < t ||
              x1 - x < t ||
              y - y0 < t ||
              y1 - y < t ||
              z - z0 < t ||
              z1 - z < t;
            if (onShell) {
              writeVoxel(grid, x, y, z, op.material, op.part);
            }
          }
        }
      }
      break;
    }

    case "cylinder": {
      const [cx, cy] = op.center;
      const z0 = Math.min(op.zFrom, op.zTo);
      const z1 = Math.max(op.zFrom, op.zTo);
      const rCeil = Math.ceil(op.radius);
      const rSq = op.radius * op.radius + 0.25;
      for (let z = z0; z <= z1; z++) {
        for (let dy = -rCeil; dy <= rCeil; dy++) {
          for (let dx = -rCeil; dx <= rCeil; dx++) {
            if (dx * dx + dy * dy <= rSq) {
              const vx = cx + dx;
              const vy = cy + dy;
              assertInBounds(asset, vx, vy, z, "cylinder op");
              writeVoxel(grid, vx, vy, z, op.material, op.part);
            }
          }
        }
      }
      break;
    }

    case "slope": {
      const x0 = Math.min(op.from[0], op.to[0]);
      const x1 = Math.max(op.from[0], op.to[0]);
      const y0 = Math.min(op.from[1], op.to[1]);
      const y1 = Math.max(op.from[1], op.to[1]);
      const z0 = Math.min(op.from[2], op.to[2]);
      const z1 = Math.max(op.from[2], op.to[2]);
      const spanX = Math.max(1, x1 - x0);
      const spanY = Math.max(1, y1 - y0);
      const spanZ = z1 - z0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          let t = 0;
          if (op.axis === "+X") t = (x - x0) / spanX;
          else if (op.axis === "-X") t = (x1 - x) / spanX;
          else if (op.axis === "+Y") t = (y - y0) / spanY;
          else t = (y1 - y) / spanY;
          const maxZ = z0 + Math.round(t * spanZ);
          for (let z = z0; z <= maxZ; z++) {
            writeVoxel(grid, x, y, z, op.material, op.part);
          }
        }
      }
      break;
    }

    case "line": {
      let [x0, y0, z0] = op.from;
      const [x1, y1, z1] = op.to;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const dz = Math.abs(z1 - z0);
      const steps = Math.max(dx, dy, dz, 1);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(x0 + (x1 - x0) * t);
        const y = Math.round(y0 + (y1 - y0) * t);
        const z = Math.round(z0 + (z1 - z0) * t);
        writeVoxel(grid, x, y, z, op.material, op.part);
      }
      break;
    }
  }
}

function applyDecal(grid: VoxelGrid, asset: PixcelAsset, decal: Decal): void {
  for (const [ch, mat] of Object.entries(decal.legend)) {
    assertMaterialValid(asset, mat, `decal legend "${ch}"`);
  }
  const [ox, oy, oz] = decal.origin;
  for (let rowIdx = 0; rowIdx < decal.rows.length; rowIdx++) {
    const row = decal.rows[rowIdx];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const ch = row[colIdx];
      if (!(ch in decal.legend)) continue;
      const mat = decal.legend[ch];
      if (mat === null) continue;

      let x = ox;
      let y = oy;
      let z = oz;
      switch (decal.face) {
        case "+X":
          y = oy + colIdx;
          z = oz - rowIdx;
          break;
        case "-X":
          y = oy + colIdx;
          z = oz - rowIdx;
          break;
        case "+Y":
          x = ox + colIdx;
          z = oz - rowIdx;
          break;
        case "-Y":
          x = ox + colIdx;
          z = oz - rowIdx;
          break;
        case "+Z":
        case "-Z":
          x = ox + colIdx;
          y = oy + rowIdx;
          break;
      }
      assertInBounds(asset, x, y, z, `decal on face ${decal.face}`);
      grid.set(x, y, z, decal.part ? { material: mat, part: decal.part } : { material: mat });
    }
  }
}

function buildPartChain(asset: PixcelAsset, partId: string): string[] {
  const parts = asset.parts;
  if (!parts || !(partId in parts)) return [partId];
  const chain: string[] = [];
  const visited = new Set<string>();
  let cur: string | undefined = partId;
  while (cur) {
    if (visited.has(cur)) {
      throw new Error(`Asset "${asset.id}" has cyclic part parent chain involving "${cur}"`);
    }
    visited.add(cur);
    chain.push(cur);
    cur = parts[cur]?.parent;
  }
  return chain; // [self, parent, grandparent, ...]
}

function rotatePoint90CW(
  x: number,
  y: number,
  px: number,
  py: number,
  steps: 0 | 1 | 2 | 3,
): [number, number] {
  let dx = x - px;
  let dy = y - py;
  for (let i = 0; i < steps; i++) {
    // 90deg CW around +Z: (+1, 0) -> (0, +1), (0, +1) -> (-1, 0)
    const nextX = -dy;
    const nextY = dx;
    dx = nextX;
    dy = nextY;
  }
  return [px + dx, py + dy];
}

function applyPartTransforms(
  asset: PixcelAsset,
  grid: VoxelGrid,
  partTransforms: Record<string, PartTransform>,
): VoxelGrid {
  // Validate all defined part parent chains up front so cycles always throw cleanly
  if (asset.parts) {
    for (const partId of Object.keys(asset.parts)) {
      buildPartChain(asset, partId);
    }
  }

  const hasAny = Object.keys(partTransforms).length > 0;
  if (!hasAny) return grid;

  const chainCache = new Map<string, string[]>();
  const getChain = (partId: string): string[] => {
    let c = chainCache.get(partId);
    if (!c) {
      c = buildPartChain(asset, partId);
      chainCache.set(partId, c);
    }
    return c;
  };

  const next = new VoxelGrid();
  for (const [x, y, z, cell] of grid.entries()) {
    if (!cell.part) {
      next.set(x, y, z, cell);
      continue;
    }

    const chain = getChain(cell.part);
    let hidden = false;
    let cx = x;
    let cy = y;
    let cz = z;

    for (const pid of chain) {
      const tf = partTransforms[pid];
      if (!tf) continue;
      if (tf.hide) {
        hidden = true;
        break;
      }
      if (tf.rotateZSteps) {
        const pivot = asset.parts?.[pid]?.pivot ?? [cx, cy, cz];
        [cx, cy] = rotatePoint90CW(cx, cy, pivot[0], pivot[1], tf.rotateZSteps);
      }
      if (tf.translate) {
        cx += tf.translate[0];
        cy += tf.translate[1];
        cz += tf.translate[2];
      }
    }

    if (hidden) continue;
    assertInBounds(asset, cx, cy, cz, `partTransform for "${cell.part}"`);
    next.set(cx, cy, cz, cell);
  }
  return next;
}

function compileFrameList(asset: PixcelAsset, baseGrid: VoxelGrid, frameDefs: FrameDefinition[]): CompiledFrame[] {
  return frameDefs.map((frameDef) => {
    let fg = baseGrid.clone();
    if (frameDef.partTransforms) {
      fg = applyPartTransforms(asset, fg, frameDef.partTransforms);
    }
    for (const op of frameDef.ops) {
      applyOp(fg, asset, op);
    }
    for (const decal of frameDef.decals) {
      applyDecal(fg, asset, decal);
    }
    return {
      name: frameDef.name,
      durationMs: frameDef.durationMs,
      grid: fg,
    };
  });
}

function buildBaseGrid(asset: PixcelAsset): VoxelGrid {
  const baseGrid = new VoxelGrid();
  if (asset.parts) {
    for (const partId of Object.keys(asset.parts)) {
      buildPartChain(asset, partId);
    }
  }
  for (const op of asset.ops) {
    applyOp(baseGrid, asset, op);
  }
  for (const decal of asset.decals) {
    applyDecal(baseGrid, asset, decal);
  }
  return baseGrid;
}

export function compileAssetAnimations(asset: PixcelAsset): Map<string, CompiledFrame[]> {
  const baseGrid = buildBaseGrid(asset);
  const map = new Map<string, CompiledFrame[]>();
  if (asset.animations && Object.keys(asset.animations).length > 0) {
    for (const [clipName, clip] of Object.entries(asset.animations)) {
      map.set(clipName, compileFrameList(asset, baseGrid, clip.frames));
    }
    return map;
  }
  if (asset.frames && asset.frames.length > 0) {
    map.set("default", compileFrameList(asset, baseGrid, asset.frames));
    return map;
  }
  map.set("default", [{ name: "default", durationMs: 0, grid: baseGrid.clone() }]);
  return map;
}

export function compileAsset(asset: PixcelAsset): { baseGrid: VoxelGrid; frames: CompiledFrame[] } {
  const baseGrid = buildBaseGrid(asset);

  if (asset.frames && asset.frames.length > 0) {
    return {
      baseGrid,
      frames: compileFrameList(asset, baseGrid, asset.frames),
    };
  }

  if (asset.animations && Object.keys(asset.animations).length > 0) {
    const preferred = asset.animations.idle ?? Object.values(asset.animations)[0];
    return {
      baseGrid,
      frames: compileFrameList(asset, baseGrid, preferred.frames),
    };
  }

  return {
    baseGrid,
    frames: [{ name: "default", durationMs: 0, grid: baseGrid.clone() }],
  };
}
