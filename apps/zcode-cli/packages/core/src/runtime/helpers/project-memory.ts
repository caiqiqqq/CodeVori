import type { AgentRuntimeConfig } from "../types.js";
import { prepareProjectMemoryScope, resolveProjectMemoryScope } from "@zcode/shared/node";

export function isProjectMemoryConfigured(config: AgentRuntimeConfig): boolean {
  const memory = config.memory;
  return Boolean(
    memory?.enabled &&
      memory.use !== false &&
      memory.cliStorageRoot &&
      isMainMemoryTaskType(config.taskType),
  );
}

export async function resolveEnabledProjectMemoryRoot(
  config: AgentRuntimeConfig,
  workspacePath: string,
): Promise<string | undefined> {
  if (!isProjectMemoryConfigured(config)) return undefined;
  const memory = config.memory!;

  const scope = await resolveProjectMemoryScope({
    cliStorageRoot: memory.cliStorageRoot!,
    workspaceIdentity: memory.workspaceIdentity,
    workspacePath,
  });
  await prepareProjectMemoryScope(scope);
  return scope.root;
}

function isMainMemoryTaskType(taskType: AgentRuntimeConfig["taskType"]): boolean {
  return (
    taskType === undefined ||
    taskType === "interactive" ||
    taskType === "fork" ||
    taskType === "selection_side_chat" ||
    taskType === "workflow_parent"
  );
}
