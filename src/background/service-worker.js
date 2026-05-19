import { createIndexedDbGeoIpStore, GeoIpCache } from "../shared/geoip-cache.js";
import { buildPacScript } from "../shared/proxy-engine.js";
import { DEFAULT_CONFIG, mergeConfig } from "../shared/default-config.js";
import { createDebugLogger, elapsedMs, nowMs } from "../shared/debug-logger.js";

const CONFIG_KEY = "autoproxyConfig";
const DEBUG_LOG_KEY = "autoproxyDebugEvents";
const DEBUG_LOG_LIMIT = 80;
const geoIpCache = new GeoIpCache(createIndexedDbGeoIpStore());
const requestStartTimes = new Map();
let cachedConfig = null;
let cachedConfigPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await importSeedGeoIpIfNeeded(config);
  await saveConfig(config);
  await applyProxySettings(config);
});

chrome.runtime.onStartup.addListener(async () => {
  await applyProxySettings(await getConfig());
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    learnGeoIpFromCompletedRequest(details);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestStartTimes.set(details.requestId, nowMs());
    logRequestDebug(details, "request-start");
  },
  { urls: ["<all_urls>"] }
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

  if (message?.type === "SAVE_CONFIG") {
    const config = mergeConfig(message.config);
    await saveConfig(config);
    await applyProxySettings(config);
    return { ok: true, config };
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
    return { ok: true, records: await geoIpCache.exportRecords() };
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

async function importSeedGeoIpIfNeeded(config) {
  if (config.geoip.cacheSeedImported) return;

  const response = await fetch(chrome.runtime.getURL("data/geoip-seed.json"));
  const records = await response.json();
  await geoIpCache.importRecords(records);
  config.geoip.cacheSeedImported = true;
}

async function learnGeoIpFromCompletedRequest(details) {
  const startTime = requestStartTimes.get(details?.requestId) || nowMs();
  requestStartTimes.delete(details?.requestId);

  const configForDebug = cachedConfig || await getConfig();
  await emitDebug(configForDebug, "request-complete", {
    requestId: details?.requestId,
    type: details?.type,
    url: details?.url,
    ip: details?.ip || "",
    statusCode: details?.statusCode,
    elapsedMs: elapsedMs(startTime)
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

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
