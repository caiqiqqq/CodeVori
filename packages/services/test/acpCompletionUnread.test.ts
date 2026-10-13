import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import { createAcpService } from "../src/acp/acpServiceImpl.js";

const workspace = { workspacePath: "/synthetic/unread", workspaceIdentity: "host:one" };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acp-completion-unread-"));
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const create = () =>
    createAcpService({
      directory,
      connect: async () => ({
        sessionId: "synthetic-native",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt(text) {
          if (text === "fail") throw new Error("synthetic failure");
          if (text === "hold") {
            start();
            await held;
          }
        },
        async cancel() {
          finish();
        },
        close() {
          finish();
        },
      }),
    });
  let service = create();
  const session = await service.create({ ...workspace, agent: "codex" });
  const target = { ...workspace, id: session.id };
  return {
    target,
    started,
    finish,
    get service() {
      return service;
    },
    disk: async () =>
      JSON.parse(await readFile(join(directory, `${session.id}.json`), "utf8")) as AcpSession,
    seed: async (snapshot: AcpSession) =>
      writeFile(join(directory, `${session.id}.json`), JSON.stringify(snapshot)),
    async restart() {
      await service.disposeAllAndWait();
      service = create();
    },
    async dispose() {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("ACP completion atomically persists unread and restores it without replaying a turn", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.service.read(f.target)).unreadAt, null);
    const events: AcpSession[] = [];
    const subscription = f.service.onDynamicSessionSummaryChanged(workspace)((change) => {
      if (change.kind === "updated") events.push(change.session);
    });
    const result = await f.service.prompt({ ...f.target, commandId: "one", text: "complete" });
    subscription.dispose();
    assert.equal(result.status, "idle");
    assert.equal(typeof result.unreadAt, "number");
    assert.equal((await f.disk()).unreadAt, result.unreadAt);
    assert.equal(events.at(-1)?.unreadAt, result.unreadAt);
    const duplicate = await f.service.prompt({ ...f.target, commandId: "one", text: "complete" });
    assert.equal(duplicate.unreadAt, result.unreadAt);
    await f.restart();
    assert.equal((await f.service.listSummaries(workspace))[0]?.unreadAt, result.unreadAt);
  } finally {
    await f.dispose();
  }
});

test("explicit stop does not create completion unread and stale stopped runs cannot recreate it", async () => {
  const f = await fixture();
  try {
    const turn = f.service.prompt({ ...f.target, commandId: "stopped", text: "hold" });
    await f.started;
    await f.service.stop(f.target);
    await turn;
    assert.equal((await f.service.read(f.target)).unreadAt, null);
    assert.equal((await f.disk()).unreadAt, null);
  } finally {
    await f.dispose();
  }
});

test("loading a crashed running snapshot does not invent a successful completion unread", async () => {
  const f = await fixture();
  try {
    await f.service.prompt({ ...f.target, commandId: "one", text: "complete" });
    await f.service.updateRow({ ...f.target, action: { kind: "unread", unread: false } });
    await f.seed({ ...(await f.disk()), status: "running" });
    await f.restart();
    const restored = await f.service.read(f.target);
    assert.equal(restored.status, "interrupted");
    assert.equal(restored.unreadAt, null);
  } finally {
    await f.dispose();
  }
});

test("archived running conversation does not acquire completion unread", async () => {
  const f = await fixture();
  try {
    const turn = f.service.prompt({ ...f.target, commandId: "archived", text: "hold" });
    await f.started;
    await f.service.updateRow({ ...f.target, action: { kind: "archive", archived: true } });
    f.finish();
    const completed = await turn;
    assert.equal(completed.archived, true);
    assert.equal(completed.unreadAt, null);
  } finally {
    await f.dispose();
  }
});

test("late read acknowledgement cannot clear a newer ACP terminal result", async () => {
  const f = await fixture();
  try {
    const first = await f.service.prompt({ ...f.target, commandId: "one", text: "complete" });
    const second = await f.service.prompt({ ...f.target, commandId: "two", text: "complete" });
    assert.ok(second.unreadAt! > first.unreadAt!);
    const stale = await f.service.updateRow({
      ...f.target,
      action: { kind: "unread", unread: false, expectedUnreadAt: first.unreadAt! },
    });
    assert.equal(stale.unreadAt, second.unreadAt);
    assert.equal(stale.revision, second.revision);
    await assert.rejects(
      f.service.updateRow({
        ...f.target,
        workspaceIdentity: "host:two",
        action: { kind: "unread", unread: false },
      }),
      /does not belong/,
    );
    const read = await f.service.updateRow({
      ...f.target,
      action: { kind: "unread", unread: false, expectedUnreadAt: second.unreadAt! },
    });
    assert.equal(read.unreadAt, null);
    assert.equal((await f.disk()).unreadAt, null);
    const manual = await f.service.updateRow({
      ...f.target,
      action: { kind: "unread", unread: true },
    });
    assert.equal(typeof manual.unreadAt, "number");
    await f.service.updateRow({ ...f.target, action: { kind: "unread", unread: false } });
    assert.equal((await f.disk()).unreadAt, null, "legacy callers retain unconditional clear");
  } finally {
    await f.dispose();
  }
});

test("failed ACP turns persist unread too, without metadata changes recreating it", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.service.prompt({ ...f.target, commandId: "failed", text: "fail" }),
      /synthetic failure/,
    );
    const failed = await f.service.read(f.target);
    assert.equal(failed.status, "interrupted");
    assert.equal(typeof failed.unreadAt, "number");
    await f.service.updateRow({ ...f.target, action: { kind: "unread", unread: false } });
    const renamed = await f.service.updateRow({
      ...f.target,
      action: { kind: "rename", title: "Read failure" },
    });
    assert.equal(renamed.unreadAt, null);
    await f.restart();
    assert.equal((await f.service.read(f.target)).unreadAt, null);
  } finally {
    await f.dispose();
  }
});
