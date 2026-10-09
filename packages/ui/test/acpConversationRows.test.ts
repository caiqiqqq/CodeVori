import assert from "node:assert/strict";
import test from "node:test";
import { acpEntrySchema, type AcpSession } from "@zcode/shared";
import { conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { ACP_DISPLAY_TOOL_NAME, buildAcpConversationRows } from "../src/v4/acpConversationRows.ts";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.ts";

const session = (entries: AcpSession["entries"], status: AcpSession["status"] = "idle") =>
  ({ entries, status }) as AcpSession;

test("ACP failure notices stay with the failed turn after later success and legacy trace errors remain visible", () => {
  const entries: AcpSession["entries"] = [
    {
      id: "user:first",
      kind: "user",
      text: "first",
      traceError: "SSE timeout",
      failures: [
        {
          id: "x",
          revision: 1,
          category: "connection",
          severity: "error",
          title: "SSE timeout",
          details: "provider detail",
          actions: ["retry"],
        },
      ],
    },
    { id: "assistant:first", kind: "assistant", text: "partial" },
    { id: "user:next", kind: "user", text: "next" },
    { id: "assistant:next", kind: "assistant", text: "success" },
  ];
  const rows = buildAcpConversationRows(session(entries));
  const headers = rows.filter((r) => r.kind === "turnHeader");
  assert.equal(headers[0]?.state, "failed");
  assert.equal(headers[0]?.notices?.length, 1);
  assert.equal(headers[0]?.notices?.[0]?.detail, "provider detail");
  assert.equal(headers[1]?.state, "completedSuccess");
  assert.equal(headers[1]?.notices, undefined);
  assert.equal(rows[2]?.kind === "assistantText" && rows[2].state, "failed");
  assert.deepEqual(
    rows.map((r) => conversationRowSchema.parse(r)),
    rows,
  );
  const legacy = buildAcpConversationRows(
    session([{ id: "user:old", kind: "user", text: "old", traceError: "old error" }]),
  );
  assert.equal(legacy[0]?.kind === "turnHeader" && legacy[0].notices?.[0]?.message, "old error");
  const operation = buildAcpConversationRows({
    entries: [{ id: "user:ok", kind: "user", text: "successful original turn" }],
    status: "interrupted",
    error: "background error",
    errorCommandId: "workflow-result:background",
  });
  assert.equal(operation[0]?.kind === "turnHeader" && operation[0].state, "completedInterrupted");
  assert.equal(operation[0]?.kind === "turnHeader" && operation[0].notices, undefined);
});

test("ACP compaction uses API markers with stable identity and no tool grouping", () => {
  for (const status of ["running", "success", "failed", "cancelled"] as const) {
    const entries: AcpSession["entries"] = [
      { id: "user:cmd", kind: "user", text: "inspect" },
      { id: "compaction:cmd:x", kind: "compaction", status, tokensBefore: 100, tokensAfter: 10 },
      { id: "assistant:cmd", kind: "assistant", text: "answer" },
    ];
    const before = structuredClone(entries);
    const rows = buildAcpConversationRows(session(entries, "running"));
    const marker = rows[2]!;
    assert.deepEqual(
      entries.map((e) => acpEntrySchema.parse(e)),
      entries,
    );
    assert.deepEqual(conversationRowSchema.parse(marker), marker);
    assert.equal(marker.kind, "timelineMarker");
    if (marker.kind !== "timelineMarker" || marker.marker.type !== "compact")
      throw new Error("missing marker");
    assert.equal(marker.rowId, 4);
    assert.equal(marker.lane, "assistantWork");
    assert.equal(marker.marker.status, status);
    assert.equal(marker.marker.origin, "manual", "unknown origin uses neutral label");
    assert.equal(rows.filter((r) => r.kind === "toolCall").length, 0);
    assert.deepEqual(entries, before);
    const units = buildConversationTurnRenderUnits(rows, { workDurationAvailable: false });
    assert.ok(units[0]?.assistantWorkRows.some((r) => r.kind === "timelineMarker"));
    const recovered = buildAcpConversationRows(session(entries, "interrupted"));
    assert.equal(
      recovered[2]?.kind === "timelineMarker" &&
        recovered[2].marker.type === "compact" &&
        recovered[2].marker.status,
      status === "running" ? "cancelled" : status,
    );
    const auto = buildAcpConversationRows(
      session([entries[0]!, { ...entries[1]!, origin: "auto" } as never]),
    );
    assert.equal(
      auto[2]?.kind === "timelineMarker" &&
        auto[2].marker.type === "compact" &&
        auto[2].marker.origin,
      "auto",
    );
  }
});

test("ACP thoughts use reasoning rows and plans retain their own identity", () => {
  const entries: AcpSession["entries"] = [
    { id: "user:first", kind: "user", text: "inspect" },
    { id: "thought:first", kind: "thought", text: "working", state: "complete", durationMs: 50 },
    {
      id: "plan:first",
      kind: "plan",
      entries: [{ content: "read", priority: "high", status: "pending" }],
    },
    { id: "thought:second", kind: "thought", text: "partial", state: "streaming" },
  ];
  const rows = buildAcpConversationRows(session(entries, "running"));
  assert.deepEqual(
    entries.map((entry) => acpEntrySchema.parse(entry)),
    entries,
  );
  assert.deepEqual(
    rows.map((row) => conversationRowSchema.parse(row)),
    rows,
  );
  assert.equal(
    acpEntrySchema.safeParse({ id: "bad", kind: "thought", text: "x", state: "success" }).success,
    false,
  );
  assert.equal(
    acpEntrySchema.safeParse({
      id: "bad",
      kind: "plan",
      entries: [{ content: "x", priority: "high", status: "success" }],
    }).success,
    false,
  );
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["turnHeader", "userInput", "reasoning", "plan", "reasoning"],
  );
  assert.equal(rows[2]?.kind === "reasoning" && rows[2].durationMs, 50);
  assert.equal(rows[4]?.kind === "reasoning" && rows[4].state, "streaming");
  assert.deepEqual(
    rows[3]?.kind === "plan" && rows[3].entries,
    entries[2]?.kind === "plan" && entries[2].entries,
  );
  const recovered = buildAcpConversationRows(session(entries, "interrupted"));
  assert.equal(recovered[4]?.kind === "reasoning" && recovered[4].state, "interrupted");
  assert.deepEqual(
    rows.map((r) => r.rowId),
    recovered.map((r) => r.rowId),
  );
  assert.equal(
    entries[3]?.kind === "thought" && entries[3].state,
    "streaming",
    "projection must not mutate Host facts",
  );
});

