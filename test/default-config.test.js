import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CONFIG, mergeConfig } from "../src/shared/default-config.js";

describe("default config", () => {
  it("keeps debug logging disabled by default", () => {
    assert.deepEqual(DEFAULT_CONFIG.debug, { enabled: false });
    assert.deepEqual(mergeConfig({}).debug, { enabled: false });
  });

  it("preserves an enabled debug logging setting when merging config", () => {
    const config = mergeConfig({
      debug: {
        enabled: true
      }
    });

    assert.deepEqual(config.debug, { enabled: true });
  });

  it("normalizes proxy authentication settings when merging config", () => {
    const config = mergeConfig({
      proxies: [
        {
          id: "secure",
          name: "Secure Proxy",
          type: "HTTPS",
          host: "proxy.example.net",
          port: "8443",
          authentication: {
            type: "usernamePassword",
            username: "alice",
            password: "secret"
          }
        },
        {
          id: "open",
          name: "Open Proxy",
          type: "HTTP",
          host: "open.example.net",
          port: 8080,
          authentication: {
            type: "none",
            username: "ignored",
            password: "ignored"
          }
        }
      ]
    });

    assert.deepEqual(config.proxies[0].authentication, {
      type: "usernamePassword",
      username: "alice",
      password: "secret"
    });
    assert.equal(config.proxies[0].port, 8443);
    assert.deepEqual(config.proxies[1].authentication, { type: "none" });
  });
});
