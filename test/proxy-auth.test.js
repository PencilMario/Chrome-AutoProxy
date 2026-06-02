import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findProxyAuthCredentials } from "../src/shared/proxy-auth.js";

const config = {
  proxies: [
    {
      id: "secure",
      name: "Secure Proxy",
      type: "HTTPS",
      host: "proxy.example.net",
      port: 8443,
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
      authentication: { type: "none" }
    }
  ],
  activeProxyId: "secure"
};

describe("proxy authentication", () => {
  it("returns credentials for matching proxy authentication challenges", () => {
    assert.deepEqual(
      findProxyAuthCredentials(config, {
        isProxy: true,
        challenger: {
          host: "PROXY.EXAMPLE.NET",
          port: 8443
        }
      }),
      {
        username: "alice",
        password: "secret"
      }
    );
  });

  it("does not return credentials for normal website authentication", () => {
    assert.equal(
      findProxyAuthCredentials(config, {
        isProxy: false,
        challenger: {
          host: "proxy.example.net",
          port: 8443
        }
      }),
      null
    );
  });

  it("does not return credentials for proxies without username and password authentication", () => {
    assert.equal(
      findProxyAuthCredentials(config, {
        isProxy: true,
        challenger: {
          host: "open.example.net",
          port: 8080
        }
      }),
      null
    );
  });
});
