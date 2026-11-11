# BC-UR Fountain Viewer

[English README](README.md)

可靜態部署的網頁 App，用瀏覽器直接調用系統鏡頭掃描 QR，解析 `ur:...` 格式的 BC-UR（含 fountain code 多片段）。

## 功能

- 讀取系統鏡頭（`getUserMedia`）
- 掃描 QR（ZXing）
- 累積並解碼 BC-UR fountain fragments（`@ngraveio/bc-ur`）
- 鏡頭預設優先後鏡頭；前鏡頭鏡像、後鏡頭不鏡像
- 多語系介面（English / 繁體中文，可即時切換，會記住偏好）
- 顯示解碼進度、UR type、payload（JSON/UTF-8、Hex、Base64）
- 解碼完成後可直接繼續掃下一筆（不需手動重啟）
- 內建掃描導引框與 quiet zone 提示，提升手機辨識成功率
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

請使用 Node.js 24 以上版本，與 QR 套件及 CI 的執行環境一致。

```bash
npm install
npm run dev
```

## 靜態編譯

```bash
npm run build
```

輸出目錄為 `dist/`，可直接部署到任意靜態網站（GitHub Pages、Netlify、Cloudflare Pages、S3 靜態站等）。

## 回歸測試

```bash
npm ci
npm test
```

測試涵蓋合成 QR 圖像（高密度多片段、旋轉、斜切與鏡像）、UR 解碼、重置與連續掃描、Cardano 簽章顯示，以及模擬相機權限拒絕。一般 QR 定位仍優先執行；預期的辨識失敗才會啟用次數有限的乾淨圖樣與旋轉備援，不跳過 QR 錯誤更正，也不隱藏非預期程式錯誤。

Node 測試使用合成圖像與 DOM／相機替身，不能取代 Android Chrome、iOS Safari 實機測試。硬體驗證項目包括高密度動態 UR、前後鏡頭切換、權限拒絕後重試、停止後啟動、方向旋轉、對焦與補光。QR 四周請保留白色留白區。備援次數有限，但高密度或雜訊畫面仍可能增加處理時間，手機效能需另以實機驗證。

## 預覽方式

### 1) 本機開發預覽（建議）

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

- 本機：`http://localhost:5173`
- 同網段裝置：`http://<你的內網IP>:5173`

### 2) 預覽 build 結果

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

- 本機：`http://localhost:4173`
- 同網段裝置：`http://<你的內網IP>:4173`

### 3) 手機相機測試（HTTPS）

手機瀏覽器通常要求 `HTTPS` 才能使用相機（`localhost` 例外）。  
可用 Cloudflare Tunnel 快速提供 HTTPS：

1. 先啟動 dev server：

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

2. 另開終端啟動 tunnel：

```bash
cloudflared tunnel --url http://localhost:5173
```

3. 用手機打開 `https://xxxx.trycloudflare.com`

備註：
- 若 Windows PowerShell 執行 `npm` 被 policy 擋住，請改用 `npm.cmd`。
- 本專案已在 `vite.config.js` 允許 `*.trycloudflare.com` (`server.allowedHosts` / `preview.allowedHosts`)。

## GitHub Pages 自動部署

此專案已內建 GitHub Actions workflow：每次 push 到 `main` 都會自動部署到 GitHub Pages。

1. 到 GitHub 專案頁面：`Settings -> Pages`
2. `Build and deployment -> Source` 選 `GitHub Actions`
3. push 一次到 `main`（或手動觸發 `Deploy To GitHub Pages` workflow）

部署位址：
- 若 repo 是 `username.github.io`：`https://username.github.io/`
- 一般 repo（例如 `bc-ur-viewer`）：`https://username.github.io/bc-ur-viewer/`

## 供應鏈安全自動化

此專案已內建依賴更新與弱點檢查機制：

- `Dependabot`（`.github/dependabot.yml`）
  - 每週檢查 npm 依賴並自動建立更新 PR。
- `Security Audit` workflow（`.github/workflows/security-audit.yml`）
  - 使用 Node 24 執行回歸測試與正式版建置
  - 執行 `npm audit --omit=dev --audit-level=moderate`（僅 production 依賴）
  - 執行 `npm audit --audit-level=moderate`（含 devDependencies 的全部依賴）
  - 於每週排程、`main` push、pull request 時觸發。

## 注意事項

- 需要 HTTPS 或 localhost 才能使用相機權限（瀏覽器限制）。
- 若 payload 非文字，`Decoded Payload` 會顯示提示，請改看 `Hex/Base64`。
- 部分行動裝置/瀏覽器不支援 `torch` 控制，補光燈關閉行為會自動降級。
- 前鏡頭會嘗試套用連續對焦（`focusMode: continuous`）；是否生效取決於裝置/瀏覽器支援。
- Cardano 解析模組若載入失敗，主掃描功能仍可用（會在紀錄顯示可選模組載入失敗）。
- `From/Input value` 依賴 payload 內是否附帶 UTXO context；若資料不足會顯示 `unknown`。
