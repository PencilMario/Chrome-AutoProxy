import { DEFAULT_CONFIG } from "../shared/default-config.js";

const proxyList = document.querySelector("#proxyList");
const proxyTemplate = document.querySelector("#proxyTemplate");
const directRules = document.querySelector("#directRules");
const proxyRules = document.querySelector("#proxyRules");
const proxyDialog = document.querySelector("#proxyDialog");
const proxyForm = document.querySelector("#proxyForm");
const proxyDialogTitle = document.querySelector("#proxyDialogTitle");
const proxyName = document.querySelector("#proxyName");
const proxyType = document.querySelector("#proxyType");
const proxyHost = document.querySelector("#proxyHost");
const proxyPort = document.querySelector("#proxyPort");
const proxyAuthType = document.querySelector("#proxyAuthType");
const proxyUsername = document.querySelector("#proxyUsername");
const proxyPassword = document.querySelector("#proxyPassword");
const toggleProxyPassword = document.querySelector("#toggleProxyPassword");
const proxyTestResult = document.querySelector("#proxyTestResult");
const testProxy = document.querySelector("#testProxy");
const localCountries = document.querySelector("#localCountries");
const geoipImport = document.querySelector("#geoipImport");
const updateGeoIpCn = document.querySelector("#updateGeoIpCn");
const geoipCnStatus = document.querySelector("#geoipCnStatus");
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
let editingProxyId = "";

init();

async function init() {
  const response = await sendMessage({ type: "GET_CONFIG" });
  config = response.config;
  render();
}

addProxy.addEventListener("click", () => {
  openProxyDialog();
});

proxyAuthType.addEventListener("change", updateAuthFields);

toggleProxyPassword.addEventListener("click", () => {
  const visible = proxyPassword.type === "password";
  setPasswordVisibility(visible);
});

testProxy.addEventListener("click", async () => {
  testProxy.disabled = true;
  proxyTestResult.textContent = "正在测试代理连接...";
  try {
    const proxy = readProxyDialogFields();
    const response = await sendMessage({ type: "TEST_PROXY_CONNECTION", proxy });
    proxyTestResult.textContent = response.result.ok
      ? `连接正常，耗时 ${response.result.elapsedMs}ms`
      : `连接失败：${response.result.error}`;
  } catch (error) {
    proxyTestResult.textContent = error.message;
  } finally {
    testProxy.disabled = false;
  }
});

proxyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    saveProxyFromDialog();
    proxyDialog.close();
    renderProxyList();
    showMessage("代理服务器已更新，保存配置后生效。");
  } catch (error) {
    showMessage(error.message);
  }
});

