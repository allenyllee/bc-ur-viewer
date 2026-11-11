/**
 * Keep perspective-aware detection first. Some dense, otherwise clean QR images
 * contain data patterns that ZXing mistakes for finder patterns. Retrying those
 * frames as a pure symbol bypasses finder selection, not QR error correction.
 * A final 90-degree retry changes the detector's scan order for tilted/dense
 * symbols. PURE_BARCODE is never the normal camera or rotated-frame hint.
 */
export function createQrDecoder(zxing) {
  const {
    QRCodeReader, DecodeHintType, NotFoundException, FormatException, ChecksumException,
    BinaryBitmap, HybridBinarizer, RGBLuminanceSource, ResultPoint
  } = zxing;
  const reader = new QRCodeReader();
  const isDecodeMiss = (error) =>
    error instanceof NotFoundException || error instanceof FormatException || error instanceof ChecksumException;

  return {
    decode(image, hints) {
      try {
        return reader.decode(image, hints);
      } catch (firstError) {
        if (!isDecodeMiss(firstError)) throw firstError;

        // A separate map prevents this frame's fallback from changing subsequent
        // frames into pure-symbol mode (which cannot handle arbitrary angles).
        const fallbackHints = new Map(hints);
        fallbackHints.set(DecodeHintType.PURE_BARCODE, true);
        reader.reset();
        try {
          return reader.decode(image, fallbackHints);
        } catch (fallbackError) {
          if (!isDecodeMiss(fallbackError)) throw fallbackError;
          // A false finder-pattern match depends on scanning order. Retry once
          // with the already thresholded image rotated clockwise, retaining the
          // perspective-aware detector and the normal QR error correction.
          reader.reset();
          try {
            const matrix = image.getBlackMatrix();
            const width = matrix.getWidth();
            const height = matrix.getHeight();
            const pixels = new Uint8ClampedArray(width * height);
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                pixels[x * height + height - 1 - y] = matrix.get(x, y) ? 0 : 255;
              }
            }
            const rotated = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, height, width)));
            const result = reader.decode(rotated, hints);
            // The app currently reads only text, but keep points usable by a
            // future camera overlay in the original frame's coordinate system.
            const points = result.getResultPoints();
            if (points) {
              for (let i = 0; i < points.length; i++) {
                if (points[i]) points[i] = new ResultPoint(points[i].getY(), height - 1 - points[i].getX());
              }
            }
            return result;
          } catch (rotatedError) {
            if (!isDecodeMiss(rotatedError)) throw rotatedError;
            // Preserve BrowserCodeReader's retry and global-binarizer fallback.
            throw firstError;
          }
        }
      }
    },
    reset() {
      reader.reset();
    }
  };
}

export function createBrowserQrReader(zxing) {
  const { BrowserCodeReader, DecodeHintType, BarcodeFormat } = zxing;
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
    [DecodeHintType.TRY_HARDER, true]
  ]);
  // BrowserQRCodeReader takes only a numeric interval, not (hints, interval).
  // BrowserCodeReader's public constructor accepts the reader and hints directly.
  const reader = new BrowserCodeReader(createQrDecoder(zxing), 150, hints);
  reader.timeBetweenDecodingAttempts = 100;
  return reader;
}
