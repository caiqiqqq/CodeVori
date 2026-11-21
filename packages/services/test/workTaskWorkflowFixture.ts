import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uuidv7, type WorkTask, type WorkTaskWorkflow } from "@zcode/shared";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";

export const scope = { workspacePath: "/workflow-project" };
export const draft = {
  ...scope,
  title: "Feature",
  prompt: "Implement feature",
  execution: {
    kind: "api" as const,
    modelSelection: { providerId: "test", modelId: "model" },
    mode: "build" as const,
  },
};
export const definition = (): WorkTaskWorkflow => ({
  id: uuidv7(),
  name: "Delivery",
  stages: [
    {
      id: "build",
      name: "Build",
      owner: "Developer",
      instructions: "Implement only",
      nextStageId: "review",
    },
    {
      id: "review",
      name: "Review",
      owner: "Reviewer",
      instructions: "Verify tests",
      returnStageId: "build",
      execution: { kind: "acp", agent: "codex", config: [] },
    },
  ],
});
export const worktree = {
  rootPath: "/trees",
  path: "/trees/task/project",
  projectPath: scope.workspacePath,
  branchName: "worktree/task",
  baseCommit: "abc123",
};

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-task-workflow-"));
  const path = join(directory, "tasks.sqlite");
  const repo = new WorkTaskRepo(path);
  await repo.ready();
  return {
    repo,
    path,
    cleanup: async () => {
      repo.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function bindWorkflow(repo: WorkTaskRepo, workflow = definition()) {
  repo.saveWorkflowDefinition({ workflow, expectedRevision: 0 });
  return repo.saveWorkflow({ ...scope, workflowId: workflow.id, expectedRevision: 0 });
}

export function finishStage(repo: WorkTaskRepo, task: WorkTask, owner = "host-a") {
  const claimed = repo.claimNext(owner, Date.now(), 30_000)!;
  assert.equal(claimed.id, task.id);
  assert.ok(
    repo.updateRun(claimed, owner, {
      session: { kind: claimed.execution.kind, id: `session-${claimed.runSeq}` },
      worktree,
    }),
  );
  repo.finish(claimed, owner);
  return repo.get(scope, task.id);
}
