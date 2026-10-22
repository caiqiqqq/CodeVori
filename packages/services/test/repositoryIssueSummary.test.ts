import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForgeItem, ForgeItemList, WorkTask } from "@zcode/shared";
import { createRepositoryIssueSummary } from "../src/session/repositoryIssueSummary.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProxyChannel } from "@zcode/rpc";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import type { IWorkTaskService } from "../src/session/contract.js";

const accountId = "00000000-0000-4000-8000-000000000001";
const project = { workspacePath: "/project" };
function page(numbers: number[], hasMore = false, total: number | null = null): ForgeItemList {
  return {
    items: numbers.map((number) => ({ number, kind: "issue", state: "open" }) as ForgeItem),
    page: 1,
    pageSize: 100,
    total,
    reachableTotal: total,
    incomplete: false,
    hasMore,
  };
}
function fixture() {
  let now = 1000;
  const tasks = new Map<string, WorkTask[]>();
  const calls: unknown[] = [];
  const replies: Array<ForgeItemList | Error | Promise<ForgeItemList>> = [];
  const read = createRepositoryIssueSummary({
    now: () => now,
    tasks: (scope) => tasks.get(scope.workspacePath) ?? [],
    forge: {
      async getForgeRepository(scope) {
        return {
          status: "ready",
          remoteNames: ["origin"],
          remoteName: scope.remoteName ?? "origin",
          host: "forge.example.invalid",
          provider: "github",
          repository: { key: "repo", accountId } as never,
        };
      },
      async listForgeItems(input) {
        calls.push(input);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        assert.ok(reply, "unexpected Forge request");
        return reply;
      },
    },
  });
  return {
    read,
    tasks,
    calls,
    replies,
    advance: () => {
      now += 60_000;
    },
  };
}
const linked = (number: number, status = "todo") =>
  ({
    source: { repositoryKey: "repo", kind: "issue", number },
    status,
    archived: true,
  }) as WorkTask;

test("all pages and repository aliases share a count, with archived links from every project", async () => {
  const f = fixture();
  f.replies.push(page([1, 2], true, 4), page([3, 4], false, 4));
  f.tasks.set("/project", [linked(1), linked(1)]);
  f.tasks.set("/clone", [linked(3, "canceled"), linked(4, "failed")]);
  assert.equal(
    (await f.read({ projects: [project, project, { workspacePath: "/clone" }] })).pending,
    1,
  );
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    f.calls.map((input: any) => [input.kind, input.state, input.page]),
    [
      ["issue", "open", 1],
      ["issue", "open", 2],
    ],
  );
});

test("cached remote rows never cache task associations; remote cache expires after 60 seconds", async () => {
  const f = fixture();
  f.replies.push(page([1, 2]));
  assert.equal((await f.read({ projects: [project] })).pending, 2);
  f.tasks.set("/project", [linked(1)]);
  assert.equal((await f.read({ projects: [project] })).pending, 1);
  assert.equal(f.calls.length, 1);
  f.advance();
  f.replies.push(page([1, 2, 3]));
  assert.equal((await f.read({ projects: [project] })).pending, 2);
});

test("concurrent readers share IO and use links accepted while Forge is in flight", async () => {
  const f = fixture();
  let finish!: (result: ForgeItemList) => void;
  f.replies.push(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const a = f.read({ projects: [project] });
  const b = f.read({ projects: [project] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  f.tasks.set("/project", [linked(1)]);
  finish(page([1, 2]));
  assert.deepEqual(
    (await Promise.all([a, b])).map((result) => result.pending),
    [1, 1],
  );
});

test("force after a Forge mutation reads again after the old request settles", async () => {
  const f = fixture();
  let finish!: (result: ForgeItemList) => void;
  f.replies.push(
    new Promise((resolve) => {
      finish = resolve;
    }),
    page([2]),
  );
  const old = f.read({ projects: [project] });
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = f.read({ projects: [project], force: true });
  finish(page([1, 2]));
  await old;
  assert.equal((await fresh).pending, 1);
  assert.equal(f.calls.length, 2);
});

test("truncation, partial totals and stalled pagination never return a false exact count", async () => {
  for (const replies of [
    [{ ...page([1]), incomplete: true }],
    [page([1], false, 2000)],
    [page([1], true), page([1], true)],
  ]) {
    const f = fixture();
    f.replies.push(...replies);
    await assert.rejects(f.read({ projects: [project] }), /FORGE_INCOMPLETE/);
  }
});

test("an error is not cached as zero and invalid requests are rejected before IO", async () => {
  const f = fixture();
  f.replies.push(new Error("FORGE_FORBIDDEN"), page([1]));
  await assert.rejects(f.read({ projects: [project] }), /FORGE_FORBIDDEN/);
  assert.equal((await f.read({ projects: [project] })).pending, 1);
  await assert.rejects(f.read({ projects: [{ workspacePath: "" }] }));
  assert.equal(f.calls.length, 2);
});

test("a failed forced refresh cannot resurrect an old remote cache as fresh data", async () => {
  const f = fixture();
  f.replies.push(page([1]), new Error("FORGE_NETWORK"), page([1, 2]));
  await f.read({ projects: [project] });
  await assert.rejects(f.read({ projects: [project], force: true }), /FORGE_NETWORK/);
  assert.equal((await f.read({ projects: [project] })).pending, 2);
  assert.equal(f.calls.length, 3);
});

test("the Host RPC combines persisted links without starting execution and preserves identity isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-repository-summary-"));
  const repo = new WorkTaskRepo(join(directory, "tasks.sqlite"));
  let executions = 0;
  const service = new WorkTaskService({
    repo,
    allowExecution: false,
    execute: async () => {
      executions++;
    },
    repositoryIssues: {
      async getForgeRepository(input) {
        return {
          status: "ready",
          remoteNames: ["origin"],
          remoteName: input.remoteName ?? "origin",
          host: "forge.example.invalid",
          provider: "github",
          repository: { key: "repo", accountId } as never,
        };
      },
      async listForgeItems() {
        return page([1, 2]);
      },
    },
  });
  const channel = ProxyChannel.fromService(service);
  const rpc = ProxyChannel.toService<IWorkTaskService>({
    call: (name, args) => channel.call(undefined, name, args),
    listen: (name, arg) => channel.listen(undefined, name, arg),
  });
  try {
    await repo.ready();
    repo.create({
      ...project,
      title: "Handle issue",
      prompt: "Synthetic request",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "synthetic", modelId: "model" },
      },
      source: {
        repositoryKey: "repo",
        accountId,
        kind: "issue",
        number: 1,
        title: "Issue",
        url: "https://forge.example.invalid/team/repo/issues/1",
      },
    });
    assert.equal((await rpc.getRepositoryIssueSummary({ projects: [project] })).pending, 1);
    const remote = { ...project, workspaceIdentity: "endpoint-b", remoteSessionId: "attachment-b" };
    assert.equal((await rpc.getRepositoryIssueSummary({ projects: [remote] })).pending, 2);
    assert.equal((await rpc.list(project)).tasks.length, 1);
    assert.equal(executions, 0);
    await assert.rejects(rpc.getRepositoryIssueSummary({ projects: [{ workspacePath: "" }] }));
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
