import assert from "node:assert/strict";
import test from "node:test";
import { waitForAcpPromptAdmission } from "../src/v4/acpPromptAdmission.ts";
import type { IAcpService } from "@zcode/services";
import type { AcpSessionChanged } from "@zcode/shared";

const workspace = { workspacePath: "/tmp/acp-admission" };
const input = {
  id: "session-one",
  commandId: "command-one",
  text: "first turn",
  attachments: [],
  workspaceFiles: [],
};

function harness() {
  let listener: ((change: AcpSessionChanged) => void) | undefined;
  let resolveTurn!: (value: unknown) => void;
  let rejectTurn!: (error: Error) => void;
  let disposed = false;
  let admittedOnRead = false;
  const service = {
    onDynamicSessionChanged: () => (callback: typeof listener) => {
      listener = callback;
      return {
        dispose: () => {
          disposed = true;
          listener = undefined;
        },
      };
    },
    prompt: () =>
      new Promise((resolve, reject) => {
        resolveTurn = resolve;
        rejectTurn = reject;
      }),
    read: async () => ({ entries: admittedOnRead ? [{ id: `user:${input.commandId}` }] : [] }),
  } as unknown as Pick<IAcpService, "onDynamicSessionChanged" | "prompt" | "read">;
  const emit = (sessionId: string, commandId: string) =>
    listener?.({
      kind: "updated",
      session: {
        id: sessionId,
        entries: [{ id: `user:${commandId}`, kind: "user", text: input.text }],
      },
    } as AcpSessionChanged);
  return {
    service,
    emit,
    resolveTurn: () => resolveTurn({ entries: [] }),
    rejectTurn: (error: Error) => rejectTurn(error),
    markAccepted: () => {
      admittedOnRead = true;
    },
    get disposed() {
      return disposed;
    },
  };
}

test("ACP input settles on Host admission while the Agent turn is still running", async () => {
  const host = harness();
  const admitted = waitForAcpPromptAdmission(host.service, workspace, input);
  host.emit("another-session", input.commandId);
  host.emit(input.id, "another-command");
  assert.equal(host.disposed, false);
  host.emit(input.id, input.commandId);
  await admitted;
  assert.equal(host.disposed, true);
  // A later model failure belongs to the accepted turn, not to the composer draft.
  host.rejectTurn(new Error("Agent interrupted"));
});

test("ACP validation rejection preserves the unadmitted draft", async () => {
  const host = harness();
  const admitted = waitForAcpPromptAdmission(host.service, workspace, input);
  host.rejectTurn(new Error("unsupported attachment"));
  await assert.rejects(admitted, /unsupported attachment/);
  assert.equal(host.disposed, true);
});

test("an RPC error after Host admission still clears the accepted input", async () => {
  const host = harness();
  const admitted = waitForAcpPromptAdmission(host.service, workspace, input);
  host.markAccepted();
  host.rejectTurn(new Error("Agent interrupted before notification"));
  await admitted;
  assert.equal(host.disposed, true);
});

test("idempotent completed reply counts only if the Host contains the matching user entry", async () => {
  const host = harness();
  const admitted = waitForAcpPromptAdmission(host.service, workspace, input);
  host.resolveTurn();
  await assert.rejects(admitted, /not admitted/);
});
