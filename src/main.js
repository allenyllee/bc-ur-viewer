import './style.css';
import { Buffer } from 'buffer';

globalThis.Buffer = globalThis.Buffer || Buffer;

const el = {
  cameraSelect: document.getElementById('cameraSelect'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  resetBtn: document.getElementById('resetBtn'),
  status: document.getElementById('status'),
  video: document.getElementById('video'),
  progressText: document.getElementById('progressText'),
  progressFill: document.getElementById('progressFill'),
  partStats: document.getElementById('partStats'),
  urType: document.getElementById('urType'),
  rawPanel: document.getElementById('rawPanel'),
  cardanoPanel: document.getElementById('cardanoPanel'),
  overlayBackdrop: document.getElementById('overlayBackdrop'),
  cardanoTx: document.getElementById('cardanoTx'),
  cardanoTxDetails: document.getElementById('cardanoTxDetails'),
  decodedText: document.getElementById('decodedText'),
  decodedHex: document.getElementById('decodedHex'),
  decodedBase64: document.getElementById('decodedBase64'),
  logBox: document.getElementById('logBox')
};

let BrowserQRCodeReaderClass = null;
let NotFoundExceptionClass = null;
let URDecoderClass = null;
let CSL = null;
let cborSyncLib = null;

let qrReader = null;
let scanning = false;
let urDecoder = null;
const seenParts = new Set();
let cardanoOverlayOpen = false;
let activeOverlayPanel = null;

function setStatus(message) {
  el.status.textContent = message;
}

function log(message) {
  const now = new Date();
  const stamp = now.toLocaleTimeString('zh-TW', { hour12: false });
  el.logBox.textContent = `[${stamp}] ${message}\n${el.logBox.textContent}`.slice(0, 6000);
}

function updateProgress() {
  if (!urDecoder) {
    el.progressText.textContent = '0%';
    el.progressFill.style.width = '0%';
    el.partStats.textContent = '尚未收到任何 fragment。';
    return;
  }

  let progress = 0;
  if (typeof urDecoder.getProgress === 'function') {
    progress = urDecoder.getProgress();
  } else if (typeof urDecoder.estimatedPercentComplete === 'function') {
    progress = urDecoder.estimatedPercentComplete();
  }
  const percentage = Math.max(0, Math.min(100, Math.round(progress * 100)));
  el.progressText.textContent = `${percentage}%`;
  el.progressFill.style.width = `${percentage}%`;

  const received = urDecoder.receivedPartIndexes?.().length ?? 0;
  const expected = urDecoder.expectedPartCount?.() ?? 0;
  const expectedLabel = expected > 0 ? expected : '?';
  el.partStats.textContent = `已收集 ${received} / ${expectedLabel} 個 fragment`;
}

function clearResult() {
  el.urType.textContent = '-';
  el.cardanoTx.value = '';
  el.cardanoTxDetails.value = '';
  el.decodedText.value = '';
  el.decodedHex.value = '';
  el.decodedBase64.value = '';
  el.cardanoPanel.classList.add('hidden');
  closeCardanoOverlay();
}

function resetDecoder() {
  if (!URDecoderClass) return;
  urDecoder = new URDecoderClass();
  seenParts.clear();
  updateProgress();
  clearResult();
  log('已重置解碼器。');
}

function parseDecodedBuffer(buf) {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const base64 = Buffer.from(bytes).toString('base64');

  let utf8Text = '';
  try {
    utf8Text = new TextDecoder().decode(bytes);
    const printable = /^[\u0009\u000a\u000d\u0020-\u007e\u00a0-\uffff]*$/.test(utf8Text);
    if (!printable) utf8Text = '[非可讀 UTF-8 文字，請改看 Hex/Base64]';
  } catch {
    utf8Text = '[無法轉成 UTF-8，請改看 Hex/Base64]';
  }

  return { hex, base64, utf8Text };
}

function encodeBytesView(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const hex = bytes.toString('hex');
  const base64 = bytes.toString('base64');
  return { hex, base64 };
}

function bufferJsonReplacer(_key, value) {
  if (Buffer.isBuffer(value)) {
    return { type: 'Buffer', hex: value.toString('hex') };
  }
  if (value instanceof Uint8Array) {
    return { type: 'Uint8Array', hex: Buffer.from(value).toString('hex') };
  }
  return value;
}

function tryParseHexString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('0x')) {
    const raw = normalized.slice(2);
    if (/^[0-9a-f]+$/.test(raw) && raw.length >= 40 && raw.length % 2 === 0) {
      return Buffer.from(raw, 'hex');
    }
  }
  if (/^[0-9a-f]+$/.test(normalized) && normalized.length >= 40 && normalized.length % 2 === 0) {
    return Buffer.from(normalized, 'hex');
  }
  return null;
}

