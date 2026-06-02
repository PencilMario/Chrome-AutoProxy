const enabledToggle = document.querySelector("#enabledToggle");
const proxySelect = document.querySelector("#proxySelect");
const statusText = document.querySelector("#statusText");
const currentHost = document.querySelector("#currentHost");
const routeLabel = document.querySelector("#routeLabel");
const routeDetail = document.querySelector("#routeDetail");
const networkSpeed = document.querySelector("#networkSpeed");
const speedHint = document.querySelector("#speedHint");
const toggleSamples = document.querySelector("#toggleSamples");
const sampleList = document.querySelector("#sampleList");
const addDirectRule = document.querySelector("#addDirectRule");
const addProxyRule = document.querySelector("#addProxyRule");
const proxyCount = document.querySelector("#proxyCount");
const ruleCount = document.querySelector("#ruleCount");
const openOptions = document.querySelector("#openOptions");

let currentConfig = null;
let currentTabUrl = "";
let refreshTimer = null;
let samplesExpanded = false;

init();

async function init() {
  currentTabUrl = await getCurrentTabUrl();
  await refreshPopupState();
  refreshTimer = setInterval(refreshPopupState, 1000);
}

enabledToggle.addEventListener("change", async () => {
  const response = await sendMessage({ type: "TOGGLE_ENABLED", enabled: enabledToggle.checked });
  currentConfig = response.config;
  statusText.textContent = currentConfig.enabled ? "PAC 代理控制已启用" : "代理控制已停用";
  await refreshPopupState();
});

proxySelect.addEventListener("change", async () => {
  const response = await sendMessage({ type: "SET_ACTIVE_PROXY", proxyId: proxySelect.value });
  currentConfig = response.config;
  statusText.textContent = "当前代理服务器已切换";
  await refreshPopupState();
});

addDirectRule.addEventListener("click", () => addCurrentHostRule("direct"));

addProxyRule.addEventListener("click", () => addCurrentHostRule("proxy"));

toggleSamples.addEventListener("click", () => {
  samplesExpanded = !samplesExpanded;
  toggleSamples.setAttribute("aria-expanded", String(samplesExpanded));
  sampleList.hidden = !samplesExpanded;
  toggleSamples.textContent = samplesExpanded ? "收起样本" : "查看样本";
});

