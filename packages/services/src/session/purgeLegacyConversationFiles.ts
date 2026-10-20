import { rm } from "node:fs/promises";
import {
  getLegacyTaskSessionSnapshotPath,
  getLegacyDeletedTaskSessionSnapshotPath,
} from "../paths.js";

/** Remove ZCode-owned migration snapshots, preserving external Agent original history. */
export async function purgeLegacyConversationFiles(target: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}): Promise<void> {
  if (
    !target.taskId ||
    target.taskId === "." ||
    target.taskId === ".." ||
    /[/\\]/u.test(target.taskId)
  )
    throw new Error("Invalid conversation file owner");
  for (const path of [
    getLegacyTaskSessionSnapshotPath(target.workspacePath, target.taskId, target.workspaceIdentity),
    getLegacyDeletedTaskSessionSnapshotPath(
      target.workspacePath,
      target.taskId,
      target.workspaceIdentity,
    ),
  ])
    await rm(path, { force: true });
}
