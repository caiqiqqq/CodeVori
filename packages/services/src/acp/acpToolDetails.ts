import { ACP_TOOL_DETAIL_MAX_CHARS, type AcpEntry } from "@zcode/shared";
import type { ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";

type Tool = Extract<AcpEntry, { kind: "tool" }>;
export type AcpToolDetails = Partial<
  Pick<
    Tool,
    | "toolKind"
    | "toolName"
    | "input"
    | "output"
    | "inputTruncated"
    | "outputTruncated"
    | "content"
    | "contentTruncated"
  >
>;

function detail(value: unknown): { text: string; truncated: boolean } {
  // 参数/结果只进会话快照；限制单字段大小，不能把原始协议正文写入诊断日志。
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  } catch {
    text = "";
  }
  return {
    text: text.slice(0, ACP_TOOL_DETAIL_MAX_CHARS),
    truncated: text.length > ACP_TOOL_DETAIL_MAX_CHARS,
  };
}

export function projectAcpToolDetails(update: ToolCall | ToolCallUpdate): AcpToolDetails {
  const result: AcpToolDetails = {};
  if (update.kind) result.toolKind = update.kind;
  if (update.name) result.toolName = update.name.slice(0, 256);
  for (const [source, target] of [
    ["rawInput", "input"],
    ["rawOutput", "output"],
  ] as const) {
    if (update[source] === undefined) continue;
    const value = detail(update[source]);
    result[target] = value.text;
    result[`${target}Truncated`] = value.truncated;
  }
  if (update.content !== undefined && update.content !== null) {
    const text = update.content
      .flatMap((part) => {
        if (part.type === "content" && part.content.type === "text") return [part.content.text];
        if (part.type === "diff")
          return [`${part.path}\n${part.oldText ?? ""}\n→\n${part.newText}`];
        if (part.type === "terminal") return [`terminal:${part.terminalId}`];
        return [];
      })
      .join("\n");
    const bounded = detail(text);
    result.content = bounded.text;
    result.contentTruncated = bounded.truncated;
  }
  return result;
}
