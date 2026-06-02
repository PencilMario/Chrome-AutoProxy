import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMemoryGeoIpStore, GeoIpCache } from "../src/shared/geoip-cache.js";

describe("GeoIP cache", () => {
  it("normalizes host keys and returns seeded country codes", async () => {
    const store = createMemoryGeoIpStore({
      "Example.COM": "US",
      "  cn.example  ": "CN"
    });
    const cache = new GeoIpCache(store);

    assert.equal(await cache.lookupHostCountry("example.com"), "US");
    assert.equal(await cache.lookupHostCountry("CN.EXAMPLE"), "CN");
  });

  it("caches lookup results locally after a resolver miss", async () => {
    const store = createMemoryGeoIpStore();
    const cache = new GeoIpCache(store, {
      resolver: async (host) => (host === "new.example" ? "JP" : null)
    });

    assert.equal(await cache.lookupHostCountry("new.example"), "JP");
    assert.equal(await store.get("new.example"), "JP");
  });

  it("imports seed records and exposes an export snapshot", async () => {
    const store = createMemoryGeoIpStore();
    const cache = new GeoIpCache(store);

    await cache.importRecords({
      "alpha.example": "US",
      "beta.example": "HK"
    });

    assert.deepEqual(await cache.exportRecords(), {
      "alpha.example": "US",
      "beta.example": "HK"
    });
  });

  it("matches cached CIDR records for IP lookups", async () => {
    const store = createMemoryGeoIpStore({
      "203.0.113.0/24": "US",
      "198.51.100.10": "JP"
    });
    const cache = new GeoIpCache(store);

    assert.equal(await cache.lookupHostCountry("203.0.113.42"), "US");
    assert.equal(await cache.lookupHostCountry("198.51.100.10"), "JP");
    assert.equal(await cache.lookupHostCountry("192.0.2.1"), null);
  });

  it("learns a host country from a connected IP matching cached CIDR data", async () => {
    const store = createMemoryGeoIpStore({
      "8.8.8.0/24": "US"
    });
    const cache = new GeoIpCache(store);

    assert.equal(await cache.learnHostCountryFromIp("example.com", "8.8.8.8"), "US");
    assert.equal(await cache.lookupHostCountry("example.com"), "US");
  });

  it("does not scan GeoIP records for loopback request IPs", async () => {
    let exportCount = 0;
    const store = {
      async get() {
        return null;
      },
      async set() {
        throw new Error("local requests should not be cached");
      },
      async bulkSet() {},
      async exportAll() {
        exportCount += 1;
        return {
          "127.0.0.0/8": "CN"
        };
      }
    };
    const cache = new GeoIpCache(store);

    assert.equal(await cache.learnHostCountryFromIp("127.0.0.1", "127.0.0.1"), null);
    assert.equal(exportCount, 0);
  });

  it("replaces China CIDR records without removing learned host records", async () => {
    const store = createMemoryGeoIpStore({
      "1.0.1.0/24": "CN",
      "example.cn": "CN",
      "global.example": "US"
    });
    const cache = new GeoIpCache(store);

    await cache.replaceChinaCidrRecords({
      "1.0.2.0/23": "CN"
    });

    assert.deepEqual(await cache.exportRecords(), {
      "1.0.2.0/23": "CN",
      "example.cn": "CN",
      "global.example": "US"
    });
  });
});
