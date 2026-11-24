import * as gifencNs from "gifenc";
import { createRGBAImage, type RGBAImage } from "./png.js";

const gifenc = ((gifencNs as unknown as { default?: typeof gifencNs }).default?.GIFEncoder
  ? (gifencNs as unknown as { default: typeof gifencNs }).default
  : gifencNs);

export function encodeAnimatedGIF(frames: Array<{ image: RGBAImage; durationMs: number }>): Buffer {
  if (frames.length === 0) {
    throw new Error("Cannot encode animated GIF with zero frames");
  }

  let maxW = 1;
  let maxH = 1;
  for (const f of frames) {
    if (f.image.width > maxW) maxW = f.image.width;
    if (f.image.height > maxH) maxH = f.image.height;
  }

  const encoder = gifenc.GIFEncoder();

  for (let i = 0; i < frames.length; i++) {
    const { image, durationMs } = frames[i];
    const canvas = createRGBAImage(maxW, maxH);
    const dx = Math.floor((maxW - image.width) / 2);
    const dy = maxH - image.height; // anchor bottom-center

    for (let y = 0; y < image.height; y++) {
      const srcRow = y * image.width * 4;
      const dstRow = ((dy + y) * maxW + dx) * 4;
      canvas.data.set(image.data.subarray(srcRow, srcRow + image.width * 4), dstRow);
    }

    const palette = gifenc.quantize(canvas.data, 255, { format: "rgba4444" });
    // Reserve index 0 for transparency
    const paletteWithTrans: number[][] = [[0, 0, 0, 0], ...palette];
    const rawIndexed = gifenc.applyPalette(canvas.data, paletteWithTrans, "rgba4444");
    const indexed = new Uint8Array(maxW * maxH);
    for (let p = 0; p < maxW * maxH; p++) {
      indexed[p] = canvas.data[p * 4 + 3] < 64 ? 0 : rawIndexed[p] === 0 ? 1 : rawIndexed[p];
    }

    encoder.writeFrame(indexed, maxW, maxH, {
      palette: paletteWithTrans,
      delay: Math.max(20, durationMs || 200),
      repeat: 0,
      transparent: true,
      transparentIndex: 0,
      dispose: 2,
    });
  }

  encoder.finish();
  return Buffer.from(encoder.bytes());
}
