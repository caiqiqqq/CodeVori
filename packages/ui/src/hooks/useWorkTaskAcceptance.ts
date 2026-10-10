import { useEffect, useMemo, useState } from "react";
import type { WorkTask } from "@zcode/shared";
import { useWorkspaceServicesResolution } from "./useWorkspaceServices.js";

type Assessment = "loading" | "empty" | "changed" | "unknown" | "unavailable";

/** A read-only recommendation, never authoritative task state or command admission. */
export function useWorkTaskAcceptance(task: WorkTask, enabled: boolean): Assessment {
  const { services, rpcReady } = useWorkspaceServicesResolution(
    task.workspacePath,
    task.remoteSessionId,
    task.workspaceIdentity,
    undefined,
    true,
  );
  const git = services.gitService;
  const path = task.worktree?.path;
  const branch = task.worktree?.branchName;
  const baseCommit = task.worktree?.baseCommit;
  const owner = useMemo(
    () => ({}),
    [
      git,
      rpcReady,
      enabled,
      task.id,
      task.runSeq,
      task.workspacePath,
      task.workspaceIdentity,
      task.remoteSessionId,
      path,
      branch,
      baseCommit,
    ],
  );
  const [read, setRead] = useState<{ owner: object; value: Assessment }>({
    owner,
    value: "loading",
  });
  useEffect(() => {
    if (!enabled || !path || !branch || !baseCommit) return;
    let alive = true;
    const inspect = async (): Promise<Assessment> => {
      if (!rpcReady) return "unknown";
      const [summary, staged, unstaged, head] = await Promise.allSettled([
        git.getRepositorySummary({ workspacePath: path }),
        git.getChanges({ workspacePath: path, sourceId: "staged" }),
        git.getChanges({ workspacePath: path, sourceId: "unstaged" }),
        git.resolveLocalBranch({ workspacePath: path, branchName: branch }),
      ]);
      if (summary.status === "fulfilled" && !summary.value.isRepository) return "unavailable";
      if (
        summary.status !== "fulfilled" ||
        staged.status !== "fulfilled" ||
        unstaged.status !== "fulfilled" ||
        head.status !== "fulfilled" ||
        !summary.value.isGitAvailable ||
        summary.value.branchName !== branch ||
        head.value.branchName !== branch
      )
        return "unknown";
      // 修复依据：干净工作树仍可能已有提交，不能仅凭 staged/unstaged 为空就推荐丢开合并。
      return !summary.value.isDirty &&
        !staged.value.length &&
        !unstaged.value.length &&
        head.value.commitHash === baseCommit
        ? "empty"
        : "changed";
    };
    void inspect().then(
      (value) => {
        if (alive) setRead({ owner, value });
      },
      () => {
        if (alive) setRead({ owner, value: "unknown" });
      },
    );
    return () => {
      alive = false;
    };
  }, [git, rpcReady, enabled, path, branch, baseCommit, owner]);
  if (!enabled) return "empty";
  if (!path || !branch || !baseCommit) return "unknown";
  return read.owner === owner ? read.value : "loading";
}
