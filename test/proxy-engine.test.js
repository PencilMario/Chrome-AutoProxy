import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import {
  buildPacScript,
  decideProxyRoute,
  formatProxyEndpoint,
  matchHostRule
} from "../src/shared/proxy-engine.js";
import { DEFAULT_CONFIG } from "../src/shared/default-config.js";

const proxies = [
  { id: "hk", name: "Hong Kong", type: "SOCKS5", host: "127.0.0.1", port: 1080 },
  { id: "jp", name: "Japan", type: "HTTPS", host: "proxy.example.net", port: 8443 }
];

describe("rule matching", () => {
  it("matches exact hosts, wildcard suffixes, and raw IP patterns", () => {
    assert.equal(matchHostRule("example.com", "example.com"), true);
    assert.equal(matchHostRule("api.example.com", "*.example.com"), true);
    assert.equal(matchHostRule("example.com", "*.example.com"), false);
    assert.equal(matchHostRule("203.0.113.42", "203.0.113.*"), true);
    assert.equal(matchHostRule("shop.example.org", "*.example.com"), false);
  });
});

describe("proxy route decisions", () => {
  it("uses DIRECT when the master switch is disabled", () => {
    const route = decideProxyRoute({
      enabled: false,
      host: "blocked.example",
      rules: { proxy: ["blocked.example"], direct: [] },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
    });

    assert.deepEqual(route, { action: "direct", reason: "disabled" });
  });

  it("gives whitelist/direct rules priority over blacklist/proxy rules", () => {
    const route = decideProxyRoute({
      enabled: true,
      host: "news.example.com",
      rules: {
        direct: ["*.example.com"],
        proxy: ["news.example.com"]
      },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
    });

    assert.deepEqual(route, { action: "direct", reason: "direct-rule", matchedRule: "*.example.com" });
  });

  it("uses an explicit proxy profile from a blacklist rule when provided", () => {
    const route = decideProxyRoute({
      enabled: true,
      host: "video.example.net",
      rules: {
        direct: [],
        proxy: [{ pattern: "*.example.net", proxyId: "jp" }]
      },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "CN" }
    });

    assert.equal(route.action, "proxy");
    assert.equal(route.reason, "proxy-rule");
    assert.equal(route.proxy.id, "jp");
  });

  it("falls back to GeoIP and proxies non-local countries", () => {
    const route = decideProxyRoute({
      enabled: true,
      host: "global.example",
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
    });

    assert.equal(route.action, "proxy");
    assert.equal(route.reason, "geoip-non-local");
    assert.equal(route.proxy.id, "hk");
  });

  it("uses DIRECT for local GeoIP countries and private IPs", () => {
    assert.equal(
      decideProxyRoute({
        enabled: true,
        host: "intranet.local",
        rules: { direct: [], proxy: [] },
        proxies,
        activeProxyId: "hk",
        geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "CN" }
      }).action,
      "direct"
    );

    assert.deepEqual(
      decideProxyRoute({
        enabled: true,
        host: "192.168.1.10",
        rules: { direct: [], proxy: [] },
        proxies,
        activeProxyId: "hk",
        geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
      }),
      { action: "direct", reason: "private-ip" }
    );
  });

  it("uses DIRECT for reserved IP ranges before proxy rules", () => {
    for (const host of [
      "0.1.2.3",
      "10.2.3.4",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.10.20",
      "172.20.1.2",
      "192.0.2.10",
      "192.168.1.10",
      "198.18.0.1",
      "198.51.100.42",
      "203.0.113.7",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255"
    ]) {
      assert.deepEqual(
        decideProxyRoute({
          enabled: true,
          host,
          rules: { direct: [], proxy: ["*"] },
          proxies,
          activeProxyId: "hk",
          geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
        }),
        { action: "direct", reason: "private-ip" },
        host
      );
    }
  });

  it("uses DIRECT for local hosts even when the host includes a port", () => {
    for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) {
      assert.deepEqual(
        decideProxyRoute({
          enabled: true,
          host,
          rules: { direct: [], proxy: ["*"] },
          proxies,
          activeProxyId: "hk",
          geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
        }),
        { action: "direct", reason: "private-ip" },
        host
      );
    }
  });

  it("uses DIRECT for browser security software hosts before proxy rules", () => {
    for (const host of [
      ["gc.kis.v2.scr.kaspersky-labs.com", "*.kis.v2.scr.kaspersky-labs.com"],
      ["trafficlight.bitdefender.com", "trafficlight.bitdefender.com"],
      ["api.trafficlight.bitdefender.com", "*.trafficlight.bitdefender.com"],
      ["safeweb.norton.com", "safeweb.norton.com"],
      ["search.norton.com", "search.norton.com"],
      ["siteadvisor.com", "siteadvisor.com"],
      ["www.siteadvisor.com", "*.siteadvisor.com"],
      ["www.trustedsource.org", "*.trustedsource.org"]
    ]) {
      const route = decideProxyRoute({
        enabled: true,
        host: host[0],
        rules: { direct: [], proxy: ["*"] },
        proxies,
        activeProxyId: "hk",
        geoip: { mode: "proxyNonLocal", localCountries: ["CN"], hostCountry: "US" }
      });

      assert.deepEqual(route, {
        action: "direct",
        reason: "built-in-direct-rule",
        matchedRule: host[1]
      });
    }
  });
});

