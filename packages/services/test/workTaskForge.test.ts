import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRODUCT_NAME,
  workTaskCompleteSchema,
  workTaskUpdateSchema,
  type WorkTaskMerge,
} from "@zcode/shared";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import type { WorkTaskForgePort } from "../src/session/workTask.js";

const scope = { workspacePath: "/synthetic/project" };
const source = {
  repositoryKey: "github:forge.invalid/team/project",
  remoteName: "origin",
  accountId: "00000000-0000-4000-8000-000000000001",
  kind: "issue" as const,
  number: 7,
  url: "https://forge.invalid/team/project/issues/7",
  title: "Issue",
};
const draft = {
  ...scope,
  source,
  title: "Handle issue",
  prompt: "Fix synthetic issue",
  execution: { kind: "acp" as const, agent: "codex" as const, config: [] },
};
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition did not settle");
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-task-forge-"));
  const path = join(dir, "tasks.sqlite");
  const calls: string[] = [];
  const comments: string[] = [];
  let state = "open";
  let failClose = false;
  const forge = {
    async getForgeItem(input: import("@zcode/shared").ForgeItemRequest) {
      calls.push("read");
      return {
        ...source,
        kind: input.kind,
        number: input.number,
        state,
        url: source.url,
        title: "Canonical issue",
      };
    },
    async listForgeComments() {
      return { items: comments.map((body) => ({ body })), hasMore: false };
    },
    async createForgeComment(input: { body: string }) {
      calls.push("comment");
      comments.push(input.body);
    },
    async setForgeItemState() {
      calls.push("close");
      if (failClose) throw new Error("FORGE_FORBIDDEN");
      state = "closed";
    },
  } as unknown as WorkTaskForgePort;
  const services: WorkTaskService[] = [];
  const make = (merge?: import("../src/session/workTask.js").WorkTaskMergePort) => {
    const repo = new WorkTaskRepo(path);
    const service = new WorkTaskService({
      repo,
      forge,
      merge,
      execute: async () => {},
      pollIntervalMs: 10,
    });
    services.push(service);
    return { repo, service };
  };
  const review = async (repo: WorkTaskRepo, id: string, allocate = false) => {
    repo.enqueue(scope, id);
    const run = repo.claimNext("test", Date.now(), 30_000)!;
    if (allocate)
      repo.updateRun(run, "test", {
        worktree: {
          rootPath: "/synthetic/trees",
          path: "/synthetic/trees/task/project",
          projectPath: scope.workspacePath,
          branchName: "worktree/task",
          baseCommit: "base",
        },
      });
    repo.finish(run, "test");
  };
  return {
    forge,
    make,
    review,
    calls,
    comments,
    failClose: (v: boolean) => {
      failClose = v;
    },
    setRemoteState: (v: string) => {
      state = v;
    },
    async clean() {
      for (const service of services) await service.disposeAllAndWait();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("completion returns after durable done before remote writeback settles", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    const original = f.forge.createForgeComment;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.forge.createForgeComment = async (input) => {
      await blocked;
      return original(input);
    };

    const accepted = await a.service.complete({
      ...scope,
      id: task.id,
      forge: { closeIssue: false, comment: "Accepted asynchronously" },
    });
    assert.equal(accepted.status, "done");
    assert.equal((await a.service.list(scope)).tasks[0]?.status, "done");
    assert.equal(f.comments.length, 0);
    release();
    await eventually(() => f.comments.length === 1);
  } finally {
    await f.clean();
  }
});

test("target mismatch never creates a task; a live writeback lease fences another Host", async () => {
  const f = await fixture();
  try {
    const a = f.make(),
      b = f.make();
    const original = f.forge.getForgeItem;
    f.forge.getForgeItem = async () => {
      throw new Error("FORGE_TARGET_CHANGED");
    };
    await assert.rejects(a.service.create(draft), /FORGE_TARGET_CHANGED/);
    assert.equal((await a.service.list(scope)).tasks.length, 0);
    f.forge.getForgeItem = original;
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    const done = a.repo.complete(scope, task.id, { closeIssue: true });
    a.repo.claimForgeWriteback(done, "00000000-0000-4000-8000-000000000002");
    await assert.rejects(b.service.complete({ ...scope, id: task.id }), /forge-busy/);
    assert.equal(f.calls.includes("close"), false);
  } finally {
    await f.clean();
  }
});

