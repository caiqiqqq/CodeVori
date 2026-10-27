import assert from "node:assert/strict";
import test from "node:test";
import { createRootTraceContext } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { runModelBackedTurnStep } from "../src/runtime/methods/turn-model-step.js";
import type { RegularTurnLoopState } from "../src/runtime/methods/turn-loop-state.js";

// 使用实际 model-step 编排入口，注入两种 provider 超窗协议及 compact 端口结果。
for (const transport of ["exception", "finish-reason"] as const) {
  for (const compactOutcome of ["compacted", "failed"] as const) {
    test(`${transport} context overflow ${compactOutcome === "compacted" ? "continues once after compact" : "terminates when compact fails"}`, async () => {
      const overflow = Object.assign(new Error("maximum context length exceeded"), {
        code: "context_length_exceeded",
      });
      let compacts = 0;
      let requests = 0;
      const runtime = {
        sessionId: "fixture-session",
        turnNumber: 1,
        config: {},
        agentTelemetry: {
          step: () => ({
            run: (fn: () => unknown) => fn(),
            finishCompleted() {},
            finishFailed() {},
            finishCancelled() {},
          }),
        },
        logModelRequestSteeringContext() {},
        persistAssistantMessage: async () => {},
        persistPart: async () => {},
        appendEvent: async () => {},
        createEvent: (type: string, data: unknown) => ({ type, data }),
        extractToolCallsFromResult: () => [],
        runModelTextRequest: async () => {
          requests++;
          if (transport === "exception") throw overflow;
          return {
            text: "",
            finishReason: "context_length_exceeded",
            usage: {},
            reasoning: [],
            providerMetadata: {},
          };
        },
        reactiveCompactAfterContextExceeded: async () => {
          compacts++;
          return compactOutcome;
        },
      } as unknown as AgentRuntimeInternal;
      const state = {
        input: "synthetic context test",
        modelStepCount: 0,
        historyRoundCount: 0,
        toolCallCount: 0,
        tokenCount: 0,
        events: [],
        turnTraceContext: createRootTraceContext(),
        turnAbortSignal: new AbortController().signal,
        turnRequestState: { entries: [], outputTokenContinuationCount: 0 },
        reactiveCompactAttemptedInCurrentModelStep: false,
        // 禁用无关的断流恢复；本测试验证超窗恢复的单次预算和失败终止。
        streamRecoveryRetryCount: 99,
        model: {
          providerId: "fixture",
          modelId: "synthetic",
          properties: { contextWindow: 1000 },
          optionSpecs: { maxOutputTokens: { max: 100 } },
        },
      } as unknown as RegularTurnLoopState;
      const run = () =>
        runModelBackedTurnStep.call(runtime, state, {
          messages: [],
          recordedMessages: [],
          sourceEntries: [],
          requestEntries: [],
          tools: [],
        });
      if (compactOutcome === "compacted") {
        assert.equal(await run(), "continue");
        assert.equal(state.historyRoundCount, 1);
        // 压缩后仍被 provider 拒绝必须显式抛错，不能无限重试成为“无响应”。
        await assert.rejects(run(), /context/i);
      } else {
        await assert.rejects(run(), /context/i);
      }
      assert.equal(compacts, 1);
      assert.equal(requests, compactOutcome === "compacted" ? 2 : 1);
    });
  }
}
