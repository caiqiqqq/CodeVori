import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import { createAcpService } from "../src/acp/acpServiceImpl.js";

const workspace = { workspacePath: "/tmp/search-project", workspaceIdentity: "host-one" };
function snapshot(overrides: Partial<AcpSession> = {}): AcpSession {
  return {
    ...workspace,
    id: crypto.randomUUID(),
    agent: "codex",
    acpSessionId: "native-search-id",
    title: "历史标题",
    status: "idle",
    revision: 7,
    archived: false,
    pinned: false,
    unreadAt: null,
    goal: null,
    configOptions: [],
    modeState: null,
    entries: [
      { id: "user:one", kind: "user", text: "用户原文", createdAt: 100 },
      { id: "assistant:one", kind: "assistant", text: "OnlyInReply 搜索正文", createdAt: 200 },
      { id: "tool:one", kind: "tool", title: "ToolOnly", status: "completed", content: "ToolOnly" },
    ],
    pendingPermission: null,
    error: null,
    ...overrides,
  };
}

test("ACP search reads durable scoped history without connecting or altering accepted facts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-search-"));
  let connects = 0;
  const service = createAcpService({
    directory,
    connect: async () => {
      connects += 1;
      throw new Error("search must not connect");
    },
  });
  const accepted = snapshot();
  const excluded = [
    snapshot({ provisional: true }),
    snapshot({ entries: [] }),
    snapshot({ supersededBy: accepted.id }),
    snapshot({ workspaceIdentity: "host-two" }),
    snapshot({ workspacePath: "/tmp/other-path" }),
  ];
  try {
    for (const item of [accepted, ...excluded])
      await writeFile(join(directory, `${item.id}.json`), JSON.stringify(item));
    const byTitle = await service.search({ ...workspace, query: "历史" });
    assert.deepEqual(
      byTitle.map((item) => item.id),
      [accepted.id],
    );
    const byBody = await service.search({ ...workspace, query: "  onlyinreply  " });
    assert.equal(byBody[0]?.matches[0]?.entryId, "assistant:one");
    assert.ok(byBody[0]?.matches[0]?.snippet.includes("OnlyInReply"));
    assert.equal(byBody[0]?.updatedAt, 200);
    assert.equal(byBody[0]?.revision, 7);
    assert.equal("entries" in byBody[0]!, false);
    assert.equal("configOptions" in byBody[0]!, false);
    assert.equal((await service.search({ ...workspace, query: "用户原文" }))[0]?.id, accepted.id);
    assert.deepEqual(await service.search({ ...workspace, query: "ToolOnly" }), []);
    assert.equal(connects, 0);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, `${accepted.id}.json`), "utf8")),
      accepted,
    );
    await service.remove({ ...workspace, id: accepted.id });
    assert.deepEqual(await service.search({ ...workspace, query: "历史" }), []);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP recent/search results use activity time, cap summaries, and preserve precise entry ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-search-order-"));
  const service = createAcpService({ directory });
  const many = snapshot({
    entries: Array.from({ length: 9 }, (_, index) => ({
      id: `user:${index}`,
      kind: "user" as const,
      text: `${"a".repeat(400)} match ${index} ${"b".repeat(400)}`,
      createdAt: 100 + index,
    })),
  });
  const recent = snapshot({
    title: "最近",
    entries: [{ id: "user:recent", kind: "user", text: "recent", createdAt: 300 }],
  });
  const old = snapshot({
    legacySavedAt: 250,
    entries: [{ id: "user:legacy", kind: "user", text: "legacy" }],
  });
  try {
    for (const item of [many, recent, old])
      await writeFile(join(directory, `${item.id}.json`), JSON.stringify(item));
    assert.deepEqual(
      (await service.search({ ...workspace, query: "", limit: 2 })).map((item) => item.id),
      [recent.id, old.id],
    );
    const [result] = await service.search({ ...workspace, query: "MATCH" });
    assert.equal(result?.matches.length, 5);
    assert.equal(result?.matches[4]?.entryId, "user:4");
    assert.ok(result?.matches.every((match) => match.snippet.length <= 220));
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("delegated ACP sessions stay directly readable but leave history and search projections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-delegated-"));
  const child = snapshot({ title: "子会话", archived: true });
  const ordinary = snapshot({ title: "普通会话" });
  const service = createAcpService({
    directory,
    delegatedSessionIds: async (scope) =>
      scope.workspaceIdentity === "host-one" && scope.workspacePath === workspace.workspacePath
        ? [child.id]
        : [],
  });
  try {
    for (const item of [child, ordinary])
      await writeFile(join(directory, `${item.id}.json`), JSON.stringify(item));
    assert.deepEqual(
      (await service.listSummaries(workspace)).map((item) => item.id),
      [ordinary.id],
    );
    assert.deepEqual(
      (await service.search({ ...workspace, query: "" })).map((item) => item.id),
      [ordinary.id],
    );
    assert.deepEqual(await service.listArchivedWorkspaces(), []);
    assert.equal((await service.read({ ...workspace, id: child.id })).id, child.id);
    assert.equal((await service.list(workspace)).length, 2);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
