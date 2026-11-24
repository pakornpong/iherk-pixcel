import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildCharacterAsset, HairStyleSchema, OutfitStyleSchema } from "../core/character-builder.js";
import { carveFromOrthographicViews, type OrthographicViews } from "../core/carver.js";
import { compileAsset, compileAssetAnimations } from "../core/dsl-compiler.js";
import { packSpriteAtlas, type AtlasInputSprite } from "../core/exporters/atlas.js";
import { encodeAnimatedGIF } from "../core/exporters/gif.js";
import { exportObjMtl } from "../core/exporters/obj.js";
import { createRGBAImage, decodePNG, encodePNG, type RGBAImage } from "../core/exporters/png.js";
import { exportSpriteStack } from "../core/exporters/sprite-stack.js";
import { listBuiltinPalettes } from "../core/palette.js";
import { renderAssetFrame } from "../core/postprocess.js";
import { renderRoom } from "../core/room-compositor.js";
import {
  DirectionSchema,
  EmissiveModeSchema,
  PixcelAssetSchema,
  RoomLayoutSchema,
  SafeIdSchema,
  type Direction,
} from "../core/schema.js";
import {
  BUILTIN_ASSETS_DIR,
  listAssetFiles,
  loadAllAssetsMap,
  loadAssetByIdOrPath,
  loadWorkspaceSafePalette,
  resolveSafeWorkspacePath,
} from "../core/workspace.js";

function composeContactSheet(images: RGBAImage[], bg: [number, number, number, number] = [10, 14, 26, 255]): RGBAImage {
  const pad = 8;
  const maxH = images.reduce((m, img) => Math.max(m, img.height), 1);
  const totalW = images.reduce((s, img) => s + img.width + pad, pad);
  const out = createRGBAImage(totalW, maxH + pad * 2);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0];
    out.data[i + 1] = bg[1];
    out.data[i + 2] = bg[2];
    out.data[i + 3] = bg[3];
  }
  let x = pad;
  for (const img of images) {
    const y0 = pad + (maxH - img.height);
    for (let sy = 0; sy < img.height; sy++) {
      for (let sx = 0; sx < img.width; sx++) {
        const si = (sy * img.width + sx) * 4;
        const sa = img.data[si + 3];
        if (sa === 0) continue;
        const di = ((y0 + sy) * out.width + (x + sx)) * 4;
        const a = sa / 255;
        const inv = 1 - a;
        out.data[di] = Math.round(img.data[si] * a + out.data[di] * inv);
        out.data[di + 1] = Math.round(img.data[si + 1] * a + out.data[di + 1] * inv);
        out.data[di + 2] = Math.round(img.data[si + 2] * a + out.data[di + 2] * inv);
        out.data[di + 3] = 255;
      }
    }
    x += img.width + pad;
  }
  return out;
}

function errResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

