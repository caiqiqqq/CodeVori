import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticLogWriter } from "../src/main/diagnosticLogWriter.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the default writer asynchronously creates daily files and preserves accepted order across dates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "diagnostic-writer-"));
  try {
    const writer = new DiagnosticLogWriter({ schedule: false });
    writer.enqueue(join(dir, "logs/2026-10-10.diagnostics.log"), "one\n");
    writer.enqueue(join(dir, "logs/2026-10-11.diagnostics.log"), "two\n");
    writer.enqueue(join(dir, "logs/2026-10-10.diagnostics.log"), "three\n");
    await writer.flush();
    assert.equal(
      await readFile(join(dir, "logs/2026-10-10.diagnostics.log"), "utf8"),
      "one\nthree\n",
    );
    assert.equal(await readFile(join(dir, "logs/2026-10-11.diagnostics.log"), "utf8"), "two\n");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("slow/failing IO is not awaited by enqueue; queue is bounded and recovers in order", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: Array<[string, string]> = [];
  let fail = true;
  const writer = new DiagnosticLogWriter({
    schedule: false,
    maxQueueBytes: 120,
    maxFileBytes: 1000,
    prepare: async () => 0,
    append: async (path, text) => {
      await gate;
      if (fail) throw new Error("disk");
      writes.push([path, text]);
    },
  });
  writer.enqueue("day-one", "first\n");
  const pending = writer.flush();
  for (let i = 0; i < 100; i++) writer.enqueue("day-two", `line-${i}\n`);
  assert.ok(writer.queuedBytes <= 120);
  release();
  await pending;
  fail = false;
  writer.enqueue("day-two", "last\n");
  await writer.flush();
  assert.ok(writes.at(-1)?.[1].endsWith("last\n"));
  assert.ok(writes.at(-1)?.[1].includes("dropped="));
});

test("line/daily file caps include persisted bytes, and a new day can still write", async () => {
  const writes: Array<[string, string]> = [];
  const writer = new DiagnosticLogWriter({
    schedule: false,
    maxFileBytes: 100,
    prepare: async (path) => (path === "full-day" ? 99 : 0),
    append: async (path, line) => {
      writes.push([path, line]);
    },
  });
  writer.enqueue("full-day", "overflow\n");
  writer.enqueue("new-day", "x".repeat(9000));
  writer.enqueue("new-day", "small\n");
  await writer.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[0], "new-day");
  assert.ok(Buffer.byteLength(writes[0]?.[1] ?? "") <= 100);
});
