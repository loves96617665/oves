/**
 * Vercel Serverless Function：圖片生成 API（OpenAI 相容）
 *
 * POST /api/images/generations
 * GET  /api/models
 * GET  /api/session
 * GET  /api/health
 */

import { generateImage, getSessionConfig, getNextProxy, GUEST_IMAGE_MODELS } from "../src/clawhunter.js";

// CORS 處理
function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-studio-token",
        "Access-Control-Max-Age": "86400",
    };
}

function jsonResponse(data, status = 200, origin) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
        },
    });
}

export default async function handler(req) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    const path = url.pathname;

    // CORS 預檢
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // 健康檢查
    if (path === "/api/health") {
        return jsonResponse({ status: "ok", service: "clawhunter-image-gen" }, 200, origin);
    }

    // 訪客 session 配置
    if (path === "/api/session") {
        const config = await getSessionConfig();
        if (!config) {
            return jsonResponse({ error: "failed_to_fetch_session" }, 502, origin);
        }
        return jsonResponse(config, 200, origin);
    }

    // 模型清單
    if (path === "/api/models") {
        const models = GUEST_IMAGE_MODELS.map((id) => ({
            id,
            object: "model",
            owned_by: "clawhunter",
            free: true,
        }));
        return jsonResponse({ object: "list", data: models }, 200, origin);
    }

    // 圖片生成 API（OpenAI 相容）
    if (path === "/api/images/generations") {
        if (req.method !== "POST") {
            return jsonResponse({ error: "method_not_allowed" }, 405, origin);
        }

        let body;
        try {
            body = await req.json();
        } catch {
            return jsonResponse({ error: "invalid_json" }, 400, origin);
        }

        const model = body.model || "gpt-image-2";
        const prompt = body.prompt;
        if (!prompt) {
            return jsonResponse({ error: "prompt_required" }, 400, origin);
        }

        // 驗證模型
        if (!GUEST_IMAGE_MODELS.includes(model)) {
            return jsonResponse(
                { error: "invalid_model", valid_models: GUEST_IMAGE_MODELS },
                400,
                origin
            );
        }

        // 取得下一個代理（輪詢）
        const proxy = getNextProxy();

        const result = await generateImage({
            model,
            prompt,
            n: body.n || 1,
            aspectRatio: body.aspect_ratio,
            quality: body.quality,
            resolution: body.resolution,
            proxy,
        });

        if (!result.ok) {
            return jsonResponse(
                { error: result.error, message: result.message },
                result.status,
                origin
            );
        }

        return jsonResponse(result.data, 200, origin);
    }

    // 404
    return jsonResponse({ error: "not_found" }, 404, origin);
}