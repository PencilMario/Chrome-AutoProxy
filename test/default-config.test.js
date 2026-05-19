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
});
