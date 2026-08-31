/**
 * Vercel Serverless Function：圖片生成 API（OpenAI 相容）
 *
 * 使用 catch-all 路由，處理所有 /api/* 路徑：
 * - POST /api/images/generations — 圖片生成
 * - GET  /api/models — 模型清單
 * - GET  /api/session — 訪客 session 配置
 * - GET  /api/health — 健康檢查
 */

const { generateImage, getSessionConfig, getNextProxy, GUEST_IMAGE_MODELS } = require("../src/clawhunter.js");

// CORS 處理
function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-studio-token",
        "Access-Control-Max-Age": "86400",
    };
}

function sendJson(res, data, status = 200, origin) {
    res.setHeader("Content-Type", "application/json");
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.setHeader(k, v));
    res.status(status).json(data);
}

module.exports = async function handler(req, res) {
    const origin = req.headers.origin;
    const path = req.url.split("?")[0];

    // CORS 預檢
    if (req.method === "OPTIONS") {
        Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(204).end();
    }

    // 健康檢查
    if (path === "/api/health") {
        return sendJson(res, { status: "ok", service: "clawhunter-image-gen" }, 200, origin);
    }

    // 訪客 session 配置
    if (path === "/api/session") {
        const config = await getSessionConfig();
        if (!config) {
            return sendJson(res, { error: "failed_to_fetch_session" }, 502, origin);
        }
        return sendJson(res, config, 200, origin);
    }

    // 模型清單
    if (path === "/api/models") {
        const models = GUEST_IMAGE_MODELS.map((id) => ({
            id,
            object: "model",
            owned_by: "clawhunter",
            free: true,
        }));
        return sendJson(res, { object: "list", data: models }, 200, origin);
    }

    // 圖片生成 API（OpenAI 相容）
    if (path === "/api/images/generations") {
        if (req.method !== "POST") {
            return sendJson(res, { error: "method_not_allowed" }, 405, origin);
        }

        let body;
        try {
            body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        } catch {
            return sendJson(res, { error: "invalid_json" }, 400, origin);
        }

        const model = body.model || "gpt-image-2";
        const prompt = body.prompt;
        if (!prompt) {
            return sendJson(res, { error: "prompt_required" }, 400, origin);
        }

        // 驗證模型
        if (!GUEST_IMAGE_MODELS.includes(model)) {
            return sendJson(
                res,
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
            return sendJson(
                res,
                { error: result.error, message: result.message },
                result.status,
                origin
            );
        }

        return sendJson(res, result.data, 200, origin);
    }

    // 404
    return sendJson(res, { error: "not_found" }, 404, origin);
};