import type { WindowHostControllerTaskListItem } from "@zcode/services";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export const BOARD_STATUSES = ["running", "waiting", "idle", "error", "completed"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type BoardView = "all" | "active" | "attention" | "starred" | "archived";
export type BoardProject = { key: string; label: string; tabs: WorkspaceTabState[] };
export type BoardItem = {
  key: string;
  projectKey: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  updatedAt: number;
  agent: string;
  status: BoardStatus;
  pinned: boolean;
  archived: boolean;
  online: boolean;
  summary?: string;
} & (
  | { kind: "native"; task: WindowHostControllerTaskListItem }
  | { kind: "acp"; session: AcpSidebarSession }
);
export const boardWorkspaceKey = (scope: { workspacePath: string; workspaceIdentity?: string }) =>
  scope.workspaceIdentity?.trim() || scope.workspacePath;
export const boardEntityKey = (
  scope: { workspacePath: string; workspaceIdentity?: string },
  kind: BoardItem["kind"],
  id: string,
) => JSON.stringify([boardWorkspaceKey(scope), kind, id]);
function reviewed(updatedAt: number, marker: number | undefined) {
  return marker !== undefined && updatedAt <= marker;
}
export function nativeBoardStatus(task: WindowHostControllerTaskListItem): BoardStatus {
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
  if (reviewed(task.updatedAt, task.boardCompletedAt)) return "completed";
  return task.liveStatus === "error" || activity?.phase === "error" ? "error" : "idle";
}
export function acpBoardStatus(session: AcpSidebarSession): BoardStatus {
  if (session.waiting) return "waiting";
  if (session.status === "running") return "running";
  if (reviewed(session.updatedAt, session.boardCompletedAt)) return "completed";
  return session.failed ? "error" : "idle";
}
export function matchesBoardView(item: BoardItem, view: BoardView) {
  if (view === "archived") return item.archived;
  if (item.archived) return false;
  if (view === "active") return item.status !== "completed";
  if (view === "attention") return item.status === "waiting" || item.status === "error";
  return view !== "starred" || item.pinned;
}