function findCardanoBytesByHints(payload, keyHints, minBytes = 20) {
  const candidates = [];

  function scorePath(path) {
    const joined = path.join('.').toLowerCase();
    let score = 1;
    for (const hint of keyHints) {
      if (joined.includes(hint)) score += 3;
    }
    return score;
  }

  function addCandidate(path, value) {
    let bytes = null;
    if (Buffer.isBuffer(value)) {
      bytes = value;
    } else if (value instanceof Uint8Array) {
      bytes = Buffer.from(value);
    } else {
      bytes = tryParseHexString(value);
    }
    if (!bytes || bytes.length < minBytes) return;
    candidates.push({ bytes, path, score: scorePath(path) + Math.min(3, Math.floor(bytes.length / 200)) });
  }

  function walk(node, path, depth) {
    if (depth > 10 || node == null) return;

    addCandidate(path, node);

    if (Array.isArray(node)) {
      node.forEach((child, idx) => walk(child, [...path, String(idx)], depth + 1));
      return;
    }

    if (node instanceof Map) {
      for (const [k, v] of node.entries()) {
        walk(v, [...path, String(k)], depth + 1);
      }
      return;
    }

    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...path, k], depth + 1);
      }
    }
  }

  walk(payload, [], 0);
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score || b.bytes.length - a.bytes.length);
  return candidates[0];
}

function findCardanoTxBytes(payload) {
  return findCardanoBytesByHints(
    payload,
    ['tx', 'transaction', 'txbody', 'body', 'sign_data', 'signdata', 'payload', 'request'],
    20
  );
}

function findCardanoSignatureParts(payload) {
  const signature = findCardanoBytesByHints(
    payload,
    ['signature', 'sig', 'witness', 'cose', 'proof'],
    32
  );
  const publicKey = findCardanoBytesByHints(
    payload,
    ['public', 'pub', 'key'],
    16
  );
  const requestId = findCardanoBytesByHints(
    payload,
    ['request', 'requestid', 'id'],
    8
  );
  return { signature, publicKey, requestId };
}

function decodeAsciiSafe(bytes) {
  try {
    const text = new TextDecoder().decode(bytes);
    const printable = /^[\u0009\u000a\u000d\u0020-\u007e]*$/.test(text);
    return printable ? text : '';
  } catch {
    return '';
  }
}

function normalizeHex(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/^0x/, '');
}

function parseLovelaceLike(value) {
  if (value == null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

function lovelaceToAdaString(lovelaceValue) {
  const v = parseLovelaceLike(lovelaceValue);
  if (v == null) return null;
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = abs / 1000000n;
  const frac = (abs % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${sign}${whole.toString()}.${frac} ADA` : `${sign}${whole.toString()} ADA`;
}

function detectUtxoFromNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || node instanceof Map) return null;
  const txHash = normalizeHex(node.txHash || node.tx_hash || node.transactionHash || node.transaction_id || '');
  const index = node.index ?? node.outputIndex ?? node.tx_index ?? node.output_index;
  const idx = Number(index);
  if (!txHash || !Number.isInteger(idx) || idx < 0) return null;

  const address = node.address || node.addr || '';
  const value = node.value || node.amount || node.outputAmount || node.output_value;
  let lovelace = null;
  let assets = [];

  if (typeof value === 'object' && value !== null) {
    lovelace =
      parseLovelaceLike(
        value.lovelace ?? value.coin ?? value.ada ?? value.coins ?? value.amount ?? value.quantity
      ) ?? null;
    const valueAssets = value.assets || value.multiasset || value.tokens;
    if (Array.isArray(valueAssets)) assets = valueAssets;
  } else {
    lovelace = parseLovelaceLike(value);
  }

  return {
    key: `${txHash}#${idx}`,
    txHash,
    index: idx,
    address: typeof address === 'string' ? address : '',
    lovelace: lovelace == null ? null : lovelace.toString(),
    assets
  };
}

function collectKnownInputsContext(payload) {
  const utxoByRef = new Map();

  function walk(node, depth) {
    if (depth > 12 || node == null) return;

    const detected = detectUtxoFromNode(node);
    if (detected) utxoByRef.set(detected.key, detected);

    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, depth + 1));
      return;
    }
    if (node instanceof Map) {
      for (const v of node.values()) walk(v, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node)) walk(v, depth + 1);
    }
  }

  walk(payload, 0);
  return utxoByRef;
}

