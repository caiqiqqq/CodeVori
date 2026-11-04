import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSessionId,
  InMemorySessionEventStore,
  type Model,
  type ModelResult,
} from "@zcode/contracts";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { isZeroOutputModelCompletion } from "../../adapters/src/model/runner-diagnostics.js";

for (const reason of [
  "content-filter",
  "content_filter",
  "sensitive",
  "refusal",
  "context_length_exceeded",
]) {
  test(`adapter does not retry an explicit ${reason} finish`, () => {
    for (const raw of [false, true])
      assert.equal(
        isZeroOutputModelCompletion({
          finishReason: raw ? "unknown" : reason,
          rawFinishReason: raw ? reason : undefined,
          reasoningLength: 0,
          textLength: 0,
          toolCallCount: 0,
        }),
        false,
      );
    assert.equal(
      isZeroOutputModelCompletion({
        finishReason: "unknown",
        reasoningLength: 0,
        textLength: 0,
        toolCallCount: 0,
      }),
      true,
    );
  });
}

for (const stream of [false, true]) {
  test(`a ${stream ? "streaming" : "non-streaming"} safety refusal stops after one model request`, async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-content-filter-"));
    let calls = 0;
    const model = {
      providerId: "fixture",
      modelId: "fixture",
      properties: {
        contextWindow: 200_000,
        supportsToolCall: true,
        supportsMidConversationSystem: true,
        inputFormat: { supportsText: true },
        outputFormat: { supportsText: true },
      },
      optionSpecs: { maxOutputTokens: { max: 32000 } },
      options: { maxOutputTokens: 32000 },
      bind() {
        return this;
      },
      async generateText(): Promise<ModelResult> {
        calls++;
        return {
          text: "",
          finishReason: "content-filter",
          reasoning: [{ type: "reasoning", text: "reasoning" }],
          usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
        } as ModelResult;
      },
      async *streamText() {
        calls++;
        yield {
          type: "finish",
          finishReason: "unknown",
          providerMetadata: { rawFinishReason: "sensitive" },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
    } as unknown as Model;
    const runtime = new AgentRuntime(
      createSessionId(),
      {
        modelSelection: { providerId: "fixture", modelId: "fixture" },
        workingDirectory: root,
        modelStreaming: stream ? "on" : "off",
      },
      {
        eventStore: new InMemorySessionEventStore({ retention: "unbounded" }),
        modelFactory: () => model,
      },
    );
    try {
      await assert.rejects(runtime.executeTurn("fixture"), (error: unknown) => {
        const failure = error as { retryable?: boolean; context?: { reason?: string } };
        assert.equal(failure.retryable, false);
        assert.equal(failure.context?.reason, "content_filter");
        return true;
      });
      assert.equal(calls, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
