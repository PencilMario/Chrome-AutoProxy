import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDebugLogger } from "../src/shared/debug-logger.js";

describe("debug logger", () => {
  it("does not write console output when disabled", () => {
    const entries = [];
    const logger = createDebugLogger({
      enabled: false,
      console: {
        log: (...args) => entries.push(args)
      }
    });

    logger.log("event", { value: 1 });

    assert.deepEqual(entries, []);
  });

  it("writes prefixed console output when enabled", () => {
    const entries = [];
    const logger = createDebugLogger({
      enabled: true,
      console: {
        log: (...args) => entries.push(args)
      }
    });

    logger.log("event", { value: 1 });

    assert.deepEqual(entries, [["[Chrome AutoProxy]", "event", { value: 1 }]]);
  });
});