function extractMultiAsset(value) {
  if (!value || typeof value.multiasset !== 'function') return [];
  const multiasset = value.multiasset();
  if (!multiasset) return [];

  const result = [];
  const policyIds = multiasset.keys();
  for (let i = 0; i < policyIds.len(); i += 1) {
    const policy = policyIds.get(i);
    const policyHex = policy.to_hex();
    const assets = multiasset.get(policy);
    const assetNames = assets.keys();
    for (let j = 0; j < assetNames.len(); j += 1) {
      const assetName = assetNames.get(j);
      const assetNameBytes = Buffer.from(assetName.name());
      const assetNameHex = assetNameBytes.toString('hex');
      const quantity = assets.get(assetName).to_str();
      result.push({
        policyId: policyHex,
        assetNameHex,
        assetNameAscii: decodeAsciiSafe(assetNameBytes),
        quantity
      });
    }
  }
  return result;
}

function parseCardanoTx(bytes, payloadContext = null) {
  if (!CSL) {
    return { error: 'Cardano parser 未載入' };
  }

  const txBytes = Uint8Array.from(bytes);
  let body = null;
  let parsedAs = '';

  try {
    const tx = CSL.Transaction.from_bytes(txBytes);
    body = tx.body();
    parsedAs = 'Transaction';
  } catch {
    try {
      body = CSL.TransactionBody.from_bytes(txBytes);
      parsedAs = 'TransactionBody';
    } catch (error) {
      return {
        error: `無法解析為 Cardano Tx/TxBody: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  const inputs = [];
  const fromAddresses = new Set();
  const utxoByRef = collectKnownInputsContext(payloadContext);
  let inputTotalLovelace = 0n;
  let inputValueKnown = true;
  const bodyInputs = body.inputs();
  for (let i = 0; i < bodyInputs.len(); i += 1) {
    const input = bodyInputs.get(i);
    const txHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
    const index = input.index();
    const lookup = utxoByRef.get(`${txHash}#${index}`);
    const knownLovelace = parseLovelaceLike(lookup?.lovelace);
    if (knownLovelace == null) {
      inputValueKnown = false;
    } else {
      inputTotalLovelace += knownLovelace;
    }
    if (lookup?.address) fromAddresses.add(lookup.address);
    inputs.push({
      txHash,
      index,
      address: lookup?.address || null,
      lovelace: knownLovelace == null ? null : knownLovelace.toString(),
      assets: lookup?.assets || []
    });
  }

  const outputs = [];
  const toAddresses = new Set();
  let outputTotalLovelace = 0n;
  const bodyOutputs = body.outputs();
  for (let i = 0; i < bodyOutputs.len(); i += 1) {
    const output = bodyOutputs.get(i);
    const amount = output.amount();
    const address = output.address();
    let addressText = '';
    try {
      addressText = address.to_bech32();
    } catch {
      addressText = Buffer.from(address.to_bytes()).toString('hex');
    }
    outputs.push({
      address: addressText,
      lovelace: amount.coin().to_str(),
      assets: extractMultiAsset(amount)
    });
    toAddresses.add(addressText);
    outputTotalLovelace += BigInt(amount.coin().to_str());
  }

  const fee = body.fee?.()?.to_str?.() || '0';
  const feeBigInt = parseLovelaceLike(fee) ?? 0n;
  const ttl = typeof body.ttl === 'function' ? body.ttl() : null;
  const validityStartInterval =
    typeof body.validity_start_interval === 'function' ? body.validity_start_interval() : null;

  const netWithoutChange =
    inputValueKnown && inputTotalLovelace >= outputTotalLovelace + feeBigInt
      ? (inputTotalLovelace - outputTotalLovelace - feeBigInt).toString()
      : null;

  return {
    parsedAs,
    inputCount: inputs.length,
    outputCount: outputs.length,
    fromAddresses: Array.from(fromAddresses),
    toAddresses: Array.from(toAddresses),
    feeLovelace: feeBigInt.toString(),
    feeAda: lovelaceToAdaString(feeBigInt),
    inputTotalLovelace: inputValueKnown ? inputTotalLovelace.toString() : null,
    inputTotalAda: inputValueKnown ? lovelaceToAdaString(inputTotalLovelace) : null,
    outputTotalLovelace: outputTotalLovelace.toString(),
    outputTotalAda: lovelaceToAdaString(outputTotalLovelace),
    balanceDeltaLovelaceExcludingChange: netWithoutChange,
    ttl,
    validityStartInterval,
    inputs,
    outputs
  };
}

function formatCardanoTxDetails(details) {
  if (!details || details.error) {
    return details?.error || '無法解析 Cardano 交易';
  }
  const lines = [];
  lines.push(`Parsed As: ${details.parsedAs}`);
  lines.push(`Inputs: ${details.inputCount}`);
  lines.push(`Outputs: ${details.outputCount}`);
  lines.push(`Fee: ${details.feeLovelace} lovelace (${details.feeAda || 'N/A'})`);
  lines.push(`Input Total: ${details.inputTotalLovelace ?? 'unknown'}${details.inputTotalAda ? ` (${details.inputTotalAda})` : ''}`);
  lines.push(`Output Total: ${details.outputTotalLovelace} (${details.outputTotalAda || 'N/A'})`);
  lines.push(`From: ${details.fromAddresses?.length ? details.fromAddresses.join(', ') : 'unknown (需額外 UTXO 資料)'}`);
  lines.push(`To: ${details.toAddresses?.length ? details.toAddresses.join(', ') : 'unknown'}`);
  if (details.ttl != null) lines.push(`TTL: ${details.ttl}`);
  if (details.validityStartInterval != null) lines.push(`Valid From: ${details.validityStartInterval}`);

  lines.push('');
  lines.push('Outputs:');
  details.outputs.forEach((o, idx) => {
    lines.push(`- [${idx}] ${o.address}`);
    lines.push(`  value: ${o.lovelace} lovelace (${lovelaceToAdaString(o.lovelace) || 'N/A'})`);
    if (o.assets?.length) {
      o.assets.forEach((a) => {
        const assetLabel = a.assetNameAscii ? `${a.assetNameAscii} (${a.assetNameHex})` : a.assetNameHex;
        lines.push(`  asset: ${a.policyId}.${assetLabel} = ${a.quantity}`);
      });
    }
  });

  lines.push('');
  lines.push('Inputs:');
  details.inputs.forEach((i, idx) => {
    const value = i.lovelace == null ? 'unknown' : `${i.lovelace} lovelace (${lovelaceToAdaString(i.lovelace) || 'N/A'})`;
    lines.push(`- [${idx}] ${i.txHash}#${i.index}`);
    lines.push(`  from: ${i.address || 'unknown'}`);
    lines.push(`  value: ${value}`);
  });

  return lines.join('\n');
}

function formatCardanoSignatureDetails(payload) {
  function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (
      value &&
      typeof value === 'object' &&
      value.type === 'Buffer' &&
      Array.isArray(value.data)
    ) {
      return Buffer.from(value.data);
    }
    return null;
  }

  function getByNumericKey(node, keyNum) {
    if (!node || typeof node !== 'object') return null;
    if (node instanceof Map) {
      if (node.has(keyNum)) return node.get(keyNum);
      if (node.has(String(keyNum))) return node.get(String(keyNum));
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(node, keyNum)) return node[keyNum];
    if (Object.prototype.hasOwnProperty.call(node, String(keyNum))) return node[String(keyNum)];
    return null;
  }

  function extractKnownCardanoSignatureFields(node) {
    const requestId = asBuffer(getByNumericKey(node, 1));
    const signatureEnvelope = asBuffer(getByNumericKey(node, 2)) || getByNumericKey(node, 2);
    return { requestId, signatureEnvelope };
  }

  const known = extractKnownCardanoSignatureFields(payload);
  const parts = findCardanoSignatureParts(payload);

  function safeDecodeCbor(bytes) {
    if (!cborSyncLib) return null;
    try {
      return cborSyncLib.decode(Buffer.from(bytes));
    } catch {
      return null;
    }
  }

  function toHexIfBytes(value) {
    if (Buffer.isBuffer(value)) return value.toString('hex');
    if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
    return null;
  }

  function normalizeHeaderMap(value) {
    if (!value) return {};
    if (value instanceof Map) {
      const out = {};
      for (const [k, v] of value.entries()) {
        const key = typeof k === 'number' ? String(k) : String(k);
        out[key] = toHexIfBytes(v) || v;
      }
      return out;
    }
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = toHexIfBytes(v) || v;
      }
      return out;
    }
    return { value };
  }

  function parseCoseSign1(bytes) {
    let decoded = safeDecodeCbor(bytes);
    
    function unwrapToSign1(value, depth = 0) {
      if (depth > 6 || value == null) return null;
      if (Array.isArray(value) && value.length === 4) return value;

      if (value && typeof value === 'object') {
        const maybeTag = value.tag ?? value.tagNumber;
        const maybeValue = value.value;
        if ((maybeTag === 18 || maybeTag === '18') && maybeValue != null) {
          const tagged = unwrapToSign1(maybeValue, depth + 1);
          if (tagged) return tagged;
        }

        if (value instanceof Map) {
          if (value.has(0) || value.has('0')) {
            const direct = unwrapToSign1(value.get(0) ?? value.get('0'), depth + 1);
            if (direct) return direct;
          }
          for (const v of value.values()) {
            const nested = unwrapToSign1(v, depth + 1);
            if (nested) return nested;
          }
        } else {
          if (Object.prototype.hasOwnProperty.call(value, 0) || Object.prototype.hasOwnProperty.call(value, '0')) {
            const direct = unwrapToSign1(value[0] ?? value['0'], depth + 1);
            if (direct) return direct;
          }
          for (const v of Object.values(value)) {
            const nested = unwrapToSign1(v, depth + 1);
            if (nested) return nested;
          }
        }
      }
      return null;
    }

    decoded = unwrapToSign1(decoded);
    if (!Array.isArray(decoded) || decoded.length !== 4) return null;

    const [protectedBytes, unprotectedHeaders, payloadBytes, signature] = decoded;
    const protectedDecoded =
      (Buffer.isBuffer(protectedBytes) || protectedBytes instanceof Uint8Array) && protectedBytes.length > 0
        ? safeDecodeCbor(protectedBytes)
        : null;

    const payloadBuffer =
      Buffer.isBuffer(payloadBytes) || payloadBytes instanceof Uint8Array
        ? Buffer.from(payloadBytes)
        : null;
    const payloadUtf8 = payloadBuffer ? decodeAsciiSafe(payloadBuffer) : '';
    const payloadCbor = payloadBuffer ? safeDecodeCbor(payloadBuffer) : null;
    const sigBuffer =
      Buffer.isBuffer(signature) || signature instanceof Uint8Array ? Buffer.from(signature) : null;

    return {
      protectedHeaders: normalizeHeaderMap(protectedDecoded),
      unprotectedHeaders: normalizeHeaderMap(unprotectedHeaders),
      payloadHex: payloadBuffer ? payloadBuffer.toString('hex') : '',
      payloadUtf8: payloadUtf8 || null,
      payloadCbor:
        payloadCbor && typeof payloadCbor === 'object'
          ? JSON.stringify(payloadCbor, bufferJsonReplacer, 2)
          : payloadCbor ?? null,
      signatureHex: sigBuffer ? sigBuffer.toString('hex') : '',
      signatureLength: sigBuffer ? sigBuffer.length : null
    };
  }

  function unwrapTaggedValue(value, depth = 0) {
    if (depth > 8 || value == null) return value;
    if (value && typeof value === 'object') {
      const maybeTag = value.tag ?? value.tagNumber;
      const maybeValue = value.value;
      if (maybeTag != null && maybeValue != null) {
        return unwrapTaggedValue(maybeValue, depth + 1);
      }
    }
    return value;
  }

  function parseCardanoWitnessEnvelope(bytes) {
    const decoded = safeDecodeCbor(bytes);
    if (!decoded) return null;

    const root = unwrapTaggedValue(decoded);
    let container = root;

    if (container instanceof Map) {
      container = container.get(0) ?? container.get('0') ?? container;
    } else if (typeof container === 'object' && !Array.isArray(container)) {
      container = container[0] ?? container['0'] ?? container;
    }

    container = unwrapTaggedValue(container);
    if (!Array.isArray(container) || container.length < 1) return null;

    let witness = container[0];
    witness = unwrapTaggedValue(witness);
    if (!Array.isArray(witness) || witness.length < 2) return null;

    const pubKey = asBuffer(witness[0]);
    const sig = asBuffer(witness[1]);
    if (!pubKey || !sig) return null;
    if (pubKey.length !== 32 || sig.length !== 64) return null;

    return {
      publicKeyHex: pubKey.toString('hex'),
      signatureHex: sig.toString('hex'),
      publicKeyLength: pubKey.length,
      signatureLength: sig.length
    };
  }

  function collectByteCandidates(node, path = [], depth = 0, out = []) {
    if (depth > 10 || node == null) return out;
    if (Buffer.isBuffer(node) || node instanceof Uint8Array) {
      out.push({ bytes: Buffer.from(node), path: path.join('.') || '(root)' });
      return out;
    }
    if (Array.isArray(node)) {
      node.forEach((child, idx) => collectByteCandidates(child, [...path, String(idx)], depth + 1, out));
      return out;
    }
    if (node instanceof Map) {
      for (const [k, v] of node.entries()) {
        collectByteCandidates(v, [...path, String(k)], depth + 1, out);
      }
      return out;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        collectByteCandidates(v, [...path, k], depth + 1, out);
      }
    }
    return out;
  }

  const candidates = [];
  const knownSignatureBytes = asBuffer(known.signatureEnvelope);
  if (knownSignatureBytes) {
    candidates.push({ bytes: knownSignatureBytes, path: '2(signatureEnvelope)' });
  }
  if (parts.signature) {
    candidates.push({ bytes: parts.signature.bytes, path: parts.signature.path?.join('.') || 'signature(heuristic)' });
  }
  collectByteCandidates(payload).forEach((c) => candidates.push(c));

  let cose = null;
  let coseSourcePath = '';
  for (const candidate of candidates) {
    if (!candidate?.bytes || candidate.bytes.length < 16) continue;
    const parsed = parseCoseSign1(candidate.bytes);
    if (parsed) {
      cose = parsed;
      coseSourcePath = candidate.path;
      break;
    }
  }

  const witness = knownSignatureBytes ? parseCardanoWitnessEnvelope(knownSignatureBytes) : null;
  const lines = [];
  lines.push('Parsed As: Cardano Signature');
  const requestIdBytes = known.requestId || (parts.requestId ? parts.requestId.bytes : null);
  const publicKeyBytes = witness
    ? Buffer.from(witness.publicKeyHex, 'hex')
    : parts.publicKey && parts.signature && !parts.publicKey.bytes.equals(parts.signature.bytes)
      ? parts.publicKey.bytes
      : null;
  const signatureBytesForDisplay = witness
    ? Buffer.from(witness.signatureHex, 'hex')
    : parts.signature
      ? parts.signature.bytes
      : null;
  lines.push(`Signature: ${signatureBytesForDisplay ? `${signatureBytesForDisplay.length} bytes` : 'not found'}`);
  lines.push(`Public Key: ${publicKeyBytes ? `${publicKeyBytes.length} bytes` : 'not found'}`);
  lines.push(`Request ID: ${requestIdBytes ? `${requestIdBytes.length} bytes` : 'not found'}`);
  if (cose) {
    lines.push('COSE_Sign1: detected');
    lines.push(`COSE source path: ${coseSourcePath || '(unknown)'}`);
    const alg = cose.protectedHeaders?.['1'] ?? cose.unprotectedHeaders?.['1'];
    if (alg !== undefined) lines.push(`Algorithm: ${alg}`);
  } else if (witness) {
    lines.push('COSE_Sign1: not detected');
    lines.push('Cardano witness envelope: detected');
  } else {
    lines.push('COSE_Sign1: not detected');
  }
  lines.push('');
  if (signatureBytesForDisplay) {
    lines.push(`signature.hex = ${signatureBytesForDisplay.toString('hex')}`);
  }
  if (publicKeyBytes) {
    lines.push(`publicKey.hex = ${publicKeyBytes.toString('hex')}`);
  }
  if (requestIdBytes) {
    lines.push(`requestId.hex = ${requestIdBytes.toString('hex')}`);
  }
  if (cose) {
    lines.push('');
    lines.push(`cose.signature.hex = ${cose.signatureHex || '(none)'}`);
    if (cose.signatureLength != null) lines.push(`cose.signature.length = ${cose.signatureLength}`);
    lines.push(`cose.payload.hex = ${cose.payloadHex || '(none)'}`);
    if (cose.payloadUtf8) {
      lines.push(`cose.payload.utf8 = ${cose.payloadUtf8}`);
    }
    if (cose.payloadCbor) {
      lines.push('cose.payload.cbor =');
      lines.push(String(cose.payloadCbor));
    }
    if (Object.keys(cose.protectedHeaders || {}).length) {
      lines.push(`protectedHeaders = ${JSON.stringify(cose.protectedHeaders)}`);
    }
    if (Object.keys(cose.unprotectedHeaders || {}).length) {
      lines.push(`unprotectedHeaders = ${JSON.stringify(cose.unprotectedHeaders)}`);
    }
  }
  if (!parts.signature && !parts.publicKey && !parts.requestId) {
    lines.push('未在 payload 中識別出標準 signature/publicKey/requestId 欄位。');
  }
  return {
    summary: lines.join('\n'),
    signatureHex:
      (cose && cose.signatureHex) ||
      (witness && witness.signatureHex) ||
      (parts.signature ? parts.signature.bytes.toString('hex') : '')
  };
}

