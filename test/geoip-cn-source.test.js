import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGeoIpCnRecords,
  fetchGeoIpCnRecords,
  shouldRefreshGeoIpCn
} from "../src/shared/geoip-cn-source.js";
import { buildPacScript, decideProxyRoute } from "../src/shared/proxy-engine.js";

const proxies = [
  { id: "hk", name: "Hong Kong", type: "SOCKS5", host: "127.0.0.1", port: 1080 }
];

describe("GeoIP2-CN source", () => {
  it("builds sorted CN-only CIDR records from Hackl0us text data", () => {
    const records = buildGeoIpCnRecords(`
# comment
1.0.2.0/23

invalid
999.1.1.0/24
2.0.0.0/33
1.0.1.0/24 # inline comment
1.0.2.0/23
`);

    assert.deepEqual(records, {
      "1.0.1.0/24": "CN",
      "1.0.2.0/23": "CN"
    });
  });

  it("refreshes when metadata is missing, stale, or manually forced", () => {
    const now = Date.parse("2026-06-02T00:00:00.000Z");

    assert.equal(shouldRefreshGeoIpCn({}, now), true);
    assert.equal(shouldRefreshGeoIpCn({ cnLastUpdatedAt: "2026-06-01T01:00:00.000Z" }, now), false);
    assert.equal(shouldRefreshGeoIpCn({ cnLastUpdatedAt: "2026-05-30T23:00:00.000Z" }, now), true);
    assert.equal(shouldRefreshGeoIpCn({ cnLastUpdatedAt: "2026-06-01T01:00:00.000Z" }, now, { force: true }), true);
  });

  it("falls back to the next source URL when the first download fails", async () => {
    const requestedUrls = [];
    const records = await fetchGeoIpCnRecords(async (url) => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) throw new Error("network reset");
      return {
        ok: true,
        async text() {
          return "1.0.1.0/24\n";
        }
      };
    }, ["https://raw.example/cn.txt", "https://cdn.example/cn.txt"]);

    assert.deepEqual(requestedUrls, ["https://raw.example/cn.txt", "https://cdn.example/cn.txt"]);
    assert.deepEqual(records, { "1.0.1.0/24": "CN" });
  });

  it("reports all source failures when GeoIP2-CN cannot be downloaded", async () => {
    await assert.rejects(
      () => fetchGeoIpCnRecords(async (url) => ({
        ok: false,
        status: url.includes("raw") ? 502 : 404
      }), ["https://raw.example/cn.txt", "https://cdn.example/cn.txt"]),
      /raw\.example.*HTTP 502.*cdn\.example.*HTTP 404/
    );
  });

  it("treats GeoIP2-CN as China-only data instead of a full country database", () => {
    const config = {
      enabled: true,
      rules: { direct: [], proxy: [] },
      proxies,
      activeProxyId: "hk",
      geoip: {
        mode: "proxyNonLocal",
        localCountries: ["CN"],
        hostCountries: {
          "1.0.1.0/24": "CN"
        }
      }
    };

    assert.deepEqual(decideProxyRoute({ ...config, host: "cn.example", geoip: { ...config.geoip, hostCountry: "CN" } }), {
      action: "direct",
      reason: "geoip-local",
      country: "CN"
    });

    const unknownRoute = decideProxyRoute({ ...config, host: "unknown.example" });
    assert.equal(unknownRoute.action, "proxy");
    assert.equal(unknownRoute.reason, "geoip-unknown");

    const pac = buildPacScript(config);
    const cnResult = runPac(pac, "https://cn.example/", "cn.example", "1.0.1.42");
    const unknownResult = runPac(pac, "https://unknown.example/", "unknown.example", "8.8.8.8");

    assert.equal(cnResult, "DIRECT");
    assert.equal(unknownResult, "SOCKS5 127.0.0.1:1080");
  });
});

function runPac(pac, url, host, resolvedIp) {
  return Function("dnsResolve", `${pac}\nreturn FindProxyForURL(${JSON.stringify(url)}, ${JSON.stringify(host)});`)(
    () => resolvedIp
  );
}
