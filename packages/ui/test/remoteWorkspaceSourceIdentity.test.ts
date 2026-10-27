import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsPatchSchema } from "@zcode/shared";
import { buildRemoteWorkspaceSessionMutation } from "../src/lib/remoteWorkspaceHistory.js";

const sourceServerId = "e3d8ea59-4b47-4ef4-a2d8-398d7361c669";
const target = { kind: "docker" as const, container: "workspace" };

test("remote project history preserves source identity without changing its workspace key", () => {
  const first = buildRemoteWorkspaceSessionMutation({
    remoteSessions: [],
    workspacePath: "/work/project",
    target,
    sourceServerId,
    lastConnectionStatus: "connected",
    touchOpenedAt: true,
  });
  assert.equal(first.entry.sourceServerId, sourceServerId);
  assert.equal(first.entry.workspaceIdentity, "remote:docker:workspace:/work/project");
  assert.equal(
    appSettingsPatchSchema.parse({ lastWorkspaceSession: first.nextRemoteSessions })
      .lastWorkspaceSession?.[0]?.kind,
    "remote",
  );

  const reconnected = buildRemoteWorkspaceSessionMutation({
    remoteSessions: first.nextRemoteSessions,
    workspacePath: "/work/project",
    target,
    lastConnectionStatus: "connected",
    touchOpenedAt: true,
  });
  assert.equal(reconnected.entry.sourceServerId, sourceServerId);
  assert.equal(reconnected.entry.workspaceIdentity, first.entry.workspaceIdentity);
});
