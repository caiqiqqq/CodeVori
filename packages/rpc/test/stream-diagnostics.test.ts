import assert from "node:assert/strict";
import test from "node:test";
import { StreamDiagnostics, type StreamDiagnostic } from "../src/stream-diagnostics.js";

const id = "d12009dd-f88f-47da-b8ef-2237e786a006";

test("stream diagnostic public contract correlates numeric observations and excludes arbitrary data", () => {
  const records: StreamDiagnostic[] = [];
  const writer = new StreamDiagnostics((record) => records.push(record), "acp-host-stream");
  writer.record("received", id, 3, {
    receivedAt: 123,
    chunkChars: 1,
    ...({ text: "token=secret", workspacePath: "/private", messageId: "private-id" } as {}),
  });
  assert.equal(records[0]?.sessionId, id);
  assert.equal(records[0]?.revision, 3);
  assert.deepEqual(records[0]?.facts, { receivedAt: 123, chunkChars: 1 });
  assert.equal(writer.record("received", "/private/token=secret", 4, {}), false);
  assert.equal(writer.record("received", id, NaN, {}), false);
  assert.equal(JSON.stringify(records).includes("secret"), false);
});

test("stream diagnostics are bounded and sink errors cannot escape", () => {
  let now = 0;
  const records: StreamDiagnostic[] = [];
  const writer = new StreamDiagnostics((record) => records.push(record), "renderer-acp-stream", {
    now: () => now,
    wallNow: () => 1000 + now,
  });
  for (let revision = 0; revision < 1000; revision++)
    writer.record("ui-received", id, revision, {});
  assert.equal(records.length, 240);
  now = 60000;
  writer.record("ui-commit", id, 1001, { elapsedMs: 5, commitAt: Infinity });
  assert.equal(records.at(-1)?.suppressed, 760);
  assert.equal(records.at(-1)?.timestamp, 61000);
  assert.deepEqual(records.at(-1)?.facts, { elapsedMs: 5 });
  const failing = new StreamDiagnostics(() => {
    throw new Error("sink");
  }, "acp-host-stream");
  assert.doesNotThrow(() => failing.record("broadcast", id, 1, {}));
});
