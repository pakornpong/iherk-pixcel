import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPalette } from "./palette.js";
import { PixcelAssetSchema, SafeIdSchema, type PaletteDefinition, type PixcelAsset } from "./schema.js";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUILTIN_ASSETS_DIR = path.join(PACKAGE_ROOT, "assets", "office-starter");
export const BUILTIN_CHARACTERS_DIR = path.join(PACKAGE_ROOT, "assets", "characters");
export const BUILTIN_PALETTES_DIR = path.join(PACKAGE_ROOT, "assets", "palettes");

export async function loadWorkspaceSafePalette(rootDir: string, nameOrPath: string): Promise<PaletteDefinition> {
  const absRoot = path.resolve(rootDir);
  const workspacePalettesDir = path.join(absRoot, "assets", "palettes");
  if (SafeIdSchema.safeParse(nameOrPath).success) {
    return loadPalette(nameOrPath, [workspacePalettesDir]);
  }
  const safePath = resolveSafeWorkspacePath(absRoot, nameOrPath);
  if (!safePath.endsWith(".palette.json") && !safePath.endsWith(".hex")) {
    throw new Error(`Invalid palette file "${nameOrPath}": expected a palette ID, .palette.json, or .hex file inside workspace`);
  }
  return loadPalette(safePath, [workspacePalettesDir]);
}

export function resolveSafeWorkspacePath(rootDir: string, relPath: string): string {
  const absRoot = path.resolve(rootDir);
  if (path.isAbsolute(relPath)) {
    const resolved = path.resolve(relPath);
    if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
      throw new Error(`Path "${relPath}" escapes workspace root "${absRoot}"`);
    }
    return resolved;
  }
  const resolved = path.resolve(absRoot, relPath);
  if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
    throw new Error(`Path traversal rejected: "${relPath}" escapes workspace root`);
  }
  return resolved;
}

async function scanPixcelFiles(dir: string, out: Map<string, string>, overwrite: boolean): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        await scanPixcelFiles(full, out, overwrite);
      } else if (entry.isFile() && entry.name.endsWith(".pixcel.json")) {
        const id = entry.name.replace(/\.pixcel\.json$/, "");
        if (overwrite || !out.has(id)) {
          out.set(id, full);
        }
      }
    }
  } catch {
    // Directory may not exist
  }
}

export async function listAssetFiles(rootDir: string): Promise<Array<{ id: string; path: string }>> {
  const found = new Map<string, string>();
  // Built-in starter pack & starter characters first, then workspace assets override
  await scanPixcelFiles(BUILTIN_ASSETS_DIR, found, true);
  await scanPixcelFiles(BUILTIN_CHARACTERS_DIR, found, true);
  await scanPixcelFiles(path.join(path.resolve(rootDir), "assets"), found, true);
  return [...found.entries()]
    .map(([id, filePath]) => ({ id, path: filePath }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadAssetByIdOrPath(
  rootDir: string,
  idOrPath: string,
): Promise<{ asset: PixcelAsset; filePath: string }> {
  let filePath: string;
  if (idOrPath.endsWith(".json")) {
    filePath = resolveSafeWorkspacePath(rootDir, idOrPath);
  } else {
    SafeIdSchema.parse(idOrPath);
    const list = await listAssetFiles(rootDir);
    const hit = list.find((a) => a.id === idOrPath);
    if (!hit) {
      throw new Error(`Asset "${idOrPath}" not found in workspace or starter pack`);
    }
    filePath = hit.path;
  }

  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const asset = PixcelAssetSchema.parse(raw);
  return { asset, filePath };
}

export async function loadAllAssetsMap(rootDir: string): Promise<Map<string, PixcelAsset>> {
  const list = await listAssetFiles(rootDir);
  const map = new Map<string, PixcelAsset>();
  for (const item of list) {
    try {
      const raw = JSON.parse(await fs.readFile(item.path, "utf8"));
      const parsed = PixcelAssetSchema.parse(raw);
      map.set(parsed.id, parsed);
    } catch {
      // Skip malformed non-matching json files
    }
  }
  return map;
}