describe("PAC generation", () => {
  it("formats supported proxy endpoints for Chrome PAC", () => {
    assert.equal(formatProxyEndpoint(proxies[0]), "SOCKS5 127.0.0.1:1080");
    assert.equal(formatProxyEndpoint(proxies[1]), "HTTPS proxy.example.net:8443");
  });

  it("routes ChatGPT through the default localhost proxy profile", () => {
    const config = {
      ...DEFAULT_CONFIG,
      enabled: true,
      geoip: {
        ...DEFAULT_CONFIG.geoip,
        hostCountries: {}
      }
    };
    const pac = buildPacScript(config);

    const result = vm.runInNewContext(
      `${pac}\nFindProxyForURL("https://chatgpt.com/", "chatgpt.com");`,
      { dnsResolve: () => "104.18.32.47" }
    );

    assert.equal(result, "SOCKS5 127.0.0.1:7890");
  });

  it("routes common China domains DIRECT by default", () => {
    const config = {
      ...DEFAULT_CONFIG,
      enabled: true,
      geoip: {
        ...DEFAULT_CONFIG.geoip,
        hostCountries: {}
      }
    };
    const pac = buildPacScript(config);

    for (const host of ["baidu.com", "www.qq.com", "detail.tmall.com", "api.bilibili.com"]) {
      const result = vm.runInNewContext(
        `${pac}\nFindProxyForURL("https://${host}/", "${host}");`,
        { dnsResolve: () => "198.51.100.42" }
      );
      assert.equal(result, "DIRECT", host);
    }
  });

  it("generates only ASCII PAC data and converts IDN rules to Punycode", () => {
    const pac = buildPacScript({
      ...DEFAULT_CONFIG,
      enabled: true,
      activeProxyId: "香港",
      proxies: [
        { id: "香港", name: "香港节点", type: "SOCKS5", host: "127.0.0.1", port: 7890 }
      ],
      rules: {
        direct: ["中国", "*.中国", "例子.测试"],
        proxy: [{ pattern: "*.外网.测试", proxyId: "香港" }]
      },
      geoip: {
        ...DEFAULT_CONFIG.geoip,
        hostCountries: {
          "例子.测试": "CN"
        }
      }
    });

    assert.equal(/^[\x00-\x7F]*$/.test(pac), true);
    assert.match(pac, /xn--fiqs8s/);
    assert.match(pac, /xn--fsqu00a\.xn--0zwm56d/);

    const directResult = vm.runInNewContext(
      `${pac}\nFindProxyForURL("https://xn--fsqu00a.xn--0zwm56d/", "xn--fsqu00a.xn--0zwm56d");`,
      { dnsResolve: () => "198.51.100.42" }
    );
    assert.equal(directResult, "DIRECT");
  });

  it("routes reserved IP ranges DIRECT in generated PAC", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: ["*"] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {}
      }
    });

    for (const host of ["127.0.0.1", "100.64.0.1", "192.0.2.10", "198.51.100.42", "203.0.113.7", "224.0.0.1"]) {
      const result = vm.runInNewContext(
        `${pac}\nFindProxyForURL("http://${host}/", "${host}");`,
        { dnsResolve: () => null }
      );
      assert.equal(result, "DIRECT", host);
    }
  });

  it("routes local hosts with ports DIRECT in generated PAC", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: ["*"] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {}
      }
    });

    for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) {
      const result = vm.runInNewContext(
        `${pac}\nFindProxyForURL("http://${host}/", "${host}");`,
        { dnsResolve: () => null }
      );
      assert.equal(result, "DIRECT", host);
    }
  });

  it("routes local URLs DIRECT even when PAC host is missing or unexpected", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: ["*"] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {}
      }
    });

    for (const url of [
      "http://127.0.0.1:8080/",
      "http://localhost:8080/",
      "http://[::1]:8080/"
    ]) {
      const result = vm.runInNewContext(
        `${pac}\nFindProxyForURL("${url}", "");`,
        { dnsResolve: () => null }
      );
      assert.equal(result, "DIRECT", url);
    }
  });

  it("routes browser security software hosts DIRECT in generated PAC", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: ["*"] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {}
      }
    });

    for (const host of [
      "gc.kis.v2.scr.kaspersky-labs.com",
      "trafficlight.bitdefender.com",
      "api.trafficlight.bitdefender.com",
      "safeweb.norton.com",
      "search.norton.com",
      "siteadvisor.com",
      "www.siteadvisor.com",
      "www.trustedsource.org"
    ]) {
      const result = vm.runInNewContext(
        `${pac}\nFindProxyForURL("http://${host}/script.js", "${host}");`,
        { dnsResolve: () => "203.0.113.42" }
      );

      assert.equal(result, "DIRECT", host);
    }
  });

  it("generates a PAC script with direct rules, proxy rules, and GeoIP country map", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: {
        direct: ["*.local.test"],
        proxy: [{ pattern: "*.blocked.test", proxyId: "jp" }]
      },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {
          "cn.example": "CN",
          "us.example": "US",
          "203.0.113.0/24": "US"
        }
      }
    });

    assert.match(pac, /function FindProxyForURL/);
    assert.match(pac, /"\*\.local\.test"/);
    assert.match(pac, /HTTPS proxy\.example\.net:8443/);
    assert.match(pac, /"us\.example":"US"/);
    assert.match(pac, /GEOIP_CIDRS/);
    assert.match(pac, /"203\.0\.113\.0\/24"/);
    assert.match(pac, /return "SOCKS5 127\.0\.0\.1:1080"/);
  });

  it("uses dnsResolve in generated PAC to classify domains by cached IP CIDR GeoIP data", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {
          "203.0.113.0/24": "US"
        }
      }
    });
    const context = {
      dnsResolve: (host) => host === "resolved.example" ? "203.0.113.42" : null
    };

    const result = vm.runInNewContext(
      `${pac}\nFindProxyForURL("https://resolved.example/path", "resolved.example");`,
      context
    );

    assert.equal(result, "SOCKS5 127.0.0.1:1080");
  });

  it("uses the default proxy for public domains that cannot be resolved locally", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {}
      }
    });
    const context = {
      dnsResolve: () => null
    };

    const result = vm.runInNewContext(
      `${pac}\nFindProxyForURL("https://blocked.example/path", "blocked.example");`,
      context
    );

    assert.equal(result, "SOCKS5 127.0.0.1:1080");
  });

  it("uses the default proxy for unknown resolved public domains", () => {
    const pac = buildPacScript({
      enabled: true,
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {}
      }
    });
    const context = {
      dnsResolve: () => "198.51.100.42"
    };

    const result = vm.runInNewContext(
      `${pac}\nFindProxyForURL("https://unknown.example/path", "unknown.example");`,
      context
    );

    assert.equal(result, "SOCKS5 127.0.0.1:1080");
  });
});
