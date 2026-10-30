import assert from "node:assert/strict";
import test from "node:test";
import { projectAcpSidebarSessions } from "../src/lib/acpSidebarSessions.js";
import { acpSessionSchema, summarizeAcpSession } from "@zcode/shared";

test("ACP run time survives summary truncation and tool updates; a new user turn replaces it", () => {
  const session = acpSessionSchema.parse({
    id: "session",
    agent: "codex",
    workspacePath: "/fixture",
    title: "Task",
    acpSessionId: "native-session",
    pendingPermission: null,
    error: null,
    status: "running",
    revision: 1,
    entries: [
      { id: "user:1", kind: "user", text: "Run", createdAt: 100 },
      { id: "tool:1", kind: "tool", title: "Tool", status: "running", createdAt: 200 },
    ],
  });
  const project = () =>
    projectAcpSidebarSessions([summarizeAcpSession(session)], { workspacePath: "/fixture" })[0];
  assert.equal(project().startedAt, 100);
  session.entries.push({ id: "text:1", kind: "text", text: "Progress", createdAt: 300 });
  assert.equal(project().startedAt, 100);
  assert.equal(project().updatedAt, 300);
  session.entries.push({ id: "user:2", kind: "user", text: "Next", createdAt: 400 });
  assert.equal(project().startedAt, 400);
});
