import assert from "node:assert/strict";
import test from "node:test";
import { createMcpStatusWorkspaceRegistry } from "../src/zcode-agent/mcpStatusWorkspaceRegistry.js";

test("MCP status auth accepts only a target registered by this client", () => {
  const registry = createMcpStatusWorkspaceRegistry();
  const firstClient = {};
  const secondClient = {};
  const workspace = {
    workspaceKey: "remote-identity",
    workspaceIdentity: "remote-identity",
    workspacePath: "/projects/one",
    remoteSessionId: "remote-one",
  };
  registry.register(firstClient, workspace);
  assert.deepEqual(registry.resolve(firstClient, workspace), workspace);
  assert.equal(registry.resolve(secondClient, workspace), undefined);
  assert.equal(
    registry.resolve(firstClient, { ...workspace, workspacePath: "/projects/two" }),
    undefined,
  );
  assert.equal(
    registry.resolve(firstClient, { ...workspace, remoteSessionId: "remote-two" }),
    undefined,
  );
  assert.equal(
    registry.resolve(firstClient, { ...workspace, workspaceIdentity: undefined }),
    undefined,
  );
  assert.equal(registry.resolve(firstClient, { ...workspace, workspaceKey: "other" }), undefined);
});
