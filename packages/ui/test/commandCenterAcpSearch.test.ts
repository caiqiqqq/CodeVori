import assert from "node:assert/strict";
import test from "node:test";
import type { AcpSessionSearchItem, ZCodeTaskMeta } from "@zcode/shared";
import { buildConversationSearchRows } from "../src/command-center/conversationSearchResults.ts";
import { buildAcpConversationRows, acpEntryRowId } from "../src/v4/acpConversationRows.ts";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.ts";
import {
  buildConversationFindIndex,
  resolveSearchResultHighlightMatch,
} from "../src/v4/conversationFindIndex.ts";

const native = (id: string, updatedAt: number) =>
  ({
    taskId: id,
    title: id,
    workspacePath: "/tmp/project",
    createdAt: 1,
    updatedAt,
  }) as ZCodeTaskMeta;
const acp = (id: string, updatedAt: number, identity?: string): AcpSessionSearchItem => ({
  id,
  agent: "codex",
  title: id,
  status: "idle",
  revision: 1,
  workspacePath: "/tmp/project",
  workspaceIdentity: identity,
  createdAt: 1,
  updatedAt,
  matches: [],
});

test("command center merges native and ACP recent rows without conflating their ids", () => {
  const result = buildConversationSearchRows({
    nativeItems: [native("same-id", 100), native("older", 50)],
    acpItems: [acp("same-id", 200), acp("same-id", 150, "another-host")],
    query: "",
    limit: 3,
  });
  assert.deepEqual(
    result.map((row) => [row.conversation.kind, row.conversation.item.updatedAt]),
    [
      ["acp", 200],
      ["acp", 150],
      ["native", 100],
    ],
  );
  assert.equal(new Set(result.map((row) => row.key)).size, 3);
});

test("command center keeps native snippets and every distinct ACP entry selection", () => {
  const item = {
    ...native("native", 100),
    searchSnippets: ["...match...", "match", "other match"],
  };
  const external = {
    ...acp("acp", 200),
    matches: [
      { entryId: "assistant:one", snippet: "same match" },
      { entryId: "assistant:two", snippet: "same match" },
    ],
  };
  const result = buildConversationSearchRows({
    nativeItems: [item, item],
    acpItems: [external, external],
    query: "match",
    limit: 80,
  });
  assert.equal(result.length, 4);
  assert.deepEqual(
    result.slice(0, 2).map((row) => row.entryId),
    ["assistant:one", "assistant:two"],
  );
  assert.equal(new Set(result.map((row) => row.key)).size, 4);
});

test("ACP body navigation highlights the selected entry even when its snippet is identical", () => {
  const entries = [
    { id: "user:one", kind: "user" as const, text: "question" },
    { id: "assistant:one", kind: "assistant" as const, text: "same match" },
    { id: "user:two", kind: "user" as const, text: "another question" },
    { id: "assistant:two", kind: "assistant" as const, text: "same match" },
  ];
  const rows = buildAcpConversationRows({ entries, status: "idle" });
  const index = buildConversationFindIndex(buildConversationTurnRenderUnits(rows), "match");
  const match = resolveSearchResultHighlightMatch(index, {
    kind: "acp",
    acpSessionId: "external",
    entryId: "assistant:two",
    rowId: acpEntryRowId(3),
    requestId: 1,
    workspacePath: "/tmp/project",
    query: "match",
    snippet: "same match",
  });
  assert.equal(match?.rowId, 8);
  assert.equal(match?.unitIndex, 1);
});
