# BC-UR Fountain Viewer

可靜態部署的網頁 App，用瀏覽器直接調用系統鏡頭掃描 QR，解析 `ur:...` 格式的 BC-UR（含 fountain code 多片段）。

## 功能

- 讀取系統鏡頭（`getUserMedia`）
- 掃描 QR（ZXing）
- 累積並解碼 BC-UR fountain fragments（`@ngraveio/bc-ur`）
- 顯示解碼進度、UR type、payload（UTF-8 / Hex / Base64）

## 開發

```bash
npm install
npm run dev
```

## 靜態編譯

```bash
npm run build
```

輸出目錄為 `dist/`，可直接部署到任意靜態網站（GitHub Pages、Netlify、Cloudflare Pages、S3 靜態站等）。

## GitHub Pages 自動部署

此專案已內建 GitHub Actions workflow：每次 push 到 `main` 都會自動部署到 GitHub Pages。

### 一次性設定

1. 到 GitHub 專案頁面：`Settings -> Pages`
2. `Build and deployment -> Source` 選 `GitHub Actions`
3. push 一次到 `main`（或手動觸發 `Deploy To GitHub Pages` workflow）

### 部署位址

- 若 repo 是 `username.github.io`：部署到 `https://username.github.io/`
- 一般 repo（例如 `bc-ur-viewer`）：部署到 `https://username.github.io/bc-ur-viewer/`

## 注意事項

- 需要 HTTPS 或 localhost 才能使用相機權限（瀏覽器限制）。
- 若 payload 非文字，`UTF-8` 欄位會顯示提示，請改看 `Hex/Base64`。
