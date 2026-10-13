import type { IGitService } from "@zcode/services";
import type { GitWorkspaceRepositoryInfo, LinkedRepository } from "@zcode/shared";

export class LinkedRepositoryError extends Error {
  constructor(
    readonly code: "notRepository" | "bindingChanged" | "createFailed" | "branchChanged" | "stale",
    readonly repositoryName: string,
  ) {
    super(`linked-repositories.${code}: ${repositoryName}`);
  }
}

export function repositoryIdentity(info: GitWorkspaceRepositoryInfo): string | null {
  return info.mainWorktreePath ?? info.repoRoot ?? null;
}

/** 只协调 Composer 明确意图；所有 Git 查询及写入走现有公开服务。 */
export async function prepareLinkedRepositories(options: {
  repositories: readonly LinkedRepository[];
  gitService: IGitService;
  worktreeRootPath: string;
  onPrepared: (repositories: LinkedRepository[]) => void;
  isCurrent: () => boolean;
}): Promise<LinkedRepository[]> {
  const rows = options.repositories.map((row) => ({ ...row }));
  const assertCurrent = () => {
    if (!options.isCurrent()) throw new LinkedRepositoryError("stale", "");
  };
  for (const [index, row] of rows.entries()) {
    assertCurrent();
    const source = await options.gitService.getWorkspaceRepositoryInfo({
      workspacePath: row.sourcePath,
    });
    if (!source.repoRoot || source.kind === "not-repository")
      throw new LinkedRepositoryError("notRepository", row.name);
    const sourceRepositoryPath = repositoryIdentity(source)!;
    if (row.prepared) {
      const target = await options.gitService.getWorkspaceRepositoryInfo({
        workspacePath: row.prepared.executionPath,
      });
      const branch = await options.gitService.getLocalBranches({
        workspacePath: row.prepared.executionPath,
      });
      if (
        repositoryIdentity(target) !== sourceRepositoryPath ||
        sourceRepositoryPath !== row.prepared.sourceRepositoryPath ||
        branch.currentBranchName !== row.prepared.branchName ||
        (row.useWorktree && target.kind !== "linked-worktree")
      ) {
        throw new LinkedRepositoryError("bindingChanged", row.name);
      }
      assertCurrent();
      continue;
    }
    const base = await options.gitService.resolveLocalBranch({
      workspacePath: row.sourcePath,
      branchName: row.baseBranch,
    });
    assertCurrent();
    if (!row.useWorktree) {
      const branch = await options.gitService.getLocalBranches({ workspacePath: row.sourcePath });
      assertCurrent();
      if (branch.currentBranchName !== row.baseBranch)
        throw new LinkedRepositoryError("branchChanged", row.name);
    }
    const result = row.useWorktree
      ? await options.gitService.createAutomaticWorktree({
          workspacePath: row.sourcePath,
          worktreeRootPath: options.worktreeRootPath,
          startPoint: base.commitHash,
        })
      : { ok: true, worktreePath: row.sourcePath, branchName: row.baseBranch };
    if (!result.ok || !result.branchName) throw new LinkedRepositoryError("createFailed", row.name);
    rows[index] = {
      ...row,
      prepared: {
        executionPath: result.worktreePath,
        branchName: result.branchName,
        baseCommit: base.commitHash,
        sourceRepositoryPath,
      },
    };
    // Git 成功后必须先记录原 scope，再检查迟到；否则切换会话后的重试会重复分配。
    options.onPrepared([...rows]);
    assertCurrent();
  }
  return rows;
}
