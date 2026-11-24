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
        { op: "box", from: [12, 11, 25], to: [19, 19, 27], material: "hair", part: "head" },
        { op: "box", from: [12, 11, 20], to: [19, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [11, 12, 23], to: [12, 17, 26], material: "hair", part: "head" },
        { op: "box", from: [19, 12, 23], to: [20, 17, 26], material: "hair", part: "head" },
        { op: "box", from: [13, 19, 24], to: [18, 19, 25], material: "hair", part: "head" },
      );
      break;
    case "spiky":
      ops.push(
        { op: "box", from: [12, 11, 25], to: [19, 19, 26], material: "hair", part: "head" },
        { op: "box", from: [12, 11, 20], to: [19, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [13, 12, 27], to: [14, 15, 28], material: "hair", part: "head" },
        { op: "box", from: [16, 13, 27], to: [18, 16, 29], material: "hair", part: "head" },
        { op: "box", from: [12, 17, 26], to: [14, 20, 28], material: "hair", part: "head" },
        { op: "box", from: [17, 17, 26], to: [19, 20, 27], material: "hair", part: "head" },
      );
      break;
    case "parted":
      ops.push(
        { op: "box", from: [12, 11, 25], to: [19, 19, 27], material: "hair", part: "head" },
        { op: "box", from: [12, 11, 20], to: [19, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [11, 12, 22], to: [12, 18, 26], material: "hair", part: "head" },
        { op: "box", from: [19, 12, 22], to: [20, 18, 26], material: "hair", part: "head" },
        { op: "box", from: [12, 19, 24], to: [16, 20, 26], material: "hair", part: "head" },
        { op: "box", from: [18, 19, 25], to: [19, 20, 26], material: "hair", part: "head" },
      );
      break;
    case "bob":
      ops.push(
        { op: "box", from: [11, 11, 25], to: [20, 19, 27], material: "hair", part: "head" },
        { op: "box", from: [11, 11, 18], to: [20, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [11, 12, 18], to: [12, 18, 25], material: "hair", part: "head" },
        { op: "box", from: [19, 12, 18], to: [20, 18, 25], material: "hair", part: "head" },
        { op: "box", from: [12, 19, 24], to: [19, 19, 25], material: "hair", part: "head" },
      );
      break;
    case "ponytail":
      ops.push(
        { op: "box", from: [12, 11, 25], to: [19, 19, 27], material: "hair", part: "head" },
        { op: "box", from: [12, 11, 20], to: [19, 12, 25], material: "hair", part: "head" },
        { op: "box", from: [11, 12, 22], to: [12, 17, 26], material: "hair", part: "head" },
        { op: "box", from: [19, 12, 22], to: [20, 17, 26], material: "hair", part: "head" },
        { op: "box", from: [13, 19, 24], to: [18, 19, 25], material: "hair", part: "head" },
        // Tie + slim trailing ponytail behind head
        { op: "box", from: [15, 10, 22], to: [16, 10, 23], material: "accent", part: "head" },
        { op: "box", from: [15, 8, 17], to: [16, 9, 22], material: "hair", part: "head" },
        { op: "box", from: [15, 7, 15], to: [16, 8, 17], material: "hair", part: "head" },
      );
      break;
    case "hood_up":
      ops.push(
        { op: "box", from: [11, 11, 19], to: [20, 19, 27], material: "outfit", part: "head" },
        { op: "box", from: [13, 18, 20], to: [18, 19, 24], material: "skin", part: "head" },
        { op: "box", from: [13, 18, 25], to: [18, 19, 25], material: "hair", part: "head" },
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
    coffee: { color: "#5a3418", kind: "matte" },
    clipboard: { color: "#a9744f", kind: "matte" },
  };

  const sleeveMat = spec.outfitStyle === "tshirt" ? "skin" : "outfit";

  const baseOps: VoxelDslOp[] = [
    // Slim legs (2x3 cross-section, z = 0..8)
    { op: "box", from: [13, 14, 0], to: [14, 17, 1], material: "shoe", part: "leg_l" },
    { op: "box", from: [13, 14, 2], to: [14, 16, 8], material: "pants", part: "leg_l" },
    { op: "box", from: [17, 14, 0], to: [18, 17, 1], material: "shoe", part: "leg_r" },
    { op: "box", from: [17, 14, 2], to: [18, 16, 8], material: "pants", part: "leg_r" },

    // Slim torso (6x4 cross-section, z = 9..17) + neck (z = 18)
    { op: "box", from: [13, 14, 9], to: [18, 17, 17], material: "outfit", part: "torso" },
    { op: "box", from: [15, 15, 18], to: [16, 16, 18], material: "skin", part: "torso" },
    // Outfit-specific details
    ...(spec.outfitStyle === "blazer"
      ? ([
          { op: "box", from: [15, 17, 12], to: [16, 17, 17], material: "outfit_inner", part: "torso" },
          { op: "box", from: [15, 17, 11], to: [16, 17, 15], material: "accent", part: "torso" },
        ] as VoxelDslOp[])
      : spec.outfitStyle === "hoodie"
        ? ([
            { op: "box", from: [13, 13, 16], to: [18, 14, 18], material: "outfit", part: "torso" },
            { op: "box", from: [15, 17, 13], to: [16, 17, 15], material: "accent", part: "torso" },
            { op: "box", from: [15, 14, 12], to: [16, 14, 14], material: "accent", part: "torso" },
          ] as VoxelDslOp[])
        : ([
            { op: "box", from: [15, 17, 16], to: [16, 17, 17], material: "accent", part: "torso" },
          ] as VoxelDslOp[])),

    // Slim arms (2x2 cross-section, z = 10..16)
    { op: "box", from: [11, 15, 15], to: [12, 16, 16], material: "outfit", part: "arm_l" },
    { op: "box", from: [11, 15, 12], to: [12, 16, 14], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [11, 15, 10], to: [12, 16, 11], material: "skin", part: "arm_l" },

    { op: "box", from: [19, 15, 15], to: [20, 16, 16], material: "outfit", part: "arm_r" },
    { op: "box", from: [19, 15, 12], to: [20, 16, 14], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [19, 15, 10], to: [20, 16, 11], material: "skin", part: "arm_r" },

    // Refined chibi head (8x8x7 skin core, z = 19..25)
    { op: "box", from: [12, 12, 19], to: [19, 19, 25], material: "skin", part: "head" },
    // Ears
    { op: "box", from: [11, 15, 21], to: [11, 16, 22], material: "skin", part: "head" },
    { op: "box", from: [20, 15, 21], to: [20, 16, 22], material: "skin", part: "head" },
    // Hair
    ...buildHairOps(spec.hairStyle),
    // Eyes on +Y front face (y = 19)
    { op: "box", from: [13, 19, 21], to: [13, 19, 22], material: "eye", part: "head" },
    { op: "box", from: [18, 19, 21], to: [18, 19, 22], material: "eye", part: "head" },
  ];

  if (spec.glasses) {
    baseOps.push(
      { op: "box", from: [13, 20, 21], to: [14, 20, 22], material: "glasses_frame", part: "head" },
      { op: "box", from: [17, 20, 21], to: [18, 20, 22], material: "glasses_frame", part: "head" },
      { op: "voxel", at: [13, 20, 22], material: "glasses_lens", part: "head" },
      { op: "voxel", at: [18, 20, 22], material: "glasses_lens", part: "head" },
      { op: "box", from: [15, 20, 22], to: [16, 20, 22], material: "glasses_frame", part: "head" },
    );
  }

  if (spec.headset) {
    baseOps.push(
      { op: "box", from: [11, 15, 27], to: [20, 16, 27], material: "headset_body", part: "head" },
      { op: "box", from: [10, 14, 20], to: [11, 17, 23], material: "headset_body", part: "head" },
      { op: "box", from: [20, 14, 20], to: [21, 17, 23], material: "headset_body", part: "head" },
      { op: "box", from: [20, 17, 20], to: [20, 20, 20], material: "headset_body", part: "head" },
      { op: "voxel", at: [19, 20, 20], material: "headset_led", part: "head" },
    );
  }

  // Seated slim legs aligned to chair-office-swivel seat z=11
  const seatedLegsOps: VoxelDslOp[] = [
    // Slim thighs extending forward (+Y)
    { op: "box", from: [13, 16, 11], to: [14, 21, 12], material: "pants", part: "leg_l" },
    { op: "box", from: [17, 16, 11], to: [18, 21, 12], material: "pants", part: "leg_r" },
    // Slim shins & shoes dropping down
    { op: "box", from: [13, 20, 7], to: [14, 21, 11], material: "pants", part: "leg_l" },
    { op: "box", from: [17, 20, 7], to: [18, 21, 11], material: "pants", part: "leg_r" },
    { op: "box", from: [13, 20, 5], to: [14, 22, 6], material: "shoe", part: "leg_l" },
    { op: "box", from: [17, 20, 5], to: [18, 22, 6], material: "shoe", part: "leg_r" },
  ];

  const typingArmsFrame = (leftZ: number, rightZ: number): VoxelDslOp[] => [
    // Slim left arm reaching forward toward keyboard
    { op: "box", from: [11, 15, 16], to: [12, 18, 17], material: "outfit", part: "arm_l" },
    { op: "box", from: [11, 18, leftZ], to: [12, 22, leftZ + 1], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [12, 22, leftZ], to: [13, 23, leftZ + 1], material: "skin", part: "arm_l" },
    // Slim right arm reaching forward toward keyboard
    { op: "box", from: [19, 15, 16], to: [20, 18, 17], material: "outfit", part: "arm_r" },
    { op: "box", from: [19, 18, rightZ], to: [20, 22, rightZ + 1], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [18, 22, rightZ], to: [19, 23, rightZ + 1], material: "skin", part: "arm_r" },
  ];

  const inspectArmFrame = (handZ: number): VoxelDslOp[] => [
    { op: "box", from: [19, 15, 14], to: [20, 18, Math.max(16, handZ)], material: "outfit", part: "arm_r" },
    { op: "box", from: [19, 18, handZ], to: [20, 22, handZ + 1], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [19, 22, handZ], to: [20, 23, handZ + 1], material: "skin", part: "arm_r" },
  ];

  // --- Phase 2b clips: talk / assign / rest_coffee / rest_sleep ---
  // Frame ops are absolute (only base-grid parts are moved by partTransforms), so each clip hides the
  // base arm(s) it replaces and redraws them. Props (mug, clipboard) exist only inside frame ops, so
  // every other clip stays byte-identical.

  // talk: both hands gesture out front, alternating low/high; head nods forward on beat
  const talkArmFrame = (rightZ: number, leftZ: number): VoxelDslOp[] => {
    const arm = (side: "arm_l" | "arm_r", x: number, forearmZ: number): VoxelDslOp[] => [
      { op: "box", from: [x, 15, 15], to: [x + 1, 16, 16], material: "outfit", part: side },
      { op: "box", from: [x, 15, 13], to: [x + 1, 16, 14], material: sleeveMat, part: side },
      // elbow bridge so the upper arm always touches the forearm
      { op: "box", from: [x, 17, 13], to: [x + 1, 17, forearmZ], material: sleeveMat, part: side },
      { op: "box", from: [x, 17, forearmZ], to: [x + 1, 18, forearmZ + 1], material: sleeveMat, part: side },
      { op: "box", from: [x, 19, forearmZ], to: [x + 1, 19, forearmZ + 1], material: "skin", part: side },
    ];
    return [...arm("arm_r", 19, rightZ), ...arm("arm_l", 11, leftZ)];
  };

  // assign: left arm points straight forward (thick, long), right arm holds a clipboard at chest height
  const assignFrame = (pointZ: number, pointLen: number, boardZ: number): VoxelDslOp[] => [
    { op: "box", from: [11, 15, pointZ], to: [12, 16, pointZ + 1], material: "outfit", part: "arm_l" },
    { op: "box", from: [11, 17, pointZ], to: [12, pointLen, pointZ + 1], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [11, pointLen + 1, pointZ], to: [12, pointLen + 2, pointZ + 1], material: "skin", part: "arm_l" },
    // right arm bent, holding clipboard in front of the chest
    { op: "box", from: [19, 15, boardZ], to: [20, 16, boardZ + 3], material: "outfit", part: "arm_r" },
    { op: "box", from: [19, 17, boardZ], to: [20, 18, boardZ + 1], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [20, 16, boardZ], to: [20, 16, boardZ + 1], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [18, 17, boardZ], to: [19, 19, boardZ + 1], material: "skin", part: "arm_r" },
    { op: "box", from: [14, 19, boardZ - 2], to: [18, 19, boardZ + 3], material: "clipboard" },
    { op: "box", from: [15, 20, boardZ - 1], to: [17, 20, boardZ + 2], material: "outfit_inner" },
  ];

  // rest_coffee: both hands cup a mug in front, lifting it toward the mouth (z 13 -> 17)
  const coffeeFrame = (forearmZ: number): VoxelDslOp[] => {
    const arm = (side: "arm_l" | "arm_r", x: number, hand: [number, number]): VoxelDslOp[] => [
      { op: "box", from: [x, 15, 14], to: [x + 1, 16, 16], material: "outfit", part: side },
      { op: "box", from: [x, 15, 12], to: [x + 1, 16, 13], material: sleeveMat, part: side },
      { op: "box", from: [x, 16, 12], to: [x + 1, 16, forearmZ + 1], material: sleeveMat, part: side },
      { op: "box", from: [x, 17, forearmZ], to: [x + 1, 18, forearmZ + 1], material: sleeveMat, part: side },
      { op: "box", from: [hand[0], 19, forearmZ], to: [hand[1], 20, forearmZ + 1], material: "skin", part: side },
    ];
    return [
      ...arm("arm_l", 11, [12, 14]),
      ...arm("arm_r", 19, [17, 19]),
      // mug (3 tall) with coffee surface on top
      { op: "box", from: [15, 20, forearmZ], to: [16, 21, forearmZ + 2], material: "outfit_inner" },
      { op: "box", from: [15, 20, forearmZ + 3], to: [16, 21, forearmZ + 3], material: "coffee" },
    ];
  };

  // rest_sleep: sit_type pose, arms folded over the chest, head drooping; breath = torso +1 z
  const sleepArmsFrame = (b: number): VoxelDslOp[] => [
    { op: "box", from: [11, 14, 14 + b], to: [12, 15, 15 + b], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [11, 14, 16 + b], to: [12, 15, 17 + b], material: "outfit", part: "arm_l" },
    { op: "box", from: [19, 14, 14 + b], to: [20, 15, 15 + b], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [19, 14, 16 + b], to: [20, 15, 17 + b], material: "outfit", part: "arm_r" },
    { op: "box", from: [11, 16, 14 + b], to: [12, 17, 15 + b], material: sleeveMat, part: "arm_l" },
    { op: "box", from: [19, 16, 14 + b], to: [20, 17, 15 + b], material: sleeveMat, part: "arm_r" },
    { op: "box", from: [14, 17, 14 + b], to: [17, 17, 15 + b], material: sleeveMat },
    { op: "box", from: [12, 17, 14 + b], to: [13, 17, 15 + b], material: "skin", part: "arm_l" },
    { op: "box", from: [18, 17, 14 + b], to: [19, 17, 15 + b], material: "skin", part: "arm_r" },
  ];
  const sleepHidden = {
    leg_l: { hide: true },
    leg_r: { hide: true },
    arm_l: { hide: true },
    arm_r: { hide: true },
  };

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
      torso: { pivot: [15, 15, 13] },
      head: { pivot: [15, 15, 22], parent: "torso" },
      arm_l: { pivot: [11, 15, 15], parent: "torso" },
      arm_r: { pivot: [19, 15, 15], parent: "torso" },
      leg_l: { pivot: [13, 15, 8] },
      leg_r: { pivot: [17, 15, 8] },
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
              torso: { translate: [0, -1, 2] },
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
              torso: { translate: [0, -1, 2] },
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
      talk: {
        loop: true,
        frames: [
          {
            name: "talk_0",
            durationMs: 300,
            partTransforms: { arm_l: { hide: true }, arm_r: { hide: true } },
            ops: talkArmFrame(13, 16),
          },
          {
            name: "talk_1",
            durationMs: 300,
            partTransforms: { head: { translate: [0, 1, 0] }, arm_l: { hide: true }, arm_r: { hide: true } },
            ops: talkArmFrame(16, 13),
          },
        ],
      },
      assign: {
        loop: true,
        frames: [
          {
            name: "assign_0",
            durationMs: 420,
            partTransforms: { arm_l: { hide: true }, arm_r: { hide: true } },
            ops: assignFrame(15, 21, 13),
          },
          {
            name: "assign_1",
            durationMs: 420,
            partTransforms: { head: { translate: [0, 1, 0] }, arm_l: { hide: true }, arm_r: { hide: true } },
            ops: assignFrame(16, 23, 14),
          },
        ],
      },
      rest_coffee: {
        loop: true,
        frames: [
          {
            name: "rest_coffee_0",
            durationMs: 700,
            partTransforms: { arm_l: { hide: true }, arm_r: { hide: true } },
            ops: coffeeFrame(13),
          },
          {
            name: "rest_coffee_1",
            durationMs: 700,
            partTransforms: { head: { translate: [0, -1, 0] }, arm_l: { hide: true }, arm_r: { hide: true } },
            ops: coffeeFrame(17),
          },
        ],
      },
      rest_sleep: {
        loop: true,
        frames: [
          {
            name: "rest_sleep_0",
            durationMs: 800,
            partTransforms: {
              torso: { translate: [0, -1, 2] },
              head: { translate: [1, 2, -1] },
              ...sleepHidden,
            },
            ops: [...seatedLegsOps, ...sleepArmsFrame(2)],
          },
          {
            name: "rest_sleep_1",
            durationMs: 800,
            partTransforms: {
              torso: { translate: [0, -1, 3] },
              head: { translate: [1, 3, -1] },
              ...sleepHidden,
            },
            ops: [...seatedLegsOps, ...sleepArmsFrame(3)],
          },
        ],
      },
    },
  });
}
