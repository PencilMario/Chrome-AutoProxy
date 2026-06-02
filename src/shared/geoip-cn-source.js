export const GEOIP_CN_SOURCE_URL =
  "https://raw.githubusercontent.com/Hackl0us/GeoIP2-CN/release/CN-ip-cidr.txt";
export const GEOIP_CN_FALLBACK_SOURCE_URL =
  "https://cdn.jsdelivr.net/gh/Hackl0us/GeoIP2-CN@release/CN-ip-cidr.txt";
export const GEOIP_CN_SOURCE_URLS = [
  GEOIP_CN_SOURCE_URL,
  GEOIP_CN_FALLBACK_SOURCE_URL
];
export const GEOIP_CN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const GEOIP_CN_ALARM_NAME = "geoip-cn-refresh";

export function buildGeoIpCnRecords(text) {
  const cidrs = new Set();

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (isIpv4Cidr(line)) cidrs.add(normalizeCidr(line));
  }

  return Object.fromEntries([...cidrs].sort(compareCidr).map((cidr) => [cidr, "CN"]));
}

export function shouldRefreshGeoIpCn(geoip = {}, nowMs = Date.now(), options = {}) {
  if (options.force) return true;

  const updatedAt = Date.parse(geoip.cnLastUpdatedAt || "");
  if (!Number.isFinite(updatedAt)) return true;

  return nowMs - updatedAt >= GEOIP_CN_REFRESH_INTERVAL_MS;
}

export async function fetchGeoIpCnRecords(fetchImpl = fetch, urls = GEOIP_CN_SOURCE_URLS) {
  const sourceUrls = Array.isArray(urls) ? urls : [urls];
  const errors = [];

  for (const url of sourceUrls) {
    try {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status || "unknown"}`);
      }

      const records = buildGeoIpCnRecords(await response.text());
      if (!Object.keys(records).length) {
        throw new Error("没有有效的 CN CIDR 记录");
      }

      return records;
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(`GeoIP2-CN 更新失败：${errors.join("; ")}`);
}

function normalizeCidr(cidr) {
  const [ip, prefix] = cidr.split("/");
  return `${ip.split(".").map((part) => String(Number(part))).join(".")}/${Number(prefix)}`;
}

function isIpv4Cidr(value) {
  const [ip, prefixText] = String(value).split("/");
  const prefix = Number(prefixText);
  return isIpv4(ip) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

function isIpv4(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => {
    const number = Number(part);
    return /^\d+$/.test(part) && number >= 0 && number <= 255;
  });
}

function compareCidr(left, right) {
  const [leftIp, leftPrefix] = left.split("/");
  const [rightIp, rightPrefix] = right.split("/");
  return ipv4ToInt(leftIp) - ipv4ToInt(rightIp) || Number(leftPrefix) - Number(rightPrefix);
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}
