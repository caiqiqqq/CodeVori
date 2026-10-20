import type {
  GitTaskChangeRecordRequest,
  GitTaskChangeRecordResult,
  WorkTaskChangeRecord,
} from "@zcode/shared";
import {
  createGitCommandProvider,
  type GitCommandProvider,
} from "../providers/gitCommandProvider.js";
import { ensureGitCommandSucceeded } from "./gitCliHelpers.js";

function files(value: string): WorkTaskChangeRecord["files"] {
  return value
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [add, remove, ...path] = line.split("\t");
      return {
        path: path.join("\t"),
        added: add === "-" ? null : Number(add),
        removed: remove === "-" ? null : Number(remove),
      };
    });
}
export function createGitTaskChangeRecord(
  provider: GitCommandProvider = createGitCommandProvider(),
) {
  return async (input: GitTaskChangeRecordRequest): Promise<GitTaskChangeRecordResult> => {
    const run = async (args: string[], patch = false) => {
      const result = await provider.run({
        cwd: input.workspacePath,
        args,
        maxOutputBytes: patch ? 24_000 : 512_000,
      });
      // diff 是有界提示材料；截断不影响已独立校验的提交及统计，命令失败不能当作空修改。
      if (patch && result.outputTruncated && !result.timedOut)
        return result.stdout.slice(0, 12_000);
      ensureGitCommandSucceeded("git task result records", result);
      return result.stdout;
    };
    await run(["check-ref-format", "--branch", input.branchName]);
    if ((await run(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() !== input.branchName)
      throw new Error("work-task.result-branch-mismatch");
    const head = (
      await run(["rev-parse", "--verify", `refs/heads/${input.branchName}^{commit}`])
    ).trim();
    const base = input.baseCommit;
    if (base) {
      if (!/^[a-f0-9]{40,64}$/.test(base)) throw new Error("work-task.result-base-invalid");
      await run(["merge-base", "--is-ancestor", base, head]);
    }
    const [committed, pending, untracked, history, patch] = await Promise.all([
      base
        ? run([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--numstat",
            "-z",
            base,
            head,
            "--",
          ])
        : "",
      run([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--numstat",
        "-z",
        head,
        "--",
      ]),
      run(["ls-files", "--others", "--exclude-standard", "-z"]),
      base ? run(["log", "--max-count=21", "--format=%H%x00%s%x00", `${base}..${head}`, "--"]) : "",
      run(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", base ?? head, "--"], true),
    ]);
    const parts = history.trim().split("\0");
    const commits: WorkTaskChangeRecord["commits"] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const hash = parts[i]!.trim();
      if (hash) commits.push({ hash, subject: parts[i + 1]!.slice(0, 300), published: false });
    }
    if (input.referenceCommit && !commits.some((c) => c.hash === input.referenceCommit)) {
      if (!/^[a-f0-9]{40,64}$/.test(input.referenceCommit))
        throw new Error("work-task.result-base-invalid");
      const hash = (
        await run(["rev-parse", "--verify", `${input.referenceCommit}^{commit}`])
      ).trim();
      commits.unshift({ hash, subject: "Task merge result", published: false });
    }
    // 远端读取只校验引用，不 fetch/push；失败或远端 tip 本地不可解析时保留未确认发布。
    if (input.remoteName && input.publishedBranches?.length) {
      if (!/^[^-\s][^\s]*$/.test(input.remoteName))
        throw new Error("work-task.result-remote-invalid");
      try {
        for (const branch of input.publishedBranches)
          await run(["check-ref-format", "--branch", branch]);
        const live = await provider.run({
          cwd: input.workspacePath,
          args: [
            "ls-remote",
            "--heads",
            "--",
            input.remoteName,
            ...input.publishedBranches.map((b) => `refs/heads/${b}`),
          ],
          credentialRemote: input.remoteName,
          timeoutMs: 10_000,
        });
        ensureGitCommandSucceeded("git task published refs", live);
        const tips = live.stdout
          .split("\n")
          .map((l) => l.split("\t")[0]!)
          .filter((h) => /^[a-f0-9]{40,64}$/.test(h));
        for (const commit of commits.slice(0, 20)) {
          for (const tip of tips) {
            const reachable = await provider.run({
              cwd: input.workspacePath,
              args: ["merge-base", "--is-ancestor", commit.hash, tip],
            });
            if (reachable.exitCode === 0 && !reachable.timedOut && !reachable.outputTruncated) {
              commit.published = true;
              break;
            }
          }
        }
      } catch {
        /* 没有远端可达证据就不生成链接。 */
      }
    }
    if (
      (await run(["rev-parse", "HEAD"])).trim() !== head ||
      (await run(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() !== input.branchName
    )
      throw new Error("work-task.result-source-changed");
    const changes = files(committed);
    const unstaged = [
      ...files(pending),
      ...untracked
        .split("\0")
        .filter(Boolean)
        .map((path) => ({ path, added: null, removed: null })),
    ];
    return {
      record: {
        state: base ? "known" : "partial",
        branchName: input.branchName,
        ...(base ? { baseCommit: base } : {}),
        headCommit: head,
        commits: commits.slice(0, 20),
        files: changes.slice(0, 50),
        uncommitted: unstaged.slice(0, 50),
        truncated: commits.length > 20 || changes.length > 50 || unstaged.length > 50,
      },
      patch: patch.slice(0, 12_000),
    };
  };
}
