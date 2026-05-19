const DEBUG_PREFIX = "[Chrome AutoProxy]";

export function createDebugLogger(options = {}) {
  const enabled = Boolean(options.enabled);
  const output = options.console || console;

  return {
    log(event, details = {}) {
      if (!enabled) return;
      output.log(DEBUG_PREFIX, event, details);
    }
  };
}

export function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

export function elapsedMs(startTime) {
  return Math.round((nowMs() - startTime) * 10) / 10;
}
