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
  decodedText: document.getElementById('decodedText'),
  decodedHex: document.getElementById('decodedHex'),
  decodedBase64: document.getElementById('decodedBase64'),
  logBox: document.getElementById('logBox')
};

let BrowserQRCodeReaderClass = null;
let NotFoundExceptionClass = null;
let URDecoderClass = null;

let qrReader = null;
let scanning = false;
let urDecoder = null;
const seenParts = new Set();

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
  el.decodedText.value = '';
  el.decodedHex.value = '';
  el.decodedBase64.value = '';
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

async function startDecodeLoop(deviceId) {
  if (!qrReader) return;
  await qrReader.decodeFromVideoDevice(deviceId, el.video, (result, error) => {
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
    } catch (firstError) {
      log(`指定鏡頭啟動失敗，改用預設鏡頭重試：${firstError instanceof Error ? firstError.message : String(firstError)}`);
      await startDecodeLoop(null);
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
  const [{ BrowserQRCodeReader, NotFoundException }, { URDecoder }] = await Promise.all([
    import('@zxing/library'),
    import('@ngraveio/bc-ur')
  ]);

  BrowserQRCodeReaderClass = BrowserQRCodeReader;
  NotFoundExceptionClass = NotFoundException;
  URDecoderClass = URDecoder;
  qrReader = new BrowserQRCodeReaderClass();
  urDecoder = new URDecoderClass();

  updateProgress();
  clearResult();
  await listCameras();
}

bootstrap().catch((error) => {
  setStatus('初始化失敗，請重整頁面。');
  log(`初始化失敗：${error instanceof Error ? error.message : String(error)}`);
});
