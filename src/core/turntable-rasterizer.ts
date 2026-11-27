import { createRGBAImage, type RGBAImage } from "./exporters/png.js";
import { buildVoxelMesh, type VoxelMesh } from "./mesh-builder.js";
import type { OutlineMode, PaletteDefinition, PixcelAsset } from "./schema.js";
import type { VoxelGrid } from "./voxel-grid.js";

export type LightLockMode = "camera" | "world";

export interface TurntableRenderOptions {
  /** Azimuth rotation angle in degrees (0 = front +Y, 90 = right +X, 180 = back -Y, 270 = left -X) */
  yawDeg: number;
  /** Elevation angle in degrees (default 30 for classic 2:1 isometric dimetric view, 0 for flat ortho, 90 for top-down) */
  pitchDeg?: number;
  /** Pixel density multiplier relative to native isometric voxel scale (default 1) */
  pixelScale?: number;
  /** Outline style (default from asset.outlineMode; top-only maps to silhouette on arbitrary angles) */
  outlineMode?: OutlineMode;
  /** Enable directional hue-shifted shading + voxel AO (default true) */
  shading?: boolean;
  /** Keep light relative to camera (pixel-art standard) or fixed in world space (default "camera") */
  lightLock?: LightLockMode;
  /** Optional explicit canvas size (auto-computed from rotation envelope if omitted) */
  width?: number;
  height?: number;
  /** Extra transparent padding around sprite in pixels (default 3) */
  padding?: number;
  /** Enable emissive halo glow on emissive voxels (default true) */
  emissiveGlow?: boolean;
}

export interface TurntableFrameResult {
  image: RGBAImage;
  yawDeg: number;
  pitchDeg: number;
  anchor: { x: number; y: number };
}

export interface CameraBasis {
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
}

export function computeOrthoCameraBasis(yawDeg: number, pitchDeg: number): CameraBasis {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);

  return {
    forward: [sy * cp, cy * cp, sp],
    right: [-cy, sy, 0],
    up: [-sy * sp, -cy * sp, cp],
  };
}

