import { createRGBAImage, type RGBAImage } from "./exporters/png.js";
import { buildShadeRamp, type RGBA, type ShadeRamp } from "./palette.js";
import { rasterizeIsometric, type FaceKind, type TileMetrics } from "./rasterizer.js";
import type {
  AnchorMode,
  Direction,
  EmissiveMode,
  MaterialDefinition,
  OutlineMode,
  PaletteDefinition,
  PixcelAsset,
} from "./schema.js";
import type { VoxelGrid } from "./voxel-grid.js";

export interface RenderResult {
  main: RGBAImage;
  emissive?: RGBAImage;
  anchor: { x: number; y: number };
  footprintTiles: [number, number];
  direction: Direction;
  tileMetrics: TileMetrics;
}

function computeVoxelAO(grid: VoxelGrid, x: number, y: number, z: number, face: FaceKind): number {
  let occluders = 0;
  if (face === 1) {
    // Top face (+Z): check raised neighbors at z+1 in the 4 cardinal directions
    if (grid.has(x - 1, y, z + 1)) occluders++;
    if (grid.has(x + 1, y, z + 1)) occluders++;
    if (grid.has(x, y - 1, z + 1)) occluders++;
    if (grid.has(x, y + 1, z + 1)) occluders++;
  } else if (face === 2) {
    // Left face (+Y): check protruding neighbors at y+1
    if (grid.has(x, y + 1, z + 1)) occluders++;
    if (grid.has(x, y + 1, z - 1)) occluders++;
    if (grid.has(x - 1, y + 1, z)) occluders++;
    if (grid.has(x + 1, y + 1, z)) occluders++;
  } else if (face === 3) {
    // Right face (+X): check protruding neighbors at x+1
    if (grid.has(x + 1, y, z + 1)) occluders++;
    if (grid.has(x + 1, y, z - 1)) occluders++;
    if (grid.has(x + 1, y - 1, z)) occluders++;
    if (grid.has(x + 1, y + 1, z)) occluders++;
  }
  return occluders;
}

