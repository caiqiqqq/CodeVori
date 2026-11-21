import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { ChannelClient, ChannelServer, ProxyChannel, createQueuePair } from "@zcode/rpc";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import type { IAcpService } from "../src/acp/acpService.js";
import { createProjectEnvironmentService } from "../src/credential/projectEnvironmentService.js";

for (const routed of [false, true]) {
  test(`ACP ${routed ? "routed" : "local"} RPC and legacy sends use the real environment input guard`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "codevori-acp-environment-"));
    const workspace = {
      workspacePath: directory,
      ...(routed
        ? { workspaceIdentity: "fixture:environment", remoteSessionId: "attachment-one" }
        : {}),
    };
    const calls: Array<{ text: string; blocks?: ContentBlock[] }> = [];
    const finished = new Map<string, () => void>();
    const environments = createProjectEnvironmentService({
      databasePath: join(directory, "environments.sqlite"),
      listCredentials: async () => [],
      assertSessionIdle: async () => {},
    });
    const service = createAcpService({
      directory: join(directory, "sessions"),
      beginEnvironmentInput: (scope, sessionId) =>
        environments.beginInput({ ...scope, kind: "acp", sessionId }),
      connect: async () => ({
        sessionId: "native-environment",
        configOptions: [],
        modeState: null,
        promptCapabilities: { embeddedContext: true },
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt(text, blocks) {
          calls.push({ text, blocks });
          finished.get(text)?.();
        },
        async cancel() {},
        close() {},
      }),
    });
    const [left, right] = createQueuePair();
    const server = new ChannelServer(right, "environment-test");
    server.registerChannel("acp", ProxyChannel.fromService(service));
    const client = new ChannelClient(left);
    const rpc = ProxyChannel.toService<IAcpService>(client.getChannel("acp"));
    t.after(async () => {
      client.dispose();
      server.dispose();
      await service.disposeAllAndWait();
      environments.dispose();
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(join(directory, "context.txt"), "Workspace context");

    for (const method of ["sendConversationCommand", "submitPrompt", "prompt"] as const) {
      const session = await rpc.create({ ...workspace, agent: "codex" });
      const target = { ...workspace, id: session.id };
      const environmentTarget = {
        workspacePath: workspace.workspacePath,
        ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
        kind: "acp" as const,
        sessionId: session.id,
      };
      assert.equal(
        (await environments.getSessionEnvironment(environmentTarget)).environmentId,
        null,
      );
      const input = {
        ...target,
        commandId: `input-${method}`,
        text: method,
        attachments: [
          {
            fileName: "note.txt",
            mimeType: "text/plain",
            dataBase64: Buffer.from("Attachment context").toString("base64"),
          },
        ],
        workspaceFiles: ["context.txt"],
      };
      const executed = new Promise<void>((resolve) => finished.set(method, resolve));
      if (method === "sendConversationCommand") {
        const { commandId, text, attachments, workspaceFiles } = input;
        const command = {
          ...target,
          commandId,
          type: "sendText" as const,
          payload: { text, attachments, workspaceFiles },
        };
        const receipt = await rpc.sendConversationCommand(command);
        assert.equal(receipt.ack.status, "accepted");
        assert.equal(receipt.disposition, "started");
        assert.equal(receipt.remoteSessionId, workspace.remoteSessionId);
        assert.equal(receipt.workspaceIdentity, workspace.workspaceIdentity);
        await rpc.sendConversationCommand(command);
      } else {
        await rpc[method](input);
      }
      await executed;
      assert.equal(calls.filter((call) => call.text === method).length, 1);
      const blocks = calls.find((call) => call.text === method)!.blocks!;
      assert.ok(
        blocks.some((block) => block.type === "resource_link" && block.name === "context.txt"),
      );
      assert.ok(
        blocks.some(
          (block) =>
            block.type === "resource" &&
            "blob" in block.resource &&
            block.resource.blob === input.attachments[0]!.dataBase64,
        ),
      );
      const snapshot = await rpc.read(target);
      const user = snapshot.entries.find((entry) => entry.kind === "user");
      assert.equal(user?.text, method);
      assert.deepEqual(user?.attachmentNames, ["note.txt", "context.txt"]);
      assert.equal(user?.attachments?.length, 1);
      const invalid = { ...input, commandId: "invalid", extra: true };
      await assert.rejects(rpc.prompt(invalid), /Unrecognized key/);
      assert.equal(
        (
          await environments.setSessionEnvironment({
            ...environmentTarget,
            environmentId: null,
            expectedRevision: 0,
          })
        ).revision,
        1,
        "successful and failed admissions release the environment guard",
      );
    }
  });
}
