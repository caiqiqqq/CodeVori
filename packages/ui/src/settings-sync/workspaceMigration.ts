import type { SettingsSyncImportResult, SettingsSyncSelection } from "@zcode/shared";

export function countSelectionItems(selection: SettingsSyncSelection): number {
  return (
    selection.skillPaths?.length ??
    selection.commandPaths?.length ??
    selection.pluginPaths?.length ??
    selection.mcpServerPaths?.length ??
    1
  );
}

/** 项目级来源或目标必须有打开的项目；用户级项仍可独立迁移。 */
export function selectionRequiresWorkspace(selection: SettingsSyncSelection): boolean {
  return selection.targetScope === "project" || selection.sourceScope === "project";
}

/** 保持原选择顺序，将缺少项目的项记为失败，避免结果行与任务行错位。 */
export function mergeWorkspaceRequiredResults(
  selections: SettingsSyncSelection[],
  blocked: ReadonlySet<SettingsSyncSelection>,
  imported: SettingsSyncImportResult,
): SettingsSyncImportResult {
  const importedResults = [...imported.taskResults];
  const taskResults = selections.flatMap((selection) => {
    if (!blocked.has(selection)) {
      const next = importedResults.shift();
      return next ? [next] : [];
    }
    const failedCount = countSelectionItems(selection);
    return [
      {
        agent: selection.agent,
        category: selection.category,
        status: "failed" as const,
        importedCount: 0,
        skippedCount: 0,
        failedCount,
      },
    ];
  });
  const blockedCount = [...blocked].reduce(
    (sum, selection) => sum + countSelectionItems(selection),
    0,
  );
  return {
    successCount: imported.successCount,
    skippedCount: imported.skippedCount,
    failedCount: imported.failedCount + blockedCount,
    taskResults: [...taskResults, ...importedResults],
  };
}

export const EMPTY_IMPORT_RESULT: SettingsSyncImportResult = {
  successCount: 0,
  skippedCount: 0,
  failedCount: 0,
  taskResults: [],
};
