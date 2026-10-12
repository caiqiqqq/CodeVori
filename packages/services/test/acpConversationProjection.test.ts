import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, buildAcpConversationRows, summarizeAcpSession } from "@zcode/shared";
import {
  applyConversationDeltas,
  reassembleTopicWireFrames,
  conversationTopicFrameSchema,
} from "@zcode/shared/zcode-protocol-v4";
import { AcpConversationProjection } from "../src/acp/acpConversationProjection.js";

function session() {
  return acpSessionSchema.parse({
    workspacePath: "/synthetic/projection",
    id: "projection",
    agent: "codex",
    acpSessionId: "native",
    title: "synthetic",
    revision: 1,
    status: "running",
    pendingPermission: null,
    error: null,
    entries: Array.from({ length: 3440 }, (_, index) =>
      index % 2 === 0
        ? { id: `user:${index}`, kind: "user", text: "历史".repeat(800), createdAt: index + 1 }
        : {
            id: `assistant:${index}`,
            kind: "assistant",
            text: "回复".repeat(800),
            createdAt: index + 1,
          },
    ),
  });
}

test("ACP reuses V4 row deltas, bounded tail and stable paging for six MiB history", () => {
  const first = session();
  const projection = new AcpConversationProjection(first, "host");
  const snapshot = projection.tail();
  assert.equal(snapshot.rows.window.length, 60);
  assert.deepEqual(snapshot.rows.window, buildAcpConversationRows(first).slice(-60));
  const next = structuredClone(first);
  next.revision += 32;
  const last = next.entries.at(-1)!;
  assert.ok(last.kind === "assistant");
  last.text += "新";
  const deltas = projection.update(next, true);
  assert.deepEqual(deltas.slice(0, 1), [
    { op: "row.delta", rowId: 6880, path: "text", append: "新" },
  ]);
  assert.deepEqual(
    applyConversationDeltas(snapshot, deltas).rows.window,
    buildAcpConversationRows(next).slice(-60),
  );
  assert.ok(JSON.stringify(deltas).length < 200);
  assert.ok(JSON.stringify(summarizeAcpSession(next)).length < 3000);
  const page = projection.rowsRange(snapshot.rows.window[0]!.rowId, 200);
  assert.equal(page.rows.length, 200);
  assert.equal(page.atRevision, next.revision);
  assert.equal(page.hasMore, true);
  assert.ok(page.rows.at(-1)!.rowId < snapshot.rows.window[0]!.rowId);
  const frame = projection.frame("subscription", "initial");
  const assembled = reassembleTopicWireFrames(frame, conversationTopicFrameSchema);
  assert.ok(assembled.kind === "complete");
  assert.equal(assembled.frame.payload.kind, "snapshot");
});

test("state, thought, tools and terminal changes match the existing ACP mapper", () => {
  const first = session();
  first.entries = first.entries.slice(0, 2);
  const projection = new AcpConversationProjection(first, "host");
  let applied = projection.tail();
  for (const kind of ["thought", "tool", "plan", "compaction"] as const) {
    first.revision++;
    first.entries.push(
      kind === "thought"
        ? { id: kind, kind, text: "思考", state: "streaming" }
        : kind === "tool"
          ? { id: kind, kind, title: "工具", status: "running" }
          : kind === "plan"
            ? { id: kind, kind, entries: [] }
            : { id: kind, kind, status: "running" },
    );
    applied = applyConversationDeltas(applied, projection.update(first, true));
    assert.deepEqual(applied.rows.window, buildAcpConversationRows(first));
  }
  first.revision++;
  first.status = "interrupted";
  first.error = "合成错误";
  applied = applyConversationDeltas(applied, projection.update(first));
  assert.deepEqual(applied.rows.window, buildAcpConversationRows(first));
  assert.equal(projection.update(first).length, 0, "duplicate revision is inert");
});
