import { resolveWorkspaceKey, type AppSettings } from "@zcode/shared";

export function getWorkspaceDefaultLabel(workspacePath: string): string {
  const segments = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

export function getWorkspaceDisplayLabel(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  aliases: AppSettings["workspaceAliases"] | undefined,
): string {
  const key = resolveWorkspaceKey({ workspacePath, workspaceIdentity });
  return aliases?.[key] ?? getWorkspaceDefaultLabel(workspacePath);
}
