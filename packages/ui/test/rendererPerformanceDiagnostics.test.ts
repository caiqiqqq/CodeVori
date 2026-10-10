import assert from "node:assert/strict";
import test from "node:test";
import {
  startRendererPerformanceDiagnostics,
  reportRendererException,
} from "../src/lib/rendererPerformanceDiagnostics.js";

test("production exceptions still reach the lifecycle bridge without private message or stack", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousEnv = process.env.NODE_ENV;
  const lines: unknown[][] = [];
  try {
    process.env.NODE_ENV = "production";
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { zcode: { log: (_level: string, args: unknown[]) => lines.push(args) } },
    });
    reportRendererException(
      "react-root",
      new Error("Maximum update depth exceeded token=private-fixture"),
    );
    assert.equal(lines.length, 1);
    const diagnostic = lines[0]?.[1] as { operation: string } | undefined;
    assert.ok(diagnostic);
    assert.equal(diagnostic.operation, "renderer.react-root");
    assert.equal(JSON.stringify(lines).includes("private-fixture"), false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test("visible lag and long tasks are aggregated; background throttling is excluded; stop cleans up", () => {
  let now = 0;
  let visible = true;
  let tick!: () => void;
  let longTask!: (ms: number) => void;
  let resets!: () => void;
  let stopped = 0;
  const records: unknown[] = [];
  const handle = startRendererPerformanceDiagnostics({
    now: () => now,
    visible: () => visible,
    schedule: (callback) => {
      tick = callback;
      return () => {
        stopped++;
      };
    },
    observe: (callback) => {
      longTask = callback;
      return () => {
        stopped++;
      };
    },
    listenVisibility: (callback) => {
      resets = callback;
      return () => {
        stopped++;
      };
    },
    write: (record) => records.push(record),
  });
  longTask(300);
  now = 1400;
  tick();
  now = 10000;
  tick();
  assert.equal(records.length, 1);
  const facts = (records[0] as { facts: Record<string, number> }).facts;
  assert.equal(facts.longTaskCount, 1);
  assert.equal(facts.longTaskMaxMs, 300);
  assert.ok(facts.loopDelayMaxMs! >= 400);
  visible = false;
  resets();
  now = 60000;
  tick();
  longTask(9000);
  visible = true;
  resets();
  now = 61000;
  tick();
  assert.equal(records.length, 1);
  handle.stop();
  handle.stop();
  assert.equal(stopped, 3);
});

test("observer and sink failures do not escape or prevent event-loop sampling", () => {
  let now = 0;
  let tick!: () => void;
  const handle = startRendererPerformanceDiagnostics({
    now: () => now,
    visible: () => true,
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
    observe: () => {
      throw new Error("unsupported");
    },
    listenVisibility: () => () => {},
    write: () => {
      throw new Error("bridge unavailable");
    },
  });
  now = 10000;
  assert.doesNotThrow(tick);
  handle.stop();
});
