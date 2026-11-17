import type { WorkTask, WorkTaskScope, ZCodeTaskMeta } from "@zcode/shared";
import type { AcpSidebarSession } from "./acpSidebarSessions.js";
import { workTaskConversationBinding } from "./workTaskConversation.js";
import { isTaskListRowActive } from "@/v4/taskListRowActivity.js";

type SessionAddress = WorkTaskScope & { id: string; kind: "native" | "acp"; agent?: string };
export function sidebarConversationKey(address: SessionAddress) {
  return JSON.stringify([
    address.workspaceIdentity?.trim() || address.workspacePath,
    address.remoteSessionId?.trim() || "",
    address.kind,
    address.id,
    address.agent ?? "",
  ]);
}

export function workTaskBoundConversationKeys(tasks: readonly WorkTask[]) {
  const keys = new Set<string>();
  for (const task of tasks) {
    for (const merge of [false, true]) {
      const binding = workTaskConversationBinding(task, merge);
      if (!binding) continue;
      // 工作目录相同并不代表同一个会话；只隐藏 Host 已保存的准确绑定，包括合并会话。
      keys.add(
        sidebarConversationKey({
          workspacePath: binding.workspacePath,
          id: binding.sessionId,
          kind: binding.kind === "api" ? "native" : "acp",
          agent: binding.kind === "acp" ? binding.agent : undefined,
        }),
      );
    }
  }
  return keys;
}

export function sidebarWorkTasksForScopes(
  tasks: readonly WorkTask[],
  scopes: readonly WorkTaskScope[],
) {
  return tasks.filter(
    (task) =>
      !task.archived &&
      scopes.some(
        (scope) =>
          (scope.workspaceIdentity?.trim() || scope.workspacePath) ===
            (task.workspaceIdentity?.trim() || task.workspacePath) &&
          (scope.remoteSessionId?.trim() || "") === (task.remoteSessionId?.trim() || ""),
      ),
  );
}

export type SidebarConversationRow = {
  key: string;
  createdAt: number;
  updatedAt: number;
} & (
  | { kind: "native"; item: ZCodeTaskMeta }
  | { kind: "acp"; item: AcpSidebarSession }
  | { kind: "work-task"; item: WorkTask }
);

export function buildSidebarConversationRows(input: {
  native: readonly ZCodeTaskMeta[];
  acp: readonly AcpSidebarSession[];
  workTasks: readonly WorkTask[];
  boundKeys: ReadonlySet<string>;
  sortBy: "manual" | "created" | "updated";
}): SidebarConversationRow[] {
  const rows: SidebarConversationRow[] = [
    ...input.native.map((item) => ({
      kind: "native" as const,
      item,
      key: sidebarConversationKey({ ...item, kind: "native", id: item.taskId }),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    ...input.acp.map((item) => ({
      kind: "acp" as const,
      item,
      key: sidebarConversationKey({ ...item, kind: "acp" }),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    ...input.workTasks
      .filter((task) => !task.archived)
      .map((item) => ({
        kind: "work-task" as const,
        item,
        key: JSON.stringify([
          item.workspaceIdentity?.trim() || item.workspacePath,
          item.remoteSessionId ?? "",
          "work-task",
          item.id,
        ]),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
  ];
  const visible = rows.filter((row) => row.kind === "work-task" || !input.boundKeys.has(row.key));
  const running = (row: SidebarConversationRow) =>
    row.kind === "native"
      ? isTaskListRowActive(row.item)
      : row.kind === "acp"
        ? row.item.status === "running"
        : ["preparing", "running", "awaiting_input"].includes(row.item.status);
  const compareTime = (a: SidebarConversationRow, b: SidebarConversationRow) => {
    const aRunning = running(a),
      bRunning = running(b);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    const id = (row: SidebarConversationRow) =>
      row.kind === "native" ? row.item.taskId : row.item.id;
    const stableOrder = () => id(b).localeCompare(id(a)) || a.key.localeCompare(b.key);
    if (aRunning) return b.createdAt - a.createdAt || stableOrder();
    const field = input.sortBy === "created" ? "createdAt" : "updatedAt";
    const secondary = field === "createdAt" ? "updatedAt" : "createdAt";
    return b[field] - a[field] || b[secondary] - a[secondary] || stableOrder();
  };
  // 手工分组／排序不能因新增待办而改写原生会话顺序；其余条目追加到同一根列表。
  return input.sortBy === "manual"
    ? [
        ...visible.filter((row) => row.kind === "native"),
        ...visible.filter((row) => row.kind !== "native").sort(compareTime),
      ]
    : visible.sort(compareTime);
}
