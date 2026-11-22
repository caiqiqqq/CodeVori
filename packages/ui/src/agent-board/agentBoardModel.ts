import {
  ACP_AGENT_CATALOG,
  isWorkTaskMerging,
  isWorkTaskForgePending,
  type WorkTask,
  type ConversationWorkflowState,
} from "@zcode/shared";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export const BOARD_STATUSES = [
  "todo",
  "running",
  "waiting",
  "review",
  "idle",
  "error",
  "completed",
] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_DISPLAY_STATUSES = ["running", "completed", "staged", "error"] as const;
export type BoardDisplayStatus = (typeof BOARD_DISPLAY_STATUSES)[number];
export const BOARD_WORKFLOW_STATUS_CATEGORIES = ["unstarted", "started", "done", "closed"] as const;
export type BoardWorkflowStatusCategory = (typeof BOARD_WORKFLOW_STATUS_CATEGORIES)[number];
export type BoardWorkflowStatus = {
  id: string;
  label: string;
  enabled: boolean;
  category: BoardWorkflowStatusCategory;
};
export const DEFAULT_BOARD_WORKFLOW_STATUSES: readonly BoardWorkflowStatus[] = [
  { id: "todo", label: "待办", enabled: true, category: "unstarted" },
  { id: "in-progress", label: "进行中", enabled: true, category: "started" },
  { id: "review", label: "审核中", enabled: true, category: "started" },
  { id: "blocked", label: "已阻塞", enabled: true, category: "started" },
  { id: "completed", label: "已完成", enabled: true, category: "done" },
  { id: "canceled", label: "已取消", enabled: true, category: "closed" },
];
export function resolveBoardWorkflowStatusCategory(
  id: string,
  category: unknown,
): BoardWorkflowStatusCategory | undefined {
  if (category === undefined)
    return (
      DEFAULT_BOARD_WORKFLOW_STATUSES.find((status) => status.id === id)?.category ?? "started"
    );
  return BOARD_WORKFLOW_STATUS_CATEGORIES.includes(category as BoardWorkflowStatusCategory)
    ? (category as BoardWorkflowStatusCategory)
    : undefined;
}
export type BoardView =
  | "all"
  | "active"
  | "completed"
  | "failed"
  | "staged"
  | "attention"
  | "archived";
export type BoardProject = { key: string; label: string; tabs: WorkspaceTabState[] };
export type BoardTracking = {
  mode: "all" | "custom";
  projects: string[];
  standalone: boolean;
  workTasks: boolean;
  includedItems: string[];
  excludedItems: string[];
};
export const defaultBoardTracking: BoardTracking = {
  mode: "all",
  projects: [],
  standalone: false,
  workTasks: false,
  includedItems: [],
  excludedItems: [],
};
export type BoardTrackingTarget = Pick<
  BoardItem,
  "key" | "projectKey" | "workspacePurpose" | "kind"
>;
export function matchesBoardTracking(item: BoardTrackingTarget, tracking: BoardTracking) {
  if (tracking.mode === "all") return true;
  if (tracking.excludedItems.includes(item.key)) return false;
  return (
    tracking.includedItems.includes(item.key) ||
    (item.workspacePurpose === "conversation"
      ? tracking.standalone
      : tracking.projects.includes(item.projectKey)) ||
    // 旧待办跟踪开关保留读取兼容；新的项目选择对全部任务生效。
    (item.kind === "work-task" && tracking.workTasks)
  );
}
export type BoardItem = {
  key: string;
  projectKey: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspaceTabState["workspacePurpose"];
  remoteSessionId?: string;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  unread?: boolean;
  agent: string;
  status: BoardStatus;
  archived: boolean;
  online: boolean;
  staged?: boolean;
  summary?: string;
} & (
  | {
      kind: "native";
      task: WindowHostControllerTaskListItem;
      conversationWorkflow?: ConversationWorkflowState;
    }
  | { kind: "acp"; session: AcpSidebarSession; conversationWorkflow?: ConversationWorkflowState }
  | { kind: "work-task"; workTask: WorkTask }
);
export const boardWorkspaceKey = (scope: { workspacePath: string; workspaceIdentity?: string }) =>
  scope.workspaceIdentity?.trim() || scope.workspacePath;