test("cleared plans do not leave an empty work group or move the final answer", () => {
  const rows = buildAcpConversationRows(
    session([
      { id: "user:first", kind: "user", text: "inspect" },
      { id: "plan:first", kind: "plan", entries: [] },
      { id: "assistant:first", kind: "assistant", text: "answer" },
    ]),
  );
  const units = buildConversationTurnRenderUnits(rows, { workDurationAvailable: false });
  assert.equal(
    units[0]?.assistantWorkRows.some((row) => row.kind === "plan"),
    false,
  );
  assert.equal(units[0]?.latestAssistantTextRow?.text, "answer");
});

test("assistant text before a new thought or tool is no longer streaming", () => {
  const rows = buildAcpConversationRows(
    session(
      [
        { id: "user:first", kind: "user", text: "inspect" },
        { id: "assistant:first", kind: "assistant", text: "intermediate" },
        { id: "thought:first", kind: "thought", text: "inspect again", state: "streaming" },
      ],
      "running",
    ),
  );
  assert.equal(rows[2]?.kind === "assistantText" && rows[2].state, "complete");
});

test("ACP entries become stable, ordered native conversation display rows", () => {
  const entries: AcpSession["entries"] = [
    { id: "user:cmd-1", kind: "user", text: "hello", attachmentNames: ["a.png"], createdAt: 100 },
    { id: "assistant:cmd-1:one", kind: "assistant", text: "working", createdAt: 101 },
    { id: "tool:cmd-1:read", kind: "tool", title: "Read", status: "in_progress", createdAt: 102 },
    { id: "assistant:cmd-1:two", kind: "assistant", text: "done", createdAt: 103 },
    { id: "user:cmd-2", kind: "user", text: "next", createdAt: 104 },
    { id: "assistant:cmd-2:one", kind: "assistant", text: "stream", createdAt: 105 },
  ];
  const running = buildAcpConversationRows(session(entries, "running"));
  const visible = running.filter((row) => row.kind !== "turnHeader");
  assert.deepEqual(
    visible.map(({ rowId, turnId, kind }) => [rowId, turnId, kind]),
    [
      [2, "acp:cmd-1", "userInput"],
      [4, "acp:cmd-1", "assistantText"],
      [6, "acp:cmd-1", "toolCall"],
      [8, "acp:cmd-1", "assistantText"],
      [10, "acp:cmd-2", "userInput"],
      [12, "acp:cmd-2", "assistantText"],
    ],
  );
  assert.equal(visible[0]?.kind === "userInput" && visible[0].text, "hello\n\n📎 a.png");
  assert.equal(visible[0]?.kind === "userInput" && visible[0].attachments, undefined);
  assert.equal(visible[2]?.kind === "toolCall" && visible[2].status, "cancelled");
  assert.equal(visible[2]?.kind === "toolCall" && visible[2].toolName, ACP_DISPLAY_TOOL_NAME);
  assert.equal(visible[2]?.kind === "toolCall" && visible[2].inputText, "Read");
  assert.equal(visible[5]?.kind === "assistantText" && visible[5].state, "streaming");
  const completed = buildAcpConversationRows(
    session([{ ...entries[0]! }, ...entries.slice(1, 5), { ...entries[5]!, text: "streamed" }]),
  );
  assert.equal(completed.at(-1)?.kind === "assistantText" && completed.at(-1)?.state, "complete");
  assert.equal(completed.at(-1)?.rowId, running.at(-1)?.rowId);
});

