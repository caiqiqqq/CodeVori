import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import type { CredentialVaultHostAccess } from "../src/credential/credentialVaultHostAccess.js";

test("ACP requires one-time user approval before running a command with a saved SSH credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-credentialed-server-"));
  const workspace = {
    workspacePath: join(directory, "workspace"),
    workspaceIdentity: "workspace:one",
  };
  const server = {
    id: randomUUID(),
    name: "Test server",
    environment: "test" as const,
    host: "192.0.2.10",
    port: 22,
    username: "root",
  };
  const executed: Array<{ serverId: string; workspaceIdentity: string; command: string }> = [];
  const hostAccess: CredentialVaultHostAccess = {
    async listServers(identity) {
      assert.equal(identity, workspace.workspaceIdentity);
      return [server];
    },
    async executeCommand(savedServer, identity, command, assertAuthorized) {
      assertAuthorized();
      executed.push({ serverId: savedServer.id, workspaceIdentity: identity, command });
      return { exitCode: 0, stdout: "command complete", stderr: "" };
    },
  };
  let credentialServer:
    | NonNullable<Parameters<AcpConnectionFactory>[0]["workflowServers"]>[number]
    | undefined;
  let nextCommand = "whoami";
  let toolResult: unknown;
  let promptText = "";
  const connect: AcpConnectionFactory = async ({ workflowServers }) => {
    credentialServer = workflowServers?.find((item) => item.name === "zcode-credentials");
    return {
      sessionId: "native-credentialed-server-test",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt(_text, blocks) {
        promptText = (blocks ?? [])
          .filter(
            (block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text",
          )
          .map((block) => block.text)
          .join("\n");
        const env = credentialServer?.config.env;
        assert.ok(env?.ZCODE_WORKFLOW_TOKEN);
        assert.ok(env?.ZCODE_WORKFLOW_URL);
        const response = await fetch(env.ZCODE_WORKFLOW_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: randomUUID(),
            method: "tools/call",
            params: {
              name: "RunCredentialedServerCommand",
              arguments: { serverId: server.id, command: nextCommand },
            },
          }),
        });
        toolResult = await response.json();
      },
      async cancel() {},
      close() {},
    };
  };
  const service = createAcpService({ directory, credentialVaultHostAccess: hostAccess, connect });

  async function waitForPendingPermission(sessionId: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const session = await service.read({ ...workspace, id: sessionId });
      if (session.pendingPermission) return session.pendingPermission;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for SSH command approval");
  }

  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    assert.ok(credentialServer);
    const env = credentialServer.config.env;
    assert.ok(env?.ZCODE_WORKFLOW_URL);
    const listedResponse = await fetch(env.ZCODE_WORKFLOW_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const listed = (await listedResponse.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    assert.deepEqual(
      listed.result?.tools?.map(({ name }) => name),
      ["ListCredentialedServers", "RunCredentialedServerCommand"],
    );

    const firstCommandId = randomUUID();
    const firstRun = service.prompt({
      ...workspace,
      id: session.id,
      commandId: firstCommandId,
      text: "Check the server identity",
      attachments: [],
      workspaceFiles: [],
    });
    const firstPermission = await waitForPendingPermission(session.id);
    assert.match(firstPermission.title, /root@192\.0\.2\.10:22/);
    assert.match(firstPermission.title, /whoami/);
    assert.deepEqual(executed, []);
    assert.match(promptText, new RegExp(server.id));
    assert.match(promptText, /RunCredentialedServerCommand/);
    await service.decide({
      ...workspace,
      id: session.id,
      requestId: firstPermission.requestId,
      optionId: "allow",
    });
    await firstRun;
    assert.deepEqual(executed, [
      { serverId: server.id, workspaceIdentity: "workspace:one", command: "whoami" },
    ]);

    nextCommand = "id";
    const secondRun = service.prompt({
      ...workspace,
      id: session.id,
      commandId: randomUUID(),
      text: "Inspect the current user",
      attachments: [],
      workspaceFiles: [],
    });
    const secondPermission = await waitForPendingPermission(session.id);
    assert.notEqual(secondPermission.requestId, firstPermission.requestId);
    assert.deepEqual(executed, [
      { serverId: server.id, workspaceIdentity: "workspace:one", command: "whoami" },
    ]);
    await service.decide({
      ...workspace,
      id: session.id,
      requestId: secondPermission.requestId,
      optionId: "reject",
    });
    await secondRun;
    assert.equal(executed.length, 1, "rejecting the next request does not reuse prior approval");
    assert.match(JSON.stringify(toolResult), /rejected/);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
