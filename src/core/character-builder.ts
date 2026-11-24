import { z } from "zod";
import {
  HexColorSchema,
  PixcelAssetSchema,
  SafeIdSchema,
  type MaterialDefinition,
  type PixcelAsset,
  type VoxelDslOp,
} from "./schema.js";

const SKIN_PRESETS: Record<string, string> = {
  light: "#f1c9a5",
  warm: "#e0ac82",
  tan: "#c68b59",
  brown: "#8d5524",
  deep: "#5c3818",
};

export const HairStyleSchema = z.enum(["short", "spiky", "bob", "ponytail", "parted", "hood_up"]);
export type HairStyle = z.infer<typeof HairStyleSchema>;

export const OutfitStyleSchema = z.enum(["hoodie", "blazer", "tshirt", "sweater"]);
export type OutfitStyle = z.infer<typeof OutfitStyleSchema>;

export const CharacterSpecSchema = z.object({
  id: SafeIdSchema,
  role: z.string().max(64).optional(),
  palette: z.string().min(1).default("office-night"),
  skinTone: z.string().default("warm"),
  hairStyle: HairStyleSchema.default("short"),
  hairColor: HexColorSchema.default("#2c1e16"),
  outfitStyle: OutfitStyleSchema.default("hoodie"),
  outfitColor: HexColorSchema.default("#2b3a55"),
  accentColor: HexColorSchema.default("#38bdf8"),
  pantsColor: HexColorSchema.default("#1c2230"),
  shoeColor: HexColorSchema.default("#141821"),
  glasses: z.boolean().default(false),
  headset: z.boolean().default(false),
  emissiveAccent: z.boolean().default(false),
});
export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;

function resolveSkinHex(skinTone: string): string {
  const preset = SKIN_PRESETS[skinTone.toLowerCase()];
  if (preset) return preset;
  return HexColorSchema.parse(skinTone);
}