proxyDialog.querySelectorAll('[data-action="cancel-proxy"]').forEach((button) => {
  button.addEventListener("click", () => proxyDialog.close());
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

updateGeoIpCn.addEventListener("click", async () => {
  updateGeoIpCn.disabled = true;
  geoipCnStatus.textContent = "正在更新...";
  try {
    const response = await sendMessage({ type: "UPDATE_GEOIP_CN" });
    config.geoip = {
      ...(config.geoip || {}),
      cnLastUpdatedAt: response.updatedAt,
      cnRecordCount: response.records
    };
    renderGeoIpCnStatus();
    showMessage(`GeoIP2-CN 已更新：${response.records} 条 CN CIDR`);
  } catch (error) {
    geoipCnStatus.textContent = "更新失败";
    showMessage(error.message);
  } finally {
    updateGeoIpCn.disabled = false;
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
  renderProxyList();
  directRules.value = stringifyRuleList(config.rules.direct);
  proxyRules.value = stringifyRuleList(config.rules.proxy);
  localCountries.value = config.geoip.localCountries.join(", ");
  renderGeoIpCnStatus();
  debugEnabled.checked = Boolean(config.debug?.enabled);
}

function renderProxyList() {
  proxyList.innerHTML = "";
  for (const proxy of config.proxies) {
    proxyList.append(renderProxy(proxy));
  }
}

function renderProxy(proxy) {
  const row = proxyTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.proxyId = proxy.id;
  row.querySelector('[data-field="name"]').textContent = proxy.name;
  row.querySelector('[data-field="endpoint"]').textContent = `${proxy.type} ${proxy.host}:${proxy.port}`;
  row.querySelector('[data-field="authentication"]').textContent = proxy.authentication?.type === "usernamePassword"
    ? "用户名/密码"
    : "无需认证";
  row.querySelector('[data-action="edit"]').addEventListener("click", () => openProxyDialog(proxy));
  row.querySelector('[data-action="remove"]').addEventListener("click", () => {
    config.proxies = config.proxies.filter((item) => item.id !== proxy.id);
    if (config.activeProxyId === proxy.id) config.activeProxyId = config.proxies[0]?.id || "";
    renderProxyList();
    showMessage("代理服务器已移除，保存配置后生效。");
  });
  return row;
}

function readForm() {
  if (!config.proxies.length) {
    throw new Error("至少需要保留一个代理服务器");
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

function openProxyDialog(proxy = null) {
  editingProxyId = proxy?.id || "";
  proxyDialogTitle.textContent = proxy ? "编辑服务器" : "新增服务器";
  proxyName.value = proxy?.name || "";
  proxyType.value = proxy?.type || "SOCKS5";
  proxyHost.value = proxy?.host || "";
  proxyPort.value = proxy?.port || "";
  proxyAuthType.value = proxy?.authentication?.type || "none";
  proxyUsername.value = proxy?.authentication?.username || "";
  proxyPassword.value = proxy?.authentication?.password || "";
  setPasswordVisibility(false);
  proxyTestResult.textContent = "";
  updateAuthFields();
  proxyDialog.showModal();
  proxyName.focus();
}

function saveProxyFromDialog() {
  const proxy = readProxyDialogFields();

  if (editingProxyId) {
    config.proxies = config.proxies.map((item) => item.id === editingProxyId ? proxy : item);
  } else {
    config.proxies.push(proxy);
    if (!config.activeProxyId) config.activeProxyId = proxy.id;
  }
}

function readProxyDialogFields() {
  const port = Number(proxyPort.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口必须在 1 到 65535 之间");
  }

  const proxy = {
    id: editingProxyId || crypto.randomUUID(),
    name: proxyName.value.trim(),
    type: proxyType.value,
    host: proxyHost.value.trim(),
    port,
    authentication: readAuthenticationFields()
  };

  if (!proxy.name || !proxy.host) {
    throw new Error("请填写代理服务器名称和主机地址");
  }

  return proxy;
}

function readAuthenticationFields() {
  if (proxyAuthType.value !== "usernamePassword") {
    return { type: "none" };
  }

  const username = proxyUsername.value.trim();
  if (!username) {
    throw new Error("用户名/密码认证需要填写用户名");
  }

  return {
    type: "usernamePassword",
    username,
    password: proxyPassword.value
  };
}

function updateAuthFields() {
  const enabled = proxyAuthType.value === "usernamePassword";
  for (const field of proxyDialog.querySelectorAll(".auth-field")) {
    field.hidden = !enabled;
  }
  proxyUsername.required = enabled;
  proxyPassword.required = false;
}

function setPasswordVisibility(visible) {
  proxyPassword.type = visible ? "text" : "password";
  toggleProxyPassword.textContent = visible ? "隐藏" : "显示";
  toggleProxyPassword.setAttribute("aria-pressed", String(visible));
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

function renderGeoIpCnStatus() {
  const count = Number(config.geoip?.cnRecordCount || 0);
  const updatedAt = config.geoip?.cnLastUpdatedAt;
  if (!updatedAt) {
    geoipCnStatus.textContent = "尚未更新";
    return;
  }

  geoipCnStatus.textContent = `${count} 条，${new Date(updatedAt).toLocaleString()}`;
}

function formatDebugEvent(entry) {
  return `${entry.time} ${entry.event} ${JSON.stringify(entry.details)}`;
}

async function sendMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error || "扩展请求失败");
  return response;
}
