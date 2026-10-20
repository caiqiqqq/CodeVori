import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

const workspace = { workspacePath: "/fixture/project" };
const connect: AcpConnectionFactory = async () => ({
  sessionId: "native-one",
  configOptions: [],
  modeState: null,
  async setConfigOption() {
    return [];
  },
  async setMode() {},
  async prompt() {},
  async cancel() {},
  close() {},
});

test("ACP archive scopes survive closed tabs; restored conversation is never deleted by old confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-archive-"));
  const service = createAcpService({ directory, connect });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: session.id };
    await service.prompt({
      ...target,
      commandId: "first",
      text: "history",
      attachments: [],
      workspaceFiles: [],
    });
    await service.updateRow({ ...target, action: { kind: "archive", archived: true } });
    assert.deepEqual(await service.listArchivedWorkspaces(), [workspace]);
    await assert.rejects(
      service.submitPrompt({
        ...target,
        commandId: "second",
        text: "blocked",
        attachments: [],
        workspaceFiles: [],
      }),
      /Restore/,
    );
    await service.updateRow({ ...target, action: { kind: "archive", archived: false } });
    assert.equal(await service.removeArchived(target), false);
    assert.ok(await service.read(target));
    await service.updateRow({ ...target, action: { kind: "archive", archived: true } });
    assert.equal(await service.removeArchived(target), true);
    assert.equal(await service.removeArchived(target), true);
    assert.deepEqual(await service.list(workspace), []);
    assert.deepEqual(await service.listArchivedWorkspaces(), []);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed ACP cleanup retains pending snapshot, blocks restore and can retry after Host restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-purge-retry-"));
  let service = createAcpService({ directory, connect });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: session.id };
    await service.prompt({
      ...target,
      commandId: "first",
      text: "history",
      attachments: [],
      workspaceFiles: [],
    });
    await service.updateRow({ ...target, action: { kind: "archive", archived: true } });
    const path = await service.getDiagnosticLogPath(target);
    await rm(path);
    await mkdir(path); // 可重复的清理 IO 失败，不依赖平台 chmod 或计时。
    await assert.rejects(service.removeArchived(target));
    assert.equal(
      JSON.parse(await readFile(join(directory, `${session.id}.json`), "utf8")).deletionState,
      "pending",
    );
    service.disposeAll();
    service = createAcpService({ directory, connect });
    await assert.rejects(
      service.updateRow({ ...target, action: { kind: "archive", archived: false } }),
      /deletion/,
    );
    await assert.rejects(service.setGoal({ ...target, goal: "cannot mutate pending" }), /deletion/);
    await rm(path, { recursive: true });
    assert.equal(await service.removeArchived(target), true);
    await assert.rejects(readFile(join(directory, `${session.id}.json`)), { code: "ENOENT" });
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP deletion refuses live linked work without stopping children", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-purge-linked-"));
  let stopped = 0;
  let canPurge = false;
  const service = createAcpService({
    directory,
    connect,
    delegation: {
      register: async () => undefined,
      onInput: async () => {},
      onResultInput: async () => {},
      canPurge: async () => canPurge,
      onStop: async () => {
        stopped++;
      },
    },
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: session.id };
    await service.prompt({
      ...target,
      commandId: "first",
      text: "history",
      attachments: [],
      workspaceFiles: [],
    });
    await service.updateRow({ ...target, action: { kind: "archive", archived: true } });
    assert.equal(await service.removeArchived(target), false);
    assert.equal(stopped, 0);
    assert.equal((await service.read(target)).deletionState, undefined);
    canPurge = true;
    assert.equal(await service.removeArchived(target), true);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