function pickRampColor(ramp: ShadeRamp, step: number): RGBA {
  if (step >= 1) return ramp.highlight;
  if (step === 0) return ramp.base;
  if (step === -1) return ramp.shadow;
  return ramp.deepShadow;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function renderAssetFrame(
  asset: PixcelAsset,
  grid: VoxelGrid,
  _palette: PaletteDefinition,
  opts: {
    direction: Direction;
    outlineMode?: OutlineMode;
    interiorCreases?: boolean;
    emissiveMode?: EmissiveMode;
    aoStrength?: number;
    anchorMode?: AnchorMode;
  },
): RenderResult {
  const outlineMode = opts.outlineMode ?? asset.outlineMode;
  const interiorCreases = opts.interiorCreases ?? true;
  const emissiveMode = opts.emissiveMode ?? "baked";
  const aoStrength = opts.aoStrength ?? 0.5;

  const gb = rasterizeIsometric(grid, {
    tilePreset: asset.tilePreset,
    voxelsPerTile: asset.voxelsPerTile,
    footprintTiles: asset.footprintTiles,
    direction: opts.direction,
    anchorMode: opts.anchorMode,
  });

  // Precompute material definitions and shade ramps
  const matDefs: MaterialDefinition[] = gb.materialTable.map((name) => asset.materials[name]);
  const ramps: ShadeRamp[] = matDefs.map((def) => buildShadeRamp(def.color, def.kind));

  // Determine required canvas padding from outline and emissive glow radii
  const outlinePad = outlineMode === "none" ? 0 : 1;
  let maxGlowRadius = 0;
  let hasEmissivePixels = false;
  for (let i = 0; i < gb.face.length; i++) {
    if (gb.face[i] === 0) continue;
    const mat = matDefs[gb.materialIds[i]];
    if (mat.kind === "emissive") {
      hasEmissivePixels = true;
      const r = mat.glowRadius ?? 2;
      if (r > maxGlowRadius) maxGlowRadius = r;
    }
  }

  const pad = Math.max(outlinePad, hasEmissivePixels ? maxGlowRadius : 0);
  const outW = gb.width + pad * 2;
  const outH = gb.height + pad * 2;
  const main = createRGBAImage(outW, outH);
  const wantSplitEmissive = emissiveMode === "split" || emissiveMode === "both";
  const emissive = wantSplitEmissive ? createRGBAImage(outW, outH) : undefined;

  // Step 1: Shade opaque pixels + record emissive sources
  const shadedStep = new Int8Array(gb.width * gb.height);
  const emissiveSources: Array<{ ox: number; oy: number; rgba: RGBA; radius: number; intensity: number }> = [];

  for (let gy = 0; gy < gb.height; gy++) {
    for (let gx = 0; gx < gb.width; gx++) {
      const gi = gy * gb.width + gx;
      const f = gb.face[gi] as FaceKind;
      if (f === 0) continue;

      const matId = gb.materialIds[gi];
      const mat = matDefs[matId];
      const ramp = ramps[matId];
      const ox = gx + pad;
      const oy = gy + pad;
      const oi = (oy * outW + ox) * 4;

      if (mat.kind === "emissive") {
        // Emissive pixels bypass directional shadow & AO
        const rgba = ramp.base;
        main.data[oi] = rgba[0];
        main.data[oi + 1] = rgba[1];
        main.data[oi + 2] = rgba[2];
        main.data[oi + 3] = 255;
        shadedStep[gi] = 1;

        if (emissive) {
          emissive.data[oi] = rgba[0];
          emissive.data[oi + 1] = rgba[1];
          emissive.data[oi + 2] = rgba[2];
          emissive.data[oi + 3] = 255;
        }
        emissiveSources.push({
          ox,
          oy,
          rgba,
          radius: mat.glowRadius ?? 2,
          intensity: mat.glowIntensity ?? 0.4,
        });
        continue;
      }

      let step = f === 1 ? 1 : f === 2 ? 0 : -1;

      // Stylized opaque glass specular diagonal streak (100% ramp-locked)
      if (mat.kind === "glass") {
        const diag = (gb.vx[gi] + gb.vy[gi] + gb.vz[gi]) % 6;
        if (diag === 0) {
          step = 1;
        }
      }

      // Voxel Ambient Occlusion in concave corners
      if (aoStrength > 0) {
        const occ = computeVoxelAO(gb.rotatedGrid, gb.vx[gi], gb.vy[gi], gb.vz[gi], f);
        if (occ >= 2 || (occ >= 1 && aoStrength >= 0.75)) {
          step -= 1;
        }
      }

      shadedStep[gi] = step;
      const rgba = pickRampColor(ramp, step);
      main.data[oi] = rgba[0];
      main.data[oi + 1] = rgba[1];
      main.data[oi + 2] = rgba[2];
      main.data[oi + 3] = 255;
    }
  }

  // Step 2: Optional subtle interior creases on depth discontinuity >= 3 or part boundary
  if (interiorCreases && outlineMode !== "none") {
    const depthThreshold = 3 * 1024;
    for (let gy = 0; gy < gb.height; gy++) {
      for (let gx = 0; gx < gb.width; gx++) {
        const gi = gy * gb.width + gx;
        if (gb.face[gi] === 0) continue;
        const matId = gb.materialIds[gi];
        if (matDefs[matId].kind === "emissive") continue;

        let crease = false;
        const myDepth = gb.depth[gi];
        const myPart = gb.partIds[gi];
        // Check down and right neighbors for depth jump or part change
        const neighbors: Array<[number, number]> = [
          [gx + 1, gy],
          [gx, gy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= gb.width || ny >= gb.height) continue;
          const ni = ny * gb.width + nx;
          if (gb.face[ni] === 0) continue;
          const depthDiff = Math.abs(myDepth - gb.depth[ni]);
          if (depthDiff >= depthThreshold && myDepth < gb.depth[ni]) {
            crease = true;
            break;
          }
          if (myPart !== -1 && gb.partIds[ni] !== -1 && myPart !== gb.partIds[ni] && myDepth <= gb.depth[ni]) {
            crease = true;
            break;
          }
        }
        if (crease) {
          const rgba = pickRampColor(ramps[matId], shadedStep[gi] - 1);
          const oi = ((gy + pad) * outW + (gx + pad)) * 4;
          main.data[oi] = rgba[0];
          main.data[oi + 1] = rgba[1];
          main.data[oi + 2] = rgba[2];
        }
      }
    }
  }

  // Step 3: Smart 1px outer silhouette outline
  if (outlineMode === "silhouette" || outlineMode === "top-only") {
    const dirs: Array<[number, number]> = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const gx = ox - pad;
        const gy = oy - pad;
        const isOpaque =
          gx >= 0 && gx < gb.width && gy >= 0 && gy < gb.height && gb.face[gy * gb.width + gx] !== 0;
        if (isOpaque) continue;

        // For "top-only" (modular wall segments), skip vertical side seam outlines so adjacent walls stitch cleanly
        let bestMatId = -1;
        let bestDepth = -0x3fffffff;
        for (const [dx, dy] of dirs) {
          if (outlineMode === "top-only" && dy === 0) continue;
          const ngx = gx + dx;
          const ngy = gy + dy;
          if (ngx < 0 || ngx >= gb.width || ngy < 0 || ngy >= gb.height) continue;
          const ni = ngy * gb.width + ngx;
          if (gb.face[ni] !== 0 && gb.depth[ni] > bestDepth) {
            bestDepth = gb.depth[ni];
            bestMatId = gb.materialIds[ni];
          }
        }
        if (bestMatId !== -1) {
          const ol = ramps[bestMatId].outline;
          const oi = (oy * outW + ox) * 4;
          main.data[oi] = ol[0];
          main.data[oi + 1] = ol[1];
          main.data[oi + 2] = ol[2];
          main.data[oi + 3] = 255;
        }
      }
    }
  }

  // Step 4: Emissive radial glow halo
  const bakeGlow = emissiveMode === "baked" || emissiveMode === "both";
  if (emissiveSources.length > 0 && (bakeGlow || emissive)) {
    const glowR = new Float32Array(outW * outH);
    const glowG = new Float32Array(outW * outH);
    const glowB = new Float32Array(outW * outH);
    const glowA = new Float32Array(outW * outH);

    for (const src of emissiveSources) {
      if (src.radius <= 0 || src.intensity <= 0) continue;
      const r = src.radius;
      for (let dy = -r; dy <= r; dy++) {
        const py = src.oy + dy;
        if (py < 0 || py >= outH) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const px = src.ox + dx;
          if (px < 0 || px >= outW) continue;
          const dist = Math.hypot(dx, dy);
          if (dist > r + 0.25) continue;
          const falloff = (1 - dist / (r + 0.6)) * src.intensity;
          if (falloff <= 0) continue;
          const idx = py * outW + px;
          if (falloff > glowA[idx]) {
            glowA[idx] = falloff;
            glowR[idx] = src.rgba[0];
            glowG[idx] = src.rgba[1];
            glowB[idx] = src.rgba[2];
          }
        }
      }
    }

    for (let i = 0; i < outW * outH; i++) {
      const ga = glowA[i];
      if (ga <= 0.01) continue;
      const pi = i * 4;

      if (emissive && emissive.data[pi + 3] === 0) {
        emissive.data[pi] = clampByte(glowR[i]);
        emissive.data[pi + 1] = clampByte(glowG[i]);
        emissive.data[pi + 2] = clampByte(glowB[i]);
        emissive.data[pi + 3] = clampByte(ga * 255);
      }

      if (bakeGlow) {
        const dstA = main.data[pi + 3];
        if (dstA > 0) {
          // Subtle additive-tinted screen glow onto adjacent desk/bezel surfaces
          main.data[pi] = clampByte(main.data[pi] + glowR[i] * ga * 0.45);
          main.data[pi + 1] = clampByte(main.data[pi + 1] + glowG[i] * ga * 0.45);
          main.data[pi + 2] = clampByte(main.data[pi + 2] + glowB[i] * ga * 0.45);
        } else {
          // Soft pixel-aligned halo into transparent air
          main.data[pi] = clampByte(glowR[i]);
          main.data[pi + 1] = clampByte(glowG[i]);
          main.data[pi + 2] = clampByte(glowB[i]);
          main.data[pi + 3] = clampByte(ga * 190);
        }
      }
    }
  }

  return {
    main,
    emissive,
    anchor: { x: gb.anchorX + pad, y: gb.anchorY + pad },
    footprintTiles: gb.footprintTiles,
    direction: opts.direction,
    tileMetrics: gb.tileMetrics,
  };
}
