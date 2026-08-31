/**
 * 免費 IP 代理池設定
 *
 * 每個代理格式：{ host, port, protocol }
 *
 * 免費代理來源建議：
 * - https://free-proxy-list.net/
 * - https://www.proxy-list.download/
 * - https://github.com/TheSpeedX/PROXY-List
 * - https://github.com/monosans/proxy-list
 * - https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt
 *
 * 重要說明：
 * 1. 免費代理存活時間短（數分鐘到數小時），需定期更新
 * 2. 建議只使用支援 HTTPS 的代理（protocol: "https"）
 * 3. Vercel 的 Node.js 環境支援 HTTP 代理（透過 undici ProxyAgent）
 * 4. 代理池用於繞過 Claw Hunter 訪客免費額度的 IP 限制
 *    （每個 IP 每天 2 次免費圖片，輪詢不同 IP 可突破限制）
 */

export const FREE_PROXY_POOL = [
    // 範例（請替換為實際可用代理）：
    // { host: "1.2.3.4", port: 8080, protocol: "http" },
    // { host: "5.6.7.8", port: 3128, protocol: "http" },
    // { host: "9.10.11.12", port: 8080, protocol: "http" },
];

export default FREE_PROXY_POOL;