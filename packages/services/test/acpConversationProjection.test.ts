import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, buildAcpConversationRows, summarizeAcpSession } from "@zcode/shared";
import {
  applyConversationDeltas,
  reassembleTopicWireFrames,
  conversationTopicFrameSchema,
  v4ConversationRowsRangeResultSchema,
} from "@zcode/shared/zcode-protocol-v4";
import { AcpConversationProjection } from "../src/acp/acpConversationProjection.js";

test("navigator pages contain only bounded previews with stable cursor and recovery epoch", () => {
  const source = session();
  source.entries.splice(1, 0, {
    id: "large-tool",
    kind: "tool",
    title: "tool",
    status: "completed",
    content: "SECRET".repeat(100000),
  });
  const projection = new AcpConversationProjection(source, "host");
  let before = projection.tail().rows.window[0]!.rowId;
  const found = [];
  for (;;) {
    const page = projection.rowsRange(before, 200, true);
    v4ConversationRowsRangeResultSchema.parse(page);
    assert.equal(page.atLogEpoch, projection.tail().logEpoch);
    assert.ok(page.rows.length <= 200);
    for (const row of page.rows) {
      assert.ok(row.kind === "userInput" || row.kind === "assistantText");
      assert.ok(row.text.length <= 220);
      assert.ok(row.rowId < before);
    }
    found.push(...page.rows);
    if (!page.hasMore) break;
    assert.ok(page.rows.length);
    before = page.rows[0]!.rowId;
  }
  assert.ok(found.length > 3000);
  assert.ok(!JSON.stringify(found).includes("SECRET"));
  assert.ok(
    projection
      .rowsRange(undefined, 20000)
      .rows.every((row) => row.kind !== "toolCall" || row.input),
  );
});

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

test("ACP tool rows resolve terminal output from the Host snapshot and flag missing history", () => {
  const session = acpSessionSchema.parse({
    workspacePath: "/synthetic/terminal-history",
    id: "terminal-history",
    agent: "codex",
    acpSessionId: "native",
    title: "terminal history",
    revision: 1,
    status: "idle",
    pendingPermission: null,
    error: null,
    entries: [
      { id: "user:1", kind: "user", text: "run", createdAt: 1 },
      {
        id: "tool:1",
        kind: "tool",
        title: "run command",
        status: "completed",
        terminalIds: ["saved", "missing"],
        content: "terminal:saved\nterminal:missing",
      },
    ],
    terminals: [
      {
        terminalId: "saved",
        title: "run command",
        status: "finished",
        startedAt: 2,
        output: "first line\nsecond line",
        truncated: true,
      },
    ],
  });
  const row = buildAcpConversationRows(session).find((item) => item.kind === "toolCall");
  assert.ok(row?.kind === "toolCall");
  const displayEntry = row.input as {
    terminalOutput?: string;
    terminalOutputUnavailable?: boolean;
    terminalOutputTruncated?: boolean;
  };
  assert.equal(displayEntry.terminalOutput, "first line\nsecond line");
  assert.equal(displayEntry.terminalOutputUnavailable, true);
  assert.equal(displayEntry.terminalOutputTruncated, true);

  const oversizedSession = structuredClone(session);
  const oversizedTool = oversizedSession.entries[1];
  assert.equal(oversizedTool?.kind, "tool");
  if (oversizedTool?.kind !== "tool") throw new Error("missing tool entry");
  oversizedTool.terminalIds = ["large"];
  oversizedTool.content = "terminal:large";
  oversizedSession.terminals = [
    {
      terminalId: "large",
      title: "large output",
      status: "finished",
      startedAt: 2,
      output: "界".repeat(30_000),
      truncated: false,
    },
  ];
  const oversizedRow = buildAcpConversationRows(oversizedSession).find(
    (item) => item.kind === "toolCall",
  );
  assert.ok(oversizedRow?.kind === "toolCall");
  const oversizedDisplayEntry = oversizedRow.input as {
    terminalOutput?: string;
    terminalOutputTruncated?: boolean;
  };
  assert.ok(new TextEncoder().encode(oversizedDisplayEntry.terminalOutput).byteLength <= 64 * 1024);
  assert.equal(oversizedDisplayEntry.terminalOutput?.endsWith("界"), true);
  assert.equal(oversizedDisplayEntry.terminalOutputTruncated, true);

  const runningSession = structuredClone(session);
  runningSession.status = "running";
  const runningTool = runningSession.entries[1];
  assert.equal(runningTool?.kind, "tool");
  if (runningTool?.kind !== "tool") throw new Error("missing tool entry");
  runningTool.status = "in_progress";
  runningSession.terminals = [];
  const runningRow = buildAcpConversationRows(runningSession).find(
    (item) => item.kind === "toolCall",
  );
  assert.ok(runningRow?.kind === "toolCall");
  assert.equal(
    (runningRow.input as { terminalOutputUnavailable?: boolean }).terminalOutputUnavailable,
    false,
  );
});
