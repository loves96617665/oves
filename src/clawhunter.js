/**
 * Claw Hunter API 整合模組
 *
 * 整合 Claw Hunter 圖片生成 API，支援：
 * - 訪客免費模式（x-studio-token + 免費額度）
 * - 免費 IP 代理池輪詢（繞過單一 IP 的每日免費額度限制）
 *
 * 逆向分析結論（2026-08-31）：
 *   圖片生成端點：POST /api/v1/images/generations
 *   訪客 token：GET /api/v1/studio/token → { token, expiresAt }
 *   訪客 session：GET /api/studio/session → 免費模型 + 額度
 *   訪客免費圖片模型（4 個）：gpt-image-2、z-image-turbo、nano-banana-2、qwen-image-2
 *   訪客免費額度：每天 2 次圖片（max 3）
 *   認證方式：訪客使用 x-studio-token header
 */

const { getProxyPool } = require("./proxy-pool.js");

// ============================================================
// 配置
// ============================================================
const CLAW_BASE = "https://clawhunter.fun";
const IMAGE_GEN_URL = `${CLAW_BASE}/api/v1/images/generations`;
const STUDIO_TOKEN_URL = `${CLAW_BASE}/api/v1/studio/token`;
const SESSION_URL = `${CLAW_BASE}/api/studio/session`;

// 訪客免費圖片模型（從 /api/studio/session 逆向取得）
const GUEST_IMAGE_MODELS = [
    "gpt-image-2",
    "z-image-turbo",
    "nano-banana-2",
    "qwen-image-2",
];

// ============================================================
// IP 輪詢：取得下一個代理
// ============================================================
let memoryIndex = 0;
let proxyPoolCache = [];
let proxyPoolFetchedAt = 0;
const PROXY_POOL_TTL_MS = 10 * 60 * 1000; // 10 分鐘

async function getNextProxy() {
    // 定期重新抓取代理池
    const now = Date.now();
    if (proxyPoolCache.length === 0 || now - proxyPoolFetchedAt > PROXY_POOL_TTL_MS) {
        try {
            proxyPoolCache = await getProxyPool();
            proxyPoolFetchedAt = now;
        } catch {
            proxyPoolCache = [];
        }
    }

    if (proxyPoolCache.length === 0) return null;
    const proxy = proxyPoolCache[memoryIndex % proxyPoolCache.length];
    memoryIndex = (memoryIndex + 1) % proxyPoolCache.length;
    return proxy;
}

// ============================================================
// 代理轉發：使用 https-proxy-agent 支援 HTTP 代理
// ============================================================
let HttpsProxyAgent = null;
try {
    // 嘗試載入 https-proxy-agent（若已安裝）
    const mod = require("https-proxy-agent");
    HttpsProxyAgent = mod.HttpsProxyAgent || mod;
} catch {
    // 未安裝，使用直連
    HttpsProxyAgent = null;
}

async function fetchViaProxy(url, options, proxy) {
    // 若無代理或未安裝 https-proxy-agent，直接請求
    if (!proxy || !HttpsProxyAgent) {
        return fetch(url, options);
    }

    try {
        const agent = new HttpsProxyAgent(
            `${proxy.protocol || "http"}://${proxy.host}:${proxy.port}`
        );
        // Node.js 18+ 的 fetch 不支援 agent 參數，
        // 需使用 undici 或 http/https 模組
        // 這裡使用 undici（Node.js 內建）
        const { fetch: undiciFetch } = require("undici");
        return await undiciFetch(url, { ...options, dispatcher: agent });
    } catch (e) {
        // 代理失敗，回退到直連
        return fetch(url, options);
    }
}

// ============================================================
// 訪客 token：每個代理 IP 獨立取得 token
// ============================================================
async function getStudioToken(proxy = null) {
    const resp = await fetchViaProxy(
        STUDIO_TOKEN_URL,
        {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            },
        },
        proxy
    );

    if (!resp.ok) return null;

    const data = await resp.json();
    return data.token || null;
}

// ============================================================
// 圖片生成核心函式（含代理重試）
// ============================================================
async function generateImage({
    model,
    prompt,
    n = 1,
    aspectRatio,
    quality,
    resolution,
    proxy = null,
    maxRetries = 3,
}) {
    const body = {
        model,
        prompt,
        n,
    };

    if (aspectRatio) body.aspect_ratio = aspectRatio;
    if (quality) body.quality = quality;
    if (resolution) body.resolution = resolution;

    // 嘗試多個代理（輪詢 + 重試）
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        // 每次重試輪詢下一個代理
        const currentProxy = proxy || (await getNextProxy());

        const headers = {
            "Content-Type": "application/json",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            Accept: "application/json",
        };

        // 訪客模式（免費額度）：透過代理取得獨立 token
        const token = await getStudioToken(currentProxy);
        if (token) {
            headers["x-studio-token"] = token;
        }

        const fetchOptions = {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        };

        // 透過代理轉發生成請求
        const resp = await fetchViaProxy(IMAGE_GEN_URL, fetchOptions, currentProxy);

        // 402 = 免費額度用完，嘗試下一個代理
        if (resp.status === 402) {
            lastError = {
                ok: false,
                status: 402,
                error: "payment_required",
                message: "此代理的免費額度已用完，嘗試下一個代理...",
            };
            continue; // 重試下一個代理
        }

        if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            lastError = {
                ok: false,
                status: resp.status,
                error: "generation_failed",
                message: errText || `生成失敗（${resp.status}）`,
            };
            continue; // 重試下一個代理
        }

        const data = await resp.json();
        return { ok: true, status: 200, data, proxy: currentProxy };
    }

    // 所有代理都失敗
    if (lastError) {
        return {
            ...lastError,
            message: "所有代理的免費額度都已用完，請稍後再試（每天重置）",
        };
    }

    return {
        ok: false,
        status: 500,
        error: "no_proxy_available",
        message: "無可用代理，請在 proxy-pool.js 填入免費代理",
    };
}

// ============================================================
// 取得訪客 session 配置
// ============================================================
async function getSessionConfig() {
    const resp = await fetch(SESSION_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
    });
    if (!resp.ok) return null;
    return resp.json();
}

module.exports = {
    GUEST_IMAGE_MODELS,
    getNextProxy,
    generateImage,
    getSessionConfig,
};