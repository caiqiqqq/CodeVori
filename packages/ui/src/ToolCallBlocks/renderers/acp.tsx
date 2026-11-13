import { WrenchIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { acpToolDetailSections, readAcpToolEntry } from "@/lib/acpToolPresentation.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";
import { isPlainRecord } from "@/ToolCallBlocks/fileSummaryTypes.js";

/** 单行和分组子项共用 ACP 原始明细，不能按同名 CLI 工具解释输入/执行动作。 */
export function AcpToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useZCodeIntl();
  const { toolCall } = context.toolCallNode;
  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : {};
  const entry = readAcpToolEntry(raw.acpTool);
  const title = toolCall.title ?? entry?.title ?? "";
  const unknown = isPlainRecord(raw.error) && raw.error.code === "ACP_TOOL_UNCONFIRMED";
  const statusLabel = unknown
    ? intl.formatMessage({ id: "acp.toolResultUnknown" })
    : context.statusLabel;
  const details = acpToolDetailSections(
    entry,
    typeof toolCall.output === "string" ? toolCall.output : undefined,
  );
  const hasTruncatedOutput =
    entry?.terminalOutputTruncated ||
    entry?.inputTruncated ||
    entry?.outputTruncated ||
    entry?.contentTruncated;
  return (
    <ToolLayout
      toolId={toolCall.toolId}
      persistOpenKey={typeof raw.acpPersistOpenKey === "string" ? raw.acpPersistOpenKey : undefined}
      icon={<WrenchIcon className="size-4 shrink-0 text-foreground-subtle" />}
      showIcon={context.showIcon !== false}
      kindLabel="ACP"
      // 原先裸字符串会让长脚本撑成多行；与 API 一样把摘要限制为单行，全文留在明细。
      primaryText={<span className="min-w-0 truncate">{title}</span>}
      secondaryText={
        toolCall.status === "failed" ? undefined : (
          <span className="shrink-0 whitespace-nowrap">{statusLabel}</span>
        )
      }
      statusLabel={toolCall.status === "failed" ? statusLabel : undefined}
      statusTooltip={context.errorText}
      showFailureStatus={toolCall.status === "failed"}
      isRunning={context.isRunning}
      title={title}
      canToggle={Boolean(title) || details.length > 0}
      renderContent={() => (
        <div className="space-y-2">
          {entry?.terminalOutputUnavailable ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "acp.terminalOutputUnavailable" })}
            </p>
          ) : null}
          {hasTruncatedOutput ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "acp.terminalOutputTruncated" })}
            </p>
          ) : null}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface px-3 py-2 font-mono text-ui-sm text-foreground-subtle">
            {[title, ...details].join("\n\n")}
          </pre>
        </div>
      )}
    />
  );
}
