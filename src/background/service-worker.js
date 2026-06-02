import { createIndexedDbGeoIpStore, GeoIpCache } from "../shared/geoip-cache.js";
import { buildPacScript } from "../shared/proxy-engine.js";
import { DEFAULT_CONFIG, mergeConfig } from "../shared/default-config.js";
import { createDebugLogger, elapsedMs, nowMs } from "../shared/debug-logger.js";
import { findProxyAuthCredentials } from "../shared/proxy-auth.js";
import { addHostRule, buildSiteRouteStatus, createNetworkSpeedSampler } from "../shared/popup-state.js";
import { decideProxyRoute } from "../shared/proxy-engine.js";
import {
  createProxyTestConfig,
  DEFAULT_PROXY_TEST_TIMEOUT_MS,
  DEFAULT_PROXY_TEST_URL
} from "../shared/proxy-test.js";
import {
  fetchGeoIpCnRecords,
  GEOIP_CN_ALARM_NAME,
  GEOIP_CN_REFRESH_INTERVAL_MS,
  shouldRefreshGeoIpCn
} from "../shared/geoip-cn-source.js";

const CONFIG_KEY = "autoproxyConfig";
const DEBUG_LOG_KEY = "autoproxyDebugEvents";
const DEBUG_LOG_LIMIT = 80;
const geoIpCache = new GeoIpCache(createIndexedDbGeoIpStore());
const networkSpeedSampler = createNetworkSpeedSampler({ windowMs: 5000 });
const requestStartTimes = new Map();
let cachedHostCountries = {};
let proxyTestConfig = null;
let cachedConfig = null;
let cachedConfigPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await importSeedGeoIpIfNeeded(config);
  await refreshGeoIpCnWithoutBlocking(config);
  await saveConfig(config);
  await applyProxySettings(config);
  scheduleGeoIpCnRefresh();
});

chrome.runtime.onStartup.addListener(async () => {
  const config = await getConfig();
  await refreshGeoIpCnWithoutBlocking(config);
  await saveConfig(config);
  await applyProxySettings(config);
  scheduleGeoIpCnRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== GEOIP_CN_ALARM_NAME) return;
  refreshGeoIpCnIfNeeded()
    .catch((error) => console.warn("GeoIP2-CN refresh failed", error));
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    learnGeoIpFromCompletedRequest(details);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestStartTimes.set(details.requestId, {
      timeMs: nowMs(),
      proxied: isRequestProxied(details)
    });
    logRequestDebug(details, "request-start");
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    handleProxyAuthRequired(details)
      .then(callback)
      .catch((error) => {
        console.warn("Proxy authentication failed", error);
        callback({});
      });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[CONFIG_KEY]) {
    const config = setCachedConfig(changes[CONFIG_KEY].newValue);
    applyProxySettings(config);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message?.type === "GET_CONFIG") {
    return { ok: true, config: await getConfig() };
  }

  if (message?.type === "GET_POPUP_STATE") {
    return {
      ok: true,
      config: await getConfig(),
      site: await getCurrentSiteStatus(message.url),
      speed: networkSpeedSampler.snapshot(nowMs())
    };
  }

  if (message?.type === "SAVE_CONFIG") {
    const config = mergeConfig(message.config);
    await saveConfig(config);
    await applyProxySettings(config);
    return { ok: true, config };
  }

  if (message?.type === "ADD_CURRENT_HOST_RULE") {
    const config = await getConfig();
    const { config: nextConfig, added, host } = addHostRule({
      config,
      host: hostFromUrl(message.url),
      ruleType: message.ruleType
    });
    if (added) {
      await saveConfig(nextConfig);
      await applyProxySettings(nextConfig);
    }
    return {
      ok: true,
      config: nextConfig,
      added,
      host,
      site: await getCurrentSiteStatus(message.url, nextConfig),
      speed: networkSpeedSampler.snapshot(nowMs())
    };
  }

  if (message?.type === "TEST_PROXY_CONNECTION") {
    return {
      ok: true,
      result: await testProxyConnection(message.proxy)
    };
  }

  if (message?.type === "TOGGLE_ENABLED") {
    const config = await getConfig();
    config.enabled = Boolean(message.enabled);
    await saveConfig(config);
    await applyProxySettings(config);
    return { ok: true, config };
  }

  if (message?.type === "SET_ACTIVE_PROXY") {
    const config = await getConfig();
    config.activeProxyId = message.proxyId;
    await saveConfig(config);
    await applyProxySettings(config);
    return { ok: true, config };
  }

  if (message?.type === "IMPORT_GEOIP") {
    await geoIpCache.importRecords(message.records || {});
    cachedHostCountries = await geoIpCache.exportRecords();
    return { ok: true, records: await geoIpCache.exportRecords() };
  }

  if (message?.type === "UPDATE_GEOIP_CN") {
    const result = await refreshGeoIpCnIfNeeded(null, { force: true });
    return { ok: true, ...result };
  }

  if (message?.type === "PING_DEBUG") {
    const config = await getConfig();
    await emitDebug(config, "debug-ping", {
      source: "options",
      debugEnabled: Boolean(config.debug?.enabled)
    });
    return {
      ok: true,
      debugEnabled: Boolean(config.debug?.enabled),
      events: await readDebugEvents()
    };
  }

  if (message?.type === "GET_DEBUG_LOGS") {
    const config = await getConfig();
    return {
      ok: true,
      debugEnabled: Boolean(config.debug?.enabled),
      events: await readDebugEvents()
    };
  }

  if (message?.type === "CLEAR_DEBUG_LOGS") {
    await debugStorage().set({ [DEBUG_LOG_KEY]: [] });
    return { ok: true, events: [] };
  }

  throw new Error(`Unknown message type: ${message?.type || "missing"}`);
}

