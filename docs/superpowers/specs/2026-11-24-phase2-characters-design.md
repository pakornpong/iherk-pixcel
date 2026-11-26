# iherk-pixcel Phase 2 — Modular AI Agent Character System Design

**Date:** 2026-11-24  
**Status:** Implemented (Phase 2 `b4f322a`..`4bea682`, Phase 2b clips `f65e2dd`) — updated 2026-11-26  
**Base:** Phase 1 `main` (`290432d`)

---

## 1. Goal & Aesthetic Target
Bring the **AI Agent Office** to life with animated, modular pixel-art characters matching the chibi proportions of the user's reference image on the existing `voxelsPerTile: 32` (`64×32` isometric) grid:
- Standing height ~29 voxels (sits naturally at chair seat height `z = 11` behind `desk-dev-dual` desktop `z = 16`, stands cleanly before `server-rack` `z = 41` and `whiteboard-arch` `z = 18..40`).
- Strictly **4 lossless isometric directions (`se`, `sw`, `nw`, `ne`)** reusing the Phase 1 exact integer rasterizer and pixel-art post-processor with zero mixels.
- **100% backward compatible** with all Phase 1 `.pixcel.json`, `.room.json`, and `.atlas.json` files.

## 2. Architecture & Key Decisions
1. **Multi-Clip Animations & Hierarchical Parts (`src/core/schema.ts`, `src/core/dsl-compiler.ts`)**:
   - Extend `PartTransformSchema` with `hide?: boolean` (swaps standing limbs for bent seated limbs cleanly) and implement `rotateZSteps` (90° CW around `parts[partId].pivot`) plus parent → child hierarchical transform propagation (with cycle detection).
   - Add optional `animations?: Record<string, { loop?: boolean; frames: FrameDefinition[] }>` to `PixcelAssetSchema`.
   - Export `compileAssetAnimations(asset)` returning `Map<string, CompiledFrame[]>`. Phase 1 `compileAsset(asset)` remains backward compatible (falls back to `animations.idle` or first clip when `frames` is absent).
2. **Parametric Character Builder (`src/core/character-builder.ts`)**:
   - `buildCharacterAsset(spec: CharacterSpec): PixcelAsset` generates a complete, editable `.pixcel.json` chibi character with hierarchical `parts` (`torso`, `head`, `arm_l`, `arm_r`, `leg_l`, `leg_r`), customizable `skinTone`, `hairStyle` (`short`, `spiky`, `bob`, `ponytail`, `parted`, `hood_up`), `hairColor`, `outfitStyle` (`hoodie`, `blazer`, `tshirt`, `sweater`), `outfitColor`, `accentColor`, `pantsColor`, `glasses`, `headset`, and `emissiveAccent`.
   - Generates 4 built-in clips: `idle` (2f breathing), `walk` (4f stride cycle), `sit_type` (2f seated typing on chair/desk), and `inspect` (2f pointing/operating server/whiteboard).
   - **Phase 2b (implemented):** 4 more clips — `talk` (2f two-hand gesture + head nod), `assign` (2f pointing arm + clipboard), `rest_coffee` (2f mug lifted to mouth), `rest_sleep` (2f *seated* nap: `sit_type` pose, arms folded, head drooping, breathing). Props (mug, clipboard) exist only in frame ops. Total: 8 clips, 18 frames.
   - Facing: the builder authors the face on `+Y` (eyes at `y = 19`), so a character faces `+Y` in `se`, `-X` in `sw`, `-Y` in `nw`, `+X` in `ne`. Seated legs sit at chair seat height `z = 11`.
   - Frame `ops` are absolute and only base-grid parts move with `partTransforms`, so a clip that changes a limb hides the base part (`hide: true`) and redraws it.
3. **Room Characters Layer (`src/core/room-compositor.ts`)**:
   - Add optional `characters: Array<{ assetId, tx, ty, direction, animation, roleLabel? }>` to `RoomLayoutSchema`.
   - Characters sort in the **same Kahn's topological depth pass** as `objects`, with deterministic tie-breaking on shared tiles (`objects` like chairs draw before `characters` occupying the same `(tx, ty)` so seated agents sit cleanly on top of `chair-office-swivel`).
4. **5 Starter AI Agent Characters (`assets/characters/`) & Populated Office Room**:
   - `agent-dev`, `agent-security`, `agent-pm`, `agent-operator`, `agent-automation` + `sample-office.room.json` populated with the 5 working agents.
5. **CLI, MCP & Web Preview Support**:
   - CLI: `pixcel create-character ...`, `pixcel render <asset> --animation <clip|all>`.
   - MCP: `create_character` tool (returns `.pixcel.json` path + optional 4-direction/pose preview PNG) and `animation` option on `render_asset`.
   - Web Preview: discovers `assets/characters/`, adds Animation Clip selector to Inspector & Sandbox, animates all characters + monitors/LEDs together on `▶ Animate`.
