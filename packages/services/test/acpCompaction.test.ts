import assert from "node:assert/strict";
import test from "node:test";
import { acpEntrySchema, type AcpSession } from "@zcode/shared";
import {
  applyAcpCompaction,
  interruptAcpCompactions,
  projectLegacyCompaction,
  projectTypedCompaction,
} from "../src/acp/acpCompaction.js";

test("explicit legacy metadata is recognized without guessing from tool titles", () => {
  assert.deepEqual(
    projectLegacyCompaction({
      toolCallId: "air",
      status: "completed",
      _meta: { jetbrains: { air: { version: 1, contextCompaction: { version: 1 } } } },
    }),
    { kind: "compaction", id: "air", status: "success" },
  );
  assert.equal(
    projectLegacyCompaction({ toolCallId: "x", title: "Compact conversation" }),
    undefined,
  );
  for (const meta of [false, {}, { version: 0 }, { version: 1.5 }, "true"]) {
    assert.equal(
      projectLegacyCompaction({ toolCallId: "x", _meta: { contextCompaction: meta } }),
      undefined,
    );
  }
  assert.deepEqual(
    projectLegacyCompaction({
      toolCallId: "x",
      status: "completed",
      _meta: {
        contextCompaction: { version: 1, trigger: "auto", preTokens: 100, postTokens: 20 },
      },
    }),
    {
      kind: "compaction",
      id: "x",
      status: "success",
      origin: "auto",
      tokensBefore: 100,
      tokensAfter: 20,
    },
  );
  assert.deepEqual(
    projectLegacyCompaction({
      toolCallId: "x",
      _meta: {
        contextCompaction: true,
        tokensBefore: -1,
        tokensAfter: 0,
      },
    }),
    { kind: "compaction", id: "x", tokensAfter: 0 },
  );
  assert.deepEqual(projectLegacyCompaction({ toolCallId: "x", status: "failed" }, true), {
    kind: "compaction",
    id: "x",
    status: "failed",
  });
});

test("Host upserts in place, bounds summary, preserves patches and never reopens a terminal entry", () => {
  const session: Pick<AcpSession, "entries"> = { entries: [] };
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "x", status: "in_progress" }),
    10,
  );
  applyAcpCompaction(
    session,
    "cmd",
    { kind: "compaction_summary", id: "missing", text: "orphan" },
    11,
  );
  applyAcpCompaction(
    session,
    "cmd",
    { kind: "compaction_summary", id: "x", text: "a".repeat(40_000) },
    12,
  );
  applyAcpCompaction(session, "cmd", { kind: "compaction_summary", id: "x", text: "overflow" }, 13);
  assert.equal(session.entries.length, 1);
  const entry = session.entries[0]!;
  assert.equal(entry.kind, "compaction");
  if (entry.kind !== "compaction") throw new Error("missing entry");
  assert.equal(entry.summary?.length, 32_000);
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({
      compactionId: "x",
      status: "completed",
      summary: [{ type: "text", text: "retained" }],
    }),
    20,
  );
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "x", status: "completed" }),
    21,
  );
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "x", status: "in_progress" }),
    22,
  );
  applyAcpCompaction(session, "cmd", { kind: "compaction_summary", id: "x", text: "late" }, 23);
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "x", status: "failed", error: "late" }),
    24,
  );
  assert.equal(entry.status, "success");
  assert.equal(entry.summary, "retained");
  assert.equal(entry.createdAt, 10);
  applyAcpCompaction(session, "cmd", { kind: "compaction", id: "x", tokensAfter: 0 }, 24);
  assert.equal(entry.tokensAfter, 0, "terminal metadata-only legacy patches remain valid");
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "x", status: "completed", summary: null }),
    25,
  );
  assert.equal(entry.summary, undefined);
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "y", status: "failed", error: "failure" }),
    26,
  );
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "y", status: "failed", error: null }),
    27,
  );
  const failed = session.entries[1]!;
  assert.equal(failed.kind === "compaction" && failed.error, undefined);
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "z", status: "future" }),
    28,
  );
  interruptAcpCompactions(session);
  assert.equal(session.entries[2]?.kind === "compaction" && session.entries[2].status, "cancelled");
  assert.deepEqual(
    session.entries.map((e) => acpEntrySchema.parse(e)),
    session.entries,
  );
});

test("late legacy metadata converts the original tool at its position; explicit unknown facts stay absent", () => {
  const session: Pick<AcpSession, "entries"> = {
    entries: [
      { kind: "tool", id: "tool:cmd:x", title: "legacy", status: "in_progress", createdAt: 10 },
      { kind: "assistant", id: "answer", text: "after tool" },
    ],
  };
  applyAcpCompaction(
    session,
    "cmd",
    projectLegacyCompaction({
      toolCallId: "x",
      status: "completed",
      _meta: {
        contextCompaction: { version: 1, trigger: "unknown", preTokens: Infinity, postTokens: -1 },
      },
    })!,
    20,
  );
  assert.equal(session.entries.length, 2);
  const entry = session.entries[0]!;
  assert.equal(entry.kind, "compaction");
  assert.equal(entry.createdAt, 10);
  if (entry.kind !== "compaction") throw new Error("missing entry");
  assert.equal(entry.origin, undefined);
  assert.equal(entry.tokensBefore, undefined);
  assert.equal(entry.tokensAfter, undefined);
});

test("typed metadata replacement clears absent facts, summaries reject invalid lifecycle and schema rejects bad facts", () => {
  const session: Pick<AcpSession, "entries"> = { entries: [] };
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({
      compactionId: "x",
      status: "in_progress",
      _meta: { origin: "auto", tokensBefore: 100, tokensAfter: 20 },
      summary: [{ type: "text", text: "invalid" }],
    }),
    10,
  );
  const entry = session.entries[0]!;
  if (entry.kind !== "compaction") throw new Error("missing entry");
  assert.equal(entry.origin, "auto");
  assert.equal(entry.summary, undefined);
  applyAcpCompaction(
    session,
    "cmd",
    projectLegacyCompaction({ toolCallId: "x", _meta: { contextCompaction: true } })!,
    11,
  );
  assert.equal(session.entries.length, 1, "typed and legacy formats share one ID");
  applyAcpCompaction(
    session,
    "cmd",
    projectTypedCompaction({ compactionId: "x", status: "completed", _meta: {} }),
    12,
  );
  assert.equal(entry.origin, undefined);
  assert.equal(entry.tokensBefore, undefined);
  assert.equal(entry.tokensAfter, undefined);
  for (const patch of [
    { tokensBefore: -1 },
    { tokensAfter: Infinity },
    { status: "completed" },
    { summary: "x".repeat(32_001) },
  ]) {
    assert.equal(acpEntrySchema.safeParse({ ...entry, ...patch }).success, false);
  }
});
