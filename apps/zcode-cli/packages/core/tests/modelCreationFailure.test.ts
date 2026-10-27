import assert from "node:assert/strict";
import test from "node:test";
import {
  CoreErrorType,
  SessionEventType,
  createRootTraceContext,
  type Model,
  type SessionEvent,
} from "@zcode/contracts";
import { MessageHistoryImpl } from "../src/agent/message-history.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import type { ExecuteTurnOptions } from "../src/runtime/types.js";
import { executeTurnCommand } from "../src/runtime/methods/turn.js";
import { createExternalTurnFaultError } from "../src/runtime/helpers/turn-errors.js";

function fixture() {
  const creationError = new Error("Synthetic provider missing from registry");
  const events: SessionEvent[] = [];
  const calls: string[] = [];
  const prompts: unknown[][] = [];
  const selection = { providerId: "fixture", modelId: "unavailable" };
  const activeTurns: { steerable: boolean }[] = [];
  const state = {
    failCreation: true,
    persistError: undefined as Error | undefined,
    ensureError: undefined as Error | undefined,
    onPersist: undefined as (() => void) | undefined,
  };
  const runtime = {
    sessionId: "fixture-session",
    rootTraceContext: createRootTraceContext(),
    config: {},
    turnNumber: 0,
    workingDirectory: "/fixture",
    messageHistory: new MessageHistoryImpl(),
    now: () => new Date("2026-10-27T00:00:00Z"),
    getSessionModelSelection: () => selection,
    setSessionModelSelection() {
      calls.push("set-selection");
    },
    modelFactory() {
      calls.push("create-model");
      if (state.failCreation) throw creationError;
      return {
        providerId: "fixture",
        modelId: "available",
        properties: {},
        options: {},
        optionSpecs: {},
        generateText() {
          throw new Error("Unexpected model request");
        },
        streamText() {
          throw new Error("Unexpected model request");
        },
      } as Model;
    },
    agentTelemetry: {
      turn: () => ({
        run: (execute: () => unknown) => execute(),
        finishCompleted() {},
        finishCancelled() {},
        finishFailed() {},
      }),
    },
    logger: {
      debug() {},
      info() {},
      error() {},
      warn(_message: string, details: { event?: string }) {
        calls.push(details.event ?? "warn");
      },
    },
    reserveTurnStart() {
      calls.push("reserve");
    },
    releaseTurnStart() {
      calls.push("release");
    },
    beginActiveTurn(_id: unknown, _trace: unknown, _kind: unknown, steerable: boolean) {
      const activeTurn = { steerable, pendingInputs: [] };
      activeTurns.push(activeTurn);
      return activeTurn;
    },
    finishActiveTurn() {
      calls.push("finish");
    },
    ensureContextInitialized() {
      calls.push("context");
    },
    runSessionStartHooks() {
      calls.push("session-hooks");
      return { additionalContexts: [] };
    },
    runUserPromptSubmitHooks() {
      calls.push("prompt-hooks");
      return { additionalContexts: [], preventContinuation: true };
    },
    injectHookAdditionalContextIntoMessageHistory() {},
    ensureSessionPersisted() {
      calls.push("ensure-session");
      if (state.ensureError) throw state.ensureError;
    },
    readSessionTargetForContext() {
      calls.push("read-target");
      return null;
    },
    startTargetTurnAccounting({ startedTarget }: { startedTarget: unknown }) {
      return startedTarget;
    },
    finishTargetTurnAccounting() {
      return null;
    },
    accountTargetTurnCompletion() {},
    pauseActiveTargetForCancellation() {
      calls.push("pause");
    },
    fallbackPendingGuidesToQueue() {},
    persistPendingModelChangeTimeline() {},
    persistUserPrompt(...args: unknown[]) {
      state.onPersist?.();
      if (state.persistError) throw state.persistError;
      prompts.push(args);
    },
    persistSyntheticUserNoticeForSession(...args: unknown[]) {
      prompts.push(args);
    },
    createEvent(type: SessionEvent["type"], payload: unknown, context: { turnId: string }) {
      return { type, payload, turnId: context.turnId, timestamp: new Date() } as SessionEvent;
    },
    appendEvent(event: SessionEvent) {
      events.push(event);
    },
    rebuildProjection: () => ({ pendingSteerInputs: [] }),
  };
  return {
    runtime: runtime as unknown as AgentRuntimeInternal,
    events,
    prompts,
    calls,
    activeTurns,
    state,
    creationError,
  };
}

async function runFailure(f: ReturnType<typeof fixture>, options?: ExecuteTurnOptions) {
  let rejection: unknown;
  try {
    await executeTurnCommand.call(f.runtime, "expanded model input", undefined, {
      inputId: "accepted-command",
      displayInput: "original user input",
      ...options,
    });
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection, "failed turn must reject");
  assert.ok(f.calls.includes("release"));
  assert.ok(f.calls.includes("finish"));
  return rejection as Error & { type: CoreErrorType; cause?: unknown };
}

