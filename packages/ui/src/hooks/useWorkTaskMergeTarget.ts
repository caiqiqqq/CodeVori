import { useState } from "react";
import type { WorkTask } from "@zcode/shared";
import { useWorkTaskBranches } from "./useWorkTaskBranches.js";

/** Shared target selection; each mounted surface owns only its unsent draft. */
export function useWorkTaskMergeTarget(task: WorkTask, enabled: boolean) {
  const branches = useWorkTaskBranches(
    { ...task, workspacePath: task.worktree?.projectPath ?? task.workspacePath },
    enabled,
  );
  const [selection, setSelection] = useState<string | null>(null);
  const target =
    selection ?? task.merge?.targetBranch ?? task.sourceBranch ?? branches.currentBranch;
  const options = branches.branches.filter((branch) => branch.name !== task.worktree?.branchName);
  return {
    ...branches,
    target,
    options,
    select: (value: string | undefined) => setSelection(value ?? null),
    valid: !branches.loading && !branches.error && options.some((branch) => branch.name === target),
  };
}
