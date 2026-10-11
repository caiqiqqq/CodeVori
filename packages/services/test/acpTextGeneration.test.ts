import assert from "node:assert/strict";
import { test } from "node:test";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { acpSessionSchema, type AcpGenerateText, type AcpSession } from "@zcode/shared";
import { AcpTextGeneration } from "../src/acp/acpTextGeneration.js";
import type { AcpConnectionFactory, AcpConnectionPort } from "../src/acp/acpServiceImpl.js";
import type { AcpAgentManager } from "../src/acp/acpAgentManager.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture() {
  const session = acpSessionSchema.parse({
    id: "bound",
    workspacePath: "/synthetic/project",
    agent: "claude",
    acpSessionId: "native",
    title: "Original",
    status: "idle",
    pendingPermission: null,
    error: null,
    revision: 3,
    entries: [],
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "current-model",
        options: [{ value: "current-model", name: "Current Model" }],
      },
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "bypassPermissions",
        options: [{ value: "bypassPermissions", name: "Full" }],
      },
    ],
  });
  let input!: Parameters<AcpConnectionFactory>[0];
  let promptCalls = 0;
  let closeCalls = 0;
  let cancelCalls = 0;
  const configured: string[] = [];
  const connected = deferred<void>();
  const prompted = deferred<void>();
  let handshake: Promise<void> = Promise.resolve();
  let promptGate: Promise<void> = Promise.resolve();
  let afterPrompt = () => {};
  const port: AcpConnectionPort = {
    sessionId: "auxiliary",
    configOptions: structuredClone(session.configOptions.filter((option) => option.id !== "mode")),
    modeState: null,
    setConfigOption: async (id, value) => {
      configured.push(id);
      port.configOptions.find((option) => option.id === id)!.currentValue = value;
      return port.configOptions;
    },
    setMode: async () => {
      throw new Error("must not restore execution mode");
    },
    prompt: async () => {
      promptCalls++;
      prompted.resolve();
      await promptGate;
      await input.onUpdate({ kind: "text", text: "Summary" });
      afterPrompt();
    },
    close: () => {
      closeCalls++;
    },
    cancel: async () => {
      cancelCalls++;
    },
  };
  const manager = {
    resolveLaunch: async () => ({ command: "synthetic-adapter", args: [], env: {} }),
  } as unknown as AcpAgentManager;
  const owner = new AcpTextGeneration({
    read: async () => structuredClone(session),
    manager,
    connect: async (value) => {
      input = value;
      connected.resolve();
      await handshake;
      return port;
    },
  });
  const request: AcpGenerateText = {
    workspacePath: session.workspacePath,
    id: session.id,
    expectedRevision: 3,
    requestId: randomUUID(),
    prompt: "Summarize supplied evidence only",
  };
  return {
    owner,
    session,
    port,
    request,
    connected,
    prompted,
    configured,
    input: () => input,
    counts: () => ({ promptCalls, closeCalls, cancelCalls }),
    handshake: (gate: Promise<void>) => {
      handshake = gate;
    },
    promptGate: (gate: Promise<void>) => {
      promptGate = gate;
    },
    afterPrompt: (fn: () => void) => {
      afterPrompt = fn;
    },
  };
}

test("Claude summary is isolated, copies current model/reasoning, and leaves the source untouched", async () => {
  const f = fixture();
  f.port.configOptions[0]!.currentValue = "default";
  f.port.configOptions[1]!.currentValue = "low";
  const before = structuredClone(f.session);
  const result = await f.owner.generate(f.request);
  assert.equal(result.text, "Summary");
  assert.equal(result.source.modelId, "current-model");
  assert.deepEqual(f.configured, ["model", "effort"]);
  assert.equal(f.input().agent, "claude");
  assert.equal(f.input().textOnly, true);
  assert.equal(f.input().sessionId, undefined);
  assert.notEqual(f.input().workspacePath, f.session.workspacePath);
  assert.equal(f.input().mcpServers, undefined);
  assert.equal(f.input().workflowServers, undefined);
  assert.equal(
    await f.input().onPermission({ requestId: "permission", title: "Write", options: [] }),
    null,
  );
  assert.deepEqual(f.session, before);
  await assert.rejects(stat(f.input().workspacePath), { code: "ENOENT" });
});