test("accepted input survives model creation failure through the real turn lifecycle", async () => {
  const f = fixture();
  const error = await runFailure(f, {
    intent: { modelSelection: { providerId: "fixture", modelId: "missing" } },
  } as ExecuteTurnOptions);
  assert.equal(error.cause, f.creationError);
  assert.deepEqual(
    f.events.map((e) => e.type),
    [SessionEventType.TurnStarted, SessionEventType.TurnError],
  );
  const start = f.events[0]!.payload as { input: string; inputId: string; messageId: string };
  assert.equal(start.input, "original user input");
  assert.equal(start.inputId, "accepted-command");
  assert.equal(f.prompts.length, 1);
  assert.equal(f.prompts[0]![0], start.messageId);
  assert.equal(f.prompts[0]![1], start.input);
  assert.match(
    JSON.stringify(f.runtime.messageHistory.borrowReadOnlyRuntimeEntries()),
    /expanded model input/,
  );
  assert.equal((f.events[1]!.payload as { turnPhase: string }).turnPhase, "model_creation");
  assert.deepEqual(
    f.activeTurns.map((t) => t.steerable),
    [false],
  );
  for (const forbidden of [
    "context",
    "session-hooks",
    "prompt-hooks",
    "set-selection",
    "read-target",
  ])
    assert.equal(f.calls.includes(forbidden), false, forbidden);
  assert.equal(f.calls.filter((c) => c === "create-model").length, 1);
});

test("creation failure preserves attachment metadata and the canonical persisted message", async () => {
  const f = fixture();
  await assert.rejects(
    executeTurnCommand.call(f.runtime, "inspect attachment", [
      {
        type: "file",
        filename: "fixture.txt",
        content: "synthetic attachment",
        mimeType: "text/plain",
      },
    ]),
    (error) => (error as Error).cause === f.creationError,
  );
  assert.equal(f.prompts.length, 1);
  assert.match(JSON.stringify(f.prompts[0]), /synthetic attachment/);
  assert.match(JSON.stringify(f.events[0]?.payload), /fixture.txt/);
  assert.equal(f.events.at(-1)?.type, SessionEventType.TurnError);
});

for (const phase of ["persistError", "ensureError"] as const) {
  test(`secondary ${phase} cannot replace the creation failure or escape terminal handling`, async () => {
    const f = fixture();
    f.state[phase] = new Error("Synthetic storage failure");
    const error = await runFailure(f);
    assert.equal(error.cause, f.creationError);
    assert.equal(f.events.at(-1)?.type, SessionEventType.TurnError);
    assert.ok(f.calls.includes("turn.model_creation.input_persistence_failed"));
  });
}

for (const externalFault of [false, true]) {
  test(`abort during failed input recording retains ${externalFault ? "host fault" : "user cancellation"} semantics`, async () => {
    const f = fixture();
    const controller = new AbortController();
    f.state.onPersist = () => {
      controller.abort(
        externalFault ? createExternalTurnFaultError("fixture.host_lost") : undefined,
      );
      throw controller.signal.reason;
    };
    const error = await runFailure(f, { abortSignal: controller.signal });
    assert.equal(error.type === CoreErrorType.TurnCancelled, !externalFault);
    assert.equal(
      f.events.at(-1)?.type,
      externalFault ? SessionEventType.TurnError : SessionEventType.TurnComplete,
    );
    if (externalFault)
      assert.equal(
        (f.events.at(-1)?.payload as { error: { type: string } }).error.type,
        "fixture.host_lost",
      );
  });
}

test("already recorded input is not duplicated", async () => {
  const f = fixture();
  await runFailure(f, { skipInputRecord: true });
  assert.equal(f.prompts.length, 0);
  assert.equal(f.events.at(-1)?.type, SessionEventType.TurnError);
});

test("compact creation failure does not manufacture a user message", async () => {
  const f = fixture();
  await assert.rejects(executeTurnCommand.call(f.runtime, "/compact"));
  assert.deepEqual(
    f.events.map((e) => e.type),
    [SessionEventType.TurnError],
  );
  assert.equal(f.prompts.length, 0);
  assert.equal(f.calls.includes("release"), true);
});

test("a recovered provider allows the next turn to start and finish", async () => {
  const f = fixture();
  await runFailure(f);
  f.state.failCreation = false;
  const result = await executeTurnCommand.call(f.runtime, "next input");
  assert.ok(result);
  assert.deepEqual(
    f.events.map((e) => e.type),
    [
      SessionEventType.TurnStarted,
      SessionEventType.TurnError,
      SessionEventType.TurnStarted,
      SessionEventType.TurnComplete,
    ],
  );
  assert.equal(f.calls.filter((c) => c === "release").length, 2);
  assert.equal(f.calls.filter((c) => c === "finish").length, 2);
  assert.deepEqual(
    f.activeTurns.map((t) => t.steerable),
    [false, false],
  );
});
