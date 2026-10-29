import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { ConversationRowPool } from "../src/v4/conversationRowPool.js";

const topic = "conversation/a";
interface FixtureInput {
  paths?: string[];
  options?: { recursive: boolean };
  __proto__?: { value: number };
  stable?: { x: number };
}

function tool(rowId = 1): ToolCallRow & { input: FixtureInput } {
  return {
    kind: "toolCall",
    rowId,
    turnId: "turn",
    createdAt: 1,
    createdAtSeq: 1,
    toolCallId: "call",
    toolName: "Read",
    status: "success",
    inputText: "file.ts",
    input: { paths: ["file.ts"], options: { recursive: true } },
    output: {
      text: "large output".repeat(100),
      truncated: { totalBytes: 5000, ref: "output-ref" },
    },
  };
}

test("equal decoded rows and windows reuse references without mutating input", () => {
  const pool = new ConversationRowPool();
  const row = tool();
  const window = [pool.shareRow(topic, row)];
  const decoded = structuredClone(window);
  assert.equal(pool.shareWindow(topic, decoded, window), window);
  assert.notEqual(decoded[0], row);
  assert.deepEqual(decoded, window);
});

test("changed nested values replace only changed structure and preserve old snapshots", () => {
  const pool = new ConversationRowPool();
  const original = tool();
  assert.equal(original.kind, "toolCall");
  if (original.kind !== "toolCall") return;
  pool.shareRow(topic, original);
  const changed = structuredClone(original);
  changed.status = "error";
  changed.input = { paths: ["file.ts"], options: { recursive: false } };
  const shared = pool.shareRow(topic, changed);
  assert.notEqual(shared, original);
  assert.equal(shared.output, original.output);
  assert.equal(shared.input.paths, original.input.paths);
  assert.notEqual(shared.input.options, original.input.options);
  assert.equal(original.status, "success");
  assert.deepEqual(shared, changed);
  const removed = { ...structuredClone(shared), input: { paths: [] } };
  const next = pool.shareRow(topic, removed);
  assert.deepEqual(next, removed);
  assert.equal(Object.hasOwn(next.input, "options"), false);
});

test("topic and pool boundaries isolate identical row IDs", () => {
  const pool = new ConversationRowPool();
  const row = pool.shareRow(topic, tool());
  assert.notEqual(pool.shareRow("conversation/b", structuredClone(row)), row);
  assert.notEqual(new ConversationRowPool().shareRow(topic, structuredClone(row)), row);
});

test("remember retains latest streamed row and windows never resurrect removed members", () => {
  const pool = new ConversationRowPool();
  const old = tool();
  pool.shareRow(topic, old);
  const latest = { ...old, status: "error" as const };
  pool.remember(topic, latest);
  assert.equal(pool.shareRow(topic, structuredClone(latest)), latest);
  const second = pool.shareRow(topic, tool(2));
  assert.deepEqual(pool.shareWindow(topic, [structuredClone(second)], [old, second]), [second]);
  assert.equal(pool.shareWindow(topic, [], [old, second]).length, 0);
});

test("decoded own __proto__ keys remain data and do not change object prototypes", () => {
  const pool = new ConversationRowPool();
  const row = tool();
  if (row.kind !== "toolCall") return;
  row.input = JSON.parse('{"__proto__":{"value":1},"stable":{"x":1}}');
  const first = pool.shareRow(topic, row);
  const changed = structuredClone(row);
  changed.input.__proto__!.value = 2;
  const next = pool.shareRow(topic, changed);
  assert.equal(Object.getPrototypeOf(next.input), Object.prototype);
  assert.equal(Object.hasOwn(next.input, "__proto__"), true);
  assert.deepEqual(next, changed);
  assert.equal(first.input.__proto__!.value, 1);
});
