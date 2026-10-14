import assert from "node:assert/strict";
import test from "node:test";
import { projectAcpSidebarSessions } from "../src/lib/acpSidebarSessions.ts";
import type { AcpSession } from "@zcode/shared";

function session(id: string, overrides: Partial<AcpSession> = {}): AcpSession {
  return {
    id,
    agent: "codex",
    workspacePath: "/tmp/project",
    workspaceIdentity: "remote-one",
    acpSessionId: id,
    title: id,
    status: "idle",
    revision: 1,
    archived: false,
    pinned: false,
    unreadAt: null,
    goal: null,
    configOptions: [],
    modeState: null,
    pendingPermission: null,
    error: null,
    entries: [{ id: `user:${id}`, kind: "user", text: id, createdAt: 100 }],
    ...overrides,
  };
}

test("ACP sidebar projects only durable conversations for the resolved workspace identity", () => {
  const sessions = [
    session("accepted", { pinned: true, unreadAt: 150 }),
    session("draft", { provisional: true }),
    session("empty", { entries: [] }),
    session("superseded", { supersededBy: "accepted" }),
    session("other-host", { workspaceIdentity: "remote-two" }),
  ];
  assert.deepEqual(
    projectAcpSidebarSessions(sessions, {
      workspacePath: "/tmp/project",
      workspaceIdentity: "remote-one",
    }).map(({ id }) => id),
    ["accepted"],
  );
  const [accepted] = projectAcpSidebarSessions(sessions, {
    workspacePath: "/tmp/project",
    workspaceIdentity: "remote-one",
  });
  assert.equal(accepted?.pinned, true);
  assert.equal(accepted?.unreadAt, 150);
  assert.equal(accepted?.archived, false);
  assert.equal(
    projectAcpSidebarSessions([session("archived", { archived: true, pinned: false })], {
      workspacePath: "/tmp/project",
      workspaceIdentity: "remote-one",
    })[0]?.archived,
    true,
  );
});

test("ACP sidebar projects only the failure fact from its Host session", () => {
  const [failed, stopped, idle] = projectAcpSidebarSessions(
    [
      session("failed", { status: "interrupted", error: "agent disconnected", unreadAt: 150 }),
      session("stopped", { status: "interrupted", error: null }),
      session("idle", { status: "idle", error: "old error" }),
    ],
    { workspacePath: "/tmp/project", workspaceIdentity: "remote-one" },
  );
  assert.equal(failed?.failed, true);
  assert.equal(stopped?.failed, false);
  assert.equal(idle?.failed, false);
  assert.equal("error" in (failed ?? {}), false, "sidebar must not retain the error text");
});

test("ACP sidebar uses accepted entry time and frozen Host legacy snapshot time", () => {
  const [dated, old, mixed, unknown] = projectAcpSidebarSessions(
    [
      session("dated", {
        entries: [
          { id: "user:one", kind: "user", text: "one", createdAt: 100 },
          { id: "assistant:one", kind: "assistant", text: "reply", createdAt: 200 },
        ],
      }),
      session("old", {
        legacySavedAt: 150,
        entries: [{ id: "user:old", kind: "user", text: "old" }],
      }),
      session("mixed", {
        legacySavedAt: 125,
        entries: [
          { id: "user:old", kind: "user", text: "old" },
          { id: "user:new", kind: "user", text: "new", createdAt: 300 },
        ],
      }),
      session("unknown", { entries: [{ id: "user:unknown", kind: "user", text: "old" }] }),
    ],
    { workspacePath: "/tmp/project", workspaceIdentity: "remote-one" },
  );
  assert.deepEqual(
    [dated?.createdAt, dated?.updatedAt, old?.createdAt, old?.updatedAt],
    [100, 200, 150, 150],
  );
  assert.deepEqual([mixed?.createdAt, mixed?.updatedAt, unknown?.updatedAt], [125, 300, 0]);
});
