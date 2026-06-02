export const PROXY_TEST_ID = "__proxy_test__";
export const DEFAULT_PROXY_TEST_URL = "https://www.google.com/generate_204";
export const DEFAULT_PROXY_TEST_TIMEOUT_MS = 6000;

export function normalizeProxyForTest(proxy = {}) {
  const host = String(proxy.host || "").trim();
  const port = Number(proxy.port);

  if (!host) throw new Error("请填写代理服务器主机地址");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口必须在 1 到 65535 之间");
  }

  return {
    id: PROXY_TEST_ID,
    name: "代理测试",
    type: String(proxy.type || "HTTP").trim().toUpperCase(),
    host,
    port,
    authentication: normalizeAuthentication(proxy.authentication)
  };
}

export function createProxyTestConfig(proxy) {
  return {
    enabled: true,
    activeProxyId: PROXY_TEST_ID,
    proxies: [normalizeProxyForTest(proxy)],
    rules: {
      direct: [],
      proxy: ["*"]
    },
    geoip: {
      mode: "disabled",
      localCountries: []
    },
    debug: {
      enabled: false
    }
  };
}

function normalizeAuthentication(authentication = {}) {
  if (authentication.type !== "usernamePassword") return { type: "none" };
  return {
    type: "usernamePassword",
    username: String(authentication.username || ""),
    password: String(authentication.password || "")
  };
}
