import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import type { CredentialVaultReferenceReader } from "../src/credential/credentialVaultReferenceReader.js";

test("ACP provides workspace credential metadata without remote command execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-server-context-"));
  const workspace = {
    workspacePath: join(directory, "workspace"),
    workspaceIdentity: "workspace:one",
  };
  const credential = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test server",
    kind: "custom-server-type",
    environment: "staging" as const,
    host: "server.example.invalid",
    port: 2222,
    username: "deploy",
  };
  const referenceReader: CredentialVaultReferenceReader = {
    async listReferences(identity) {
      assert.equal(identity, workspace.workspaceIdentity);
      return [credential];
    },
    async readSecret() {
      throw new Error("Metadata lookup must not read secrets");
    },
  };
  let credentialServer:
    | NonNullable<Parameters<AcpConnectionFactory>[0]["workflowServers"]>[number]
    | undefined;
  let toolResult: unknown;
  let promptText = "";
  const connect: AcpConnectionFactory = async ({ workflowServers }) => {
    credentialServer = workflowServers?.find((item) => item.name === "zcode-credentials");
    return {
      sessionId: "native-server-context-test",
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
            id: 1,
            method: "tools/call",
            params: { name: "ListCredentialReferences", arguments: {} },
          }),
        });
        toolResult = await response.json();
      },
      async cancel() {},
      close() {},
    };
  };
  const service = createAcpService({
    directory,
    credentialVaultReferenceReader: referenceReader,
    connect,
  });

  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    assert.ok(credentialServer);
    const env = credentialServer.config.env;
    assert.ok(env?.ZCODE_WORKFLOW_TOKEN);
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
      ["ListCredentialReferences", "ReadCredentialSecret"],
    );

    await service.prompt({
      ...workspace,
      id: session.id,
      commandId: "server-context-test",
      text: "Connect to the staging server",
      attachments: [],
      workspaceFiles: [],
    });

    assert.match(promptText, /"kind":"custom-server-type"/);
    assert.match(promptText, /"host":"server\.example\.invalid"/);
    assert.doesNotMatch(
      promptText,
      /RunCredentialedServerCommand|zai-oauth|bigmodel-oauth|codevori-account|account-provider-api-keys|bot-integration-credentials|password|private-key-passphrase/i,
    );
    const listedMetadata = JSON.stringify(toolResult);
    assert.match(listedMetadata, /server\.example\.invalid/);
    assert.match(listedMetadata, /custom-server-type/);
    assert.doesNotMatch(listedMetadata, /password|secretKey|private-key-passphrase/i);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
