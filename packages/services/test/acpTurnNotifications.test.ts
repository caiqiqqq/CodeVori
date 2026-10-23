import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acpSessionSchema,
  summarizeAcpSession,
  type AcpSession,
  type AcpStopReason,
} from "@zcode/shared";
import { finishAcpTurn } from "../src/acp/acpConversationEntries.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";

test("turn completion and summaries preserve the first outcome on the exact admitted row", () => {
  const session = acpSessionSchema.parse({
    workspacePath: "/fixture",
    id: "one",
    agent: "codex",
    acpSessionId: "native",
    status: "idle",
    revision: 1,
    title: "fixture",
    pendingPermission: null,
    error: null,
    entries: [
      { id: "user:one", kind: "user", text: "old" },
      { id: "user:two", kind: "user", text: "new" },
    ],
  });
  finishAcpTurn(session, "one", 10, "cancelled");
  finishAcpTurn(session, "one", 20, "end_turn");
  assert.equal(session.entries[0]?.kind === "user" && session.entries[0].stopReason, "cancelled");
  assert.equal(session.entries[0]?.kind === "user" && session.entries[0].endedAt, 10);
  assert.equal(
    summarizeAcpSession(session).entries[0]?.kind === "user" &&
      summarizeAcpSession(session).entries[0].stopReason,
    undefined,
  );
  finishAcpTurn(session, "two", 30, "end_turn");
  const summary = summarizeAcpSession(acpSessionSchema.parse(session));
  assert.equal(summary.entries[0]?.kind === "user" && summary.entries[0].stopReason, "end_turn");
  assert.equal(summary.entries[0]?.kind === "user" && summary.entries[0].endedAt, 30);
  assert.equal(
    acpSessionSchema.safeParse({
      ...session,
      entries: [{ id: "user:bad", kind: "user", text: "bad", stopReason: "invalid" }],
    }).success,
    false,
  );
});

test("Host publishes and persists a later successful turn while historical queue pauses remain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-turn-outcome-"));
  const workspace = { workspacePath: "/fixture/paused-notifications" };
  let reason: AcpStopReason | undefined = "end_turn";
  let fail = false;
  const service = createAcpService({
    directory,
    connect: async () => ({
      sessionId: "native",
      get lastStopReason() {
        return reason;
      },
      async prompt() {
        if (fail) throw new Error("fixture failure");
      },
      async cancel() {},
      close() {},
    }),
  });
  let published: AcpSession | undefined;
  const subscription = service.onDynamicSessionSummaryChanged(workspace)((change) => {
    if (change.kind === "updated") published = change.session;
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const target = { ...workspace, id: session.id };
    await service.prompt({ ...target, commandId: "first", text: "first" });
    await service.stop(target);
    for (const stopReason of ["end_turn", undefined] as const) {
      reason = stopReason;
      await service.prompt({ ...target, commandId: `continued-${stopReason}`, text: "continue" });
      const completed = await service.read(target);
      assert.equal(completed.status, "idle");
      assert.equal(completed.queue.autoDrain, false);
      assert.equal(completed.queue.pauseReason, "stopped");
      const user = completed.entries.findLast((entry) => entry.kind === "user");
      assert.equal(user?.kind === "user" && user.stopReason, "end_turn");
    }
    fail = true;
    await assert.rejects(
      service.prompt({ ...target, commandId: "failed", text: "fail" }),
      /fixture failure/,
    );
    assert.equal((await service.read(target)).queue.pauseReason, "error");
    fail = false;
    await service.prompt({ ...target, commandId: "after-error", text: "recover" });
    const summary = (await service.listSummaries(workspace))[0]!;
    assert.equal(summary.queue.pauseReason, "error");
    assert.equal(summary.error, null);
    assert.equal(summary.entries[0]?.kind === "user" && summary.entries[0].stopReason, "end_turn");
    assert.equal(
      published?.entries[0]?.kind === "user" && published.entries[0].stopReason,
      "end_turn",
    );
    const stored = acpSessionSchema.parse(
      JSON.parse(await readFile(join(directory, `${session.id}.json`), "utf8")),
    );
    assert.equal(stored.entries.findLast((entry) => entry.kind === "user")?.stopReason, "end_turn");
  } finally {
    subscription.dispose();
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
