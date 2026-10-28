import assert from "node:assert/strict";
import test from "node:test";
import { type AcpCommandReceipt } from "@zcode/shared";
import { waitForAcpPromptAdmission } from "../src/v4/acpPromptAdmission.ts";

const workspace = { workspacePath: "/tmp/acp-admission", workspaceIdentity: "remote:admission" };
const input = { ...workspace, id: "session-one", commandId: "command-one", text: "first turn" };
const receipt = (patch: Partial<AcpCommandReceipt> = {}): AcpCommandReceipt => ({
  ...workspace,
  id: input.id,
  commandId: input.commandId,
  ack: { commandId: input.commandId, status: "accepted", revisionAtDecision: 1 },
  disposition: "started",
  sessionStatus: "running",
  ...patch,
});

test("bounded Host ACK settles with notifications lost and Agent still running", async () => {
  let calls = 0;
  const accepted = receipt();
  const service = {
    async sendConversationCommand(command) {
      calls++;
      assert.equal(command.type, "sendText");
      assert.deepEqual(command.payload, { text: input.text });
      return accepted;
    },
    async queryConversationCommand() {
      throw new Error("no recovery needed");
    },
  };
  assert.deepEqual(await waitForAcpPromptAdmission(service, workspace, input), accepted);
  assert.equal(calls, 1);
});

test("queued and discarded commands are durable receipts without queue contents", async () => {
  for (const disposition of ["queued", "discarded"] as const) {
    const accepted = receipt({ disposition });
    assert.deepEqual(
      await waitForAcpPromptAdmission(
        {
          sendConversationCommand: async () => accepted,
          queryConversationCommand: async () => accepted,
        },
        workspace,
        input,
      ),
      accepted,
    );
  }
});

test("lost ACK queries the same command without resubmitting or fetching history", async () => {
  let calls = 0;
  const accepted = receipt();
  const service = {
    async sendConversationCommand() {
      calls++;
      throw new Error("connection closed");
    },
    async queryConversationCommand(query) {
      assert.deepEqual(query, { ...workspace, id: input.id, commandId: input.commandId });
      return accepted;
    },
  };
  assert.deepEqual(await waitForAcpPromptAdmission(service, workspace, input), accepted);
  assert.equal(calls, 1);
});

test("validation failure and unknown ACK preserve the draft and original error", async () => {
  for (const error of [new Error("unsupported attachment"), new Error("connection closed")]) {
    await assert.rejects(
      waitForAcpPromptAdmission(
        {
          sendConversationCommand: async () => {
            throw error;
          },
          queryConversationCommand: async () => null,
        },
        workspace,
        input,
      ),
      error,
    );
  }
});

test("different session, command, identity, path or route cannot acknowledge input", async () => {
  for (const patch of [
    { id: "another-session" },
    { commandId: "another-command" },
    { workspaceIdentity: "remote:other" },
    { workspacePath: "/tmp/other" },
    { remoteSessionId: "another-attachment" },
    { ack: { commandId: "other", status: "accepted" as const, revisionAtDecision: 1 } },
    { ack: { commandId: input.commandId, status: "rejected" as const, revisionAtDecision: 1 } },
  ]) {
    const accepted = receipt(patch);
    await assert.rejects(
      waitForAcpPromptAdmission(
        {
          sendConversationCommand: async () => accepted,
          queryConversationCommand: async () => accepted,
        },
        workspace,
        input,
      ),
      /not admitted/,
    );
  }
});

test("snapshot-shaped or malformed responses cannot be used as command receipts", async () => {
  await assert.rejects(
    waitForAcpPromptAdmission(
      {
        sendConversationCommand: async () => ({ entries: [] }) as unknown as AcpCommandReceipt,
        queryConversationCommand: async () => null,
      },
      workspace,
      input,
    ),
  );
});

test("old Hosts require upgrade and never fall back to snapshot or whole-turn RPC", async () => {
  await assert.rejects(
    waitForAcpPromptAdmission(
      {
        async sendConversationCommand() {
          throw new Error("Method not found: sendConversationCommand");
        },
        async queryConversationCommand() {
          throw new Error("must not recover unsupported method");
        },
      },
      workspace,
      input,
    ),
    /ACP_HOST_UPGRADE_REQUIRED/,
  );
});
