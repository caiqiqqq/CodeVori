import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { AutomationRepo } from "../src/session/automationRepo.js";
import { OffPeakTaskRepo } from "../src/session/offPeakTaskRepo.js";
import { prepareTasksIndexStorage } from "../src/session/tasksDatabase/startup.js";
import { retryTasksDatabaseInitialization } from "../src/session/tasksDatabase/initialization.js";

for (const Repo of [TaskIndexRepo, AutomationRepo, OffPeakTaskRepo]) {
  for (const migrated of Repo === AutomationRepo ? [false] : [false, true]) {
    test(
      `${Repo.name} ${migrated ? "post-migration maintenance" : "initialization"} yields while another process holds the write lock`,
      { timeout: 15000 },
      async () => {
        const directory = await mkdtemp(join(tmpdir(), "zcode-task-lock-"));
        const path = join(directory, "tasks.sqlite");
        let child: ReturnType<typeof spawn> | undefined;
        let worker: ReturnType<typeof spawn> | undefined;
        try {
          await prepareTasksIndexStorage(path, () => {});
          child = spawn(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(process.argv[1]);
        db.exec('BEGIN IMMEDIATE');
        process.stdout.write('locked\\n');
        process.stdin.once('data', () => setTimeout(() => {
          db.exec('COMMIT'); db.close(); process.stdin.destroy();
        }, 700));
        setTimeout(() => process.exit(2), 10000).unref();
      `,
              path,
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
          );
          await once(child.stdout!, "data");
          // TaskIndex 的维护路径有无条件清理写入；其余 Repo 在未 prepared 的进程中也必须拿迁移锁。
          // 在独立子进程中运行实际 Repo，避免父进程 prepared 交接跳过待验证阶段。
          worker = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "--input-type=module",
              "-e",
              `
        import { ${Repo.name} } from ${JSON.stringify(new URL(`../src/session/${Repo === TaskIndexRepo ? "taskIndexRepo" : Repo === AutomationRepo ? "automationRepo" : "offPeakTaskRepo"}.ts`, import.meta.url).href)};
        import { markTasksStorageMigrated } from ${JSON.stringify(new URL("../src/session/tasksDatabase/prepared.ts", import.meta.url).href)};
        if (${migrated}) markTasksStorageMigrated(process.argv[1]);
        const repo = new ${Repo.name}(process.argv[1], 3000);
        let ticks = 0;
        const timer = setInterval(() => ticks++, 20);
        process.stdout.write('starting\\n');
        try {
          await Promise.all([repo.ensureReady(), repo.ensureReady()]);
          process.stdout.write(JSON.stringify({ ticks }) + '\\n');
        } finally { clearInterval(timer); repo.close(); }
      `,
              path,
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let stdout = "";
          let stderr = "";
          let releasing = false;
          worker.stdout!.on("data", (data) => {
            stdout += String(data);
            if (!releasing && stdout.includes("starting\n")) {
              releasing = true;
              child!.stdin!.end("release");
            }
          });
          worker.stderr!.on("data", (data) => {
            stderr += String(data);
          });
          const [code] = await once(worker, "close");
          assert.equal(code, 0, stderr);
          const { ticks } = JSON.parse(stdout.trim().split("\n").at(-1)!);
          assert.ok(ticks >= 3, `waiting must yield to timers, ticks=${ticks}`);
        } finally {
          if (worker && worker.exitCode === null) {
            worker.kill();
            await once(worker, "close");
          }
          if (child && child.exitCode === null) {
            child.kill();
            await once(child, "close");
          }
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
  }
}

test("non-lock initialization errors propagate once and lock budget exhaustion keeps the original error", async () => {
  for (const code of [undefined, 10, 5, 517]) {
    const failure = Object.assign(new Error("synthetic sqlite failure"), { errcode: code });
    let attempts = 0;
    let releases = 0;
    await assert.rejects(
      retryTasksDatabaseInitialization(
        async () => {
          attempts++;
          throw failure;
        },
        () => {
          releases++;
        },
        0,
      ),
      (error) => error === failure,
    );
    assert.equal(attempts, 1);
    assert.equal(releases, code === 5 || code === 517 ? 1 : 0);
  }
});
