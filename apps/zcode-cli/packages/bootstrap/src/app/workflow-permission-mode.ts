import type { CollaborationMode } from "@zcode/contracts";

/** 子工作流可自动运行，但不能把用户选择的危险命令确认降级成完全放行。 */
export function workflowPermissionMode(parentMode: CollaborationMode): "guarded" | "yolo" {
  return parentMode === "guarded" ? "guarded" : "yolo";
}
