import assert from "node:assert/strict";
import test from "node:test";
import type { JournalStorePort, RunRecord, RunSettlement } from "@zcode/dynamic-workflow";
import {
  snapshotOf,
  terminalResultField,
  type RunRegistryEntry,
} from "../src/app/dynamic-workflow-run-observation.js";

const runId = "result-owner-run";
const foreignResult = { source: "foreign" };
const record = {
  status: "completed",
  result: foreignResult,
  caps: { maxConcurrency: 4 },
} as RunRecord;
const journal = {
  getRun: () => record,
  listNodes: () => [],
  listEvents: () => [],
} as unknown as JournalStorePort;

function entry(terminal?: RunSettlement): RunRegistryEntry {
  return {
    controller: new AbortController(),
    startedAt: new Date(0),
    cwd: "/fixture",
    scriptText: "export default async () => undefined",
    settlement: Promise.resolve(terminal ?? { status: "completed", artifact: undefined }),
    ...(terminal ? { terminal } : {}),
  };
}

test("a foreign terminal journal row cannot publish the result of a live run", () => {
  const snapshot = snapshotOf(runId, new Map([[runId, entry()]]), journal);
  assert.equal(snapshot?.status, "running");
  assert.equal(Object.hasOwn(snapshot ?? {}, "output"), false);
  assert.deepEqual(terminalResultField("running", entry(), record), {});
});

test("a settled registry entry owns absence of a result", () => {
  const settled = entry({ status: "completed", artifact: undefined });
  const snapshot = snapshotOf(runId, new Map([[runId, settled]]), journal);
  assert.equal(snapshot?.status, "completed");
  assert.equal(Object.hasOwn(snapshot ?? {}, "output"), false);
  assert.deepEqual(terminalResultField("completed", settled, record), {});
});

test("a cold completed row exposes the journal result, including null", () => {
  const snapshot = snapshotOf(runId, new Map(), journal);
  assert.equal(snapshot?.status, "completed");
  assert.deepEqual(snapshot?.output, foreignResult);
  assert.deepEqual(terminalResultField("completed", undefined, { result: null }), { result: null });
  assert.deepEqual(terminalResultField("completed", undefined, record), {
    result: foreignResult,
  });
});
