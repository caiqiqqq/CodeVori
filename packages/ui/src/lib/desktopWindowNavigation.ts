import { z } from "zod";
import {
  acpAgentSchema,
  type DesktopWindowSessionSnapshot,
  type DesktopWindowWorkspace,
} from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { projectAcpSidebarSessions, type AcpSidebarSession } from "./acpSidebarSessions.js";

const navigationSchema = z
  .object({
    version: z.literal(1),
    workspacePath: z.string().trim().min(1),
    workspaceIdentity: z.string().trim().min(1).optional(),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("draft") }).strict(),
      z.object({ kind: z.literal("api"), id: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("acp"), id: z.string().min(1), agent: acpAgentSchema }).strict(),
    ]),
  })
  .strict();
export type DesktopWindowNavigation = z.infer<typeof navigationSchema>;
export interface DesktopWindowNavigationRestore {
  workspace: DesktopWindowWorkspace;
  target: DesktopWindowNavigation["target"];
  acpSession?: AcpSidebarSession;
}
const STORAGE_KEY = "zcode:desktop-window-navigation:v1";
type NavigationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readDesktopWindowNavigation(
  storage?: NavigationStorage,
): DesktopWindowNavigation | null {
  try {
    const value = (storage ?? localStorage).getItem(STORAGE_KEY);
    return value ? navigationSchema.parse(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

export function persistDesktopWindowNavigation(
  value: DesktopWindowNavigation | null,
  storage?: NavigationStorage,
): void {
  try {
    const target = storage ?? localStorage;
    if (value) target.setItem(STORAGE_KEY, JSON.stringify(navigationSchema.parse(value)));
    else target.removeItem(STORAGE_KEY);
  } catch {
    // 手机隐私模式可能禁止存储；仅失去跨重开恢复，不能阻断当前导航。
  }
}

const workspaceKey = (value: { workspacePath: string; workspaceIdentity?: string }) =>
  value.workspaceIdentity?.trim() || value.workspacePath;

/** 本地记录只是导航意图；Host 当前 membership 和会话索引裁决其是否仍可恢复。 */
export async function validateDesktopWindowNavigation(
  navigation: DesktopWindowNavigation,
  snapshot: DesktopWindowSessionSnapshot,
  resolveServices: (workspace: DesktopWindowWorkspace) => IServiceAccessor,
): Promise<DesktopWindowNavigationRestore | null> {
  const workspace = snapshot.workspaces.find(
    (item) =>
      item.workspacePath === navigation.workspacePath &&
      workspaceKey(item) === workspaceKey(navigation) &&
      item.availability !== "unavailable-local-directory",
  );
  if (!workspace) return null;
  const { target } = navigation;
  if (target.kind === "draft") return { workspace, target };
  const services = resolveServices(workspace);
  if (target.kind === "api") {
    const sessions = await services.zcodeSessionService.listSessions({
      workspacePath: workspace.workspacePath,
      ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
      ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
      sessionIds: [target.id],
      includeArchived: false,
    });
    return sessions.some(
      (session) =>
        session.sessionId === target.id &&
        !session.archivedAt &&
        session.workspace.workspacePath === workspace.workspacePath &&
        workspaceKey(session.workspace) === workspaceKey(workspace),
    )
      ? { workspace, target }
      : null;
  }
  const sessions = projectAcpSidebarSessions(
    await services.acpService.listSummaries(workspace),
    workspace,
  );
  const acpSession = sessions.find(
    (session) =>
      session.id === target.id &&
      session.agent === target.agent &&
      !session.archived &&
      !session.deletionState,
  );
  return acpSession ? { workspace, target, acpSession } : null;
}
