#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildCharacterAsset, CharacterSpecSchema } from "../core/character-builder.js";
import { carveFromOrthographicViews, type OrthographicViews } from "../core/carver.js";
import { compileAsset, compileAssetAnimations } from "../core/dsl-compiler.js";
import { packSpriteAtlas, type AtlasInputSprite } from "../core/exporters/atlas.js";
import { encodeAnimatedGIF } from "../core/exporters/gif.js";
import { exportObjMtl } from "../core/exporters/obj.js";
import { decodePNG, encodePNG } from "../core/exporters/png.js";
import { exportSpriteStack } from "../core/exporters/sprite-stack.js";
import { listBuiltinPalettes, loadPalette } from "../core/palette.js";
import { renderAssetFrame } from "../core/postprocess.js";
import { renderRoom } from "../core/room-compositor.js";
import {
  renderAssetAtAngle,
  renderTurntableSequence,
  type LightLockMode,
} from "../core/turntable-rasterizer.js";
import {
  DirectionSchema,
  EmissiveModeSchema,
  OutlineModeSchema,
  PixcelAssetSchema,
  RoomLayoutSchema,
  type Direction,
  type EmissiveMode,
  type OutlineMode,
} from "../core/schema.js";
import { listAssetFiles, loadAllAssetsMap, loadAssetByIdOrPath } from "../core/workspace.js";
import { startMcpServer } from "../mcp/server.js";

