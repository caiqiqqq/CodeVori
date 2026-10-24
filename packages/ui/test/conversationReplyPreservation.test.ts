import assert from "node:assert/strict";
import test from "node:test";
import { buildAcpConversationRows, type AcpSession } from "@zcode/shared";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.ts";

const explanation =
  "先检查容器状态，再按日志定位。\n\n```bash\ncurl -k https://127.0.0.1:6443/healthz\n```";
const closing = "记好了。等你贴日志。";

const entries: AcpSession["entries"] = [
  { id: "user:reply", kind: "user", text: "排查这个问题", createdAt: 100 },
  { id: "assistant:reply:answer", kind: "assistant", text: explanation, createdAt: 101 },
  {
    id: "tool:reply:write",
    kind: "tool",
    title: "Write memory",
    status: "completed",
    createdAt: 102,
  },
  {
    id: "tool:reply:read",
    kind: "tool",
    title: "Read memory",
    status: "completed",
    createdAt: 103,
  },
  {
    id: "tool:reply:edit",
    kind: "tool",
    title: "Edit memory",
    status: "completed",
    createdAt: 104,
  },
  { id: "assistant:reply:closing", kind: "assistant", text: closing, createdAt: 105 },
];

test("tool calls and a closing sentence cannot fold away earlier public reply text", () => {
  const before = structuredClone(entries);
  for (const status of ["running", "idle"] as const) {
    const rows = buildAcpConversationRows({ entries, status } as AcpSession);
    for (const snapshot of [rows, structuredClone(rows)]) {
      const unit = buildConversationTurnRenderUnits(snapshot)[0]!;
      const visibleText = unit.flowItems.flatMap((item) =>
        item.kind === "assistantText" ? [item.row.text] : [],
      );
      assert.deepEqual(visibleText, [explanation, closing], status);
      assert.ok(
        unit.flowItems.every(
          (item) =>
            item.kind !== "assistantHistory" ||
            item.rows.every((row) => row.kind !== "assistantText"),
        ),
      );
      assert.equal(unit.assistantHistoryRows.filter((row) => row.kind === "toolCall").length, 3);
      if (status === "idle") assert.equal(unit.latestAssistantTextRow?.text, closing);
    }
  }
  assert.deepEqual(entries, before, "presentation must not mutate Host facts");
});

test("official CUA messages and their tools retain response grouping", () => {
  const rows = buildAcpConversationRows({ entries, status: "idle" } as AcpSession).map((row) => {
    if (row.kind === "assistantText" && row.text === explanation) {
      return { ...row, assistantResponseId: "response:cua" };
    }
    if (row.kind === "toolCall") {
      return { ...row, toolName: "mcp__computer-use__click", assistantResponseId: "response:cua" };
    }
    return row;
  });
  const unit = buildConversationTurnRenderUnits(rows)[0]!;
  const groups = unit.flowItems.filter((item) => item.kind === "cuaGroup");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.assistantResponseIds, ["response:cua"]);
  assert.deepEqual(
    groups[0]?.events.map((event) => event.kind),
    ["assistantMessage", "tool", "tool", "tool"],
  );
  assert.equal(unit.flowItems.at(-1)?.kind, "assistantText");
  assert.equal(unit.latestAssistantTextRow?.text, closing);
});

test("native API rows preserve reply order while retaining the final action anchor", () => {
  const rows = buildAcpConversationRows({ entries, status: "idle" } as AcpSession).map((row) => ({
    ...row,
    turnId: "api:reply",
  }));
  const unit = buildConversationTurnRenderUnits(rows)[0]!;
  const visible = unit.flowItems.filter((item) => item.kind === "assistantText");
  assert.deepEqual(
    visible.map((item) => item.row.text),
    [explanation, closing],
  );
  assert.deepEqual(
    visible.map((item) => item.latest),
    [false, true],
  );
});