export function computeTurntableCanvasSize(
  mesh: VoxelMesh,
  pitchDeg: number,
  pixelScale = 1,
  padding = 3,
): { width: number; height: number; pxPerVoxel: number } {
  const pxPerVoxel = Math.SQRT2 * Math.max(0.25, pixelScale);
  const pitch = (pitchDeg * Math.PI) / 180;
  const dx = mesh.bounds.maxX - mesh.bounds.minX;
  const dy = mesh.bounds.maxY - mesh.bounds.minY;
  const dz = mesh.bounds.maxZ - mesh.bounds.minZ;
  const horizRadius = 0.5 * Math.hypot(dx, dy);
  const vertRadius = horizRadius * Math.abs(Math.sin(pitch)) + 0.5 * dz * Math.abs(Math.cos(pitch));

  const halfW = Math.ceil(horizRadius * pxPerVoxel) + padding;
  const halfH = Math.ceil(vertRadius * pxPerVoxel) + padding;
  return {
    width: Math.max(8, halfW * 2),
    height: Math.max(8, halfH * 2),
    pxPerVoxel,
  };
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function edgeFunction(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

/**
 * Software orthographic pixel-art rasterizer supporting arbitrary 360-degree yaw & pitch.
 * Preserves hue-shifted directional shading, per-vertex voxel AO, emissive glow, and 1px silhouette outlines.
 */
export function renderMeshAtAngle(
  mesh: VoxelMesh,
  opts: TurntableRenderOptions & { defaultOutline?: OutlineMode },
): TurntableFrameResult {
  const pitchDeg = opts.pitchDeg ?? 30;
  const pixelScale = opts.pixelScale ?? 1;
  const padding = opts.padding ?? 3;
  const shading = opts.shading ?? true;
  const lightLock = opts.lightLock ?? "camera";
  const outlineMode = opts.outlineMode ?? opts.defaultOutline ?? "silhouette";
  const emissiveGlow = opts.emissiveGlow ?? true;

  const auto = computeTurntableCanvasSize(mesh, pitchDeg, pixelScale, padding);
  const width = opts.width ?? auto.width;
  const height = opts.height ?? auto.height;
  const pxPerVoxel = auto.pxPerVoxel;

  const img = createRGBAImage(width, height);
  const zBuf = new Float32Array(width * height);
  zBuf.fill(-Infinity);
  const emissiveMask = new Uint8Array(width * height);

  const cam = computeOrthoCameraBasis(opts.yawDeg, pitchDeg);
  const [rx, ry, rz] = cam.right;
  const [ux, uy, uz] = cam.up;
  const [fx, fy, fz] = cam.forward;

  // Light direction (towards light source)
  const lightDir: [number, number, number] =
    lightLock === "world"
      ? normalize3(-0.45, 0.35, 0.82)
      : normalize3(
          -0.42 * rx + 0.68 * ux + 0.60 * fx,
          -0.42 * ry + 0.68 * uy + 0.60 * fy,
          -0.42 * rz + 0.68 * uz + 0.60 * fz,
        );

  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const cx = mesh.bounds.centerX;
  const cy = mesh.bounds.centerY;
  const cz = mesh.bounds.centerZ;

  const pos = mesh.positions;
  const norm = mesh.normals;
  const cols = mesh.colors;
  const hiCols = mesh.highlightColors;
  const shCols = mesh.shadowColors;
  const aoArr = mesh.ao;
  const flags = mesh.flags;

  for (let t = 0; t < mesh.triangleCount; t++) {
    const v0 = t * 3;
    const v1 = v0 + 1;
    const v2 = v0 + 2;

    const nx = norm[v0 * 3];
    const ny = norm[v0 * 3 + 1];
    const nz = norm[v0 * 3 + 2];

    // Back-face cull in orthographic view: face must point toward camera (dot(N, forward) > 0)
    const ndotf = nx * fx + ny * fy + nz * fz;
    if (ndotf <= 1e-4) continue;

    // Project 3 vertices
    const p0x = pos[v0 * 3] - cx;
    const p0y = pos[v0 * 3 + 1] - cy;
    const p0z = pos[v0 * 3 + 2] - cz;
    const sx0 = halfW + (p0x * rx + p0y * ry + p0z * rz) * pxPerVoxel;
    const sy0 = halfH - (p0x * ux + p0y * uy + p0z * uz) * pxPerVoxel;
    const sz0 = p0x * fx + p0y * fy + p0z * fz;

    const p1x = pos[v1 * 3] - cx;
    const p1y = pos[v1 * 3 + 1] - cy;
    const p1z = pos[v1 * 3 + 2] - cz;
    const sx1 = halfW + (p1x * rx + p1y * ry + p1z * rz) * pxPerVoxel;
    const sy1 = halfH - (p1x * ux + p1y * uy + p1z * uz) * pxPerVoxel;
    const sz1 = p1x * fx + p1y * fy + p1z * fz;

    const p2x = pos[v2 * 3] - cx;
    const p2y = pos[v2 * 3 + 1] - cy;
    const p2z = pos[v2 * 3 + 2] - cz;
    const sx2 = halfW + (p2x * rx + p2y * ry + p2z * rz) * pxPerVoxel;
    const sy2 = halfH - (p2x * ux + p2y * uy + p2z * uz) * pxPerVoxel;
    const sz2 = p2x * fx + p2y * fy + p2z * fz;

    const area = edgeFunction(sx0, sy0, sx1, sy1, sx2, sy2);
    if (Math.abs(area) < 1e-5) continue;
    const invArea = 1 / area;
    const sign = area > 0 ? 1 : -1;

    const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(sx0, sx1, sx2)));
    const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(sy0, sy1, sy2)));

    const flag = flags[v0];
    const isEmissive = (flag & 1) !== 0;
    const isGlass = (flag & 2) !== 0;

    const br = cols[v0 * 3];
    const bg = cols[v0 * 3 + 1];
    const bb = cols[v0 * 3 + 2];

    const hr = hiCols[v0 * 3];
    const hg = hiCols[v0 * 3 + 1];
    const hb = hiCols[v0 * 3 + 2];

    const sr = shCols[v0 * 3];
    const sg = shCols[v0 * 3 + 1];
    const sb = shCols[v0 * 3 + 2];

    const ndotl = nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2];
    const ao0 = aoArr[v0];
    const ao1 = aoArr[v1];
    const ao2 = aoArr[v2];

    for (let py = minY; py <= maxY; py++) {
      const cyP = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const cxP = px + 0.5;
        const w0 = edgeFunction(sx1, sy1, sx2, sy2, cxP, cyP);
        const w1 = edgeFunction(sx2, sy2, sx0, sy0, cxP, cyP);
        const w2 = edgeFunction(sx0, sy0, sx1, sy1, cxP, cyP);

        if (w0 * sign < -1e-4 || w1 * sign < -1e-4 || w2 * sign < -1e-4) continue;

        const b0 = w0 * invArea;
        const b1 = w1 * invArea;
        const b2 = w2 * invArea;
        const depth = b0 * sz0 + b1 * sz1 + b2 * sz2;

        const idx = py * width + px;
        if (depth <= zBuf[idx]) continue;
        zBuf[idx] = depth;

        let r = br;
        let g = bg;
        let b = bb;

        if (!isEmissive && shading) {
          const aoVal = b0 * ao0 + b1 * ao1 + b2 * ao2;
          const lit = (ndotl * 0.5 + 0.5) * (0.45 + 0.55 * aoVal);
          if (lit >= 0.72 || (isGlass && lit >= 0.62)) {
            const k = Math.min(1, (lit - 0.68) / 0.28);
            r = br + (hr - br) * k;
            g = bg + (hg - bg) * k;
            b = bb + (hb - bb) * k;
          } else if (lit < 0.46) {
            const k = Math.min(1, (0.46 - lit) / 0.34);
            r = br + (sr - br) * k;
            g = bg + (sg - bg) * k;
            b = bb + (sb - bb) * k;
          } else if (aoVal < 0.92) {
            const k = (1 - aoVal) * 0.7;
            r = br + (sr - br) * k;
            g = bg + (sg - bg) * k;
            b = bb + (sb - bb) * k;
          }
        }

        const pOff = idx * 4;
        img.data[pOff] = clampByte(r);
        img.data[pOff + 1] = clampByte(g);
        img.data[pOff + 2] = clampByte(b);
        img.data[pOff + 3] = 255;
        emissiveMask[idx] = isEmissive ? 1 : 0;
      }
    }
  }

  // Optional 1px dark-tinted silhouette outline (matches iherk-pixcel postprocess style)
  if (outlineMode !== "none") {
    const srcAlpha = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      srcAlpha[i] = img.data[i * 4 + 3];
    }
    const offsets: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (srcAlpha[idx] > 0) continue;
        let minLum = Infinity;
        let or = 12;
        let og = 16;
        let ob = 28;
        let touches = false;
        for (const [dx, dy] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (srcAlpha[nIdx] === 0) continue;
          touches = true;
          const np = nIdx * 4;
          const lum = img.data[np] * 0.299 + img.data[np + 1] * 0.587 + img.data[np + 2] * 0.114;
          if (lum < minLum) {
            minLum = lum;
            or = clampByte(img.data[np] * 0.28);
            og = clampByte(img.data[np + 1] * 0.28);
            ob = clampByte(img.data[np + 2] * 0.34);
          }
        }
        if (touches) {
          const p = idx * 4;
          img.data[p] = or;
          img.data[p + 1] = og;
          img.data[p + 2] = ob;
          img.data[p + 3] = 255;
        }
      }
    }
  }

  // Subtle radial additive glow for emissive voxels
  if (emissiveGlow) {
    const glowR = new Float32Array(width * height);
    const glowG = new Float32Array(width * height);
    const glowB = new Float32Array(width * height);
    const glowA = new Float32Array(width * height);
    const radius = 2;
    let hasEmissive = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!emissiveMask[idx]) continue;
        hasEmissive = true;
        const p = idx * 4;
        const er = img.data[p];
        const eg = img.data[p + 1];
        const eb = img.data[p + 2];
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const dist = Math.hypot(dx, dy);
            if (dist === 0 || dist > radius + 0.25) continue;
            const tx = x + dx;
            const ty = y + dy;
            if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
            const falloff = (1 - dist / (radius + 0.5)) * 0.35;
            const tIdx = ty * width + tx;
            glowR[tIdx] += er * falloff;
            glowG[tIdx] += eg * falloff;
            glowB[tIdx] += eb * falloff;
            glowA[tIdx] = Math.min(1, glowA[tIdx] + falloff);
          }
        }
      }
    }
    if (hasEmissive) {
      for (let i = 0; i < width * height; i++) {
        const ga = glowA[i];
        if (ga <= 0.01) continue;
        const p = i * 4;
        if (img.data[p + 3] === 0) {
          img.data[p] = clampByte(glowR[i] / ga);
          img.data[p + 1] = clampByte(glowG[i] / ga);
          img.data[p + 2] = clampByte(glowB[i] / ga);
          img.data[p + 3] = clampByte(ga * 190);
        } else {
          img.data[p] = clampByte(img.data[p] + glowR[i] * 0.45);
          img.data[p + 1] = clampByte(img.data[p + 1] + glowG[i] * 0.45);
          img.data[p + 2] = clampByte(img.data[p + 2] + glowB[i] * 0.45);
        }
      }
    }
  }

  // Project bottom-center of bounding box as sprite anchor
  const bx = 0;
  const by = 0;
  const bz = mesh.bounds.minZ - cz;
  const anchorX = Math.round(halfW + (bx * rx + by * ry + bz * rz) * pxPerVoxel);
  const anchorY = Math.round(halfH - (bx * ux + by * uy + bz * uz) * pxPerVoxel);

  return {
    image: img,
    yawDeg: ((opts.yawDeg % 360) + 360) % 360,
    pitchDeg,
    anchor: { x: anchorX, y: anchorY },
  };
}