export function boardAgentLabel(item: BoardItem) {
  const agent =
    item.kind === "acp"
      ? item.session.agent
      : item.kind === "work-task" && item.workTask.execution.kind === "acp"
        ? item.workTask.execution.agent
        : undefined;
  // 同一 Agent 的会话和待办原先使用两套名称；只统一展示，保留原筛选标识。
  return agent
    ? (ACP_AGENT_CATALOG.find((entry) => entry.id === agent)?.name ?? agent).replace(/\s+ACP$/i, "")
    : item.agent;
}
export function boardWorkflowStageLabel(item: BoardItem): string | undefined {
  const workflow = item.kind === "work-task" ? item.workTask.workflow : item.conversationWorkflow;
  return workflow?.definition.stages.find((stage) => stage.id === workflow.currentStageId)?.name;
}
export const boardEntityKey = (
  scope: { workspacePath: string; workspaceIdentity?: string },
  kind: BoardItem["kind"],
  id: string,
) => JSON.stringify([boardWorkspaceKey(scope), kind, id]);
export function nativeBoardStatus(
  task: Partial<Pick<WindowHostControllerTaskListItem, "liveStatus" | "pendingInteraction">> & {
    activity?: Pick<
      NonNullable<WindowHostControllerTaskListItem["activity"]>,
      "phase" | "hasBackgroundWork" | "pendingInteractions"
    > | null;
    status?: string;
  },
): BoardStatus {
  const activity = task.activity;
  if (
    task.liveStatus === "waiting" ||
    task.pendingInteraction ||
    (activity?.pendingInteractions &&
      activity.pendingInteractions.permissionCount + activity.pendingInteractions.userInputCount >
        0)
  )
    return "waiting";
  if (
    activity?.phase === "running" ||
    activity?.phase === "prewarming" ||
    activity?.hasBackgroundWork ||
    task.liveStatus === "running"
  )
    return "running";
  // 主动中断的 liveStatus 也可能是 completed，需读原始 phase，避免又被归入进行中。
  return task.liveStatus === "error" ||
    (!activity && !task.liveStatus && task.status === "error") ||
    activity?.phase === "error" ||
    activity?.phase === "completedInterrupted"
    ? "error"
    : "completed";
}
export function acpBoardStatus(session: AcpSidebarSession): BoardStatus {
  if (session.waiting) return "waiting";
  if (session.status === "running") return "running";
  // failed 仅表示带错误的中断；用户停止时没有 error，也不能继续显示进行中。
  return session.status === "interrupted" || session.failed ? "error" : "completed";
}
export function workTaskBoardStatus(task: WorkTask): BoardStatus {
  // 待办完成以原任务生命周期为准，不能用会话确认水位代替验收。
  if (task.status === "awaiting_input") return "waiting";
  if (isWorkTaskMerging(task)) return "running";
  if (task.status === "done" && isWorkTaskForgePending(task)) return "review";
  switch (task.status) {
    case "todo":
    case "queued":
      return "todo";
    case "preparing":
    case "running":
      return "running";
    case "review":
      return "review";
    case "failed":
      return "error";
    case "done":
      return "completed";
    case "canceled":
      return "idle";
  }
}
export type BoardTaskState = Pick<
  BoardItem,
  "key" | "status" | "updatedAt" | "archived" | "staged"
> &
  ({ kind: "native" | "acp" } | { kind: "work-task"; workTask: WorkTask });
function boardOutcomeStatus(item: BoardTaskState): Exclude<BoardDisplayStatus, "staged"> {
  // 正常执行结束即完成；待办 review 只保留原验收操作，不再把结束的会话显示为进行中。
  if (item.status === "completed" || (item.kind === "work-task" && item.status === "review"))
    return "completed";
  if (item.status === "error" || (item.kind === "work-task" && item.workTask.status === "canceled"))
    return "error";
  return "running";
}
export type BoardStagedItems = Record<
  string,
  { updatedAt: number; outcome: "completed" | "error" }
>;
export function canStageBoardItem(item: BoardTaskState) {
  return !item.archived && boardOutcomeStatus(item) !== "running";
}
export function isBoardItemStaged(item: BoardTaskState, stagedItems: BoardStagedItems) {
  const marker = stagedItems[item.key];
  return Boolean(
    marker &&
    canStageBoardItem(item) &&
    item.updatedAt <= marker.updatedAt &&
    boardOutcomeStatus(item) === marker.outcome,
  );
}
export function boardDisplayStatus(item: BoardTaskState): BoardDisplayStatus {
  return item.staged && canStageBoardItem(item) ? "staged" : boardOutcomeStatus(item);
}
export function defaultWorkflowStatusId(item: BoardItem) {
  if (item.kind === "work-task" && item.workTask.status === "canceled") return "canceled";
  if (item.status === "todo") return "todo";
  if (item.status === "review") return "review";
  if (item.status === "error") return "blocked";
  if (item.status === "completed") return "completed";
  return "in-progress";
}
export function boardStatusIndicator(item: BoardTaskState): BoardDisplayStatus | "waiting" {
  const status = boardDisplayStatus(item);
  // 分组会将等待合并到进行中；卡片需保留等待事实，避免把排队或等用户操作误标为正在执行。
  return status === "running" &&
    (item.status === "waiting" || (item.kind === "work-task" && item.status === "todo"))
    ? "waiting"
    : status;
}
export function matchesBoardView(item: BoardItem, view: BoardView) {
  if (view === "archived") return item.archived;
  if (item.archived) return false;
  if (view === "active") return boardDisplayStatus(item) === "running";
  if (view === "completed") return boardDisplayStatus(item) === "completed";
  if (view === "failed") return boardDisplayStatus(item) === "error";
  if (view === "staged") return boardDisplayStatus(item) === "staged";
  if (view === "attention")
    return item.status === "waiting" || item.status === "review" || item.status === "error";
  return true;
}

export function boardResultTimestamp(item: BoardItem) {
  return boardOutcomeStatus(item) === "running"
    ? item.updatedAt
    : (item.completedAt ?? item.updatedAt);
}
export function compareBoardItems(a: BoardItem, b: BoardItem) {
  // 运行时 updatedAt 随正文和工具推进，会让并行卡片反复换位；仅终态使用结果时间。
  const time = (item: BoardItem) =>
    boardOutcomeStatus(item) === "running" ? (item.startedAt ?? 0) : boardResultTimestamp(item);
  return time(b) - time(a) || a.key.localeCompare(b.key);
}
export function workTaskResultToken(task: WorkTask) {
  return JSON.stringify([task.runSeq, task.finishedAt ?? null]);
}
export function boardHasUnreadResult(item: BoardItem, readWorkTaskResults: Record<string, string>) {
  if (item.archived || boardOutcomeStatus(item) === "running") return false;
  if (item.kind === "work-task")
    return readWorkTaskResults[item.key] !== workTaskResultToken(item.workTask);
  const unreadAt = item.kind === "native" ? item.task.unreadAt : item.session.unreadAt;
  return typeof unreadAt === "number" && unreadAt > 0;
}
