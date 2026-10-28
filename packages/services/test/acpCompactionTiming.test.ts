import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, type PhaseTimingRecord } from "@zcode/shared";
import { applyAcpCompaction, type AcpCompactionUpdate } from "../src/acp/acpCompaction.js";
import { AcpCompactionTiming } from "../src/acp/acpCompactionTiming.js";

test("external compact timing uses matching IDs, ignores late/replayed terminal facts and bounds cancellation", () => {
  let now = 0;
  const records: PhaseTimingRecord[] = [];
  const observer = new AcpCompactionTiming(
    (record) => records.push(record),
    () => now,
  );
  const session = acpSessionSchema.parse({
    id: "session-1",
    agent: "codex",
    acpSessionId: "native-1",
    status: "running",
    revision: 1,
    pendingPermission: null,
    error: null,
    workspacePath: "/fixture",
    title: "fixture",
    entries: [],
  });
  const update = (value: AcpCompactionUpdate) => {
    applyAcpCompaction(session, "command-1", value, 0);
    observer.update(session, "command-1", value);
  };
  update({ kind: "compaction", id: "compact-1", status: "running", tokensBefore: 1000 });
  now = 90000;
  update({
    kind: "compaction",
    id: "compact-1",
    status: "success",
    tokensAfter: 200,
    summary: "PRIVATE SUMMARY MUST NOT BE LOGGED",
  });
  update({ kind: "compaction", id: "compact-1", status: "running" });
  update({ kind: "compaction", id: "compact-1", status: "success" });
  assert.equal(records.length, 2);
  assert.equal(records[1]?.durationMs, 90000);
  assert.equal(records[1]?.phasesMs.external_agent, 90000);
  assert.equal(records[1]?.operationId, "compact-1");
  assert.equal(records[1]?.commandId, "command-1");
  assert.equal(records[1]?.facts.tokensAfter, 200);
  assert.ok(!JSON.stringify(records).includes("PRIVATE"));
  update({ kind: "compaction", id: "compact-2", status: "running" });
  now += 123;
  observer.removeSession(session.id);
  observer.dispose();
  assert.equal(records.at(-1)?.outcome, "interrupted");
  assert.equal(records.at(-1)?.durationMs, 123);
  assert.equal(records.length, 4);
});
