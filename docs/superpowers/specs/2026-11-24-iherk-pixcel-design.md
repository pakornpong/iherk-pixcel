# iherk-pixcel — Design Document

**Date:** 2026-11-24  
**Status:** Implemented (Phase 1 + Phase 2 characters, see [`2026-11-24-phase2-characters-design.md`](./2026-11-24-phase2-characters-design.md)) — notes updated 2026-11-26  
**Target Workspace:** `/Users/dev3/Documents/IHERK/iherk-pixcel`

> **2026-11-26 — where the code differs from this design:**
> - **Palettes do not colour renders.** `renderAssetFrame(asset, grid, _palette, …)` ignores the palette argument; every colour comes from the asset's `materials`, and shade ramps are built from each material colour (`buildShadeRamp`). Palettes are only used by the carver (nearest-colour quantization) and by `list_palettes` / `get_palette`. Re-theming an asset means rewriting its material colours (this is what iherk-hell-factory does for its day/office themes).
> - **Direction = rotation of the authored model, not a fixed facing.** `se` renders the model as authored, `sw`/`nw`/`ne` rotate it 90°/180°/270° CW around Z (`+X → +Y`). Which way an asset "faces" depends on where its front was authored. The character builder authors faces toward `+Y`, so characters face `+Y` in `se`, `-X` in `sw`, `-Y` in `nw`, `+X` in `ne` (§6.1 below assumes a `+X` front).
> - **Starter pack has 12 assets** (§6.9 lists 12) plus `sample-office.room.json`; `assets/characters/` holds 5 generated agents.
> - **MCP has 11 tools:** the 10 in §6.7 plus `create_character` (and `render_asset` accepts `animation`).
> - **Glass stays opaque** as designed; translucent glass exists only downstream (hell-factory pods).
> - **Downstream consumer:** iherk-hell-factory imports `dist/core/{schema,dsl-compiler,character-builder,postprocess,exporters/atlas,exporters/png}.js` directly. Run `npm run build` after changing `src/core` or hell-factory keeps the old behaviour. See §9.

---

## 1. Intent & Why

Build **iherk-pixcel**, a clean-room, PixZels-inspired **3D Voxel-to-Isometric Pixel Art Engine, CLI, MCP Server, and Local Web Previewer**, designed specifically for AI agents to author, inspect, and export game-ready isometric pixel-art assets for a gamified **AI Agent Office**.

### Aesthetic & Visual Target
- **Reference style**: Crisp 2:1 isometric pixel art in the spirit of Pixel Salvaje's *Isometric Interiors* (clean silhouettes, consistent tile scale, readable 1px outlines, cohesive color ramps) combined with the moody, dark-mode cyber/cozy **AI Agent Office** aesthetic from the user's reference image.
- **Concrete visual conventions from the reference office** *(self-contained spec for the builder)*:
  - **Diorama framing**: 2-wall cutaway isometric room (back-left `NW` wall and back-right `NE` wall meeting at a clean rear corner) floating against a deep dark navy/void backdrop (`#0a0e1a`).
  - **Walls**: Full-height interior walls (`48` voxels tall at `32` voxels/tile, `4` voxels thick) with dark slate-blue surfaces (`#1e2538`–`#2a334d`), darker top bevel trim, and subtle baseboard molding. Windows on the `NE`/`NW` walls show stylized dark night-blue panes (`#13294b` / `#28548a`) with crisp mullions and subtle moonlight sheen.
  - **Floors**: Warm dark-oak wood planks (`#4b3121`–`#6b442a`) with subtle plank seam variation and **no outer silhouette border** on individual floor tiles so tiled floors read as one continuous wooden room.
  - **Tech & Emissive Lighting**: Dark matte/metal server racks (`#171c26`) with crisp cyan, green, and amber LEDs; dual-monitor workstations showing dark-blue IDE/workflow/security UI panels with bright cyan/blue/amber/red emissive highlights casting a soft, localized pixel glow onto keyboards and desktops.
  - **Furniture & Props**: Warm wood desks with dark steel legs, dark ergonomic swivel chairs, wall-mounted whiteboards (`#e6e9ef` board with dark metal frame and simple colored node/arrow diagrams), wooden bookshelves packed with colorful book spines, conference table with laptops/mugs, and lush green potted plants (`#2d6a4f`–`#52b788`).
- **Why a 3D Voxel-to-Isometric approach instead of 2D image generation**:
  - Direct 2D image generation produces broken isometric angles, inconsistent scale across assets, mixels (mixed pixel sizes), and cannot reliably rotate an object across 4 facing directions (`se`, `sw`, `nw`, `ne`).
  - Authoring each asset once as a 3D voxel model (via AI-friendly structured primitives or 2D orthographic blueprints) and rendering it through a deterministic software 2:1 isometric rasterizer guarantees pixel-perfect alignment, zero mixels, consistent lighting, and automatic 4-direction + animation-frame sprite sheets with drop-in game metadata.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals (Phase 1)
