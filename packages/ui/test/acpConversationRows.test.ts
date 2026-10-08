import assert from "node:assert/strict";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import { ACP_DISPLAY_TOOL_NAME, buildAcpConversationRows } from "../src/v4/acpConversationRows.ts";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.ts";

const session = (entries: AcpSession["entries"], status: AcpSession["status"] = "idle") =>
  ({ entries, status }) as AcpSession;

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