export function renderAssetAtAngle(
  asset: PixcelAsset,
  grid: VoxelGrid,
  _palette: PaletteDefinition,
  opts: TurntableRenderOptions,
): TurntableFrameResult {
  const mesh = buildVoxelMesh(grid, asset);
  return renderMeshAtAngle(mesh, {
    ...opts,
    defaultOutline: asset.outlineMode,
  });
}

export interface TurntableSequenceOptions {
  /** Number of evenly-spaced angles around 360° (e.g. 8, 16, 24, 36). Default 36. */
  frames?: number;
  /** Starting yaw angle in degrees (default 45 so frame 0 is front-3/4 isometric) */
  startYawDeg?: number;
  /** Camera elevation angle in degrees (default 30) */
  pitchDeg?: number;
  pixelScale?: number;
  outlineMode?: OutlineMode;
  shading?: boolean;
  lightLock?: LightLockMode;
  padding?: number;
  emissiveGlow?: boolean;
}

export function renderTurntableSequence(
  asset: PixcelAsset,
  grid: VoxelGrid,
  _palette: PaletteDefinition,
  opts: TurntableSequenceOptions = {},
): TurntableFrameResult[] {
  const frameCount = Math.max(1, Math.min(180, Math.round(opts.frames ?? 36)));
  const startYaw = opts.startYawDeg ?? 45;
  const pitchDeg = opts.pitchDeg ?? 30;
  const pixelScale = opts.pixelScale ?? 1;
  const padding = opts.padding ?? 3;

  const mesh = buildVoxelMesh(grid, asset);
  const { width, height } = computeTurntableCanvasSize(mesh, pitchDeg, pixelScale, padding);

  const results: TurntableFrameResult[] = [];
  for (let i = 0; i < frameCount; i++) {
    const yawDeg = (startYaw + (i * 360) / frameCount) % 360;
    results.push(
      renderMeshAtAngle(mesh, {
        yawDeg,
        pitchDeg,
        pixelScale,
        outlineMode: opts.outlineMode,
        defaultOutline: asset.outlineMode,
        shading: opts.shading,
        lightLock: opts.lightLock,
        emissiveGlow: opts.emissiveGlow,
        width,
        height,
        padding,
      }),
    );
  }
  return results;
}
