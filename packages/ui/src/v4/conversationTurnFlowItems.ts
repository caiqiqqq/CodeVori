import type {
  AssistantTextRow,
  ConversationRow,
  TurnHeaderRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import type { ConversationCuaGroupRenderItem } from "@/v4/conversationCuaGroups.js";

export type AssistantWorkRow = Exclude<ConversationRow, TurnHeaderRow | UserInputRow>;

export type ConversationTurnFlowItem =
  | { kind: "userInput"; row: UserInputRow }
  | { kind: "assistantHistory"; rows: AssistantWorkRow[] }
  | { kind: "assistantText"; row: AssistantTextRow; latest: boolean }
  | { kind: "assistantWork"; rows: AssistantWorkRow[] }
  | ConversationCuaGroupRenderItem;

function isUserInputRow(row: ConversationRow): row is UserInputRow {
  return row.kind === "userInput";
}

function isAssistantTextRow(row: ConversationRow): row is AssistantTextRow {
  return row.kind === "assistantText";
}

function isAssistantWorkRow(row: ConversationRow): row is AssistantWorkRow {
  return row.kind !== "turnHeader" && row.kind !== "userInput";
}

function appendGroupedAssistantFlowItem(
  items: ConversationTurnFlowItem[],
  kind: "assistantHistory" | "assistantWork",
  row: AssistantWorkRow,
): void {
  const previous = items.at(-1);
  if (previous?.kind === kind) {
    previous.rows.push(row);
    return;
  }
  items.push({ kind, rows: [row] });
}

export function buildConversationFlowItems(options: {
  orderedRows: readonly ConversationRow[];
  assistantHistoryRows: readonly AssistantWorkRow[];
  assistantFollowingRows: readonly AssistantWorkRow[];
  assistantTailRows: readonly AssistantWorkRow[];
  /** 本段唯一外露的助手正文；历史正文仍保留在有序 work flow。 */
  visibleAssistantTextRow?: AssistantTextRow;
  /** 整个 product turn 唯一可挂 action 的最终正文。 */
  latestAssistantTextRow?: AssistantTextRow;
  timelineOnly: boolean;
}): ConversationTurnFlowItem[] {
  const historyRowIds = new Set(options.assistantHistoryRows.map((row) => row.rowId));
  const followingRowIds = new Set(options.assistantFollowingRows.map((row) => row.rowId));
  const tailRowIds = new Set(options.assistantTailRows.map((row) => row.rowId));
  const items: ConversationTurnFlowItem[] = [];

  for (const row of options.orderedRows) {
    if (isUserInputRow(row)) {
      items.push({ kind: "userInput", row });
      continue;
    }
    if (!isAssistantWorkRow(row)) continue;
    // 轮尾 boundary 已从 assistant flow 拆成 assistantTailRows；若再把它追加回
    // flowItems，renderer 会把它渲染在定时任务卡片、文件 summary 和消息操作栏之前。
    // 这里只保留真实 flow；boundary 由 TurnGroup 在全部 turn-local 附属 UI 之后统一收尾。
    if (tailRowIds.has(row.rowId)) continue;
    // 修复原因：API/ACP 多次过程正文都外露会让完成轮无限增长；仅本段最终正文
    // 留在折叠区外，早期正文仍按原序保存在 history 中供用户展开。
    if (
      isAssistantTextRow(row) &&
      row.rowId === options.visibleAssistantTextRow?.rowId &&
      !followingRowIds.has(row.rowId) &&
      !tailRowIds.has(row.rowId) &&
      !options.timelineOnly
    ) {
      items.push({
        kind: "assistantText",
        row,
        latest: row.rowId === options.latestAssistantTextRow?.rowId,
      });
      continue;
    }
    appendGroupedAssistantFlowItem(
      items,
      historyRowIds.has(row.rowId) && !options.timelineOnly ? "assistantHistory" : "assistantWork",
      row,
    );
  }

  return items;
}
