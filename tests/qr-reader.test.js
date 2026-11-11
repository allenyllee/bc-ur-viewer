import test from 'node:test';
import assert from 'node:assert/strict';
import zxing from '@zxing/library';
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';
import { createQrDecoder, createBrowserQrReader } from '../src/qr-reader.js';
import { bitmapFor, blankBitmap, multipartParts, multipartText } from './qr-fixtures.js';

const hints = () => new Map([[zxing.DecodeHintType.TRY_HARDER, true]]);

test('browser reader receives actual hints and bounded numeric scan intervals', () => {
  const reader = createBrowserQrReader(zxing);
  assert.equal(reader.timeBetweenScansMillis, 150);
  assert.equal(reader.timeBetweenDecodingAttempts, 100);
  assert.equal(reader.hints.get(zxing.DecodeHintType.TRY_HARDER), true);
  assert.deepEqual(reader.hints.get(zxing.DecodeHintType.POSSIBLE_FORMATS), [zxing.BarcodeFormat.QR_CODE]);
  assert.equal(reader.hints.has(zxing.DecodeHintType.PURE_BARCODE), false);
});

test('reproduces the original dense QR finder-pattern failures', () => {
  const reader = new zxing.QRCodeReader();
  const failing = [multipartParts[0], ...multipartParts.slice(6).map(p => p.toUpperCase())];
  for (const part of failing) {
    assert.throws(() => reader.decode(bitmapFor(part), hints()), zxing.NotFoundException);
  }
});

test('all 18 dense QR fixtures decode at two sizes and assemble the exact UR payload', () => {
  for (const size of [640, 800]) {
    for (const uppercase of [false, true]) {
      const browserReader = createBrowserQrReader(zxing);
      const ur = new URDecoder();
      const parts = uppercase ? multipartParts.map(p => p.toUpperCase()) : multipartParts;
      for (const part of [...parts].reverse()) {
        const result = browserReader.decodeBitmap(bitmapFor(part, { size }));
        assert.equal(result.getText(), part);
        ur.receivePart(result.getText().toLowerCase());
      }
      assert.equal(ur.isSuccess(), true);
      assert.equal(Buffer.from(ur.resultUR().decodeCBOR()).toString(), multipartText);
      assert.equal(browserReader.hints.has(zxing.DecodeHintType.PURE_BARCODE), false);
    }
  }
});

test('normal detector still handles rotation, shear and mirrored symbols', () => {
  const text = UREncoder.encodeSinglePart(UR.from('Synthetic camera transform fixture'));
  const variants = [{ angle: 90 }, { angle: 180 }, { angle: 270 }, { angle: 12 }, { angle: -12 }, { scaleX: 0.8, shear: 0.1 }, { mirror: true }];
  for (const variant of variants) {
    const image = bitmapFor(text, variant);
    assert.equal(new zxing.QRCodeReader().decode(image, hints()).getText(), text, JSON.stringify(variant));
    assert.equal(createQrDecoder(zxing).decode(image, hints()).getText(), text, JSON.stringify(variant));
  }
});

test('all 180 dense camera-like fixtures decode, including the original transformed misses', () => {
  const variants = [{}, { angle: 12 }, { angle: -12 }, { scaleX: 0.8, shear: 0.1 }, { mirror: true }];
  const reader = createQrDecoder(zxing);
  for (const size of [640, 800]) {
    for (const uppercase of [false, true]) {
      for (const variant of variants) {
        for (const part of multipartParts) {
          const text = uppercase ? part.toUpperCase() : part;
          assert.equal(reader.decode(bitmapFor(text, { size, ...variant }), hints()).getText(), text);
        }
      }
    }
  }
});

test('blank frames fail normally rather than returning a false positive', () => {
  assert.throws(() => createQrDecoder(zxing).decode(blankBitmap(), hints()), zxing.NotFoundException);
});

