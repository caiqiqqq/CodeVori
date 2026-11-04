import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompactTrigger,
  createSessionId,
  InMemorySessionEventStore,
  SessionEventType,
  type Model,
} from "@zcode/contracts";
import { SqliteSessionStore } from "../../adapters/src/storage/session-store/sqlite-session-store.js";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { MessageHistoryImpl, createRuntimeAssistantEntry } from "../src/agent/message-history.js";
import { hydrateMessageHistoryFromSession } from "../src/agent/session-history-hydrator.js";
import {
  createProviderToolRoundEntries,
  providerToolRoundsCompactGroupKey,
  withCompactGroupKey,
  type ProviderToolRound,
} from "../src/runtime/provider-tool-rounds/contract.js";
import { selectCompactEntries } from "../src/runtime/helpers/compact-selection.js";

for (const cancel of [false, true])
  test(`provider call without a result settles on ${cancel ? "cancel" : "stream end"}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-provider-recovery-"));
    const store = new SqliteSessionStore({ dbPath: join(root, "session.sqlite") });
    const abort = new AbortController();
    const events = new InMemorySessionEventStore({ retention: "unbounded" });
    const model = {
      providerId: "fixture",
      modelId: "fixture",
      properties: {
        contextWindow: 200000,
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
      async *streamText() {
        yield { type: "text_delta", text: "读取图片" };
        yield {
          type: "tool_call",
          toolCall: { id: "call", name: "analyze_image", input: {}, providerExecuted: true },
        };
        if (cancel) {
          abort.abort();
          throw new DOMException("Aborted", "AbortError");
        }
        yield { type: "finish", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } };
      },
    } as unknown as Model;
    const sessionId = createSessionId();
    const runtime = new AgentRuntime(
      sessionId,
      {
        modelSelection: { providerId: "fixture", modelId: "fixture" },
        workingDirectory: root,
        modelStreaming: "on",
        compact: { enabled: false },
        memory: { enabled: false },
      },
      { eventStore: events, sessionStore: store, modelFactory: () => model },
    );
    try {
      await runtime
        .executeTurn("查看图片", undefined, { abortSignal: abort.signal })
        .catch((error) => {
          if (!cancel) throw error;
        });
      const persisted = await store.messages({ sessionID: sessionId });
      const part = persisted
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool");
      assert.equal(part?.type === "tool" && part.state.status, "error");
      assert.equal(part?.metadata?.providerExecuted, true);
      const cold = new MessageHistoryImpl();
      await hydrateMessageHistoryFromSession({ history: cold, messages: persisted });
      const messages = cold
        .toRuntimeEntries()
        .filter((entry) => "message" in entry)
        .map((entry) => entry.message);
      assert.deepEqual(
        messages.map((message) => message.role),
        ["user", "assistant", "tool"],
      );
      assert.equal(messages[2]?.isError, true);
      assert.match(JSON.stringify(messages[2]), /interrupted/);
      const results = (await events.getEvents(sessionId)).filter(
        (event) => event.type === SessionEventType.ToolCallResult,
      );
      assert.equal(results.length, 1);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

test("compact groups use persisted messages even when adjacent responses reuse a tool call id", () => {
  const entries = ["message-one", "message-two", "message-three"].flatMap((messageId) => {
    const round: ProviderToolRound = {
      messageId,
      reasoning: [],
      text: "before",
      toolCall: { id: "call", name: "analyze_image", input: {}, providerExecuted: true },
      result: { output: "image", isError: false },
    };
    return withCompactGroupKey(
      [...createProviderToolRoundEntries([round]), createRuntimeAssistantEntry("after")],
      providerToolRoundsCompactGroupKey([round]),
    );
  });
  const history = new MessageHistoryImpl();
  history.addEntries(entries);
  const selection = selectCompactEntries({
    entries: history.toRuntimeEntries(),
    trigger: CompactTrigger.Auto,
    minimumGroupsToPreserve: 1,
  });
  assert.equal(selection.totalGroups, 3);
  assert.deepEqual(
    new Set(
      selection.preservedEntries
        .filter((entry) => "message" in entry && entry.message.role === "assistant")
        .map((entry) => entry.compactGroupKey),
    ),
    new Set(["message-three"]),
  );
});
