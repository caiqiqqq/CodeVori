import assert from "node:assert/strict";
import test from "node:test";
import type { AcpEntry, AcpSession } from "@zcode/shared";
import { buildAcpConversationRows, ACP_DISPLAY_TOOL_NAME } from "../src/v4/acpConversationRows.ts";
import { buildAssistantWorkRenderItems } from "../src/v4/conversationAssistantWorkItems.ts";
import { toolCallRowToLegacyNode } from "../src/v4/toolCallRowAdapter.ts";
import { isPlainRecord } from "../src/ToolCallBlocks/fileSummaryTypes.ts";
import { readAcpToolEntry } from "../src/lib/acpToolPresentation.ts";

function project(entries: AcpEntry[], running = true, terminalGrouping = true) {
  const rows = buildAcpConversationRows({ entries, status: running ? "running" : "idle" });
  return buildAssistantWorkRenderItems(
    rows.filter((row) => row.kind === "toolCall" || row.kind === "assistantText"),
    { messageStreamShowReasoning: false },
    { stageTailIsRunning: running, enableTerminalGrouping: terminalGrouping },
  );
}

const tool = (
  id: string,
  toolKind?: Extract<AcpEntry, { kind: "tool" }>["toolKind"],
): AcpEntry => ({
  id,
  kind: "tool",
  title: `python3 - <<'PY'\nprint('${id}')\nPY`,
  toolKind,
  input: JSON.stringify({ cmd: `python3 - <<'PY'\nprint('${id}')\nPY` }),
  status: "completed",
  content: `result ${id}`,
});

test("typed ACP calls reuse stable API execution groups and preserve snapshot facts", () => {
  const entries = [tool("a", "execute"), tool("b", "execute")];
  const before = structuredClone(entries);
  const group = project(entries)[0];
  assert.equal(group?.kind, "executeGroup");
  if (group?.kind !== "executeGroup") throw new Error("missing group");
  const appended = project([...entries, tool("c", "execute")])[0];
  assert.equal(appended?.key, group.key);
  assert.equal(group.node.toolCall.status, "in_progress");
  assert.equal(group.node.childToolCalls.length, 2);
  assert.equal(group.node.childToolCalls[0]?.toolCall.toolName, ACP_DISPLAY_TOOL_NAME);
  assert.equal(group.node.childToolCalls[0]?.toolCall.title, entries[0]?.title);
  assert.equal(group.node.childToolCalls[0]?.toolCall.output, "result a");
  assert.deepEqual(entries, before);
  assert.deepEqual(
    project(entries, true, false).map((item) => item.kind),
    ["row", "row"],
  );
});

test("read/search and read-only shell calls use Explore without native capability identity", () => {
  const read: AcpEntry = { ...tool("read", "read"), title: "Read /synthetic/file" };
  const search: AcpEntry = { ...tool("search", "search"), title: "Search pattern" };
  const shell: AcpEntry = { ...tool("shell", "execute"), input: '{"command":"rg pattern src"}' };
  const items = project([read, search, shell]);
  assert.equal(items[0]?.kind, "exploreGroup");
  if (items[0]?.kind !== "exploreGroup") throw new Error("missing explore");
  assert.equal(items[0].rows.length, 3);
  assert.ok(
    items[0].node.childToolCalls.every((node) => node.toolCall.toolName === ACP_DISPLAY_TOOL_NAME),
  );
});

test("unknown titles, text, workflows and family changes break ACP groups", () => {
  for (const title of ["Read", "Task", "Execute", "CreateWorkflow", "Write"]) {
    assert.deepEqual(
      project([{ ...tool("unknown"), title }, tool("b", "execute")]).map((item) => item.kind),
      ["row", "row"],
    );
  }
  assert.deepEqual(
    project([
      tool("a", "execute"),
      { id: "text", kind: "assistant", text: "next step" },
      tool("b", "execute"),
      tool("read", "read"),
    ]).map((item) => item.kind),
    ["row", "row", "row", "row"],
  );
  const workflow = { ...tool("workflow", "execute"), workflow: { runId: "run" } } as AcpEntry;
  assert.deepEqual(
    project([tool("a", "execute"), workflow, tool("b", "execute")]).map((item) => item.kind),
    ["row", "row", "row"],
  );
});

test("terminal/replayed snapshots retain failures and unconfirmed children", () => {
  const entries = [
    { ...tool("a", "execute"), status: "failed", content: "failure details" },
    { ...tool("b", "execute"), status: "in_progress" },
  ];
  const group = project(entries, false)[0];
  assert.equal(group?.kind, "executeGroup");
  if (group?.kind !== "executeGroup") throw new Error("missing stopped group");
  assert.equal(group.node.toolCall.status, "stopped");
  assert.equal(group.node.childToolCalls[0]?.toolCall.status, "failed");
  const raw = group.node.childToolCalls[1]?.toolCall.raw;
  assert.ok(isPlainRecord(raw) && isPlainRecord(raw.error));
  assert.equal(raw.error.code, "ACP_TOOL_UNCONFIRMED");
  assert.deepEqual(project(structuredClone(entries), false), project(entries, false));
});

test("ACP adapter keeps absent/truncated input and explicit output in generic details", () => {
  const entry = {
    ...tool("a", "execute"),
    input: '{"cmd":',
    inputTruncated: true,
    output: "raw output",
  };
  const row = buildAcpConversationRows({ entries: [entry], status: "idle" } as Pick<
    AcpSession,
    "entries" | "status"
  >).find((item) => item.kind === "toolCall");
  if (row?.kind !== "toolCall") throw new Error("missing row");
  const node = toolCallRowToLegacyNode(row);
  assert.equal(node.toolCall.input, entry.title);
  assert.ok(isPlainRecord(node.toolCall.raw));
  const details = readAcpToolEntry(node.toolCall.raw.acpTool);
  assert.equal(details?.input, entry.input);
  assert.equal(details?.output, "raw output");
});

test("unfamiliar or empty ACP execute parameters never hide a running tool", () => {
  for (const input of ['{"arguments":{"text":"custom adapter command"}}', "{}", "null"]) {
    const first = { ...tool("a", "execute"), input, status: "in_progress" };
    const group = project([first, tool("b", "execute")])[0];
    assert.equal(group?.kind, "executeGroup");
    assert.equal(project([{ ...first, title: "" }])[0]?.kind, "row");
  }
});
