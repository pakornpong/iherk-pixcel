import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PaletteSchema, type MaterialKind, type PaletteDefinition } from "./schema.js";

export type RGBA = [number, number, number, number];

export interface ShadeRamp {
  highlight: RGBA;
  base: RGBA;
  shadow: RGBA;
  deepShadow: RGBA;
  outline: RGBA;
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILTIN_PALETTES_DIR = path.join(PACKAGE_ROOT, "assets", "palettes");

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function parseHexColor(hex: string): RGBA {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(cleaned)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  const a = cleaned.length === 8 ? parseInt(cleaned.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

export function formatHexColor([r, g, b]: RGBA): string {
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [clampByte(hue2rgb(hn + 1 / 3) * 255), clampByte(hue2rgb(hn) * 255), clampByte(hue2rgb(hn - 1 / 3) * 255)];
}

function shiftHueToward(h: number, targetDeg: number, amountDeg: number): number {
  const diff = ((((targetDeg - h) % 360) + 540) % 360) - 180;
  const step = Math.sign(diff) * Math.min(Math.abs(diff), amountDeg);
  return (h + step + 360) % 360;
}

export function buildShadeRamp(hex: string, kind: MaterialKind): ShadeRamp {
  const base = parseHexColor(hex);
  const [h, s, l] = rgbToHsl(base[0], base[1], base[2]);
  const a = base[3];

  const hiBoost = kind === "metal" || kind === "glass" ? 0.16 : 0.11;
  const shDrop = kind === "metal" ? 0.12 : 0.1;
  const deepDrop = kind === "metal" ? 0.22 : 0.19;

  // Hue-shift highlights slightly warm (toward 48deg yellow-amber) and shadows cool (toward 235deg indigo)
  const hiHue = s > 0.05 ? shiftHueToward(h, 48, 8) : h;
  const shHue = s > 0.05 ? shiftHueToward(h, 235, 10) : h;
  const dpHue = s > 0.05 ? shiftHueToward(h, 240, 16) : h;
  const olHue = s > 0.05 ? shiftHueToward(h, 242, 22) : 235;

  const hiL = Math.min(0.96, l + hiBoost);
  const shL = Math.max(0.05, l - shDrop);
  const dpL = Math.max(0.03, l - deepDrop);
  const olL = Math.max(0.02, Math.min(dpL * 0.6, 0.09));

  const hiRgb = hslToRgb(hiHue, Math.max(0, s * 0.92), hiL);
  const shRgb = hslToRgb(shHue, Math.min(1, s * 1.08), shL);
  const dpRgb = hslToRgb(dpHue, Math.min(1, s * 1.15), dpL);
  const olRgb = hslToRgb(olHue, Math.min(1, Math.max(s * 0.9, 0.2)), olL);

  // Guarantee strict luminance ordering even for near-white or near-black inputs
  const ensureBrighter = (rgb: [number, number, number], ref: RGBA): RGBA => {
    const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    if (lum(rgb) > lum([ref[0], ref[1], ref[2]])) return [rgb[0], rgb[1], rgb[2], a];
    return [clampByte(ref[0] + 18), clampByte(ref[1] + 18), clampByte(ref[2] + 18), a];
  };
  const ensureDarker = (rgb: [number, number, number], ref: RGBA, delta = 12): RGBA => {
    const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    if (lum(rgb) < lum([ref[0], ref[1], ref[2]])) return [rgb[0], rgb[1], rgb[2], a];
    return [clampByte(ref[0] - delta), clampByte(ref[1] - delta), clampByte(ref[2] - delta), a];
  };

  const highlight = ensureBrighter(hiRgb, base);
  const shadow = ensureDarker(shRgb, base, 14);
  const deepShadow = ensureDarker(dpRgb, shadow, 12);
  const outline: RGBA = [
    Math.min(olRgb[0], deepShadow[0]),
    Math.min(olRgb[1], deepShadow[1]),
    Math.min(olRgb[2], deepShadow[2]),
    a,
  ];

  return { highlight, base, shadow, deepShadow, outline };
}

export function parseHexListPalette(name: string, content: string): PaletteDefinition {
  const colors: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let idx = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("//")) continue;
    const rgba = parseHexColor(line);
    colors[`c_${idx}`] = formatHexColor(rgba);
    idx++;
  }
  if (idx === 0) {
    throw new Error(`Palette "${name}" contains no valid hex colors`);
  }
  return PaletteSchema.parse({ name, colors });
}

export function findNearestPaletteColor(
  rgb: [number, number, number],
  palette: PaletteDefinition,
): { name: string; hex: string; rgba: RGBA } {
  let bestName = "";
  let bestHex = "";
  let bestRgba: RGBA = [0, 0, 0, 255];
  let bestDist = Infinity;

  for (const [name, hex] of Object.entries(palette.colors)) {
    const rgba = parseHexColor(hex);
    const dr = rgb[0] - rgba[0];
    const dg = rgb[1] - rgba[1];
    const db = rgb[2] - rgba[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestName = name;
      bestHex = formatHexColor(rgba);
      bestRgba = rgba;
    }
  }

  if (!bestName) {
    throw new Error(`Palette "${palette.name}" has no colors`);
  }
  return { name: bestName, hex: bestHex, rgba: bestRgba };
}

export async function listBuiltinPalettes(searchDirs: string[] = []): Promise<string[]> {
  const dirs = [...searchDirs, BUILTIN_PALETTES_DIR];
  const names = new Set<string>();
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (entry.endsWith(".palette.json")) {
          names.add(entry.replace(/\.palette\.json$/, ""));
        } else if (entry.endsWith(".hex")) {
          names.add(entry.replace(/\.hex$/, ""));
        }
      }
    } catch {
      // Directory may not exist
    }
  }
  return [...names].sort();
}

export async function loadPalette(nameOrPath: string, searchDirs: string[] = []): Promise<PaletteDefinition> {
  const candidates: string[] = [];
  if (nameOrPath.endsWith(".json") || nameOrPath.endsWith(".hex") || path.isAbsolute(nameOrPath)) {
    candidates.push(nameOrPath);
  }
  for (const dir of [...searchDirs, BUILTIN_PALETTES_DIR]) {
    candidates.push(path.join(dir, `${nameOrPath}.palette.json`));
    candidates.push(path.join(dir, `${nameOrPath}.hex`));
    candidates.push(path.join(dir, nameOrPath));
  }

  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, "utf8");
      if (candidate.endsWith(".hex")) {
        return parseHexListPalette(path.basename(candidate, ".hex"), text);
      }
      const parsed = JSON.parse(text);
      return PaletteSchema.parse(parsed);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") continue;
      throw err;
    }
  }

  throw new Error(`Palette not found: "${nameOrPath}"`);
}
