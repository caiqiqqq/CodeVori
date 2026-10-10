import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupExpiredLogFiles } from "../src/main/logRetention.js";

test("diagnostics share the existing fourteen-day policy without deleting other files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "diagnostic-retention-"));
  try {
    const names = [
      "2026-09-26.log",
      "2026-09-26.diagnostics.log",
      "2026-09-27.diagnostics.log",
      "2026-10-10.diagnostics.log",
      "other.log",
    ];
    await Promise.all(names.map((name) => writeFile(join(dir, name), "")));
    const result = cleanupExpiredLogFiles(dir, { now: new Date(2026, 9, 10) });
    assert.deepEqual(result.deletedFiles.sort(), names.slice(0, 2).sort());
    assert.deepEqual((await readdir(dir)).sort(), names.slice(2).sort());
  } finally {
    await rm(dir, { recursive: true });
  }
});
