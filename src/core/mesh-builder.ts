import { buildShadeRamp, type RGBA } from "./palette.js";
import type { MaterialKind, PixcelAsset } from "./schema.js";
import type { VoxelGrid } from "./voxel-grid.js";

export interface MeshBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
}

export interface VoxelMesh {
  bounds: MeshBounds;
  /** 3 floats per vertex (x, y, z in voxel space with +Z up) */
  positions: Float32Array;
  /** 3 floats per vertex (unit outward normal) */
  normals: Float32Array;
  /** 3 bytes per vertex: base RGB */
  colors: Uint8Array;
  /** 3 bytes per vertex: hue-shifted highlight RGB */
  highlightColors: Uint8Array;
  /** 3 bytes per vertex: hue-shifted shadow RGB */
  shadowColors: Uint8Array;
  /** 1 float per vertex: voxel AO factor in [0.64, 1.0] */
  ao: Float32Array;
  /** 1 byte per vertex: bit 0 = emissive, bit 1 = glass, bit 2 = metal */
  flags: Uint8Array;
  faceCount: number;
  triangleCount: number;
}

export interface SerializedVoxelMesh {
  bounds: MeshBounds;
  faceCount: number;
  triangleCount: number;
  /** Base64-encoded Float32Array */
  positionsB64: string;
  /** Base64-encoded Float32Array */
  normalsB64: string;
  /** Base64-encoded Uint8Array */
  colorsB64: string;
  /** Base64-encoded Uint8Array */
  highlightColorsB64: string;
  /** Base64-encoded Uint8Array */
  shadowColorsB64: string;
  /** Base64-encoded Float32Array */
  aoB64: string;
  /** Base64-encoded Uint8Array */
  flagsB64: string;
}

interface FaceDef {
  dir: [number, number, number];
  normal: [number, number, number];
  /** 4 CCW corners in unit cube [0..1]^3 */
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  /** Two tangent unit axes in the face plane for corner AO lookup */
  uAxis: [number, number, number];
  vAxis: [number, number, number];
  /** Signed (du, dv) in {-1, +1} for each of the 4 corners */
  cornerSigns: [[number, number], [number, number], [number, number], [number, number]];
}

const FACES: FaceDef[] = [
  // +X
  {
    dir: [1, 0, 0],
    normal: [1, 0, 0],
    corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    uAxis: [0, 1, 0],
    vAxis: [0, 0, 1],
    cornerSigns: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  },
  // -X
  {
    dir: [-1, 0, 0],
    normal: [-1, 0, 0],
    corners: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
    uAxis: [0, 1, 0],
    vAxis: [0, 0, 1],
    cornerSigns: [[1, -1], [-1, -1], [-1, 1], [1, 1]],
  },
  // +Y (front face of characters)
  {
    dir: [0, 1, 0],
    normal: [0, 1, 0],
    corners: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    cornerSigns: [[1, -1], [-1, -1], [-1, 1], [1, 1]],
  },
  // -Y
  {
    dir: [0, -1, 0],
    normal: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    cornerSigns: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  },
  // +Z (top)
  {
    dir: [0, 0, 1],
    normal: [0, 0, 1],
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    cornerSigns: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  },
  // -Z (bottom)
  {
    dir: [0, 0, -1],
    normal: [0, 0, -1],
    corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    cornerSigns: [[-1, 1], [1, 1], [1, -1], [-1, -1]],
  },
];

const AO_LEVELS = [1.0, 0.88, 0.76, 0.64];

function materialFlag(kind: MaterialKind): number {
  if (kind === "emissive") return 1;
  if (kind === "glass") return 2;
  if (kind === "metal") return 4;
  return 0;
}

function cornerAO(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
  face: FaceDef,
  du: number,
  dv: number,
): number {
  const bx = x + face.dir[0];
  const by = y + face.dir[1];
  const bz = z + face.dir[2];

  const s1 = grid.has(bx + du * face.uAxis[0], by + du * face.uAxis[1], bz + du * face.uAxis[2]);
  const s2 = grid.has(bx + dv * face.vAxis[0], by + dv * face.vAxis[1], bz + dv * face.vAxis[2]);
  if (s1 && s2) return AO_LEVELS[3];
  const corner = grid.has(
    bx + du * face.uAxis[0] + dv * face.vAxis[0],
    by + du * face.uAxis[1] + dv * face.vAxis[1],
    bz + du * face.uAxis[2] + dv * face.vAxis[2],
  );
  const occ = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (corner ? 1 : 0);
  return AO_LEVELS[occ];
}

