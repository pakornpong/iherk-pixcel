# iherk-pixcel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `iherk-pixcel`, a clean-room TypeScript 3D Voxel-to-Isometric Pixel Art Engine, CLI, Stdio MCP Server, Local HTML5 Canvas Preview/Room Sandbox, and 12-asset AI Agent Office starter pack.

**Architecture:** Author assets either via structured `.pixcel.json` voxel DSL (primitives, 2D decals, animation frames, Phase 2 rig hooks) or PixZels-style 2D-to-3D orthographic PNG carving into a deterministic integer `VoxelGrid`. Project 4 lossless 90° Z-rotations through an exact 2:1 isometric software G-buffer rasterizer and pixel-art post-processor (directional shading, voxel AO, stylized opaque glass, per-asset 1px outlines, baked/split emissive glow), then export to PNG, TexturePacker JSON Hash `.atlas.json`, GIF, sprite-stack strips, OBJ+MTL, and topologically sorted isometric room compositions exposed over CLI, MCP, and a lightweight local Canvas 2D web preview.

**Tech Stack:** TypeScript (ESM), Node.js `>=22` (verified `v26.5.0`), Vitest, Zod, `pngjs`, `gifenc`, `@modelcontextprotocol/sdk`, pure HTML5 Canvas 2D (`imageSmoothingEnabled = false`).

**Spec:** `docs/superpowers/specs/2026-11-24-iherk-pixcel-design.md`

## Global Constraints

- Clean-room 100% original TypeScript code and starter assets (zero code/assets copied from PixZels or *Isometric Interiors*).
- Pure-JS/TS dependencies only — no native C++ addons (`sharp`, `canvas`, `node-gyp`) and no Blender/Python dependencies.
- Node.js `>=22` ESM TypeScript (`"type": "module"`), running cleanly on macOS Apple Silicon (`v26.5.0`).
- Byte-identical deterministic PNG output for identical `.pixcel.json` + palette + render options across runs.
- Phase 1 directions are strictly 4 lossless 90° Z-turns (`se`, `sw`, `nw`, `ne`); `glass` is stylized opaque pixel art; multi-tile assets export as single sprites with `footprintTiles` + `anchor` in TexturePacker JSON Hash `.atlas.json`.
- All `git` commands in this workspace MUST use `git -c include.path=/Users/dev3/.gitconfig-iherk ...` (never modify `~/.gitconfig`).

## Review Focus

1. **Asymmetric multi-tile (`2×1`) rotation + outline/glow padding anchor drift:** Rotating `se → sw → nw → ne` with `outlineMode: "silhouette"` or edge emissive glow must flip `footprintTiles` (`[2,1] ↔ [1,2]`) and shift `anchor` identically with canvas padding so sprites stay locked to the floor diamond. (Pinned in Task 3 & Task 6.)
2. **Modular floor/wall seam artifacts:** Adjacent `1×1` floor tiles (`outlineMode: "none"`) and wall segments (`outlineMode: "top-only"`) must stitch with zero 1px gaps and zero unwanted black grid lines across `64×32` (`voxelsPerTile = 32` and `16`), `32×16`, and `64×31`. (Pinned in Task 3 & Task 6.)
3. **Topological sort cycles / overlapping footprints in `.room.json`:** Overlapping multi-tile placements must never cause infinite loops or dropped sprites in `render_room`; tie-breaking must stay deterministic and render every placement. (Pinned in Task 6.)
4. **Malformed or adversarial AI inputs (DSL, Carver, MCP):** Unknown material keys, out-of-bounds/negative coords, mismatched or fully transparent carving PNGs, and `../` path traversal in MCP asset IDs must return structured, actionable errors without crashing or escaping the workspace root. (Pinned in Task 2, Task 5, Task 8.)
5. **Emissive glow clipping & split-layer misalignment:** Emissive pixels at sprite edges must expand canvas bounds without clipping the glow halo, and `emissiveMode: "split"` / `"both"` must produce `_emissive.png` with identical dimensions, anchor, and atlas frame rectangles to the main sprite sheet. (Pinned in Task 3 & Task 4.)

---

