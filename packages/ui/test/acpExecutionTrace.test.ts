import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, type AcpDiagnosticEvent } from "@zcode/shared";
import {
  buildAcpExecutionTrace,
  filterAcpTraceTurns,
  mergeAcpTraceEvents,
} from "../src/lib/acpExecutionTrace.js";

const session = acpSessionSchema.parse({
  id: "host-id",
  acpSessionId: "native",
  agent: "codex",
  workspacePath: "/fixture",
  title: "Trace",
  status: "idle",
  revision: 1,
  pendingPermission: null,
  error: null,
  usageTurns: [{ commandId: "one", inputTokens: 7, outputTokens: 3, totalTokens: 10 }],
  entries: [
    { id: "user:one", kind: "user", text: "First", createdAt: 10, traceError: "Old failure" },
    {
      id: "tool:one:same",
      kind: "tool",
      title: "Execute",
      status: "failed",
      input: "npm check",
      output: "failed tests",
    },
    { id: "user:two", kind: "user", text: "Second", createdAt: 100 },
    { id: "tool:two:same", kind: "tool", title: "Execute", status: "completed", output: "success" },
    { id: "assistant:two", kind: "assistant", text: "Done" },
  ],
});
const events: AcpDiagnosticEvent[] = [
  { timestamp: 10, kind: "prompt-accepted", turnIndex: 0 },
  { timestamp: 20, kind: "tool-update", turnIndex: 0, entryIndex: 1, status: "in_progress" },
  { timestamp: 30, kind: "tool-update", turnIndex: 0, entryIndex: 1, status: "failed" },
  { timestamp: 40, kind: "turn-interrupted", turnIndex: 0 },
  { timestamp: 100, kind: "prompt-accepted", turnIndex: 2 },
  { timestamp: 110, kind: "tool-update", turnIndex: 2, entryIndex: 3, status: "completed" },
  { timestamp: 120, kind: "turn-completed", turnIndex: 2, stopReason: "end_turn" },
  { timestamp: 35, kind: "permission-resolved" },
];

test("turn projections associate exact rows and never invent a missing tool start", () => {
  const trace = buildAcpExecutionTrace(session, events);
  assert.deepEqual(
    trace.turns.map((turn) => turn.state),
    ["failed", "completed"],
  );
  assert.deepEqual(
    trace.turns.map((turn) => turn.durationMs),
    [30, 20],
  );
  assert.deepEqual(
    trace.turns.map((turn) => turn.tools[0]?.durationMs),
    [10, null],
  );
  assert.equal(trace.turns[0]?.error, "Old failure");
  assert.equal(trace.turns[0]?.usage?.totalTokens, 10);
  assert.equal(trace.turns[1]?.usage, undefined);
  assert.deepEqual(trace.uncorrelatedEvents, [events.at(-1)]);
  assert.equal(filterAcpTraceTurns(trace.turns, "npm", false).length, 1);
  assert.equal(filterAcpTraceTurns(trace.turns, "done", false)[0]?.index, 2);
  assert.equal(filterAcpTraceTurns(trace.turns, "", true)[0]?.index, 1);
});

test("legacy events remain uncorrelated and report no inferred completed state", () => {
  const trace = buildAcpExecutionTrace(session, [{ timestamp: 110, kind: "turn-completed" }]);
  assert.equal(trace.turns[1]?.state, "unknown");
  assert.equal(trace.turns[1]?.durationMs, null);
  assert.equal(trace.uncorrelatedEvents.length, 1);
});

test("snapshot and live event merging deduplicates IDs while retaining simultaneous distinct facts", () => {
  const one = { timestamp: 1, kind: "tool-update", eventId: crypto.randomUUID() } as const;
  const two = { ...one, eventId: crypto.randomUUID() };
  assert.equal(mergeAcpTraceEvents([one, two], [one]).length, 2);
  const legacy = { timestamp: 1, kind: "tool-update", status: "completed" } as const;
  assert.equal(mergeAcpTraceEvents([legacy, legacy], [legacy]).length, 2);
  assert.equal(
    mergeAcpTraceEvents(
      [],
      Array.from({ length: 600 }, (_, index) => ({
        ...one,
        timestamp: index,
        eventId: crypto.randomUUID(),
      })),
    ).length,
    500,
  );
});
