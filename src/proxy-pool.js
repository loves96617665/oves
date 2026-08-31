/**
 * 免費 IP 代理池設定
 *
 * 支援兩種代理來源：
 * 1. 靜態代理（手動填入）
 * 2. 動態代理（從免費代理 API 自動抓取）
 *
 * 免費代理來源：
 * - https://free-proxy-list.net/
 * - https://www.proxy-list.download/
 * - https://github.com/TheSpeedX/PROXY-List
 * - https://github.com/monosans/proxy-list
 * - https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt
 * - https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http
 * - https://www.proxy-list.download/api/v1/get?type=http
 */

// ============================================================
// 靜態代理池（手動填入，優先使用）
// ============================================================
const STATIC_PROXY_POOL = [
    // 範例（請替換為實際可用代理）：
    // { host: "1.2.3.4", port: 8080, protocol: "http" },
    // { host: "5.6.7.8", port: 3128, protocol: "http" },
    // { host: "9.10.11.12", port: 8080, protocol: "http" },
];

// ============================================================
// 動態代理來源（自動抓取免費代理）
// ============================================================
const PROXY_SOURCES = [
    // ProxyScrape（免費，無需 API key）
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
    // ProxyScrape HTTPS
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=https&timeout=10000&country=all&ssl=all&anonymity=all",
    // TheSpeedX PROXY-List（GitHub raw）
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    // monosans proxy-list
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
];

// ============================================================
// 動態代理快取
// ============================================================
let dynamicProxies = [];
let lastFetchAt = 0;
const FETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 分鐘重新抓取

/**
 * 從免費代理 API 抓取代理列表
 * 回傳格式：{ host, port, protocol }[]
 */
async function fetchDynamicProxies() {
    const now = Date.now();
    if (dynamicProxies.length > 0 && now - lastFetchAt < FETCH_INTERVAL_MS) {
        return dynamicProxies;
    }

    const proxies = [];

    for (const source of PROXY_SOURCES) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const resp = await fetch(source, { signal: controller.signal });
            clearTimeout(timeout);

            if (!resp.ok) continue;

            const text = await resp.text();
            // 解析代理列表（格式：host:port 每行一個）
            const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
                // 跳過註解
                if (line.startsWith("#") || line.startsWith("//")) continue;
                const match = line.match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/);
                if (match) {
                    proxies.push({
                        host: match[1],
                        port: parseInt(match[2]),
                        protocol: source.includes("https") ? "https" : "http",
                    });
                }
            }
        } catch {
            // 忽略抓取失敗，繼續下一個來源
        }
    }

    // 去重
    const seen = new Set();
    dynamicProxies = proxies.filter((p) => {
        const key = `${p.host}:${p.port}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    lastFetchAt = now;
    return dynamicProxies;
}

/**
 * 取得完整代理池（靜態 + 動態）
 */
async function getProxyPool() {
    const dynamic = await fetchDynamicProxies();
    return [...STATIC_PROXY_POOL, ...dynamic];
}

module.exports = {
    STATIC_PROXY_POOL,
    getProxyPool,
    fetchDynamicProxies,
};