# BC-UR Fountain Viewer

[English README](README.md)

可靜態部署的網頁 App，用瀏覽器直接調用系統鏡頭掃描 QR，解析 `ur:...` 格式的 BC-UR（含 fountain code 多片段）。

## 功能

- 讀取系統鏡頭（`getUserMedia`）
- 掃描 QR（ZXing）
- 累積並解碼 BC-UR fountain fragments（`@ngraveio/bc-ur`）
- 多語系介面（English / 繁體中文，可即時切換，會記住偏好）
- 顯示解碼進度、UR type、payload（JSON/UTF-8、Hex、Base64）
- 非 Cardano 類型時顯示 Raw Data，並自動彈出 Raw overlay
- Cardano 類型時顯示 Cardano 解析區塊，並自動彈出 Cardano overlay
- Cardano `sign-request` 可解析輸入/輸出、地址、fee、TTL、金額摘要
- Cardano `signature` 可解析 requestId、witness envelope（public key / signature）

## 使用方式

1. 右上角可切換語言（English / 繁體中文）
2. 選擇鏡頭後點 `Start Scan / 啟動掃描`
3. 對準 UR QR（可多片段）
4. 點背景或按 `Esc` 關閉 overlay，回到原本版面

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

1. 到 GitHub 專案頁面：`Settings -> Pages`
2. `Build and deployment -> Source` 選 `GitHub Actions`
3. push 一次到 `main`（或手動觸發 `Deploy To GitHub Pages` workflow）

部署位址：
- 若 repo 是 `username.github.io`：`https://username.github.io/`
- 一般 repo（例如 `bc-ur-viewer`）：`https://username.github.io/bc-ur-viewer/`

## 注意事項

- 需要 HTTPS 或 localhost 才能使用相機權限（瀏覽器限制）。
- 若 payload 非文字，`Decoded Payload` 會顯示提示，請改看 `Hex/Base64`。
- 部分行動裝置/瀏覽器不支援 `torch` 控制，補光燈關閉行為會自動降級。
- `From/Input value` 依賴 payload 內是否附帶 UTXO context；若資料不足會顯示 `unknown`。
