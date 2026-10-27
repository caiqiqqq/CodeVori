import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationRowSchema,
  type ConversationRow,
  type ToolCallRow,
} from "@zcode/shared/zcode-protocol-v4";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.ts";
const placeholder = {
  kind: "toolCall",
  rowId: 2,
  createdAt: 1,
  createdAtSeq: 2,
  turnId: "turn",
  toolCallId: "call",
  toolName: "",
  inputText: "",
  status: "cancelled",
} as ToolCallRow;
function visible(row: ToolCallRow) {
  return (
    buildConversationTurnRenderUnits([
      {
        kind: "userInput",
        rowId: 1,
        createdAt: 1,
        createdAtSeq: 1,
        turnId: "turn",
        text: "hello",
        origin: "realUser",
      } as ConversationRow,
      conversationRowSchema.parse(JSON.parse(JSON.stringify(row))),
    ])[0]?.renderRows.some((r) => r.rowId === row.rowId) ?? false
  );
}
test("unnamed empty placeholders disappear in both live and restored turns without losing useful tool facts", () => {
  for (const status of ["inputStreaming", "cancelled", "success"] as const)
    assert.equal(visible({ ...placeholder, status }), false, status);
  for (const row of [
    { ...placeholder, toolName: "Read", status: "running" as const },
    { ...placeholder, error: { code: "ERR", message: "failed" }, status: "error" as const },
    { ...placeholder, inputText: '{"path":"a"}' },
    { ...placeholder, output: { text: "result" } },
  ])
    assert.equal(visible(row), true, JSON.stringify(row));
});