async function getConfig() {
  if (cachedConfigPromise) return cachedConfigPromise;
  cachedConfigPromise = readConfig().finally(() => {
    cachedConfigPromise = null;
  });
  return cachedConfigPromise;
}

async function readConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return setCachedConfig(result[CONFIG_KEY] || DEFAULT_CONFIG);
}

function setCachedConfig(config) {
  cachedConfig = mergeConfig(config);
  return cachedConfig;
}

async function emitDebug(config, event, details = {}) {
  const normalizedConfig = mergeConfig(config);
  createDebugLogger(normalizedConfig.debug).log(event, details);
  if (!normalizedConfig.debug.enabled) return;

  const entry = {
    time: new Date().toISOString(),
    event,
    details
  };
  const events = await readDebugEvents();
  events.push(entry);
  await debugStorage().set({
    [DEBUG_LOG_KEY]: events.slice(-DEBUG_LOG_LIMIT)
  });
}

async function readDebugEvents() {
  const result = await debugStorage().get(DEBUG_LOG_KEY);
  return Array.isArray(result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : [];
}

function debugStorage() {
  return chrome.storage.session || chrome.storage.local;
}

async function saveConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: mergeConfig(config) });
}

async function getCurrentSiteStatus(url, config = null) {
  const normalizedConfig = config || await getConfig();
  const host = hostFromUrl(url);
  return buildSiteRouteStatus({
    ...normalizedConfig,
    host,
    geoip: {
      ...normalizedConfig.geoip,
      hostCountries: await geoIpCache.exportRecords()
    }
  });
}