function printHelp(): void {
  console.log(`iherk-pixcel — 3D Voxel-to-Isometric Pixel Art CLI & MCP Server

Usage:
  pixcel validate <asset.pixcel.json>
  pixcel create-character --id <name> [--hair short|spiky|bob|ponytail|parted|hood_up] [--outfit hoodie|blazer|tshirt|sweater] [--glasses] [--headset] [--out file]
  pixcel render <asset> [--out dir] [--directions se,sw,nw,ne] [--animation idle|walk|sit_type|inspect|talk|assign|rest_coffee|rest_sleep|all] [--format png|atlas|gif|stack|obj] [--emissive baked|split|both]
  pixcel turntable <asset> [--out dir] [--frames 36] [--pitch 30] [--yaw deg] [--fps 18] [--format gif|atlas|png] [--animation idle] [--outline silhouette|none] [--light camera|world]
  pixcel carve --front front.png [--side side.png] [--top top.png] --id <name> --out <asset.pixcel.json> [--palette office-night] [--depth 4]
  pixcel pack <asset-or-dir...> --out <dir> [--name office-atlas] [--emissive both]
  pixcel render-room <room.json> --out <room.png> [--frame 0] [--emissive baked|split|both]
  pixcel palette list | show <name>
  pixcel preview [--port 4173] [--root .]
  pixcel mcp [--root .]
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  const cwd = process.cwd();
  const paletteDirs = [path.join(cwd, "assets", "palettes")];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  switch (cmd) {
    case "validate": {
      const target = rest[0];
      if (!target) throw new Error("Usage: pixcel validate <asset.pixcel.json>");
      const raw = JSON.parse(await fs.readFile(path.resolve(cwd, target), "utf8"));
      const asset = PixcelAssetSchema.parse(raw);
      const compiled = compileAsset(asset);
      console.log(
        JSON.stringify(
          {
            valid: true,
            id: asset.id,
            voxels: compiled.baseGrid.size,
            frames: compiled.frames.length,
            footprintTiles: asset.footprintTiles,
          },
          null,
          2,
        ),
      );
      break;
    }

    case "create-character": {
      const { values } = parseArgs({
        args: rest,
        options: {
          id: { type: "string" },
          role: { type: "string" },
          skin: { type: "string", default: "warm" },
          hair: { type: "string", default: "short" },
          "hair-color": { type: "string", default: "#2c1e16" },
          outfit: { type: "string", default: "hoodie" },
          "outfit-color": { type: "string", default: "#2b3a55" },
          "accent-color": { type: "string", default: "#38bdf8" },
          "pants-color": { type: "string", default: "#1c2230" },
          glasses: { type: "boolean", default: false },
          headset: { type: "boolean", default: false },
          "emissive-accent": { type: "boolean", default: false },
          palette: { type: "string", default: "office-night" },
          out: { type: "string" },
        },
      });
      if (!values.id) throw new Error("Usage: pixcel create-character --id <name> [--out file.pixcel.json]");
      const spec = CharacterSpecSchema.parse({
        id: values.id,
        role: values.role,
        palette: values.palette,
        skinTone: values.skin,
        hairStyle: values.hair,
        hairColor: values["hair-color"],
        outfitStyle: values.outfit,
        outfitColor: values["outfit-color"],
        accentColor: values["accent-color"],
        pantsColor: values["pants-color"],
        glasses: values.glasses,
        headset: values.headset,
        emissiveAccent: values["emissive-accent"],
      });
      const asset = buildCharacterAsset(spec);
      const outFile = path.resolve(cwd, values.out ?? path.join("assets", "characters", `${asset.id}.pixcel.json`));
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await fs.writeFile(outFile, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
      console.log(`Created character "${asset.id}" -> ${outFile}`);
      break;
    }

    case "render": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          out: { type: "string", default: "out" },
          directions: { type: "string", default: "se,sw,nw,ne" },
          animation: { type: "string" },
          format: { type: "string", default: "atlas" },
          emissive: { type: "string", default: "baked" },
        },
      });
      const target = positionals[0];
      if (!target) throw new Error("Usage: pixcel render <asset> [--out dir]");

      const assetRoot = path.isAbsolute(target) ? path.dirname(target) : cwd;
      const { asset } = await loadAssetByIdOrPath(assetRoot, target);
      const pal = await loadPalette(asset.palette, paletteDirs);
      const allClips = compileAssetAnimations(asset);
      const hasMultiClips = Boolean(asset.animations && Object.keys(asset.animations).length > 0);
      const selectedClips: Array<[string, ReturnType<typeof compileAsset>["frames"]]> = [];

      if (values.animation === "all") {
        for (const entry of allClips.entries()) selectedClips.push(entry);
      } else if (values.animation) {
        const clip = allClips.get(values.animation);
        if (!clip) {
          throw new Error(`Unknown animation "${values.animation}" for asset "${asset.id}". Available: [${[...allClips.keys()].join(", ")}]`);
        }
        selectedClips.push([values.animation, clip]);
      } else {
        const firstKey = allClips.has("idle") ? "idle" : allClips.keys().next().value!;
        selectedClips.push([firstKey, allClips.get(firstKey)!]);
      }

      const directions = (values.directions ?? "se,sw,nw,ne")
        .split(",")
        .map((d) => DirectionSchema.parse(d.trim())) as Direction[];
      const emissiveMode = EmissiveModeSchema.parse(values.emissive ?? "baked") as EmissiveMode;
      const format = values.format ?? "atlas";
      const outDir = path.resolve(cwd, values.out ?? "out");
      await fs.mkdir(outDir, { recursive: true });

      const sprites: AtlasInputSprite[] = [];
      for (const dir of directions) {
        for (const [clipName, frames] of selectedClips) {
          for (const frame of frames) {
            const r = renderAssetFrame(asset, frame.grid, pal, { direction: dir, emissiveMode });
            const key = hasMultiClips ? `${asset.id}/${dir}/${clipName}/${frame.name}` : `${asset.id}/${dir}/${frame.name}`;
            sprites.push({
              key,
              assetId: asset.id,
              direction: dir,
              ...(hasMultiClips ? { animation: clipName } : {}),
              frameName: frame.name,
              durationMs: frame.durationMs,
              layer: asset.layer,
              footprintTiles: r.footprintTiles,
              anchor: r.anchor,
              image: r.main,
              emissive: r.emissive,
            });
            if (format === "png") {
              const suffix = hasMultiClips ? `${dir}_${clipName}_${frame.name}` : `${dir}_${frame.name}`;
              await fs.writeFile(path.join(outDir, `${asset.id}_${suffix}.png`), encodePNG(r.main));
              if (r.emissive) {
                await fs.writeFile(path.join(outDir, `${asset.id}_${suffix}_emissive.png`), encodePNG(r.emissive));
              }
            }
          }
        }
      }

      const firstGrid = selectedClips[0][1][0].grid;
      if (format === "atlas") {
        const packed = packSpriteAtlas(sprites, {
          imageName: `${asset.id}.png`,
          emissiveImageName: `${asset.id}_emissive.png`,
          tilePreset: asset.tilePreset,
        });
        await fs.writeFile(path.join(outDir, `${asset.id}.png`), encodePNG(packed.sheet));
        await fs.writeFile(path.join(outDir, `${asset.id}.atlas.json`), `${JSON.stringify(packed.atlas, null, 2)}\n`);
        if (packed.emissiveSheet) {
          await fs.writeFile(path.join(outDir, `${asset.id}_emissive.png`), encodePNG(packed.emissiveSheet));
        }
      } else if (format === "gif") {
        const gif = encodeAnimatedGIF(sprites.map((s) => ({ image: s.image, durationMs: s.durationMs || 300 })));
        await fs.writeFile(path.join(outDir, `${asset.id}.gif`), gif);
      } else if (format === "stack") {
        const stack = exportSpriteStack(firstGrid, asset);
        await fs.writeFile(path.join(outDir, `${asset.id}_stack.png`), encodePNG(stack));
      } else if (format === "obj") {
        const { obj, mtl } = exportObjMtl(firstGrid, asset, `${asset.id}.mtl`);
        await fs.writeFile(path.join(outDir, `${asset.id}.obj`), obj);
        await fs.writeFile(path.join(outDir, `${asset.id}.mtl`), mtl);
      } else if (format !== "png") {
        throw new Error(`Unsupported format "${format}". Expected: png | atlas | gif | stack | obj`);
      }

      console.log(`Rendered ${asset.id} (${format}) to ${outDir}`);
      break;
    }

    case "carve": {
      const { values } = parseArgs({
        args: rest,
        options: {
          front: { type: "string" },
          side: { type: "string" },
          top: { type: "string" },
          back: { type: "string" },
          left: { type: "string" },
          bottom: { type: "string" },
          id: { type: "string" },
          out: { type: "string" },
          palette: { type: "string", default: "office-night" },
          depth: { type: "string", default: "4" },
          vpt: { type: "string", default: "32" },
        },
      });
      if (!values.id || !values.out) {
        throw new Error("Usage: pixcel carve --front a.png [--side b.png] [--top c.png] --id <id> --out <file>");
      }
      const readPng = async (p?: string) => (p ? decodePNG(await fs.readFile(path.resolve(cwd, p))) : undefined);
      const views: OrthographicViews = {
        front: await readPng(values.front),
        side: await readPng(values.side),
        top: await readPng(values.top),
        back: await readPng(values.back),
        left: await readPng(values.left),
        bottom: await readPng(values.bottom),
      };
      const pal = await loadPalette(values.palette ?? "office-night", paletteDirs);
      const parsedDepth = Number(values.depth ?? "4");
      if (!Number.isInteger(parsedDepth) || parsedDepth < 1 || parsedDepth > 512) {
        throw new Error(`Invalid --depth "${values.depth}": expected an integer between 1 and 512`);
      }
      const parsedVpt = Number(values.vpt ?? "32");
      if (parsedVpt !== 16 && parsedVpt !== 32) {
        throw new Error(`Invalid --vpt "${values.vpt}": expected 16 or 32`);
      }
      const asset = carveFromOrthographicViews(views, {
        id: values.id,
        palette: pal,
        depth: parsedDepth,
        voxelsPerTile: parsedVpt,
      });
      const outFile = path.resolve(cwd, values.out);
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await fs.writeFile(outFile, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
      console.log(`Carved ${asset.id} (${asset.ops.length} ops) -> ${outFile}`);
      break;
    }

    case "pack": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          out: { type: "string", default: "out/atlas" },
          name: { type: "string", default: "office-atlas" },
          directions: { type: "string", default: "se,sw,nw,ne" },
          emissive: { type: "string", default: "both" },
        },
      });
      const targets = positionals.length > 0 ? positionals : (await listAssetFiles(cwd)).map((a) => a.id);
      const directions = (values.directions ?? "se,sw,nw,ne")
        .split(",")
        .map((d) => DirectionSchema.parse(d.trim())) as Direction[];
      const emissiveMode = EmissiveModeSchema.parse(values.emissive ?? "both") as EmissiveMode;

      const sprites: AtlasInputSprite[] = [];
      let tilePreset: "64x32" | "64x31" | "32x16" = "64x32";
      for (const target of targets) {
        const stat = await fs.stat(path.resolve(cwd, target)).catch(() => null);
        const items: string[] = [];
        if (stat?.isDirectory()) {
          const entries = await fs.readdir(path.resolve(cwd, target));
          for (const e of entries) {
            if (e.endsWith(".pixcel.json")) items.push(path.join(target, e));
          }
        } else {
          items.push(target);
        }
        for (const item of items) {
          const { asset } = await loadAssetByIdOrPath(cwd, item);
          tilePreset = asset.tilePreset;
          const pal = await loadPalette(asset.palette, paletteDirs);
          const { frames } = compileAsset(asset);
          for (const dir of directions) {
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
      }

      const name = values.name ?? "office-atlas";
      const packed = packSpriteAtlas(sprites, {
        imageName: `${name}.png`,
        emissiveImageName: `${name}_emissive.png`,
        tilePreset,
      });
      const outDir = path.resolve(cwd, values.out ?? "out/atlas");
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, `${name}.png`), encodePNG(packed.sheet));
      await fs.writeFile(path.join(outDir, `${name}.atlas.json`), `${JSON.stringify(packed.atlas, null, 2)}\n`);
      if (packed.emissiveSheet) {
        await fs.writeFile(path.join(outDir, `${name}_emissive.png`), encodePNG(packed.emissiveSheet));
      }
      console.log(`Packed ${sprites.length} sprites -> ${path.join(outDir, `${name}.atlas.json`)}`);
      break;
    }

    case "render-room": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          out: { type: "string", default: "out/room.png" },
          frame: { type: "string", default: "0" },
          emissive: { type: "string", default: "baked" },
        },
      });
      const roomFile = positionals[0];
      if (!roomFile) throw new Error("Usage: pixcel render-room <room.json> --out room.png");
      const room = RoomLayoutSchema.parse(JSON.parse(await fs.readFile(path.resolve(cwd, roomFile), "utf8")));
      const pal = await loadPalette(room.palette, paletteDirs);
      const assetsMap = await loadAllAssetsMap(cwd);
      const parsedFrame = Number(values.frame ?? "0");
      if (!Number.isInteger(parsedFrame) || parsedFrame < 0) {
        throw new Error(`Invalid --frame "${values.frame}": expected a non-negative integer`);
      }
      const rendered = renderRoom(room, assetsMap, pal, {
        frameIndex: parsedFrame,
        emissiveMode: EmissiveModeSchema.parse(values.emissive ?? "baked"),
      });
      const outFile = path.resolve(cwd, values.out ?? "out/room.png");
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await fs.writeFile(outFile, encodePNG(rendered.main));
      if (rendered.emissive) {
        const emissiveFile = outFile.endsWith(".png")
          ? outFile.replace(/\.png$/i, "_emissive.png")
          : `${outFile}_emissive.png`;
        await fs.writeFile(emissiveFile, encodePNG(rendered.emissive));
      }
      console.log(`Rendered room "${room.id}" (${rendered.width}x${rendered.height}) -> ${outFile}`);
      break;
    }

    case "turntable": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          out: { type: "string", default: "out" },
          frames: { type: "string", default: "36" },
          pitch: { type: "string", default: "30" },
          yaw: { type: "string" },
          fps: { type: "string", default: "18" },
          scale: { type: "string", default: "1" },
          format: { type: "string", default: "gif" },
          animation: { type: "string" },
          frame: { type: "string", default: "0" },
          outline: { type: "string" },
          light: { type: "string", default: "camera" },
        },
      });
      const target = positionals[0];
      if (!target) throw new Error("Usage: pixcel turntable <asset> [--out dir] [--frames 36] [--format gif|atlas|png]");

      const assetRoot = path.isAbsolute(target) ? path.dirname(target) : cwd;
      const { asset } = await loadAssetByIdOrPath(assetRoot, target);
      const pal = await loadPalette(asset.palette, paletteDirs);
      const clips = compileAssetAnimations(asset);
      const clipName = values.animation ?? (clips.has("idle") ? "idle" : clips.keys().next().value!);
      const clipFrames = clips.get(clipName);
      if (!clipFrames) {
        throw new Error(`Unknown animation "${clipName}" for asset "${asset.id}". Available: [${[...clips.keys()].join(", ")}]`);
      }
      const frameIdx = Math.max(0, Number.parseInt(values.frame ?? "0", 10) || 0);
      const grid = clipFrames[frameIdx % clipFrames.length].grid;

      const pitchDeg = Number(values.pitch ?? 30);
      const pixelScale = Number(values.scale ?? 1);
      const outlineMode: OutlineMode | undefined = values.outline ? OutlineModeSchema.parse(values.outline) : undefined;
      const lightLock = (values.light === "world" ? "world" : "camera") as LightLockMode;
      const outDir = path.resolve(cwd, values.out ?? "out");
      await fs.mkdir(outDir, { recursive: true });

      if (values.yaw !== undefined) {
        const yawDeg = Number(values.yaw);
        const r = renderAssetAtAngle(asset, grid, pal, { yawDeg, pitchDeg, pixelScale, outlineMode, lightLock });
        const outPath = path.join(outDir, `${asset.id}_y${Math.round(yawDeg)}_p${Math.round(pitchDeg)}.png`);
        await fs.writeFile(outPath, encodePNG(r.image));
        console.log(`Rendered single turntable view (${r.image.width}x${r.image.height}) -> ${outPath}`);
        break;
      }

      const frameCount = Math.max(4, Math.min(180, Number.parseInt(values.frames ?? "36", 10) || 36));
      const fps = Math.max(1, Math.min(60, Number.parseInt(values.fps ?? "18", 10) || 18));
      const seq = renderTurntableSequence(asset, grid, pal, {
        frames: frameCount,
        pitchDeg,
        pixelScale,
        outlineMode,
        lightLock,
      });

      const fmt = (values.format ?? "gif").toLowerCase();
      if (fmt === "gif") {
        const durationMs = Math.max(20, Math.round(1000 / fps));
        const gif = encodeAnimatedGIF(seq.map((s) => ({ image: s.image, durationMs })));
        const outPath = path.join(outDir, `${asset.id}_360.gif`);
        await fs.writeFile(outPath, gif);
        console.log(`Exported ${frameCount}-frame 360° GIF -> ${outPath}`);
      } else if (fmt === "atlas") {
        const sprites: AtlasInputSprite[] = seq.map((s, idx) => ({
          key: `${asset.id}/angle_${String(idx).padStart(3, "0")}_${Math.round(s.yawDeg)}deg`,
          assetId: asset.id,
          direction: "se",
          frameName: `angle_${String(idx).padStart(3, "0")}`,
          durationMs: Math.round(1000 / fps),
          layer: asset.layer,
          footprintTiles: asset.footprintTiles,
          anchor: s.anchor,
          image: s.image,
        }));
        const packed = packSpriteAtlas(sprites, {
          imageName: `${asset.id}_turntable_${frameCount}.png`,
          tilePreset: asset.tilePreset,
        });
        const pngPath = path.join(outDir, `${asset.id}_turntable_${frameCount}.png`);
        const jsonPath = path.join(outDir, `${asset.id}_turntable_${frameCount}.atlas.json`);
        await fs.writeFile(pngPath, encodePNG(packed.sheet));
        await fs.writeFile(jsonPath, `${JSON.stringify(packed.atlas, null, 2)}\n`, "utf8");
        console.log(`Exported ${frameCount}-angle atlas -> ${pngPath} & ${jsonPath}`);
      } else if (fmt === "png") {
        for (let i = 0; i < seq.length; i++) {
          const s = seq[i];
          const outPath = path.join(outDir, `${asset.id}_a${String(i).padStart(3, "0")}_${Math.round(s.yawDeg)}deg.png`);
          await fs.writeFile(outPath, encodePNG(s.image));
        }
        console.log(`Exported ${frameCount} PNG angles -> ${outDir}`);
      } else {
        throw new Error(`Unsupported turntable format "${fmt}". Use gif, atlas, or png.`);
      }
      break;
    }

    case "palette": {
      const sub = rest[0];
      if (sub === "list") {
        const list = await listBuiltinPalettes(paletteDirs);
        console.log(JSON.stringify(list, null, 2));
      } else if (sub === "show" && rest[1]) {
        const pal = await loadPalette(rest[1], paletteDirs);
        console.log(JSON.stringify(pal, null, 2));
      } else {
        throw new Error("Usage: pixcel palette list | show <name>");
      }
      break;
    }

    case "preview": {
      const { values } = parseArgs({
        args: rest,
        options: {
          port: { type: "string", default: "4173" },
          root: { type: "string", default: cwd },
        },
      });
      const mod = await import("../preview/server.js");
      const srv = await mod.startPreviewServer({
        rootDir: path.resolve(cwd, values.root ?? cwd),
        port: Number(values.port ?? 4173),
      });
      console.log(`iherk-pixcel preview running at ${srv.url}`);
      break;
    }

    case "mcp": {
      const { values } = parseArgs({
        args: rest,
        options: {
          root: { type: "string", default: cwd },
        },
      });
      await startMcpServer(path.resolve(cwd, values.root ?? cwd));
      break;
    }

    default:
      throw new Error(`Unknown command "${cmd}". Run "pixcel --help" for usage.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
