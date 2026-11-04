import assert from "node:assert/strict";
import test from "node:test";
import type { SettingsSyncSelection } from "@zcode/shared";
import {
  mergeWorkspaceRequiredResults,
  selectionRequiresWorkspace,
} from "../src/settings-sync/workspaceMigration.js";

test("未打开项目时，用户级项仍成功迁移，项目级项按选择顺序计入失败", () => {
  const selections: SettingsSyncSelection[] = [
    {
      agent: "claudeCode",
      category: "mcpServers",
      sourceScope: "global",
      targetScope: "global",
      mcpServerPaths: ["user-mcp"],
    },
    {
      agent: "claudeCode",
      category: "skills",
      sourceScope: "project",
      targetScope: "global",
      skillPaths: ["project-a", "project-b"],
    },
    {
      agent: "claudeCode",
      category: "commands",
      sourceScope: "global",
      targetScope: "global",
      commandPaths: ["user-command"],
    },
  ];
  const blocked = new Set(selections.filter(selectionRequiresWorkspace));
  assert.equal(blocked.size, 1);
  const merged = mergeWorkspaceRequiredResults(selections, blocked, {
    successCount: 2,
    skippedCount: 0,
    failedCount: 0,
    taskResults: [
      {
        agent: "claudeCode",
        category: "mcpServers",
        status: "success",
        importedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      },
      {
        agent: "claudeCode",
        category: "commands",
        status: "success",
        importedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      },
    ],
  });
  assert.equal(merged.successCount, 2);
  assert.equal(merged.failedCount, 2);
  assert.deepEqual(
    merged.taskResults.map((item) => [item.category, item.status]),
    [
      ["mcpServers", "success"],
      ["skills", "failed"],
      ["commands", "success"],
    ],
  );
});
