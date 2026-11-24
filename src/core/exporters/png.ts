import { PNG } from "pngjs";

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createRGBAImage(width: number, height: number): RGBAImage {
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  };
}

export function encodePNG(image: RGBAImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png, { colorType: 6 });
}

export function decodePNG(buffer: Buffer): RGBAImage {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}