function setCardanoPanelVisible(visible) {
  if (visible) {
    el.cardanoPanel.classList.remove('hidden');
  } else {
    el.cardanoPanel.classList.add('hidden');
    closeCardanoOverlay();
  }
}

function openCardanoOverlay() {
  if (cardanoOverlayOpen && activeOverlayPanel === el.cardanoPanel) return;
  closeCardanoOverlay();
  cardanoOverlayOpen = true;
  activeOverlayPanel = el.cardanoPanel;
  document.body.classList.add('modal-open');
  el.overlayBackdrop.classList.remove('hidden');
  activeOverlayPanel.classList.add('overlay-open');
}

function openRawOverlay() {
  if (cardanoOverlayOpen && activeOverlayPanel === el.rawPanel) return;
  closeCardanoOverlay();
  cardanoOverlayOpen = true;
  activeOverlayPanel = el.rawPanel;
  document.body.classList.add('modal-open');
  el.overlayBackdrop.classList.remove('hidden');
  activeOverlayPanel.classList.add('overlay-open');
}

function closeCardanoOverlay() {
  if (!cardanoOverlayOpen) return;
  cardanoOverlayOpen = false;
  document.body.classList.remove('modal-open');
  el.overlayBackdrop.classList.add('hidden');
  if (activeOverlayPanel) {
    activeOverlayPanel.classList.remove('overlay-open');
  }
  activeOverlayPanel = null;
}

