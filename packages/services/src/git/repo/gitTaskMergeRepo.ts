import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { GitPrepareTaskMergeRequest, GitFinalizeTaskMergeRequest } from "@zcode/shared";
import type { IGitService } from "../git.js";
import {
  createGitCommandProvider,
  type GitCommandProvider,
} from "../providers/gitCommandProvider.js";
import {
  ensureGitCommandSucceeded,
  ensureRepositoryAvailable,
  hasGitOperationInProgress,
} from "./gitCliHelpers.js";
import type { GitCliRepo } from "./gitCliTypes.js";
import { publishCheckedOutTaskMerge } from "./gitTaskMergePublish.js";
import { hasGitWorktreeChanges } from "./gitWorktreeChanges.js";

export type GitTaskMergeRepo = Pick<
  IGitService,
  "resolveLocalBranch" | "prepareTaskMerge" | "finalizeTaskMerge" | "applyTaskMerge"
>;

interface RegisteredWorktree {
  path: string;
  branch: string | null;
}

export function createGitTaskMergeRepo(options: {
  repo: GitCliRepo;
  commandProvider?: GitCommandProvider;
}): GitTaskMergeRepo {
  const provider = options.commandProvider ?? createGitCommandProvider();
  const repo = options.repo;
  const run = async (cwd: string, args: string[]) => {
    const result = await provider.run({ cwd, args });
    ensureGitCommandSucceeded(`git ${args[0]}`, result);
    return result.stdout;
  };
  const repository = async (path: string) => {
    const result = await repo.resolveRepository(path);
    ensureRepositoryAvailable(result, "merge task");
    return result;
  };
  const branch = async (cwd: string, name: string) => {
    if (!name || name !== name.trim() || name.includes("\0"))
      throw new Error("work-task.branch-not-found");
    await run(cwd, ["check-ref-format", "--branch", name]);
    const result = await provider.run({
      cwd,
      args: ["rev-parse", "--verify", `refs/heads/${name}^{commit}`],
    });
    if (result.exitCode !== 0 && !result.timedOut && !result.outputTruncated)
      throw new Error("work-task.branch-not-found");
    ensureGitCommandSucceeded("git resolve local branch", result);
    return result.stdout.trim();
  };
  const worktrees = async (cwd: string): Promise<RegisteredWorktree[]> => {
    const records = (await run(cwd, ["worktree", "list", "--porcelain", "-z"]))
      .split("\0\0")
      .filter(Boolean);
    return records.map((record) => {
      const fields = record.split("\0");
      const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
      if (!path) throw new Error("work-task.worktree-mismatch");
      return {
        path,
        branch: fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18) ?? null,
      };
    });
  };
  const registered = async (cwd: string, path: string, name: string) => {
    const actual = await realpath(path);
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("work-task.worktree-mismatch");
    const list = await worktrees(cwd);
    for (const tree of list) {
      if (tree.branch === name && (await realpath(tree.path)) === actual) return;
    }
    throw new Error("work-task.worktree-mismatch");
  };
  const clean = async (cwd: string, error: string) => {
    if (await hasGitWorktreeChanges(provider, cwd)) throw new Error(error);
    if (await hasGitOperationInProgress(provider, cwd))
      throw new Error("work-task.merge-operation-in-progress");
  };
  const target = async (cwd: string, name: string, expected?: string) => {
    const hash = await branch(cwd, name);
    if (expected && hash !== expected) throw new Error("work-task.merge-target-changed");
    const checkedOut = (await worktrees(cwd)).filter((tree) => tree.branch === name);
    if (checkedOut.length > 1) throw new Error("work-task.merge-target-busy");
    for (const tree of checkedOut) {
      await clean(tree.path, "work-task.merge-target-dirty");
      if (
        (await run(tree.path, ["symbolic-ref", "--quiet", "HEAD"])).trim() !==
          `refs/heads/${name}` ||
        (await run(tree.path, ["rev-parse", "HEAD"])).trim() !== hash
      )
        throw new Error("work-task.merge-target-changed");
    }
    return { hash, checkedOut };
  };
  const ancestor = async (cwd: string, base: string, tip: string) => {
    const result = await provider.run({ cwd, args: ["merge-base", "--is-ancestor", base, tip] });
    if (result.exitCode === 1 && !result.timedOut && !result.outputTruncated)
      throw new Error("work-task.merge-history-invalid");
    ensureGitCommandSucceeded("git merge-base --is-ancestor", result);
  };
  const sourceUnchanged = async (input: GitFinalizeTaskMergeRequest) => {
    await registered(input.workspacePath, input.taskWorktreePath, input.taskBranchName);
    if ((await branch(input.workspacePath, input.taskBranchName)) !== input.sourceCommit)
      throw new Error("work-task.merge-source-changed");
    await clean(input.taskWorktreePath, "work-task.merge-source-changed");
  };

  return {
    async resolveLocalBranch(input) {
      const resolution = await repository(input.workspacePath);
      return {
        branchName: input.branchName,
        commitHash: await branch(resolution.repoRoot, input.branchName),
      };
    },
    async prepareTaskMerge(input: GitPrepareTaskMergeRequest) {
      const resolution = await repository(input.workspacePath);
      const cwd = resolution.repoRoot;
      if (
        input.taskBranchName === input.targetBranchName ||
        input.branchName === input.targetBranchName ||
        input.branchName === input.taskBranchName
      )
        throw new Error("work-task.merge-invalid-target");
      await registered(cwd, input.taskWorktreePath, input.taskBranchName);
      const { hash: targetCommit } = await target(
        cwd,
        input.targetBranchName,
        input.expectedTargetCommit,
      );
      if (await hasGitOperationInProgress(provider, input.taskWorktreePath))
        throw new Error("work-task.merge-operation-in-progress");
      const identity = await repo.getIdentity(input.taskWorktreePath);
      if (!identity.userName || !identity.userEmail)
        throw new Error("work-task.merge-identity-required");
      // 只提交任务工作树，绝不暂存/提交主项目或目标工作树的本地修改。
      if (await hasGitWorktreeChanges(provider, input.taskWorktreePath)) {
        await run(input.taskWorktreePath, ["add", "--all", "--", "."]);
        await run(input.taskWorktreePath, ["commit", "-m", input.commitMessage]);
      }
      await clean(input.taskWorktreePath, "work-task.merge-source-changed");
      const sourceCommit = await branch(cwd, input.taskBranchName);
      const creation = await repo.createWorktree(
        cwd,
        input.branchName,
        input.worktreePath,
        targetCommit,
      );
      if (!creation.ok)
        throw new Error(
          `work-task.worktree-create-failed: ${creation.issues.map((issue) => issue.message).join("\n")}`,
        );
      const result = await provider.run({
        cwd: input.worktreePath,
        args: ["merge", "--no-ff", "--no-commit", "--", sourceCommit],
      });
      const unmerged = await run(input.worktreePath, ["ls-files", "--unmerged", "-z"]);
      const entries = unmerged
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const tab = entry.indexOf("\t");
          const [mode, hash] = entry.slice(0, tab).split(" ");
          if (tab < 0 || !mode || !hash) throw new Error("work-task.merge-unresolved");
          return { mode, hash, path: entry.slice(tab + 1) };
        });
      if (result.timedOut || result.outputTruncated || (result.exitCode !== 0 && !entries.length))
        ensureGitCommandSucceeded("git merge task", result);
      for (const entry of entries) {
        if (entry.mode !== "100644" && entry.mode !== "100755")
          throw new Error("work-task.merge-unsupported-conflict");
        const blob = await provider.run({
          cwd: input.worktreePath,
          args: ["cat-file", "blob", entry.hash],
          maxOutputBytes: 1024 * 1024,
        });
        if (blob.stdout.includes("\0") || blob.outputTruncated)
          throw new Error("work-task.merge-unsupported-conflict");
        ensureGitCommandSucceeded("git read conflict", blob);
      }
      repo.invalidate(input.taskWorktreePath);
      repo.invalidate(input.worktreePath);
      return {
        sourceCommit,
        targetCommit,
        conflicts: [...new Set(entries.map((entry) => entry.path))],
      };
    },
    async finalizeTaskMerge(input) {
      await registered(input.workspacePath, input.worktreePath, input.branchName);
      await sourceUnchanged(input);
      for (const path of input.conflicts) {
        const absolute = resolve(input.worktreePath, path);
        // 只能读取 Git 返回的项目内文件；删除冲突可以通过删除该路径解决。
        if (
          !absolute.startsWith(`${resolve(input.worktreePath)}/`) &&
          !absolute.startsWith(`${resolve(input.worktreePath)}\\`)
        )
          throw new Error("work-task.merge-unresolved");
        try {
          const stat = await lstat(absolute);
          if (!stat.isFile() || stat.size > 1024 * 1024)
            throw new Error("work-task.merge-unsupported-conflict");
          const canonicalRoot = await realpath(input.worktreePath);
          const resolvedPath = relative(canonicalRoot, await realpath(absolute));
          // 模型可能替换父目录为链接；不能沿链接读取/发布工作树之外的冲突内容。
          if (
            resolvedPath === ".." ||
            resolvedPath.startsWith("../") ||
            resolvedPath.startsWith("..\\") ||
            isAbsolute(resolvedPath)
          )
            throw new Error("work-task.merge-unsupported-conflict");
          const content = await readFile(absolute, "utf8");
          if (content.includes("\0")) throw new Error("work-task.merge-unsupported-conflict");
          if (/^([<=>|])\1{6,}(?:\s.*)?$/m.test(content))
            throw new Error("work-task.merge-unresolved");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      // 不信任模型的完成文案，Git index 和 diff 的真实结果才决定能否发布。
      if (
        (await run(input.worktreePath, ["ls-files", "--unmerged", "-z"])).length &&
        !input.conflicts.length
      )
        throw new Error("work-task.merge-unresolved");
      await run(input.worktreePath, ["add", "--all", "--", "."]);
      if ((await run(input.worktreePath, ["ls-files", "--unmerged", "-z"])).length)
        throw new Error("work-task.merge-unresolved");
      const check = await provider.run({
        cwd: input.worktreePath,
        args: ["diff", "--cached", "--check"],
      });
      if (check.exitCode !== 0 && !check.timedOut && !check.outputTruncated)
        throw new Error("work-task.merge-check-failed");
      ensureGitCommandSucceeded("git validate merge diff", check);
      if (await hasGitOperationInProgress(provider, input.worktreePath)) {
        const head = (
          await run(input.worktreePath, ["rev-parse", "--verify", "MERGE_HEAD"])
        ).trim();
        if (
          head !== input.sourceCommit ||
          (await branch(input.workspacePath, input.branchName)) !== input.targetCommit
        )
          throw new Error("work-task.merge-history-invalid");
        await run(input.worktreePath, [
          "commit",
          "-m",
          `Merge task into ${input.targetBranchName}`,
        ]);
      }
      await clean(input.worktreePath, "work-task.merge-unresolved");
      const commitHash = await branch(input.workspacePath, input.branchName);
      await ancestor(input.worktreePath, input.sourceCommit, commitHash);
      await ancestor(input.worktreePath, input.targetCommit, commitHash);
      return { commitHash };
    },
    async applyTaskMerge(input) {
      await registered(input.workspacePath, input.worktreePath, input.branchName);
      await sourceUnchanged(input);
      if ((await branch(input.workspacePath, input.branchName)) !== input.resultCommit)
        throw new Error("work-task.merge-history-invalid");
      await clean(input.worktreePath, "work-task.merge-unresolved");
      await ancestor(input.workspacePath, input.sourceCommit, input.resultCommit);
      await ancestor(input.workspacePath, input.targetCommit, input.resultCommit);
      const { checkedOut } = await target(
        input.workspacePath,
        input.targetBranchName,
        input.targetCommit,
      );
      if (checkedOut[0]) {
        await publishCheckedOutTaskMerge(provider, {
          cwd: checkedOut[0].path,
          branchName: input.targetBranchName,
          expectedCommit: input.targetCommit,
          resultCommit: input.resultCommit,
        });
        repo.invalidate(checkedOut[0].path);
      } else {
        await run(input.workspacePath, [
          "update-ref",
          `refs/heads/${input.targetBranchName}`,
          input.resultCommit,
          input.targetCommit,
        ]);
      }
      const published = await branch(input.workspacePath, input.targetBranchName);
      await ancestor(input.workspacePath, input.resultCommit, published);
      repo.invalidate(input.workspacePath);
    },
  };
}