export function buildVoxelMesh(grid: VoxelGrid, asset: PixcelAsset): VoxelMesh {
  // Precompute shade ramps per material
  const matCache = new Map<
    string,
    { base: RGBA; highlight: RGBA; shadow: RGBA; flag: number }
  >();
  for (const [name, def] of Object.entries(asset.materials)) {
    const ramp = buildShadeRamp(def.color, def.kind);
    matCache.set(name, {
      base: ramp.base,
      highlight: ramp.highlight,
      shadow: ramp.shadow,
      flag: materialFlag(def.kind),
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  // First pass: collect exposed quads
  const quads: Array<{
    x: number;
    y: number;
    z: number;
    face: FaceDef;
    mat: { base: RGBA; highlight: RGBA; shadow: RGBA; flag: number };
    ao: [number, number, number, number];
  }> = [];

  for (const [x, y, z, cell] of grid.entries()) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x + 1 > maxX) maxX = x + 1;
    if (y + 1 > maxY) maxY = y + 1;
    if (z + 1 > maxZ) maxZ = z + 1;

    const mat = matCache.get(cell.material);
    if (!mat) continue;

    for (let fi = 0; fi < FACES.length; fi++) {
      const face = FACES[fi];
      if (grid.has(x + face.dir[0], y + face.dir[1], z + face.dir[2])) continue;
      const ao0 = mat.flag === 1 ? 1 : cornerAO(grid, x, y, z, face, face.cornerSigns[0][0], face.cornerSigns[0][1]);
      const ao1 = mat.flag === 1 ? 1 : cornerAO(grid, x, y, z, face, face.cornerSigns[1][0], face.cornerSigns[1][1]);
      const ao2 = mat.flag === 1 ? 1 : cornerAO(grid, x, y, z, face, face.cornerSigns[2][0], face.cornerSigns[2][1]);
      const ao3 = mat.flag === 1 ? 1 : cornerAO(grid, x, y, z, face, face.cornerSigns[3][0], face.cornerSigns[3][1]);
      quads.push({ x, y, z, face, mat, ao: [ao0, ao1, ao2, ao3] });
    }
  }

  if (quads.length === 0) {
    return {
      bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1, centerX: 0.5, centerY: 0.5, centerZ: 0.5, radius: 1 },
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Uint8Array(0),
      highlightColors: new Uint8Array(0),
      shadowColors: new Uint8Array(0),
      ao: new Float32Array(0),
      flags: new Uint8Array(0),
      faceCount: 0,
      triangleCount: 0,
    };
  }

  const faceCount = quads.length;
  const triangleCount = faceCount * 2;
  const vertCount = faceCount * 6;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Uint8Array(vertCount * 3);
  const highlightColors = new Uint8Array(vertCount * 3);
  const shadowColors = new Uint8Array(vertCount * 3);
  const ao = new Float32Array(vertCount);
  const flags = new Uint8Array(vertCount);

  let vi = 0;
  for (const q of quads) {
    // Flip quad diagonal when needed to avoid AO interpolation crease artifacts
    const indices =
      q.ao[0] + q.ao[2] < q.ao[1] + q.ao[3]
        ? [1, 2, 3, 1, 3, 0]
        : [0, 1, 2, 0, 2, 3];

    for (let k = 0; k < 6; k++) {
      const ci = indices[k];
      const corner = q.face.corners[ci];
      const pOff = vi * 3;
      positions[pOff] = q.x + corner[0];
      positions[pOff + 1] = q.y + corner[1];
      positions[pOff + 2] = q.z + corner[2];

      normals[pOff] = q.face.normal[0];
      normals[pOff + 1] = q.face.normal[1];
      normals[pOff + 2] = q.face.normal[2];

      colors[pOff] = q.mat.base[0];
      colors[pOff + 1] = q.mat.base[1];
      colors[pOff + 2] = q.mat.base[2];

      highlightColors[pOff] = q.mat.highlight[0];
      highlightColors[pOff + 1] = q.mat.highlight[1];
      highlightColors[pOff + 2] = q.mat.highlight[2];

      shadowColors[pOff] = q.mat.shadow[0];
      shadowColors[pOff + 1] = q.mat.shadow[1];
      shadowColors[pOff + 2] = q.mat.shadow[2];

      ao[vi] = q.ao[ci];
      flags[vi] = q.mat.flag;
      vi++;
    }
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const dx = maxX - centerX;
  const dy = maxY - centerY;
  const dz = maxZ - centerZ;
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    bounds: { minX, minY, minZ, maxX, maxY, maxZ, centerX, centerY, centerZ, radius },
    positions,
    normals,
    colors,
    highlightColors,
    shadowColors,
    ao,
    flags,
    faceCount,
    triangleCount,
  };
}

function typedArrayToBase64(arr: ArrayBufferView): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("base64");
}

export function serializeVoxelMesh(mesh: VoxelMesh): SerializedVoxelMesh {
  return {
    bounds: mesh.bounds,
    faceCount: mesh.faceCount,
    triangleCount: mesh.triangleCount,
    positionsB64: typedArrayToBase64(mesh.positions),
    normalsB64: typedArrayToBase64(mesh.normals),
    colorsB64: typedArrayToBase64(mesh.colors),
    highlightColorsB64: typedArrayToBase64(mesh.highlightColors),
    shadowColorsB64: typedArrayToBase64(mesh.shadowColors),
    aoB64: typedArrayToBase64(mesh.ao),
    flagsB64: typedArrayToBase64(mesh.flags),
  };
}
