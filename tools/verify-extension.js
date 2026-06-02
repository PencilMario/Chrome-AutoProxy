import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert.equal(manifest.manifest_version, 3, "manifest must use MV3");
assert.equal(manifest.background.type, "module", "background worker must be an ES module");
assert.ok(manifest.permissions.includes("proxy"), "proxy permission is required");
assert.ok(manifest.permissions.includes("storage"), "storage permission is required");
assert.ok(manifest.permissions.includes("webRequestAuthProvider"), "proxy auth provider permission is required");
assert.ok(manifest.permissions.includes("tabs"), "tabs permission is required for current tab URL routing");

await assertFile(manifest.background.service_worker);
await assertFile(manifest.action.default_popup);
await assertFile(manifest.options_page);

for (const resourceGroup of manifest.web_accessible_resources || []) {
  for (const resource of resourceGroup.resources || []) {
    await assertFile(resource);
  }
}

if (manifest.icons) {
  for (const iconPath of Object.values(manifest.icons)) {
    await assertFile(iconPath);
  }
}

await verifyHtmlReferences(manifest.action.default_popup);
await verifyHtmlReferences(manifest.options_page);
await verifyModuleSyntax("src/shared/proxy-engine.js");
await verifyModuleSyntax("src/shared/geoip-cache.js");
await verifyModuleSyntax("src/shared/default-config.js");
await verifyModuleSyntax("src/shared/debug-logger.js");
await verifyModuleSyntax("src/shared/proxy-auth.js");
await verifyModuleSyntax("src/shared/popup-state.js");
await verifyModuleSyntax("src/shared/proxy-test.js");
await verifyModuleSyntax("src/shared/geoip-cn-source.js");
await verifyScriptSyntax("src/options/options.js");
await verifyScriptSyntax("src/popup/popup.js");
await verifyScriptSyntax("tools/update-geoip-seed.js");

console.log("Extension verification passed");

async function verifyHtmlReferences(relativePath) {
  const html = await readFile(path.join(root, relativePath), "utf8");
  const baseDir = path.dirname(relativePath);
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    await assertFile(path.join(baseDir, ref));
  }
}

async function assertFile(relativePath) {
  await access(path.join(root, relativePath));
}

async function verifyModuleSyntax(relativePath) {
  await import(pathToFileURL(path.join(root, relativePath)).href);
}

async function verifyScriptSyntax(relativePath) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
