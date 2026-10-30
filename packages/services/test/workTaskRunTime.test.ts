import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkTask } from "@zcode/shared";
import { finishWorkTaskRun, interruptWorkTaskRun } from "../src/session/workTaskRunState.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("claim persists a stable run start; progress preserves it and retry replaces it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-task-run-start-"));
  const path = join(directory, "tasks.sqlite");
  let repo = new WorkTaskRepo(path);
  try {
    await repo.ready();
    const task = repo.create({
      workspacePath: "/fixture",
      title: "Run",
      prompt: "Run",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "test", modelId: "test" },
      },
    });
    repo.enqueue(task, task.id);
    const run = repo.claimNext("owner", 1000, 60000, 1)!;
    assert.equal(run.startedAt, 1000);
    repo.updateRun(run, "owner", { status: "running" });
    repo.close();
    repo = new WorkTaskRepo(path);
    await repo.ready();
    assert.equal(repo.list(task)[0].startedAt, 1000);
    repo.finish(run, "owner", "Synthetic failure");
    repo.enqueue(task, task.id);
    assert.equal(repo.list(task)[0].startedAt, undefined);
    assert.equal(repo.claimNext("owner", 2000, 60000, 1)!.startedAt, 2000);
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("run settlement records result time and late settlement preserves existing terminal time", () => {
  const running = { status: "running", updatedAt: 50, runSeq: 1 } as WorkTask;
  const result = finishWorkTaskRun(running, running, { now: 100, leaseExpired: false }).task;
  assert.equal(result.status, "review");
  assert.equal(result.finishedAt, 100);
  const late = finishWorkTaskRun({ ...result, updatedAt: 500 }, running, {
    now: 900,
    leaseExpired: false,
  }).task;
  assert.equal(late.finishedAt, 100);
  assert.equal(interruptWorkTaskRun(running, 200, false).finishedAt, 200);
  assert.equal(interruptWorkTaskRun(result, 900, false).finishedAt, 100);
  const failure = finishWorkTaskRun(running, running, { now: 300, leaseExpired: true }).task;
  assert.equal(failure.status, "failed");
  assert.equal(failure.finishedAt, 300);
});
