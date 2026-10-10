import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

const target = { workspacePath: "/fixture/project", taskId: "conversation-one" };
const meta = {
  ...target,
  traceId: "trace-one",
  title: "private title",
  mode: "build" as const,
  createdAt: 1,
  updatedAt: 2,
  provider: "glm" as const,
};

async function fixture(run: (repo: TaskIndexRepo, path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-archive-purge-"));
  const path = join(directory, "tasks.sqlite");
  const repo = new TaskIndexRepo(path);
  try {
    await repo.syncTaskMeta({ meta, archived: true, searchableText: "private transcript" });
    await run(repo, path);
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("purge checks archive at execution and never deletes a restored or foreign identity", async () => {
  await fixture(async (repo) => {
    let calls = 0;
    const purge = async () => {
      calls++;
      return "deleted" as const;
    };
    assert.equal(
      await repo.purgeArchivedTask({ ...target, workspaceIdentity: "remote:other" }, purge),
      null,
    );
    await repo.updateTaskState({ ...target, patch: { archived: false } });
    assert.equal(await repo.purgeArchivedTask(target, purge), null);
    assert.equal(calls, 0);
  });
});

test("pending purge survives restart, refuses restore and retries after uncertain failure", async () => {
  await fixture(async (repo, path) => {
    await assert.rejects(
      repo.purgeArchivedTask(target, async () => {
        throw new Error("connection lost");
      }),
    );
    repo.close();
    assert.equal((await repo.getTaskMeta(target))?.deletionState, "pending");
    await repo.applyAgentPatch({ ...target, patch: { title: "late patch" } });
    assert.equal((await repo.getTaskMeta(target))?.title, meta.title);
    assert.equal(await repo.purgeArchivedTask(target, async () => "busy"), null);
    assert.equal(
      (await repo.getTaskMeta(target))?.deletionState,
      "pending",
      "uncertain prior cleanup cannot be undone by a busy retry",
    );
    await assert.rejects(
      repo.updateTaskState({ ...target, patch: { archived: false } }),
      /deletion/,
    );
    await repo.syncTaskMeta({ meta: { ...meta, title: "late snapshot" } });
    assert.equal((await repo.getTaskMeta(target))?.deletionState, "pending");
    assert.ok(await repo.purgeArchivedTask(target, async () => "deleted"));
    // 根因：deleted tombstone 不能继续留正文，也不能被迟到 snapshot 补回内容。
    await repo.syncTaskMeta({ meta, searchableText: "late private transcript" });
    const db = new DatabaseSync(path);
    try {
      const row = db
        .prepare("SELECT title,searchable_text,meta_json,deleted FROM tasks WHERE task_id=?")
        .get(target.taskId)!;
      assert.equal(row.deleted, 1);
      assert.equal(row.title, "");
      assert.equal(row.searchable_text, "");
      assert.ok(!String(row.meta_json).includes("private"));
    } finally {
      db.close();
    }
    assert.deepEqual(await repo.listDeletedTaskIds(target), [target.taskId]);
  });
});

test("busy rejection leaves archive recoverable and another process cannot restore pending", async () => {
  await fixture(async (repo, path) => {
    assert.equal(await repo.purgeArchivedTask(target, async () => "busy"), null);
    assert.equal((await repo.getTaskMeta(target))?.deletionState, undefined);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let admitted!: () => void;
    const ready = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const operation = repo.purgeArchivedTask(target, async () => {
      admitted();
      await waiting;
      return "deleted";
    });
    await ready;
    const other = new TaskIndexRepo(path);
    try {
      await assert.rejects(
        other.updateTaskState({ ...target, patch: { archived: false } }),
        /deletion/,
      );
    } finally {
      other.close();
      release();
    }
    assert.ok(await operation);
  });
});