1. **Deterministic 2:1 Isometric Software Rasterizer**: Convert 3D voxel grids to crisp pixel-art sprites with zero anti-aliasing artifacts and exact tile-footprint alignment (`64×32` default, plus `64×31` Tiled tight-lock and `32×16` compact presets).
2. **Dual AI-Friendly Authoring Modes**:
   - **Structured Voxel DSL (`.pixcel.json`)**: Composable primitives (`box`, `hollowBox`, `cylinder`, `slope`, `line`, `voxel`, `mirror`), named palette slots, material types (`matte`, `wood`, `metal`, `glass`, `emissive`), 2D pixel decals for flat surfaces (monitor code/charts, whiteboard diagrams, signs), and multi-frame state overrides (blinking server LEDs, animated monitor screens).
   - **2D-to-3D Orthographic Carving (PixZels-style)**: Ingest 1–6 orthographic pixel-art PNG views (`front`, `side`, `top`, and optional `back`, `left`, `bottom`) and intersect/extrude them into an editable 3D voxel model.
3. **Pixel-Art Shading, Palette, Outline & Emissive Pipeline**:
   - Directional 3-face shading (top/left/right brightness & hue-shifted ramps) + voxel-level ambient occlusion (AO) in concave corners.
   - Palette management with a built-in **AI Agent Office Night** palette and support for custom JSON / `.hex` / Lospec palettes.
   - Smart **1px pixel-art outline** with per-asset `outlineMode` (`"silhouette"` for furniture/props, `"none"` for seamless floor tiles, `"top-only"` for modular wall segments) plus optional subtle interior crease edges on depth/part discontinuities.
   - **Emissive glow pass** for screens, indicators, and neon accents, exportable both baked into the main sprite and as a separate `_emissive.png` layer for optional dynamic game-engine lighting.
4. **4-Direction & Game-Ready Exporters**:
   - Auto-render all **4 isometric directions** (`se`, `sw`, `nw`, `ne` — exact 90° Z-axis turns) from one model, or a requested subset of those 4 directions.
   - Output formats: individual PNGs, packed **Sprite Sheet PNG** (directions × animation frames), animated **GIF** preview, **Sprite Stacking** horizontal slice PNG strip, and **Wavefront `.obj` + `.mtl`**.
   - **TexturePacker-Compatible `.atlas.json` + Isometric Metadata**: Drop-in compatible with **Plain HTML5 Canvas 2D** (recommended lightweight runtime) as well as **PixiJS** and **Phaser**, including per-frame `footprintTiles`, exact `anchor: { x, y }` (in final exported sprite coordinates including outline padding), `durationMs`, and emissive layer linkage.
5. **AI Agent Interface (CLI + MCP Server)**:
   - **CLI (`pixcel`)**: scriptable commands for creating, carving, validating, rendering, packing, and previewing assets.
   - **MCP Server (`pixcel mcp`)**: local Stdio MCP server so AI agents (Antigravity, Claude Code, Codex, etc.) can create/edit assets, render preview images (returning file paths and base64 PNGs for visual self-verification), inspect palettes/templates, render full rooms, and pack atlases.
6. **Local Web Preview & Office Room Sandbox (`pixcel preview`)**:
   - Lightweight local browser viewer (Plain HTML5 Canvas 2D, `imageSmoothingEnabled = false`) for zoomed inspection (1×–8×), 4-direction spin, frame playback, grid/anchor overlay, and an interactive **Isometric Office Sandbox** to place and rotate multiple assets together on a layered room grid with topological depth sorting.
7. **Starter AI Agent Office Pack**:
   - Ship 11 starter office assets authored in `.pixcel.json` (wood plank floor, dark slate wall, night window wall, corner wall pillar, dual-monitor dev desk, security-ops desk, ergonomic swivel chair, blinking server rack, architecture whiteboard, conference table, potted plant, bookshelf) plus `sample-office.room.json` to validate the full pipeline and serve as reference templates for AI agents.
8. **Phase 2 Schema Readiness (Characters & 8-Direction)**:
   - Reserve optional hierarchical `parts` and `frames[].partTransforms` hooks in `.pixcel.json` so Phase 2 poseable/animated AI Agent characters (sitting/typing/walking) plug cleanly into the format without breaking Phase 1 assets.

