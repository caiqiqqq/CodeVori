import assert from "node:assert/strict";
import test from "node:test";
import type { DelegationTask } from "@zcode/shared";
import {
  buildConversationStatusPanelModel,
  resolveSoleRunningWorkflowRunTarget,
} from "../src/v4/conversationStatusPanelModel.js";

const task = (status: DelegationTask["status"], id: string) =>
  ({ id, title: id, status, createdAt: 100 }) as DelegationTask;

test("API and ACP delegation activity joins native Agents without changing native ownership", () => {
  const tasks = [
    task("queued", "queued"),
    task("preparing", "preparing"),
    task("running", "running"),
    task("awaiting_input", "waiting"),
    task("completed", "done"),
    task("failed", "failed"),
    task("interrupted", "interrupted"),
    task("canceled", "canceled"),
  ];
  const model = buildConversationStatusPanelModel({
    delegationTasks: tasks,
    runningSubagents: [
      {
        agentId: "native",
        childSessionId: "native-child",
        subagentType: "Explore",
        title: "native task",
        status: "running",
        startedAt: 90,
      },
    ],
  });
  assert.deepEqual(
    model.runningDelegationTasks.map((item) => item.id),
    ["queued", "preparing", "running", "waiting"],
  );
  assert.equal(model.runningSubagentWorks.length, 1);
  assert.equal(model.hasContent, true);
  assert.equal(model.hasExpandedContent, true);
  assert.equal(resolveSoleRunningWorkflowRunTarget(model), null);
  assert.equal(tasks.length, 8, "the panel does not mutate the service list");
});

test("only completed delegation history does not keep a running status panel", () => {
  const model = buildConversationStatusPanelModel({ delegationTasks: [task("completed", "done")] });
  assert.deepEqual(model.runningDelegationTasks, []);
  assert.equal(model.hasContent, false);
});
