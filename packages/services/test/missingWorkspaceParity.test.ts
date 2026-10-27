import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { ZCODE_AGENT_PROVIDER, type ZCodeTaskMeta } from "@zcode/shared";
import { resolveZCodeAgentSpawnCwd } from "../src/zcode-agent/zcodeAgentSpawnCwd.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

test("removed workspace retains indexed tasks and new records; process cwd fallback keeps workspace identity", async () => {
  const base = await mkdtemp(join(tmpdir(), "zcode-missing-workspace-"));
  const workspacePath = join(base, "deleted-project");
  const repo = new TaskIndexRepo(join(base, "tasks.sqlite"));
  const meta = (taskId: string) =>
    ({
      taskId,
      traceId: `trace-${taskId}`,
      workspacePath,
      provider: ZCODE_AGENT_PROVIDER,
      title: taskId,
      createdAt: 1,
      updatedAt: 1,
      mode: "build",
    }) as ZCodeTaskMeta;
  try {
    await mkdir(workspacePath);
    await repo.seedTaskMetaIfMissing(meta("existing-task"));
    await rm(workspacePath, { recursive: true });
    assert.equal((await repo.listTaskMetas({ workspacePath })).length, 1);
    await repo.seedTaskMetaIfMissing(meta("new-task"));
    assert.equal((await repo.listTaskMetas({ workspacePath })).length, 2);
    assert.ok(
      (await repo.listTaskMetas({ workspacePath })).every(
        (task) => task.workspacePath === workspacePath,
      ),
    );
    const resolved = await resolveZCodeAgentSpawnCwd({
      requestedCwd: workspacePath,
      workspacePath,
      spawnFallbackCwd: base,
    });
    assert.equal(resolved.usedFallback, true);
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["-e", "process.stdout.write(process.cwd())"],
      { cwd: resolved.cwd },
    );
    assert.equal(stdout, await realpath(base));
    // 显式 command cwd 不属于 workspace fallback，不能悄悄执行在其他目录。
    const explicit = await resolveZCodeAgentSpawnCwd({
      requestedCwd: join(base, "explicit-missing"),
      workspacePath,
      spawnFallbackCwd: base,
    });
    assert.equal(explicit.usedFallback, false);
    assert.equal(explicit.cwdExists, false);
  } finally {
    repo.close();
    await rm(base, { recursive: true, force: true });
  }
});
