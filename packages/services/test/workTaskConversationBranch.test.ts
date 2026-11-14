import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { WorkTaskWorktreeInspection } from "@zcode/shared";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { createWorkTaskConversationBranchGuard } from "../src/work-task/workTaskConversationBranch.js";

test("bound conversation inputs are admitted only on the accepted worktree branch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-task-conversation-branch-"));
  const repo = new WorkTaskRepo(join(directory, "tasks.sqlite"));
  const allocation = {
    rootPath: "/trees",
    path: "/trees/abcd/project",
    projectPath: "/project",
    branchName: "worktree/abcd",
    baseCommit: "abcdef",
    acceptedBranchName: "feature/accepted",
  };
  const service = new WorkTaskService({
    repo,
    execute: async (task, context) => {
      await context.update({
        worktree: allocation,
        session: { kind: task.execution.kind, id: `session-${task.execution.kind}` },
      });
    },
  });
  let inspection: WorkTaskWorktreeInspection = {
    status: "ready",
    initialBranchName: allocation.branchName,
    acceptedBranchName: allocation.acceptedBranchName,
    currentBranchName: allocation.acceptedBranchName,
  };
  const guard = createWorkTaskConversationBranchGuard(repo, async () => inspection);
  try {
    for (const kind of ["api", "acp"] as const) {
      const task = await service.create({
        workspacePath: "/project",
        title: `Conversation branch guard ${kind}`,
        prompt: "Check branch before input",
        execution:
          kind === "acp"
            ? { kind, agent: "codex", config: [] }
            : {
                kind,
                modelSelection: { providerId: "test", modelId: "model" },
                mode: "build",
              },
      });
      await service.start({ workspacePath: "/project", id: task.id });
      for (
        let i = 0;
        i < 100 && repo.get({ workspacePath: "/project" }, task.id).status !== "review";
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));

      const input = {
        workspacePath: allocation.path,
        kind,
        sessionId: `session-${kind}`,
      };
      await guard(input);
      inspection = { ...inspection, status: "branch-changed", currentBranchName: "feature/other" };
      await assert.rejects(guard(input), /worktree-mismatch/);
      inspection = { ...inspection, status: "invalid-target" };
      await assert.rejects(guard(input), /worktree-mismatch/);
      inspection = {
        ...inspection,
        status: "ready",
        currentBranchName: allocation.acceptedBranchName,
      };
      await guard({ ...input, workspaceIdentity: "remote" });
      await guard({ ...input, workspacePath: "/unbound" });
      assert.equal(repo.boundConversation(allocation.path, kind, `session-${kind}`)?.id, task.id);
    }
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
