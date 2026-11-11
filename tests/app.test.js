import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';
import zxing from '@zxing/library';
import cbor from 'cbor-sync';
import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';
import { createBrowserQrReader } from '../src/qr-reader.js';
import { bitmapFor, multipartParts, multipartText } from './qr-fixtures.js';

const originalSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

async function createApp() {
  const elements = new Map();
  const listeners = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', textContent: '', innerHTML: '', disabled: false, style: {}, children: [],
        classList: {
          add(...items) { items.forEach(x => classes.add(x)); },
          remove(...items) { items.forEach(x => classes.delete(x)); },
          contains(x) { return classes.has(x); },
          toggle(x, force = !classes.has(x)) { force ? classes.add(x) : classes.delete(x); return force; }
        },
        addEventListener(name, handler) { listeners.set(`${id}:${name}`, handler); },
        appendChild(child) { this.children.push(child); },
        setAttribute() {}, getAttribute() { return null; }
      });
    }
    return elements.get(id);
  }
  const document = {
    getElementById: element, body: element('body'), documentElement: {},
    querySelectorAll() { return []; }, createElement() { return element(`created-${elements.size}`); }
  };
  const context = vm.createContext({
    Buffer, TextDecoder, Uint8Array, console, document,
    window: { addEventListener(name, handler) { listeners.set(`window:${name}`, handler); } },
    navigator: { language: 'en-US' },
    localStorage: { getItem() { return 'en'; }, setItem() {} },
    MediaStream: class {},
    __zxing: zxing, __ur: { URDecoder }, __csl: CSL, __cbor: cbor,
    createBrowserQrReader(namespace) {
      const reader = createBrowserQrReader(namespace);
      // Only the hardware enumeration boundary is mocked. QR decodeBitmap still
      // runs the real BrowserCodeReader, fallback adapter and ZXing implementation.
      reader.listVideoInputDevices = async () => [];
      return reader;
    }
  });
  let source = originalSource
    .replace("import './style.css';", '')
    .replace("import { Buffer } from 'buffer';", '')
    .replace("import { createBrowserQrReader } from './qr-reader.js';", '')
    .replace("import('@zxing/library')", 'Promise.resolve(__zxing)')
    .replace("import('@ngraveio/bc-ur')", 'Promise.resolve(__ur)')
    .replace("import('@emurgo/cardano-serialization-lib-asmjs')", 'Promise.resolve(__csl)')
    .replace("import('cbor-sync')", 'Promise.resolve(__cbor)');
  const bootstrapCall = source.lastIndexOf('bootstrap().catch(');
  assert.notEqual(bootstrapCall, -1, 'update this harness if application bootstrapping changes');
  source = source.slice(0, bootstrapCall);
  vm.runInContext(source, context, { filename: 'src/main.js' });
  const run = code => vm.runInContext(code, context);
  await run('bootstrap()');
  function feed(text) {
    context.__bitmap = bitmapFor(text);
    run('handlePart(qrReader.decodeBitmap(__bitmap).getText())');
  }
  return { element, context, run, feed, listeners };
}

test('application bootstrap connects the corrected reader; single QR preserves all output formats', async () => {
  const app = await createApp();
  assert.equal(app.run('qrReader.timeBetweenScansMillis'), 150);
  const text = 'Synthetic BC-UR sample 測試';
  const ur = UR.from(text);
  app.feed(UREncoder.encodeSinglePart(ur));
  assert.equal(app.element('decodedText').value, text);
  assert.equal(app.element('decodedHex').value, ur.cbor.toString('hex'));
  assert.equal(app.element('decodedBase64').value, ur.cbor.toString('base64'));
  assert(app.element('rawPanel').classList.contains('overlay-open'));
  app.listeners.get('window:keydown')({ key: 'Escape' });
  assert(!app.element('rawPanel').classList.contains('overlay-open'));
});

test('full QR-to-app path accepts repeated and reversed multipart frames, reset and next payload', async () => {
  const app = await createApp();
  app.feed(multipartParts.at(-1));
  app.feed(multipartParts.at(-1).toUpperCase());
  assert.equal(app.run('seenParts.size'), 1);
  for (const part of multipartParts.slice(0, -1).reverse()) app.feed(part);
  assert.equal(app.element('decodedText').value, multipartText);
  app.run('resetDecoder()');
  app.feed(multipartParts[0]);
  app.run('resetDecoder()');
  assert.equal(app.element('decodedText').value, '');
  assert.equal(app.run('seenParts.size'), 0);
  app.run('scanning=true');
  for (const text of ['first subsequent payload', 'second subsequent payload']) {
    app.feed(UREncoder.encodeSinglePart(UR.from(text)));
    assert.equal(app.element('decodedText').value, text);
    assert.equal(app.run('seenParts.size'), 0);
  }
  assert.equal(app.element('status').textContent, 'Scanning, waiting for new fragments.');
});

test('ordinary and malformed QR payloads do not prevent later valid input', async () => {
  const app = await createApp();
  app.feed('ordinary synthetic QR');
  app.feed('ur:bytes/invalid');
  const ur = UR.fromBuffer(Buffer.from([0, 255, 1, 2, 254]));
  app.feed(UREncoder.encodeSinglePart(ur));
  assert.equal(app.element('decodedHex').value, ur.cbor.toString('hex'));
  assert.equal(app.element('decodedBase64').value, ur.cbor.toString('base64'));
});

test('synthetic Cardano witness parsing and overlay dismissal remain correct', async () => {
  const app = await createApp();
  const witness = cbor.encode({ 0: [[Buffer.alloc(32, 2), Buffer.alloc(64, 3)]] });
  const ur = new UR(cbor.encode({ 1: Buffer.alloc(16, 1), 2: witness }), 'cardano-signature');
  app.feed(UREncoder.encodeSinglePart(ur));
  assert.equal(app.element('cardanoTx').value, '03'.repeat(64));
  assert.match(app.element('cardanoTxDetails').value, /Cardano witness envelope: detected/);
  assert(app.element('cardanoPanel').classList.contains('overlay-open'));
  app.listeners.get('overlayBackdrop:click')();
  assert(!app.element('body').classList.contains('modal-open'));
  assert.equal(app.run('lovelaceToAdaString("1234567")'), '1.234567 ADA');
});

test('mocked camera permission rejection restores idle controls', async () => {
  const app = await createApp();
  app.context.navigator.mediaDevices = { getUserMedia: async () => { throw new Error('synthetic permission denial'); } };
  await app.run('startScan()');
  assert.equal(app.element('startBtn').disabled, false);
  assert.equal(app.element('stopBtn').disabled, true);
  assert.equal(app.run('scanning'), false);
  assert.match(app.element('status').textContent, /Failed to start camera/);
});
