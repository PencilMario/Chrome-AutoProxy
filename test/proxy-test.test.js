import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProxyTestConfig, normalizeProxyForTest } from "../src/shared/proxy-test.js";

describe("proxy connection tests", () => {
  it("builds an isolated proxy config that sends traffic through the tested proxy", () => {
    const config = createProxyTestConfig({
      id: "saved",
      name: "Saved Proxy",
      type: "socks5",
      host: "127.0.0.1",
      port: "7890",
      authentication: {
        type: "usernamePassword",
        username: "alice",
        password: "secret"
      }
    });

    assert.equal(config.enabled, true);
    assert.equal(config.activeProxyId, "__proxy_test__");
    assert.deepEqual(config.rules, {
      direct: [],
      proxy: ["*"]
    });
    assert.equal(config.geoip.mode, "disabled");
    assert.deepEqual(config.proxies, [
      {
        id: "__proxy_test__",
        name: "代理测试",
        type: "SOCKS5",
        host: "127.0.0.1",
        port: 7890,
        authentication: {
          type: "usernamePassword",
          username: "alice",
          password: "secret"
        }
      }
    ]);
  });

  it("rejects invalid proxy endpoints before applying temporary proxy settings", () => {
    assert.throws(
      () => normalizeProxyForTest({ type: "HTTP", host: "proxy.example", port: 70000 }),
      /端口必须在 1 到 65535 之间/
    );
    assert.throws(
      () => normalizeProxyForTest({ type: "HTTP", host: "", port: 8080 }),
      /请填写代理服务器主机地址/
    );
  });
});
