import assert from "node:assert/strict";
import test from "node:test";
import { createWorktreeRemovalTiming } from "../src/logger/worktreeRemovalTiming.js";
import type { ServiceLogger } from "../src/logger/serviceLogger.js";

test("removal diagnostics record failed phases without leaking paths and emit once", async () => {
  const events: unknown[][] = [];
  const logger: ServiceLogger = {
    debug() {},
    info: (...args) => events.push(args),
    warn() {},
    error() {},
  };
  const timing = createWorktreeRemovalTiming("git", "/private/user/project", logger);
  assert.equal(await timing.run("registration", async () => 42), 42);
  const error = new Error("private command output");
  await assert.rejects(
    timing.run("remove", async () => {
      throw error;
    }),
    (e) => e === error,
  );
  timing.finish("command-failed");
  timing.finish("success");
  assert.equal(events.length, 1);
  const summary = events[0]?.[2] as Record<string, unknown>;
  assert.equal(summary.layer, "git");
  assert.equal(summary.lastPhase, "remove");
  assert.equal(summary.status, "command-failed");
  assert.match(summary.targetKey as string, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(summary.phasesMs as object), ["registration", "remove"]);
  assert.equal(JSON.stringify(events).includes("private"), false);
});

test("synchronous archive measurement stays synchronous and logger failure is harmless", () => {
  const logger: ServiceLogger = {
    debug() {},
    info() {
      throw new Error("sink unavailable");
    },
    warn() {},
    error() {},
  };
  const timing = createWorktreeRemovalTiming("archive", "/project", logger);
  const result = { archived: true };
  assert.equal(
    timing.measure("archive", () => result),
    result,
  );
  assert.doesNotThrow(() => timing.finish("success"));
});
