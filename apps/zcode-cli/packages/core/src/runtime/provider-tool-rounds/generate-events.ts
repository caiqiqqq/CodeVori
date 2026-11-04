import type { ModelStreamEvent, ModelTextResult } from "@zcode/contracts";

/** 非流式结果复用既有分轮器；旧 Model 无有序内容时，将聚合正文保留为工具后的最终回答。 */
export async function* providerResultEvents(
  result: ModelTextResult,
): AsyncIterable<ModelStreamEvent> {
  yield { type: "start" };
  if (result.outputEvents) {
    yield* result.outputEvents;
  } else {
    for (const toolCall of result.toolCalls ?? []) {
      yield { type: "tool_call", toolCall };
      const output = result.toolResults?.find((item) => item.id === toolCall.id);
      if (toolCall.providerExecuted && output)
        yield {
          type: "provider_tool_result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: output.output,
          isError: output.isError === true,
        };
    }
    for (const [index, block] of (result.reasoning ?? []).entries()) {
      yield {
        type: "reasoning_delta",
        id: `generate-${index}`,
        text: block.text,
        providerMetadata: block.providerOptions,
      };
    }
    if (result.text) yield { type: "text_delta", text: result.text };
  }
  yield {
    type: "finish",
    finishReason: result.finishReason,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
  };
}
