import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";
import { ZCodeAgentProcessManager } from "../src/zcode-agent/zcodeAgentProcessManager.js";
import { createZCodeAgentConnectionScope } from "../src/zcode-agent/zcodeAgentConnectionScope.js";
import {
  blockHostWorkspaceAgentStarts,
  createZCodeAgentService,
} from "../src/zcode-agent/zcodeAgentService.js";

const command = { command: process.execPath, args: ["-e", "process.stdin.resume()"] };
const unavailable = { code: "ZCODE_AGENT_RUNTIME_UNAVAILABLE" };

test("Host startup barrier gates cold reads without exposing its lease over RPC", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-cleanup-host-port-"));
  const previous = getDataBaseDir();
  setDataBaseDir(dir);
  let starts = 0;
  const service = createZCodeAgentService({
    commandResolver: () => {
      starts++;
      return command;
    },
  });
  const workspace = { workspacePath: dir };
  const lease = blockHostWorkspaceAgentStarts(service, workspace);
  try {
    await assert.rejects(service.prepareStorage(workspace), unavailable);
    assert.equal(starts, 0);
    for (const clientMode of ["desktop-continuous", "web-remote-replayable"] as const) {
      const attachment = createZCodeAgentConnectionScope(service, {
        connectionId: `cleanup-test-${clientMode}`,
        clientMode,
      });
      try {
        const hello = await attachment.service.helloConversationV4();
        assert.equal(hello.clientMode, clientMode);
        assert.equal(
          hello.deliveryProfile,
          clientMode === "desktop-continuous" ? "continuous" : "replayable",
        );
        await attachment.service.initializeConversationV4({
          kind: "clientHello",
          protocolVersion: hello.protocolVersion,
          clientId: `cleanup-test-${clientMode}`,
          appVersion: "test",
        });
        await assert.rejects(
          attachment.service.subscribeConversationV4({
            ...workspace,
            sessionId: "cleanup-session",
          }),
          unavailable,
        );
        assert.equal(starts, 0, `${clientMode} recovery cannot bypass Host cleanup admission`);
      } finally {
        await attachment.dispose();
      }
    }
    const channel = ProxyChannel.fromService(service);
    await assert.rejects(
      async () => channel.call(undefined, "blockWorkspaceStarts", [workspace]),
      /not found/i,
    );
    lease.dispose();
    await service.prepareStorage(workspace);
    assert.equal(starts, 1, "failed/finished cleanup leaves normal reads available");
  } finally {
    lease.dispose();
    await service.disposeAllAndWait();
    setDataBaseDir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace cleanup blocks synchronous lifecycle recovery until Git cleanup releases it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-cleanup-starts-"));
  const workspace = { workspacePath: dir };
  let starts = 0;
  const manager = new ZCodeAgentProcessManager({
    commandResolver: () => {
      starts++;
      return command;
    },
  });
  const available = Promise.withResolvers<void>();
  let recovery: Promise<void> | undefined;
  const events = manager.onRuntimeLifecycle((event) => {
    if (event.state === "available") available.resolve();
    else recovery = assert.rejects(manager.getClient(workspace), unavailable);
  });
  try {
    await manager.getClient(workspace);
    await available.promise;
    const lease = manager.blockWorkspaceStarts(workspace);
    try {
      await manager.disposeWorkspace(workspace);
      assert.ok(recovery, "unavailable observer requested immediate recovery");
      await recovery;
      await assert.rejects(manager.getClient(workspace), unavailable);
      assert.equal(starts, 1, "cleanup must not resolve or spawn a replacement Agent");
    } finally {
      lease.dispose();
    }
    await manager.getClient(workspace);
    assert.equal(starts, 2, "normal startup resumes after releasing cleanup");
  } finally {
    events.dispose();
    await manager.disposeAllAndWait();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const stage of ["command", "environment", "spawn-admission"] as const) {
  test(`cleanup invalidates an in-flight ${stage} resolution even after the barrier releases`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-cleanup-pending-"));
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let first = true;
    let admissions = 0;
    let spawned = 0;
    const pause = async () => {
      if (!first) return;
      first = false;
      entered.resolve();
      await resume.promise;
    };
    const manager = new ZCodeAgentProcessManager({
      commandResolver: async () => {
        if (stage === "command") await pause();
        return command;
      },
      resolveSpawnEnv: async () => {
        if (stage === "environment") await pause();
        return {};
      },
      waitForSpawnAdmission: async () => {
        if (stage === "spawn-admission" && ++admissions === 2) await pause();
      },
    });
    const events = manager.onRuntimeLifecycle((event) => {
      if (event.state === "available") spawned++;
    });
    try {
      const pending = assert.rejects(manager.getClient({ workspacePath: dir }), /cancelled|abort/i);
      await entered.promise;
      const lease = manager.blockWorkspaceStarts({ workspacePath: dir });
      lease.dispose();
      resume.resolve();
      await pending;
      assert.equal(spawned, 0, "old admission cannot revive after cleanup finishes");
      await manager.getClient({ workspacePath: dir });
    } finally {
      resume.resolve();
      events.dispose();
      await manager.disposeAllAndWait();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("startup barriers nest, release idempotently and isolate workspace identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-cleanup-identity-"));
  const manager = new ZCodeAgentProcessManager({ commandResolver: () => command });
  const workspace = { workspacePath: dir };
  const first = manager.blockWorkspaceStarts(workspace);
  const second = manager.blockWorkspaceStarts({ ...workspace, workspaceIdentity: "  " });
  try {
    await assert.rejects(manager.getClient(workspace), unavailable);
    await manager.getClient({ ...workspace, workspaceIdentity: "remote-owner" });
    first.dispose();
    first.dispose();
    await assert.rejects(manager.getClient(workspace), unavailable);
    second.dispose();
    await manager.getClient(workspace);
  } finally {
    first.dispose();
    second.dispose();
    await manager.disposeAllAndWait();
    await rm(dir, { recursive: true, force: true });
  }
});