function buildHairOps(hairStyle: HairStyle): VoxelDslOp[] {
  const ops: VoxelDslOp[] = [];
  switch (hairStyle) {
    case "short":
      ops.push(
        { op: "box", from: [10, 10, 25], to: [21, 20, 26], material: "hair", part: "head" },
        { op: "box", from: [11, 11, 27], to: [20, 20, 27], material: "hair", part: "head" },
        { op: "box", from: [10, 10, 19], to: [21, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [10, 12, 22], to: [11, 18, 25], material: "hair", part: "head" },
        { op: "box", from: [20, 12, 22], to: [21, 18, 25], material: "hair", part: "head" },
        { op: "box", from: [12, 20, 24], to: [19, 20, 25], material: "hair", part: "head" },
      );
      break;
    case "spiky":
      ops.push(
        { op: "box", from: [10, 10, 25], to: [21, 20, 26], material: "hair", part: "head" },
        { op: "box", from: [10, 10, 19], to: [21, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [12, 12, 27], to: [14, 15, 28], material: "hair", part: "head" },
        { op: "box", from: [16, 13, 27], to: [19, 17, 29], material: "hair", part: "head" },
        { op: "box", from: [11, 17, 26], to: [14, 21, 28], material: "hair", part: "head" },
        { op: "box", from: [17, 18, 26], to: [20, 21, 27], material: "hair", part: "head" },
      );
      break;
    case "parted":
      ops.push(
        { op: "box", from: [10, 10, 25], to: [21, 20, 26], material: "hair", part: "head" },
        { op: "box", from: [11, 11, 27], to: [20, 20, 27], material: "hair", part: "head" },
        { op: "box", from: [10, 10, 19], to: [21, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [10, 12, 21], to: [11, 19, 25], material: "hair", part: "head" },
        { op: "box", from: [20, 12, 21], to: [21, 19, 25], material: "hair", part: "head" },
        { op: "box", from: [11, 20, 23], to: [16, 21, 26], material: "hair", part: "head" },
        { op: "box", from: [18, 20, 24], to: [20, 21, 26], material: "hair", part: "head" },
      );
      break;
    case "bob":
      ops.push(
        { op: "box", from: [10, 10, 25], to: [21, 20, 27], material: "hair", part: "head" },
        { op: "box", from: [10, 10, 16], to: [21, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [10, 12, 16], to: [11, 19, 25], material: "hair", part: "head" },
        { op: "box", from: [20, 12, 16], to: [21, 19, 25], material: "hair", part: "head" },
        { op: "box", from: [11, 20, 24], to: [20, 20, 25], material: "hair", part: "head" },
      );
      break;
    case "ponytail":
      ops.push(
        { op: "box", from: [10, 10, 25], to: [21, 20, 26], material: "hair", part: "head" },
        { op: "box", from: [11, 11, 27], to: [20, 20, 27], material: "hair", part: "head" },
        { op: "box", from: [10, 10, 19], to: [21, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [10, 12, 21], to: [11, 18, 25], material: "hair", part: "head" },
        { op: "box", from: [20, 12, 21], to: [21, 18, 25], material: "hair", part: "head" },
        { op: "box", from: [12, 20, 24], to: [19, 20, 25], material: "hair", part: "head" },
        // Tie + trailing ponytail behind head
        { op: "box", from: [14, 9, 21], to: [17, 10, 22], material: "accent", part: "head" },
        { op: "box", from: [14, 7, 15], to: [17, 9, 21], material: "hair", part: "head" },
        { op: "box", from: [14, 6, 13], to: [17, 8, 16], material: "hair", part: "head" },
      );
      break;
    case "hood_up":
      ops.push(
        { op: "box", from: [10, 10, 17], to: [21, 20, 27], material: "outfit", part: "head" },
        // Carve front face opening inside hood
        { op: "box", from: [12, 19, 18], to: [19, 20, 24], material: "skin", part: "head" },
        { op: "box", from: [12, 19, 24], to: [19, 20, 25], material: "hair", part: "head" },
      );
      break;
  }
  return ops;
}

export function buildCharacterAsset(rawSpec: CharacterSpec): PixcelAsset {
  const spec = CharacterSpecSchema.parse(rawSpec);
  const skinHex = resolveSkinHex(spec.skinTone);

  const materials: Record<string, MaterialDefinition> = {
    skin: { color: skinHex, kind: "matte" },
    hair: { color: spec.hairColor, kind: "matte" },
    eye: { color: "#141821", kind: "matte" },
    outfit: { color: spec.outfitColor, kind: "matte" },
    outfit_inner: { color: "#e6e9ef", kind: "matte" },
    accent: spec.emissiveAccent
      ? { color: spec.accentColor, kind: "emissive", glowRadius: 1, glowIntensity: 0.35 }
      : { color: spec.accentColor, kind: "matte" },
    pants: { color: spec.pantsColor, kind: "matte" },
    shoe: { color: spec.shoeColor, kind: "matte" },
    glasses_frame: { color: "#171c26", kind: "metal" },
    glasses_lens: { color: "#38bdf8", kind: "glass" },
    headset_body: { color: "#1f2430", kind: "metal" },
    headset_led: { color: "#38bdf8", kind: "emissive", glowRadius: 1, glowIntensity: 0.35 },
  };

  const sleeveMat = spec.outfitStyle === "tshirt" ? "skin" : "outfit";

  const baseOps: VoxelDslOp[] = [
    // Legs (standing)
    { op: "box", from: [12, 14, 0], to: [14, 18, 2], material: "shoe", part: "leg_l" },
    { op: "box", from: [12, 14, 3], to: [14, 17, 7], material: "pants", part: "leg_l" },
    { op: "box", from: [17, 14, 0], to: [19, 18, 2], material: "shoe", part: "leg_r" },
    { op: "box", from: [17, 14, 3], to: [19, 17, 7], material: "pants", part: "leg_r" },

    // Torso
    { op: "box", from: [11, 13, 8], to: [20, 18, 16], material: "outfit", part: "torso" },
    // Outfit-specific details
    ...(spec.outfitStyle === "blazer"
      ? ([
          { op: "box", from: [14, 18, 11], to: [17, 18, 16], material: "outfit_inner", part: "torso" },
          { op: "box", from: [15, 18, 10], to: [16, 18, 15], material: "accent", part: "torso" },
        ] as VoxelDslOp[])
      : spec.outfitStyle === "hoodie"
        ? ([
            { op: "box", from: [12, 12, 15], to: [19, 13, 17], material: "outfit", part: "torso" },
            { op: "box", from: [14, 18, 12], to: [17, 18, 14], material: "accent", part: "torso" },
            { op: "box", from: [14, 13, 11], to: [17, 13, 14], material: "accent", part: "torso" },
          ] as VoxelDslOp[])
        : ([
            { op: "box", from: [14, 18, 15], to: [17, 18, 16], material: "accent", part: "torso" },
          ] as VoxelDslOp[])),

    // Arms (standing)
    { op: "box", from: [9, 14, 14], to: [10, 17, 16], material: "outfit", part: "arm_l" },
    { op: "box", from: [9, 14, 11], to: [10, 17, 13], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [9, 14, 9], to: [10, 17, 10], material: "skin", part: "arm_l" },

    { op: "box", from: [21, 14, 14], to: [22, 17, 16], material: "outfit", part: "arm_r" },
    { op: "box", from: [21, 14, 11], to: [22, 17, 13], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [21, 14, 9], to: [22, 17, 10], material: "skin", part: "arm_r" },

    // Head (chibi 10x10x10)
    { op: "box", from: [11, 11, 17], to: [20, 20, 25], material: "skin", part: "head" },
    // Ears
    { op: "box", from: [10, 15, 20], to: [10, 16, 21], material: "skin", part: "head" },
    { op: "box", from: [21, 15, 20], to: [21, 16, 21], material: "skin", part: "head" },
    // Hair
    ...buildHairOps(spec.hairStyle),
    // Eyes on +Y front face
    { op: "box", from: [13, 20, 20], to: [13, 20, 21], material: "eye", part: "head" },
    { op: "box", from: [18, 20, 20], to: [18, 20, 21], material: "eye", part: "head" },
  ];

  if (spec.glasses) {
    baseOps.push(
      { op: "box", from: [12, 21, 20], to: [14, 21, 22], material: "glasses_frame", part: "head" },
      { op: "box", from: [17, 21, 20], to: [19, 21, 22], material: "glasses_frame", part: "head" },
      { op: "voxel", at: [13, 21, 21], material: "glasses_lens", part: "head" },
      { op: "voxel", at: [18, 21, 21], material: "glasses_lens", part: "head" },
      { op: "box", from: [15, 21, 21], to: [16, 21, 21], material: "glasses_frame", part: "head" },
    );
  }

  if (spec.headset) {
    baseOps.push(
      { op: "box", from: [10, 15, 26], to: [21, 16, 27], material: "headset_body", part: "head" },
      { op: "box", from: [9, 14, 19], to: [10, 17, 23], material: "headset_body", part: "head" },
      { op: "box", from: [21, 14, 19], to: [22, 17, 23], material: "headset_body", part: "head" },
      { op: "box", from: [21, 17, 19], to: [21, 21, 19], material: "headset_body", part: "head" },
      { op: "voxel", at: [20, 21, 19], material: "headset_led", part: "head" },
    );
  }

  // Seated legs & typing arms ops shared by sit_type frames (z aligned to chair-office-swivel seat z=11)
  const seatedLegsOps: VoxelDslOp[] = [
    // Thighs extending forward (+Y)
    { op: "box", from: [12, 16, 11], to: [14, 22, 13], material: "pants", part: "leg_l" },
    { op: "box", from: [17, 16, 11], to: [19, 22, 13], material: "pants", part: "leg_r" },
    // Lower shins & shoes dropping down
    { op: "box", from: [12, 21, 7], to: [14, 23, 11], material: "pants", part: "leg_l" },
    { op: "box", from: [17, 21, 7], to: [19, 23, 11], material: "pants", part: "leg_r" },
    { op: "box", from: [12, 21, 5], to: [14, 24, 6], material: "shoe", part: "leg_l" },
    { op: "box", from: [17, 21, 5], to: [19, 24, 6], material: "shoe", part: "leg_r" },
  ];

  const typingArmsFrame = (leftZ: number, rightZ: number): VoxelDslOp[] => [
    // Left arm extended forward toward keyboard
    { op: "box", from: [9, 15, 16], to: [10, 19, 18], material: "outfit", part: "arm_l" },
    { op: "box", from: [10, 19, leftZ], to: [12, 23, leftZ + 1], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [11, 23, leftZ], to: [13, 25, leftZ + 1], material: "skin", part: "arm_l" },
    // Right arm extended forward toward keyboard
    { op: "box", from: [21, 15, 16], to: [22, 19, 18], material: "outfit", part: "arm_r" },
    { op: "box", from: [19, 19, rightZ], to: [21, 23, rightZ + 1], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [18, 23, rightZ], to: [20, 25, rightZ + 1], material: "skin", part: "arm_r" },
  ];

  const inspectArmFrame = (handZ: number): VoxelDslOp[] => [
    { op: "box", from: [21, 15, 14], to: [22, 19, Math.max(16, handZ)], material: "outfit", part: "arm_r" },
    { op: "box", from: [20, 19, handZ], to: [22, 23, handZ + 1], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [20, 23, handZ], to: [21, 25, handZ + 1], material: "skin", part: "arm_r" },
  ];

  return PixcelAssetSchema.parse({
    schemaVersion: 1,
    id: spec.id,
    category: "character",
    layer: "object",
    outlineMode: "silhouette",
    tilePreset: "64x32",
    voxelsPerTile: 32,
    footprintTiles: [1, 1],
    palette: spec.palette,
    materials,
    parts: {
      torso: { pivot: [15, 15, 12] },
      head: { pivot: [15, 15, 20], parent: "torso" },
      arm_l: { pivot: [10, 15, 15], parent: "torso" },
      arm_r: { pivot: [21, 15, 15], parent: "torso" },
      leg_l: { pivot: [13, 15, 7] },
      leg_r: { pivot: [18, 15, 7] },
    },
    ops: baseOps,
    animations: {
      idle: {
        loop: true,
        frames: [
          { name: "idle_0", durationMs: 650, ops: [] },
          { name: "idle_1", durationMs: 650, ops: [], partTransforms: { torso: { translate: [0, 0, 1] } } },
        ],
      },
      walk: {
        loop: true,
        frames: [
          {
            name: "walk_0",
            durationMs: 180,
            ops: [],
            partTransforms: {
              torso: { translate: [0, 0, 1] },
              leg_l: { translate: [0, 2, 0] },
              leg_r: { translate: [0, -2, 0] },
              arm_l: { translate: [0, -2, 0] },
              arm_r: { translate: [0, 2, 0] },
            },
          },
          { name: "walk_1", durationMs: 180, ops: [] },
          {
            name: "walk_2",
            durationMs: 180,
            ops: [],
            partTransforms: {
              torso: { translate: [0, 0, 1] },
              leg_l: { translate: [0, -2, 0] },
              leg_r: { translate: [0, 2, 0] },
              arm_l: { translate: [0, 2, 0] },
              arm_r: { translate: [0, -2, 0] },
            },
          },
          { name: "walk_3", durationMs: 180, ops: [] },
        ],
      },
      sit_type: {
        loop: true,
        frames: [
          {
            name: "sit_type_0",
            durationMs: 240,
            partTransforms: {
              torso: { translate: [0, -1, 3] },
              leg_l: { hide: true },
              leg_r: { hide: true },
              arm_l: { hide: true },
              arm_r: { hide: true },
            },
            ops: [...seatedLegsOps, ...typingArmsFrame(16, 15)],
          },
          {
            name: "sit_type_1",
            durationMs: 240,
            partTransforms: {
              torso: { translate: [0, -1, 3] },
              leg_l: { hide: true },
              leg_r: { hide: true },
              arm_l: { hide: true },
              arm_r: { hide: true },
            },
            ops: [...seatedLegsOps, ...typingArmsFrame(15, 16)],
          },
        ],
      },
      inspect: {
        loop: true,
        frames: [
          {
            name: "inspect_0",
            durationMs: 480,
            partTransforms: { arm_r: { hide: true } },
            ops: inspectArmFrame(16),
          },
          {
            name: "inspect_1",
            durationMs: 480,
            partTransforms: { torso: { translate: [0, 0, 1] }, arm_r: { hide: true } },
            ops: inspectArmFrame(18),
          },
        ],
      },
    },
  });
}
