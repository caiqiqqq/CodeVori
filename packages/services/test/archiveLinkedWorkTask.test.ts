import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";

test("archive purge guard follows persisted task execution scope and refuses active linked conversations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-archive-worktask-"));
  const repo = new WorkTaskRepo(join(directory, "tasks.sqlite"));
  const project = { workspacePath: "/fixture/project" };
  const execution = { workspacePath: "/fixture/worktrees/one" };
  const session = { kind: "api" as const, id: "session-one" };
  try {
    await repo.ready();
    const task = repo.create({
      ...project,
      title: "fixture",
      prompt: "Build",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "fixture", modelId: "model" },
      },
    });
    repo.enqueue(project, task.id);
    const claimed = repo.claimNext("fixture-owner", Date.now(), 30000)!;
    assert.ok(
      repo.updateRun(claimed, "fixture-owner", {
        session,
        worktree: {
          rootPath: "/fixture/worktrees",
          path: execution.workspacePath,
          projectPath: project.workspacePath,
          branchName: "worktree/one",
          baseCommit: "abcdef",
        },
      }),
    );
    assert.equal(repo.hasActiveConversation(execution, session), true);
    assert.equal(repo.hasActiveConversation(project, session), false);
    assert.equal(
      repo.hasActiveConversation({ ...execution, workspaceIdentity: "remote:other" }, session),
      false,
    );
    assert.equal(repo.hasActiveConversation(execution, { kind: "acp", id: session.id }), false);
    repo.finish(claimed, "fixture-owner");
    assert.equal(repo.hasActiveConversation(execution, session), false);
    assert.ok(repo.get(project, task.id).session, "completed task binding is retained");
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