function bindOverlayDismiss() {
  el.overlayBackdrop.addEventListener('click', () => {
    closeCardanoOverlay();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCardanoOverlay();
    }
  });
}

function bindOverlayTriggers() {
  el.rawPanel.addEventListener('click', () => {
    openRawOverlay();
  });
  el.cardanoPanel.addEventListener('click', () => {
    if (el.cardanoPanel.classList.contains('hidden')) return;
    openCardanoOverlay();
  });
}

function maybeAutoOpenCardanoOverlay() {
  if (el.cardanoPanel.classList.contains('hidden')) return;
  if (cardanoOverlayOpen && activeOverlayPanel === el.cardanoPanel) return;
  openCardanoOverlay();
}

function maybeAutoOpenRawOverlay() {
  if (cardanoOverlayOpen && activeOverlayPanel === el.rawPanel) return;
  openRawOverlay();
}

function handleURSuccess() {
  const ur = urDecoder.resultUR();
  const decoded = ur.decodeCBOR();
  const cborView = encodeBytesView(ur.cbor);
  let utf8Text = '';

  if (Buffer.isBuffer(decoded) || decoded instanceof Uint8Array) {
    const parsed = parseDecodedBuffer(Buffer.from(decoded));
    utf8Text = parsed.utf8Text;
  } else if (typeof decoded === 'string') {
    utf8Text = decoded;
  } else {
    try {
      utf8Text = JSON.stringify(decoded, bufferJsonReplacer, 2);
    } catch {
      utf8Text = '[此 UR payload 為複合資料，無法直接序列化]';
    }
  }

  el.urType.textContent = ur.type;
  el.decodedText.value = utf8Text;
  el.decodedHex.value = cborView.hex;
  el.decodedBase64.value = cborView.base64;

  const urType = typeof ur.type === 'string' ? ur.type.toLowerCase() : '';
  const isCardanoUr = urType.startsWith('cardano-');
  if (isCardanoUr) {
    setCardanoPanelVisible(true);
    maybeAutoOpenCardanoOverlay();
    if (urType === 'cardano-signature') {
      const sig = formatCardanoSignatureDetails(decoded);
      el.cardanoTx.value = sig.signatureHex;
      el.cardanoTxDetails.value = sig.summary;
      log('偵測到 cardano-signature，已改用簽章資料解析。');
    } else {
      const txCandidate = findCardanoTxBytes(decoded);
      if (txCandidate) {
        el.cardanoTx.value = txCandidate.bytes.toString('hex');
        const txDetails = parseCardanoTx(txCandidate.bytes, decoded);
        el.cardanoTxDetails.value = formatCardanoTxDetails(txDetails);
        log(`已抽取 Cardano Tx，來源路徑=${txCandidate.path.join('.') || '(root)'}，長度=${txCandidate.bytes.length} bytes`);
      } else {
        el.cardanoTx.value = '';
        el.cardanoTxDetails.value = '';
        log('未在 Cardano payload 找到可辨識的交易 bytes。');
      }
    }
  } else {
    setCardanoPanelVisible(false);
    maybeAutoOpenRawOverlay();
    el.cardanoTx.value = '';
    el.cardanoTxDetails.value = '';
  }

  setStatus('解碼完成。');
  log(`解碼成功，UR type=${ur.type}，CBOR 長度=${ur.cbor.length} bytes`);
}

