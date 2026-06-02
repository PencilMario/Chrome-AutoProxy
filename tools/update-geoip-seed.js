import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fetchGeoIpCnRecords,
  GEOIP_CN_SOURCE_URLS
} from "../src/shared/geoip-cn-source.js";

const outputPath = path.resolve("data", "geoip-seed.json");
const sourceUrls = process.argv.slice(2);

const records = await fetchGeoIpCnRecords(fetch, sourceUrls.length ? sourceUrls : GEOIP_CN_SOURCE_URLS);
await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

console.log(`Wrote ${Object.keys(records).length} CN CIDR records to ${outputPath}`);
