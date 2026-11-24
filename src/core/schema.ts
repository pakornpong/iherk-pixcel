import { z } from "zod";

export const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, "ID must start with alphanumeric and contain only letters, numbers, '-', '_'");

export const HexColorSchema = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Expected 6- or 8-digit hex color (e.g. #4b3121)");

export const DirectionSchema = z.enum(["se", "sw", "nw", "ne"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const TilePresetSchema = z.enum(["64x32", "64x31", "32x16"]);
export type TilePreset = z.infer<typeof TilePresetSchema>;

export const AssetLayerSchema = z.enum(["floor", "wall", "wall-decor", "object"]);
export type AssetLayer = z.infer<typeof AssetLayerSchema>;

export const OutlineModeSchema = z.enum(["silhouette", "none", "top-only"]);
export type OutlineMode = z.infer<typeof OutlineModeSchema>;

export const MaterialKindSchema = z.enum(["matte", "wood", "metal", "glass", "emissive"]);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

export const EmissiveModeSchema = z.enum(["baked", "split", "both"]);
export type EmissiveMode = z.infer<typeof EmissiveModeSchema>;

export const AnchorModeSchema = z.enum(["bottom-diamond", "center-floor"]);
export type AnchorMode = z.infer<typeof AnchorModeSchema>;

export const Vec3IntSchema = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
export const NonNegVec3IntSchema = z.tuple([
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(0),
]);
export const Vec2IntSchema = z.tuple([z.number().int(), z.number().int()]);

export const MaterialDefinitionSchema = z.object({
  color: HexColorSchema,
  kind: MaterialKindSchema.default("matte"),
  glowRadius: z.number().int().min(0).max(8).optional(),
  glowIntensity: z.number().min(0).max(1).optional(),
});
export type MaterialDefinition = z.infer<typeof MaterialDefinitionSchema>;

const MaterialRefSchema = z.string().min(1).nullable();

const BoxOpSchema = z.object({
  op: z.literal("box"),
  from: NonNegVec3IntSchema,
  to: NonNegVec3IntSchema,
  material: MaterialRefSchema,
  part: z.string().min(1).optional(),
});

const HollowBoxOpSchema = z.object({
  op: z.literal("hollowBox"),
  from: NonNegVec3IntSchema,
  to: NonNegVec3IntSchema,
  thickness: z.number().int().min(1).default(1),
  material: MaterialRefSchema,
  part: z.string().min(1).optional(),
});

const CylinderOpSchema = z.object({
  op: z.literal("cylinder"),
  center: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  zFrom: z.number().int().min(0),
  zTo: z.number().int().min(0),
  radius: z.number().min(0),
  material: MaterialRefSchema,
  part: z.string().min(1).optional(),
});

const SlopeOpSchema = z.object({
  op: z.literal("slope"),
  from: NonNegVec3IntSchema,
  to: NonNegVec3IntSchema,
  axis: z.enum(["+X", "-X", "+Y", "-Y"]),
  material: MaterialRefSchema,
  part: z.string().min(1).optional(),
});

const LineOpSchema = z.object({
  op: z.literal("line"),
  from: NonNegVec3IntSchema,
  to: NonNegVec3IntSchema,
  material: MaterialRefSchema,
  part: z.string().min(1).optional(),
});

const VoxelOpSchema = z.object({
  op: z.literal("voxel"),
  at: NonNegVec3IntSchema,
  material: MaterialRefSchema,
  part: z.string().min(1).optional(),
});

export type VoxelDslOp =
  | z.infer<typeof BoxOpSchema>
  | z.infer<typeof HollowBoxOpSchema>
  | z.infer<typeof CylinderOpSchema>
  | z.infer<typeof SlopeOpSchema>
  | z.infer<typeof LineOpSchema>
  | z.infer<typeof VoxelOpSchema>
  | {
      op: "mirror";
      axis: "x" | "y" | "z";
      pivot: number;
      ops: VoxelDslOp[];
      keepOriginal?: boolean;
    };

export const VoxelDslOpSchema: z.ZodType<VoxelDslOp> = z.lazy(() =>
  z.discriminatedUnion("op", [
    BoxOpSchema,
    HollowBoxOpSchema,
    CylinderOpSchema,
    SlopeOpSchema,
    LineOpSchema,
    VoxelOpSchema,
    z.object({
      op: z.literal("mirror"),
      axis: z.enum(["x", "y", "z"]),
      pivot: z.number(),
      ops: z.array(VoxelDslOpSchema),
      keepOriginal: z.boolean().optional(),
    }),
  ]),
);

export const DecalFaceSchema = z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]);
export type DecalFace = z.infer<typeof DecalFaceSchema>;

export const DecalSchema = z.object({
  face: DecalFaceSchema,
  origin: NonNegVec3IntSchema,
  legend: z.record(z.string().length(1), MaterialRefSchema),
  rows: z.array(z.string().min(1)).min(1),
  part: z.string().min(1).optional(),
});
export type Decal = z.infer<typeof DecalSchema>;

export const PartDefinitionSchema = z.object({
  pivot: Vec3IntSchema,
  parent: z.string().min(1).optional(),
});

export const PartTransformSchema = z.object({
  translate: Vec3IntSchema.optional(),
  rotateZSteps: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export const FrameDefinitionSchema = z.object({
  name: z.string().min(1),
  durationMs: z.number().int().min(0).default(500),
  ops: z.array(VoxelDslOpSchema).default([]),
  decals: z.array(DecalSchema).default([]),
  partTransforms: z.record(z.string(), PartTransformSchema).optional(),
});
export type FrameDefinition = z.infer<typeof FrameDefinitionSchema>;

export const PixcelAssetSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: SafeIdSchema,
  category: z.string().min(1).default("prop"),
  layer: AssetLayerSchema.default("object"),
  outlineMode: OutlineModeSchema.default("silhouette"),
  tilePreset: TilePresetSchema.default("64x32"),
  voxelsPerTile: z.union([z.literal(16), z.literal(32)]).default(32),
  footprintTiles: z.tuple([z.number().int().min(1), z.number().int().min(1)]).default([1, 1]),
  palette: z.string().min(1).default("office-night"),
  materials: z.record(z.string().min(1), MaterialDefinitionSchema),
  parts: z.record(z.string().min(1), PartDefinitionSchema).optional(),
  ops: z.array(VoxelDslOpSchema),
  decals: z.array(DecalSchema).default([]),
  frames: z.array(FrameDefinitionSchema).optional(),
});
export type PixcelAsset = z.infer<typeof PixcelAssetSchema>;

export const WallEdgeSchema = z.enum(["nw", "ne", "corner"]);
export type WallEdge = z.infer<typeof WallEdgeSchema>;

export const RoomLayoutSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: SafeIdSchema,
  tilePreset: TilePresetSchema.default("64x32"),
  palette: z.string().min(1).default("office-night"),
  widthTiles: z.number().int().min(1).max(64),
  depthTiles: z.number().int().min(1).max(64),
  background: HexColorSchema.optional(),
  floors: z
    .array(
      z.object({
        assetId: SafeIdSchema,
        tx: z.number().int().min(0),
        ty: z.number().int().min(0),
        direction: DirectionSchema.default("se"),
      }),
    )
    .default([]),
  walls: z
    .array(
      z.object({
        assetId: SafeIdSchema,
        tx: z.number().int().min(0),
        ty: z.number().int().min(0),
        edge: WallEdgeSchema,
      }),
    )
    .default([]),
  wallDecor: z
    .array(
      z.object({
        assetId: SafeIdSchema,
        tx: z.number().int().min(0),
        ty: z.number().int().min(0),
        edge: z.enum(["nw", "ne"]),
      }),
    )
    .default([]),
  objects: z
    .array(
      z.object({
        assetId: SafeIdSchema,
        tx: z.number().int().min(0),
        ty: z.number().int().min(0),
        direction: DirectionSchema.default("se"),
      }),
    )
    .default([]),
});
export type RoomLayout = z.infer<typeof RoomLayoutSchema>;

