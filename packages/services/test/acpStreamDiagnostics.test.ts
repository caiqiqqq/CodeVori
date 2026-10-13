import assert from "node:assert/strict";
import test from "node:test";
import { AcpStreamDiagnostics } from "../src/acp/acpStreamDiagnostics.js";
import type { StreamDiagnostic } from "@zcode/rpc";

const id = "d12009dd-f88f-47da-b8ef-2237e786a006";
const receipt = (revision: number, entryIndex = 1) => ({
  receivedRevision: revision,
  receivedAt: 10000 + revision,
  kind: "text" as const,
  chunkChars: 1,
  entryIndex,
  entryCount: entryIndex + 1,
});

test("first, gap, coalesced snapshots and terminal correlate without logging each token", () => {
  let now = 0;
  const records: StreamDiagnostic[] = [];
  const diagnostics = new AcpStreamDiagnostics(
    (record) => records.push(record),
    () => now,
  );
  for (let revision = 1; revision <= 512; revision++) diagnostics.received(id, receipt(revision));
  assert.equal(records.length, 1);
  assert.equal(
    diagnostics.capture(id, 1),
    undefined,
    "future receipt cannot describe an old snapshot",
  );
  const captured = diagnostics.capture(id, 512)!;
  const trace = diagnostics.broadcast(id, 512, captured, 11000, 12000, false);
  assert.equal(trace?.receivedRevision, 512);
  assert.equal(trace?.broadcastAt, 12000);
  assert.equal(records.at(-1)?.revision, 512);
  assert.equal(diagnostics.broadcast(id, 512, captured, 11000, 12001, false), undefined);
  now = 1500;
  diagnostics.received(id, receipt(513));
  assert.equal(records.at(-1)?.facts.gapMs, 1500);
  const latest = diagnostics.capture(id, 514)!;
  assert.equal(diagnostics.broadcast(id, 514, latest, 12000, 13000, false)?.receivedRevision, 513);
  assert.ok(diagnostics.broadcast(id, 515, latest, 13000, 13001, true));
  assert.equal(diagnostics.capture(id, 516), undefined, "terminal clears diagnostic metadata");
});

test("bounded sessions, stale terminal, removal and throwing sink preserve observation safety", () => {
  const diagnostics = new AcpStreamDiagnostics(() => {
    throw new Error("sink");
  });
  for (let index = 0; index < 80; index++) {
    const key = `d12009dd-f88f-47da-b8ef-${String(index).padStart(12, "0")}`;
    diagnostics.received(key, receipt(1));
  }
  assert.equal(diagnostics.trackedCount, 64);
  assert.equal(diagnostics.capture("d12009dd-f88f-47da-b8ef-000000000000", 1), undefined);
  diagnostics.received(id, receipt(2));
  const old = diagnostics.capture(id, 2)!;
  diagnostics.received(id, receipt(3, 2));
  assert.doesNotThrow(() => diagnostics.broadcast(id, 2, old, 11000, 12000, true));
  assert.equal(
    diagnostics.capture(id, 3)?.receivedRevision,
    3,
    "old terminal cannot discard new receipt",
  );
  diagnostics.remove(id);
  assert.equal(diagnostics.capture(id, 3), undefined);
  diagnostics.clear();
  assert.equal(diagnostics.trackedCount, 0);
});
