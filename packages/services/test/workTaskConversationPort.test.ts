import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "@zcode/rpc";
import { acpSessionSchema, uuidv7, type AcpSessionChanged, type WorkTask } from "@zcode/shared";
import type { CommandEnvelope, ConversationTelemetryFact } from "@zcode/shared/zcode-protocol-v4";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import type { WorkTaskConversationEvent } from "../src/session/contract.js";
import { createWorkTaskConversation } from "../src/work-task/workTaskConversation.js";

function fixture(kind: "api" | "acp") {
  const changes = new Emitter<AcpSessionChanged>();
  const facts = new Emitter<ConversationTelemetryFact>();
  const lifecycle = new Emitter<{ workspaceKey: string; state: "unavailable" }>();
  const events: WorkTaskConversationEvent[] = [];
  const commands: CommandEnvelope[] = [];
  const stops: unknown[] = [];
  const calls: string[] = [];
  const task: WorkTask = {
    id: uuidv7(),
    workspacePath: "/project",
    title: "Task",
    prompt: "Build",
    status: "failed",
    execution:
      kind === "api"
        ? { kind, modelSelection: { providerId: "test", modelId: "model" }, mode: "build" }
        : { kind, agent: "codex", config: [] },
    archived: false,
    stopPending: false,
    runSeq: 1,
    runText: "Build",
    commandId: "old-command",
    sessionRequestId: uuidv7(),
    createdAt: 0,
    updatedAt: 0,
    session: { kind, id: "bound" },
    worktree: {
      rootPath: "/trees",
      path: "/trees/abcd/project",
      projectPath: "/project",
      branchName: "worktree/abcd",
      baseCommit: "abcdef",
    },
  };
  const acp = {
    onDynamicSessionChanged: ({ workspacePath }: { workspacePath: string }) => {
      assert.equal(workspacePath, task.worktree!.path);
      return changes.event;
    },
    stop: async (input: unknown) => {
      stops.push(input);
    },
  } as unknown as IAcpService;
  const agent = {
    onDynamicConversationTelemetryFact: ({ workspacePath }: { workspacePath: string }) => {
      assert.equal(workspacePath, task.worktree!.path);
      return facts.event;
    },
    onAgentRuntimeLifecycle: lifecycle.event,
    helloConversationV4: async () => {
      calls.push("hello");
      return { protocolVersion: 4 };
    },
    initializeConversationV4: async () => {
      calls.push("initialize");
    },
    sendConversationCommandV4: async ({ envelope }: { envelope: CommandEnvelope }) => {
      commands.push(envelope);
      return { commandId: envelope.commandId, status: "accepted" };
    },
  } as unknown as IZCodeAgentService;
  const port = createWorkTaskConversation({
    acp,
    agent,
    createNativeConnection: () => ({
      service: agent,
      setTransportFlowState: async () => {},
      dispose: async () => {
        calls.push("dispose");
      },
    }),
  });
  const watch = port.watch(task, (event) => events.push(event));
  return { task, port, watch, events, changes, facts, lifecycle, stops, calls, commands };
}

