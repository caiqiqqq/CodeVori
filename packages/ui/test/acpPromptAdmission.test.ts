import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, type AcpSession } from "@zcode/shared";
import { waitForAcpPromptAdmission } from "../src/v4/acpPromptAdmission.ts";

const workspace = { workspacePath: "/tmp/acp-admission", workspaceIdentity: "remote:admission" };
const input = { ...workspace, id: "session-one", commandId: "command-one", text: "first turn" };
const snapshot = (patch: Partial<AcpSession> = {}) =>
  acpSessionSchema.parse({
    ...workspace,
    id: input.id,
    agent: "codex",
    acpSessionId: "native-one",
    status: "running",
    revision: 1,
    title: "test",
    entries: [{ id: `user:${input.commandId}`, kind: "user", text: input.text }],
    pendingPermission: null,
    error: null,
    ...patch,
  });

test("Host acceptance settles with all notifications lost and the Agent still running", async () => {
  let calls = 0;
  const receipt = snapshot();
  const service = {
    async submitPrompt() {
      calls++;
      return receipt;
    },
    async read() {
      throw new Error("no recovery needed");
    },
    prompt() {
      throw new Error("must not wait for the Agent turn");
    },
    onDynamicSessionChanged() {
      throw new Error("all notifications unavailable");
    },
  };
  assert.deepEqual(await waitForAcpPromptAdmission(service, workspace, input), receipt);
  assert.equal(calls, 1);
});

test("queued and discarded commands are durable acceptance receipts", async () => {
  for (const queue of [
    {
      items: [
        {
          commandId: input.commandId,
          text: input.text,
          attachments: [],
          workspaceFiles: [],
          state: "queued",
          createdAt: 1,
        },
      ],
      autoDrain: true,
    },
    { items: [], autoDrain: false, discardedCommandIds: [input.commandId] },
  ]) {
    const receipt = snapshot({ entries: [], queue: queue as AcpSession["queue"] });
    const service = { submitPrompt: async () => receipt, read: async () => receipt };
    assert.deepEqual(await waitForAcpPromptAdmission(service, workspace, input), receipt);
  }
});

test("lost ACK recovers accepted input from the same Host without resubmitting", async () => {
  let calls = 0;
  const receipt = snapshot();
  const service = {
    async submitPrompt() {
      calls++;
      throw new Error("connection closed");
    },
    read: async () => receipt,
  };
  assert.deepEqual(await waitForAcpPromptAdmission(service, workspace, input), receipt);
  assert.equal(calls, 1);
});

test("validation failure and unknown ACK retain the unaccepted draft", async () => {
  for (const error of [new Error("unsupported attachment"), new Error("connection closed")]) {
    const service = {
      submitPrompt: async () => {
        throw error;
      },
      read: async () => snapshot({ entries: [] }),
    };
    await assert.rejects(waitForAcpPromptAdmission(service, workspace, input), error);
  }
});

test("a different session, command, identity, path or attachment route cannot acknowledge input", async () => {
  for (const patch of [
    { id: "another-session" },
    { workspaceIdentity: "remote:other" },
    { workspacePath: "/tmp/other" },
    { remoteSessionId: "another-attachment" },
    { entries: [] },
  ]) {
    const receipt = snapshot(patch);
    const service = { submitPrompt: async () => receipt, read: async () => receipt };
    await assert.rejects(waitForAcpPromptAdmission(service, workspace, input), /not admitted/);
  }
});

test("malformed acceptance replies fail runtime schema validation", async () => {
  const service = {
    submitPrompt: async () => ({ entries: [] }) as unknown as AcpSession,
    read: async () => {
      throw Error("offline");
    },
  };
  await assert.rejects(waitForAcpPromptAdmission(service, workspace, input));
});

test("old Hosts explicitly require upgrade and never fall back to the long prompt RPC", async () => {
  const service = {
    async submitPrompt() {
      throw new Error("Method not found: submitPrompt");
    },
    async read() {
      throw new Error("must not recover unsupported method");
    },
    prompt() {
      throw new Error("must not submit to old endpoint");
    },
  };
  await assert.rejects(
    waitForAcpPromptAdmission(service, workspace, input),
    /ACP_HOST_UPGRADE_REQUIRED/,
  );
});
