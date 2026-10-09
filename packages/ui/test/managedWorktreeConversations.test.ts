import assert from "node:assert/strict";
import test from "node:test";
import type { AcpSession, ZCodeTaskMeta } from "@zcode/shared";
import { loadManagedWorktreeConversations } from "../src/lib/managedWorktreeConversations.ts";

const path = "/tmp/worktrees/abcd/project";
const task = (id: string, updatedAt: number) =>
  ({ taskId: id, title: id, workspacePath: path, updatedAt }) as ZCodeTaskMeta;
const session = (id: string, updatedAt: number, workspacePath = path): AcpSession =>
  ({
    id,
    agent: "codex",
    title: id,
    workspacePath,
    status: "idle",
    pinned: true,
    archived: false,
    entries: [{ id: `user:${id}`, kind: "user", text: id, createdAt: updatedAt }],
  }) as AcpSession;

test("managed worktree history merges ordinary and pinned API with unarchived scoped ACP sessions", async () => {
  const observed: string[] = [];
  const services = {
    zcodeTaskService: {
      listTasks: async (target: { workspacePath: string }) => {
        observed.push(target.workspacePath);
        return [task("ordinary", 100), task("duplicate", 120)];
      },
      listPinnedTasks: async () => [task("duplicate", 120), task("pinned", 300)],
      listArchivedTasks: async () => {
        assert.fail("Worktree settings must not read archived API tasks");
      },
    },
    acpService: {
      list: async () => [
        session("acp", 250),
        { ...session("acp-ordinary", 200), pinned: false },
        { ...session("acp-archived", 500), pinned: false, archived: true },
        { ...session("acp-pinned-archived", 600), archived: true },
        session("other", 400, "/tmp/other"),
      ],
    },
  } as unknown as Parameters<typeof loadManagedWorktreeConversations>[0];
  const result = await loadManagedWorktreeConversations(services, path);
  assert.equal(result.failed, false);
  assert.deepEqual(observed, [path]);
  assert.deepEqual(
    result.conversations.map(({ kind, id }) => `${kind}:${id}`),
    ["api:pinned", "acp:acp", "acp:acp-ordinary", "api:duplicate", "api:ordinary"],
  );
});

test("an archived-only worktree has an empty conversation list without changing its history", async () => {
  const archivedAcp = [{ ...session("acp-archived", 300), archived: true }];
  const services = {
    zcodeTaskService: {
      listTasks: async () => [],
      listPinnedTasks: async () => [],
      listArchivedTasks: async () => {
        assert.fail("Worktree settings must not read archived API tasks");
      },
    },
    acpService: { list: async () => archivedAcp },
  } as unknown as Parameters<typeof loadManagedWorktreeConversations>[0];
  assert.deepEqual(await loadManagedWorktreeConversations(services, path), {
    conversations: [],
    failed: false,
  });
  assert.equal(archivedAcp[0].archived, true);
});

test("partial history failure is reported while remaining conversations are still shown", async () => {
  const services = {
    zcodeTaskService: {
      listTasks: async () => [task("ordinary", 100)],
      listPinnedTasks: async () => {
        throw new Error("index unavailable");
      },
      listArchivedTasks: async () => [],
    },
    acpService: { list: async () => [] },
  } as unknown as Parameters<typeof loadManagedWorktreeConversations>[0];
  const result = await loadManagedWorktreeConversations(services, path);
  assert.equal(result.failed, true);
  assert.deepEqual(
    result.conversations.map(({ id }) => id),
    ["ordinary"],
  );
});
