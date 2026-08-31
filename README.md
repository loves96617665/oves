# Claw Hunter 圖片生成站

整合 Claw Hunter API 的專業圖片生成站，純訪客免費模式、免費 IP 代理池輪詢、OpenAI 相容 API 輸出，部署於 Vercel。

> ⚠️ **重要**：訪客免費額度綁定 IP（每個 IP 每天 2 次圖片）。要突破限制，必須透過**免費 IP 代理池輪詢**，讓每個請求使用不同 IP 取得獨立額度。

## 功能特色

- 🦞 **Claw Hunter API 整合**：整合 4 個訪客免費圖片模型
- 🎁 **純訪客免費模式**：每天 2 次免費圖片（無需 API Key）
- 🔄 **免費 IP 代理池輪詢**：繞過單一 IP 的每日免費額度限制
- 🔌 **OpenAI 相容 API**：`POST /api/images/generations`
- ☁️ **Vercel 部署**：Node.js 環境，原生支援 HTTP 代理（undici ProxyAgent）

## 支援的模型（4 個免費模型）

| 模型 | 供應商 | 說明 |
|------|--------|------|
| `gpt-image-2` | OpenAI | 預設免費模型 |
| `z-image-turbo` | Alibaba | 快速低成本 |
| `nano-banana-2` | Google | 專業品質 |
| `qwen-image-2` | Qwen | 強提示詞遵循 |

## 快速開始

### 1. 安裝依賴

```bash
cd video-gen-site
npm install
```

### 2. 本地開發

```bash
npm run dev
```

### 3. 部署到 Vercel

```bash
# 在 video-gen-site 目錄內執行
vercel --prod
```

**重要**：Vercel 專案的 **Root Directory 必須指向 `video-gen-site` 目錄**，否則 `api/` 目錄不會被正確識別為 Serverless Function。

若使用 Vercel 網頁介面部署：
1. Import 專案時，Root Directory 設為 `video-gen-site`
2. 或直接將 `video-gen-site` 目錄作為獨立 Git 倉庫

## API 使用

### 圖片生成（OpenAI 相容）

```bash
curl -X POST https://your-app.vercel.app/api/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a red lobster on a beach",
    "n": 1,
    "aspect_ratio": "1:1"
  }'
```

### 其他端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/images/generations` | POST | 圖片生成 |
| `/api/models` | GET | 模型清單 |
| `/api/session` | GET | 訪客 session 配置 |
| `/api/health` | GET | 健康檢查 |

## 免費 IP 代理池配置

### 1. 動態代理獲取（自動）

`src/proxy-pool.js` 會**自動從免費代理 API 抓取代理**，無需手動填入：

- ProxyScrape（免費，無需 API key）
- TheSpeedX PROXY-List（GitHub）
- monosans proxy-list（GitHub）

代理池每 10 分鐘自動重新抓取，確保代理新鮮可用。

### 2. 靜態代理（選填）

也可手動填入已知可用的代理：

```javascript
const STATIC_PROXY_POOL = [
    { host: "1.2.3.4", port: 8080, protocol: "http" },
    { host: "5.6.7.8", port: 3128, protocol: "http" },
];
```

### 3. 代理輪詢 + 重試機制

每個生成請求會：
1. 輪詢下一個代理 IP（`getNextProxy()`）
2. 透過該代理取得獨立的訪客 token（`getStudioToken(proxy)`）
3. 透過該代理轉發生成請求（`fetchViaProxy(..., proxy)`）
4. **若 402（免費額度用完），自動重試下一個代理**（最多 3 次）

這樣每個請求使用不同 IP，繞過單一 IP 的每日免費額度限制。

### 4. 代理支援（Vercel 優勢）

Vercel 的 Node.js 環境**原生支援 HTTP 代理**（透過 `undici` 的 `ProxyAgent`），無需額外的代理中繼服務。

### 免費代理來源

- https://free-proxy-list.net/
- https://www.proxy-list.download/
- https://github.com/TheSpeedX/PROXY-List
- https://github.com/monosans/proxy-list
- https://api.proxyscrape.com/v2/

### 重要限制

⚠️ **免費代理存活時間短**（數分鐘到數小時），但動態抓取會自動更新。
⚠️ **免費代理品質不一**：代理失敗時會自動回退到直連，並重試下一個代理。

## 專案結構

```
video-gen-site/
├── api/
│   └── images/
│       └── generations.js   # Vercel Serverless Function（圖片生成 API）
├── src/
│   ├── clawhunter.js        # Claw Hunter API 整合（代理輪詢 + 訪客 token）
│   └── proxy-pool.js        # 免費 IP 代理池
├── index.html               # 前端介面
├── vercel.json              # Vercel 部署設定
├── package.json             # 專案依賴
└── README.md                # 文件
```

## 逆向分析背景

本專案基於對 Claw Hunter API 的完整逆向分析：

- **圖片生成端點**：`POST /api/v1/images/generations`
- **訪客 token**：`GET /api/v1/studio/token` → `{ token, expiresAt }`
- **訪客 session**：`GET /api/studio/session` → 免費模型 + 額度
- **訪客免費圖片模型**（4 個）：`gpt-image-2`、`z-image-turbo`、`nano-banana-2`、`qwen-image-2`
- **訪客免費額度**：每天 2 次圖片（max 3）
- **認證方式**：訪客使用 `x-studio-token` header

詳見 `../新增資料夾/` 下的逆向分析報告。

## 注意事項

1. **訪客免費額度有限**：每天 2 次圖片（max 3），用完需等待每日重置
2. **免費代理不穩定**：存活時間短，需定期更新代理池
3. **hCaptcha 防護**：訪客模式依賴 Privy 匿名 session + hCaptcha，純伺服器端可能受限

## 授權

僅供學習與研究用途。