function handlePart(rawText) {
  const part = rawText.trim();
  const normalized = part.toLowerCase();
  if (!normalized.startsWith('ur:')) return;
  if (seenParts.has(normalized)) return;

  seenParts.add(normalized);

  try {
    if (!urDecoder || !qrReader) return;
    const accepted = urDecoder.receivePart(normalized);
    if (!accepted) {
      log('收到 UR 片段，但解碼器未接受（可能格式不符）。');
      return;
    }
    updateProgress();
    log(`收到片段：${part.slice(0, 52)}...`);

    if (urDecoder.isComplete()) {
      if (urDecoder.isSuccess()) {
        handleURSuccess();
      } else {
        const err = urDecoder.resultError?.() || '未知錯誤';
        setStatus(`解碼失敗：${err}`);
        log(`解碼失敗：${err}`);
      }
    }
  } catch (error) {
    log(`片段處理錯誤：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listCameras() {
  try {
    if (!qrReader) return;
    let devices = [];
    if (typeof qrReader.listVideoInputDevices === 'function') {
      devices = await qrReader.listVideoInputDevices();
    } else if (navigator.mediaDevices?.enumerateDevices) {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      devices = allDevices.filter((d) => d.kind === 'videoinput');
    } else {
      throw new Error('此瀏覽器不支援 enumerateDevices');
    }

    el.cameraSelect.innerHTML = '';
    for (const [index, device] of devices.entries()) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      el.cameraSelect.appendChild(option);
    }
    if (!devices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '找不到可用鏡頭';
      el.cameraSelect.appendChild(option);
      setStatus('找不到可用鏡頭。');
    }
  } catch (error) {
    setStatus('讀取鏡頭列表失敗。');
    log(`無法列出鏡頭：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('此瀏覽器不支援 getUserMedia');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  stream.getTracks().forEach((t) => t.stop());
}

function buildVideoConstraints(deviceId) {
  const base = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    advanced: [{ torch: false }]
  };

  if (deviceId) {
    return {
      ...base,
      deviceId: { exact: deviceId }
    };
  }

  return {
    ...base,
    facingMode: { ideal: 'environment' }
  };
}

async function tryDisableTorchOnActiveTrack() {
  const stream = el.video?.srcObject;
  if (!(stream instanceof MediaStream)) return;
  const track = stream.getVideoTracks?.()[0];
  if (!track || typeof track.applyConstraints !== 'function') return;

  try {
    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    if (caps?.torch) {
      await track.applyConstraints({ advanced: [{ torch: false }] });
      return;
    }
    await track.applyConstraints({ advanced: [{ fillLightMode: 'off' }] });
  } catch {
    // Ignore: many browsers/devices don't expose torch controls.
  }
}

async function startDecodeLoop(deviceId) {
  if (!qrReader) return;
  const constraints = { video: buildVideoConstraints(deviceId), audio: false };
  await qrReader.decodeFromConstraints(constraints, el.video, (result, error) => {
    if (result) {
      handlePart(result.getText());
    } else if (error) {
      const isNotFound =
        typeof NotFoundExceptionClass === 'function' && error instanceof NotFoundExceptionClass;
      if (isNotFound) return;
      log(`掃描錯誤：${error.message || String(error)}`);
    }
  });
}

async function startScan() {
  if (scanning) return;
  if (!qrReader || !urDecoder) {
    setStatus('初始化中，請稍候再試。');
    return;
  }
  const selectedDeviceId = el.cameraSelect.value || null;

  try {
    await ensureCameraPermission();
    await listCameras();

    scanning = true;
    el.startBtn.disabled = true;
    el.stopBtn.disabled = false;

    setStatus('正在啟動鏡頭...');
    try {
      await startDecodeLoop(selectedDeviceId);
      await tryDisableTorchOnActiveTrack();
    } catch (firstError) {
      log(`指定鏡頭啟動失敗，改用預設鏡頭重試：${firstError instanceof Error ? firstError.message : String(firstError)}`);
      await startDecodeLoop(null);
      await tryDisableTorchOnActiveTrack();
    }

    setStatus('鏡頭已啟動，請將 BC-UR QR 對準鏡頭。');
    log('掃描已開始。');
  } catch (error) {
    qrReader?.reset();
    scanning = false;
    el.startBtn.disabled = false;
    el.stopBtn.disabled = true;
    setStatus('鏡頭啟動失敗，請確認權限或 HTTPS/localhost。');
    log(`鏡頭啟動失敗：${error instanceof Error ? error.message : String(error)}`);
  }
}

function stopScan() {
  if (!scanning) return;
  qrReader.reset();
  scanning = false;
  el.startBtn.disabled = false;
  el.stopBtn.disabled = true;
  setStatus('已停止掃描。');
  log('掃描已停止。');
}

el.startBtn.addEventListener('click', startScan);
el.stopBtn.addEventListener('click', stopScan);
el.resetBtn.addEventListener('click', () => {
  resetDecoder();
  setStatus(scanning ? '掃描中，等待新片段。' : '已重置解碼。');
});

window.addEventListener('beforeunload', () => {
  stopScan();
});

async function bootstrap() {
  const [{ BrowserQRCodeReader, NotFoundException }, { URDecoder }, cardanoSerializationLib, cborSync] = await Promise.all([
    import('@zxing/library'),
    import('@ngraveio/bc-ur'),
    import('@emurgo/cardano-serialization-lib-asmjs'),
    import('cbor-sync')
  ]);

  BrowserQRCodeReaderClass = BrowserQRCodeReader;
  NotFoundExceptionClass = NotFoundException;
  URDecoderClass = URDecoder;
  CSL = cardanoSerializationLib?.default || cardanoSerializationLib;
  cborSyncLib = cborSync?.default || cborSync;
  qrReader = new BrowserQRCodeReaderClass();
  urDecoder = new URDecoderClass();

  updateProgress();
  clearResult();
  bindOverlayDismiss();
  bindOverlayTriggers();
  await listCameras();
}

bootstrap().catch((error) => {
  setStatus('初始化失敗，請重整頁面。');
  log(`初始化失敗：${error instanceof Error ? error.message : String(error)}`);
});
