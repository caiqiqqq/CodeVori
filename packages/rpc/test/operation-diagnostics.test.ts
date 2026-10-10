import assert from "node:assert/strict";
import test from "node:test";
import { OperationDiagnostics, summarizeDiagnosticError } from "../src/operation-diagnostics.js";

test("slow/pending stages correlate, while fast results and original errors are preserved", async () => {
  let now = 0;
  const records: unknown[] = [];
  const diagnostics = new OperationDiagnostics((record) => records.push(record), {
    scope: "test",
    now: () => now,
    wallNow: () => 10000 + now,
    schedule: false,
  });
  const value = {};
  assert.equal(await diagnostics.run("read", async () => value), value);
  assert.equal(records.length, 0);
  const span = diagnostics.start("load");
  now = 200;
  span.phase("handshake");
  now = 5200;
  diagnostics.sample();
  diagnostics.sample();
  now = 5300;
  span.finish("success");
  span.finish("success");
  assert.equal(records.length, 2);
  const [pending, completed] = records as Array<Record<string, unknown>>;
  assert.equal(pending?.status, "pending");
  assert.equal(completed?.id, pending?.id);
  assert.equal(completed?.phase, "handshake");
  assert.equal(completed?.durationMs, 5300);
  const failure = new Error("token=secret /private/workspace");
  await assert.rejects(
    diagnostics.run("load", async () => {
      throw failure;
    }),
    (e) => e === failure,
  );
  assert.equal(JSON.stringify(records).includes("secret"), false);
  diagnostics.dispose();
});

test("throwing sink, tracking/rate caps, and expired slots never change operation results", async () => {
  let now = 0;
  let writes = 0;
  const diagnostics = new OperationDiagnostics(
    () => {
      writes++;
      throw new Error("disk");
    },
    {
      scope: "test",
      now: () => now,
      schedule: false,
    },
  );
  const spans = Array.from({ length: 100 }, () => diagnostics.start("read"));
  assert.equal(diagnostics.activeCount, 64);
  now = 6000;
  assert.doesNotThrow(() => diagnostics.sample());
  assert.equal(writes, 20);
  now = 300001;
  diagnostics.sample();
  assert.equal(diagnostics.activeCount, 0);
  spans.forEach((span) => span.finish("success"));
  assert.equal(await diagnostics.run("read", async () => 42), 42);
  diagnostics.dispose();
  assert.equal(await diagnostics.run("read", async () => 7), 7);
});

test("error summaries contain a fixed cause and line/column, never arbitrary messages or paths", () => {
  const error = new Error("Maximum update depth exceeded token=secret https://private.example");
  error.stack = "Error: secret\n    at render (/Users/private/app.js:123:456)";
  const summary = summarizeDiagnosticError(error);
  assert.equal(summary.cause, "maximum-update-depth");
  assert.equal(summary.line, 123);
  assert.equal(summary.column, 456);
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.equal(summarizeDiagnosticError("secret").cause, "unknown");
});