export function createPixcelMcpServer(rootDir: string): McpServer {
  const absRoot = path.resolve(rootDir);
  const paletteDirs = [path.join(absRoot, "assets", "palettes")];

  const server = new McpServer({
    name: "iherk-pixcel",
    version: "0.1.0",
  });

  server.tool("list_palettes", "List available built-in and workspace pixel-art palettes", {}, async () => {
    try {
      const palettes = await listBuiltinPalettes(paletteDirs);
      return { content: [{ type: "text", text: JSON.stringify({ palettes }, null, 2) }] };
    } catch (err) {
      return errResult(err);
    }
  });

  server.tool(
    "get_palette",
    "Read a palette definition and its named hex colors",
    { name: z.string().min(1) },
    async ({ name }) => {
      try {
        const pal = await loadWorkspaceSafePalette(absRoot, name);
        return { content: [{ type: "text", text: JSON.stringify(pal, null, 2) }] };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool("list_assets", "List all available .pixcel.json assets in the workspace and starter pack", {}, async () => {
    try {
      const assets = await listAssetFiles(absRoot);
      return { content: [{ type: "text", text: JSON.stringify({ assets }, null, 2) }] };
    } catch (err) {
      return errResult(err);
    }
  });

  server.tool(
    "read_asset",
    "Read a .pixcel.json asset by ID or workspace-relative path",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        const { asset, filePath } = await loadAssetByIdOrPath(absRoot, id);
        return { content: [{ type: "text", text: JSON.stringify({ filePath, asset }, null, 2) }] };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "create_asset",
    "Create and validate a new .pixcel.json voxel asset in the workspace",
    {
      asset: z.record(z.any()),
      outPath: z.string().optional(),
    },
    async ({ asset: rawAsset, outPath }) => {
      try {
        const asset = PixcelAssetSchema.parse(rawAsset);
        compileAsset(asset); // validate material references
        const target = outPath
          ? resolveSafeWorkspacePath(absRoot, outPath)
          : resolveSafeWorkspacePath(absRoot, path.join("assets", `${asset.id}.pixcel.json`));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
        return {
          content: [{ type: "text", text: JSON.stringify({ id: asset.id, filePath: target, status: "created" }, null, 2) }],
        };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "update_asset",
    "Update an existing workspace .pixcel.json asset (merges top-level fields and validates)",
    {
      id: SafeIdSchema,
      patch: z.record(z.any()),
    },
    async ({ id, patch }) => {
      try {
        const { asset: existing } = await loadAssetByIdOrPath(absRoot, id);
        const merged = PixcelAssetSchema.parse({ ...existing, ...patch, id });
        compileAsset(merged);
        const target = resolveSafeWorkspacePath(absRoot, path.join("assets", `${id}.pixcel.json`));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        return {
          content: [{ type: "text", text: JSON.stringify({ id, filePath: target, status: "updated" }, null, 2) }],
        };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "carve_from_views",
    "PixZels-style 2D-to-3D orthographic silhouette carving from 1-6 PNG views into a .pixcel.json asset",
    {
      id: SafeIdSchema,
      front: z.string().optional(),
      side: z.string().optional(),
      top: z.string().optional(),
      back: z.string().optional(),
      left: z.string().optional(),
      bottom: z.string().optional(),
      palette: z.string().default("office-night"),
      depth: z.number().int().min(1).max(64).default(4),
      voxelsPerTile: z.union([z.literal(16), z.literal(32)]).default(32),
      outPath: z.string().optional(),
    },
    async (args) => {
      try {
        const loadView = async (rel?: string) => {
          if (!rel) return undefined;
          const p = resolveSafeWorkspacePath(absRoot, rel);
          return decodePNG(await fs.readFile(p));
        };
        const views: OrthographicViews = {
          front: await loadView(args.front),
          side: await loadView(args.side),
          top: await loadView(args.top),
          back: await loadView(args.back),
          left: await loadView(args.left),
          bottom: await loadView(args.bottom),
        };
        const pal = await loadWorkspaceSafePalette(absRoot, args.palette);
        const asset = carveFromOrthographicViews(views, {
          id: args.id,
          palette: pal,
          depth: args.depth,
          voxelsPerTile: args.voxelsPerTile,
        });
        const target = args.outPath
          ? resolveSafeWorkspacePath(absRoot, args.outPath)
          : resolveSafeWorkspacePath(absRoot, path.join("assets", `${asset.id}.pixcel.json`));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id: asset.id, filePath: target, opsCount: asset.ops.length, footprintTiles: asset.footprintTiles },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "create_character",
    "Create a modular rigged chibi AI Agent character (.pixcel.json) with 8 animation clips (idle, walk, sit_type, inspect, talk, assign, rest_coffee, rest_sleep)",
    {
      id: SafeIdSchema,
      role: z.string().max(64).optional(),
      skinTone: z.string().default("warm"),
      hairStyle: HairStyleSchema.default("short"),
      hairColor: z.string().default("#2c1e16"),
      outfitStyle: OutfitStyleSchema.default("hoodie"),
      outfitColor: z.string().default("#2b3a55"),
      accentColor: z.string().default("#38bdf8"),
      pantsColor: z.string().default("#1c2230"),
      shoeColor: z.string().default("#141821"),
      glasses: z.boolean().default(false),
      headset: z.boolean().default(false),
      emissiveAccent: z.boolean().default(false),
      palette: z.string().default("office-night"),
      outPath: z.string().optional(),
      includePreviewImage: z.boolean().default(true),
    },
    async (args) => {
      try {
        const pal = await loadWorkspaceSafePalette(absRoot, args.palette);
        const asset = buildCharacterAsset(args);
        const target = args.outPath
          ? resolveSafeWorkspacePath(absRoot, args.outPath)
          : resolveSafeWorkspacePath(absRoot, path.join("assets", "characters", `${asset.id}.pixcel.json`));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(asset, null, 2)}\n`, "utf8");

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: asset.id,
                filePath: target,
                animations: Object.keys(asset.animations ?? {}),
                status: "created",
              },
              null,
              2,
            ),
          },
        ];

        if (args.includePreviewImage) {
          const clips = compileAssetAnimations(asset);
          const previewImgs: RGBAImage[] = [];
          for (const clipName of ["idle", "walk", "sit_type", "inspect", "talk", "assign", "rest_coffee", "rest_sleep"]) {
            const frames = clips.get(clipName);
            if (!frames?.length) continue;
            previewImgs.push(renderAssetFrame(asset, frames[0].grid, pal, { direction: "se", emissiveMode: "baked" }).main);
          }
          if (previewImgs.length > 0) {
            const contact = composeContactSheet(previewImgs);
            content.push({
              type: "image",
              data: encodePNG(contact).toString("base64"),
              mimeType: "image/png",
            });
          }
        }
        return { content };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "render_asset",
    "Render an asset across directions/animations/frames to PNG, TexturePacker atlas, GIF, sprite-stack, or OBJ+MTL, with optional inline base64 preview",
    {
      id: z.string().min(1),
      directions: z.array(DirectionSchema).default(["se", "sw", "nw", "ne"]),
      animation: z.string().optional(),
      format: z.enum(["png", "atlas", "gif", "stack", "obj"]).default("atlas"),
      emissiveMode: EmissiveModeSchema.default("baked"),
      outDir: z.string().optional(),
      includePreviewImage: z.boolean().default(true),
    },
    async ({ id, directions, animation, format, emissiveMode, outDir, includePreviewImage }) => {
      try {
        const { asset } = await loadAssetByIdOrPath(absRoot, id);
        const pal = await loadWorkspaceSafePalette(absRoot, asset.palette);
        const allClips = compileAssetAnimations(asset);
        const hasMultiClips = Boolean(asset.animations && Object.keys(asset.animations).length > 0);
        const selectedClips: Array<[string, ReturnType<typeof compileAsset>["frames"]]> = [];

        if (animation === "all") {
          for (const entry of allClips.entries()) selectedClips.push(entry);
        } else if (animation) {
          const clip = allClips.get(animation);
          if (!clip) {
            throw new Error(`Unknown animation "${animation}" for asset "${asset.id}". Available: [${[...allClips.keys()].join(", ")}]`);
          }
          selectedClips.push([animation, clip]);
        } else {
          const firstKey = allClips.has("idle") ? "idle" : allClips.keys().next().value!;
          selectedClips.push([firstKey, allClips.get(firstKey)!]);
        }

        const targetDir = resolveSafeWorkspacePath(absRoot, outDir ?? path.join("out", asset.id));
        await fs.mkdir(targetDir, { recursive: true });

        const outputs: string[] = [];
        const previewSprites: RGBAImage[] = [];
        const atlasInputs: AtlasInputSprite[] = [];

        for (const dir of directions as Direction[]) {
          for (const [clipName, frames] of selectedClips) {
            for (let fi = 0; fi < frames.length; fi++) {
              const frame = frames[fi];
              const rendered = renderAssetFrame(asset, frame.grid, pal, { direction: dir, emissiveMode });
              if (fi === 0) previewSprites.push(rendered.main);
              const key = hasMultiClips ? `${asset.id}/${dir}/${clipName}/${frame.name}` : `${asset.id}/${dir}/${frame.name}`;
              atlasInputs.push({
                key,
                assetId: asset.id,
                direction: dir,
                ...(hasMultiClips ? { animation: clipName } : {}),
                frameName: frame.name,
                durationMs: frame.durationMs,
                layer: asset.layer,
                footprintTiles: rendered.footprintTiles,
                anchor: rendered.anchor,
                image: rendered.main,
                emissive: rendered.emissive,
              });
              if (format === "png") {
                const suffix = hasMultiClips ? `${dir}_${clipName}_${frame.name}` : `${dir}_${frame.name}`;
                const p = path.join(targetDir, `${asset.id}_${suffix}.png`);
                await fs.writeFile(p, encodePNG(rendered.main));
                outputs.push(p);
                if (rendered.emissive) {
                  const ep = path.join(targetDir, `${asset.id}_${suffix}_emissive.png`);
                  await fs.writeFile(ep, encodePNG(rendered.emissive));
                  outputs.push(ep);
                }
              }
            }
          }
        }

        const firstGrid = selectedClips[0][1][0].grid;
        let atlasMeta: unknown;
        if (format === "atlas") {
          const packed = packSpriteAtlas(atlasInputs, {
            imageName: `${asset.id}.png`,
            emissiveImageName: `${asset.id}_emissive.png`,
            tilePreset: asset.tilePreset,
          });
          const sheetPath = path.join(targetDir, `${asset.id}.png`);
          const atlasPath = path.join(targetDir, `${asset.id}.atlas.json`);
          await fs.writeFile(sheetPath, encodePNG(packed.sheet));
          await fs.writeFile(atlasPath, `${JSON.stringify(packed.atlas, null, 2)}\n`, "utf8");
          outputs.push(sheetPath, atlasPath);
          if (packed.emissiveSheet) {
            const ep = path.join(targetDir, `${asset.id}_emissive.png`);
            await fs.writeFile(ep, encodePNG(packed.emissiveSheet));
            outputs.push(ep);
          }
          atlasMeta = packed.atlas;
        } else if (format === "gif") {
          const gifBuf = encodeAnimatedGIF(atlasInputs.map((s) => ({ image: s.image, durationMs: s.durationMs || 300 })));
          const gp = path.join(targetDir, `${asset.id}.gif`);
          await fs.writeFile(gp, gifBuf);
          outputs.push(gp);
        } else if (format === "stack") {
          const stack = exportSpriteStack(firstGrid, asset);
          const sp = path.join(targetDir, `${asset.id}_stack.png`);
          await fs.writeFile(sp, encodePNG(stack));
          outputs.push(sp);
        } else if (format === "obj") {
          const { obj, mtl } = exportObjMtl(firstGrid, asset, `${asset.id}.mtl`);
          const op = path.join(targetDir, `${asset.id}.obj`);
          const mp = path.join(targetDir, `${asset.id}.mtl`);
          await fs.writeFile(op, obj, "utf8");
          await fs.writeFile(mp, mtl, "utf8");
          outputs.push(op, mp);
        }

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
          {
            type: "text",
            text: JSON.stringify({ id: asset.id, format, outputs, atlas: atlasMeta }, null, 2),
          },
        ];

        if (includePreviewImage && previewSprites.length > 0) {
          const contact = composeContactSheet(previewSprites);
          content.push({
            type: "image",
            data: encodePNG(contact).toString("base64"),
            mimeType: "image/png",
          });
        }

        return { content };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "render_room",
    "Render a .room.json isometric office layout into a composited PNG with topological depth sorting",
    {
      roomPath: z.string().optional(),
      room: z.record(z.any()).optional(),
      outPath: z.string().default("out/room.png"),
      frameIndex: z.number().int().min(0).default(0),
      emissiveMode: EmissiveModeSchema.default("baked"),
      includePreviewImage: z.boolean().default(true),
    },
    async ({ roomPath, room: inlineRoom, outPath, frameIndex, emissiveMode, includePreviewImage }) => {
      try {
        let rawRoom: unknown;
        if (inlineRoom) {
          rawRoom = inlineRoom;
        } else {
          const resolvedRoomPath = roomPath
            ? resolveSafeWorkspacePath(absRoot, roomPath)
            : path.join(BUILTIN_ASSETS_DIR, "sample-office.room.json");
          rawRoom = JSON.parse(await fs.readFile(resolvedRoomPath, "utf8"));
        }
        const room = RoomLayoutSchema.parse(rawRoom);
        const pal = await loadWorkspaceSafePalette(absRoot, room.palette);
        const assetsMap = await loadAllAssetsMap(absRoot);
        const rendered = renderRoom(room, assetsMap, pal, { frameIndex, emissiveMode });

        const targetOut = resolveSafeWorkspacePath(absRoot, outPath);
        await fs.mkdir(path.dirname(targetOut), { recursive: true });
        const pngBuf = encodePNG(rendered.main);
        await fs.writeFile(targetOut, pngBuf);
        let emissiveOutPath: string | undefined;
        if (rendered.emissive) {
          emissiveOutPath = targetOut.endsWith(".png")
            ? targetOut.replace(/\.png$/i, "_emissive.png")
            : `${targetOut}_emissive.png`;
          await fs.writeFile(emissiveOutPath, encodePNG(rendered.emissive));
        }

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
          {
            type: "text",
            text: JSON.stringify(
              {
                roomId: room.id,
                outPath: targetOut,
                ...(emissiveOutPath ? { emissiveOutPath } : {}),
                width: rendered.width,
                height: rendered.height,
              },
              null,
              2,
            ),
          },
        ];
        if (includePreviewImage) {
          content.push({ type: "image", data: pngBuf.toString("base64"), mimeType: "image/png" });
        }
        return { content };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "pack_atlas",
    "Pack multiple assets into a combined TexturePacker JSON Hash sprite sheet + .atlas.json",
    {
      assetIds: z.array(z.string().min(1)).min(1),
      name: SafeIdSchema.default("office-atlas"),
      directions: z.array(DirectionSchema).default(["se", "sw", "nw", "ne"]),
      emissiveMode: EmissiveModeSchema.default("both"),
      outDir: z.string().default("out/atlas"),
    },
    async ({ assetIds, name, directions, emissiveMode, outDir }) => {
      try {
        const sprites: AtlasInputSprite[] = [];
        let tilePreset: "64x32" | "64x31" | "32x16" = "64x32";

        for (const id of assetIds) {
          const { asset } = await loadAssetByIdOrPath(absRoot, id);
          tilePreset = asset.tilePreset;
          const pal = await loadWorkspaceSafePalette(absRoot, asset.palette);
          const { frames } = compileAsset(asset);
          for (const dir of directions as Direction[]) {
            for (const f of frames) {
              const r = renderAssetFrame(asset, f.grid, pal, { direction: dir, emissiveMode });
              sprites.push({
                key: `${asset.id}/${dir}/${f.name}`,
                assetId: asset.id,
                direction: dir,
                frameName: f.name,
                durationMs: f.durationMs,
                layer: asset.layer,
                footprintTiles: r.footprintTiles,
                anchor: r.anchor,
                image: r.main,
                emissive: r.emissive,
              });
            }
          }
        }

        const packed = packSpriteAtlas(sprites, {
          imageName: `${name}.png`,
          emissiveImageName: `${name}_emissive.png`,
          tilePreset,
        });
        const targetDir = resolveSafeWorkspacePath(absRoot, outDir);
        await fs.mkdir(targetDir, { recursive: true });
        const sheetPath = path.join(targetDir, `${name}.png`);
        const atlasPath = path.join(targetDir, `${name}.atlas.json`);
        await fs.writeFile(sheetPath, encodePNG(packed.sheet));
        await fs.writeFile(atlasPath, `${JSON.stringify(packed.atlas, null, 2)}\n`, "utf8");
        const outputs = [sheetPath, atlasPath];
        if (packed.emissiveSheet) {
          const ep = path.join(targetDir, `${name}_emissive.png`);
          await fs.writeFile(ep, encodePNG(packed.emissiveSheet));
          outputs.push(ep);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ name, frameCount: Object.keys(packed.atlas.frames).length, outputs }, null, 2),
            },
          ],
        };
      } catch (err) {
        return errResult(err);
      }
    },
  );

  return server;
}

export async function startMcpServer(rootDir: string): Promise<void> {
  const server = createPixcelMcpServer(rootDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