test('fallback is bounded, leaves hints unchanged and preserves the original miss', () => {
  const original = new zxing.NotFoundException('normal detector miss');
  let calls = 0;
  class MissReader {
    decode(_image, currentHints) {
      calls++;
      if (calls === 1) { assert.equal(currentHints.has(zxing.DecodeHintType.PURE_BARCODE), false); throw original; }
      assert.equal(currentHints.has(zxing.DecodeHintType.PURE_BARCODE), calls === 2);
      throw new zxing.FormatException('pure miss');
    }
    reset() {}
  }
  const normalHints = hints();
  assert.throws(() => createQrDecoder({ ...zxing, QRCodeReader: MissReader }).decode(blankBitmap(), normalHints), error => error === original);
  assert.equal(calls, 3);
  assert.equal(normalHints.has(zxing.DecodeHintType.PURE_BARCODE), false);
});

test('successful ordinary detection does not run the fallback', () => {
  let calls = 0;
  const expected = {};
  class SuccessReader { decode() { calls++; return expected; } reset() {} }
  assert.equal(createQrDecoder({ ...zxing, QRCodeReader: SuccessReader }).decode({}, hints()), expected);
  assert.equal(calls, 1);
});

test('unexpected primary and fallback errors remain visible', () => {
  for (const failOn of [1, 2, 3]) {
    let calls = 0;
    const bug = new TypeError('synthetic programming error');
    class BrokenReader {
      decode() { if (++calls === failOn) throw bug; throw new zxing.NotFoundException(); }
      reset() {}
    }
    assert.throws(() => createQrDecoder({ ...zxing, QRCodeReader: BrokenReader }).decode(blankBitmap(), hints()), error => error === bug);
    assert.equal(calls, failOn);
  }
});

test('format and checksum misses can use fallback without weakening decoding', () => {
  for (const ExpectedError of [zxing.FormatException, zxing.ChecksumException]) {
    let calls = 0;
    const expected = {};
    class FallbackReader {
      decode(_image, currentHints) {
        if (++calls === 1) throw new ExpectedError();
        assert.equal(currentHints.get(zxing.DecodeHintType.PURE_BARCODE), true);
        return expected;
      }
      reset() {}
    }
    assert.equal(createQrDecoder({ ...zxing, QRCodeReader: FallbackReader }).decode({}, hints()), expected);
    assert.equal(calls, 2);
  }
});

test('rotated fallback maps result points back to a rectangular source frame', () => {
  let calls = 0;
  const points = [new zxing.ResultPoint(4, 8), null, new zxing.ResultPoint(10, 20)];
  class RotatedReader {
    decode(image, currentHints) {
      if (++calls < 3) throw new zxing.NotFoundException();
      assert.equal(image.getWidth(), 40);
      assert.equal(image.getHeight(), 60);
      assert.equal(currentHints.has(zxing.DecodeHintType.PURE_BARCODE), false);
      return { getResultPoints: () => points };
    }
    reset() {}
  }
  const original = new zxing.BitMatrix(60, 40);
  const image = { getBlackMatrix: () => original };
  createQrDecoder({ ...zxing, QRCodeReader: RotatedReader }).decode(image, hints());
  assert.deepEqual(points.map(p => p && [p.getX(), p.getY()]), [[8, 35], null, [20, 29]]);
});

test('BrowserCodeReader retains its global-binarizer fallback and bounded failure path', () => {
  function canvasFor(image) {
    const matrix = image.getBlackMatrix();
    const width = matrix.getWidth();
    const height = matrix.getHeight();
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        data.fill(matrix.get(x, y) ? 0 : 255, offset, offset + 3);
        data[offset + 3] = 255;
      }
    }
    return { width, height, getContext: () => ({ getImageData: () => ({ data }) }) };
  }
  let calls = 0;
  class CountingReader extends zxing.QRCodeReader {
    decode(...args) { calls++; return super.decode(...args); }
  }
  const browserReader = createBrowserQrReader({ ...zxing, QRCodeReader: CountingReader });
  browserReader.createBinaryBitmap = () => blankBitmap();
  browserReader.getCaptureCanvas = () => canvasFor(bitmapFor(multipartParts[0]));
  assert.equal(browserReader.decode({}).getText(), multipartParts[0]);
  assert.equal(calls, 5, 'three primary attempts plus normal/pure global attempts');
  calls = 0;
  browserReader.getCaptureCanvas = () => canvasFor(blankBitmap());
  assert.throws(() => browserReader.decode({}), zxing.NotFoundException);
  assert.equal(calls, 6, 'at most three attempts for each of two binarizers');
});
