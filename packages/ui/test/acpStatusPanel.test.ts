import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, type GitRepositorySummary } from "@zcode/shared";
import { goalStateSchema, workflowRunsStateSchema } from "@zcode/shared/zcode-protocol-v4";
import { projectAcpStatusPanel } from "../src/v4/acpStatusPanel.js";
import { buildConversationStatusPanelModel } from "../src/v4/conversationStatusPanelModel.js";

const session = (entries: unknown[] = []) =>
  acpSessionSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    agent: "codex",
    workspacePath: "/fixture",
    title: "fixture",
    revision: 1,
    status: "idle",
    entries,
    goal: "reported objective",
    acpSessionId: "native-fixture",
    pendingPermission: null,
    error: null,
  });

test("ACP terminal panel uses exact live terminal and current execute tool facts only", () => {
  const snapshot = session([
    { id: "old", kind: "tool", title: "old service", toolKind: "execute", status: "in_progress" },
    { id: "user:new", kind: "user", text: "new" },
    {
      id: "command",
      kind: "tool",
      title: "npm run dev",
      toolKind: "execute",
      status: "in_progress",
      createdAt: 10,
    },
    {
      id: "linked",
      kind: "tool",
      title: "managed",
      toolKind: "execute",
      status: "in_progress",
      terminalIds: ["managed"],
      createdAt: 11,
    },
    { id: "pending", kind: "tool", title: "pending", toolKind: "execute", status: "pending" },
    { id: "unknown", kind: "tool", title: "unknown", status: "in_progress" },
  ]);
  snapshot.status = "running";
  snapshot.terminals = [
    {
      terminalId: "managed",
      title: "node server",
      status: "running",
      startedAt: 5,
      output: "ready",
      truncated: false,
    },
  ];
  const projected = projectAcpStatusPanel(snapshot);
  const model = buildConversationStatusPanelModel(projected);
  assert.deepEqual(
    model.runningBashWorks.map((w) => [w.workId, w.cancellable]),
    [
      ["acp-terminal:managed", true],
      ["acp-tool:command", false],
    ],
  );
  assert.deepEqual(projectAcpStatusPanel(structuredClone(snapshot)), projected);
  snapshot.status = "idle";
  assert.equal(
    projectAcpStatusPanel(snapshot).backgroundWorks.length,
    1,
    "real terminal outlives a prompt",
  );
  snapshot.terminals[0]!.status = "finished";
  assert.deepEqual(projectAcpStatusPanel(snapshot).backgroundWorks, []);
  assert.deepEqual(projectAcpStatusPanel(null).backgroundWorks, []);
});

test("ACP panel projects current turn plan and objective without native goal semantics", () => {
  const snapshot = session([
    { id: "user:first", kind: "user", text: "first" },
    {
      id: "plan:first",
      kind: "plan",
      createdAt: 10,
      entries: [
        { content: "read", status: "completed", priority: "high" },
        { content: "check", status: "in_progress", priority: "medium" },
      ],
    },
  ]);
  const before = structuredClone(snapshot);
  const projected = projectAcpStatusPanel(snapshot);
  assert.equal(projected.reportedGoal, "reported objective");
  assert.deepEqual(projected.plan, {
    updatedAt: 10,
    items: [
      { id: "plan:first:0", content: "read", status: "completed" },
      { id: "plan:first:1", content: "check", status: "inProgress" },
    ],
  });
  const model = buildConversationStatusPanelModel(projected);
  assert.equal(model.goal, null);
  assert.equal(model.reportedGoal, "reported objective");
  assert.equal(model.plan?.completedCount, 1);
  assert.deepEqual(model.runningBashWorks, []);
  assert.deepEqual(model.runningSubagentWorks, []);
  assert.deepEqual(snapshot, before);
});

