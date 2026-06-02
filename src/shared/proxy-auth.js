export function findProxyAuthCredentials(config, details) {
  if (!details?.isProxy) return null;

  const host = normalizeChallengeHost(details.challenger?.host);
  const port = Number(details.challenger?.port);
  if (!host || !Number.isInteger(port)) return null;

  const proxy = (config?.proxies || []).find((item) => {
    return normalizeChallengeHost(item.host) === host && Number(item.port) === port;
  });
  if (!proxy?.authentication || proxy.authentication.type !== "usernamePassword") return null;
  if (!proxy.authentication.username) return null;

  return {
    username: proxy.authentication.username,
    password: proxy.authentication.password || ""
  };
}

function normalizeChallengeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}