### Non-Goals (Phase 1)
- Articulated character rigging, walk-cycle editors, or sitting/typing character animations (deferred to Phase 2).
- 8-direction (45° off-axis) voxel rotation — deferred to Phase 2 (Phase 1 is strictly exact 4-direction 90° turns).
- True alpha-blended translucent multi-layer glass rendering — Phase 1 `glass` is stylized opaque pixel art.
- Full manual 3D voxel sculpting GUI (the web preview is an inspector and room-placement verifier, not a MagicaVoxel replacement).
- Multi-tile `1×1` vertical strip slicing for tilemap-only engines (multi-tile assets export as single sprites sorted by topological depth-sorting).
- Reverse engineering, decompiling, or copying any code, assets, or binaries from PixZels or *Isometric Interiors*.
- Building the full playable AI Agent Office application itself (this project builds the asset-creation tools and sample asset pack).

### Anti-Goals (Failure Conditions)
- **Mixels or anti-aliasing smear**: Any blurry sub-pixel scaling, mismatched voxel density across assets, or soft-filtered edges.
- **Broken isometric tiling**: Adjacent `1×1` floor/wall tiles leaving 1px gaps, ugly dark grid seams between floor tiles, or anchors drifting across rotations.
- **High-friction AI loop**: Opaque coordinates, silent validation failures, or requiring manual GUI clicks before an AI can render and inspect its own output.
- **Heavy native toolchains**: Requiring Blender, Python environments, or native C++ build toolchains (`node-gyp` / Cairo) just to render sprites.

---

## 3. Constraints

- **Clean-room implementation**: 100% original TypeScript code and original starter assets.
- **Environment**: TypeScript on Node.js (`>=22`, verified `v26.5.0` on macOS Apple Silicon). Pure-JS/TS image encoding (`pngjs` or `fast-png`, `gifenc`) so installation and execution are deterministic and portable with zero native binary dependencies.
- **Target downstream runtime (Lightweight Web)**: Designed primarily for **Plain HTML5 Canvas 2D** (zero framework overhead, dirty-render / low-FPS idle so keeping the AI Agent Office open all day uses near-zero CPU/RAM) while remaining natively compatible with **PixiJS / Phaser** via TexturePacker JSON Hash `.atlas.json`.
- **Output determinism**: Given identical `.pixcel.json` + palette + render config, rendering must produce byte-identical PNG output across machines and runs.
- **MCP Compatibility**: Must work cleanly as a local Stdio MCP server in Antigravity (`~/.gemini/config/mcp_config.json`) and standard MCP clients.

---

## 4. Approaches Considered

| Approach | Summary | Tradeoffs |
|---|---|---|
| **1. Pure TypeScript Voxel-to-Isometric Engine + CLI/MCP + Web Preview** *(Selected)* | Deterministic software 2:1 isometric G-buffer rasterizer in TypeScript/Node.js, supporting structured voxel DSL + 2D-to-3D orthographic carving, pixel-art shading/outline/emissive post-processing, CLI + MCP server, and lightweight local web preview sandbox. | **Pros:** 100% crisp pixel art (zero anti-aliasing smear), instant headless renders, zero heavy external deps, runs natively on existing Node 26, ideal tight loop for AI via MCP.<br>**Cons:** Stylized voxel lighting rather than photorealistic raytracing (which actually matches the target pixel-art style better). |
| **2. Blender Headless Pipeline (Python) + MCP Wrapper** | AI generates Blender Python scripts rendered via headless Blender orthographic camera + pixelation compositor. | **Pros:** Powerful 3D lighting and native character rigging for future phases.<br>**Cons:** Heavy external dependency (Blender), slow render cycles, hard to avoid "downscaled 3D" look and stray anti-aliased pixels. |
| **3. Pure 2D Isometric Pixel Canvas + MCP** | AI draws directly on 2D pixel layers with isometric box/line helpers without a 3D voxel model. | **Pros:** Simplest initial codebase; direct 2D pixel control.<br>**Cons:** Cannot auto-rotate 4 directions (AI must redraw every asset 4 times), no PixZels-style 2D-to-3D carving, hard to maintain consistent scale and depth sorting. |

**Decision:** User selected **Approach 1**.

---

## 5. System Architecture

