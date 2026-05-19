const enabledToggle = document.querySelector("#enabledToggle");
const proxySelect = document.querySelector("#proxySelect");
const statusText = document.querySelector("#statusText");
const proxyCount = document.querySelector("#proxyCount");
const ruleCount = document.querySelector("#ruleCount");
const openOptions = document.querySelector("#openOptions");

let currentConfig = null;

init();

async function init() {
  const response = await sendMessage({ type: "GET_CONFIG" });
  currentConfig = response.config;
  render(currentConfig);
}

enabledToggle.addEventListener("change", async () => {
  const response = await sendMessage({ type: "TOGGLE_ENABLED", enabled: enabledToggle.checked });
  currentConfig = response.config;
  render(currentConfig);
});

proxySelect.addEventListener("change", async () => {
  const response = await sendMessage({ type: "SET_ACTIVE_PROXY", proxyId: proxySelect.value });
  currentConfig = response.config;
  render(currentConfig);
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function render(config) {
  enabledToggle.checked = config.enabled;
  statusText.textContent = config.enabled ? "PAC proxy control active" : "Proxy control disabled";

  proxySelect.innerHTML = "";
  for (const proxy of config.proxies) {
    const option = document.createElement("option");
    option.value = proxy.id;
    option.textContent = `${proxy.name} (${proxy.type})`;
    option.selected = proxy.id === config.activeProxyId;
    proxySelect.append(option);
  }

  proxyCount.textContent = String(config.proxies.length);
  ruleCount.textContent = String((config.rules.direct || []).length + (config.rules.proxy || []).length);
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension request failed");
  return response;
}
