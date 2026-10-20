import type { AcpEntry } from "@zcode/shared";
import { isShellToolCallAwaitingCommand } from "@/lib/exploreToolCall.js";

/** ACP 标签只用于展示，不能获得同名 CLI 工具的运行时能力。 */
import { ACP_DISPLAY_TOOL_NAME } from "@zcode/shared";
export { ACP_DISPLAY_TOOL_NAME } from "@zcode/shared";
export type AcpToolEntry = Extract<AcpEntry, { kind: "tool" }>;

export function readAcpToolEntry(value: unknown): AcpToolEntry | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value)) return undefined;
  return value.kind === "tool" && "title" in value && typeof value.title === "string"
    ? (value as AcpToolEntry)
    : undefined;
}

export function acpToolGroupingKind(entry: AcpToolEntry): string {
  // 工作流保留专属 digest；未知/旧标题不能被名称猜测升级为原生工具。
  if (entry.workflow) return ACP_DISPLAY_TOOL_NAME;
  switch (entry.toolKind) {
    case "read":
    case "search":
    case "fetch":
      return entry.toolKind;
    case "execute":
      return "execute";
    default:
      return ACP_DISPLAY_TOOL_NAME;
  }
}

export function acpToolSummaryInput(entry: AcpToolEntry): unknown {
  if (entry.input !== undefined && !entry.inputTruncated) {
    try {
      const input: unknown = JSON.parse(entry.input);
      // 各 ACP 的 rawInput 结构不同；不认识命令字段时仍展示上报标题，不能被 API 的待分类隐藏规则吞掉。
      return entry.toolKind === "execute" &&
        isShellToolCallAwaitingCommand({ kind: "execute", input })
        ? entry.title
        : input;
    } catch {
      return entry.input;
    }
  }
  // 未上报参数或参数被截断时只显示原标题，不把半截 JSON 当完整命令分类。
  return entry.title;
}
