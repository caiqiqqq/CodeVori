// 权限规则更新：项目规则持久化到 sessionStore，会话规则仅交给 PermissionService 内存所有者。
import {
  traceContextToLogContext,
  type PermissionRuleset,
  type PermissionUpdate,
  type ProjectId,
  type TraceContext,
} from "@zcode/contracts";
import { applyPermissionUpdates } from "./permission-rules.js";
import type { ToolExecutorDeps } from "./types.js";
import type { ExecutableToolCall } from "../types.js";

export function applySessionPermissionUpdates(
  deps: ToolExecutorDeps,
  updates: PermissionUpdate[] | undefined,
  toolCall: ExecutableToolCall,
  requestId: string,
  traceContext: TraceContext,
): void {
  if (!updates?.length) return;
  deps.permissionService.grantSessionPermission(updates);
  deps.logger?.info("Session permission granted", {
    ...traceContextToLogContext(traceContext),
    event: "tool.permission.session_grant.applied",
    module: "core.tool.executor",
    requestId,
    status: "completed",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    updateCount: updates.length,
  });
}

export async function loadProjectPermissionRuleset(
  deps: ToolExecutorDeps,
): Promise<PermissionRuleset | null> {
  if (!deps.sessionStore) return null;
  const projectId = await resolveProjectId(deps);
  if (!projectId) return null;
  return deps.sessionStore.getProjectPermission(projectId);
}

export async function persistProjectPermissionUpdates(
  deps: ToolExecutorDeps,
  updates: PermissionUpdate[],
  traceContext: TraceContext,
): Promise<void> {
  if (updates.length === 0) return;

  if (!deps.sessionStore) {
    deps.logger?.warn("Project permission update skipped without session store", {
      ...traceContextToLogContext(traceContext),
      event: "tool.permission.project_update.skipped",
      module: "core.tool.executor",
      status: "completed",
    });
    return;
  }

  const projectID = await resolveProjectId(deps);
  if (!projectID) {
    deps.logger?.warn("Project permission update skipped without persisted session", {
      ...traceContextToLogContext(traceContext),
      event: "tool.permission.project_update.skipped",
      module: "core.tool.executor",
      status: "completed",
    });
    return;
  }

  const current = (await deps.sessionStore.getProjectPermission(projectID)) ?? { version: 1 };
  const next = applyPermissionUpdates(current, updates);
  await deps.sessionStore.saveProjectPermission({ projectID, permission: next });

  deps.logger?.info("Project permission updated", {
    ...traceContextToLogContext(traceContext),
    event: "tool.permission.project_update.saved",
    module: "core.tool.executor",
    status: "completed",
    updateCount: updates.length,
  });
}

async function resolveProjectId(deps: ToolExecutorDeps): Promise<ProjectId | undefined> {
  const session = await deps.sessionStore?.getSession(deps.sessionId);
  return session?.projectID;
}