window.addEventListener("unload", () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function refreshPopupState() {
  try {
    const response = await sendMessage({ type: "GET_POPUP_STATE", url: currentTabUrl });
    currentConfig = response.config;
    render(currentConfig, response);
  } catch (error) {
    statusText.textContent = formatRuntimeError(error);
  }
}

async function addCurrentHostRule(ruleType) {
  const button = ruleType === "direct" ? addDirectRule : addProxyRule;
  button.disabled = true;
  try {
    const response = await sendMessage({
      type: "ADD_CURRENT_HOST_RULE",
      url: currentTabUrl,
      ruleType
    });
    currentConfig = response.config;
    render(currentConfig, response);
    statusText.textContent = response.added
      ? `${response.host} 已加入${ruleType === "direct" ? "直连" : "强制代理"}`
      : `${response.host} 已在列表中`;
  } catch (error) {
    statusText.textContent = formatRuntimeError(error);
  } finally {
    button.disabled = false;
  }
}

async function addSampleHostRule(host, ruleType, button) {
  button.disabled = true;
  try {
    const response = await sendMessage({
      type: "ADD_CURRENT_HOST_RULE",
      url: `https://${host}/`,
      ruleType
    });
    currentConfig = response.config;
    render(currentConfig, response);
    statusText.textContent = response.added
      ? `${response.host} 已加入${ruleType === "direct" ? "直连" : "强制代理"}`
      : `${response.host} 已在列表中`;
  } catch (error) {
    statusText.textContent = formatRuntimeError(error);
  } finally {
    button.disabled = false;
  }
}

function render(config, state = {}) {
  enabledToggle.checked = config.enabled;
  if (!statusText.textContent || statusText.textContent === "正在加载") {
    statusText.textContent = config.enabled ? "PAC 代理控制已启用" : "代理控制已停用";
  }

  renderProxySelect(config);
  renderSite(state.site);
  renderSpeed(state.speed);

  proxyCount.textContent = String(config.proxies.length);
  ruleCount.textContent = String((config.rules.direct || []).length + (config.rules.proxy || []).length);
}

function renderProxySelect(config) {
  if (proxySelect.dataset.renderedFor === JSON.stringify([config.activeProxyId, config.proxies.length])) {
    return;
  }

  proxySelect.innerHTML = "";
  for (const proxy of config.proxies) {
    const option = document.createElement("option");
    option.value = proxy.id;
    option.textContent = `${proxy.name} (${proxy.type})`;
    option.selected = proxy.id === config.activeProxyId;
    proxySelect.append(option);
  }
  proxySelect.dataset.renderedFor = JSON.stringify([config.activeProxyId, config.proxies.length]);
}

function renderSite(site = {}) {
  currentHost.textContent = site.host || "无法识别";
  routeLabel.textContent = site.label || "无法识别";
  routeDetail.textContent = site.detail || "-";
  const canAddRule = Boolean(site.host);
  addDirectRule.disabled = !canAddRule;
  addProxyRule.disabled = !canAddRule;
}

function renderSpeed(speed = {}) {
  if (!Number.isFinite(speed.bytesPerSecond)) {
    networkSpeed.textContent = "暂无数据";
    speedHint.textContent = "仅统计代理请求";
    return;
  }

  networkSpeed.textContent = formatSpeed(speed.bytesPerSecond);
  speedHint.textContent = `${speed.sampleCount || 0} 个代理响应样本`;
  renderSamples(speed.samples || []);
}

function renderSamples(samples) {
  toggleSamples.disabled = samples.length === 0;
  if (!samplesExpanded) {
    sampleList.hidden = true;
  }

  sampleList.innerHTML = "";
  if (!samples.length) {
    const empty = document.createElement("p");
    empty.className = "sample-empty";
    empty.textContent = "暂无代理响应样本";
    sampleList.append(empty);
    return;
  }

  for (const sample of samples.slice().reverse()) {
    sampleList.append(renderSample(sample));
  }
}

function renderSample(sample) {
  const row = document.createElement("article");
  row.className = "sample-row";

  const copy = document.createElement("div");
  copy.className = "sample-copy";

  const host = document.createElement("strong");
  host.textContent = sample.host || "未知域名";

  const meta = document.createElement("span");
  meta.textContent = `${sample.type || "other"} · ${formatBytes(sample.bytes)} · ${formatAge(sample.ageMs)}`;

  copy.append(host, meta);

  const actions = document.createElement("div");
  actions.className = "sample-actions";

  const directButton = document.createElement("button");
  directButton.type = "button";
  directButton.className = "mini-action";
  directButton.textContent = "直连";
  directButton.addEventListener("click", () => addSampleHostRule(sample.host, "direct", directButton));

  const proxyButton = document.createElement("button");
  proxyButton.type = "button";
  proxyButton.className = "mini-action";
  proxyButton.textContent = "强制";
  proxyButton.addEventListener("click", () => addSampleHostRule(sample.host, "proxy", proxyButton));

  actions.append(directButton, proxyButton);
  row.append(copy, actions);
  return row;
}

function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${bytesPerSecond} B/s`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs)) return "刚刚";
  return `${Math.round(ageMs / 1000)} 秒前`;
}

async function getCurrentTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url || "";
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension request failed");
  return response;
}

function formatRuntimeError(error) {
  const message = error?.message || String(error);
  if (message.includes("Unknown message type")) {
    return "扩展后台未更新，请在 chrome://extensions 重载扩展。";
  }
  return message;
}