test("a lost comment ACK is recovered from its marker without another POST", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    const done = a.repo.complete(scope, task.id, { closeIssue: true, comment: "Accepted" });
    const state = done.forgeWriteback!;
    a.repo.writeForgeState(done, state.id, { ...state, commentState: "sending" });
    f.comments.push(`Accepted\n<!-- zcode-task:${task.id}:${state.id} -->`);
    const result = await a.service.complete({ ...scope, id: task.id });
    assert.equal(result.status, "done");
    await eventually(
      async () => (await a.service.list(scope)).tasks[0]?.forgeWriteback?.closeState === "done",
    );
    const settled = (await a.service.list(scope)).tasks[0]!;
    assert.equal(settled.forgeWriteback?.commentState, "done");
    assert.equal(settled.forgeWriteback?.closeState, "done");
    assert.equal(f.calls.filter((c) => c === "comment").length, 0);
  } finally {
    await f.clean();
  }
});

test("source is validated and immutable; duplicate admission is atomic across Hosts", async () => {
  const f = await fixture();
  try {
    const a = f.make(),
      b = f.make();
    const results = await Promise.allSettled([a.service.create(draft), b.service.create(draft)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason),
      /duplicate-source/,
    );
    const task = (await a.service.list(scope)).tasks[0]!;
    assert.equal(task.source?.title, "Canonical issue");
    assert.equal(f.calls.includes("comment"), false);
    assert.equal(workTaskUpdateSchema.safeParse({ ...draft, id: task.id }).success, false);
    const { source: _source, ...editable } = draft;
    const edited = await a.service.update({ ...editable, id: task.id, title: "Edited task" });
    assert.deepEqual(edited.source, task.source);
    await assert.rejects(
      a.service.complete({ ...scope, id: task.id, forge: { closeIssue: true } }),
      /not-reviewable/,
    );
    await a.service.disposeAllAndWait();
    assert.deepEqual((await b.service.list(scope)).tasks[0]?.source, task.source);
    assert.equal((await b.service.list({ workspacePath: "/other" })).tasks.length, 0);
  } finally {
    await f.clean();
  }
});

test("complete persists receipts; close failure retries after restart without repeating comment", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    f.failClose(true);
    const accepted = await a.service.complete({
      ...scope,
      id: task.id,
      forge: { closeIssue: true, comment: "Verified fix" },
    });
    assert.equal(accepted.status, "done");
    await eventually(
      async () => (await a.service.list(scope)).tasks[0]?.forgeWriteback?.closeState === "failed",
    );
    const failed = (await a.service.list(scope)).tasks[0]!;
    assert.equal(failed.status, "done");
    assert.equal(failed.forgeWriteback?.commentState, "done");
    assert.equal(failed.forgeWriteback?.closeState, "failed");
    await assert.rejects(a.service.create(draft), /duplicate-source/);
    await a.service.disposeAllAndWait();
    f.failClose(false);
    const b = f.make();
    const done = await b.service.complete({ ...scope, id: task.id });
    assert.equal(done.status, "done");
    await eventually(
      async () => (await b.service.list(scope)).tasks[0]?.forgeWriteback?.closeState === "done",
    );
    assert.equal(f.comments.length, 1);
    assert.equal(f.comments[0]!.split("\n")[0], `${PRODUCT_NAME} task \`${task.id}\` completed.`);
    assert.ok(
      f.comments[0]!.includes(`<!-- zcode-task:${task.id}:${failed.forgeWriteback!.id} -->`),
    );
    assert.match(f.comments[0]!, /Verified fix/);
    await b.service.complete({ ...scope, id: task.id });
    await eventually(
      async () => (await b.service.list(scope)).tasks[0]?.forgeWriteback?.closeState === "done",
    );
    assert.equal(f.calls.filter((c) => c === "close").length, 2);
    assert.equal((await b.service.create(draft)).status, "todo");
    assert.ok(
      (await b.service.getEvents({ ...scope, id: task.id })).some(
        (e) => e.type === "forge-writeback",
      ),
    );
  } finally {
    await f.clean();
  }
});

