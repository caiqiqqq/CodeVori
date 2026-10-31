import { useCallback, useState } from "react";
import type { WorkTaskScope } from "@zcode/shared";
import type { WorkTaskWorkspaceToolTarget } from "@/lib/workTaskWorkspaceTools.js";

export function useWorkTaskWorkspaceTools(
  scope: WorkTaskScope,
  enabled: boolean,
  viewKey = "work-tasks",
) {
  // 看板和待办复用同一投影通道，但跨视图的旧清理不能撤销新目标。
  const sourceKey = JSON.stringify([
    viewKey,
    scope.workspaceIdentity?.trim() || scope.workspacePath,
    scope.remoteSessionId ?? "",
  ]);
  const [projection, setProjection] = useState<{
    sourceKey: string;
    target: WorkTaskWorkspaceToolTarget;
  } | null>(null);
  const onTargetChange = useCallback(
    (target: WorkTaskWorkspaceToolTarget | null) => {
      setProjection((previous) => {
        // 旧工作区卸载后的清理只撤销自己的投影，不能关闭新工作区工具。
        if (!target) return previous?.sourceKey === sourceKey ? null : previous;
        const current = previous?.sourceKey === sourceKey ? previous.target : null;
        if (
          current?.taskId === target.taskId &&
          current.workspacePath === target.workspacePath &&
          current.workspaceIdentity === target.workspaceIdentity &&
          current.remoteSessionId === target.remoteSessionId &&
          current.nativeSessionId === target.nativeSessionId &&
          current.sidePaneOwnerId === target.sidePaneOwnerId
        )
          return previous;
        return { sourceKey, target };
      });
    },
    [sourceKey],
  );
  return {
    target: enabled && projection?.sourceKey === sourceKey ? projection.target : null,
    onTargetChange,
  };
}
