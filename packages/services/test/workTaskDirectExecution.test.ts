import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { uuidv7, type WorkTask, type AcpSessionChanged } from "@zcode/shared";
import type { IAcpService } from "../src/acp/acpService.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createWorkTaskExecution } from "../src/work-task/workTaskExecution.js";

const command = promisify(execFile);
for (const scenario of ["success", "dirty", "missing", "no-branch"] as const) {
  test(`direct branch execution: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-direct-task-"));
    const git = (args: string[]) => command("git", ["-C", directory, ...args]);
    try {
      await git(["init", "-q", "-b", "main"]);
      await git(["config", "user.name", "Task Test"]);
      await git(["config", "user.email", "test@example.invalid"]);
      await writeFile(join(directory, "README.md"), "main\n");
      await git(["add", "."]);
      await git(["commit", "-qm", "main"]);
      await git(["switch", "-qc", "feature"]);
      await writeFile(join(directory, "README.md"), "feature\n");
      await git(["commit", "-qam", "feature"]);
      await git(["switch", "-q", "main"]);
      if (scenario === "dirty") await writeFile(join(directory, "README.md"), "user edits\n");
      let task: WorkTask = {
        workspacePath: directory,
        id: uuidv7(),
        title: "Direct",
        prompt: "Build",
        useWorktree: false,
        sourceBranch:
          scenario === "missing" ? "missing" : scenario === "no-branch" ? undefined : "feature",
        execution: { kind: "acp", agent: "codex", config: [] },
        status: "preparing",
        archived: false,
        stopPending: false,
        runSeq: 1,
        runText: "Build",
        commandId: uuidv7(),
        sessionRequestId: uuidv7(),
        createdAt: 1,
        updatedAt: 1,
      };
      let sessions = 0;
      let prompts = 0;
      const service = createGitService({ repo: createGitCliRepo() });
      const execute = createWorkTaskExecution({
        homeDirectory: join(directory, "fake-home"),
        git: {
          ...service,
          createWorktree: async () => {
            throw new Error("Must not allocate a worktree");
          },
        },
        settings: {
          get: async () => {
            throw new Error("Must not read worktree settings");
          },
        } as unknown as ISettingService,
        acp: {
          create: async (input: { workspacePath: string }) => {
            assert.equal(input.workspacePath, directory);
            assert.equal(task.directBranch, "feature", "persist branch before Agent creation");
            sessions++;
            return { id: "session" };
          },
          list: async () => [{ id: "session", agent: "codex", status: "idle" }],
          onDynamicSessionChanged: () => new Emitter<AcpSessionChanged>().event,
          prompt: async (input: { workspacePath: string }) => {
            assert.equal(input.workspacePath, directory);
            assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "feature");
            prompts++;
            await writeFile(join(directory, "generated.txt"), "task edit\n");
            return { status: "idle" };
          },
        } as unknown as IAcpService,
        agent: {} as IZCodeAgentService,
        ensureWorkspaceSubscription() {},
      });
      const context = {
        signal: new AbortController().signal,
        update: async (patch: object) => {
          task = { ...task, ...patch };
          return true;
        },
      };
      if (scenario !== "success") {
        await assert.rejects(execute.execute(task, context));
        assert.equal(sessions, 0);
        assert.equal(prompts, 0);
        assert.equal(task.directBranch, undefined);
        assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "main");
        if (scenario === "dirty")
          assert.equal(await readFile(join(directory, "README.md"), "utf8"), "user edits\n");
        return;
      }
      await execute.execute(task, context);
      assert.equal(task.worktree, undefined);
      assert.equal(await readFile(join(directory, "README.md"), "utf8"), "feature\n");
      assert.equal(await readFile(join(directory, "generated.txt"), "utf8"), "task edit\n");
      await execute.execute({ ...task, runSeq: 2 }, context);
      assert.equal(sessions, 1);
      assert.equal(prompts, 2);
      assert.equal(
        (await git(["worktree", "list", "--porcelain"])).stdout.match(/^worktree /gm)?.length,
        1,
      );
      assert.deepEqual(
        (await git(["branch", "--format=%(refname:short)"])).stdout.trim().split("\n"),
        ["feature", "main"],
      );
      await git(["switch", "-q", "main"]);
      await assert.rejects(execute.execute(task, context), /work-task.direct-branch-changed/);
      assert.equal(prompts, 2);
      assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "main");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