test("cancel before a delayed handshake closes the late connection without sending input", async () => {
  const f = fixture();
  const gate = deferred<void>();
  f.handshake(gate.promise);
  const result = f.owner.generate(f.request);
  await f.connected.promise;
  await f.owner.cancel({
    workspacePath: f.request.workspacePath,
    id: "other",
    requestId: f.request.requestId,
  });
  assert.equal(f.counts().closeCalls, 0);
  await f.owner.cancel({
    workspacePath: f.request.workspacePath,
    id: f.request.id,
    requestId: f.request.requestId,
  });
  gate.resolve();
  await assert.rejects(result, /result-canceled/);
  assert.equal(f.counts().promptCalls, 0);
  assert.ok(f.counts().closeCalls > 0);
  await assert.rejects(stat(f.input().workspacePath), { code: "ENOENT" });
});

test("dispose cancels only the auxiliary prompt and waits for cleanup", async () => {
  const f = fixture();
  const gate = deferred<void>();
  f.promptGate(gate.promise);
  const result = f.owner.generate(f.request);
  await f.prompted.promise;
  f.owner.dispose();
  gate.resolve();
  await assert.rejects(result, /result-canceled/);
  await f.owner.settle();
  assert.equal(f.session.status, "idle");
  assert.deepEqual(f.session.entries, []);
  assert.ok(f.counts().cancelCalls > 0);
  await assert.rejects(stat(f.input().workspacePath), { code: "ENOENT" });
});

test("model changes and incompatible model catalogs fail without generating or falling back", async () => {
  const changed = fixture();
  changed.afterPrompt(() => {
    changed.session.configOptions[1]!.currentValue = "low";
  });
  await assert.rejects(changed.owner.generate(changed.request), /result-source-changed/);
  const incompatible = fixture();
  incompatible.port.configOptions[0]!.options = [];
  await assert.rejects(
    incompatible.owner.generate(incompatible.request),
    /result-model-unavailable/,
  );
  assert.equal(incompatible.counts().promptCalls, 0);
});

test("wrong scope/revision, busy source, unsupported adapter and remote source never connect", async () => {
  for (const mutation of [
    (s: AcpSession) => {
      s.revision++;
    },
    (s: AcpSession) => {
      s.status = "running";
    },
    (s: AcpSession) => {
      s.workspacePath = "/wrong";
    },
    (s: AcpSession) => {
      s.agent = "gemini";
    },
  ]) {
    const f = fixture();
    mutation(f.session);
    await assert.rejects(f.owner.generate(f.request), /result-(source-changed|agent-unsupported)/);
    assert.equal(f.counts().promptCalls, 0);
  }
  const f = fixture();
  assert.throws(
    () => f.owner.generate({ ...f.request, remoteSessionId: "remote" }),
    /remote-unsupported/,
  );
});

test("Codex uses the native text runner with the original model and no ACP prompt", async () => {
  const f = fixture();
  f.session.agent = "codex";
  let captured: unknown;
  const owner = new AcpTextGeneration({
    read: async () => structuredClone(f.session),
    manager: {
      resolveLaunch: async () => ({ command: "codex-acp", args: [], env: {} }),
    } as unknown as AcpAgentManager,
    connect: async () => {
      throw new Error("must not use writable ACP mode");
    },
    codex: async (input) => {
      captured = input.session.configOptions[0]!.currentValue;
      return "Native summary";
    },
  });
  assert.equal((await owner.generate(f.request)).text, "Native summary");
  assert.equal(captured, "current-model");
});