export const PaletteSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  colors: z.record(z.string().min(1), HexColorSchema),
});
export type PaletteDefinition = z.infer<typeof PaletteSchema>;

const RectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

export const AtlasFrameSchema = z.object({
  frame: RectSchema,
  sourceSize: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }),
  spriteSourceSize: RectSchema,
  pivot: z.object({ x: z.number(), y: z.number() }),
  isometric: z.object({
    assetId: SafeIdSchema,
    direction: DirectionSchema,
    frameName: z.string().min(1),
    durationMs: z.number().int().min(0),
    layer: AssetLayerSchema,
    footprintTiles: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    anchor: z.object({ x: z.number().int(), y: z.number().int() }),
  }),
});
export type AtlasFrame = z.infer<typeof AtlasFrameSchema>;

export const AtlasSchema = z.object({
  frames: z.record(z.string().min(1), AtlasFrameSchema),
  meta: z.object({
    app: z.literal("iherk-pixcel"),
    version: z.literal("1"),
    image: z.string().min(1),
    emissiveImage: z.string().min(1).optional(),
    format: z.literal("RGBA8888"),
    size: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }),
    scale: z.literal("1"),
    tilePreset: TilePresetSchema,
    stepX: z.number().int().min(1),
    stepY: z.number().int().min(1),
    tileOverlapY: z.number().int().min(0),
  }),
});
export type AtlasMetadata = z.infer<typeof AtlasSchema>;

export const RenderOptionsSchema = z.object({
  directions: z.array(DirectionSchema).min(1).default(["se", "sw", "nw", "ne"]),
  outlineMode: OutlineModeSchema.optional(),
  interiorCreases: z.boolean().default(true),
  emissiveMode: EmissiveModeSchema.default("baked"),
  aoStrength: z.number().min(0).max(1).default(0.5),
  anchorMode: AnchorModeSchema.default("bottom-diamond"),
});
export type RenderOptions = z.infer<typeof RenderOptionsSchema>;
