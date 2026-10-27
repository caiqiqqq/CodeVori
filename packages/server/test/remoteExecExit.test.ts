import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { constants } from "node:os";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { Client, type ClientChannel } from "ssh2";
import { DockerBackend } from "../src/remote/docker-backend.js";
import { SSHBackend } from "../src/remote/ssh-backend.js";
import { WSLBackend } from "../src/remote/wsl-backend.js";
import { waitForClose } from "../src/remote/deployShared.js";

type BackendKind = "ssh" | "wsl" | "docker";

async function fixture(t: TestContext, kind: BackendKind) {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  t.mock.method(console, "warn", () => {});
  if (kind === "ssh") {
    t.mock.method(Client.prototype, "connect", function (this: Client) {
      queueMicrotask(() => this.emit("ready"));
      return this;
    });
    t.mock.method(Client.prototype, "end", function (this: Client) {
      return this;
    });
    t.mock.method(
      Client.prototype,
      "exec",
      function (
        this: Client,
        _command: string,
        callback: (error: Error | undefined, channel: ClientChannel) => void,
      ) {
        callback(undefined, process as unknown as ClientChannel);
        return this;
      },
    );
    const backend = new SSHBackend({ host: "example.invalid", username: "fixture" });
    t.after(() => backend.dispose());
    return { process, stream: await backend.exec("fixture command") };
  }
  const backend = kind === "wsl" ? new WSLBackend({}) : new DockerBackend({ container: "fixture" });
  // 只替换平台发现与进程创建，实际 exec 的退出事件及部署成功门禁照常运行。
  const discovery = backend as unknown as {
    ensureAvailable(): Promise<void>;
    resolveInfo(): Promise<unknown>;
  };
  t.mock.method(discovery, "ensureAvailable", async () => {});
  t.mock.method(discovery, "resolveInfo", async () => ({
    containerName: "fixture",
    distroName: "fixture",
    userName: "fixture",
    homeDir: "/tmp/fixture",
  }));
  const spawn = t.mock.method(childProcess, "spawn", () => {
    queueMicrotask(() => process.emit("spawn"));
    return process as unknown as childProcess.ChildProcess;
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
    backend.dispose();
  });
  return { process, stream: await backend.exec("fixture command") };
}

for (const kind of ["ssh", "wsl", "docker"] as const) {
  for (const scenario of [
    { label: "success", code: 0, signal: undefined, expected: 0 },
    { label: "nonzero", code: 23, signal: undefined, expected: 23 },
    { label: "signal", code: null, signal: "SIGTERM", expected: 128 + constants.signals.SIGTERM },
    { label: "unknown signal", code: null, signal: "UNKNOWN", expected: 255 },
    { label: "missing status", code: undefined, signal: undefined, expected: 255 },
  ]) {
    test(`${kind} exec ${scenario.label} preserves failure at deployment gate and replays once`, async (t) => {
      const { process, stream } = await fixture(t, kind);
      const codes: number[] = [];
      stream.onClose((code) => codes.push(code));
      const completion = waitForClose(stream);
      const checked =
        scenario.expected === 0
          ? completion
          : assert.rejects(completion, new RegExp(`exit code ${scenario.expected}`));
      // 无 exit-status 的 channel/child 可能只发 close；其余保留 exit 先到的通知语义。
      if (scenario.label !== "missing status") process.emit("exit", scenario.code, scenario.signal);
      process.emit("close", scenario.code, scenario.signal);
      process.emit("close", 0);
      await checked;
      assert.deepEqual(codes, [scenario.expected]);
      const late = await new Promise<number>((resolve) => stream.onClose(resolve));
      assert.equal(late, scenario.expected);
    });
  }
}

test(
  "real signaled child cannot pass the Docker deployment completion gate",
  { timeout: 5_000 },
  async (t) => {
    const backend = new DockerBackend({ container: "fixture" });
    const discovery = backend as unknown as {
      ensureAvailable(): Promise<void>;
      resolveInfo(): Promise<unknown>;
    };
    t.mock.method(discovery, "ensureAvailable", async () => {});
    t.mock.method(discovery, "resolveInfo", async () => ({ containerName: "fixture" }));
    const originalSpawn = childProcess.spawn;
    let child: childProcess.ChildProcess | undefined;
    const spawn = t.mock.method(childProcess, "spawn", () => {
      // 用真实 Node 子进程代替 docker CLI；只终止自己，不接触外部容器/WSL/SSH。
      child = originalSpawn(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], {
        stdio: "pipe",
      });
      return child;
    });
    syncBuiltinESMExports();
    t.after(() => {
      child?.kill();
      spawn.mock.restore();
      syncBuiltinESMExports();
      backend.dispose();
    });
    const stream = await backend.exec("fixture command");
    await assert.rejects(waitForClose(stream), /exit code 143/);
    assert.equal(child?.exitCode, null);
    assert.equal(child?.signalCode, "SIGTERM");
  },
);
