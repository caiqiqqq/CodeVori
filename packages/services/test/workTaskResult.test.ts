import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  workTaskResultRequestSchema,
  type WorkTask,
  type WorkTaskChangeRecord,
} from "@zcode/shared";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { createWorkTaskResult } from "../src/work-task/workTaskResult.js";
import type { WorkTaskForgePort, WorkTaskResultPort } from "../src/session/workTask.js";
import type { IGitService } from "../src/git/git.js";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
const scope = { workspacePath: "/synthetic/project" };
const hash = "a".repeat(40);
const record: WorkTaskChangeRecord = {
  state: "known",
  branchName: "task/result",
  headCommit: hash,
  commits: [{ hash, subject: "Fix issue", published: false }],
  files: [{ path: "src/fix.ts", added: 3, removed: 1 }],
  uncommitted: [],
  truncated: false,
};
const summarySource = {
  kind: "api" as const,
  selection: { providerId: "test", modelId: "summary" },
};
async function fixture(
  port: Pick<WorkTaskResultPort, "records"> & {
    generate(...args: Parameters<WorkTaskResultPort["generate"]>): Promise<string>;
  },
) {
  const dir = await mkdtemp(join(tmpdir(), "zcode-result-"));
  const repo = new WorkTaskRepo(join(dir, "tasks.sqlite"));
  const comments: string[] = [];
  let closes = 0;
  let failClose = false;
  let remoteState = "open";
  const service = new WorkTaskService({
    repo,
    result: {
      ...port,
      source: async () => summarySource,
      generate: async (...args) => ({ text: await port.generate(...args), source: summarySource }),
    },
    execute: async () => {},
    forge: {
      listForgeComments: async () => ({
        items: comments.map((body) => ({ body })),
        hasMore: false,
      }),
      createForgeComment: async (r: { body: string }) => {
        comments.push(r.body);
      },
      getForgeItem: async () => ({ state: remoteState }),
      setForgeItemState: async () => {
        closes++;
        if (failClose) throw new Error("FORGE_FORBIDDEN");
        remoteState = "closed";
      },
    } as unknown as WorkTaskForgePort,
  });
  await repo.ready();
  const task = repo.create({
    ...scope,
    title: "Fix",
    prompt: "Fix the issue",
    useWorktree: false,
    sourceBranch: "main",
    execution: { kind: "acp", agent: "codex", config: [] },
  });
  repo.enqueue(scope, task.id);
  const run = repo.claimNext("test", Date.now(), 30_000)!;
  repo.updateRun(run, "test", {
    session: { kind: "acp", id: "bound-session" },
    directBranch: "main",
  });
  repo.finish(run, "test");
  return {
    repo,
    service,
    task: repo.get(scope, task.id),
    comments,
    closeCount: () => closes,
    allowClose: () => {
      failClose = false;
    },
    failClose: () => {
      failClose = true;
    },
    request: (task: WorkTask) => ({
      ...scope,
      id: task.id,
      runSeq: task.runSeq,
      requestId: randomUUID(),
      mode: "accept" as const,
      locale: "zh-CN" as const,
    }),
    async cleanup() {
      await service.disposeAllAndWait();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("result drafts do not mutate tasks, reject stale scope/runs, and cancel late output", async () => {
  let resolve!: (text: string) => void;
  let signal!: AbortSignal;
  const f = await fixture({
    records: async () => record,
    generate: async (_t, _i, s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  try {
    const request = f.request(f.task);
    const before = f.repo.get(scope, f.task.id);
    const pending = f.service.generateResult(request);
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      f.service.generateResult({ ...request, requestId: randomUUID() }),
      /result-busy/,
    );
    await assert.rejects(
      f.service.generateResult({ ...request, runSeq: request.runSeq + 1 }),
      /not-reviewable/,
    );
    await assert.rejects(
      f.service.cancelResult({
        ...scope,
        workspacePath: "/different",
        id: request.id,
        runSeq: request.runSeq,
        requestId: request.requestId,
      }),
    );
    assert.equal(signal.aborted, false);
    await f.service.cancelResult({
      ...scope,
      id: request.id,
      runSeq: request.runSeq,
      requestId: request.requestId,
    });
    assert.equal(signal.aborted, true);
    resolve("Late summary");
    await assert.rejects(pending, /result-canceled/);
    assert.deepEqual(f.repo.get(scope, f.task.id), before);
    assert.equal(f.comments.length, 0);
    assert.equal(f.closeCount(), 0);
    assert.equal(
      workTaskResultRequestSchema.safeParse({ ...request, sessionId: "other" }).success,
      false,
    );
  } finally {
    await f.cleanup();
  }
});
test("changed task runs discard generated drafts and invalid output never becomes a result", async () => {
  let output = "";
  let finish!: (text: string) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let delayed = true;
  const f = await fixture({
    records: async () => record,
    generate: async () => {
      if (!delayed) return output;
      entered();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
  });
  try {
    const pending = f.service.generateResult(f.request(f.task));
    await started;
    f.repo.enqueue(scope, f.task.id, "Continue with the requested fix");
    const run = f.repo.claimNext("test", Date.now(), 30_000)!;
    f.repo.finish(run, "test");
    finish("Summary from an old run");
    await assert.rejects(pending, /result-source-changed/);
    delayed = false;
    const task = f.repo.get(scope, f.task.id);
    for (output of ["", " ", "x".repeat(12_001)])
      await assert.rejects(f.service.generateResult(f.request(task)), /result-invalid-output/);
    await assert.rejects(
      f.service.generateResult({ ...f.request(task), workspaceIdentity: "remote-scope" }),
      /remote-unsupported/,
    );
    assert.equal(f.comments.length, 0);
    assert.equal(f.closeCount(), 0);
    assert.equal(f.repo.get(scope, f.task.id).status, "review");
  } finally {
    await f.cleanup();
  }
});
test("commit links require both published evidence and the linked Forge repository", async () => {
  const f = await fixture({ generate: async () => "", records: async () => record });
  const key = "github:forge.invalid/team/project";
  let repositoryKey = key;
  let published = true;
  const port = createWorkTaskResult({
    git: {
      getTaskChangeRecord: async () => ({
        record: { ...record, commits: [{ ...record.commits[0]!, published }] },
        patch: "",
      }),
      getForgeRepository: async () => ({
        status: "ready",
        repository: {
          key: repositoryKey,
          provider: "github",
          url: "https://forge.invalid/team/project",
        },
      }),
    } as unknown as IGitService,
    acp: {} as IAcpService,
    agent: {} as IZCodeAgentService,
  });
  const task = {
    ...f.task,
    source: {
      repositoryKey: key,
      remoteName: "origin",
      accountId: randomUUID(),
      kind: "issue" as const,
      number: 8,
      url: "https://forge.invalid/team/project/issues/8",
      title: "Issue",
    },
  };
  try {
    assert.equal(
      (await port.records(task)).commits[0]?.url,
      `https://forge.invalid/team/project/commit/${hash}`,
    );
    repositoryKey = "github:forge.invalid/other/project";
    assert.equal((await port.records(task)).commits[0]?.url, undefined);
    repositoryKey = key;
    published = false;
    assert.equal((await port.records(task)).commits[0]?.url, undefined);
  } finally {
    await f.cleanup();
  }
});
test("ordinary completion freezes unknown change evidence when reads fail", async () => {
  const f = await fixture({
    generate: async () => "summary",
    records: async () => {
      throw new Error("missing tree");
    },
  });
  try {
    const current = f.repo.get(scope, f.task.id);
    const source = {
      repositoryKey: "github:forge.invalid/team/project",
      remoteName: "origin",
      accountId: randomUUID(),
      kind: "issue" as const,
      number: 7,
      url: "https://forge.invalid/team/project/issues/7",
      title: "Issue",
    };
    // 新建关联记录走 repo，测试不向真实 Forge 写入。
    const linked = f.repo.create({
      ...scope,
      source,
      title: "linked",
      prompt: "linked",
      execution: current.execution,
    });
    f.repo.enqueue(scope, linked.id);
    const run = f.repo.claimNext("test", Date.now(), 30_000)!;
    f.repo.finish(run, "test");
    await f.service.complete({
      ...scope,
      id: linked.id,
      forge: { closeIssue: false, comment: "Accepted" },
    });
    assert.match(f.comments[0]!, /changes could not be verified/);
    const done = f.repo.get(scope, linked.id);
    assert.equal(done.forgeWriteback?.recordsFinalized, true);
    assert.equal(done.forgeWriteback?.records?.state, "unknown");
  } finally {
    await f.cleanup();
  }
});

test("a failed issue close retries frozen records without reading changed Git evidence or duplicating comments", async () => {
  let reads = 0;
  const f = await fixture({
    generate: async () => "summary",
    records: async () => {
      reads++;
      return { ...record, commits: [{ ...record.commits[0]!, subject: `Evidence ${reads}` }] };
    },
  });
  try {
    const linked = f.repo.create({
      ...scope,
      title: "linked",
      prompt: "linked",
      execution: f.task.execution,
      source: {
        repositoryKey: "github:forge.invalid/team/project",
        remoteName: "origin",
        accountId: randomUUID(),
        kind: "issue",
        number: 8,
        url: "https://forge.invalid/team/project/issues/8",
        title: "Issue",
      },
    });
    f.repo.enqueue(scope, linked.id);
    const run = f.repo.claimNext("test", Date.now(), 30_000)!;
    f.repo.finish(run, "test");
    f.failClose();
    await assert.rejects(
      f.service.complete({
        ...scope,
        id: linked.id,
        forge: { closeIssue: true, comment: "Confirmed result" },
      }),
      /FORGE_FORBIDDEN/,
    );
    const before = f.repo.get(scope, linked.id);
    assert.equal(before.status, "done");
    assert.equal(before.forgeWriteback?.recordsFinalized, true);
    assert.equal(reads, 1);
    assert.match(f.comments[0]!, /Evidence 1/);
    assert.match(f.comments[0]!, /src\/fix.ts/);
    f.allowClose();
    await f.service.complete({
      ...scope,
      id: linked.id,
      forge: { closeIssue: false, comment: "Must not replace" },
    });
    assert.equal(reads, 1);
    assert.equal(f.comments.length, 1);
    assert.deepEqual(
      f.repo.get(scope, linked.id).forgeWriteback?.records,
      before.forgeWriteback?.records,
    );
    assert.equal(f.repo.get(scope, linked.id).forgeWriteback?.closeState, "done");
  } finally {
    await f.cleanup();
  }
});
