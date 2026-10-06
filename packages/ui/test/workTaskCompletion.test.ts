import assert from "node:assert/strict";
import { test } from "node:test";
import { workTaskSchema, workTaskStatusSchema, type WorkTaskMerge } from "@zcode/shared";
import { canCompleteWorkTask } from "../src/lib/workTaskBoard.js";

const task = workTaskSchema.parse({
  workspacePath: "/synthetic/project",
  id: "review-task",
  title: "Review result",
  prompt: "Implement a task",
  execution: { kind: "acp", agent: "codex", config: [] },
  status: "review",
  archived: false,
  stopPending: false,
  runSeq: 1,
  runText: "Implement a task",
  commandId: "command",
  sessionRequestId: "00000000-0000-4000-8000-000000000001",
  createdAt: 1,
  updatedAt: 1,
});

test("completion is available only for unarchived, settled review tasks", () => {
  for (const status of workTaskStatusSchema.options)
    assert.equal(canCompleteWorkTask({ ...task, status }), status === "review", status);
  assert.equal(canCompleteWorkTask({ ...task, archived: true }), false);
  assert.equal(canCompleteWorkTask({ ...task, stopPending: true }), false);
});

test("API, ACP and review tasks without a conversation share completion rules", () => {
  assert.equal(canCompleteWorkTask(task), true);
  assert.equal(
    canCompleteWorkTask({
      ...task,
      execution: {
        kind: "api",
        modelSelection: { providerId: "synthetic", modelId: "model" },
        mode: "build",
      },
    }),
    true,
  );
});

test("ordinary completion never bypasses an active merge", () => {
  const phases: WorkTaskMerge["phase"][] = [
    "queued",
    "preparing",
    "resolving",
    "awaiting_input",
    "applying",
    "merged",
    "failed",
    "canceled",
  ];
  for (const phase of phases)
    assert.equal(
      canCompleteWorkTask({
        ...task,
        merge: {
          id: "00000000-0000-4000-8000-000000000002",
          projectPath: task.workspacePath,
          targetBranch: "main",
          phase,
        },
      }),
      ["merged", "failed", "canceled"].includes(phase),
      phase,
    );
});
