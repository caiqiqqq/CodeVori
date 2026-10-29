import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import type { ZCodeTaskMeta } from "@zcode/shared";

test("board completion is scoped, durable, and protected from stale runtime snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-board-completion-"));
  let repo = new TaskIndexRepo(join(directory, "tasks.sqlite"));
  const meta: ZCodeTaskMeta = {
    taskId: "same",
    traceId: "test",
    title: "Test",
    workspacePath: "/same",
    workspaceIdentity: "remote:ssh:a",
    createdAt: 1,
    updatedAt: 100,
    mode: "guarded",
    status: "completed",
  };
  try {
    await repo.syncTaskMeta({ meta });
    await repo.syncTaskMeta({ meta: { ...meta, workspaceIdentity: "remote:ssh:b" } });
    await repo.setBoardCompletion({ ...meta, completed: true, expectedUpdatedAt: 100 });
    await repo.syncTaskMeta({ meta: { ...meta, boardCompletedAt: undefined } });
    assert.equal((await repo.getTaskMeta(meta))?.boardCompletedAt, 100);
    assert.equal(
      (await repo.getTaskMeta({ ...meta, workspaceIdentity: "remote:ssh:b" }))?.boardCompletedAt,
      undefined,
    );
    repo.close();
    repo = new TaskIndexRepo(join(directory, "tasks.sqlite"));
    assert.equal((await repo.getTaskMeta(meta))?.boardCompletedAt, 100);
    await repo.applyAgentPatch({ ...meta, patch: { status: "running", updatedAt: 200 } });
    await assert.rejects(
      repo.setBoardCompletion({ ...meta, completed: true, expectedUpdatedAt: 100 }),
    );
    await repo.applyAgentPatch({ ...meta, patch: { status: "completed", updatedAt: 300 } });
    await assert.rejects(
      repo.setBoardCompletion({ ...meta, completed: true, expectedUpdatedAt: 100 }),
    );
    await repo.setBoardCompletion({ ...meta, completed: false, expectedUpdatedAt: 300 });
    await repo.syncTaskMeta({ meta: { ...meta, boardCompletedAt: 100 } });
    assert.equal((await repo.getTaskMeta(meta))?.boardCompletedAt, undefined);
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP completion uses the Host queue gate and persists through reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-board-"));
  const connect: AcpConnectionFactory = async () => ({
    sessionId: "native",
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
  let service = createAcpService({ directory, connect });
  const scope = { workspacePath: "/fixture" };
  try {
    const session = await service.create({ ...scope, agent: "codex" });
    await service.prompt({ ...scope, id: session.id, commandId: "first", text: "hello" });
    const summary = (await service.listSummaries(scope))[0];
    const target = { ...scope, id: session.id };
    await assert.rejects(
      service.updateRow({
        ...target,
        action: { kind: "completion", completed: true, expectedUpdatedAt: 0 },
      }),
    );
    await service.updateRow({
      ...target,
      action: { kind: "completion", completed: true, expectedUpdatedAt: summary.history.updatedAt },
    });
    service.disposeAll();
    service = createAcpService({ directory, connect });
    assert.equal((await service.read(target)).boardCompletedAt, summary.history.updatedAt);
    await service.updateRow({
      ...target,
      action: {
        kind: "completion",
        completed: false,
        expectedUpdatedAt: summary.history.updatedAt,
      },
    });
    assert.equal((await service.read(target)).boardCompletedAt, undefined);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