test("ACP watcher uses actual admitted user command, bound path/agent and ordered revisions only", async () => {
  const f = fixture("acp");
  try {
    const session = acpSessionSchema.parse({
      id: "bound",
      workspacePath: f.task.worktree!.path,
      agent: "codex",
      acpSessionId: "native",
      status: "idle",
      revision: 0,
      title: "Task",
      entries: [],
      pendingPermission: null,
      error: null,
    });
    const emit = () => f.changes.fire({ kind: "updated", session: structuredClone(session) });
    emit();
    session.status = "running";
    session.revision++;
    emit();
    assert.deepEqual(f.events, [], "no admitted user input means no new task run");
    session.entries.push({
      id: "user:new-command",
      kind: "user",
      text: "Continue",
      createdAt: 123,
    });
    session.id = "other";
    emit();
    session.id = "bound";
    session.agent = "claude";
    emit();
    session.agent = "codex";
    session.workspaceIdentity = "remote:other";
    emit();
    delete session.workspaceIdentity;
    assert.equal(f.events.length, 0);
    session.revision++;
    emit();
    emit();
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0]?.commandId, "new-command");
    assert.equal(f.events[0]?.startedAt, 123);
    session.revision++;
    session.pendingPermission = { requestId: "permission", title: "Ask", options: [] };
    emit();
    assert.equal(f.events.at(-1)?.status, "awaiting_input");
    session.pendingPermission = null;
    session.status = "idle";
    session.revision++;
    emit();
    assert.equal(f.events.at(-1)?.status, "review");
    session.status = "interrupted";
    session.error = "New error";
    session.revision++;
    emit();
    assert.equal(f.events.at(-1)?.error, "New error");
    const count = f.events.length;
    session.revision--;
    session.status = "running";
    emit();
    assert.equal(f.events.length, count);
    await f.port.stop(f.task, f.events[0]!);
    assert.deepEqual(f.stops, [
      { workspacePath: f.task.worktree!.path, id: "bound", expectedCommandId: "new-command" },
    ]);
    assert.deepEqual(f.commands, []);
  } finally {
    f.watch.dispose();
  }
});

test("API watcher tracks actual turn, multiple permissions, terminal and disconnect without commands", async () => {
  const f = fixture("api");
  try {
    const base = {
      version: 1 as const,
      eventId: uuidv7(),
      eventSeq: 1,
      occurredAt: 123,
      sessionId: "bound",
      sourceCommandId: "new-command",
      turnId: "new-turn",
    };
    f.facts.fire({ ...base, kind: "turn.started", sessionId: "other" });
    f.facts.fire({ ...base, kind: "turn.started", executionKind: "controlOnly" });
    f.facts.fire({ ...base, kind: "turn.started", backgroundSource: "workflow" });
    assert.deepEqual(f.events, []);
    f.facts.fire({ ...base, kind: "turn.started", foregroundExecutionId: "real-execution" });
    assert.equal(f.events.at(-1)?.status, "running");
    f.facts.fire({ ...base, kind: "permission.lifecycle", phase: "requested", toolCallId: "one" });
    f.facts.fire({ ...base, kind: "permission.lifecycle", phase: "requested", toolCallId: "two" });
    f.facts.fire({ ...base, kind: "permission.lifecycle", phase: "resolved", toolCallId: "one" });
    assert.equal(f.events.at(-1)?.status, "awaiting_input");
    f.facts.fire({ ...base, kind: "permission.lifecycle", phase: "resolved", toolCallId: "two" });
    assert.equal(f.events.at(-1)?.status, "running");
    const count = f.events.length;
    f.facts.fire({
      ...base,
      kind: "turn.terminal",
      status: "failed",
      sourceCommandId: "old-command",
    });
    assert.equal(f.events.length, count);
    f.facts.fire({ ...base, sourceCommandId: undefined, kind: "turn.terminal", status: "success" });
    assert.equal(f.events.at(-1)?.status, "review");
    f.lifecycle.fire({ workspaceKey: f.task.worktree!.path, state: "unavailable" });
    assert.equal(f.events.at(-1)?.error, "work-task.agent-disconnected");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.commands, []);
    await assert.rejects(
      f.port.stop(f.task, { ...f.events[0]!, foregroundExecutionId: undefined }),
      /stop-target-unavailable/,
    );
    assert.deepEqual(f.calls, []);
    await f.port.stop(f.task, f.events[0]!);
    assert.equal(f.commands[0]?.type, "stop");
    assert.deepEqual(f.commands[0]?.payload, { expectedForegroundExecutionId: "real-execution" });
    assert.deepEqual(f.calls, ["hello", "initialize", "dispose"]);
  } finally {
    f.watch.dispose();
  }
});
