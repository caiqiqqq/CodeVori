import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { NativeMcpServerRecord } from "@zcode/shared";
import { createAcpService } from "../src/acp/acpServiceImpl.js";

async function toolsStatus(server: NativeMcpServerRecord) {
  const env = server.config.env!;
  return (
    await fetch(env.ZCODE_WORKFLOW_URL!, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  ).status;
}

test("failed ACP handshake revokes attachment capability before exposing a session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-attachment-handshake-"));
  let server: NativeMcpServerRecord | undefined;
  const service = createAcpService({
    directory,
    connect: async (input) => {
      server = input.workflowServers?.find((record) => record.name === "zcode-attachments");
      throw new Error("fixture handshake failure");
    },
  });
  try {
    await assert.rejects(
      service.create({ workspacePath: directory, agent: "codex" }),
      /fixture handshake failure/,
    );
    assert.ok(server);
    assert.equal(await toolsStatus(server), 403);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Host disposal revokes attachments before a pending connection completes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-attachment-late-connect-"));
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  const connecting = new Promise<void>((done) => {
    started = done;
  });
  let server: NativeMcpServerRecord | undefined;
  let closed = 0;
  const service = createAcpService({
    directory,
    connect: async (input) => {
      server = input.workflowServers?.find((record) => record.name === "zcode-attachments");
      started();
      await pending;
      return {
        sessionId: "late",
        configOptions: [],
        modeState: null,
        setConfigOption: async () => [],
        setMode: async () => {},
        prompt: async () => {},
        cancel: async () => {},
        close() {
          closed++;
        },
      };
    },
  });
  const creation = service.create({ workspacePath: directory, agent: "codex" });
  const rejected = assert.rejects(creation, /closed|connecting/);
  try {
    await connecting;
    assert.ok(server);
    assert.equal(await toolsStatus(server), 200);
    service.disposeAll();
    // Host 已关闭监听器时，连接拒绝与仍存活监听器的 403 都表示旧能力不可用。
    try {
      assert.equal(await toolsStatus(server), 403);
    } catch (error) {
      assert.equal((error as Error & { cause?: { code?: string } }).cause?.code, "ECONNREFUSED");
    }
    release();
    await rejected;
    assert.equal(closed, 1);
  } finally {
    release();
    await rejected;
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
