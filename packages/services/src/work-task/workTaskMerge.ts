import { randomBytes } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import type { WorkTask, WorkTaskMerge } from "@zcode/shared";
import type { WorkTaskMergePort } from "../session/contract.js";
import { createWorkTaskExecution, executeWorkTaskConversation } from "./workTaskExecution.js";
import { commitWorkTaskExecution } from "./workTaskExecutionState.js";
import { prepareWorkTaskWorktree } from "./workTaskWorktree.js";
import { assertWorkTaskSourceIdle } from "./workTaskConversationAdmission.js";

type Dependencies = Parameters<typeof createWorkTaskExecution>[0];

export function createWorkTaskMerge(deps: Dependencies): WorkTaskMergePort {
  return {
    async validate(task, targetBranch) {
      if (!task.worktree || task.worktree.branchName === targetBranch)
        throw new Error("work-task.merge-invalid-target");
      await deps.git.resolveLocalBranch({
        workspacePath: task.worktree.projectPath,
        branchName: targetBranch,
      });
      return { projectPath: await realpath(task.worktree.projectPath) };
    },
    async execute(task, context) {
      if (!task.merge) throw new Error("work-task.merge-incomplete");
      const source = await prepareWorkTaskWorktree(deps, task, context);
      await assertWorkTaskSourceIdle(deps, task, context.signal);
      let merge: WorkTaskMerge = { ...task.merge, phase: "preparing" };
      const save = async (
        patch: Partial<WorkTaskMerge>,
        status: "running" | "awaiting_input" = "running",
      ) => {
        const next = { ...merge, ...patch };
        await commitWorkTaskExecution(context, { merge: next, status });
        merge = next;
      };
      await save({});
      const target = await deps.git.resolveLocalBranch({
        workspacePath: source.projectPath,
        branchName: merge.targetBranch,
      });
      for (let attempt = 0; attempt < 16; attempt++) {
        const token = randomBytes(4).toString("hex");
        const directory = join(source.rootPath, token);
        try {
          await lstat(directory);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await save({
          targetCommit: target.commitHash,
          worktree: {
            rootPath: source.rootPath,
            path: join(directory, basename(source.projectPath)),
            projectPath: source.projectPath,
            branchName: `merge/${token}`,
            baseCommit: target.commitHash,
          },
        });
        break;
      }
      if (!merge.worktree) throw new Error("work-task.worktree-allocation-failed");
      const request = {
        workspacePath: source.projectPath,
        taskWorktreePath: source.path,
        taskBranchName: source.branchName,
        targetBranchName: merge.targetBranch,
        worktreePath: merge.worktree.path,
        branchName: merge.worktree.branchName,
        expectedTargetCommit: target.commitHash,
        commitMessage: task.title,
      };
      await commitWorkTaskExecution(context, {});
      const prepared = await deps.git.prepareTaskMerge(request);
      await save(prepared);
      if (prepared.conflicts.length) {
        await save({ phase: "resolving" });
        const resolver: WorkTask = {
          ...task,
          worktree: merge.worktree,
          session: undefined,
          sessionRequestId: merge.id,
          runUsesPromptAssets: false,
          attachments: [],
          workspaceFiles: [],
          runText: [
            "Resolve the Git merge conflicts in this isolated integration worktree.",
            `Task: ${task.title}`,
            `Task instructions:\n${task.prompt}`,
            `Source commit: ${prepared.sourceCommit}`,
            `Target branch: ${merge.targetBranch}`,
            `Target commit: ${prepared.targetCommit}`,
            `Conflicted paths (JSON): ${JSON.stringify(prepared.conflicts)}`,
            "Preserve the intended behavior from both sides and resolve conflicts by editing the files. Do not simply take ours or theirs.",
            "Do not commit, switch branches, reset, push, remove worktrees, modify Git refs, or change files outside this worktree.",
            "Run relevant project checks when available and allowed by your current permissions. Report checks that could not run.",
            "Stop and explain any conflict you cannot safely resolve. The Host will validate and publish the merge separately.",
          ].join("\n\n"),
        };
        await executeWorkTaskConversation(
          deps,
          resolver,
          {
            signal: context.signal,
            update: async (patch) => {
              const next = {
                ...merge,
                ...(patch.session ? { session: patch.session } : {}),
                phase:
                  patch.status === "awaiting_input"
                    ? ("awaiting_input" as const)
                    : ("resolving" as const),
              };
              const owned = await context.update({
                merge: next,
                status: patch.status ?? "running",
              });
              if (owned) merge = next;
              return owned;
            },
          },
          merge.worktree.path,
        );
        // turn.terminal 只证明前台轮次结束；后台任务/队列仍可写文件，发布前必须读取权威空闲状态。
        await assertWorkTaskSourceIdle(
          deps,
          { ...resolver, session: merge.session },
          context.signal,
        );
      }
      await save({ phase: "resolving" });
      await assertWorkTaskSourceIdle(deps, task, context.signal);
      await commitWorkTaskExecution(context, {});
      const final = await deps.git.finalizeTaskMerge({ ...request, ...prepared });
      await save({ phase: "applying", resultCommit: final.commitHash });
      await deps.git.applyTaskMerge({ ...request, ...prepared, resultCommit: final.commitHash });
      await save({ phase: "merged" });
    },
  };
}
