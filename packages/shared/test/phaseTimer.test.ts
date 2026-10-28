import assert from "node:assert/strict";
import test from "node:test";
import { PhaseTimer, type PhaseTimingRecord } from "../src/phaseTimer.ts";

test("phase timing correlates retries, progress and failure without double-counting time", () => {
  let now = 0;
  const records: PhaseTimingRecord[] = [];
  const timer = new PhaseTimer(
    { scope: "api.compact", operationId: "operation-1", commandId: "command-1" },
    (record) => records.push(record),
    () => now,
  );
  timer.phase("request");
  now = 100;
  timer.report();
  now = 150;
  timer.phase("prepare");
  now = 170;
  timer.phase("request");
  now = 200;
  timer.setFacts({ attempts: 2, invalid: NaN });
  timer.finish("failed");
  timer.finish("success");
  assert.equal(records.length, 2);
  assert.equal(records[0]?.outcome, "progress");
  assert.deepEqual(records[1], {
    event: "latency.phases",
    scope: "api.compact",
    operationId: "operation-1",
    commandId: "command-1",
    status: "failed",
    outcome: "failed",
    phase: "request",
    durationMs: 200,
    phasesMs: { start: 0, request: 180, prepare: 20 },
    phaseCounts: { start: 1, request: 2, prepare: 1 },
    facts: { attempts: 2 },
  });
});

test("logging failures preserve control flow and phase/fact storage stays bounded", () => {
  const records: PhaseTimingRecord[] = [];
  const timer = new PhaseTimer({ scope: "acp.send" }, (record) => {
    records.push(record);
    throw new Error("sink unavailable");
  });
  for (let i = 0; i < 100; i++) {
    timer.phase(`phase-${i}`);
    timer.setFacts({ [`count-${i}`]: i });
  }
  assert.doesNotThrow(() => timer.finish("failed"));
  assert.ok(Object.keys(records[0]!.phasesMs).length <= 33);
  assert.equal(Object.keys(records[0]!.facts).length, 32);
});
