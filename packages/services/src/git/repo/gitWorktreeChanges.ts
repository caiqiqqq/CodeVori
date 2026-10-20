import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { ensureGitCommandSucceeded } from "./gitCliHelpers.js";

export async function hasGitWorktreeChanges(
  provider: GitCommandProvider,
  cwd: string,
): Promise<boolean> {
  const result = await provider.run({
    cwd,
    args: [
      "status",
      "--porcelain=v2",
      "--untracked-files=normal",
      "--no-branch",
      "--no-show-stash",
      "-z",
    ],
    stdoutCapture: "first-byte",
  });
  ensureGitCommandSucceeded("git status", result);
  return result.stdout.length > 0;
}
