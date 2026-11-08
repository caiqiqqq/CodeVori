import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { createFeedbackDiagnosticArchive } from "../src/feedback/feedbackLogArchive.js";

test("diagnostic archive uses the product filename", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codevori-feedback-"));
  try {
    const archive = await createFeedbackDiagnosticArchive({
      sources: [],
      outputRootDir: directory,
    });
    assert.equal(basename(archive.path), "codevori-diagnostic-logs.zip");
    assert.ok((await stat(archive.path)).size > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