test("interrupted comment is reconciled before close; absent marker needs explicit resend", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    const completed = a.repo.complete(scope, task.id, { closeIssue: true, comment: "Result" });
    const request = completed.forgeWriteback!;
    a.repo.writeForgeState(completed, request.id, { ...request, commentState: "sending" });
    const accepted = await a.service.complete({ ...scope, id: task.id });
    assert.equal(accepted.status, "done");
    await eventually(
      async () =>
        (await a.service.list(scope)).tasks[0]?.forgeWriteback?.commentState === "uncertain",
    );
    assert.equal(f.comments.length, 0);
    await a.service.complete({ ...scope, id: task.id, resendComment: true });
    await eventually(() => f.comments.length === 1);
  } finally {
    await f.clean();
  }
});

test("plain completion and PR comments never close an issue implicitly; protocol rejects injected target", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    await a.service.complete({ ...scope, id: task.id });
    assert.equal(f.calls.includes("close"), false);
    assert.equal(f.comments.length, 0);
    assert.equal(
      workTaskCompleteSchema.safeParse({ ...scope, id: task.id, repositoryKey: "other" }).success,
      false,
    );
    const pr = await a.service.create({ ...draft, source: { ...source, kind: "pull-request" } });
    await f.review(a.repo, pr.id);
    await assert.rejects(
      a.service.complete({ ...scope, id: pr.id, forge: { closeIssue: true } }),
      /forge-close-issue-only/,
    );
    assert.equal((await a.service.list(scope)).tasks.find((t) => t.id === pr.id)?.status, "review");
    await a.service.complete({
      ...scope,
      id: pr.id,
      forge: { closeIssue: false, comment: "PR result accepted" },
    });
    await eventually(() => f.comments.length === 1);
    assert.equal(f.comments.length, 1);
    assert.equal(f.comments[0]!.split("\n")[0], `${PRODUCT_NAME} task \`${pr.id}\` completed.`);
    assert.equal(f.calls.includes("close"), false);
  } finally {
    await f.clean();
  }
});

test("already-closed issue satisfies the request; later reopening is not undone by retry", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    f.setRemoteState("closed");
    const done = await a.service.complete({ ...scope, id: task.id, forge: { closeIssue: true } });
    assert.equal(done.status, "done");
    await eventually(
      async () => (await a.service.list(scope)).tasks[0]?.forgeWriteback?.closeState === "done",
    );
    assert.equal(f.calls.includes("close"), false);
    f.setRemoteState("open");
    await a.service.complete({ ...scope, id: task.id });
    assert.equal((await f.forge.getForgeItem({ ...scope, ...source })).state, "open");
    assert.equal(f.calls.includes("close"), false);
  } finally {
    await f.clean();
  }
});

test("merge writes back only after successful done, using the settled merge run and local result", async () => {
  const f = await fixture();
  try {
    const a = f.make({
      validate: async () => ({ projectPath: scope.workspacePath }),
      execute: async (task, context) => {
        assert.equal(f.comments.length, 0);
        const merge: WorkTaskMerge = {
          ...task.merge!,
          phase: "merged",
          resultCommit: "result-commit",
        };
        await context.update({ merge });
      },
    });
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id, true);
    await a.service.merge({
      ...scope,
      id: task.id,
      targetBranch: "main",
      forge: { closeIssue: true, comment: "Merged result" },
    });
    for (let i = 0; i < 100; i++) {
      if ((await a.service.list(scope)).tasks[0]?.forgeWriteback?.closeState === "done") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const done = (await a.service.list(scope)).tasks[0]!;
    assert.equal(done.status, "done");
    assert.equal(done.completion, "merged");
    assert.equal(done.forgeWriteback?.runSeq, done.runSeq);
    assert.equal(done.forgeWriteback?.closeState, "done");
    assert.equal(f.comments[0]!.split("\n")[0], `${PRODUCT_NAME} task \`${task.id}\` completed.`);
    assert.match(f.comments[0]!, /Merged locally into main; not pushed/);
    assert.match(f.comments[0]!, /result-commit/);
  } finally {
    await f.clean();
  }
});

test("stale-run requests do not write remotely", async () => {
  const f = await fixture();
  try {
    const a = f.make();
    const task = await a.service.create(draft);
    await f.review(a.repo, task.id);
    const done = a.repo.complete(scope, task.id, { closeIssue: true });
    a.repo.writeForgeState(done, done.forgeWriteback!.id, {
      ...done.forgeWriteback!,
      runSeq: done.runSeq + 1,
    });
    const accepted = await a.service.complete({ ...scope, id: task.id });
    assert.equal(accepted.status, "done");
    assert.equal(f.calls.includes("close"), false);
  } finally {
    await f.clean();
  }
});
