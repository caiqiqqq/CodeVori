import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { createSettingService } from "../src/setting/settingService.js";
import { appSettingsSchema, appSettingsPatchSchema, type WorkTask } from "@zcode/shared";

const draft = {
  workspacePath: "/project",
  title: "Task",
  prompt: "Implement",
  execution: {
    kind: "api" as const,
    mode: "build" as const,
    modelSelection: { providerId: "p", modelId: "m" },
  },
};
async function eventually(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("concurrency state did not settle");
}

test("global claims share slots across projects and windows; stopping retains its slot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-task-concurrency-"));
  const a = new WorkTaskRepo(join(directory, "tasks.sqlite"));
  const b = new WorkTaskRepo(join(directory, "tasks.sqlite"));
  try {
    await Promise.all([a.ready(), b.ready()]);
    const tasks = Array.from({ length: 8 }, (_, index) =>
      a.create({ ...draft, workspacePath: `/project-${index % 2}` }),
    );
    for (const task of tasks) a.enqueue(task, task.id);
    const claim = (repo: WorkTaskRepo, owner: string, limit = 4) =>
      repo.claimNext(owner, Date.now(), 60_000, limit);
    const running = tasks.slice(0, 4).map((task, index) => {
      const next = claim(index % 2 ? a : b, `window-${index}`)!;
      assert.equal(next.id, task.id);
      return next;
    });
    assert.equal(claim(a, "extra"), null);
    a.updateRun(running[0], "window-0", { status: "awaiting_input" });
    assert.equal(claim(b, "extra"), null, "waiting for input still occupies a slot");
    a.cancel(running[0], running[0].id);
    assert.equal(claim(b, "extra"), null, "cancel acceptance is not actual stop completion");
    a.finish(running[0], "window-0", "work-task.canceled");
    assert.equal(claim(b, "next")?.id, tasks[4].id);
    assert.equal(claim(a, "extra"), null);
    assert.equal(claim(a, "reduced", 2), null, "reducing limit does not evict existing owners");
    a.finish(running[1], "window-1", "failure");
    a.finish(running[2], "window-2");
    assert.equal(claim(b, "reduced", 2), null);
    a.finish(running[3], "window-3");
    assert.equal(claim(b, "reduced", 2)?.id, tasks[5].id);
    assert.equal(claim(a, "extra", 2), null);
    for (const invalid of [0, -1, 1.5, NaN, Infinity])
      assert.throws(() => claim(a, "bad", invalid));
  } finally {
    a.close();
    b.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("scheduler reads persisted settings, fills released slots and applies changed limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-task-scheduler-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = directory;
  const settings = createSettingService();
  const repo = new WorkTaskRepo(join(directory, "tasks.sqlite"));
  const started: string[] = [];
  const releases = new Map<string, (failure?: string) => void>();
  const service = new WorkTaskService({
    repo,
    pollIntervalMs: 10,
    getConcurrency: async () => (await settings.get()).workTaskConcurrency ?? 4,
    execute: async (task, context) => {
      await context.update({ status: "running" });
      started.push(task.id);
      await new Promise<void>((resolve, reject) => {
        releases.set(task.id, (failure) => (failure ? reject(new Error(failure)) : resolve()));
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
  try {
    assert.equal(appSettingsSchema.parse({}).workTaskConcurrency, 4);
    await settings.update({ workTaskConcurrency: 2 });
    await settings.update({ locale: "en-US" });
    assert.equal((await createSettingService().get()).workTaskConcurrency, 2);
    for (const value of [0, -1, 1.2, NaN, Infinity]) {
      assert.equal(appSettingsPatchSchema.safeParse({ workTaskConcurrency: value }).success, false);
      await assert.rejects(settings.update({ workTaskConcurrency: value }));
    }
    assert.equal((await settings.get()).workTaskConcurrency, 2);
    for (const value of [5, 8, 16, 1000]) {
      await settings.update({ workTaskConcurrency: value });
      assert.equal((await createSettingService().get()).workTaskConcurrency, value);
    }
    await settings.update({ workTaskConcurrency: 4 });
    const tasks: WorkTask[] = [];
    for (let index = 0; index < 8; index++)
      tasks.push(
        await service.create({
          ...draft,
          execution: index % 2 ? { kind: "acp", agent: "codex", config: [] } : draft.execution,
        }),
      );
    tasks.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    await service.startAll({ workspacePath: draft.workspacePath });
    await eventually(() => started.length === 4);
    assert.deepEqual(
      started,
      tasks.slice(0, 4).map((task) => task.id),
    );
    assert.equal(
      (await service.list({ workspacePath: draft.workspacePath })).tasks.filter(
        (task) => task.status === "queued",
      ).length,
      4,
    );
    await settings.update({ workTaskConcurrency: 2 });
    releases.get(tasks[0].id)!();
    releases.get(tasks[1].id)!("failure");
    await eventually(
      async () =>
        (await service.list({ workspacePath: draft.workspacePath })).tasks.filter((task) =>
          ["review", "failed"].includes(task.status),
        ).length === 2,
    );
    assert.equal(started.length, 4);
    releases.get(tasks[2].id)!();
    await eventually(() => started.length === 5);
    assert.equal(started[4], tasks[4].id);
    await settings.update({ workTaskConcurrency: 4 });
    await eventually(() => started.length === 7);
    await service.cancel({ workspacePath: draft.workspacePath, id: tasks[3].id });
    await eventually(() => started.length === 8);
    assert.deepEqual(
      started,
      tasks.map((task) => task.id),
    );
    assert.equal((await createSettingService().get()).workTaskConcurrency, 4);
  } finally {
    await service.disposeAllAndWait();
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("configured concurrency above four admits twelve tasks and queues only the remaining to-do tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-task-large-limit-"));
  const started = new Set<string>();
  const releases: (() => void)[] = [];
  const service = new WorkTaskService({
    repo: new WorkTaskRepo(join(directory, "tasks.sqlite")),
    getConcurrency: async () => 12,
    pollIntervalMs: 10,
    execute: async (task, context) => {
      started.add(task.id);
      await context.update({ status: "running" });
      await new Promise<void>((resolve) => {
        releases.push(resolve);
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
  try {
    for (let index = 0; index < 16; index++) await service.create(draft);
    await service.startAll({ workspacePath: draft.workspacePath });
    await eventually(() => started.size === 12);
    const board = await service.list({ workspacePath: draft.workspacePath });
    assert.equal(board.tasks.filter((task) => task.status === "running").length, 12);
    assert.equal(board.tasks.filter((task) => task.status === "queued").length, 4);
    releases.shift()!();
    await eventually(() => started.size === 13);
    assert.equal(
      (await service.list({ workspacePath: draft.workspacePath })).tasks.filter(
        (task) => task.status === "running",
      ).length,
      12,
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("restart preserves the queue, skips canceled entries and recovers expired slots without replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-task-recovery-"));
  const path = join(directory, "tasks.sqlite");
  let repo = new WorkTaskRepo(path);
  try {
    await repo.ready();
    const tasks = Array.from({ length: 3 }, () => repo.create(draft));
    for (const task of tasks) repo.enqueue(task, task.id);
    repo.claimNext("crashed", Date.now() - 60_000, 100, 1);
    repo.cancel(tasks[1], tasks[1].id);
    repo.close();
    repo = new WorkTaskRepo(path);
    await repo.ready();
    assert.equal(repo.claimNext("new", Date.now(), 30_000, 1), null);
    repo.recoverExpired(Date.now());
    assert.equal(repo.get(tasks[0], tasks[0].id).status, "failed");
    assert.equal(repo.claimNext("new", Date.now(), 30_000, 1)?.id, tasks[2].id);
    assert.equal(repo.claimNext("new", Date.now(), 30_000, 1), null);
    assert.equal(repo.get(tasks[0], tasks[0].id).runSeq, 1, "expired run was not replayed");
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
