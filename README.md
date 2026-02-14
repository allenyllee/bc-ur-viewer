# BC-UR Fountain Viewer

[繁體中文 README](README.zh-TW.md)

A static-deployable web app that uses the browser camera to scan QR codes and decode BC-UR (`ur:...`) including fountain fragments.

### Features

- Use system camera via browser (`getUserMedia`)
- Scan QR with ZXing
- Accumulate and decode BC-UR fountain fragments (`@ngraveio/bc-ur`)
- Prefer rear camera by default; front camera is mirrored while rear camera is not
- Built-in i18n UI (English / Traditional Chinese), with persisted preference
- Show decode progress, UR type, and payload (JSON/UTF-8, Hex, Base64)
- Continue scanning the next QR immediately after a successful decode (no manual restart needed)
- Built-in scan guide frame and quiet-zone hint to improve mobile recognition
- For non-Cardano URs: show Raw Data panel and auto-open Raw overlay
- For Cardano URs: show Cardano panel and auto-open Cardano overlay
- Parse Cardano `sign-request` (inputs/outputs, addresses, fee, TTL, amount summary)
- Parse Cardano `signature` (requestId, witness envelope public key/signature)

### Usage

1. Switch language from the top-right selector (English / 繁體中文)
2. Select camera and click `Start Scan`
3. Point camera to UR QR codes (single or multi-part)
4. Click backdrop or press `Esc` to close overlay and return to layout

### Development

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

Build output is in `dist/`, ready for static hosting (GitHub Pages / Netlify / Cloudflare Pages / S3 static hosting).

### Preview

### 1) Development Preview (Recommended)

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

- Local: `http://localhost:5173`
- LAN devices: `http://<your-LAN-IP>:5173`

### 2) Preview Built Output

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

- Local: `http://localhost:4173`
- LAN devices: `http://<your-LAN-IP>:4173`

### 3) HTTPS on Mobile (Camera Testing)

Mobile browsers usually require `HTTPS` for camera access (`localhost` is an exception).  
Use Cloudflare Tunnel for quick HTTPS:

1. Start dev server:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

2. In another terminal:

```bash
cloudflared tunnel --url http://localhost:5173
```

3. Open the generated `https://xxxx.trycloudflare.com` URL on mobile.

Notes:
- On Windows PowerShell, if `npm` is blocked by execution policy, use `npm.cmd`.
- `vite.config.js` already allows `*.trycloudflare.com` (`server.allowedHosts` / `preview.allowedHosts`).

### GitHub Pages Auto Deploy

This repo includes a GitHub Actions workflow that deploys on every push to `main`.

1. Go to `Settings -> Pages` in your GitHub repo
2. Set `Build and deployment -> Source` to `GitHub Actions`
3. Push to `main` (or manually run `Deploy To GitHub Pages`)

Deployment URL:
- For `username.github.io` repo: `https://username.github.io/`
- For normal repos (e.g. `bc-ur-viewer`): `https://username.github.io/bc-ur-viewer/`

### Supply Chain Security Automation

This repo includes dependency and vulnerability monitoring by default:

- `Dependabot` (`.github/dependabot.yml`)
  - Checks npm dependencies weekly and opens update PRs.
- `Security Audit` workflow (`.github/workflows/security-audit.yml`)
  - Runs `npm audit --omit=dev --audit-level=moderate` (production dependencies)
  - Runs `npm audit --audit-level=moderate` (all dependencies, including devDependencies)
  - Triggered on weekly schedule, push to `main`, and pull requests.

### Notes

- Camera access requires HTTPS or localhost.
- If payload is not plain text, `Decoded Payload` will show a fallback hint; use Hex/Base64.
- Torch controls are not supported on all browsers/devices; behavior degrades gracefully.
- Front camera will try to use continuous focus (`focusMode: continuous`) when supported by the browser/device.
- If optional Cardano parsers fail to load, core scanning still works (with a log entry).
- `From/Input value` depends on whether UTXO context exists in payload; otherwise it may show `unknown`.
