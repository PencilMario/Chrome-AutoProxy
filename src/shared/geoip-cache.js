export class GeoIpCache {
  constructor(store, options = {}) {
    this.store = store;
    this.resolver = options.resolver || null;
  }

  async lookupHostCountry(host) {
    const key = normalizeGeoIpHost(host);
    if (!key) return null;

    const cached = normalizeCountry(await this.store.get(key));
    if (cached) return cached;

    const cidrCached = await this.lookupCidrCountry(key);
    if (cidrCached) return cidrCached;

    if (!this.resolver) return null;

    const resolved = normalizeCountry(await this.resolver(key));
    if (resolved) {
      await this.store.set(key, resolved);
      return resolved;
    }

    return null;
  }

  async lookupCidrCountry(host) {
    if (!isIpv4(host) || !this.store.exportAll) return null;

    const records = await this.store.exportAll();
    return findCidrCountry(host, records);
  }

  async learnHostCountryFromIp(host, ip) {
    const key = normalizeGeoIpHost(host);
    const normalizedIp = normalizeGeoIpHost(ip);
    if (!key || !isIpv4(normalizedIp) || !this.store.exportAll) return null;
    if (isNonPublicIpv4(normalizedIp)) return null;

    const records = await this.store.exportAll();
    const country = findCidrCountry(normalizedIp, records);
    if (!country) return null;

    await this.store.set(key, country);
    return country;
  }

  async importRecords(records) {
    const normalized = normalizeRecords(records);
    await this.store.bulkSet(normalized);
  }

  async replaceChinaCidrRecords(records) {
    const normalized = Object.fromEntries(
      Object.entries(normalizeRecords(records))
        .filter(([host, country]) => isIpv4Cidr(host) && country === "CN")
    );
    const existing = await this.store.exportAll();
    const obsoleteKeys = Object.entries(existing)
      .filter(([host, country]) => isIpv4Cidr(host) && normalizeCountry(country) === "CN")
      .map(([host]) => host);

    if (obsoleteKeys.length && this.store.deleteMany) {
      await this.store.deleteMany(obsoleteKeys);
    }
    await this.store.bulkSet(normalized);
  }

  async exportRecords() {
    return this.store.exportAll();
  }
}

export function createMemoryGeoIpStore(seed = {}) {
  const records = new Map(Object.entries(normalizeRecords(seed)));

  return {
    async get(host) {
      return records.get(normalizeGeoIpHost(host)) || null;
    },
    async set(host, country) {
      const key = normalizeGeoIpHost(host);
      const code = normalizeCountry(country);
      if (key && code) records.set(key, code);
    },
    async bulkSet(nextRecords) {
      for (const [host, country] of Object.entries(normalizeRecords(nextRecords))) {
        records.set(host, country);
      }
    },
    async deleteMany(hosts) {
      for (const host of hosts) {
        records.delete(normalizeGeoIpHost(host));
      }
    },
    async exportAll() {
      return Object.fromEntries([...records.entries()].sort(([a], [b]) => a.localeCompare(b)));
    }
  };
}

export function createIndexedDbGeoIpStore(options = {}) {
  const dbName = options.dbName || "chrome-autoproxy-geoip";
  const storeName = options.storeName || "hostCountries";

  return {
    async get(host) {
      const db = await openDb(dbName, storeName);
      return requestToPromise(db.transaction(storeName).objectStore(storeName).get(normalizeGeoIpHost(host)));
    },
    async set(host, country) {
      const key = normalizeGeoIpHost(host);
      const code = normalizeCountry(country);
      if (!key || !code) return;
      const db = await openDb(dbName, storeName);
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(code, key);
      await transactionDone(tx);
    },
    async bulkSet(records) {
      const db = await openDb(dbName, storeName);
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const [host, country] of Object.entries(normalizeRecords(records))) {
        store.put(country, host);
      }
      await transactionDone(tx);
    },
    async deleteMany(hosts) {
      const db = await openDb(dbName, storeName);
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const host of hosts) {
        store.delete(normalizeGeoIpHost(host));
      }
      await transactionDone(tx);
    },
    async exportAll() {
      const db = await openDb(dbName, storeName);
      const tx = db.transaction(storeName);
      const store = tx.objectStore(storeName);
      const keys = await requestToPromise(store.getAllKeys());
      const values = await requestToPromise(store.getAll());
      return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    }
  };
}

export function normalizeGeoIpHost(host) {
  return String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function normalizeRecords(records = {}) {
  return Object.fromEntries(
    Object.entries(records)
      .map(([host, country]) => [normalizeGeoIpHost(host), normalizeCountry(country)])
      .filter(([host, country]) => host && country)
  );
}

function normalizeCountry(country) {
  const code = String(country || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function isIpv4(value) {
  const parts = String(value).split(".");
  return parts.length === 4 && parts.every((part) => {
    const number = Number(part);
    return /^\d+$/.test(part) && number >= 0 && number <= 255;
  });
}

function isIpv4Cidr(value) {
  const [range, prefixText] = String(value || "").split("/");
  const prefix = Number(prefixText);
  return isIpv4(range) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

function isNonPublicIpv4(ip) {
  const value = ipv4ToInt(ip);
  return isIpv4InRange(value, "0.0.0.0", "0.255.255.255") ||
    isIpv4InRange(value, "10.0.0.0", "10.255.255.255") ||
    isIpv4InRange(value, "100.64.0.0", "100.127.255.255") ||
    isIpv4InRange(value, "127.0.0.0", "127.255.255.255") ||
    isIpv4InRange(value, "169.254.0.0", "169.254.255.255") ||
    isIpv4InRange(value, "172.16.0.0", "172.31.255.255") ||
    isIpv4InRange(value, "192.0.0.0", "192.0.0.255") ||
    isIpv4InRange(value, "192.0.2.0", "192.0.2.255") ||
    isIpv4InRange(value, "192.168.0.0", "192.168.255.255") ||
    isIpv4InRange(value, "198.18.0.0", "198.19.255.255") ||
    isIpv4InRange(value, "198.51.100.0", "198.51.100.255") ||
    isIpv4InRange(value, "203.0.113.0", "203.0.113.255") ||
    isIpv4InRange(value, "224.0.0.0", "255.255.255.255");
}

function isIpv4InCidr(ip, cidr) {
  const [range, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!isIpv4(range) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

function findCidrCountry(ip, records) {
  for (const [cidr, country] of Object.entries(records || {})) {
    if (cidr.includes("/") && isIpv4InCidr(ip, cidr)) {
      return normalizeCountry(country);
    }
  }

  return null;
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function isIpv4InRange(value, start, end) {
  return value >= ipv4ToInt(start) && value <= ipv4ToInt(end);
}

function openDb(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
