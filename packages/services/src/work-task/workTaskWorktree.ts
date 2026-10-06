import { randomBytes } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { resolveWorktreeRootPath, type WorkTask } from "@zcode/shared";
import type { IGitService } from "../git/git.js";
import type { ISettingService } from "../setting/setting.js";
import type { WorkTaskExecutionContext } from "../session/contract.js";
import { commitWorkTaskExecution as commit } from "./workTaskExecutionState.js";
import { getConversationWorkspaceDir } from "../paths.js";

interface WorkTaskWorktreeDependencies {
  git: IGitService;
  settings: ISettingService;
  homeDirectory?: string;
}

async function pathExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  }
}

export async function prepareWorkTaskWorktree(
  deps: WorkTaskWorktreeDependencies,
  task: WorkTask,
  context: WorkTaskExecutionContext,
) {
  // 默认对话目录会继承父级 Git 仓库；执行前拒绝它及别名，旧分配重试也不能绕过。
  const [workspacePath, conversationPath, homePath, allocatedProjectPath] = await Promise.all([
    canonicalPath(task.workspacePath),
    canonicalPath(getConversationWorkspaceDir()),
    canonicalPath(deps.homeDirectory ?? homedir()),
    task.worktree ? canonicalPath(task.worktree.projectPath) : null,
  ]);
  context.signal.throwIfAborted();
  if (workspacePath === conversationPath) throw new Error("work-task.project-required");
  // Git 会继承父级用户目录的仓库；旧分配也必须提前拒绝，避免重试绕过校验后扫描整个用户目录。
  if (workspacePath === homePath || allocatedProjectPath === homePath)
    throw new Error("work-task.home-repository");
  let worktree = task.worktree;
  if (!worktree) {
    const info = await deps.git.getWorkspaceRepositoryInfo({ workspacePath: task.workspacePath });
    if (!info.repoRoot || info.kind === "not-repository")
      throw new Error("work-task.not-repository");
    const projectPath = info.mainWorktreePath ?? info.repoRoot;
    if ((await canonicalPath(projectPath)) === homePath)
      throw new Error("work-task.home-repository");
    const settings = await deps.settings.get();
    const rootPath = resolveWorktreeRootPath({
      configuredRoot: settings.worktreeRootDirectory,
      homeDirectory: deps.homeDirectory ?? homedir(),
      workspacePath: task.workspacePath,
    });
    if (!rootPath) throw new Error("work-task.worktree-root-unavailable");
    // 来源仅在首次分配解析；已有分配重试固定提交，不能追随分支后续推进。
    const baseCommit = task.sourceBranch
      ? (
          await deps.git.resolveLocalBranch({
            workspacePath: task.workspacePath,
            branchName: task.sourceBranch,
          })
        ).commitHash
      : (
          await deps.git.getCommitGraph({
            workspacePath: task.workspacePath,
            maxCount: 1,
            headOnly: true,
          })
        ).commits[0]?.hash;
    if (!baseCommit) throw new Error("work-task.no-commit");
    for (let attempt = 0; attempt < 16; attempt++) {
      const token = randomBytes(2).toString("hex");
      const path = join(rootPath, token, basename(projectPath));
      if (await pathExists(join(rootPath, token))) continue;
      worktree = { rootPath, path, projectPath, branchName: `worktree/${token}`, baseCommit };
      break;
    }
    if (!worktree) throw new Error("work-task.worktree-allocation-failed");
    // 先持久化分配，再执行 Git；崩溃后只能恢复同一分支，不能偷偷创建第二棵树。
    await commit(context, { worktree });
  }
  const existing = await pathExists(worktree.path);
  if (!existing) {
    context.signal.throwIfAborted();
    const result = await deps.git.createWorktree({
      workspacePath: worktree.projectPath,
      worktreePath: worktree.path,
      branchName: worktree.branchName,
      startPoint: worktree.baseCommit,
    });
    if (!result.ok)
      throw new Error(
        result.issues.map((issue) => issue.message).join("\n") ||
          "work-task.worktree-create-failed",
      );
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error("work-task.worktree-mismatch");
  }
  const info = await deps.git.getWorkspaceRepositoryInfo({ workspacePath: worktree.path });
  const projects = await deps.git.listManagedWorktrees({ worktreeRootPath: worktree.rootPath });
  // macOS 临时目录经 Git 返回 /private/var；归属必须比较规范路径而非原始字符串。
  const [projectPath, worktreePath] = await Promise.all([
    canonicalPath(worktree.projectPath),
    canonicalPath(worktree.path),
  ]);
  let registered = false;
  for (const project of projects) {
    if ((await canonicalPath(project.projectPath)) !== projectPath) continue;
    for (const item of project.worktrees) {
      if (
        item.branchName === worktree.branchName &&
        (await canonicalPath(item.worktreePath)) === worktreePath
      )
        registered = true;
    }
  }
  if (
    !registered ||
    info.kind !== "linked-worktree" ||
    !info.mainWorktreePath ||
    (await canonicalPath(info.mainWorktreePath)) !== projectPath ||
    info.branchName !== worktree.branchName
  )
    throw new Error("work-task.worktree-mismatch");
  context.signal.throwIfAborted();
  return worktree;
}
