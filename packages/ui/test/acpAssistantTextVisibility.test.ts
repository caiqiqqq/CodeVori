import assert from "node:assert/strict";
import test from "node:test";
import { buildAcpConversationRows, type AcpSession } from "@zcode/shared";
import { conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.ts";

const entries: AcpSession["entries"] = [
  { id: "user:first", kind: "user", text: "Explain the issue", createdAt: 1000 },
  { id: "thought:first", kind: "thought", text: "Inspecting", state: "complete" },
  { id: "assistant:first:answer", kind: "assistant", text: "Detailed answer with instructions" },
  { id: "tool:first:read", kind: "tool", title: "Read memory", status: "completed" },
  { id: "tool:first:edit", kind: "tool", title: "Edit memory", status: "completed" },
  { id: "assistant:first:summary", kind: "assistant", text: "Saved. Brief summary." },
];

function project(input: AcpSession["entries"], status: AcpSession["status"] = "idle") {
  // 模拟手机恢复的 wire/schema 边界，避免展示字段仅在本地未校验对象中生效。
  const rows = buildAcpConversationRows({ entries: input, status });
  return JSON.parse(JSON.stringify(rows)).map((row: unknown) => conversationRowSchema.parse(row));
}

test("ACP progress moves into history while the final reply stays visible after completion", () => {
  for (const [length, status] of [
    [3, "running"],
    [5, "running"],
    [6, "running"],
    [6, "idle"],
  ] as const) {
    const unit = buildConversationTurnRenderUnits(project(entries.slice(0, length), status))[0]!;
    const visibleReplies = unit.flowItems.filter((item) => item.kind === "assistantText");
    assert.deepEqual(
      visibleReplies.map((item) => item.row.text),
      status === "idle" ? ["Saved. Brief summary."] : [],
    );
    assert.equal(
      unit.assistantHistoryRows.some((row) => row.kind === "assistantText"),
      true,
    );
    assert.equal(
      unit.assistantFollowingRows.some((row) => row.kind === "assistantText"),
      false,
    );
    assert.equal(unit.assistantHistoryDefaultOpen, status === "running");
    assert.equal(visibleReplies.filter((item) => item.latest).length, status === "idle" ? 1 : 0);
  }

  for (const input of [
    entries,
    [...entries, { id: "user:next", kind: "user", text: "Next" }],
  ] as const) {
    const unit = buildConversationTurnRenderUnits(project(structuredClone([...input])))[0]!;
    assert.deepEqual(
      unit.flowItems.map((item) => item.kind),
      ["userInput", "assistantHistory", "assistantText"],
    );
    assert.equal(unit.assistantHistoryDefaultOpen, false);
    assert.equal(unit.latestAssistantTextRow?.text, "Saved. Brief summary.");
    assert.deepEqual(
      unit.assistantHistoryRows.map((row) => row.kind),
      ["reasoning", "assistantText", "toolCall", "toolCall"],
    );
  }
});

test("ACP reply followed by tools remains visible with completed work collapsed", () => {
  const unit = buildConversationTurnRenderUnits(project(entries.slice(0, 5)))[0]!;
  assert.equal(unit.assistantHistoryDefaultOpen, false);
  assert.deepEqual(
    unit.flowItems.filter((item) => item.kind === "assistantText").map((item) => item.row.text),
    ["Detailed answer with instructions"],
  );
  assert.equal(unit.workSegments?.[0]?.assistantHistoryDefaultOpen, false);
  assert.deepEqual(
    unit.assistantHistoryRows.map((row) => row.kind),
    ["reasoning"],
  );
  assert.deepEqual(
    unit.assistantFollowingRows.map((row) => row.kind),
    ["toolCall", "toolCall"],
  );
});

test("interrupted ACP keeps work expanded", () => {
  const unit = buildConversationTurnRenderUnits(project(entries, "interrupted"))[0]!;
  assert.equal(unit.assistantHistoryDefaultOpen, true);
  assert.equal(unit.flowItems.filter((item) => item.kind === "assistantText").length, 1);
});

test("API and ACP rows share completed history grouping, including legacy standalone snapshots", () => {
  const rows = project(entries);
  const api = buildConversationTurnRenderUnits(rows)[0]!;
  const legacyAcp = buildConversationTurnRenderUnits(
    rows.map((row) =>
      row.kind === "assistantText" ? { ...row, presentation: "standalone" as const } : row,
    ),
  )[0]!;
  for (const unit of [api, legacyAcp]) {
    assert.deepEqual(
      unit.flowItems.filter((item) => item.kind === "assistantText").map((item) => item.row.text),
      ["Saved. Brief summary."],
    );
    assert.equal(
      unit.assistantHistoryRows.some((row) => row.kind === "assistantText"),
      true,
    );
  }
});
