import assert from "node:assert/strict";
import test from "node:test";
import { createWindowWorkspaceProjection } from "../src/host/windowWorkspaceProjection.js";

test("only trusted desktop publishes ordered, validated, monotonically versioned window membership", async () => {
  const projection = createWindowWorkspaceProjection("host-generation");
  const desktop = projection.attach(true);
  const phone = projection.attach(false);
  try {
    const input = {
      workspaces: [
        { workspacePath: "/same", workspaceIdentity: "remote-a", remoteSessionId: "a" },
        { workspacePath: "/same", workspaceIdentity: "remote-b", remoteSessionId: "b" },
      ],
      sidebar: { organizeBy: "project" as const, sortBy: "updated" as const },
    };
    await assert.rejects(phone.publishWorkspaceSession(input), /read-only/);
    await desktop.publishWorkspaceSession(input);
    assert.equal((await phone.getWorkspaceSession()).revision, 1);
    await desktop.publishWorkspaceSession(input);
    assert.equal((await phone.getWorkspaceSession()).revision, 1, "No redundant broadcasts");
    const snapshot = await phone.getWorkspaceSession();
    snapshot.workspaces.reverse();
    assert.equal(
      (await phone.getWorkspaceSession()).workspaces[0]?.workspaceIdentity,
      "remote-a",
      "Callers cannot mutate Host state",
    );
    await assert.rejects(
      desktop.publishWorkspaceSession({
        ...input,
        workspaces: [input.workspaces[0], input.workspaces[0]],
      }),
    );
    await desktop.publishWorkspaceSession({
      ...input,
      workspaces: [...input.workspaces].reverse(),
    });
    assert.equal((await phone.getWorkspaceSession()).revision, 2);
    await desktop.publishWorkspaceSession({ ...input, workspaces: [] });
    assert.equal((await phone.getWorkspaceSession()).workspaces.length, 0);
  } finally {
    projection.dispose();
  }
});
