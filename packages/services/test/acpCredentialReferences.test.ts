import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { projectCredentialReferences } from "../src/credential/credentialReferences.js";

test("ACP prompts and Host MCP expose current credential metadata without storage keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-credential-references-"));
  const workspace = { workspacePath: join(directory, "workspace") };
  let storedKeys = [
    "oauth:zai:access_token",
    "remote-workspace:private-workspace-id:password",
    "custom:private-integration:secret",
  ];
  let readerFailure = false;
  let credentialServer:
    | NonNullable<Parameters<AcpConnectionFactory>[0]["workflowServers"]>[number]
    | undefined;
  let promptBlocks: ContentBlock[] = [];
  const service = createAcpService({
    directory,
    credentialReferenceReader: {
      async list() {
        if (readerFailure) throw new Error("Unable to read /private/credentials.json");
        return projectCredentialReferences(storedKeys);
      },
    },
    connect: async ({ workflowServers }) => {
      credentialServer = workflowServers?.find((server) => server.name === "zcode-credentials");
      return {
        sessionId: "native-credential-test",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt(_text, blocks) {
          promptBlocks = blocks ?? [];
        },
        async cancel() {},
        close() {},
      };
    },
  });

  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    assert.ok(credentialServer, "credential MCP server is provisioned during ACP attach");
    await service.prompt({
      ...workspace,
      id: session.id,
      commandId: crypto.randomUUID(),
      text: "Which authenticated integrations can this Host use?",
      attachments: [],
      workspaceFiles: [],
    });

    const promptText = promptBlocks
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.match(promptText, /zai-oauth/);
    assert.match(promptText, /ssh-workspace-credentials/);
    assert.match(promptText, /Other Host credentials: 1 stored reference/);
    assert.doesNotMatch(promptText, /private-workspace-id|private-integration|oauth:zai/);

    const env = credentialServer.config.env;
    assert.ok(env?.ZCODE_WORKFLOW_TOKEN);
    assert.ok(env?.ZCODE_WORKFLOW_URL);
    const listResponse = await fetch(env.ZCODE_WORKFLOW_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const listed = (await listResponse.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    assert.deepEqual(
      listed.result?.tools?.map(({ name }) => name),
      ["ListCredentialReferences"],
    );

    storedKeys = ["oauth:bigmodel:refresh_token"];
    const callResponse = await fetch(env.ZCODE_WORKFLOW_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "ListCredentialReferences", arguments: {} },
      }),
    });
    const called = (await callResponse.json()) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const metadata = called.result?.content?.[0]?.text ?? "";
    assert.match(metadata, /bigmodel-oauth/);
    assert.doesNotMatch(metadata, /oauth:bigmodel|private-workspace-id/);

    readerFailure = true;
    const failedCallResponse = await fetch(env.ZCODE_WORKFLOW_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "ListCredentialReferences", arguments: {} },
      }),
    });
    const failedCall = (await failedCallResponse.json()) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const errorText = failedCall.result?.content?.[0]?.text ?? "";
    assert.match(errorText, /Host credential metadata is unavailable/);
    assert.doesNotMatch(errorText, /private\/credentials\.json/);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
