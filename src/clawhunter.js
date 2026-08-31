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

import { FREE_PROXY_POOL } from "./proxy-pool.js";

// ============================================================
// 配置
// ============================================================
const CLAW_BASE = "https://clawhunter.fun";
const IMAGE_GEN_URL = `${CLAW_BASE}/api/v1/images/generations`;
const STUDIO_TOKEN_URL = `${CLAW_BASE}/api/v1/studio/token`;
const SESSION_URL = `${CLAW_BASE}/api/studio/session`;

// 訪客免費圖片模型（從 /api/studio/session 逆向取得）
export const GUEST_IMAGE_MODELS = [
    "gpt-image-2",
    "z-image-turbo",
    "nano-banana-2",
    "qwen-image-2",
];

// ============================================================
// IP 輪詢：取得下一個代理
// ============================================================
let memoryIndex = 0;

export function getNextProxy() {
    if (FREE_PROXY_POOL.length === 0) return null;
    const proxy = FREE_PROXY_POOL[memoryIndex % FREE_PROXY_POOL.length];
    memoryIndex = (memoryIndex + 1) % FREE_PROXY_POOL.length;
    return proxy;
}

// ============================================================
// 代理轉發：使用 undici ProxyAgent 真正支援 HTTP 代理
// ============================================================
import { ProxyAgent, fetch as undiciFetch } from "undici";

// 代理 Agent 快取（避免每次請求都建立新 Agent）
const agentCache = new Map();

function getProxyAgent(proxy) {
    if (!proxy) return null;
    const key = `${proxy.host}:${proxy.port}`;
    if (!agentCache.has(key)) {
        const agent = new ProxyAgent({
            uri: `${proxy.protocol || "http"}://${proxy.host}:${proxy.port}`,
        });
        agentCache.set(key, agent);
    }
    return agentCache.get(key);
}

async function fetchViaProxy(url, options, proxy) {
    const agent = getProxyAgent(proxy);
    if (agent) {
        return undiciFetch(url, { ...options, dispatcher: agent });
    }
    return fetch(url, options);
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
// 圖片生成核心函式
// ============================================================
export async function generateImage({
    model,
    prompt,
    n = 1,
    aspectRatio,
    quality,
    resolution,
    proxy = null,
}) {
    const body = {
        model,
        prompt,
        n,
    };

    if (aspectRatio) body.aspect_ratio = aspectRatio;
    if (quality) body.quality = quality;
    if (resolution) body.resolution = resolution;

    const headers = {
        "Content-Type": "application/json",
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
    };

    // 訪客模式（免費額度）：透過代理取得獨立 token
    const token = await getStudioToken(proxy);
    if (token) {
        headers["x-studio-token"] = token;
    }

    const fetchOptions = {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    };

    // 透過代理轉發生成請求
    const resp = await fetchViaProxy(IMAGE_GEN_URL, fetchOptions, proxy);

    // 402 = 需要支付（訪客免費額度用完）
    if (resp.status === 402) {
        return {
            ok: false,
            status: 402,
            error: "payment_required",
            message: "免費額度已用完，請稍後再試（每天重置）",
        };
    }

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        return {
            ok: false,
            status: resp.status,
            error: "generation_failed",
            message: errText || `生成失敗（${resp.status}）`,
        };
    }

    const data = await resp.json();
    return { ok: true, status: 200, data };
}

// ============================================================
// 取得訪客 session 配置
// ============================================================
export async function getSessionConfig() {
    const resp = await fetch(SESSION_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
    });
    if (!resp.ok) return null;
    return resp.json();
}