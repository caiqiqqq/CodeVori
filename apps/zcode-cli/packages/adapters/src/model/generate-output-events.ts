import type { ModelTextResult } from "@zcode/contracts";
import type { AiSdkGenerateTextResult } from "./runner-runtime.js";
import { isRecord } from "./runner-record.js";

/** 修复：非流式聚合的 text/toolCalls/toolResults 会丢失交错顺序，保留 SDK 内容顺序供同一 runtime 分轮器消费。 */
export function normalizeGenerateOutputEvents(
  result: AiSdkGenerateTextResult,
  calls: ModelTextResult["toolCalls"],
): ModelTextResult["outputEvents"] {
  if (!calls?.some((call) => call.providerExecuted)) return undefined;
  const content = (result as unknown as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const byId = new Map(calls.map((call) => [call.id, call]));
  const events: NonNullable<ModelTextResult["outputEvents"]> = [];
  for (const [index, part] of content.entries()) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      events.push({ type: "text_delta", text: part.text });
    } else if (part.type === "reasoning" && typeof part.text === "string") {
      events.push({
        type: "reasoning_delta",
        id: `generate-${index}`,
        text: part.text,
        ...(isRecord(part.providerMetadata) ? { providerMetadata: part.providerMetadata } : {}),
      });
    } else if (part.type === "tool-call" && typeof part.toolCallId === "string") {
      const toolCall = byId.get(part.toolCallId);
      if (toolCall) events.push({ type: "tool_call", toolCall });
    } else if (
      (part.type === "tool-result" || part.type === "tool-error") &&
      typeof part.toolCallId === "string"
    ) {
      const toolCall = byId.get(part.toolCallId);
      if (toolCall?.providerExecuted)
        events.push({
          type: "provider_tool_result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: part.type === "tool-error" ? part.error : part.output,
          isError: part.type === "tool-error",
        });
    }
  }
  return events;
}
