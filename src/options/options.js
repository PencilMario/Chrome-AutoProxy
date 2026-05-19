import { DEFAULT_CONFIG } from "../shared/default-config.js";

const proxyList = document.querySelector("#proxyList");
const proxyTemplate = document.querySelector("#proxyTemplate");
const directRules = document.querySelector("#directRules");
const proxyRules = document.querySelector("#proxyRules");
const localCountries = document.querySelector("#localCountries");
const geoipImport = document.querySelector("#geoipImport");
const debugEnabled = document.querySelector("#debugEnabled");
const pingDebug = document.querySelector("#pingDebug");
const refreshDebugLogs = document.querySelector("#refreshDebugLogs");
const clearDebugLogs = document.querySelector("#clearDebugLogs");
const debugLogOutput = document.querySelector("#debugLogOutput");
const saveButton = document.querySelector("#saveButton");
const addProxy = document.querySelector("#addProxy");
const restoreDirectDefaults = document.querySelector("#restoreDirectDefaults");
const message = document.querySelector("#message");

let config = null;

init();

async function init() {
  const response = await sendMessage({ type: "GET_CONFIG" });
  config = response.config;
  render();
}

addProxy.addEventListener("click", () => {
  config.proxies.push({
    id: crypto.randomUUID(),
    name: "新代理",
    type: "SOCKS5",
    host: "127.0.0.1",
    port: 1080
  });
  render();
});

restoreDirectDefaults.addEventListener("click", () => {
  directRules.value = stringifyRuleList(DEFAULT_CONFIG.rules.direct);
  showMessage("已恢复直连白名单默认值，保存后生效。");
});

saveButton.addEventListener("click", async () => {
  try {
    readForm();
    const response = await sendMessage({ type: "SAVE_CONFIG", config });
    config = response.config;
    render();
    showMessage("设置已保存");
  } catch (error) {
    showMessage(error.message);
  }
});

geoipImport.addEventListener("change", async () => {
  try {
    const file = geoipImport.files[0];
    if (!file) return;
    const records = JSON.parse(await file.text());
    await sendMessage({ type: "IMPORT_GEOIP", records });
    geoipImport.value = "";
    showMessage("GeoIP 记录已导入本地缓存");
  } catch (error) {
    showMessage(error.message);
  }
});

pingDebug.addEventListener("click", async () => {
  try {
    const response = await sendMessage({ type: "PING_DEBUG" });
    renderDebugLogs(response);
    showMessage(response.debugEnabled ? "测试日志已发送" : "Debug 未开启，请勾选并保存");
  } catch (error) {
    showMessage(error.message);
  }
});

refreshDebugLogs.addEventListener("click", async () => {
  try {
    renderDebugLogs(await sendMessage({ type: "GET_DEBUG_LOGS" }));
  } catch (error) {
    showMessage(error.message);
  }
});

clearDebugLogs.addEventListener("click", async () => {
  try {
    renderDebugLogs(await sendMessage({ type: "CLEAR_DEBUG_LOGS" }));
    showMessage("调试日志已清空");
  } catch (error) {
    showMessage(error.message);
  }
});

function render() {
  proxyList.innerHTML = "";
  for (const proxy of config.proxies) {
    proxyList.append(renderProxy(proxy));
  }

  directRules.value = stringifyRuleList(config.rules.direct);
  proxyRules.value = stringifyRuleList(config.rules.proxy);
  localCountries.value = config.geoip.localCountries.join(", ");
  debugEnabled.checked = Boolean(config.debug?.enabled);
}

function renderProxy(proxy) {
  const row = proxyTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.proxyId = proxy.id;
  row.querySelector('[data-field="name"]').value = proxy.name;
  row.querySelector('[data-field="type"]').value = proxy.type;
  row.querySelector('[data-field="host"]').value = proxy.host;
  row.querySelector('[data-field="port"]').value = proxy.port;
  row.querySelector('[data-action="remove"]').addEventListener("click", () => {
    config.proxies = config.proxies.filter((item) => item.id !== proxy.id);
    if (config.activeProxyId === proxy.id) config.activeProxyId = config.proxies[0]?.id || "";
    render();
  });
  return row;
}

function readForm() {
  config.proxies = [...proxyList.querySelectorAll(".proxy-row")].map((row) => ({
    id: row.dataset.proxyId,
    name: row.querySelector('[data-field="name"]').value.trim(),
    type: row.querySelector('[data-field="type"]').value,
    host: row.querySelector('[data-field="host"]').value.trim(),
    port: Number(row.querySelector('[data-field="port"]').value)
  })).filter((proxy) => proxy.name && proxy.host && Number.isInteger(proxy.port));

  if (!config.proxies.length) {
    throw new Error("至少需要保留一个代理档案");
  }

  if (!config.proxies.some((proxy) => proxy.id === config.activeProxyId)) {
    config.activeProxyId = config.proxies[0].id;
  }

  config.rules.direct = parseSimpleRules(directRules.value);
  config.rules.proxy = parseProxyRules(proxyRules.value);
  config.geoip.localCountries = localCountries.value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  config.debug = {
    ...(config.debug || {}),
    enabled: debugEnabled.checked
  };
}

function parseSimpleRules(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parseProxyRules(value) {
  return parseSimpleRules(value).map((line) => {
    const [pattern, proxyId] = line.split(/\s*=>\s*/);
    return proxyId ? { pattern, proxyId } : pattern;
  });
}

function stringifyRuleList(list) {
  return (list || [])
    .map((rule) => typeof rule === "string" ? rule : `${rule.pattern} => ${rule.proxyId}`)
    .join("\n");
}

function showMessage(text) {
  message.textContent = text;
  setTimeout(() => {
    message.textContent = "";
  }, 2500);
}

function renderDebugLogs(response) {
  const events = response.events || [];
  debugLogOutput.value = events.length
    ? events.map(formatDebugEvent).join("\n")
    : `Debug ${response.debugEnabled ? "已开启" : "未开启"}，暂无日志。`;
  debugLogOutput.scrollTop = debugLogOutput.scrollHeight;
}

function formatDebugEvent(entry) {
  return `${entry.time} ${entry.event} ${JSON.stringify(entry.details)}`;
}

async function sendMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error || "扩展请求失败");
  return response;
}
