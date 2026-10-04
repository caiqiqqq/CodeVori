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

test("managed worktree history merges ordinary, pinned, archived API and scoped ACP sessions", async () => {
  const observed: string[] = [];
  const services = {
    zcodeTaskService: {
      listTasks: async (target: { workspacePath: string }) => {
        observed.push(target.workspacePath);
        return [task("ordinary", 100), task("duplicate", 120)];
      },
      listPinnedTasks: async () => [task("duplicate", 120), task("pinned", 300)],
      listArchivedTasks: async () => [task("archived", 200)],
    },
    acpService: {
      list: async () => [session("acp", 250), session("other", 400, "/tmp/other")],
    },
  } as unknown as Parameters<typeof loadManagedWorktreeConversations>[0];
  const result = await loadManagedWorktreeConversations(services, path);
  assert.equal(result.failed, false);
  assert.deepEqual(observed, [path]);
  assert.deepEqual(
    result.conversations.map(({ kind, id }) => `${kind}:${id}`),
    ["api:pinned", "acp:acp", "api:archived", "api:duplicate", "api:ordinary"],
  );
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
