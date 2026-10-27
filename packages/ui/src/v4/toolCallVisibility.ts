import type { ToolCallRow } from "@zcode/shared/zcode-protocol-v4";

/** 仅过滤没有任何展示事实的流式占位；具名调用、结果和错误必须保留。 */
export function isEmptyToolCallPlaceholder(row: ToolCallRow): boolean {
  if (row.toolName.trim() || row.inputText.trim()) return false;
  const input = row.input;
  const hasInput =
    typeof input === "string"
      ? Boolean(input.trim())
      : input != null && (typeof input !== "object" || Object.keys(input).length > 0);
  // 模型在工具名到达前取消会留下空卡片；共享展示边界过滤，不改写 Host 的 live/replay 历史。
  return (
    !hasInput && !row.output && !row.display && !row.error && !row.progress && !row.outputPreview
  );
}