test("empty plan, next turn, missing snapshot and replay cannot retain another turn plan", () => {
  const snapshot = session([
    { id: "user:first", kind: "user", text: "first" },
    {
      id: "plan:first",
      kind: "plan",
      entries: [{ content: "old", status: "pending", priority: "low" }],
    },
    { id: "user:second", kind: "user", text: "second" },
  ]);
  assert.equal(projectAcpStatusPanel(snapshot).plan, null);
  snapshot.entries.push({ id: "plan:second", kind: "plan", entries: [] });
  assert.equal(projectAcpStatusPanel(snapshot).plan, null);
  assert.deepEqual(
    projectAcpStatusPanel(snapshot),
    projectAcpStatusPanel(structuredClone(snapshot)),
  );
  assert.equal(projectAcpStatusPanel(null).reportedGoal, null);
  assert.equal(projectAcpStatusPanel(null).plan, null);
});

test("latest ACP plan replaces the current turn plan and goal clears from Host facts", () => {
  const snapshot = session([
    { id: "user:first", kind: "user", text: "first" },
    {
      id: "plan:first",
      kind: "plan",
      entries: [{ content: "old", status: "pending", priority: "low" }],
    },
    {
      id: "plan:update",
      kind: "plan",
      entries: [{ content: "latest", status: "completed", priority: "low" }],
    },
  ]);
  assert.equal(projectAcpStatusPanel(snapshot).plan?.items[0]?.content, "latest");
  snapshot.goal = "  ";
  assert.equal(projectAcpStatusPanel(snapshot).reportedGoal, null);
  snapshot.entries.push({ id: "plan:clear", kind: "plan", entries: [] });
  assert.equal(projectAcpStatusPanel(snapshot).plan, null);
});

test("API goal and plan retain their native facts without an ACP reported objective", () => {
  const goal = goalStateSchema.parse({
    objective: "API target",
    status: "paused",
    iteration: 2,
    verifications: [],
  });
  const plan = {
    updatedAt: 1,
    items: [{ id: "native", content: "API step", status: "pending" as const }],
  };
  const model = buildConversationStatusPanelModel({ goal, plan });
  assert.equal(model.goal, goal);
  assert.equal(model.reportedGoal, null);
  assert.equal(model.plan?.items, plan.items);
  assert.equal(model.hasContent, true);
});

test("ACP workflows use the selected Host report without native task controls", () => {
  const snapshot = session();
  snapshot.workflowRuns = workflowRunsStateSchema.parse({
    revision: 1,
    runs: [
      {
        runId: "reported-run",
        status: "running",
        lastEventSequence: 1,
        usage: { spentTokens: 0, nodesUsed: 0 },
        actors: [],
        nodes: [],
      },
    ],
  });
  const projected = projectAcpStatusPanel(snapshot);
  const model = buildConversationStatusPanelModel(projected);
  assert.equal(projected.workflowRuns, snapshot.workflowRuns.runs);
  assert.equal(model.runningWorkflowRuns[0]?.runId, "reported-run");
  assert.equal(model.runningWorkflowRuns[0]?.cancellable, undefined);
  assert.deepEqual(model.runningBashWorks, []);
  assert.deepEqual(model.runningSubagentWorks, []);
  assert.equal(projectAcpStatusPanel(session()).workflowRuns, undefined);
});

test("Git model retains API dirty/clean and Office rules with reported ACP goal", () => {
  const gitSummary: GitRepositorySummary = {
    workspacePath: "/fixture",
    repoRoot: "/fixture",
    workspaceInRepoPath: ".",
    autoRefreshWatchPaths: [],
    trackingBranchName: null,
    isGitAvailable: true,
    isRepository: true,
    branchName: "fixture",
    headRefType: "branch",
    isDirty: true,
    ahead: 0,
    behind: 0,
  };
  const input = {
    gitSummary,
    gitWorktreeChangeSummary: { added: 2, removed: 1 },
  };
  assert.equal(buildConversationStatusPanelModel(input).git?.branchName, "fixture");
  assert.equal(
    buildConversationStatusPanelModel({
      ...input,
      gitWorktreeChangeSummary: { added: 0, removed: 0 },
    }).hasContent,
    false,
  );
  assert.equal(buildConversationStatusPanelModel({ ...input, isOfficeMode: true }).git, null);
  assert.equal(
    buildConversationStatusPanelModel({
      ...input,
      gitSummary: { ...gitSummary, isRepository: false },
    }).git,
    null,
  );
});