test("legacy entries have no invented date and interrupted turns preserve partial text", () => {
  const rows = buildAcpConversationRows(
    session(
      [
        { id: "user:old", kind: "user", text: "question" },
        { id: "tool:old:one", kind: "tool", title: "Shell", status: "failed", content: "bad" },
        { id: "assistant:old:one", kind: "assistant", text: "partial" },
      ],
      "interrupted",
    ),
  );
  assert.deepEqual(
    rows.map(({ createdAt }) => createdAt),
    [0, 0, 0, 0],
  );
  assert.equal(rows[2]?.kind === "toolCall" && rows[2].status, "error");
  assert.equal(rows[3]?.kind === "assistantText" && rows[3].state, "interrupted");
  assert.equal(rows[3]?.kind === "assistantText" && rows[3].text, "partial");
});

test("ACP saved attachments use native user rows without putting image names into text", () => {
  const attachments = [
    {
      ref: "acp-attachment:11111111-1111-4111-8111-111111111111/0",
      fileName: "a.png",
      mime: "image/png",
      bytes: 12,
    },
  ];
  const rows = buildAcpConversationRows(
    session([
      {
        id: "user:image",
        kind: "user",
        text: "Look",
        attachments,
        attachmentNames: ["a.png", "src/index.ts"],
      },
    ]),
  );
  const row = rows[1];
  assert.equal(row?.kind, "userInput");
  if (row?.kind !== "userInput") throw new Error("missing input");
  assert.equal(row.text, "Look\n\n📎 src/index.ts");
  assert.deepEqual(row.attachments, attachments);
});

test("Host status ends stale tools and represents the running turn before its first reply", () => {
  const entries: AcpSession["entries"] = [{ id: "user:cmd", kind: "user", text: "wait" }];
  const rows = buildAcpConversationRows(session(entries, "running"));
  assert.equal(rows[0]?.kind === "turnHeader" && rows[0].state, "running");
  assert.equal(
    rows.every((row) => row.actions === undefined),
    true,
  );
  assert.deepEqual(entries, [{ id: "user:cmd", kind: "user", text: "wait" }]);
  const finished = buildAcpConversationRows(
    session([
      ...entries,
      { id: "tool:cmd:unknown", kind: "tool", title: "Future", status: "future" },
    ]),
  );
  assert.equal(finished[0]?.kind === "turnHeader" && finished[0].state, "completedSuccess");
  assert.equal(finished[2]?.kind === "toolCall" && finished[2].status, "cancelled");
  assert.equal(finished[2]?.kind === "toolCall" && finished[2].error?.code, "ACP_TOOL_UNCONFIRMED");
  const units = buildConversationTurnRenderUnits(finished, { workDurationAvailable: false });
  assert.equal(units[0]?.isRunning, false);
  assert.equal(units[0]?.workStatus?.durationMs, undefined);
  const live = buildConversationTurnRenderUnits(rows, {
    workDurationAvailable: false,
    nowMs: 100000,
  });
  assert.equal(live[0]?.isRunning, true);
  assert.equal(live[0]?.workSegments?.[0]?.workStatus?.durationMs, undefined);
});
