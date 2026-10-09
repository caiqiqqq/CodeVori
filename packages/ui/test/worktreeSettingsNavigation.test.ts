import assert from "node:assert/strict";
import test from "node:test";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTask } from "@zcode/shared";
import { createTabStore } from "../src/store/tabStore.ts";
import {
  consumeWorktreeSettingsConversation,
  listenWorktreeSettingsConversation,
  requestWorktreeSettingsConversation,
  resolveWorktreeSettingsConversation,
} from "../src/lib/worktreeSettingsNavigation.ts";

const project = "/tmp/project";
const worktree = "/tmp/worktrees/abcd/project";
const boundTask = (kind: "api" | "acp", overrides: Partial<WorkTask> = {}) =>
  ({
    id: "work-task",
    workspacePath: project,
    status: "review",
    archived: false,
    execution: kind === "api" ? { kind } : { kind, agent: "codex" },
    worktree: { path: worktree },
    session: { kind, id: "saved" },
    ...overrides,
  }) as WorkTask;
const apiTarget = { kind: "api" as const, workspacePath: worktree, taskId: "saved" };
const acpTarget = {
  kind: "acp" as const,
  session: {
    id: "saved",
    agent: "codex" as const,
    workspacePath: worktree,
    title: "Saved",
    status: "idle" as const,
    createdAt: 1,
    updatedAt: 1,
  },
};
function service(tasks: WorkTask[]) {
  return {
    list: async (scope) => {
      assert.deepEqual(scope, { workspacePath: project });
      return { tasks, concurrency: 1 };
    },
  } satisfies Pick<IWorkTaskService, "list">;
}

test("settings selects the owning work task for both API and ACP execution sessions", async () => {
  for (const target of [apiTarget, acpTarget]) {
    assert.deepEqual(
      await resolveWorktreeSettingsConversation(service([boundTask(target.kind)]), project, target),
      {
        kind: "work-task",
        scope: { workspacePath: project },
        id: "work-task",
      },
    );
  }
});

test("settings does not infer task ownership from an id alone or an invisible binding", async () => {
  const mismatches: Partial<WorkTask>[] = [
    { workspacePath: "/tmp/other" },
    { workspaceIdentity: "remote-project" },
    { remoteSessionId: "other-host" },
    { worktree: { path: "/tmp/other" } as WorkTask["worktree"] },
    { session: { kind: "acp", id: "saved" } },
    { session: { kind: "api", id: "other" } },
    { archived: true },
    { status: "canceled" },
  ];
  for (const mismatch of mismatches) {
    assert.equal(
      await resolveWorktreeSettingsConversation(
        service([boundTask("api", mismatch)]),
        project,
        apiTarget,
      ),
      apiTarget,
    );
  }
  const wrongAgent = boundTask("acp", { execution: { kind: "acp", agent: "claude", config: [] } });
  assert.equal(
    await resolveWorktreeSettingsConversation(service([wrongAgent]), project, acpTarget),
    acpTarget,
  );
  assert.equal(
    await resolveWorktreeSettingsConversation(service([boundTask("acp")]), project, {
      ...acpTarget,
      session: { ...acpTarget.session, workspaceIdentity: "remote-project" },
    }).then((target) => target.kind),
    "acp",
  );
});

test("ordinary history and older Hosts retain navigation, but failed ownership reads reject", async () => {
  assert.equal(await resolveWorktreeSettingsConversation(undefined, project, apiTarget), apiTarget);
  assert.equal(
    await resolveWorktreeSettingsConversation(service([]), project, apiTarget),
    apiTarget,
  );
  await assert.rejects(
    resolveWorktreeSettingsConversation(
      {
        list: async () => {
          throw new Error("read failed");
        },
      },
      project,
      apiTarget,
    ),
    /read failed/,
  );
});

test("a local worktree wins path-only navigation over a remote tab with the same path", () => {
  const tabs = createTabStore(null);
  const path = "/tmp/worktrees/abcd/project";
  tabs.getState().addTab(path, {
    workspaceIdentity: "ssh:other-host:/tmp/worktrees/abcd/project",
    remoteSessionId: "remote-session",
  });
  const local = tabs.getState().addTab(path);
  tabs.getState().activateTabByPath(path);
  assert.equal(tabs.getState().activeTabId, local);
  assert.equal(tabs.getState().activeWorkspaceIdentity, null);
});

test("settings navigation intent replays to a newly mounted shell once", () => {
  const target = {
    kind: "api" as const,
    workspacePath: "/tmp/worktrees/abcd/project",
    taskId: "saved",
  };
  requestWorktreeSettingsConversation(target);
  const observed: string[] = [];
  const unsubscribe = listenWorktreeSettingsConversation((item) => {
    if (item.kind === "api") observed.push(item.taskId);
    consumeWorktreeSettingsConversation(item);
  });
  unsubscribe();
  const unsubscribeAgain = listenWorktreeSettingsConversation((item) => {
    if (item.kind === "api") observed.push(item.taskId);
  });
  unsubscribeAgain();
  assert.deepEqual(observed, ["saved"]);
});
