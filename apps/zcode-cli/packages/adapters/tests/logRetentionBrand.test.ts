import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createNodeLoggerFactory } from "../src/logging/index.js";
import { cleanupLogRetention } from "../src/logging/retention.js";

test("CLI logger writes into a CodeVori named file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codevori-logger-"));
  try {
    createNodeLoggerFactory({ logDir: directory }).createLogger("test").info("path check");
    assert.match((await readdir(directory))[0] ?? "", /^codevori-\d{4}-\d{2}-\d{2}\.jsonl$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("log retention cleans current and migrated legacy filenames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codevori-log-retention-"));
  try {
    await Promise.all([
      writeFile(join(directory, "codevori-2026-01-01.jsonl"), ""),
      writeFile(join(directory, "zcode-2026-01-01.jsonl"), ""),
      writeFile(join(directory, "codevori-2026-11-08.jsonl"), ""),
    ]);
    const result = await cleanupLogRetention({ logDir: directory, now: new Date(2026, 10, 8) });
    assert.deepEqual(result.deletedFiles.sort(), ["codevori-2026-01-01.jsonl", "zcode-2026-01-01.jsonl"]);
    assert.deepEqual(await readdir(directory), ["codevori-2026-11-08.jsonl"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
