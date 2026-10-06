import { open, readFile, rename, unlink } from "node:fs/promises";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { ensureGitCommandSucceeded } from "./gitCliHelpers.js";
import { hasGitWorktreeChanges } from "./gitWorktreeChanges.js";

export async function publishCheckedOutTaskMerge(
  provider: GitCommandProvider,
  input: {
    cwd: string;
    branchName: string;
    expectedCommit: string;
    resultCommit: string;
  },
) {
  const run = async (args: string[], alternateIndex?: string) => {
    const result = await provider.run({
      cwd: input.cwd,
      args,
      ...(alternateIndex ? { env: { GIT_INDEX_FILE: alternateIndex } } : {}),
    });
    ensureGitCommandSucceeded(`git ${args[0]}`, result);
    return result.stdout.trim();
  };
  const index = await run(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const indexLock = `${index}.lock`;
  const lock = await open(indexLock, "wx").catch(() => {
    throw new Error("work-task.merge-target-busy");
  });
  let published = false;
  let installed = false;
  try {
    await lock.writeFile(await readFile(index));
    await lock.close();
    if (
      (await run(["symbolic-ref", "--quiet", "HEAD"])) !== `refs/heads/${input.branchName}` ||
      (await run(["rev-parse", "HEAD"])) !== input.expectedCommit
    )
      throw new Error("work-task.merge-target-changed");
    if (await hasGitWorktreeChanges(provider, input.cwd))
      throw new Error("work-task.merge-target-dirty");
    // 持有真实 index 锁阻止并发 checkout；alternate index 让 Git 自己校验/更新文件。
    // ref 必须 expected-old 更新，不能在预检查之后对“当前 HEAD”盲目 fast-forward。
    await run(
      ["read-tree", "--dry-run", "-u", "-m", input.expectedCommit, input.resultCommit],
      indexLock,
    );
    const update = await provider.run({
      cwd: input.cwd,
      args: [
        "update-ref",
        "-m",
        "zcode: merge work task",
        `refs/heads/${input.branchName}`,
        input.resultCommit,
        input.expectedCommit,
      ],
    });
    if (update.exitCode !== 0 && !update.timedOut && !update.outputTruncated)
      throw new Error("work-task.merge-target-changed");
    ensureGitCommandSucceeded("git publish task merge", update);
    published = true;
    await run(["read-tree", "-u", "-m", input.expectedCommit, input.resultCommit], indexLock);
    await rename(indexLock, index);
    installed = true;
  } catch (error) {
    if (published && !installed) {
      // 更新文件失败时只回退仍等于本操作结果的 ref，不覆盖随后发生的第三方提交。
      const rollback = await provider.run({
        cwd: input.cwd,
        args: [
          "update-ref",
          `refs/heads/${input.branchName}`,
          input.expectedCommit,
          input.resultCommit,
        ],
      });
      ensureGitCommandSucceeded("git rollback unpublished task checkout", rollback);
    }
    throw error;
  } finally {
    await lock.close().catch(() => {});
    if (!installed)
      await unlink(indexLock).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
  }
}
