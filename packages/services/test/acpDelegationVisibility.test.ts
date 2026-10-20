import assert from "node:assert/strict";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import { excludeDelegatedAcpSessions, searchAcpSessions } from "../src/acp/acpSessionSearch.js";

test("ACP ordinary projection excludes child before search limit without altering direct history", () => {
  const workspace = { workspacePath: "/project", workspaceIdentity: "one" };
  const session = (id: string, createdAt: number) =>
    ({
      ...workspace,
      id,
      agent: "codex",
      acpSessionId: id,
      title: "matching conversation",
      status: "idle",
      revision: 1,
      archived: false,
      pinned: false,
      unreadAt: null,
      goal: null,
      configOptions: [],
      modeState: null,
      entries: [{ kind: "user", id: `user:${id}`, text: "matching", createdAt }],
    }) as AcpSession;
  const child = session("child", 300);
  const ordinary = session("ordinary", 200);
  const visible = excludeDelegatedAcpSessions([child, ordinary], ["child"]);
  assert.deepEqual(
    searchAcpSessions(visible, { ...workspace, query: "matching", limit: 1 }).map(
      (item) => item.id,
    ),
    ["ordinary"],
  );
  assert.equal(child.entries[0]?.text, "matching");
  assert.equal(excludeDelegatedAcpSessions([child, ordinary], []).length, 2);
});
