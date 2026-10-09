import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

test("ACP Host terminal output survives idle turns and replay; restart interrupts stale handles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-terminal-snapshots-"));
  let update!: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  let connections = 0;
  const stops: string[] = [];
  const workspace = {
    workspacePath: directory,
    workspaceIdentity: "fixture:terminal",
    remoteSessionId: "fixture-remote",
  };
  const connect: AcpConnectionFactory = async (input) => {
    connections++;
    update = input.onUpdate;
    return {
      sessionId: "native",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async cancel() {},
      close() {},
      async prompt() {
        await update({
          kind: "terminal",
          terminal: {
            terminalId: "exact",
            title: "node server",
            status: "running",
            startedAt: 10,
            output: "ready",
            truncated: false,
          },
        });
      },
      async stopTerminal(id) {
        stops.push(id);
        await update({
          kind: "terminal",
          terminal: {
            terminalId: id,
            title: "node server",
            status: "finished",
            startedAt: 10,
            output: "ready\nstopped",
            truncated: false,
            exitCode: null,
            signal: "SIGTERM",
          },
        });
      },
    };
  };
  let service = createAcpService({ directory, connect });
  try {
    const draft = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: draft.id };
    await service.prompt({
      ...target,
      commandId: "11111111-1111-4111-8111-111111111111",
      text: "start",
    });
    const idle = await service.read(target);
    assert.equal(idle.status, "idle");
    assert.equal(idle.terminals[0]?.status, "running");
    await update({
      kind: "terminal",
      terminal: { ...idle.terminals[0]!, output: "ready\nnew output" },
    });
    assert.equal((await service.read(target)).terminals[0]?.output, "ready\nnew output");
    await assert.rejects(
      service.stopTerminal({ ...target, workspaceIdentity: "fixture:other", terminalId: "exact" }),
    );
    await assert.rejects(service.stopTerminal({ ...target, terminalId: "wrong" }));
    await service.stopTerminal({ ...target, terminalId: "exact" });
    await service.stopTerminal({ ...target, terminalId: "exact" });
    assert.deepEqual(stops, ["exact"]);
    await update({
      kind: "terminal",
      terminal: { ...idle.terminals[0]!, terminalId: "restart", output: "still running" },
    });
    const crashed = await service.read(target);
    await service.disposeAllAndWait();
    // 模拟 Host 来不及写入退出状态的崩溃磁盘快照；新 Host 不能复活运行句柄。
    await writeFile(join(directory, `${draft.id}.json`), JSON.stringify(crashed));
    service = createAcpService({ directory, connect });
    const replay = await service.read(target);
    assert.equal(replay.terminals[0]?.status, "finished");
    assert.equal(replay.terminals[1]?.status, "interrupted");
    assert.equal(replay.terminals[1]?.output, "still running");
    assert.equal(connections, 1, "read and terminal controls never reconnect");
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
