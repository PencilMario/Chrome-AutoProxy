import { decideProxyRoute, matchHostRule, normalizeHost } from "./proxy-engine.js";

export function buildSiteRouteStatus(config) {
  const host = normalizeHost(config?.host);
  if (!host) {
    return {
      host: "",
      label: "无法识别",
      detail: "当前标签页没有可用域名",
      action: "direct",
      reason: "missing-host"
    };
  }

  const route = decideProxyRoute(config);
  return {
    host,
    label: routeLabel(route),
    detail: routeDetail(route),
    action: route.action,
    reason: route.reason
  };
}

export function addHostRule({ config, host, ruleType }) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) throw new Error("当前标签页没有可用域名");
  if (!["direct", "proxy"].includes(ruleType)) throw new Error("未知规则类型");

  const nextConfig = {
    ...config,
    rules: {
      direct: [...(config?.rules?.direct || [])],
      proxy: [...(config?.rules?.proxy || [])]
    }
  };
  const targetRules = nextConfig.rules[ruleType];
  const oppositeType = ruleType === "direct" ? "proxy" : "direct";

  if (targetRules.some((rule) => matchHostRule(normalizedHost, getRulePattern(rule)))) {
    return { config: nextConfig, added: false, host: normalizedHost };
  }

  nextConfig.rules[oppositeType] = nextConfig.rules[oppositeType].filter((rule) => {
    return !matchHostRule(normalizedHost, getRulePattern(rule));
  });
  targetRules.push(normalizedHost);

  return { config: nextConfig, added: true, host: normalizedHost };
}

export function createNetworkSpeedSampler({ windowMs = 5000 } = {}) {
  let samples = [];

  return {
    record({ timeMs = Date.now(), bytes = 0, proxied = false, host = "", type = "other" }) {
      if (!proxied || !Number.isFinite(bytes) || bytes <= 0) return;
      samples.push({
        timeMs,
        bytes,
        host: normalizeHost(host),
        type: String(type || "other")
      });
      prune(timeMs);
    },
    snapshot(nowMs = Date.now()) {
      prune(nowMs);
      const bytes = samples.reduce((total, sample) => total + sample.bytes, 0);
      return {
        bytesPerSecond: samples.length ? Math.round(bytes / (windowMs / 1000)) : null,
        sampleCount: samples.length,
        windowMs,
        samples: samples.map((sample) => ({
          id: `${sample.host}|${sample.type}|${sample.timeMs}|${sample.bytes}`,
          ageMs: Math.max(0, nowMs - sample.timeMs),
          bytes: sample.bytes,
          host: sample.host,
          type: sample.type
        }))
      };
    }
  };

  function prune(nowMs) {
    samples = samples.filter((sample) => nowMs - sample.timeMs <= windowMs);
  }
}

function routeLabel(route) {
  if (route.reason === "disabled") return "代理已停用";
  if (route.reason === "proxy-rule") return "强制代理";
  if (route.reason === "geoip-non-local" || route.reason === "geoip-unknown") return "GeoIP 代理";
  if (route.reason === "default-direct") return "默认直连";
  if (route.action === "direct") return "直连";
  return "默认直连";
}

function routeDetail(route) {
  if (route.reason === "disabled") return "PAC 代理控制已停用";
  if (route.reason === "direct-rule") return route.matchedRule || "命中直连规则";
  if (route.reason === "built-in-direct-rule") return route.matchedRule || "命中内置直连规则";
  if (route.reason === "private-ip") return "本地或私有地址";
  if (route.reason === "proxy-rule") return formatProxyDetail(route);
  if (route.reason === "geoip-non-local") {
    return `${route.country || "未知地区"} -> ${route.proxy?.name || "默认代理服务器"}`;
  }
  if (route.reason === "geoip-unknown") return `未知地区 -> ${route.proxy?.name || "默认代理服务器"}`;
  if (route.reason === "geoip-local") return `${route.country} 本地区域`;
  if (route.reason === "default-direct") return "未命中强制代理规则";
  return route.reason || "";
}

function formatProxyDetail(route) {
  const proxyName = route.proxy?.name || "默认代理服务器";
  return route.matchedRule ? `${route.matchedRule} -> ${proxyName}` : proxyName;
}

function getRulePattern(rule) {
  return typeof rule === "string" ? normalizeHost(rule) : normalizeHost(rule?.pattern);
}
