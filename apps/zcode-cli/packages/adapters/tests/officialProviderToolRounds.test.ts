import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionId, InMemorySessionEventStore, SessionEventType } from "@zcode/contracts";
import {
  createRegistryModelConfig,
  createRegistryProviderConfig,
  parseModelConfig,
  parseProviderConfig,
} from "@zcode/provider";
import { AiSdkModelAdapter } from "../src/model/runner.js";
import { createAnthropicCompatFetch } from "../src/model/anthropic-stream-compat.js";
import { SqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import { AgentRuntime } from "../../core/src/runtime/agent-runtime.js";
import { MessageHistoryImpl } from "../../core/src/agent/message-history.js";
import { hydrateMessageHistoryFromSession } from "../../core/src/agent/session-history-hydrator.js";

const fixture = join(import.meta.dirname, "fixtures/provider-builtin-analyze-image.sse");

function sse(events: Record<string, unknown>[]) {
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

for (const streaming of ["on", "off"] as const)
  test(`official provider ${streaming === "on" ? "SSE" : "JSON"} produces tool cards and identical live/cold request history`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "zcode-provider-rounds-"));
    const store = new SqliteSessionStore({ dbPath: join(root, "session.sqlite") });
    const events = new InMemorySessionEventStore({ retention: "unbounded" });
    const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    const source = await readFile(fixture, "utf8");
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(await new Request(input, init).json());
      if (streaming === "off")
        return Response.json({
          id: `reply-${bodies.length}`,
          type: "message",
          role: "assistant",
          model: "fixture",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
          content:
            bodies.length === 1
              ? [
                  { type: "text", text: "读取图片" },
                  {
                    type: "server_tool_use",
                    id: "call",
                    name: "analyze_image",
                    input: { image: "fixture.png" },
                  },
                  {
                    type: "tool_result",
                    tool_use_id: "call",
                    is_error: true,
                    content: "Error 1302",
                  },
                  { type: "text", text: "图片读取失败" },
                ]
              : [{ type: "text", text: "完成" }],
        });
      return bodies.length === 1
        ? new Response(source, { headers: { "content-type": "text/event-stream" } })
        : sse([
            {
              type: "message_start",
              message: {
                id: "reply",
                type: "message",
                role: "assistant",
                model: "fixture",
                content: [],
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "完成" } },
            { type: "content_block_stop", index: 0 },
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 1 },
            },
            { type: "message_stop" },
          ]);
    });
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture-key" },
        api: { type: "anthropic-messages", baseUrl: "https://builtin.invalid/v1" },
      }),
    );
    const model = createRegistryModelConfig(
      parseModelConfig({
        enabled: true,
        properties: {
          requiresMfjsToolSchema: false,
          contextWindow: 200000,
          inputFormat: {
            supportsText: true,
            supportsImage: true,
            supportsPdf: true,
            supportsVideo: true,
            supportsAudio: false,
          },
          outputFormat: { supportsText: true },
          supportsToolCall: true,
          supportsJsonSchemaOutput: true,
          supportsNativeWebSearch: false,
          supportsMidConversationSystem: true,
        },
        optionSpecs: {
          reasoningLevel: { values: ["disabled"], map: "{}" },
          maxOutputTokens: { max: 32000, map: '{"max_tokens": maxOutputTokens}' },
        },
      }),
    );
    assert.ok(provider.ok, JSON.stringify(provider));
    assert.ok(model.ok, JSON.stringify(model));
    const adapter = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } });
    const sessionId = createSessionId();
    const runtime = new AgentRuntime(
      sessionId,
      {
        mode: "build",
        modelStreaming: streaming,
        workingDirectory: root,
        modelSelection: {
          providerId: "fixture",
          modelId: "fixture",
          options: { reasoningLevel: "disabled" },
        },
        memory: { enabled: false },
        compact: { enabled: false },
      },
      {
        sessionStore: store,
        eventStore: events,
        modelFactory: ({ selection }) =>
          adapter.createModel({
            providerId: selection.providerId,
            modelId: selection.modelId,
            providerConfig: provider.config,
            modelConfig: model.config,
            options: { maxOutputTokens: 32000, reasoningLevel: "disabled" },
          }),
      },
    );
    try {
      const turn = await runtime.executeTurn("识别图片");
      const toolEvents = turn.events.filter((event) =>
        [
          SessionEventType.ToolCallScheduled,
          SessionEventType.ToolCallStarted,
          SessionEventType.ToolCallResult,
        ].includes(event.type),
      );
      assert.deepEqual(
        toolEvents.map((event) => event.type),
        [
          SessionEventType.ToolCallScheduled,
          SessionEventType.ToolCallStarted,
          SessionEventType.ToolCallResult,
        ],
      );
      assert.match(JSON.stringify(toolEvents), /analyze_image/);
      assert.match(JSON.stringify(toolEvents), /Error 1302/);
      const live = runtime.messageHistory.toRuntimeEntries();
      const persisted = await store.messages({ sessionID: sessionId });
      const cold = new MessageHistoryImpl();
      await hydrateMessageHistoryFromSession({ history: cold, messages: persisted });
      const conversation = (entries: ReturnType<MessageHistoryImpl["toRuntimeEntries"]>) =>
        entries
          .filter(
            (entry) =>
              "message" in entry && ["user", "assistant", "tool"].includes(entry.message.role),
          )
          .map(
            (entry) =>
              "message" in entry && {
                message: {
                  ...entry.message,
                  toolCalls: entry.message.toolCalls?.length ? entry.message.toolCalls : undefined,
                },
                compactGroupKey: entry.compactGroupKey,
              },
          );
      assert.deepEqual(conversation(cold.toRuntimeEntries()), conversation(live));
      const providerPart = persisted
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.metadata?.providerExecuted);
      assert.ok(providerPart?.type === "tool");
      if (streaming === "off") {
        assert.equal(providerPart.state.status, "error");
        assert.deepEqual(
          persisted
            .flatMap((message) => message.parts)
            .filter((part) => part.type === "text" || part.type === "tool")
            .map((part) => (part.type === "text" ? part.text : part.tool)),
          ["识别图片", "读取图片", "analyze_image", "图片读取失败"],
        );
      }
      await runtime.executeTurn("再说一遍");
      assert.match(JSON.stringify(bodies[1]), /"tool_use"/);
      assert.match(JSON.stringify(bodies[1]), /"tool_result"/);
      assert.doesNotMatch(JSON.stringify(bodies[1]), /\*\*🌐/);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

test("unpaired bold text is retained and known SDK server tools are not rewritten", async () => {
  const events = [
    { type: "message_start", message: {} },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "server_tool_use", id: "call", name: "analyze_image", input: {} },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "**正文** 保留" },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "server_tool_use", id: "known", name: "web_search", input: {} },
    },
    { type: "content_block_stop", index: 2 },
    { type: "message_stop" },
  ];
  const response = await createAnthropicCompatFetch(async () => sse(events))(
    "https://fixture.invalid",
  );
  const output = await response.text();
  assert.match(output, /\*\*正文\*\* 保留/);
  assert.match(output, /"type":"mcp_tool_use","id":"call"/);
  assert.match(output, /"type":"server_tool_use","id":"known"/);
});
