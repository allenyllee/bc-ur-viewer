import zxing from '@zxing/library';
import { UR, UREncoder } from '@ngraveio/bc-ur';

export const multipartText = 'Synthetic multipart payload 測試 '.repeat(24);
export const multipartParts = new UREncoder(UR.from(multipartText), 100).encodeWhole();

export function bitmapFor(text, { size = 640, angle = 0, scaleX = 1, shear = 0, mirror = false } = {}) {
  const matrix = new zxing.QRCodeWriter().encode(text, zxing.BarcodeFormat.QR_CODE, size, size, new Map());
  const pixels = new Uint8ClampedArray(size * size);
  const radians = angle * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Inverse affine transform keeps every fixture deterministic. Rotation,
      // moderate shear and mirroring exercise the normal detector path.
      const dx = x - center;
      const dy = y - center;
      const ry = -s * dx + c * dy;
      const rx = (c * dx + s * dy - shear * ry) / scaleX;
      const sx = Math.round((mirror ? -rx : rx) + center);
      const sy = Math.round(ry + center);
      pixels[y * size + x] = sx >= 0 && sy >= 0 && sx < size && sy < size && matrix.get(sx, sy) ? 0 : 255;
    }
  }
  return new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels, size, size)));
}

export function blankBitmap() {
  const pixels = new Uint8ClampedArray(320 * 320).fill(255);
  return new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels, 320, 320)));
}