async function applyProxySettings(config) {
  const startTime = nowMs();
  const normalizedConfig = mergeConfig(config);

  if (!normalizedConfig.enabled) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.action.setBadgeText({ text: "OFF" });
    await chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
    await emitDebug(normalizedConfig, "proxy-clear", {
      elapsedMs: elapsedMs(startTime)
    });
    return;
  }

  const hostCountries = await geoIpCache.exportRecords();
  cachedHostCountries = hostCountries;
  const pacScript = buildPacScript({
    ...normalizedConfig,
    geoip: {
      ...normalizedConfig.geoip,
      hostCountries
    }
  });

  await chrome.proxy.settings.set({
    scope: "regular",
    value: {
      mode: "pac_script",
      pacScript: {
        data: pacScript
      }
    }
  });

  await chrome.action.setBadgeText({ text: "ON" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
  await emitDebug(normalizedConfig, "proxy-apply", {
    elapsedMs: elapsedMs(startTime),
    geoIpRecords: Object.keys(hostCountries).length,
    pacBytes: pacScript.length
  });
}

async function testProxyConnection(proxy) {
  const previousConfig = await getConfig();
  const testConfig = createProxyTestConfig(proxy);
  const startTime = nowMs();
  proxyTestConfig = testConfig;

  try {
    await setPacProxySettings(testConfig);
    const response = await fetchWithTimeout(DEFAULT_PROXY_TEST_URL, DEFAULT_PROXY_TEST_TIMEOUT_MS);
    return {
      ok: true,
      status: response.status,
      elapsedMs: elapsedMs(startTime)
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeProxyTestError(error),
      elapsedMs: elapsedMs(startTime)
    };
  } finally {
    proxyTestConfig = null;
    await applyProxySettings(previousConfig);
  }
}

async function setPacProxySettings(config) {
  const pacScript = buildPacScript(config);
  await chrome.proxy.settings.set({
    scope: "regular",
    value: {
      mode: "pac_script",
      pacScript: {
        data: pacScript
      }
    }
  });
}

async function handleProxyAuthRequired(details) {
  const config = proxyTestConfig || cachedConfig || await getConfig();
  const credentials = findProxyAuthCredentials(config, details);
  if (!credentials) return {};

  await emitDebug(config, "proxy-auth", {
    host: details?.challenger?.host || "",
    port: details?.challenger?.port || ""
  });

  return { authCredentials: credentials };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${url}?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeProxyTestError(error) {
  if (error?.name === "AbortError") return "连接超时";
  return error?.message || "代理连接失败";
}

async function importSeedGeoIpIfNeeded(config) {
  if (config.geoip.cacheSeedImported) return;

  const response = await fetch(chrome.runtime.getURL("data/geoip-seed.json"));
  const records = await response.json();
  await geoIpCache.importRecords(records);
  config.geoip.cacheSeedImported = true;
}

function scheduleGeoIpCnRefresh() {
  chrome.alarms.create(GEOIP_CN_ALARM_NAME, {
    periodInMinutes: GEOIP_CN_REFRESH_INTERVAL_MS / 60000
  });
}

async function refreshGeoIpCnWithoutBlocking(config) {
  try {
    return await refreshGeoIpCnIfNeeded(config);
  } catch (error) {
    console.warn("GeoIP2-CN refresh failed", error);
    return {
      updated: false,
      error: error.message,
      records: config?.geoip?.cnRecordCount || 0,
      updatedAt: config?.geoip?.cnLastUpdatedAt || ""
    };
  }
}

async function refreshGeoIpCnIfNeeded(config = null, options = {}) {
  const normalizedConfig = config || await getConfig();
  if (!shouldRefreshGeoIpCn(normalizedConfig.geoip, Date.now(), options)) {
    return {
      updated: false,
      records: Object.keys(await geoIpCache.exportRecords()).length,
      updatedAt: normalizedConfig.geoip.cnLastUpdatedAt || ""
    };
  }

  const records = await fetchGeoIpCnRecords(fetch);
  await geoIpCache.replaceChinaCidrRecords(records);
  cachedHostCountries = await geoIpCache.exportRecords();
  normalizedConfig.geoip.cnLastUpdatedAt = new Date().toISOString();
  normalizedConfig.geoip.cnRecordCount = Object.keys(records).length;
  await saveConfig(normalizedConfig);
  await applyProxySettings(normalizedConfig);

  return {
    updated: true,
    records: normalizedConfig.geoip.cnRecordCount,
    updatedAt: normalizedConfig.geoip.cnLastUpdatedAt
  };
}

async function learnGeoIpFromCompletedRequest(details) {
  const requestInfo = requestStartTimes.get(details?.requestId) || {
    timeMs: nowMs(),
    proxied: false
  };
  requestStartTimes.delete(details?.requestId);
  networkSpeedSampler.record({
    timeMs: nowMs(),
    bytes: getResponseBytes(details),
    proxied: requestInfo.proxied,
    host: hostFromUrl(details?.url),
    type: details?.type || "other"
  });

  const configForDebug = cachedConfig || await getConfig();
  await emitDebug(configForDebug, "request-complete", {
    requestId: details?.requestId,
    type: details?.type,
    url: details?.url,
    ip: details?.ip || "",
    statusCode: details?.statusCode,
    elapsedMs: elapsedMs(requestInfo.timeMs)
  });

  if (!details?.ip || !details?.url) {
    await emitDebug(configForDebug, "geoip-skip", {
      requestId: details?.requestId,
      reason: "missing-ip-or-url"
    });
    return;
  }

  const host = hostFromUrl(details.url);
  if (!host) {
    await emitDebug(configForDebug, "geoip-skip", {
      requestId: details.requestId,
      reason: "invalid-url"
    });
    return;
  }

  const learnStartTime = nowMs();
  const country = await geoIpCache.learnHostCountryFromIp(host, details.ip);
  await emitDebug(configForDebug, country ? "geoip-learn" : "geoip-skip", {
    requestId: details.requestId,
    host,
    ip: details.ip,
    country: country || "",
    reason: country ? "matched-cidr" : "no-public-cidr-match",
    elapsedMs: elapsedMs(learnStartTime)
  });
  if (!country) return;

  const config = cachedConfig || await getConfig();
  if (!config.enabled || config.geoip.mode !== "proxyNonLocal") {
    await emitDebug(config, "proxy-apply-skip", {
      requestId: details.requestId,
      reason: !config.enabled ? "disabled" : "geoip-mode-disabled"
    });
    return;
  }

  await applyProxySettings(config);
}

async function logRequestDebug(details, event) {
  const config = cachedConfig || await getConfig();
  await emitDebug(config, event, {
    requestId: details.requestId,
    type: details.type,
    method: details.method,
    url: details.url
  });
}

function isRequestProxied(details) {
  const config = cachedConfig;
  if (!config || !details?.url) return false;
  const route = decideProxyRoute({
    ...config,
    host: hostFromUrl(details.url),
    geoip: {
      ...config.geoip,
      hostCountries: cachedHostCountries
    }
  });
  return route.action === "proxy";
}

function getResponseBytes(details) {
  const encodedDataLength = Number(details?.encodedDataLength);
  if (Number.isFinite(encodedDataLength) && encodedDataLength > 0) return encodedDataLength;

  const contentLengthHeader = (details?.responseHeaders || []).find((header) => {
    return String(header.name || "").toLowerCase() === "content-length";
  });
  const contentLength = Number(contentLengthHeader?.value);
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
