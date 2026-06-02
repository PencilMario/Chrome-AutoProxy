import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addHostRule,
  buildSiteRouteStatus,
  createNetworkSpeedSampler
} from "../src/shared/popup-state.js";

const proxies = [
  { id: "hk", name: "Hong Kong", type: "SOCKS5", host: "127.0.0.1", port: 1080 },
  { id: "jp", name: "Japan", type: "HTTPS", host: "proxy.example.net", port: 8443 }
];

describe("popup site route status", () => {
  it("describes direct, forced proxy, geoip proxy, default direct, and disabled routes", () => {
    assert.deepEqual(
      buildSiteRouteStatus({
        enabled: false,
        host: "blocked.example",
        rules: { direct: [], proxy: ["blocked.example"] },
        proxies,
        activeProxyId: "hk",
        geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountries: {} }
      }),
      {
        host: "blocked.example",
        label: "代理已停用",
        detail: "PAC 代理控制已停用",
        action: "direct",
        reason: "disabled"
      }
    );

    assert.deepEqual(
      buildSiteRouteStatus({
        enabled: true,
        host: "baidu.com",
        rules: { direct: ["baidu.com"], proxy: [] },
        proxies,
        activeProxyId: "hk",
        geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountries: {} }
      }).label,
      "直连"
    );

    const forcedProxy = buildSiteRouteStatus({
      enabled: true,
      host: "video.example.net",
      rules: { direct: [], proxy: [{ pattern: "*.example.net", proxyId: "jp" }] },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountries: {} }
    });
    assert.equal(forcedProxy.label, "强制代理");
    assert.equal(forcedProxy.detail, "*.example.net -> Japan");

    const geoProxy = buildSiteRouteStatus({
      enabled: true,
      host: "global.example",
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountries: { "global.example": "US" } }
    });
    assert.equal(geoProxy.label, "GeoIP 代理");
    assert.equal(geoProxy.detail, "US -> Hong Kong");

    const geoUnknown = buildSiteRouteStatus({
      enabled: true,
      host: "unknown.example",
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountries: {} }
    });
    assert.equal(geoUnknown.label, "GeoIP 代理");
    assert.equal(geoUnknown.detail, "未知地区 -> Hong Kong");

    assert.equal(
      buildSiteRouteStatus({
        enabled: true,
        host: "unknown.example",
        rules: { direct: [], proxy: [] },
        proxies,
        activeProxyId: "hk",
        geoip: { mode: "disabled", localCountries: ["CN"], hostCountries: {} }
      }).label,
      "默认直连"
    );
  });
});

describe("popup one-click host rules", () => {
  it("adds a host to direct rules and removes the same host from forced proxy rules", () => {
    const result = addHostRule({
      config: {
        rules: {
          direct: [],
          proxy: ["example.com", "*.keep.example"]
        }
      },
      host: "example.com",
      ruleType: "direct"
    });

    assert.equal(result.added, true);
    assert.deepEqual(result.config.rules.direct, ["example.com"]);
    assert.deepEqual(result.config.rules.proxy, ["*.keep.example"]);
  });

  it("does not duplicate an existing effective rule", () => {
    const result = addHostRule({
      config: {
        rules: {
          direct: ["*.example.com"],
          proxy: []
        }
      },
      host: "www.example.com",
      ruleType: "direct"
    });

    assert.equal(result.added, false);
    assert.deepEqual(result.config.rules.direct, ["*.example.com"]);
  });

  it("adds a host to forced proxy rules and removes conflicting direct rules", () => {
    const result = addHostRule({
      config: {
        rules: {
          direct: ["example.com", "*.local", "*.example.net"],
          proxy: []
        }
      },
      host: "www.example.net",
      ruleType: "proxy"
    });

    assert.equal(result.added, true);
    assert.deepEqual(result.config.rules.direct, ["example.com", "*.local"]);
    assert.deepEqual(result.config.rules.proxy, ["www.example.net"]);
  });
});

describe("popup network speed sampler", () => {
  it("calculates recent proxy-only throughput and ignores direct samples", () => {
    const sampler = createNetworkSpeedSampler({ windowMs: 5000 });

    sampler.record({ timeMs: 1000, bytes: 1000, proxied: true, host: "api.example.com", type: "xmlhttprequest" });
    sampler.record({ timeMs: 2000, bytes: 9000, proxied: true, host: "cdn.example.com", type: "image" });
    sampler.record({ timeMs: 3000, bytes: 20000, proxied: false, host: "direct.example.com", type: "script" });

    assert.deepEqual(sampler.snapshot(4000), {
      bytesPerSecond: 2000,
      sampleCount: 2,
      windowMs: 5000,
      samples: [
        {
          id: "api.example.com|xmlhttprequest|1000|1000",
          ageMs: 3000,
          bytes: 1000,
          host: "api.example.com",
          type: "xmlhttprequest"
        },
        {
          id: "cdn.example.com|image|2000|9000",
          ageMs: 2000,
          bytes: 9000,
          host: "cdn.example.com",
          type: "image"
        }
      ]
    });
  });

  it("returns null speed when there are no recent proxy samples", () => {
    const sampler = createNetworkSpeedSampler({ windowMs: 5000 });
    sampler.record({ timeMs: 1000, bytes: 4096, proxied: true });

    assert.deepEqual(sampler.snapshot(7000), {
      bytesPerSecond: null,
      sampleCount: 0,
      windowMs: 5000,
      samples: []
    });
  });
});