## File Structure

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` — project config, scripts, `bin.pixcel` entrypoint.
- `src/core/schema.ts` — Zod schemas & TS types for `.pixcel.json`, `.room.json`, palettes, render options, and `.atlas.json`.
- `src/core/palette.ts` — Palette loader (JSON, `.hex`, Lospec), nearest-color matching, 5-step hue-shifted shade ramps.
- `src/core/voxel-grid.ts` — 3D voxel container, bounds, lossless 90° Z-rotation (`se`/`sw`/`nw`/`ne`), footprint flipping.
- `src/core/dsl-compiler.ts` — Primitive ops compiler (`box`, `hollowBox`, `cylinder`, `slope`, `line`, `voxel`, `mirror`), 2D face decals, animation frames, Phase 2 optional `partTransforms`.
- `src/core/rasterizer.ts` — Exact 2:1 isometric projection (`64×32` @ 32/16 vpt, `32×16`, `64×31`) into single-layer `GBuffer` + ground anchor math.
- `src/core/postprocess.ts` — Directional shading, voxel AO, stylized opaque glass specular, palette ramp mapping, smart 1px outline (`silhouette`/`none`/`top-only` + creases), emissive glow (`baked`/`split`/`both`).
- `src/core/exporters/png.ts` — Pure-JS PNG encode/decode (`pngjs`) + `RGBAImage` buffer helpers.
- `src/core/exporters/atlas.ts` — Sprite sheet packer + TexturePacker JSON Hash `.atlas.json` + synchronized `_emissive.png` packing.
- `src/core/exporters/gif.ts` — Animated GIF encoder (`gifenc`) for frame playback and 4-direction turntables.
- `src/core/exporters/sprite-stack.ts` — Horizontal Z-slice strip PNG exporter.
- `src/core/exporters/obj.ts` — Exposed-face Wavefront `.obj` + `.mtl` exporter.
- `src/core/carver.ts` — PixZels-style 1–6 view orthographic PNG silhouette intersection, color projection, and box-merged `.pixcel.json` emitter.
- `src/core/room-compositor.ts` — Layered `.room.json` renderer + Kahn's topological isometric depth-sorter (`renderRoom`).
- `assets/palettes/office-night.palette.json`, `assets/palettes/office-day.palette.json` — Built-in office palettes.
- `assets/office-starter/*.pixcel.json` (12 assets) & `assets/office-starter/sample-office.room.json` — Complete starter AI Agent Office pack.
- `src/cli/index.ts` — `pixcel` CLI (`validate`, `render`, `carve`, `pack`, `render-room`, `palette`, `preview`, `mcp`).
- `src/mcp/server.ts` — Stdio MCP server with workspace-safe asset/palette/render/room/pack tools and base64 preview images.
- `src/preview/server.ts`, `src/preview/public/{index.html,app.js,style.css}` — Local HTTP + SSE live-reload server and Canvas 2D Asset Inspector + Office Room Sandbox.

---

### Task 1: Project Scaffold, Zod Schemas & Palette System

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/core/schema.ts`
- Create: `src/core/palette.ts`
- Create: `assets/palettes/office-night.palette.json`, `assets/palettes/office-day.palette.json`
- Test: `tests/core/schema-palette.test.ts`

**Interfaces:**
- Produces (`src/core/schema.ts`):
  - `Direction = "se" | "sw" | "nw" | "ne"`
  - `TilePreset = "64x32" | "64x31" | "32x16"`
  - `AssetLayer = "floor" | "wall" | "wall-decor" | "object"`
  - `OutlineMode = "silhouette" | "none" | "top-only"`
  - `MaterialKind = "matte" | "wood" | "metal" | "glass" | "emissive"`
  - `EmissiveMode = "baked" | "split" | "both"`
  - `PixcelAssetSchema`, `PixcelAsset`
  - `RoomLayoutSchema`, `RoomLayout`
  - `PaletteSchema`, `PaletteDefinition`
  - `AtlasSchema`, `AtlasMetadata`
  - `RenderOptionsSchema`, `RenderOptions`
- Produces (`src/core/palette.ts`):
  - `RGBA = [number, number, number, number]`
  - `ShadeRamp = { highlight: RGBA; base: RGBA; shadow: RGBA; deepShadow: RGBA; outline: RGBA }`
  - `parseHexColor(hex: string): RGBA`
  - `loadPalette(nameOrPath: string, searchDirs?: string[]): Promise<PaletteDefinition>`
  - `parseHexListPalette(name: string, content: string): PaletteDefinition`
  - `buildShadeRamp(hex: string, kind: MaterialKind): ShadeRamp`
  - `findNearestPaletteColor(rgb: [number, number, number], palette: PaletteDefinition): { name: string; hex: string; rgba: RGBA }`

- [ ] **Step 1: Initialize git repo and scaffold Node/TypeScript/Vitest config**

Run:
```bash
git -c include.path=/Users/dev3/.gitconfig-iherk init
git -c include.path=/Users/dev3/.gitconfig-iherk config --local include.path /Users/dev3/.gitconfig-iherk
```
Create `package.json` (`"type": "module"`, `"bin": { "pixcel": "./dist/cli/index.js" }`, scripts `build`, `test`, `dev`, dependencies: `zod`, `pngjs`, `gifenc`, `@modelcontextprotocol/sdk`, devDependencies: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/pngjs`), `tsconfig.json` (`ES2022`, `NodeNext`, `strict: true`, `outDir: "dist"`), `vitest.config.ts`, and `.gitignore` (`node_modules/`, `dist/`, `out/`, `.DS_Store`).
Run `export PATH="/opt/homebrew/bin:$PATH" && npm install` and verify exit code 0.

- [ ] **Step 2: Write the failing tests in `tests/core/schema-palette.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { PixcelAssetSchema, RoomLayoutSchema } from "../../src/core/schema.js";
import {
  parseHexColor,
  parseHexListPalette,
  buildShadeRamp,
  findNearestPaletteColor,
  loadPalette,
} from "../../src/core/palette.js";

describe("schema and palette", () => {
  it("validates a minimal asset with Phase 2 parts/partTransforms hooks", () => {
    const parsed = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "desk-test",
      category: "furniture",
      layer: "object",
      outlineMode: "silhouette",
      tilePreset: "64x32",
      voxelsPerTile: 32,
      footprintTiles: [2, 1],
      palette: "office-night",
      materials: { wood: { color: "#4b3121", kind: "wood" } },
      parts: { top: { pivot: [0, 0, 14] } },
      ops: [{ op: "box", from: [0, 0, 0], to: [1, 1, 1], material: "wood", part: "top" }],
      frames: [{ name: "idle_0", durationMs: 500, ops: [], partTransforms: { top: { translate: [0, 0, 0] } } }],
    });
    expect(parsed.footprintTiles).toEqual([2, 1]);
  });

  it("rejects invalid asset IDs containing path traversal", () => {
    expect(() =>
      PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: "../evil",
        materials: { a: { color: "#ffffff", kind: "matte" } },
        ops: [],
      }),
    ).toThrow();
  });

  it("produces luminance-ordered hue-shifted shade ramps (highlight > base > shadow > deepShadow > outline)", () => {
    const ramp = buildShadeRamp("#4b3121", "wood");
    const lum = ([r, g, b]: [number, number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(lum(ramp.highlight)).toBeGreaterThan(lum(ramp.base));
    expect(lum(ramp.base)).toBeGreaterThan(lum(ramp.shadow));
    expect(lum(ramp.shadow)).toBeGreaterThan(lum(ramp.deepShadow));
    expect(lum(ramp.deepShadow)).toBeGreaterThanOrEqual(lum(ramp.outline));
  });

  it("parses .hex / Lospec palettes and matches nearest color", () => {
    const pal = parseHexListPalette("lospec-sample", "#0a0e1a\n38bdf8\n#4b3121\n");
    expect(Object.keys(pal.colors)).toHaveLength(3);
    const match = findNearestPaletteColor([50, 185, 250], pal);
    expect(match.hex.toLowerCase()).toBe("#38bdf8");
  });

  it("loads built-in office-night and office-day palettes and rejects invalid hex", async () => {
    const night = await loadPalette("office-night");
    const day = await loadPalette("office-day");
    expect(Object.keys(night.colors).length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(day.colors).length).toBeGreaterThanOrEqual(12);
    expect(() => parseHexColor("not-a-color")).toThrow();
  });

  it("validates layered room layout schema", () => {
    const room = RoomLayoutSchema.parse({
      schemaVersion: 1,
      id: "test-room",
      tilePreset: "64x32",
      widthTiles: 4,
      depthTiles: 4,
      floors: [{ assetId: "floor-wood-plank", tx: 0, ty: 0 }],
      walls: [{ assetId: "wall-slate-plain", tx: 0, ty: 0, edge: "nw" }],
      wallDecor: [{ assetId: "whiteboard-arch", tx: 1, ty: 0, edge: "nw" }],
      objects: [{ assetId: "desk-dev-dual", tx: 1, ty: 1, direction: "se" }],
    });
    expect(room.objects[0].direction).toBe("se");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/schema-palette.test.ts`
Expected: FAIL (cannot find module `../../src/core/schema.js`).

- [ ] **Step 4: Implement `src/core/schema.ts`, `src/core/palette.ts`, and built-in palettes**

- In `src/core/schema.ts`: define all Zod schemas matching Spec Sections 6.2, 6.5, and 6.6. Enforce `id` regex `/^[a-z0-9][a-z0-9-_]*$/i` (blocks path traversal), non-negative integer coordinates in `ops` (and `from <= to` or normalized), valid `Direction`, `TilePreset`, `OutlineMode`, `AssetLayer`, `MaterialKind`, optional `parts` & `frames[].partTransforms` for Phase 2, plus `RoomLayoutSchema` and `AtlasSchema`.
- In `src/core/palette.ts`: implement `parseHexColor`, `parseHexListPalette` (supports optional `#`, blank lines, `;`/`//` comments), `buildShadeRamp` (slight warm shift on `highlight`, cool indigo shift on `shadow`/`deepShadow`/`outline` for cohesive night-office ramps), `findNearestPaletteColor` (Euclidean RGB distance), and `loadPalette` (resolving built-in `assets/palettes/<name>.palette.json` relative to package root via `import.meta.url` so it works from any `cwd`, plus explicit `.json`/`.hex` file paths).
- Create `assets/palettes/office-night.palette.json` (rich night-office colors matching Spec Section 1: void `#0a0e1a`, warm dark oak wood tones `#4b3121`–`#6b442a`, slate walls `#1e2538`–`#2a334d`, night glass `#13294b`/`#28548a`, dark server metal `#171c26`/`#262b38`, cyan/blue/green/amber/red emissives `#38bdf8`/`#22c55e`/`#f59e0b`/`#ef4444`, whiteboard `#e6e9ef`, plant greens `#2d6a4f`/`#52b788`, book accents) and `assets/palettes/office-day.palette.json`.

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/schema-palette.test.ts`
Expected: PASS (all 6 tests pass).

- [ ] **Step 6: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore docs/ src/core/schema.ts src/core/palette.ts assets/palettes/ tests/core/schema-palette.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: scaffold project, Zod schemas, and palette system"
```

---

### Task 2: VoxelGrid & DSL Compiler (Primitives, Decals, Frames, 90° Rotation)

**Files:**
- Create: `src/core/voxel-grid.ts`
- Create: `src/core/dsl-compiler.ts`
- Test: `tests/core/voxel-dsl.test.ts`

**Interfaces:**
- Consumes: `PixcelAsset`, `Direction` from `src/core/schema.ts`.
- Produces (`src/core/voxel-grid.ts`):
  - `VoxelCell = { material: string; part?: string }`
  - `VoxelBounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }`
  - `class VoxelGrid`:
    - `set(x: number, y: number, z: number, cell: VoxelCell): void`
    - `delete(x: number, y: number, z: number): void`
    - `get(x: number, y: number, z: number): VoxelCell | undefined`
    - `has(x: number, y: number, z: number): boolean`
    - `size: number`
    - `entries(): IterableIterator<[number, number, number, VoxelCell]>`
    - `getBounds(): VoxelBounds | null`
    - `clone(): VoxelGrid`
    - `rotate90CW(steps: 0 | 1 | 2 | 3, footprintVoxelsX: number, footprintVoxelsY: number): { grid: VoxelGrid; footprintVoxelsX: number; footprintVoxelsY: number }`
  - `directionToRotationSteps(dir: Direction): 0 | 1 | 2 | 3` (`se=0`, `sw=1`, `nw=2`, `ne=3`)
  - `rotateFootprintTiles(footprint: [number, number], dir: Direction): [number, number]`
- Produces (`src/core/dsl-compiler.ts`):
  - `CompiledFrame = { name: string; durationMs: number; grid: VoxelGrid }`
  - `compileAsset(asset: PixcelAsset): { baseGrid: VoxelGrid; frames: CompiledFrame[] }`

- [ ] **Step 1: Write the failing tests in `tests/core/voxel-dsl.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { VoxelGrid, rotateFootprintTiles } from "../../src/core/voxel-grid.js";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { PixcelAssetSchema } from "../../src/core/schema.js";

describe("VoxelGrid and DSL compiler", () => {
  it("rotates an asymmetric 2x1 voxel grid 4x90deg CW back to the exact original voxels", () => {
    const g = new VoxelGrid();
    g.set(0, 0, 0, { material: "a" });
    g.set(63, 10, 5, { material: "b" });
    const r1 = g.rotate90CW(1, 64, 32);
    expect([r1.footprintVoxelsX, r1.footprintVoxelsY]).toEqual([32, 64]);
    expect(rotateFootprintTiles([2, 1], "sw")).toEqual([1, 2]);
    const r4 = r1.grid.rotate90CW(3, r1.footprintVoxelsX, r1.footprintVoxelsY);
    expect(r4.grid.get(0, 0, 0)?.material).toBe("a");
    expect(r4.grid.get(63, 10, 5)?.material).toBe("b");
    expect(r4.grid.size).toBe(2);
  });

  it("compiles box, hollowBox, cylinder, slope, line, voxel, mirror, decals, and frame overrides", () => {
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "dsl-primitives",
      footprintTiles: [1, 1],
      voxelsPerTile: 16,
      materials: {
        a: { color: "#4b3121", kind: "wood" },
        b: { color: "#38bdf8", kind: "emissive" },
      },
      ops: [
        { op: "hollowBox", from: [0, 0, 0], to: [3, 3, 3], material: "a", thickness: 1 },
        { op: "voxel", at: [1, 1, 1], material: "b" },
        { op: "line", from: [4, 0, 0], to: [4, 0, 3], material: "a" },
        { op: "cylinder", center: [10, 10], zFrom: 0, zTo: 2, radius: 2, material: "a" },
        { op: "slope", from: [0, 8, 0], to: [3, 10, 3], axis: "+X", material: "a" },
        { op: "mirror", axis: "x", pivot: 8, ops: [{ op: "voxel", at: [2, 14, 0], material: "b" }] },
      ],
      decals: [
        { face: "+X", origin: [3, 1, 2], legend: { ".": null, "x": "b" }, rows: ["xx", ".x"] },
      ],
      frames: [
        { name: "f0", durationMs: 300, ops: [] },
        { name: "f1", durationMs: 300, ops: [{ op: "voxel", at: [0, 0, 3], material: "b" }] },
      ],
    });
    const { baseGrid, frames } = compileAsset(asset);
    expect(baseGrid.has(1, 1, 1)).toBe(true);
    expect(baseGrid.has(2, 2, 2)).toBe(false); // hollow interior
    expect(baseGrid.get(3, 1, 2)?.material).toBe("b"); // decal row 0 col 0
    expect(baseGrid.get(14, 14, 0)?.material).toBe("b"); // mirrored across x=8
    expect(frames).toHaveLength(2);
    expect(frames[0].grid.get(0, 0, 3)?.material).toBe("a");
    expect(frames[1].grid.get(0, 0, 3)?.material).toBe("b");
  });

  it("throws an actionable error when an op or decal references an unknown material", () => {
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "bad-mat",
      materials: { a: { color: "#112233", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [1, 1, 1], material: "missing_mat" }],
    });
    expect(() => compileAsset(asset)).toThrow(/missing_mat/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/voxel-dsl.test.ts`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement `src/core/voxel-grid.ts` and `src/core/dsl-compiler.ts`**

- In `VoxelGrid`: map integer coordinates using deterministic key packing (supporting arbitrary integers while validating non-negative coords during DSL compilation). Exact 90° CW rotation around Z over `[0..fx-1] × [0..fy-1]`: `(x, y, z) ↦ (fy - 1 - y, x, z)` with new footprint `(fy, fx)` (so `+X` front face rotates to `+Y`, i.e., `se → sw`). Repeat `steps` times.
- In `dsl-compiler.ts`: validate every referenced `material` exists in `asset.materials` (or `null` for erase ops). Implement `box`, `hollowBox`, `cylinder`, `slope` (stair-step ramp along `+X`/`-X`/`+Y`/`-Y`), `line` (3D Bresenham), `voxel`, `erase` (`material: null`), and `mirror` (reflects child ops around `pivot`). Apply `decals` onto specified face (`+X`, `-X`, `+Y`, `-Y`, `+Z`, `-Z`) with row 0 at top (`+Z` descending for vertical faces). For `frames`, clone `baseGrid`, apply frame `ops`, and apply optional Phase 2 integer `partTransforms` (`translate`). If `frames` is omitted/empty, emit one default frame `{ name: "default", durationMs: 0, grid: baseGrid }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/voxel-dsl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/core/voxel-grid.ts src/core/dsl-compiler.ts tests/core/voxel-dsl.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add VoxelGrid with lossless 90deg rotation and DSL compiler"
```

---

### Task 3: 2:1 Isometric Software Rasterizer & Pixel-Art Post-Processor

**Files:**
- Create: `src/core/exporters/png.ts` (needed early for `RGBAImage` type & image inspection helpers)
- Create: `src/core/rasterizer.ts`
- Create: `src/core/postprocess.ts`
- Test: `tests/core/rasterizer-postprocess.test.ts`

**Interfaces:**
- Consumes: `VoxelGrid`, `directionToRotationSteps`, `rotateFootprintTiles`, `PixcelAsset`, `PaletteDefinition`, `buildShadeRamp`, `RGBA`, `Direction`, `TilePreset`, `OutlineMode`, `EmissiveMode`.
- Produces (`src/core/exporters/png.ts`):
  - `RGBAImage = { width: number; height: number; data: Uint8ClampedArray }`
  - `createRGBAImage(width: number, height: number): RGBAImage`
  - `encodePNG(image: RGBAImage): Buffer`
  - `decodePNG(buffer: Buffer): RGBAImage`
- Produces (`src/core/rasterizer.ts`):
  - `FaceKind = 0 | 1 | 2 | 3` (`0=none`, `1=top(+Z)`, `2=left(+Y)`, `3=right(+X)`)
  - `TileMetrics = { tileWidth: number; tileHeight: number; stepX: number; stepY: number; tileOverlapY: number }`
  - `getTileMetrics(preset: TilePreset): TileMetrics`
  - `GBuffer`: `{ width, height, offsetX, offsetY, anchorX, anchorY, footprintTiles: [number, number], face: Uint8Array, depth: Int32Array, vx: Int16Array, vy: Int16Array, vz: Int16Array, materialIds: Int16Array, partIds: Int16Array, materialTable: string[], partTable: string[] }`
  - `rasterizeIsometric(grid: VoxelGrid, opts: { tilePreset: TilePreset; voxelsPerTile: 16 | 32; footprintTiles: [number, number]; direction: Direction; anchorMode?: "bottom-diamond" | "center-floor" }): GBuffer`
- Produces (`src/core/postprocess.ts`):
  - `RenderResult = { main: RGBAImage; emissive?: RGBAImage; anchor: { x: number; y: number }; footprintTiles: [number, number]; direction: Direction; tileMetrics: TileMetrics }`
  - `renderAssetFrame(asset: PixcelAsset, grid: VoxelGrid, palette: PaletteDefinition, opts: { direction: Direction; outlineMode?: OutlineMode; interiorCreases?: boolean; emissiveMode?: EmissiveMode; aoStrength?: number; anchorMode?: "bottom-diamond" | "center-floor" }): RenderResult`

- [ ] **Step 1: Write the failing tests in `tests/core/rasterizer-postprocess.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { loadPalette } from "../../src/core/palette.js";
import { PixcelAssetSchema } from "../../src/core/schema.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import { getTileMetrics } from "../../src/core/rasterizer.js";

describe("2:1 isometric rasterizer and post-processor", () => {
  it("tiles a 3x3 grid of 1x1 floors with ZERO gaps and ZERO overlaps in 64x32 (vpt=32, vpt=16) and 32x16", async () => {
    const palette = await loadPalette("office-night");
    for (const [tilePreset, vpt] of [["64x32", 32], ["64x32", 16], ["32x16", 16]] as const) {
      const asset = PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: `floor-${tilePreset}-${vpt}`,
        layer: "floor",
        outlineMode: "none",
        tilePreset,
        voxelsPerTile: vpt,
        footprintTiles: [1, 1],
        materials: { wood: { color: "#4b3121", kind: "wood" } },
        ops: [{ op: "box", from: [0, 0, 0], to: [vpt - 1, vpt - 1, 0], material: "wood" }],
      });
      const { baseGrid } = compileAsset(asset);
      const rendered = renderAssetFrame(asset, baseGrid, palette, { direction: "se" });
      const { stepX, stepY } = getTileMetrics(tilePreset);

      // Composite 3x3 grid and count hits per pixel inside center tile (tx=1, ty=1)
      const hitCounts = new Map<string, number>();
      for (let tx = 0; tx < 3; tx++) {
        for (let ty = 0; ty < 3; ty++) {
          const originX = (tx - ty) * stepX + 200;
          const originY = (tx + ty) * stepY + 200;
          for (let py = 0; py < rendered.main.height; py++) {
            for (let px = 0; px < rendered.main.width; px++) {
              const a = rendered.main.data[(py * rendered.main.width + px) * 4 + 3];
              if (a > 0) {
                const gx = originX + px - rendered.anchor.x;
                const gy = originY + py - rendered.anchor.y;
                const key = `${gx},${gy}`;
                hitCounts.set(key, (hitCounts.get(key) ?? 0) + 1);
              }
            }
          }
        }
      }
      // Zero overlaps anywhere across the 3x3 grid
      for (const count of hitCounts.values()) expect(count).toBe(1);
      // Total covered pixels must equal 9 * single-tile opaque pixels (zero gaps)
      let tileOpaque = 0;
      for (let i = 3; i < rendered.main.data.length; i += 4) if (rendered.main.data[i] > 0) tileOpaque++;
      expect(hitCounts.size).toBe(9 * tileOpaque);
    }
  });

  it("tiles 64x31 (Tiled tight-lock) at stepY=15 with zero gaps and documented tileOverlapY=1", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "floor-64x31",
      layer: "floor",
      outlineMode: "none",
      tilePreset: "64x31",
      voxelsPerTile: 32,
      footprintTiles: [1, 1],
      materials: { wood: { color: "#4b3121", kind: "wood" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [31, 31, 0], material: "wood" }],
    });
    const { baseGrid } = compileAsset(asset);
    const rendered = renderAssetFrame(asset, baseGrid, palette, { direction: "se" });
    expect(rendered.tileMetrics.tileHeight).toBe(31);
    expect(rendered.tileMetrics.stepY).toBe(15);
    expect(rendered.tileMetrics.tileOverlapY).toBe(1);
    expect(rendered.main.height).toBe(31);
  });

  it("flips footprintTiles and preserves ground anchor alignment with 1px outline and edge emissive glow", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "desk-anchor-test",
      outlineMode: "silhouette",
      tilePreset: "64x32",
      voxelsPerTile: 16,
      footprintTiles: [2, 1],
      materials: {
        wood: { color: "#4b3121", kind: "wood" },
        glow: { color: "#38bdf8", kind: "emissive", glowRadius: 3, glowIntensity: 0.5 },
      },
      ops: [
        { op: "box", from: [0, 0, 0], to: [31, 15, 4], material: "wood" },
        { op: "box", from: [28, 0, 5], to: [31, 3, 8], material: "glow" },
      ],
    });
    const { baseGrid } = compileAsset(asset);
    const se = renderAssetFrame(asset, baseGrid, palette, { direction: "se", emissiveMode: "both" });
    const sw = renderAssetFrame(asset, baseGrid, palette, { direction: "sw", emissiveMode: "both" });
    expect(se.footprintTiles).toEqual([2, 1]);
    expect(sw.footprintTiles).toEqual([1, 2]);
    expect(se.emissive?.width).toBe(se.main.width);
    expect(se.emissive?.height).toBe(se.main.height);
    // Anchor must remain strictly inside padded canvas bounds
    expect(se.anchor.x).toBeGreaterThanOrEqual(0);
    expect(se.anchor.x).toBeLessThan(se.main.width);
    expect(se.anchor.y).toBeGreaterThanOrEqual(0);
    expect(se.anchor.y).toBeLessThan(se.main.height);
    // Deterministic byte identity
    const se2 = renderAssetFrame(asset, baseGrid, palette, { direction: "se", emissiveMode: "both" });
    expect(Buffer.from(se.main.data)).toEqual(Buffer.from(se2.main.data));
  });

  it("shades top > left > right, keeps glass 100% palette-quantized, and separates emissive un-darkened", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "cube-shading",
      outlineMode: "silhouette",
      tilePreset: "64x32",
      voxelsPerTile: 16,
      footprintTiles: [1, 1],
      materials: {
        wall: { color: "#2a334d", kind: "matte" },
        glass: { color: "#13294b", kind: "glass" },
        led: { color: "#38bdf8", kind: "emissive", glowRadius: 1, glowIntensity: 0.4 },
      },
      ops: [
        { op: "box", from: [4, 4, 0], to: [11, 11, 7], material: "wall" },
        { op: "box", from: [6, 11, 2], to: [9, 11, 5], material: "glass" },
        { op: "voxel", at: [11, 7, 4], material: "led" },
      ],
    });
    const { baseGrid } = compileAsset(asset);
    const res = renderAssetFrame(asset, baseGrid, palette, { direction: "se", emissiveMode: "split" });
    expect(res.emissive).toBeDefined();
    let emissivePixels = 0;
    for (let i = 3; i < res.emissive!.data.length; i += 4) if (res.emissive!.data[i] > 0) emissivePixels++;
    expect(emissivePixels).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/rasterizer-postprocess.test.ts`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement `src/core/exporters/png.ts`, `src/core/rasterizer.ts`, and `src/core/postprocess.ts`**

- In `src/core/exporters/png.ts`: wrap `pngjs` (`PNG.sync.write`, `PNG.sync.read`) into `createRGBAImage`, `encodePNG`, `decodePNG`.
- In `src/core/rasterizer.ts`:
  - Rotate input grid via `grid.rotate90CW(directionToRotationSteps(direction), fx * vpt, fy * vpt)`.
  - Implement exact 2:1 projection from Spec Section 6.1:
    - `64x32` @ `vpt=32` and `32x16` @ `vpt=16`: `sx = x - y`, `sy = Math.floor((x + y) / 2) - z`, 1px top write; vertical extrusion covers exposed `+X`/`+Y` side pixels cleanly with zero pinholes (check neighbor `(x,y,z+1)` for `top`, `(x+1,y,z)` for `right`, `(x,y+1,z)` for `left`).
    - `64x32` @ `vpt=16`: `sx = (x - y) * 2`, `sy = (x + y) - z * 2`, 2px horizontal top span `(sx, sy)` and `(sx + 1, sy)`, plus 2px vertical side face drop.
    - `64x31` @ `vpt=32`: same projection, clamping bottom row of `z=0` floor tip to height `31` (`stepY = 15, tileOverlapY = 1`).
  - Back-to-front painter's order (`x + y` ascending, then `z` ascending) with exact per-pixel depth buffer storing `(x + y) * 1024 + z`.
  - Compute exact ground `anchorX`, `anchorY` for `(fx * vpt - 1, fy * vpt - 1, 0)` (or centered for `"center-floor"`).
- In `src/core/postprocess.ts`:
  - Reserve exact padding around the G-Buffer (`pad = max(outlinePad, maxGlowRadius)` — `0` when `outlineMode === "none"` and no emissive materials, so modular `1×1` floor tiles keep exact `64×32` / `64×31` / `32×16` dimensions!), shifting `anchor` by `(+pad, +pad)` so anchor never drifts!
  - Apply directional face shading (`top -> highlight`, `left -> base`, `right -> shadow`, `emissive -> base` full luminance), voxel AO (check adjacent neighbors on face tangent plane; occluding concave neighbors step down 1 shade), stylized opaque `glass` (1px diagonal specular stripe `(vx + vy + vz) % 5 === 0` shifted to `highlight` ramp), smart 1px outline honoring `outlineMode` (`"silhouette"`, `"none"`, `"top-only"`), optional interior creases on depth jump `>= 3` or part change, and radial emissive glow pass (`"baked"`, `"split"`, `"both"`).

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/rasterizer-postprocess.test.ts`
Expected: PASS (all 4 test suites pass).

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/core/exporters/png.ts src/core/rasterizer.ts src/core/postprocess.ts tests/core/rasterizer-postprocess.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: implement 2:1 isometric G-buffer rasterizer and pixel-art post-processor"
```

---

### Task 4: Exporters (TexturePacker Atlas, GIF, Sprite Stack, OBJ+MTL)

**Files:**
- Create: `src/core/exporters/atlas.ts`
- Create: `src/core/exporters/gif.ts`
- Create: `src/core/exporters/sprite-stack.ts`
- Create: `src/core/exporters/obj.ts`
- Test: `tests/core/exporters.test.ts`

**Interfaces:**
- Consumes: `RGBAImage`, `createRGBAImage`, `encodePNG`, `decodePNG`, `VoxelGrid`, `PixcelAsset`, `AtlasMetadata`, `Direction`, `AssetLayer`, `TileMetrics`.
- Produces:
  - `src/core/exporters/atlas.ts`:
    - `AtlasInputSprite = { key: string; assetId: string; direction: Direction; frameName: string; durationMs: number; layer: AssetLayer; footprintTiles: [number, number]; anchor: { x: number; y: number }; image: RGBAImage; emissive?: RGBAImage }`
    - `packSpriteAtlas(sprites: AtlasInputSprite[], opts: { imageName: string; emissiveImageName?: string; tilePreset: TilePreset; padding?: number }): { sheet: RGBAImage; emissiveSheet?: RGBAImage; atlas: AtlasMetadata }`
  - `src/core/exporters/gif.ts`:
    - `encodeAnimatedGIF(frames: { image: RGBAImage; durationMs: number }[]): Buffer`
  - `src/core/exporters/sprite-stack.ts`:
    - `exportSpriteStack(grid: VoxelGrid, asset: PixcelAsset): RGBAImage`
  - `src/core/exporters/obj.ts`:
    - `exportObjMtl(grid: VoxelGrid, asset: PixcelAsset, mtlFilename: string): { obj: string; mtl: string }`

- [ ] **Step 1: Write the failing tests in `tests/core/exporters.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { loadPalette } from "../../src/core/palette.js";
import { PixcelAssetSchema, AtlasSchema } from "../../src/core/schema.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import { encodePNG, decodePNG } from "../../src/core/exporters/png.js";
import { packSpriteAtlas } from "../../src/core/exporters/atlas.js";
import { encodeAnimatedGIF } from "../../src/core/exporters/gif.js";
import { exportSpriteStack } from "../../src/core/exporters/sprite-stack.js";
import { exportObjMtl } from "../../src/core/exporters/obj.js";

describe("exporters", () => {
  it("packs TexturePacker JSON Hash atlas with matching emissive sheet rects and pivots", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "server-mini",
      footprintTiles: [1, 1],
      voxelsPerTile: 16,
      materials: {
        body: { color: "#171c26", kind: "metal" },
        led: { color: "#22c55e", kind: "emissive", glowRadius: 1, glowIntensity: 0.4 },
      },
      ops: [
        { op: "box", from: [2, 2, 0], to: [13, 13, 10], material: "body" },
        { op: "voxel", at: [13, 5, 8], material: "led" },
      ],
      frames: [
        { name: "f0", durationMs: 400, ops: [] },
        { name: "f1", durationMs: 400, ops: [{ op: "voxel", at: [13, 9, 8], material: "led" }] },
      ],
    });
    const { frames } = compileAsset(asset);
    const sprites = frames.map((f) => {
      const r = renderAssetFrame(asset, f.grid, palette, { direction: "se", emissiveMode: "both" });
      return {
        key: `${asset.id}/se/${f.name}`,
        assetId: asset.id,
        direction: "se" as const,
        frameName: f.name,
        durationMs: f.durationMs,
        layer: asset.layer,
        footprintTiles: r.footprintTiles,
        anchor: r.anchor,
        image: r.main,
        emissive: r.emissive,
      };
    });

    const packed = packSpriteAtlas(sprites, {
      imageName: "atlas.png",
      emissiveImageName: "atlas_emissive.png",
      tilePreset: "64x32",
    });
    const parsedAtlas = AtlasSchema.parse(packed.atlas);
    expect(parsedAtlas.meta.image).toBe("atlas.png");
    expect(parsedAtlas.meta.emissiveImage).toBe("atlas_emissive.png");
    expect(packed.emissiveSheet?.width).toBe(packed.sheet.width);
    expect(packed.emissiveSheet?.height).toBe(packed.sheet.height);
    const decoded = decodePNG(encodePNG(packed.sheet));
    expect(decoded.width).toBe(packed.sheet.width);

    const gif = encodeAnimatedGIF(sprites.map((s) => ({ image: s.image, durationMs: s.durationMs })));
    expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");

    const stack = exportSpriteStack(frames[0].grid, asset);
    expect(stack.width).toBeGreaterThan(0);
    expect(stack.height).toBeGreaterThan(0);

    const { obj, mtl } = exportObjMtl(frames[0].grid, asset, "server-mini.mtl");
    expect(obj).toContain("mtllib server-mini.mtl");
    expect(obj).toContain("usemtl body");
    expect(mtl).toContain("newmtl led");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/exporters.test.ts`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement `atlas.ts`, `gif.ts`, `sprite-stack.ts`, and `obj.ts`**

- `atlas.ts`: Shelf bin-packing (deterministic sort by height desc then key asc), blitting every sprite to `sheet` and (if any sprite has `emissive`) to an identical-size `emissiveSheet` at the exact same `(x, y)` rect. Populate TexturePacker JSON Hash `frames` (`frame`, `sourceSize`, `spriteSourceSize`, `pivot: { x: anchor.x / w, y: anchor.y / h }`, `isometric`) and `meta` (`app: "iherk-pixcel"`, `tilePreset`, `stepX`, `stepY`, `tileOverlapY`).
- `gif.ts`: Normalize frames to common canvas size anchored on bottom-center, quantize each frame with `gifenc` (`quantize` + `applyPalette` with transparency index 0), write `GIF89a` with per-frame delay.
- `sprite-stack.ts`: Export horizontal Z-slice strip (`width = sliceW * layersZ`, `height = sliceH`) bottom-to-top.
- `obj.ts`: Emit only exposed quad faces (neighbor cell absent) grouped by `usemtl <material>` with matching `.mtl` (`Kd` normalized RGB, `Ke` for `emissive`).

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/exporters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/core/exporters/ tests/core/exporters.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add TexturePacker atlas, GIF, sprite-stack, and OBJ+MTL exporters"
```

---

### Task 5: 2D-to-3D Orthographic Carver (PixZels-Style)

**Files:**
- Create: `src/core/carver.ts`
- Test: `tests/core/carver.test.ts`

**Interfaces:**
- Consumes: `RGBAImage`, `PaletteDefinition`, `findNearestPaletteColor`, `PixcelAsset`, `PixcelAssetSchema`, `VoxelGrid`.
- Produces (`src/core/carver.ts`):
  - `OrthographicViews = { front?: RGBAImage; side?: RGBAImage; top?: RGBAImage; back?: RGBAImage; left?: RGBAImage; bottom?: RGBAImage }`
  - `CarveOptions = { id: string; palette: PaletteDefinition; depth?: number; tilePreset?: TilePreset; voxelsPerTile?: 16 | 32; alphaThreshold?: number }`
  - `carveFromOrthographicViews(views: OrthographicViews, opts: CarveOptions): PixcelAsset`

- [ ] **Step 1: Write the failing tests in `tests/core/carver.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createRGBAImage } from "../../src/core/exporters/png.js";
import { loadPalette } from "../../src/core/palette.js";
import { carveFromOrthographicViews } from "../../src/core/carver.js";
import { compileAsset } from "../../src/core/dsl-compiler.js";

function paintRect(img: ReturnType<typeof createRGBAImage>, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = rgba[0]; img.data[i + 1] = rgba[1]; img.data[i + 2] = rgba[2]; img.data[i + 3] = rgba[3];
    }
  }
}

describe("2D-to-3D orthographic carver", () => {
  it("carves an L-shaped 3D model from front + side + top PNG views and box-merges into compact ops", async () => {
    const palette = await loadPalette("office-night");
    const front = createRGBAImage(8, 8);
    const side = createRGBAImage(8, 8);
    const top = createRGBAImage(8, 8);
    // L-shape in top view: full width for y=0..3, left half only for y=4..7
    paintRect(front, 0, 0, 7, 7, [75, 49, 33, 255]);
    paintRect(side, 0, 0, 7, 7, [75, 49, 33, 255]);
    paintRect(top, 0, 0, 7, 3, [75, 49, 33, 255]);
    paintRect(top, 0, 4, 3, 7, [56, 189, 248, 255]);

    const asset = carveFromOrthographicViews({ front, side, top }, { id: "carved-l", palette, voxelsPerTile: 16 });
    const { baseGrid } = compileAsset(asset);
    expect(baseGrid.has(6, 1, 4)).toBe(true);
    expect(baseGrid.has(6, 6, 4)).toBe(false); // carved away by top view
    expect(baseGrid.has(1, 6, 4)).toBe(true);
    expect(asset.ops.length).toBeLessThan(baseGrid.size); // box-merged, not 1 op per voxel
  });

  it("supports 1-view extrusion with configurable depth and rejects empty/mismatched views", async () => {
    const palette = await loadPalette("office-night");
    const front = createRGBAImage(4, 4);
    paintRect(front, 1, 1, 2, 2, [56, 189, 248, 255]);
    const extruded = carveFromOrthographicViews({ front }, { id: "sign-extruded", palette, depth: 3 });
    const { baseGrid } = compileAsset(extruded);
    expect(baseGrid.size).toBe(2 * 2 * 3);

    const empty = createRGBAImage(4, 4);
    expect(() => carveFromOrthographicViews({ front: empty }, { id: "empty", palette })).toThrow(/opaque/i);

    const badSide = createRGBAImage(4, 10); // height mismatch with front height 4
    expect(() => carveFromOrthographicViews({ front, side: badSide }, { id: "bad", palette })).toThrow(/dimension|height/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/carver.test.ts`
Expected: FAIL (missing `src/core/carver.ts`).

- [ ] **Step 3: Implement `src/core/carver.ts`**

- Validate at least one view is provided and that shared axes match across views (`front.height === side.height`, `front.width === top.width`, `side.width === top.height`, plus opposing view pairs `back`/`left`/`bottom`). Reject all-transparent results with a clear error.
- Intersect views into a `VoxelGrid`: voxel `(x, y, z)` (with `z=0` at bottom of `front`/`side`) survives iff every supplied view has `alpha >= alphaThreshold` (default `128`) at its projected pixel. For 1-view `front`-only mode, extrude along `y ∈ [0..depth-1]` (default `4`).
- Sample surface color from nearest visible view (`top` if `z+1` empty, `front` if `y+1` empty, `side` if `x+1` empty, fallback to nearest opaque view), quantize to `palette` via `findNearestPaletteColor`, and run greedy 3D box-merging (scan unvisited voxels, expand maximal `X`, then `Y`, then `Z` matching material) to emit compact `box` ops into a valid `PixcelAsset`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/carver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/core/carver.ts tests/core/carver.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add 2D-to-3D orthographic silhouette carver with box-merging"
```

---

### Task 6: Topological Isometric Room Compositor (`renderRoom`)

**Files:**
- Create: `src/core/room-compositor.ts`
- Test: `tests/core/room-compositor.test.ts`

**Interfaces:**
- Consumes: `RoomLayout`, `PixcelAsset`, `PaletteDefinition`, `compileAsset`, `renderAssetFrame`, `RGBAImage`, `createRGBAImage`, `getTileMetrics`.
- Produces (`src/core/room-compositor.ts`):
  - `RoomRenderItem = { id: string; tx: number; ty: number; footprintX: number; footprintY: number }`
  - `sortIsometricObjects<T extends RoomRenderItem>(items: T[]): T[]`
  - `renderRoom(room: RoomLayout, assetsById: Map<string, PixcelAsset>, palette: PaletteDefinition, opts?: { frameIndex?: number; background?: string; emissiveMode?: EmissiveMode }): { main: RGBAImage; emissive?: RGBAImage; width: number; height: number }`

- [ ] **Step 1: Write the failing tests in `tests/core/room-compositor.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { sortIsometricObjects, renderRoom } from "../../src/core/room-compositor.js";
import { PixcelAssetSchema, RoomLayoutSchema } from "../../src/core/schema.js";
import { loadPalette } from "../../src/core/palette.js";

describe("topological isometric room compositor", () => {
  it("sorts a 1x1 chair behind, beside, and in front of a 2x1 desk accurately", () => {
    const ordered = sortIsometricObjects([
      { id: "chair-front", tx: 1, ty: 2, footprintX: 1, footprintY: 1 },
      { id: "desk", tx: 1, ty: 1, footprintX: 2, footprintY: 1 },
      { id: "chair-back", tx: 2, ty: 0, footprintX: 1, footprintY: 1 },
    ]);
    expect(ordered.map((o) => o.id)).toEqual(["chair-back", "desk", "chair-front"]);
  });

  it("handles overlapping/cyclic footprints deterministically without infinite loops or dropped items", () => {
    const items = [
      { id: "a", tx: 1, ty: 1, footprintX: 2, footprintY: 2 },
      { id: "b", tx: 2, ty: 2, footprintX: 2, footprintY: 2 },
      { id: "c", tx: 1, ty: 2, footprintX: 2, footprintY: 1 },
    ];
    const ordered = sortIsometricObjects(items);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered.map((i) => i.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("composites floor, edge wall, wall-decor, and rotated multi-tile object cleanly", async () => {
    const palette = await loadPalette("office-night");
    const floor = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "floor", layer: "floor", outlineMode: "none", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { w: { color: "#4b3121", kind: "wood" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [15, 15, 0], material: "w" }],
    });
    const wall = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "wall", layer: "wall", outlineMode: "top-only", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { s: { color: "#2a334d", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [15, 1, 23], material: "s" }],
    });
    const desk = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "desk", layer: "object", outlineMode: "silhouette", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [2, 1],
      materials: { d: { color: "#6b442a", kind: "wood" } },
      ops: [{ op: "box", from: [1, 1, 0], to: [30, 14, 7], material: "d" }],
    });
    const room = RoomLayoutSchema.parse({
      schemaVersion: 1, id: "mini", tilePreset: "64x32", widthTiles: 3, depthTiles: 3,
      floors: [
        { assetId: "floor", tx: 0, ty: 0 }, { assetId: "floor", tx: 1, ty: 0 },
        { assetId: "floor", tx: 0, ty: 1 }, { assetId: "floor", tx: 1, ty: 1 },
      ],
      walls: [{ assetId: "wall", tx: 0, ty: 0, edge: "nw" }],
      wallDecor: [],
      objects: [{ assetId: "desk", tx: 0, ty: 0, direction: "sw" }],
    });
    const res = renderRoom(room, new Map([["floor", floor], ["wall", wall], ["desk", desk]]), palette);
    expect(res.width).toBeGreaterThan(100);
    expect(res.height).toBeGreaterThan(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/room-compositor.test.ts`
Expected: FAIL (missing `src/core/room-compositor.ts`).

- [ ] **Step 3: Implement `src/core/room-compositor.ts`**

- Implement `sortIsometricObjects`: build directed occlusion edges (`A -> B` means A draws before B) when `A` and `B` overlap in isometric screen X range AND (`ax1 <= bx0` or `ay1 <= by0`). Run Kahn's topological sort using a min-key tie-breaker (`(tx + footprintX + ty + footprintY)`, then `tx`, then `id`); if a cycle remains from overlapping footprints, pick the remaining node with smallest depth key and continue until all nodes are emitted.
- In `renderRoom`: render and cache each `(assetId, direction, frameIndex)` sprite; place layers in order: `floors` (by `tx + ty`) → `walls` + `wallDecor` (by `tx + ty`, with `wallDecor` immediately after walls on the same `(tx, ty, edge)`) → `objects` (via `sortIsometricObjects`). Compute bounding canvas from all positioned sprites (anchoring each multi-tile object at its bottom-diamond tile coordinate `(tx + footprintX - 1, ty + footprintY - 1)` mapped via `(stepX, stepY)`), fill background (`#0a0e1a` default or transparent), and alpha-composite all sprites cleanly.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/core/room-compositor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/core/room-compositor.ts tests/core/room-compositor.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add layered isometric room compositor with topological depth sorting"
```

---

### Task 7: Starter AI Agent Office Pack (12 Assets + Sample Room)

**Files:**
- Create: `assets/office-starter/floor-wood-plank.pixcel.json`
- Create: `assets/office-starter/wall-slate-plain.pixcel.json`
- Create: `assets/office-starter/wall-night-window.pixcel.json`
- Create: `assets/office-starter/wall-corner-pillar.pixcel.json`
- Create: `assets/office-starter/desk-dev-dual.pixcel.json`
- Create: `assets/office-starter/desk-security-ops.pixcel.json`
- Create: `assets/office-starter/chair-office-swivel.pixcel.json`
- Create: `assets/office-starter/server-rack.pixcel.json`
- Create: `assets/office-starter/whiteboard-arch.pixcel.json`
- Create: `assets/office-starter/table-conference.pixcel.json`
- Create: `assets/office-starter/plant-potted.pixcel.json`
- Create: `assets/office-starter/bookshelf-wood.pixcel.json`
- Create: `assets/office-starter/sample-office.room.json`
- Test: `tests/assets/office-starter.test.ts`

**Interfaces:**
- Consumes: `PixcelAssetSchema`, `RoomLayoutSchema`, `loadPalette`, `compileAsset`, `renderAssetFrame`, `renderRoom`.
- Produces: 12 validated starter `.pixcel.json` assets and `sample-office.room.json` matching the visual conventions in Spec Sections 1 & 6.9.

- [ ] **Step 1: Write the failing tests in `tests/assets/office-starter.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { PixcelAssetSchema, RoomLayoutSchema, type Direction } from "../../src/core/schema.js";
import { loadPalette } from "../../src/core/palette.js";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import { renderRoom } from "../../src/core/room-compositor.js";

const EXPECTED_ASSETS = [
  "floor-wood-plank",
  "wall-slate-plain",
  "wall-night-window",
  "wall-corner-pillar",
  "desk-dev-dual",
  "desk-security-ops",
  "chair-office-swivel",
  "server-rack",
  "whiteboard-arch",
  "table-conference",
  "plant-potted",
  "bookshelf-wood",
];

describe("AI Agent Office starter pack", () => {
  it("validates and renders all 12 starter assets across 4 directions and all frames", async () => {
    const dir = path.resolve("assets/office-starter");
    const palette = await loadPalette("office-night");
    const assetsMap = new Map();

    for (const id of EXPECTED_ASSETS) {
      const raw = JSON.parse(await fs.readFile(path.join(dir, `${id}.pixcel.json`), "utf8"));
      const asset = PixcelAssetSchema.parse(raw);
      expect(asset.id).toBe(id);
      assetsMap.set(id, asset);

      const { frames } = compileAsset(asset);
      expect(frames.length).toBeGreaterThanOrEqual(1);
      for (const direction of ["se", "sw", "nw", "ne"] as Direction[]) {
        const res = renderAssetFrame(asset, frames[0].grid, palette, { direction, emissiveMode: "baked" });
        expect(res.main.width).toBeGreaterThan(0);
        expect(res.main.height).toBeGreaterThan(0);
      }
    }

    const roomRaw = JSON.parse(await fs.readFile(path.join(dir, "sample-office.room.json"), "utf8"));
    const room = RoomLayoutSchema.parse(roomRaw);
    const renderedRoom = renderRoom(room, assetsMap, palette, { emissiveMode: "baked" });
    expect(renderedRoom.width).toBeGreaterThan(300);
    expect(renderedRoom.height).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/assets/office-starter.test.ts`
Expected: FAIL (`ENOENT` on starter JSON files).

- [ ] **Step 3: Author the 12 starter `.pixcel.json` assets and `sample-office.room.json`**

Author crisp, detailed `voxelsPerTile: 32` (`64×32` tile preset) models using `office-night` colors and Spec Sections 1 & 6.9 conventions:
- `floor-wood-plank` (`1×1`, `layer: "floor"`, `outlineMode: "none"`, warm dark oak planks with subtle plank variation)
- `wall-slate-plain` (`1×1`, `layer: "wall"`, `outlineMode: "top-only"`, `48` voxels tall × `4` thick, baseboard + top trim)
- `wall-night-window` (`1×1`, `layer: "wall"`, `outlineMode: "top-only"`, dark night-blue `glass` panes with crisp window mullions)
- `wall-corner-pillar` (`1×1`, `layer: "wall"`, `outlineMode: "top-only"`, seamless `4×4×48` corner joiner)
- `desk-dev-dual` (`2×1`, dark wood top, steel frame, dual angled/side-by-side glowing cyan/blue code monitors with ASCII code decals, keyboard, mouse, coffee mug, 2 animation frames)
- `desk-security-ops` (`2×1`, security dashboard monitor + red/amber alert panel decal, 2-frame alert pulse)
- `chair-office-swivel` (`1×1`, caster base, seat cushion, curved ergonomic backrest, armrests)
- `server-rack` (`1×1`, tall dark matte-metal rack with front vent slots and 3-frame blinking cyan/green/amber LEDs)
- `whiteboard-arch` (`2×1`, `layer: "wall-decor"`, framed white panel with colored box-and-arrow architecture decal)
- `table-conference` (`2×2`, wooden meeting table with 2 open glowing laptops and coffee mugs)
- `plant-potted` (`1×1`, ceramic pot, dark soil, layered green foliage clusters)
- `bookshelf-wood` (`1×1`, wooden shelves packed with varied colored book spines)
- `sample-office.room.json`: `7×7` isometric office diorama assembling wooden floor, NW/NE slate & night-window walls, rear corner pillar, server rack in back corner, architecture whiteboard on NW wall, dev desk + security desk + swivel chairs, conference table with chairs, bookshelf, and potted plants.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/assets/office-starter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add assets/office-starter/ tests/assets/office-starter.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add 12 starter AI Agent Office assets and sample room layout"
```

---

### Task 8: CLI (`pixcel`) & Stdio MCP Server (`pixcel mcp`)

**Files:**
- Create: `src/core/workspace.ts` (safe workspace-scoped path resolution, asset/palette discovery)
- Create: `src/cli/index.ts`
- Create: `src/mcp/server.ts`
- Test: `tests/mcp/mcp-cli.test.ts`

**Interfaces:**
- Consumes: all `src/core/*` modules + `startPreviewServer` (from Task 9, dynamically imported in `preview` command).
- Produces (`src/core/workspace.ts`):
  - `resolveSafeWorkspacePath(rootDir: string, relPath: string): string` (throws on path traversal escaping `rootDir`)
  - `listAssetFiles(rootDir: string): Promise<{ id: string; path: string }[]>`
  - `loadAssetByIdOrPath(rootDir: string, idOrPath: string): Promise<{ asset: PixcelAsset; filePath: string }>`
- Produces (`src/cli/index.ts`):
  - Commands: `validate <asset>`, `render <asset> [--out dir] [--directions se,sw,nw,ne] [--format png|atlas|gif|stack|obj] [--emissive baked|split|both]`, `carve --front p.png [--side p.png] [--top p.png] --id name --out file.pixcel.json`, `pack <dir-or-files...> --out dir`, `render-room <room.json> --out room.png`, `palette list|show <name>`, `preview [--port 4173]`, `mcp`.
- Produces (`src/mcp/server.ts`):
  - `createPixcelMcpServer(rootDir: string): McpServer`
  - `startMcpServer(rootDir: string): Promise<void>`
  - MCP tools: `list_palettes`, `get_palette`, `list_assets`, `read_asset`, `create_asset`, `update_asset`, `carve_from_views`, `render_asset`, `render_room`, `pack_atlas`.

- [ ] **Step 1: Write the failing tests in `tests/mcp/mcp-cli.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

describe("CLI and Stdio MCP server", () => {
  it("runs CLI render and render-room end-to-end producing valid PNGs and TexturePacker atlas", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-cli-"));
    const tsxBin = path.resolve("node_modules/.bin/tsx");
    const cliEntry = path.resolve("src/cli/index.ts");

    await execFileAsync(tsxBin, [cliEntry, "validate", "assets/office-starter/desk-dev-dual.pixcel.json"]);
    await execFileAsync(tsxBin, [
      cliEntry, "render", "assets/office-starter/desk-dev-dual.pixcel.json",
      "--out", tmpDir, "--format", "atlas", "--emissive", "both",
    ]);
    const atlasJson = JSON.parse(await fs.readFile(path.join(tmpDir, "desk-dev-dual.atlas.json"), "utf8"));
    expect(Object.keys(atlasJson.frames).length).toBeGreaterThanOrEqual(4);

    const roomOut = path.join(tmpDir, "office.png");
    await execFileAsync(tsxBin, [cliEntry, "render-room", "assets/office-starter/sample-office.room.json", "--out", roomOut]);
    const roomStat = await fs.stat(roomOut);
    expect(roomStat.size).toBeGreaterThan(1000);
  }, 30000);

  it("spawns pixcel mcp over stdio, creates & renders an asset with base64 PNG, and rejects path traversal", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-mcp-"));
    const transport = new StdioClientTransport({
      command: path.resolve("node_modules/.bin/tsx"),
      args: [path.resolve("src/cli/index.ts"), "mcp", "--root", tmpDir],
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "list_palettes", "list_assets", "create_asset", "render_asset", "render_room", "pack_atlas", "carve_from_views",
    ]));

    const created = await client.callTool({
      name: "create_asset",
      arguments: {
        asset: {
          schemaVersion: 1,
          id: "mcp-cube",
          footprintTiles: [1, 1],
          voxelsPerTile: 16,
          materials: { c: { color: "#38bdf8", kind: "emissive" } },
          ops: [{ op: "box", from: [4, 4, 0], to: [11, 11, 7], material: "c" }],
        },
      },
    });
    expect(created.isError).toBeFalsy();

    const rendered = await client.callTool({
      name: "render_asset",
      arguments: { id: "mcp-cube", includePreviewImage: true },
    });
    expect(rendered.isError).toBeFalsy();
    const hasImage = (rendered.content as Array<{ type: string }>).some((c) => c.type === "image");
    expect(hasImage).toBe(true);

    // Path traversal must be rejected cleanly
    const bad = await client.callTool({ name: "read_asset", arguments: { id: "../../etc/passwd" } });
    expect(bad.isError).toBe(true);

    await client.close();
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/mcp/mcp-cli.test.ts`
Expected: FAIL (missing `src/cli/index.ts` and `src/mcp/server.ts`).

- [ ] **Step 3: Implement `src/core/workspace.ts`, `src/mcp/server.ts`, and `src/cli/index.ts`**

- In `src/core/workspace.ts`: strictly enforce `path.resolve(rootDir, relPath)` stays inside `path.resolve(rootDir)` (preventing `../` traversal). Discover assets in both `<rootDir>/assets/` and the package's built-in `assets/office-starter/` (with workspace assets taking precedence).
- In `src/mcp/server.ts`: implement all 10 tools using `@modelcontextprotocol/sdk/server/mcp.js` (`McpServer` + `StdioServerTransport`). Never write non-JSON logs to `stdout` (use `stderr`). In `render_asset`, when `includePreviewImage` is true (default true), composite a clean 4-direction contact sheet PNG and return it as `{ type: "image", data: base64, mimeType: "image/png" }` alongside text metadata! Catch validation/path errors cleanly and return `{ isError: true, content: [{ type: "text", text: message }] }`.
- In `src/cli/index.ts`: add `#!/usr/bin/env node` shebang, parse args cleanly with Node's `util.parseArgs`, wire all subcommands (`validate`, `render`, `carve`, `pack`, `render-room`, `palette`, `preview`, `mcp`).

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/mcp/mcp-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/core/workspace.ts src/cli/index.ts src/mcp/server.ts tests/mcp/mcp-cli.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add pixcel CLI and Stdio MCP server"
```

---

### Task 9: Local Web Preview & Isometric Office Room Sandbox (`pixcel preview`)

**Files:**
- Create: `src/preview/server.ts`
- Create: `src/preview/public/index.html`
- Create: `src/preview/public/app.js`
- Create: `src/preview/public/style.css`
- Test: `tests/preview/preview-server.test.ts`

**Interfaces:**
- Consumes: `listAssetFiles`, `loadAssetByIdOrPath`, `loadPalette`, `compileAsset`, `renderAssetFrame`, `renderRoom`, `sortIsometricObjects`, `encodePNG`, `RoomLayoutSchema`.
- Produces (`src/preview/server.ts`):
  - `startPreviewServer(opts: { rootDir: string; port?: number; host?: string }): Promise<{ url: string; port: number; close: () => Promise<void> }>`
  - HTTP endpoints:
    - `GET /` and static assets (`/app.js`, `/style.css`)
    - `GET /api/assets` — lists available assets with `id`, `layer`, `footprintTiles`, `frameCount`
    - `GET /api/render/:id?dir=se&frame=0&outline=silhouette&emissive=baked` — returns PNG + `X-Pixcel-Anchor-X`, `X-Pixcel-Anchor-Y`, `X-Pixcel-Footprint` headers
    - `GET /api/room?file=...` — loads `.room.json` (defaults to `sample-office.room.json`)
    - `POST /api/room` — validates via `RoomLayoutSchema` and saves `.room.json` safely inside workspace
    - `POST /api/room/render` — returns composited room PNG
    - `GET /api/events` — SSE live-reload stream triggered on `.pixcel.json`/`.room.json` edits

- [ ] **Step 1: Write the failing tests in `tests/preview/preview-server.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPreviewServer } from "../../src/preview/server.js";

describe("local web preview server", () => {
  let closeFn: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeFn) {
      await closeFn();
      closeFn = undefined;
    }
  });

  it("serves HTML UI, lists starter assets, renders sprite PNG with anchor headers, and saves/loads rooms", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixcel-preview-"));
    const srv = await startPreviewServer({ rootDir: tmpDir, port: 0 });
    closeFn = srv.close;

    const htmlRes = await fetch(srv.url);
    expect(htmlRes.status).toBe(200);
    expect(await htmlRes.text()).toContain("iherk-pixcel");

    const listRes = await fetch(`${srv.url}/api/assets`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { assets: Array<{ id: string }> };
    expect(listData.assets.some((a) => a.id === "desk-dev-dual")).toBe(true);

    const pngRes = await fetch(`${srv.url}/api/render/desk-dev-dual?dir=sw&frame=0`);
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get("content-type")).toBe("image/png");
    expect(pngRes.headers.get("x-pixcel-footprint")).toBe("1,2");
    const pngBuf = Buffer.from(await pngRes.arrayBuffer());
    expect(pngBuf.subarray(1, 4).toString("ascii")).toBe("PNG");

    const badRes = await fetch(`${srv.url}/api/render/..%2F..%2Fsecret`);
    expect(badRes.status).toBe(400);

    const saveRes = await fetch(`${srv.url}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: "custom.room.json",
        room: {
          schemaVersion: 1, id: "custom", tilePreset: "64x32", widthTiles: 4, depthTiles: 4,
          floors: [{ assetId: "floor-wood-plank", tx: 0, ty: 0 }],
          walls: [], wallDecor: [], objects: [],
        },
      }),
    });
    expect(saveRes.status).toBe(200);
    expect(await fs.stat(path.join(tmpDir, "custom.room.json"))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/preview/preview-server.test.ts`
Expected: FAIL (missing `src/preview/server.ts`).

- [ ] **Step 3: Implement `src/preview/server.ts` and `src/preview/public/{index.html,app.js,style.css}`**

- In `src/preview/server.ts`: implement Node `http.createServer` handling static files (resolving `src/preview/public` relative to package root via `import.meta.url` so both `tsx` and compiled `dist/` work seamlessly), `/api/assets`, `/api/render/:id` (validating safe asset ID regex before lookup), `/api/room` (`GET`/`POST` with `resolveSafeWorkspacePath`), `/api/room/render`, and `/api/events` SSE live-reload using `fs.watch` (with debouncing and clean teardown on `close()`).
- In `src/preview/public/`: build a clean dark-themed HTML5 Canvas 2D viewer (`imageSmoothingEnabled = false`, dirty-rendered so idle CPU stays near 0%) with:
  - **Tab 1 — Asset Inspector**: asset selector, `Q`/`E` 4-direction rotation, frame playback & scrubber, 1×–8× integer zoom, toggles for isometric tile diamond overlay, anchor crosshair, outline mode, and emissive split view, plus SSE auto-reload.
  - **Tab 2 — Office Room Sandbox**: loads `sample-office.room.json`, palette of floor/wall/wall-decor/furniture tools, click to place/right-click to erase on isometric grid, `R` to rotate 90°, client-side Kahn's topological depth-sorting matching `room-compositor.ts`, and Save/Load `.room.json` buttons.

- [ ] **Step 4: Run full test suite & TypeScript build + visual smoke render**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
npx vitest run
npm run build
node dist/cli/index.js render-room assets/office-starter/sample-office.room.json --out out/sample-office.png
```
Expected: All unit/integration/MCP/preview tests PASS, `npm run build` exits 0 with zero TS errors, and `out/sample-office.png` is generated cleanly for visual inspection via `read_file`.

- [ ] **Step 5: Commit**

```bash
git -c include.path=/Users/dev3/.gitconfig-iherk add src/preview/ tests/preview/preview-server.test.ts
git -c include.path=/Users/dev3/.gitconfig-iherk commit -m "feat: add local Canvas 2D web preview and isometric office room sandbox"
```