```text
                ┌──────────────────────────┐
                │   AI Agent (MCP / CLI)   │
                └────────────┬─────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  [.pixcel.json]      [2D PNG Views]       [Palette .json/.hex]
  (Voxel DSL +        (Front/Side/Top      (Office Night /
   Decals + Frames)    Orthographic)        Custom / Lospec)
        │                    │                    │
        ▼                    ▼                    │
  DSL Compiler       2D-to-3D Carver              │
        └─────────┬──────────┘                    │
                  ▼                               │
          [VoxelScene / Grid]                     │
          (voxels, parts, frames,                 │
           materials, decals)                     │
                  │                               │
                  ▼                               ▼
     ┌────────────────────────────────────────────────┐
     │     2:1 Isometric Software Rasterizer          │
     │  (4-dir 90° Z-rotation -> Single-layer         │
     │   G-Buffer: albedo, face, depth, voxelCoord,   │
     │   material, partId, emissive, alpha)           │
     └───────────────────────┬────────────────────────┘
                             ▼
     ┌────────────────────────────────────────────────┐
     │     Pixel-Art Post-Processing Pipeline         │
     │  1. Directional face shading + hue-shift ramp  │
     │  2. Voxel Ambient Occlusion (concave corners)  │
     │  3. Stylized glass specular / palette lookup   │
     │  4. Smart 1px Outline (per-asset outlineMode)  │
     │  5. Emissive pass (baked + optional split PNG) │
     └───────────────────────┬────────────────────────┘
                             ▼
     ┌────────────────────────────────────────────────┐
     │                   Exporters                    │
     │  PNG | Sprite Sheet + TexturePacker .atlas.json│
     │  | GIF | Sprite Stack Strip | OBJ+MTL          │
     └───────────────────────┬────────────────────────┘
                             ▼
        [Topological Room Compositor (`render_room`)
         & Local HTML5 Canvas Web Preview Sandbox]
```

