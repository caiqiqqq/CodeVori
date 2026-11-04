import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import {
  createNodeReplShutdown,
  installNodeReplShutdownTriggers,
} from "../src/process-lifecycle.js";

test("hanging shutdown has one referenced deadline which repeated triggers cannot extend", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let exits = 0;
  let cleanups = 0;
  const shutdown = createNodeReplShutdown({
    close: () => {
      cleanups += 1;
      return new Promise<void>(() => {});
    },
    exit: () => {
      exits += 1;
    },
  });
  const parent = new EventEmitter();
  const stdin = new EventEmitter();
  installNodeReplShutdownTriggers({ process: parent, stdin, shutdown });
  stdin.emit("end");
  t.mock.timers.tick(1000);
  parent.emit("SIGTERM");
  stdin.emit("close");
  shutdown();
  assert.equal(cleanups, 1);
  assert.equal(exits, 0);
  t.mock.timers.tick(500);
  assert.equal(exits, 1);
});

for (const mode of ["success", "rejection", "throw"] as const) {
  test(`shutdown ${mode} exits once and cancels the deadline`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let exits = 0;
    const shutdown = createNodeReplShutdown({
      close: () => {
        if (mode === "throw") throw new Error("fixture");
        return mode === "success" ? Promise.resolve() : Promise.reject(new Error("fixture"));
      },
      exit: () => {
        exits += 1;
      },
    });
    shutdown();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(exits, 1);
    shutdown();
    t.mock.timers.tick(1500);
    assert.equal(exits, 1);
  });
}

test("deadline is armed before invoking cleanup", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let exits = 0;
  createNodeReplShutdown({
    close: () => {
      t.mock.timers.tick(1500);
      assert.equal(exits, 1);
      return new Promise<void>(() => {});
    },
    exit: () => {
      exits += 1;
    },
  })();
});

test("real shutdown deadline keeps a hanging close alive until forced exit", async () => {
  const moduleUrl = new URL("../src/process-lifecycle.ts", import.meta.url).href;
  const startedAt = Date.now();
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { createNodeReplShutdown } from ${JSON.stringify(moduleUrl)};
    createNodeReplShutdown({ close: () => new Promise(() => {}), exit: () => process.exit(0) })();
  `,
    ],
    { timeout: 10_000 },
  );
  assert.ok(Date.now() - startedAt >= 1400, "deadline must stay referenced while close hangs");
});