### Module Layout *(Our call — builder may refine internal filenames)*
- `src/core/schema.ts` — Zod schemas & TypeScript types for `.pixcel.json`, `.room.json`, palettes, render options, and `.atlas.json`.
- `src/core/voxel-grid.ts` — 3D voxel storage (`x, y, z` → material, partId), bounds calculation, exact 90° Z-axis rotation helpers, and frame compositing.
- `src/core/dsl-compiler.ts` — Evaluates `.pixcel.json` primitives (`box`, `hollowBox`, `cylinder`, `slope`, `line`, `voxel`, `mirror`), applies 2D surface decals onto specified faces, and resolves animation frame overrides.
- `src/core/carver.ts` — PixZels-style 2D-to-3D orthographic silhouette intersection + surface color projection from 1–6 PNG views.
- `src/core/palette.ts` — Palette loader (JSON, `.hex`, Lospec format), nearest-color matching, and hue-shifted shade ramp generator (highlight / base / shadow / deep-shadow / outline).
- `src/core/rasterizer.ts` — Deterministic 2:1 isometric projection into a single-layer per-pixel G-Buffer.
- `src/core/postprocess.ts` — Directional shading, voxel AO, stylized glass specular highlights, palette ramp mapping, smart 1px silhouette/crease outlining (`outlineMode`), and emissive glow halo.
- `src/core/room-compositor.ts` — Layered isometric room compositor with **topological depth-sorting** (Kahn's algorithm on footprint occlusion boxes) shared by `render_room` (CLI/MCP) and the Web Preview Sandbox.
- `src/core/exporters/` — PNG writer, Sprite Sheet packer + TexturePacker-compatible `.atlas.json` generator, GIF encoder, Sprite Stack slice exporter, and Wavefront `.obj` + `.mtl` exporter.
- `src/cli/index.ts` — `pixcel` CLI (`render`, `carve`, `pack`, `validate`, `palette`, `render-room`, `preview`, `mcp`).
- `src/mcp/server.ts` — Stdio MCP server exposing structured tools for AI agents.
- `src/preview/server.ts` + `src/preview/public/` — Local HTTP server and HTML5 Canvas Asset Inspector + Isometric Office Room Sandbox.
- `assets/palettes/` — Built-in palettes (`office-night.palette.json`, `office-day.palette.json`).
- `assets/office-starter/` — Starter AI Agent Office `.pixcel.json` assets and `sample-office.room.json`.

---

## 6. Key Technical Decisions

### 6.1 Coordinate System & Exact 2:1 Isometric Math *(Our call)*
- **World axes**: Right-handed integer voxel grid where `+X` runs down-right on screen (South-East), `+Y` runs down-left on screen (South-West), and `+Z` runs straight up.
- **Canonical 4 directions** (Phase 1 — strictly lossless 90° integer grid rotations around `Z`):
  - `se` (0°): default front face faces `+X` (bottom-right)
  - `sw` (90° CW): front face faces `+Y` (bottom-left)
  - `nw` (180°): front face faces `-X` (top-left)
  - `ne` (270° CW): front face faces `-Y` (top-right)
- **Exact Gap-Free Projection & Tile Presets**:
  1. **`64x32` at `voxelsPerTile = 32` (Default — High Detail)**:
     - Projection for voxel `(x, y, z)`:
       - `sx = x - y`
       - `sy = Math.floor((x + y) / 2) - z`
     - Mathematical guarantee: For a flat `z = 0` plane, `(x, y) ↦ (x - y, floor((x + y) / 2))` is an **exact 1-to-1 bijection** from `ℤ² → ℤ²`. Each top-face voxel writes **1 pixel** at `(sx, sy)`. For vertical height (`z`), each exposed `+X` or `+Y` side voxel writes 1 pixel at `(sx, sy)` (with face classification determined by neighbor visibility: exposed `+Z` → `top`, exposed `+Y` with higher `z` occluded → `left`, exposed `+X` → `right`).
     - A `32×32` (`1×1` tile) floor spans `63×32` exact content pixels (`sx ∈ [-31, 31], sy ∈ [0, 31]`), padded by 1 transparent column on the right to a `64×32` tile box. Tiling at `(stepX = 32, stepY = 16)` produces **strictly zero gaps and zero overlapping pixels**.
  2. **`64x32` at `voxelsPerTile = 16` (Chunky Retro Preset)**:
     - Projection: `sx = (x - y) * 2`, `sy = (x + y) - z * 2`.
     - Each top-face voxel writes a 2px horizontal span `(sx, sy)` and `(sx + 1, sy)`, and exposed side faces drop 2px (`sy + 1`, `sy + 2`). This is also an exact `ℤ² → ℤ²` bijection (`64×32` diamond) tiling at `(stepX = 32, stepY = 16)` with **zero gaps and zero overlaps**.
  3. **`32x16` at `voxelsPerTile = 16` (Compact Preset)**:
     - Same 1px bijection formula as Preset 1 over `16×16` voxels (`31×16` content padded to `32×16`), tiling at `(stepX = 16, stepY = 8)` with **zero gaps and zero overlaps**.
  4. **`64x31` at `voxelsPerTile = 32` (Tiled Tight-Lock Preset)**:
     - Trims the 1px bottom-most diamond row (or mirrors top-tip symmetry) to a `64×31` bounding box, tiling at `(stepX = 32, stepY = 15)` following Tiled's convention: **zero gaps, with an intentional 1px identical-edge seam overlap** documented explicitly in `.atlas.json` (`tileOverlapY: 1`).
- **Depth Ordering inside the Rasterizer**:
  - Iterate/sort voxels back-to-front by isometric depth key `x + y` then `z` ascending (painter's order with per-pixel depth buffer storing `(x + y, z)`), guaranteeing exact occlusion with zero z-fighting.
- **Ground Anchor Point**:
  - Every rendered sprite records `anchor: { x, y }` in **final exported sprite pixel coordinates (including any 1px outer outline / glow padding)**, pointing to the projected screen pixel of the bottom corner of the tile footprint diamond `(footprintX * voxelsPerTile - 1, footprintY * voxelsPerTile - 1, 0)` (with `anchorMode: "bottom-diamond"` default, or `"center-floor"` optional).
  - When an asymmetric asset (e.g., `2×1` desk) rotates 90° (`se` → `sw`), its rotated `footprintTiles` flips (`[2, 1]` → `[1, 2]`) and `anchor` recalculates to the rotated footprint diamond so the asset stays locked to the floor grid.

### 6.2 Asset File Format (`.pixcel.json`) *(Our call)*
Human- and AI-readable JSON validated by Zod:
```json
{
  "schemaVersion": 1,
  "id": "desk-dev-dual",
  "category": "furniture",
  "layer": "object",
  "outlineMode": "silhouette",
  "tilePreset": "64x32",
  "voxelsPerTile": 32,
  "footprintTiles": [2, 1],
  "palette": "office-night",
  "materials": {
    "wood_dark": { "color": "#4b3121", "kind": "wood" },
    "metal_frame": { "color": "#262b38", "kind": "metal" },
    "screen_bg": { "color": "#0f2942", "kind": "emissive", "glowRadius": 1, "glowIntensity": 0.2 },
    "screen_glow": { "color": "#38bdf8", "kind": "emissive", "glowRadius": 2, "glowIntensity": 0.45 }
  },
  "ops": [
    { "op": "box", "from": [2, 2, 0], "to": [61, 29, 1], "material": "metal_frame", "part": "base" },
    { "op": "box", "from": [0, 0, 14], "to": [63, 31, 16], "material": "wood_dark", "part": "desktop" }
  ],
  "decals": [
    {
      "face": "+X",
      "origin": [12, 6, 20],
      "legend": { ".": null, "b": "screen_bg", "c": "screen_glow" },
      "rows": ["bbbbbb", "bccccb", "bbbbbb"]
    }
  ],
  "frames": [
    { "name": "idle_0", "durationMs": 600, "ops": [] },
    { "name": "idle_1", "durationMs": 600, "ops": [] }
  ]
}
```
- `layer`: `"floor" | "wall" | "wall-decor" | "object"` (informs room placement and rendering order).
- `outlineMode`: `"silhouette"` (default for objects/decor), `"none"` (default for floor tiles so adjacent tiles stitch seamlessly), `"top-only"` (default for modular wall segments so consecutive walls join without black vertical divider stripes).
- **Phase 2 Hook**: Optional `parts` (`{ [partId]: { pivot: [x,y,z], parent?: string } }`) and `frames[].partTransforms` are validated as optional fields in the schema (no-op or integer translation in Phase 1).

### 6.3 2D-to-3D Orthographic Carving (`pixcel carve`) *(Our call)*
- Accepts 1 to 6 PNG images (`front`, `side`, `top`, `back`, `left`, `bottom`) where transparent pixels (`alpha < 128`) mean empty space.
- **Intersection carving**: Keeps voxel `(x, y, z)` only if its projected pixel is opaque in every supplied orthographic view.
  - 1-view mode (`front` only): extrudes to configurable `--depth` (default `4` voxels).
  - 2-view / 3-view+ mode: carves exact 3D silhouette intersection.
- **Color assignment**: Exposed surface voxels sample color from their nearest visible view (`top` for `+Z`, `front` for `+X`, `side` for `+Y`, fallback to nearest opaque view), quantize to palette slots, and emit box-merged `.pixcel.json` ops so AI can continue editing the carved model cleanly.

### 6.4 Pixel-Art Shading, Glass, Outline & Emissive Pipeline *(Our call)*
1. **Directional Lighting**: Key light from upper-left-front:
   - Top face (`+Z`): `+1` brightness ramp step (slight warm shift)
   - Left face (`+Y`): base color (`0` step)
   - Right face (`+X`): `-1` shadow ramp step (slight cool/indigo shift for night office mood)
   - `emissive` materials bypass shadow darkening and render at full luminance.
2. **Stylized Opaque `glass` Material**:
   - Renders in the single-layer G-Buffer as tinted opaque glass (using the material's base color) with a crisp 1px diagonal pixel specular highlight band (1–2 ramp steps brighter) across planar glass regions, staying 100% palette-quantized.
3. **Voxel Ambient Occlusion**:
   - For each visible pixel's voxel face, inspect immediate neighbor voxels along the face tangent plane; concave corners (e.g., desk underside, wall-floor junction) step down up to `-1` shade step.
4. **Smart 1px Outline**:
   - Respects asset `outlineMode`:
     - `"silhouette"`: transparent pixels 4-neighbor-adjacent to opaque pixels get a 1px dark outline tinted toward the adjacent voxel's darkest palette ramp shade (never harsh pure `#000000` unless the palette defines it).
     - `"none"`: skips outer silhouette outline (essential for seamless modular floor tiles).
     - `"top-only"`: draws silhouette outlines only along top/outer exposed edges, omitting shared vertical tile-seam boundaries so modular walls connect cleanly.
   - **Interior creases** *(toggleable, default subtle)*: opaque pixels adjacent to a depth discontinuity `>= 3` voxels or a distinct `part` boundary darken by 1 shade step.
5. **Emissive Glow**:
   - Supports `emissiveMode: "baked" | "split" | "both"` (default `"baked"` for previews, `"both"` recommended for game export):
     - `"baked"`: applies a subtle localized radial glow halo around emissive pixels.
     - `"split"`: writes clean `asset.png` + `asset_emissive.png` (transparent background, glowing pixels/halos only) for optional additive blending in Canvas 2D / PixiJS.

### 6.5 Atlas Format (`.atlas.json`) — Lightweight Web Standard *(Recommended & Selected)*
Uses **TexturePacker JSON Hash** format (natively supported by PixiJS & Phaser, trivially parsed by Plain HTML5 Canvas 2D with zero dependencies) extended with an `isometric` block:
```json
{
  "frames": {
    "desk-dev-dual/se/idle_0": {
      "frame": { "x": 0, "y": 0, "w": 98, "h": 72 },
      "sourceSize": { "w": 98, "h": 72 },
      "spriteSourceSize": { "x": 0, "y": 0, "w": 98, "h": 72 },
      "pivot": { "x": 0.3469, "y": 0.9722 },
      "isometric": {
        "assetId": "desk-dev-dual",
        "direction": "se",
        "frameName": "idle_0",
        "durationMs": 600,
        "layer": "object",
        "footprintTiles": [2, 1],
        "anchor": { "x": 34, "y": 70 }
      }
    }
  },
  "meta": {
    "app": "iherk-pixcel",
    "version": "1",
    "image": "office-atlas.png",
    "emissiveImage": "office-atlas_emissive.png",
    "format": "RGBA8888",
    "size": { "w": 512, "h": 256 },
    "scale": "1",
    "tilePreset": "64x32",
    "stepX": 32,
    "stepY": 16,
    "tileOverlapY": 0
  }
}
```
- Multi-tile furniture (`2×1`, `2×2`) exports as a **single sprite** with exact `footprintTiles` and `anchor`.

### 6.6 Room Occupancy Model (`.room.json`) & `render_room` Compositor *(Our call)*
- **Layered tile occupancy**:
  - `floors`: grid of floor tiles at `(tx, ty)` (`layer: "floor"`), drawn first in simple `(tx + ty)` order.
  - `walls`: edge-attached walls on the perimeter (`edge: "nw" | "ne" | "corner"` at `(tx, ty)`, `layer: "wall"`), sharing the tile coordinate cleanly with floor tiles and drawn behind interior objects.
  - `wallDecor`: wall-mounted items (`whiteboard-arch`, signs) attached to a `nw` or `ne` wall edge (`layer: "wall-decor"`), drawn immediately after their host wall segment.
  - `objects`: free-standing furniture & props (`layer: "object"`) placed at `(tx, ty)` with `direction: "se" | "sw" | "nw" | "ne"` and rotated `footprintTiles: [w, d]`.
- **Topological Isometric Depth-Sorter** (shared by `render_room` and the Web Preview Room Sandbox):
  - Composites pre-rendered 2D asset sprites (validating real downstream HTML5 Canvas 2D / PixiJS rendering!).
  - For any two objects `A` occupying `[ax0, ax1) × [ay0, ay1)` and `B` occupying `[bx0, bx1) × [by0, by1)`: `A` renders behind `B` if `ax1 <= bx0` or `ay1 <= by0` (with screen-space overlap check). Kahn's topological sort resolves multi-tile scenes cleanly (e.g., a `1×1` swivel chair tucked beside a `2×1` desk never clips incorrectly).

### 6.7 MCP Server Tool Surface *(Our call)*
Exposed via `pixcel mcp` (Stdio transport):
- `list_palettes` / `get_palette` — inspect available palettes and shade ramps.
- `list_assets` / `read_asset` — inspect existing `.pixcel.json` assets (including starter templates).
- `create_asset` / `update_asset` — create or patch `.pixcel.json` with strict Zod validation and actionable errors.
- `carve_from_views` — run 2D-to-3D orthographic carving from PNG paths into `.pixcel.json`.
- `render_asset` — render selected/all 4 directions + frames to PNG/Sprite Sheet/GIF/OBJ, returning output paths, `.atlas.json` metadata, and an optional inline base64 PNG preview (e.g., 4-direction contact sheet) for immediate visual inspection by vision-capable agents.
- `render_room` — composite a `.room.json` layout into a single room PNG (and optional base64 preview) so AI can inspect the whole office visually.
- `pack_atlas` — pack multiple assets into a TexturePacker-compatible sprite sheet + `.atlas.json`.

### 6.8 Local Web Preview & Office Room Sandbox (`pixcel preview`) *(Our call)*
- Lightweight local Node HTTP server + zero-framework HTML5 Canvas 2D UI (`imageSmoothingEnabled = false`, dirty-rendered so idle CPU is ~0%).
- **Tab 1 — Asset Inspector**: select any `.pixcel.json`, spin 4 directions (`Q`/`E`), play/step animation frames, zoom 1×–8×, toggle tile diamond grid / anchor crosshair / emissive layer / outline, with live file-change reload.
- **Tab 2 — Office Room Sandbox**: loads `sample-office.room.json` (or blank room), place/erase floor, wall, wall-decor, and furniture assets, press `R` to rotate 90°, live topological depth-sorting, and save/load `.room.json`.

### 6.9 Starter AI Agent Office Pack *(Our call)*
Built-in starter assets in `assets/office-starter/` using `office-night.palette.json`:
1. `floor-wood-plank` (`1×1`, `layer: "floor"`, `outlineMode: "none"`)
2. `wall-slate-plain` (`1×1` edge wall, `layer: "wall"`, `outlineMode: "top-only"`)
3. `wall-night-window` (`1×1` edge wall with stylized opaque night-blue glass panes & mullions, `layer: "wall"`, `outlineMode: "top-only"`)
4. `wall-corner-pillar` (`1×1` rear NW/NE corner joiner, `layer: "wall"`, `outlineMode: "top-only"`)
5. `desk-dev-dual` (`2×1`, dual glowing cyan/blue code monitors, keyboard, mouse, coffee mug — 2-frame animation)
6. `desk-security-ops` (`2×1`, security dashboard + red/amber alert monitor — 2-frame pulse)
7. `chair-office-swivel` (`1×1`, ergonomic dark swivel chair)
8. `server-rack` (`1×1`, tall dark server rack with blinking cyan/green/amber LEDs — 3-frame animation)
9. `whiteboard-arch` (`2×1`, wall-mounted whiteboard with system architecture decal, `layer: "wall-decor"`)
10. `table-conference` (`2×2`, wooden meeting table with laptops and coffee mugs)
11. `plant-potted` (`1×1`, potted green office plant) & `bookshelf-wood` (`1×1`, wooden bookshelf with colorful books)

Plus `sample-office.room.json` assembling these into a complete dark AI Agent Office diorama.

---

## 7. Verification & Success Criteria

1. **Projection & Tile-Lock Tests**:
   - `64×32` (`voxelsPerTile = 32` and `16`) and `32×16`: compositing a `3×3` grid of `1×1` floor tiles (`outlineMode: "none"`) at `(stepX, stepY)` covers every interior diamond pixel **exactly once** (zero 1px gaps AND zero overlapping pixels).
   - `64×31` (Tiled tight-lock): compositing a `3×3` grid at `(stepX = 32, stepY = 15)` produces **zero 1px gaps** with only the documented 1px identical-edge seam lock.
2. **4-Direction Consistency Tests**: Rotating a `2×1` asymmetric asset (`desk-dev-dual`) across `se`, `sw`, `nw`, `ne` flips `footprintTiles` accurately (`[2,1]` ↔ `[1,2]`), keeps `anchor` aligned to the rotated footprint diamond (accounting for outline padding), and produces byte-identical output across repeated runs.
3. **Topological Room Depth-Sort Tests**: Verify multi-tile scenes (e.g., `1×1` chair behind/beside/in front of a `2×1` desk, `2×2` conference table with surrounding chairs) sort without occlusion glitches.
4. **2D-to-3D Carver Tests**: Synthetic Front/Side/Top PNG blueprints carve into exact expected 3D voxel bounds and surface colors, then re-render cleanly in isometric view.
5. **Post-Process Tests**: Verify directional face luminance ordering (`top > left > right`), stylized `glass` stays 100% palette-quantized, `emissive` pixels bypass shadow darkening and export cleanly to `_emissive.png` in `"split"`/`"both"` modes, and `outlineMode` (`"silhouette"` / `"none"` / `"top-only"`) behaves accurately without clipping canvas bounds.
6. **MCP End-to-End Tests**: Spawn `pixcel mcp` over stdio, invoke `create_asset` → `render_asset` → `render_room` → `pack_atlas`, and verify valid PNGs and TexturePacker-compatible `.atlas.json` output.
7. **Visual Smoke Test**: Render `sample-office.room.json` containing the full starter AI Agent Office pack and inspect the output PNG visually to confirm crispness, seamless wooden floors, clean wall corners, glowing screens, and dark-office mood.

---

## 8. What's Left to the Builder

- Choice of pure-JS PNG library (`pngjs` vs `fast-png`) and sprite-sheet bin-packing heuristic (row-strip vs shelf/MaxRects).
- Internal voxel storage layout (flat `Uint16Array` / typed arrays vs sparse `Map` chunking) and box-merging compression for carved `.pixcel.json` files.
- Exact CLI argument parser (`commander` / `citty` / Node `util.parseArgs`) and terminal formatting.
- Visual layout and CSS styling of the local Web Preview & Office Room Sandbox controls (while preserving nearest-neighbor Canvas 2D rendering, dirty-render efficiency, and live-reload usability).
- Exact voxel coordinates and decal pixel patterns of each starter office asset (guided by Section 1's visual conventions and *Isometric Interiors* crispness).

---

## 9. Downstream Contract (iherk-hell-factory) *(added 2026-11-26)*

iherk-hell-factory loads this package from `../iherk-pixcel/dist/core` (override with `IHERK_PIXCEL_ROOT`) and must keep working without edits here. Treat these as a public API:

| Export | Used for |
|---|---|
| `PixcelAssetSchema` (`schema.js`) | Validating starter, prop, library and Gemini-crafted assets |
| `compileAsset`, `compileAssetAnimations` (`dsl-compiler.js`) | Legacy `frames` assets and multi-clip characters (frames named `<clip>_<i>`) |
| `buildCharacterAsset` (`character-builder.js`) | The 10 office characters (spec list lives in hell-factory `pixcel-bridge.ts`) |
| `renderAssetFrame` (`postprocess.js`) | All sprites, `emissiveMode: "both"` |
| `packSpriteAtlas` (`exporters/atlas.js`) | Runtime atlases with `isometric.anchor` / `footprintTiles` |
| `createRGBAImage`, `encodePNG` (`exporters/png.js`) | Contact sheets and atlas images |

Hell-factory relies on: clip names `idle`, `walk`, `sit_type`, `inspect`, `talk`, `assign`, `rest_coffee`, `rest_sleep`; the character part ids `head`, `torso`, `arm_l`, `arm_r`, `leg_l`, `leg_r`; chair seat height `z = 11`; and the direction convention above. Layers beyond the four in `AssetLayerSchema` (`tabletop`, `foreground`) are added on the hell-factory side from `category`, not here.
